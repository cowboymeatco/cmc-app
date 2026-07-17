# Smokehouse Live Feed — Build Spec

Goal: see the smokehouse's **current** state (temps, RH, core probe, setpoints,
damper) from any phone or laptop, anywhere, via the cmc-app — updating about once
a minute. Complements the existing cook-log pipeline (which is a *historical*
record pushed nightly/on-demand over FTP); this adds a *real-time* view.

## Why not just expose the HMI

The FDC nCompass HMI has a built-in VNC/web screen mirror (this is almost
certainly what "Macey got it on a laptop anywhere in the plant" was). But it's
**LAN-only**, and exposing an unauthenticated cook controller to the internet is
a hard no. Instead we pull the live values *out* to Supabase and render them in
the cmc-app, which is already internet-facing and authenticated. The HMI is never
exposed; the phone talks only to our app.

## Architecture

```
[FDC nCompass HMI] ──Modbus TCP (port 502, LAN)──▶ [shop PC: poll_live.py, every 60s]
                                                          │ read registers, scale,
                                                          │ compute wet bulb
                                                          ▼
                                                     [Supabase: smokehouse_live]
                                                          ▼
                                              [cmc-app /smokehouse live dashboard]
                                                          ▼
                                                   phone / laptop, anywhere
```

Reuses everything already standing: the shop PC, Supabase, the app. Modbus **TCP**
allows multiple masters, so our poller reading the HMI does **not** conflict with
the HMI's own RTU mastering of the loop controllers — no bus contention.

## Components

### 1. HMI configuration (one-time, on the touchscreen)
- Enable **Modbus TCP slave** (Setup → Comms). Confirm port (default **502**).
- Record the **HMI's own IP address** (Setup → Network). NOTE: this is *not*
  `192.168.1.119` — that was the (vacant) FTP push target. We need the HMI's
  actual address on the LAN; give it a DHCP reservation so it never moves.

### 2. Modbus register map (the key unknown)
Which register holds which value, and its scaling. FDC publishes an nCompass
Modbus register map; values are typically 16-bit integers scaled ×10
(e.g. register value `1512` = `151.2°F`). We need, at minimum:
- Dry bulb (oven) temp + setpoint
- Relative humidity + setpoint
- Core probe 1 (and 2 if present)
- Damper % output
- (optional) run/idle status, active alarm flags
Wet bulb is **not** read — it's derived from dry bulb + RH in code (same
`calcWetBulb` the HACCP HTSS page uses), so no extra register needed.

### 3. Shop PC poller — `scripts/smokehouse/poll_live.py`
- Library: `pymodbus` (add to requirements; bundle wheel in the USB kit).
- Every 60s: open Modbus TCP to the HMI, read the mapped registers, apply scaling,
  compute wet bulb, insert one row into `smokehouse_live`, close.
- Deployment: a Windows Scheduled Task **every 1 minute** (`/sc minute /mo 1`),
  same pattern as the ThermoWorks sync — each run is a quick connect/read/write/exit,
  restart-safe. (Alternative: a background thread inside the existing FTP receiver
  service; separate task chosen for independent restart + simpler mental model.)
- Config via the existing `.env` (add `HMI_HOST`, `HMI_PORT=502`,
  `HMI_UNIT_ID`, and the register map or a reference to a `registers.json`).
- Reuses the same Supabase creds already in `scripts/smokehouse/.env`.

### 4. Supabase — `smokehouse_live` table
```
smokehouse_live (
  id           uuid PK default gen_random_uuid(),
  read_at      timestamptz not null default now(),
  oven         text not null default 'Oven1',
  dry_bulb_f   numeric,
  dry_bulb_sp_f numeric,
  rh_pct       numeric,
  rh_sp_pct    numeric,
  wet_bulb_f   numeric,        -- derived
  core_f       numeric,
  damper_pct   numeric,
  cooking      boolean,        -- inferred (dry bulb over idle threshold / SP active)
  created_at   timestamptz default now()
)
-- index on (oven, read_at desc) for "latest" + trend queries
```
Kept separate from `smokehouse_reading` (the authoritative FTP cook record). The
dashboard reads the newest row for "now" and the last few hours for the trend.

