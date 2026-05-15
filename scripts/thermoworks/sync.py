#!/usr/bin/env python3
"""
ThermoWorks Cloud → Supabase sync script.

Cold storage (Nodes): reads labeled channels → inserts one cold_storage_log row.
Cook logger (ThermaData): reads all channels → inserts cook_reading rows,
    linking to the active cook_session for that device if one exists.

Schedule via Windows Task Scheduler every 30 minutes (setup.bat does this).
Logs are written to sync.log in this directory.
"""

import asyncio
import json
import logging
import os
import sys
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

import requests
from aiohttp import ClientSession
from dotenv import load_dotenv
from thermoworks_cloud import AuthFactory, ThermoworksCloud, ResourceNotFoundError

load_dotenv(Path(__file__).parent / '.env')

LOG_FILE = Path(__file__).parent / 'sync.log'
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s  %(levelname)-7s  %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE, encoding='utf-8'),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger(__name__)


# ── Supabase REST helpers ──────────────────────────────────────────────────────

class SupabaseClient:
    def __init__(self, url: str, key: str):
        self.url = url.rstrip('/')
        self._base = {
            'apikey':        key,
            'Authorization': f'Bearer {key}',
        }
        self._write = {**self._base, 'Content-Type': 'application/json', 'Prefer': 'return=representation'}
        self._read  = {**self._base, 'Accept': 'application/json'}
        self._session = requests.Session()
        self._session.verify = True

    def insert(self, table: str, row: dict) -> dict:
        res = self._session.post(f'{self.url}/rest/v1/{table}', json=row, headers=self._write)
        res.raise_for_status()
        data = res.json()
        return data[0] if isinstance(data, list) else data

    def insert_many(self, table: str, rows: list) -> list:
        res = self._session.post(f'{self.url}/rest/v1/{table}', json=rows, headers=self._write)
        res.raise_for_status()
        return res.json()

    def select(self, table: str, filters: dict | None = None, limit: int = 1) -> list:
        params: dict = {'select': '*', 'limit': limit}
        if filters:
            params.update({k: f'eq.{v}' for k, v in filters.items()})
        res = self._session.get(f'{self.url}/rest/v1/{table}', params=params, headers=self._read)
        res.raise_for_status()
        return res.json()


# ── Helpers ───────────────────────────────────────────────────────────────────

def to_fahrenheit(value: float, units: str | None) -> float:
    u = (units or 'F').strip().upper()
    if u == 'C':
        return round(value * 9 / 5 + 32, 1)
    return round(value, 1)


async def read_channel(tw: ThermoworksCloud, serial: str, channel: int) -> float | None:
    try:
        ch = await asyncio.wait_for(
            tw.get_device_channel(device_serial=serial, channel=str(channel)),
            timeout=30,
        )
        if ch.value is None:
            return None
        return to_fahrenheit(ch.value, ch.units)
    except asyncio.TimeoutError:
        log.warning(f'    timeout ({serial} ch{channel}) — device may be offline')
        return None
    except ResourceNotFoundError:
        return None
    except Exception as e:
        log.error(f'    read error ({serial} ch{channel}): {e}')
        return None


# ── Cold storage sync ─────────────────────────────────────────────────────────

async def sync_cold_storage(tw: ThermoworksCloud, mappings: list, db: SupabaseClient) -> None:
    now = datetime.now()
    row: dict = {
        'recorded_date': now.date().isoformat(),
        'recorded_time': now.strftime('%H:%M:%S'),
        'initials':      'TW-AUTO',
        'notes':         'Auto-synced from ThermoWorks Cloud',
        'source':        'TW-AUTO',
    }

    has_data = False
    for m in mappings:
        unit_key = m['unit_key']
        if unit_key.startswith('←'):
            log.warning(f'  Skipping unmapped channel: {m.get("channel_label")} (edit config.json)')
            continue

        temp = await read_channel(tw, m['serial'], m['channel'])
        if temp is not None:
            row[unit_key] = temp
            has_data = True
            log.info(f'  {unit_key}: {temp}°F')

    if has_data:
        result = db.insert('cold_storage_log', row)
        log.info(f'Cold storage row inserted (id: {result.get("id", "?")})')
    else:
        log.warning('No cold storage readings — skipping insert')


# ── Cook logger sync ──────────────────────────────────────────────────────────

async def sync_cook_readings(tw: ThermoworksCloud, cook_cfg: dict, db: SupabaseClient) -> None:
    serial = cook_cfg['serial']
    now    = datetime.now(timezone.utc)

    # Find active cook session for this device (if any)
    sessions = db.select('cook_session', {'device_serial': serial, 'status': 'active'}, limit=1)
    session_id: str | None = sessions[0]['id'] if sessions else None
    if session_id:
        log.info(f'  Active cook session: {session_id}')
    else:
        log.info('  No active cook session — readings recorded without session link')

    readings = []
    for ch_cfg in cook_cfg.get('channels', []):
        ch_num = ch_cfg['channel']
        label  = ch_cfg.get('label', f'Ch{ch_num}')
        temp   = await read_channel(tw, serial, ch_num)
        if temp is not None:
            readings.append({
                'session_id':    session_id,
                'device_serial': serial,
                'read_at':       now.isoformat(),
                'channel':       ch_num,
                'channel_label': label,
                'temp_f':        temp,
            })
            log.info(f'  {label}: {temp}°F')

    if readings:
        db.insert_many('cook_reading', readings)
        log.info(f'Inserted {len(readings)} cook reading(s)')
    else:
        log.warning('No cook readings obtained')


# ── Main ──────────────────────────────────────────────────────────────────────

async def main() -> None:
    config_path = Path(__file__).parent / 'config.json'
    if not config_path.exists():
        log.error('config.json not found — run discover.py first')
        sys.exit(1)

    config = json.loads(config_path.read_text())

    for var in ('THERMOWORKS_EMAIL', 'THERMOWORKS_PASSWORD', 'SUPABASE_URL', 'SUPABASE_KEY'):
        if not os.environ.get(var):
            log.error(f'Missing env var: {var} — check your .env file')
            sys.exit(1)

    db = SupabaseClient(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])

    log.info('--- ThermoWorks sync start ---')

    async with ClientSession() as session:
        auth = await AuthFactory(session).build_auth(
            os.environ['THERMOWORKS_EMAIL'],
            os.environ['THERMOWORKS_PASSWORD'],
        )
        tw   = ThermoworksCloud(auth)
        user = await tw.get_user()
        log.info(f'Authenticated as {user.email or os.environ["THERMOWORKS_EMAIL"]}')

        if config.get('cold_storage'):
            log.info('Syncing cold storage...')
            await sync_cold_storage(tw, config['cold_storage'], db)

        if config.get('cook_logger'):
            log.info('Syncing cook logger...')
            await sync_cook_readings(tw, config['cook_logger'], db)

    log.info('--- sync complete ---\n')


if __name__ == '__main__':
    try:
        asyncio.run(asyncio.wait_for(main(), timeout=300))
    except asyncio.TimeoutError:
        log.error('Sync timed out after 5 minutes — aborting')
        sys.exit(1)
