#!/usr/bin/env python3
"""
Smokehouse controller ALARM LOG importer.

Runs on the packaging kiosk (the shop desktop) alongside ftp_server.py, which
already imports the cook Data Files. This script is deliberately SEPARATE from
that one: the cook import is working and feeding the schedule predictors, and
nothing here should be able to break it.

Two modes:

    python alarm_import.py --probe
        Look, don't touch. Lists everything in the FTP drop that is NOT a cook
        Data File and prints the head of each one so we can see what the
        controller actually writes for alarms. Run this FIRST.

    python alarm_import.py
        Parse and upload alarm files into public.smokehouse_alarm.

The parser sniffs the CSV header rather than assuming a fixed layout, and the
verbatim source row always goes into the `raw` column. If a column we don't
recognize turns up, the data is still captured -- we just widen the mapping
later instead of re-importing from scratch.

Credentials come from the environment (same vars ftp_server.py uses):
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
or from a supabase.env file sitting next to this script, as KEY=value lines.

Stdlib only -- no pip install needed on the kiosk.
"""

import argparse
import csv
import hashlib
import io
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
except ImportError:  # Python < 3.9
    ZoneInfo = None

# ── Config ─────────────────────────────────────────────────────────────────────

DEFAULT_DIR = r"C:\CMC\smokehouse"

# The controller writes wall-clock LOCAL time with no offset. The cook importer
# already converts local -> UTC (verified against smokehouse_cook: a file named
# ..._08-06-2026-11-38-38.csv landed as started_at 2026-08-06 17:38:39+00, i.e.
# UTC-6 / Mountain Daylight). Alarms must use the same conversion or they will
# not line up with the readings.
LOCAL_TZ = "America/Denver"

# Cook Data Files look like: SNACK STICKS_08-06-2026-11-38-38.csv
COOK_FILE_RE = re.compile(r"^.+_\d{2}-\d{2}-\d{4}-\d{2}-\d{2}-\d{2}\.csv$", re.I)

TABLE = "smokehouse_alarm"

# ── Column sniffing ────────────────────────────────────────────────────────────
# Ordered most-specific first; first substring hit wins.

COLUMN_HINTS = [
    ("cleared_at", ("cleared", "clear time", "returned", "return to normal", "off time", "end time")),
    ("ack_at",     ("acknowledg", "ack time", "ack'd", "acked", " ack")),
    ("raised_at",  ("date/time", "date time", "datetime", "timestamp", "occurred",
                    "alarm time", "raised", "on time", "start time", "time", "date")),
    ("setpoint_f", ("setpoint", "set point", " sp", "sp ", "target")),
    ("value_f",    ("value", "actual", "reading", " pv", "pv ", "process")),
    ("code",       ("alarm no", "alarm number", "alarm id", "code", "number", " no.", " id")),
    ("message",    ("description", "message", "alarm text", "event", "alarm", "text", "desc", "name")),
    ("oven",       ("oven", "house", "smokehouse", "unit", "device")),
    ("severity",   ("severity", "priority", "type", "level", "class")),
]

# Which physical channel an alarm is about. This is the whole point of the
# import right now -- it is what lets us ask "show me every wet bulb alarm".
CHANNEL_PATTERNS = [
    ("wet_bulb", r"wet[\s_-]*bulb|\bwb\b|\bwet\b"),
    ("damper",   r"damper|\bvent\b|exhaust"),
    ("core",     r"\bcore\b|product|probe|internal|\bpt\s*\d|meat"),
    ("rh",       r"humid|\brh\b|moist"),
    ("dry_bulb", r"dry[\s_-]*bulb|\bdb\b|chamber|cabinet|cook\s*temp"),
]

SEVERITY_PATTERNS = [
    # Word-bounded on purpose: a bare "over" also matches "Recovery", which is
    # an ordinary event, not an alarm.
    ("alarm",   r"alarm|fault|fail|error|trip|deviat|\bhigh\b|\blow\b|\bover[\s_-]*temp|\bunder[\s_-]*temp"),
    ("warning", r"warn|caution|advisor"),
    # "ack" is word-bounded: unbounded it also matches "feedback".
    ("event",   r"start|stop|begin|\bend\b|login|logout|change|\back\b|mode|stage|step"),
]

TRUTHY_EMPTY = {"", "-", "--", "n/a", "na", "none", "null"}


def env_config():
    """SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from env, or supabase.env alongside."""
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    side_file = Path(__file__).with_name("supabase.env")
    if (not url or not key) and side_file.exists():
        for line in side_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k, v = k.strip(), v.strip().strip('"').strip("'")
            if k == "SUPABASE_URL" and not url:
                url = v
            elif k == "SUPABASE_SERVICE_ROLE_KEY" and not key:
                key = v

    if not url or not key:
        sys.exit(
            "Missing Supabase credentials.\n"
            "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment, or put them\n"
            f"in {side_file} as KEY=value lines."
        )
    return url.rstrip("/"), key


