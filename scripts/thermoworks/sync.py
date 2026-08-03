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
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests
from aiohttp import ClientSession
from dotenv import load_dotenv
from thermoworks_cloud import AuthFactory, ThermoworksCloud, ResourceNotFoundError

load_dotenv(Path(__file__).parent / '.env')

# Drop any reading whose probe hasn't reported in this long — see is_stale().
STALE_AFTER_MINUTES = 180

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

def to_float(value) -> float | None:
    """Coerce a channel value to a number, or None if it isn't one.

    ThermoWorks Cloud is Firestore-backed, and Firestore serialises an
    integerValue as a JSON *string*. A probe sitting on a whole degree therefore
    comes back as '17' where 17.1 comes back as a float, and the thermoworks
    library passes that through untouched (its DeviceChannel.value accepts both
    doubleValue and integerValue but converts neither). Every "type str doesn't
    define __round__ method" in sync.log is a real temperature that landed on a
    round number, so coerce before treating a read as failed.
    """
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def brief(reason: str, limit: int = 70) -> str:
    """One-line, trimmed version of an error for the record's notes field.

    An API error can carry a whole JSON body; sync.log keeps that, the HACCP
    record just needs enough to tell a bad probe from a bad config.
    """
    s = ' '.join(reason.split())
    return s if len(s) <= limit else s[:limit - 1] + '…'


def to_fahrenheit(value: float, units: str | None) -> float:
    u = (units or 'F').strip().upper()
    if u == 'C':
        return round(value * 9 / 5 + 32, 1)
    return round(value, 1)


def channel_age_minutes(ch) -> float | None:
    """How long ago the device last sent data. None if the device doesn't say."""
    ts = ch.last_telemetry_saved or ch.last_seen
    if ts is None:
        return None
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - ts).total_seconds() / 60


async def read_channel(tw: ThermoworksCloud, serial: str, channel: int):
    """Returns (temp_f, age_minutes, error).

    temp_f is None whenever there is no usable reading, and error then says why.
    A caller that only sees None can't tell a dead probe from a reading that was
    never attempted, which is exactly the gap a HACCP record must not have — so
    the reason travels with the result instead of only reaching sync.log.
    age_minutes is None if the device doesn't say.
    """
    try:
        ch = await asyncio.wait_for(
            tw.get_device_channel(device_serial=serial, channel=str(channel)),
            timeout=30,
        )
    except asyncio.TimeoutError:
        return None, None, 'timed out after 30 s — device may be offline'
    except ResourceNotFoundError:
        return None, None, 'channel not found — check config.json'
    except Exception as e:
        return None, None, f'{type(e).__name__}: {e}'

    age = channel_age_minutes(ch)
    if ch.value is None:
        return None, age, 'device reported no value'

    temp = to_float(ch.value)
    if temp is None:
        return None, age, f'non-numeric value {ch.value!r}'

    return to_fahrenheit(temp, ch.units), age, None


def is_stale(age_minutes: float | None) -> bool:
    """A probe that has gone quiet keeps serving its last temperature. Recording
    that as a current reading turns a dead probe into a passing HACCP record, so
    a stale value is dropped rather than logged.

    Threshold measured 2026-07-26: healthy probes were 17-82 min behind, the
    wifi-flaky New Carcass Cooler was 28.5 h. An unknown age is treated as fresh
    so a missing field can't blank a working probe.
    """
    return age_minutes is not None and age_minutes > STALE_AFTER_MINUTES


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
    offline = []
    failed  = []
    for m in mappings:
        unit_key = m['unit_key']
        if unit_key.startswith('←'):
            log.warning(f'  Skipping unmapped channel: {m.get("channel_label")} (edit config.json)')
            continue

        temp, age, err = await read_channel(tw, m['serial'], m['channel'])
        if err:
            failed.append(f'{unit_key} ({brief(err)})')
            log.error(f'  {unit_key}: READ FAILED — {err}')
            continue

        if is_stale(age):
            offline.append(unit_key)
            log.warning(f'  {unit_key}: SKIPPED — probe silent for {age / 60:.1f} h')
            continue

        row[unit_key] = temp
        has_data = True
        log.info(f'  {unit_key}: {temp}°F')

    # Leave the gap visible on the record rather than only in this log file. A
    # blank column otherwise reads the same whether the probe is dead or the
    # reading was never taken, so say which and why on the row itself.
    if offline:
        row['notes'] += f'. No reading from {", ".join(offline)} — probe offline'
    if failed:
        row['notes'] += f'. READ FAILED for {", ".join(failed)} — column left blank, check the probe'

    if has_data:
        result = db.insert('cold_storage_log', row)
        log.info(f'Cold storage row inserted (id: {result.get("id", "?")})')
    elif failed or offline:
        # Nothing usable, but something was wrong rather than absent — record it
        # so the run leaves a trace instead of a hole in the log.
        db.insert('cold_storage_log', row)
        log.error(f'No usable cold storage readings — row inserted with reasons only ({len(failed)} failed, {len(offline)} offline)')
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
        ch_num  = ch_cfg['channel']
        label   = ch_cfg.get('label', f'Ch{ch_num}')
        temp, age, err = await read_channel(tw, serial, ch_num)
        if err:
            log.error(f'  {label}: READ FAILED — {err}')
            continue
        if is_stale(age):
            log.warning(f'  {label}: SKIPPED — probe silent for {age / 60:.1f} h')
            continue
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