### 5. cmc-app — live dashboard
- Page: **`/smokehouse`** (mobile-first; big tiles + one trend chart).
- API: **`GET /api/smokehouse-live`** → latest reading + recent trend rows.
- Tiles: oven temp, wet bulb, RH, core probe, each vs. setpoint; damper %.
- Live trend: last few hours, dry bulb / wet bulb / core on one chart.
- **Freshness indicator**: if newest `read_at` is older than ~3 min, show
  "Smokehouse offline / not reporting" instead of stale numbers.
- **Cook status**: idle vs. active cook (inferred from temp/SP).
- **CL check** (during a cook): reuse HTSS CCP-2B logic — wet bulb ≥ 125°F,
  RH ≥ 30%, core ≥ 145°F — surfaced as green/red chips.
- Client auto-refreshes every ~60s.

## Phase 2 (later) — alerts
Text/email if an active cook goes out of spec (wet bulb below CL, core stalls,
smokehouse stops reporting). Note: the HMI already has its own "SMOKEHOUSE ALERT"
email/SMS on its alarms, so app alerts are supplementary — good for reaching
phones and for conditions the HMI doesn't alarm on. Could run in the poller or a
scheduled Supabase function.

## Security posture
- Poller runs on the shop PC (LAN); reads HMI over LAN Modbus; pushes to Supabase
  over HTTPS. HMI is never exposed to the internet.
- Phone/laptop reaches only the cmc-app (already authenticated + internet-facing).

## Connection details (CONFIRMED 7/17 from Setup → System Settings →
##   Web Server/Modbus/VNC)
- **HMI IP address: `192.168.1.176`** (also verified — this is the source IP of
  the FTP uploads in the ingest log). Give it a DHCP reservation so it stays put.
- **Modbus Slave / Unit ID: `1`**
- **Modbus TCP port: 502** (standard; not shown on-screen, assumed default)
- **Web Server: ON** — the in-plant browser view (`http://192.168.1.176`) is
  live; this is Macey's remote view, still enabled.
- **VNC Server: Off** (Web Server covers the same need).

So the poller target is `192.168.1.176:502`, unit id `1`.

### Modbus TCP status — BLOCKED (7/17)
Port scan of `192.168.1.176` from the shop PC: only **:80 (web) open**; **:502
and :1502 (Modbus TCP) refused**, :5900 (VNC) closed. So Modbus TCP is **not
currently listening** — the "Modbus Slave Address: 1" on the setup screen is
set, but the TCP slave service isn't enabled/running. Resolution options:
1. **Enable Modbus TCP on the HMI** (preferred, keeps this whole design). Need
   to find the enable — re-check Web Server/Modbus/VNC and "Offline System
   Setup" screens; may need a reboot after enabling. Confirm the nCompass build
   actually supports Modbus *TCP* (some expose Modbus *RTU/serial* only).
2. **Modbus RTU over serial via the SNA10A** converter (the loose RS-232/485
   unit from the first hardware photos — this may be the *intended* data path).
   More wiring: re-terminate the orange cable, land it on the controller's
   RS-485, USB-serial adapter into the shop PC, poll Modbus RTU. Fallback if the
   HMI has no Modbus TCP.
3. **Web-scrape port 80** — only if the nCompass web server exposes a
   machine-readable data endpoint (root showed the default Windows CE
   placeholder, so unlikely without a specific data URL).

## Open prerequisites (need from the plant)
1. ~~HMI IP + Modbus config~~ — DONE (see Connection details above).
2. The **Modbus register map** for this nCompass build (register numbers +
   scaling for dry bulb, RH, core, setpoints, damper). Two ways to get it:
   (a) FDC's nCompass communications manual (register list), or
   (b) **empirical discovery** — scan the holding registers and match values to
   the known Main View readings (e.g. find the register reading `810` or `81`
   for the 81°F dry bulb, `620`/`62` for 62% RH, `830`/`83` for 83°F core).
   The `IO Monitor` setup screen may also list live I/O with addresses.

## Rollout steps (once prerequisites are in hand)
1. Add `smokehouse_live` table (SQL snippet, like the cook tables).
2. Add `pymodbus` to requirements + USB wheels; write `poll_live.py` with the
   register map; test-read against the HMI on the shop PC.
3. Register the 1-minute scheduled task (fold into the smokehouse setup).
4. Build `/api/smokehouse-live` + the `/smokehouse` dashboard page in cmc-app.
5. Verify end-to-end: watch a live cook update on a phone off the plant network.
6. (Phase 2) wire up out-of-spec alerts.
