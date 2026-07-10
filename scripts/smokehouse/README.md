# Smokehouse FTP Receiver

Receives cook-log CSVs pushed by the Enviro-Pak smokehouse's FDC-2110i HMI and
loads them into Supabase (`smokehouse_cook` / `smokehouse_reading`).

How it works: the HMI's **Datalogging → FTP \ WAN Setup** screen makes the HMI
an FTP *client* — it uploads its internal data-log files to an FTP server on
the LAN, automatically every night at 2:00 AM (plus a "Backup Now" button).
`ftp_server.py` is that server: an anonymous-login FTP receiver that ingests
each file into Supabase on arrival and archives it to `processed/`.

```
[FDC-2110i HMI] ──FTP push (2:00 AM / Backup Now)──▶ [this PC: ftp_server.py]
                                                          │ parse + insert
                                                          ▼
                                                     [Supabase] ──▶ cmc-app
```

## PC setup (same Windows PC that runs the ThermoWorks sync)

1. Run `setup.bat` (as Administrator) — installs packages, opens the firewall
   (TCP 21 + 60000-60099), and registers a scheduled task that starts the
   receiver on boot.
2. Edit `.env` with the Supabase URL + service key (same as the ThermoWorks `.env`).
3. Run `supabase_tables.sql` once in Supabase Dashboard → SQL Editor.
4. Give this PC a **static IP or DHCP reservation** — the HMI targets it by IP.

## HMI setup (smokehouse touchscreen, Datalogging menu)

- **FTP IP Add**: this PC's IP address (was `192.168.1.119` when surveyed —
  either reserve that IP for this PC or update the field).
- **User Name / Password**: leave blank (anonymous login).
- **Server Dir**: `Oven1` — becomes the subfolder under `incoming/` and the
  `oven` column in the data. If a second smokehouse is added, give it its own
  Server Dir (e.g. `Oven2`); no PC-side changes needed.
- **Auto Backup (2:00AM)**: checked.
- **Delete Internal Data Files After FTP**: leave UNCHECKED until the pipeline
  has proven itself for a few weeks — the HMI's internal copy is the only
  backup if ingestion breaks silently.
- **Turn the DATA LOGGER ON** (it read `DATA LOGGER IS OFF` when surveyed) —
  no logging means no files to push and no HACCP record.
- Press **Backup Now** and watch `ftp_server.log` / `ingest.log` on the PC.

## Data notes

- CSV format: `Date,Time,Batch#,Truck#,Operator,Temperature,Temp SP,Humidity,Humidity SP,Core Probe 1,Damper %Out`
  (same file the HACCP → HTSS page accepts as a manual upload).
- One `smokehouse_cook` row per file (upserted by file name), one
  `smokehouse_reading` per line (deduped on `oven + read_at`), so re-sent or
  grown files are safe to ingest repeatedly.
- Timestamps are converted from the HMI's local clock (`SMOKEHOUSE_TZ`,
  default America/Denver) to UTC.
- Wet bulb is not stored; it's derived from dry bulb + RH at display time,
  same as the HTSS page does.
- Failed ingests stay in `incoming/` and retry on the next file arrival or
  receiver restart; `python ingest.py` sweeps manually.
