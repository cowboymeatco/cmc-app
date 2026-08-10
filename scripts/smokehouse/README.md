# Smokehouse alarm log import

The cook Data Files (temps, RH, damper) already come in via `ftp_server.py` on the
packaging kiosk. This adds the **alarm log** — the controller's record of what it
complained about and when.

Why it exists: RH is *computed* from the wet bulb, so a sick wet bulb sensor shows
up in the cook data only indirectly, as RH that won't track its setpoint. The alarm
log says it out loud, with a timestamp we can line up against the readings.

## Setup on the kiosk (one time)

1. Copy `alarm_import.py` to `C:\CMC\smokehouse\` on the packaging kiosk
   (desktop-dti17ih, under the `Cowboy Meat Co` user — same folder as `ftp_server.py`).

2. **Probe first.** This reads only; it writes nothing:

   ```
   python alarm_import.py --probe
   ```

   It lists every file in the FTP drop that is *not* a cook Data File and prints the
   head of each, then reports what the parser made of it. That output tells us
   whether the controller drops an alarm file on its own or has to be told to export
   one from the HMI.

3. Give it credentials — either the existing `SUPABASE_URL` /
   `SUPABASE_SERVICE_ROLE_KEY` environment variables, or a `supabase.env` file next
   to the script with those two as `KEY=value` lines.

4. Dry run, then real:

   ```
   python alarm_import.py --dry-run
   python alarm_import.py
   ```

5. Once it works, schedule it the same way the other kiosk jobs are scheduled. Every
   15 minutes is plenty — alarm logs are small and re-imports are free (see below).

## What it does

- **Ignores cook Data Files.** Anything matching `NAME_MM-DD-YYYY-HH-MM-SS.csv`
  belongs to `ftp_server.py` and is skipped. This script cannot disturb the cook import.
- **Sniffs the header** instead of assuming a layout — delimiter, title rows before
  the header, `Date`+`Time` split across two columns or combined into one, and the
  usual synonyms (`Description`/`Message`/`Event Text`, `Alarm No`/`Code`, …).
- **Keeps the original row** in the `raw` jsonb column, always. If a column turns up
  that the mapping doesn't know, the data is still captured — we widen the mapping
  later rather than re-importing.
- **Converts local → UTC.** The controller writes wall-clock local time with no
  offset. Verified against real data: `..._08-06-2026-11-38-38.csv` landed as
  `started_at 2026-08-06 17:38:39+00`, i.e. UTC-6. Alarms use the same conversion, or
  they wouldn't line up with the readings.
- **Re-imports are safe.** Each row is hashed; `unique (source_file, row_hash)` means
  running it twice imports nothing twice. Append-only logs and per-cook exports both work.
- **Classifies each alarm** into a channel (`wet_bulb`, `dry_bulb`, `rh`, `core`,
  `damper`, `other`) and a severity (`alarm`, `warning`, `event`, `unknown`). The
  channel is what powers "show me every wet bulb alarm".

## Where it shows up

`/cooks` — a rollup strip across the top (fault count per channel, with a callout when
one channel is generating most of them) and a `⚠ n` badge on any cook that had faults,
which expands to the alarm list in time order.

Alarms raised while the house is idle are kept and shown in the rollup; they just have
no cook to attach to.

## Data model

- `smokehouse_alarm` — one row per alarm, with `raw` holding the verbatim source row.
- `smokehouse_alarm_v` — the same rows with `cook_id` resolved by timestamp. There is
  deliberately **no foreign key** to `smokehouse_cook`: an alarm can be raised outside
  any cook, and the alarm file may land before the cook file does.
- `/api/smokehouse-alarms?days=60[&channel=wet_bulb]`