# ── Parsing helpers ────────────────────────────────────────────────────────────

def local_tz():
    if ZoneInfo is None:
        return timezone.utc
    try:
        return ZoneInfo(LOCAL_TZ)
    except Exception:
        return timezone.utc


DATE_FORMATS = [
    "%m/%d/%Y %H:%M:%S", "%m/%d/%Y %H:%M", "%m/%d/%y %H:%M:%S", "%m/%d/%y %H:%M",
    "%m-%d-%Y %H:%M:%S", "%m-%d-%Y %H:%M", "%m-%d-%Y-%H-%M-%S",
    "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S",
    "%m/%d/%Y %I:%M:%S %p", "%m/%d/%Y %I:%M %p",
    "%d/%m/%Y %H:%M:%S",
    "%H:%M:%S", "%H:%M",
]


def parse_when(*parts):
    """Join non-empty parts and try every known layout. Returns UTC iso, or None.

    Bare times (no date) are rejected rather than guessed -- an alarm pinned to
    the wrong day is worse than an alarm we flag as unparsed.
    """
    text = " ".join(p.strip() for p in parts if p and p.strip()).strip()
    if not text or text.lower() in TRUTHY_EMPTY:
        return None

    text = re.sub(r"\s+", " ", text)
    for fmt in DATE_FORMATS:
        try:
            dt = datetime.strptime(text, fmt)
        except ValueError:
            continue
        if dt.year == 1900:  # time-only format matched; no date to anchor it
            return None
        return dt.replace(tzinfo=local_tz()).astimezone(timezone.utc).isoformat()
    return None


def parse_num(text):
    if text is None:
        return None
    text = str(text).strip()
    if not text or text.lower() in TRUTHY_EMPTY:
        return None
    m = re.search(r"-?\d+(?:\.\d+)?", text.replace(",", ""))
    return float(m.group()) if m else None


def classify(patterns, text, default):
    low = (text or "").lower()
    for label, pattern in patterns:
        if re.search(pattern, low):
            return label
    return default


def map_columns(header):
    """header -> {field: column index}. Each field claims at most one column."""
    mapping = {}
    used = set()
    for field, hints in COLUMN_HINTS:
        for idx, name in enumerate(header):
            if idx in used:
                continue
            low = f" {str(name).strip().lower()} "
            if any(h in low for h in hints):
                mapping[field] = idx
                used.add(idx)
                break
    return mapping


def find_header(rows):
    """Controllers often prefix an export with title/blank lines. Find the real
    header: the first row that yields a usable timestamp column."""
    for i, row in enumerate(rows[:25]):
        if len([c for c in row if str(c).strip()]) < 2:
            continue
        mapping = map_columns(row)
        if "raised_at" in mapping and ("message" in mapping or "code" in mapping):
            return i, mapping
    return None, None


def parse_alarm_file(path):
    """Returns (records, note). note explains a skip; records is [] when skipped."""
    try:
        text = path.read_text(encoding="utf-8-sig", errors="replace")
    except OSError as exc:
        return [], f"unreadable ({exc})"

    if not text.strip():
        return [], "empty"

    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel

    rows = [r for r in csv.reader(io.StringIO(text), dialect)]
    if not rows:
        return [], "no rows"

    header_idx, mapping = find_header(rows)
    if mapping is None:
        return [], "no recognizable header (timestamp + message/code)"

    header = [str(c).strip() for c in rows[header_idx]]
    records = []

    for offset, row in enumerate(rows[header_idx + 1:], start=header_idx + 2):
        if not any(str(c).strip() for c in row):
            continue

        def cell(field):
            idx = mapping.get(field)
            if idx is None or idx >= len(row):
                return ""
            return str(row[idx]).strip()

        # A timestamp may be split across adjacent date and time columns.
        raised_idx = mapping.get("raised_at")
        candidates = [cell("raised_at")]
        if raised_idx is not None and raised_idx + 1 < len(row) and raised_idx + 1 not in mapping.values():
            candidates.append(str(row[raised_idx + 1]).strip())

        raised_at = parse_when(*candidates) or parse_when(cell("raised_at"))
        if not raised_at:
            continue  # not a data row (footers, separators, totals)

        message = cell("message") or None
        code = cell("code") or None
        haystack = " ".join(filter(None, [message, code, cell("severity")]))

        raw = {header[i] if i < len(header) else f"col{i}": str(c).strip()
               for i, c in enumerate(row)}
        row_hash = hashlib.sha1(
            json.dumps(raw, sort_keys=True, ensure_ascii=False).encode("utf-8")
        ).hexdigest()

        records.append({
            "oven":        cell("oven") or "Oven1",
            "raised_at":   raised_at,
            "cleared_at":  parse_when(cell("cleared_at")),
            "ack_at":      parse_when(cell("ack_at")),
            "code":        code,
            "message":     message,
            "severity":    classify(SEVERITY_PATTERNS, haystack, "unknown"),
            "channel":     classify(CHANNEL_PATTERNS, haystack, "other"),
            "value_f":     parse_num(cell("value_f")),
            "setpoint_f":  parse_num(cell("setpoint_f")),
            "source_file": path.name,
            "line_no":     offset,
            "raw":         raw,
            "row_hash":    row_hash,
        })

    return records, None if records else "header found but no parsable rows"


