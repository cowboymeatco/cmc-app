#!/usr/bin/env python3
"""
FDC-2110i data-log CSV → Supabase ingestion.

Parses the smokehouse HMI's log format:
    Date,Time,Batch#,Truck#,Operator,Temperature,Temp SP,Humidity,Humidity SP,Core Probe 1,Damper %Out

One smokehouse_cook row per file (upserted by file_name, so a re-sent file that
grew just refreshes ended_at/row_count), and one smokehouse_reading row per CSV
line (deduped on (oven, read_at), so re-sent rows are skipped server-side).

Used by ftp_server.py as files arrive; can also be run standalone to sweep the
incoming/ directory:  python ingest.py
"""

import logging
import os
import shutil
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from dotenv import load_dotenv

BASE_DIR      = Path(__file__).parent
INCOMING_DIR  = BASE_DIR / 'incoming'
PROCESSED_DIR = BASE_DIR / 'processed'

load_dotenv(BASE_DIR / '.env')

LOG_FILE = BASE_DIR / 'ingest.log'
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s  %(levelname)-7s  %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE, encoding='utf-8'),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger(__name__)

# Prefer the explicit zone (needs the `tzdata` package on Windows). If it isn't
# available, fall back to the OS local timezone rather than crashing the whole
# receiver — a missing tzdata must not take the service down.
try:
    LOCAL_TZ = ZoneInfo(os.environ.get('SMOKEHOUSE_TZ', 'America/Denver'))
except Exception:  # ZoneInfoNotFoundError, or tzdata missing entirely
    LOCAL_TZ = None


def _localize(dt: datetime) -> datetime:
    """Attach the smokehouse's local timezone to a naive datetime."""
    if LOCAL_TZ is not None:
        return dt.replace(tzinfo=LOCAL_TZ)
    return dt.astimezone()  # OS local tz (DST-aware), no tzdata needed

DATETIME_FORMATS = (
    '%m/%d/%Y %H:%M:%S',
    '%m/%d/%Y %I:%M:%S %p',
    '%m/%d/%y %H:%M:%S',
    '%m/%d/%y %I:%M:%S %p',
    '%Y-%m-%d %H:%M:%S',
    '%m/%d/%Y %H:%M',
    '%m/%d/%y %H:%M',
)


# ── Supabase REST helpers ──────────────────────────────────────────────────────

class SupabaseClient:
    def __init__(self, url: str, key: str):
        self.url = url.rstrip('/')
        self._base = {
            'apikey':        key,
            'Authorization': f'Bearer {key}',
            'Content-Type':  'application/json',
        }
        self._session = requests.Session()

    def upsert_cook(self, row: dict) -> dict:
        res = self._session.post(
            f'{self.url}/rest/v1/smokehouse_cook?on_conflict=file_name',
            json=row,
            headers={**self._base, 'Prefer': 'resolution=merge-duplicates,return=representation'},
        )
        res.raise_for_status()
        data = res.json()
        return data[0] if isinstance(data, list) else data

    def insert_readings(self, rows: list[dict]) -> None:
        for i in range(0, len(rows), 500):
            res = self._session.post(
                f'{self.url}/rest/v1/smokehouse_reading?on_conflict=oven,read_at',
                json=rows[i:i + 500],
                headers={**self._base, 'Prefer': 'resolution=ignore-duplicates,return=minimal'},
            )
            res.raise_for_status()


def supabase() -> SupabaseClient:
    url = os.environ.get('SUPABASE_URL')
    # accept either name so the thermoworks .env lines can be pasted verbatim
    key = os.environ.get('SUPABASE_SERVICE_KEY') or os.environ.get('SUPABASE_KEY')
    if not url or not key:
        raise RuntimeError('SUPABASE_URL / SUPABASE_SERVICE_KEY missing — edit .env')
    return SupabaseClient(url, key)


# ── CSV parsing ────────────────────────────────────────────────────────────────

def _parse_datetime(date_s: str, time_s: str) -> datetime | None:
    stamp = f'{date_s.strip()} {time_s.strip()}'
    for fmt in DATETIME_FORMATS:
        try:
            return _localize(datetime.strptime(stamp, fmt))
        except ValueError:
            continue
    return None

def _num(s: str) -> float | None:
    try:
        v = float(s.strip())
    except (ValueError, AttributeError):
        return None
    return v

def parse_file(path: Path, oven: str) -> tuple[dict, list[dict]]:
    """Returns (cook_meta, reading_rows). Tolerant of header rows and junk lines."""
    meta: dict = {'file_name': path.name, 'oven': oven}
    rows: list[dict] = []

    for line in path.read_text(errors='replace').splitlines():
        c = line.split(',')
        if len(c) < 10:
            continue
        read_at = _parse_datetime(c[0], c[1])
        dry     = _num(c[5])
        if read_at is None or dry is None:
            continue  # header or malformed line
        if 'batch' not in meta:
            meta.update(batch=c[2].strip() or None, truck=c[3].strip() or None,
                        operator=c[4].strip() or None)
        rows.append({
            'oven':          oven,
            'read_at':       read_at.isoformat(),
            'dry_bulb_f':    dry,
            'dry_bulb_sp_f': _num(c[6]),
            'rh_pct':        _num(c[7]),
            'rh_sp_pct':     _num(c[8]),
            'core_f':        _num(c[9]),
            'damper_pct':    _num(c[10]) if len(c) > 10 else None,
        })

    if rows:
        meta['started_at'] = rows[0]['read_at']
        meta['ended_at']   = rows[-1]['read_at']
    meta['row_count'] = len(rows)
    return meta, rows


# ── Ingestion ──────────────────────────────────────────────────────────────────

def _archive(path: Path, oven: str) -> None:
    dest_dir = PROCESSED_DIR / oven
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / path.name
    n = 1
    while dest.exists():
        dest = dest_dir / f'{path.stem}.{n}{path.suffix}'
        n += 1
    shutil.move(str(path), str(dest))

def ingest_file(path: Path) -> None:
    """Parse one CSV, load to Supabase, archive to processed/. Raises on failure
    so the caller can leave the file in incoming/ for a later retry."""
    oven = path.parent.name if path.parent != INCOMING_DIR else 'Oven1'
    meta, rows = parse_file(path, oven)

    if not rows:
        log.warning('%s: no data rows found — archiving without ingest', path.name)
        _archive(path, oven)
        return

    sb   = supabase()
    cook = sb.upsert_cook(meta)
    for r in rows:
        r['cook_id'] = cook['id']
    sb.insert_readings(rows)
    _archive(path, oven)
    log.info('%s: ingested %d readings (oven=%s batch=%s cook=%s)',
             path.name, len(rows), oven, meta.get('batch'), cook['id'])

def sweep() -> None:
    """Ingest anything sitting in incoming/ (leftovers from failed attempts)."""
    for path in sorted(INCOMING_DIR.rglob('*.*')):
        if not path.is_file():
            continue
        try:
            ingest_file(path)
        except Exception:
            log.exception('sweep: ingest failed for %s (will retry next sweep)', path)


if __name__ == '__main__':
    INCOMING_DIR.mkdir(exist_ok=True)
    sweep()
