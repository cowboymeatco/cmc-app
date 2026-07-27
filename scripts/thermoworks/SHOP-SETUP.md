# ThermoWorks sync — moving it to the shop computer

This folder is self-contained. It talks to two cloud services over the internet
(ThermoWorks Cloud → Supabase) and touches no local hardware, so it runs fine from
any machine that stays awake and online.

> This is a **stopgap**. The real fix is moving this into a Supabase edge function on a
> cron so no computer is involved at all. Do this now to stop losing readings; the
> server-side version replaces it later.

---

## 1. (Laptop) Get the folder to the shop computer

The zip is already built at `C:\Users\charl\Downloads\thermoworks-sync.zip`.

Remote into the shop computer, then use **Chrome Remote Desktop's side panel → File
transfer → Upload file** and pick that zip. It lands in the shop computer's `Downloads`.

> ⚠️ The zip contains `.env`, which holds your **ThermoWorks password** and your
> **Supabase service key** in plain text. Delete the zip from both machines once this
> is working.

## 2. (Shop) Install Python

<https://www.python.org/downloads/> — on the first installer screen, **tick "Add
python.exe to PATH"**. Skip this step if Python is already there.

## 3. (Shop) Unzip and run the installer

```powershell
Expand-Archive -Path $env:USERPROFILE\Downloads\thermoworks-sync.zip -DestinationPath $env:USERPROFILE\Claude -Force
```

```powershell
cd $env:USERPROFILE\Claude\thermoworks
powershell -ExecutionPolicy Bypass -File .\setup-thermoworks.ps1
```

Green `[ok]` lines are good. Fix any red `[FAIL]` and run it again — it's safe to
re-run as many times as you like.

## 4. (Shop) Test it by hand

```powershell
python sync.py
```

You want to see `Authenticated as ...`, a couple of `SENSOR n: xx.x°F` lines, and
`--- sync complete ---`. That proves the whole chain: ThermoWorks login → reading the
probes → writing to Supabase.

## 5. (Laptop) Turn off the old task

**This one needs an elevated PowerShell.** The laptop's task is owned by
`BUILTIN\Administrators`, so a normal window gets "Access is denied."

Right-click Start → **Terminal (Admin)** → then:

```powershell
Disable-ScheduledTask -TaskName 'CMC ThermoWorks Sync'
```

If you skip this, both machines insert readings every 30 minutes and you get duplicate
rows in Supabase.

---

## Known gap: no cooler or freezer temperatures

`config.json` has `"cold_storage": []` — empty. This sync has **never** logged a single
cold-storage reading; it only reads the cook logger (device `D24380282`, 2 sensors).

To turn cold storage on:

```powershell
python discover.py
```

That lists every device and channel on your ThermoWorks account. Add the ones you want
to the `cold_storage` array in `config.json`, matching the shape of the `cook_logger`
entry, then run `python sync.py` again to confirm rows land in `cold_storage_log`.

## Handy commands

| What | Command |
| --- | --- |
| Status without changing anything | `powershell -ExecutionPolicy Bypass -File .\setup-thermoworks.ps1 -CheckOnly` |
| Run a sync right now | `python sync.py` |
| Last 30 lines of the log | `Get-Content sync.log -Tail 30` |
| Change the interval to 15 min | `powershell -ExecutionPolicy Bypass -File .\setup-thermoworks.ps1 -IntervalMinutes 15` |

## What changed vs. the laptop task

- **Battery restrictions removed.** The old task was set to refuse to start on battery
  and to stop if it went onto battery — a real cause of missed runs.
- **Catch-up enabled** (`StartWhenAvailable`). A missed run now fires when the machine
  comes back, instead of being skipped silently.
- **10-minute time limit.** The script self-aborts at 5 minutes; the old task had no
  ceiling, so a hung run could sit there for days blocking the next one.
- **No hard-coded paths.** Works from any folder, any Windows username.