# ── Supabase ───────────────────────────────────────────────────────────────────

def rest(url, key, method, path, body=None, query=""):
    req = urllib.request.Request(
        f"{url}/rest/v1/{path}{query}",
        method=method,
        data=json.dumps(body).encode("utf-8") if body is not None else None,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = resp.read().decode("utf-8")
            return json.loads(payload) if payload.strip() else None
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"Supabase {method} {path} failed: {exc.code} {exc.read().decode('utf-8', 'replace')}")


def existing_hashes(url, key, source_file):
    quoted = urllib.parse.quote(source_file, safe="")
    rows = urllib.request.Request(
        f"{url}/rest/v1/{TABLE}?select=row_hash&source_file=eq.{quoted}",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
    )
    with urllib.request.urlopen(rows, timeout=60) as resp:
        return {r["row_hash"] for r in json.loads(resp.read().decode("utf-8"))}


# ── Modes ──────────────────────────────────────────────────────────────────────

def candidate_files(root):
    for path in sorted(Path(root).rglob("*")):
        if not path.is_file():
            continue
        if COOK_FILE_RE.match(path.name):
            continue  # cook Data File -- ftp_server.py owns these
        if path.suffix.lower() not in (".csv", ".txt", ".log", ".tsv", ".dat", ""):
            continue
        yield path


def probe(root):
    print(f"Probing {root}\n" + "=" * 72)
    found = 0
    for path in candidate_files(root):
        found += 1
        stat = path.stat()
        print(f"\n--- {path.relative_to(root)}")
        print(f"    {stat.st_size:,} bytes   modified {datetime.fromtimestamp(stat.st_mtime):%Y-%m-%d %H:%M}")
        try:
            with path.open("r", encoding="utf-8-sig", errors="replace") as fh:
                for i, line in enumerate(fh):
                    if i >= 15:
                        print("    ...")
                        break
                    print(f"    {line.rstrip()[:200]}")
        except OSError as exc:
            print(f"    (unreadable: {exc})")

        records, note = parse_alarm_file(path)
        print(f"    => parser: {len(records)} rows" + (f" -- {note}" if note else ""))
        if records:
            print(f"    => sample: {json.dumps(records[0], default=str)[:300]}")

    if not found:
        print("\nNothing here but cook Data Files. The controller may write its alarm")
        print("log somewhere else, or export it only on demand. Check the HMI for an")
        print("alarm history export and point --dir at wherever it lands.")
    print("\n" + "=" * 72)


def do_import(root, dry_run):
    url, key = ("", "") if dry_run else env_config()
    total_new = total_seen = 0

    for path in candidate_files(root):
        records, note = parse_alarm_file(path)
        if not records:
            print(f"skip  {path.name}: {note}")
            continue

        total_seen += len(records)
        if dry_run:
            print(f"would import {len(records):>5} from {path.name}")
            continue

        seen = existing_hashes(url, key, path.name)
        fresh = [r for r in records if r["row_hash"] not in seen]
        if not fresh:
            print(f"ok    {path.name}: {len(records)} rows, all already imported")
            continue

        for i in range(0, len(fresh), 500):
            rest(url, key, "POST", TABLE, body=fresh[i:i + 500])
        total_new += len(fresh)
        print(f"ok    {path.name}: +{len(fresh)} new ({len(records)} in file)")

    print(f"\n{total_new} new alarm rows imported ({total_seen} parsed).")


def main():
    ap = argparse.ArgumentParser(description="Import smokehouse controller alarm logs.")
    ap.add_argument("--dir", default=DEFAULT_DIR, help=f"FTP drop directory (default: {DEFAULT_DIR})")
    ap.add_argument("--probe", action="store_true", help="list and preview non-cook files; import nothing")
    ap.add_argument("--dry-run", action="store_true", help="parse and report, but do not upload")
    args = ap.parse_args()

    root = Path(args.dir)
    if not root.is_dir():
        sys.exit(f"Not a directory: {root}")

    if args.probe:
        probe(root)
    else:
        do_import(root, args.dry_run)


if __name__ == "__main__":
    main()
