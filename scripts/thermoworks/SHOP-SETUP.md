# ThermoWorks sync — where it runs and how to update it

This folder is self-contained. It talks to two cloud services over the internet
(ThermoWorks Cloud → Supabase) and touches no local hardware, so it runs fine from
any machine that stays awake and online.

> This is a **stopgap**. The real fix is moving this into a Supabase edge function on a
> cron so no computer is involved at all. The server-side version replaces this later.

---

## Where it runs today

| | |
| --- | --- |
| Machine | The **Packaging Kiosk** — `desktop-dti17ih`, reached over Chrome Remote Desktop |
| Windows user | `Cowboy Meat Co` (**not** `charl`) |
| Folder | `C:\Users\Cowboy Meat Co\Desktop\Thermoworks\thermoworks-usb\thermoworks\` |
| Scheduled task | `CMC ThermoWorks Sync`, every 30 minutes, pointed at that folder |
| Interpreter | `pythonw.exe` (windowless) from `C:\Users\Cowboy Meat Co\AppData\Local\Programs\Python\Python314\` — so a scheduled run flashes no console at the packing table |
| Logging | 7 cold-storage probes → `cold_storage_log`, plus the cook logger (`D24380282`, 2 sensors) → `cook_reading` |

The laptop's copy of the task was **disabled on 2026-08-02**. Only the kiosk syncs now —
if the laptop task is ever re-enabled you get duplicate rows in Supabase every 30 minutes.

A column in `cold_storage_log` coming back empty is normal and not a broken install: a
probe that hasn't reported in 3 hours is skipped rather than logged stale (the New
Carcass Cooler probe drops wifi and does this regularly). That only holds once the
kiosk is on the current `sync.py` — check with the `STALE_AFTER_MINUTES` command below.
On an older copy an empty column means the read itself errored, which is worth a look
at `sync.log`.

---

## ⚠️ Don't use `$env:USERPROFILE` on the kiosk

The kiosk has **two** profiles. The sync lives under `Cowboy Meat Co`, but an elevated
PowerShell there comes up as **`charl`** — so `$env:USERPROFILE` silently resolves to
`C:\Users\charl` and every path built from it misses. Same for `$env:LOCALAPPDATA`.

Type the literal `C:\Users\Cowboy Meat Co\...` paths below. They're long and they contain
spaces, so they need the quotes.

## Updating the kiosk after a repo change

**This is the step that matters day to day.** The kiosk copy is a *copy* — editing
`scripts/thermoworks/sync.py` in the repo changes nothing at the shop until you push
the file over.

1. Remote into the kiosk with Chrome Remote Desktop.
2. Open the **side panel → File transfer → Upload file** and pick the changed file from
   the laptop (`C:\Users\charl\Claude\cmc-app\scripts\thermoworks\sync.py`).
3. Find where it actually landed — the upload goes to the `Downloads` of whichever
   profile owns the desktop session, which is not necessarily the shell you're typing in:

```powershell
Get-ChildItem "C:\Users\*\Downloads\sync.py" -Force | Select-Object FullName, LastWriteTime
```

4. Copy it over the running one, using the path step 3 printed as the source:

```powershell
Copy-Item "C:\Users\Cowboy Meat Co\Downloads\sync.py" "C:\Users\Cowboy Meat Co\Desktop\Thermoworks\thermoworks-usb\thermoworks\sync.py" -Force
```

5. Prove it still runs before walking away:

```powershell
cd "C:\Users\Cowboy Meat Co\Desktop\Thermoworks\thermoworks-usb\thermoworks"; & "C:\Users\Cowboy Meat Co\AppData\Local\Programs\Python\Python314\python.exe" sync.py
```

Use `python.exe` by hand, not the `pythonw.exe` the task uses — `pythonw` swallows
the output you're trying to read. Call it by full path: bare `python` depends on
whether PATH was set up for the `Cowboy Meat Co` user, and it may not be.

> ⚠️ **Copy the file — do not retype or paste it into a new file.** Writing the contents
> out with PowerShell (`Out-File`, `Set-Content`, `>`) stamps a UTF-8 BOM on the front,
> and Python chokes on the BOM before it reads a single line. `Copy-Item` moves the bytes
> as-is and sidesteps the whole problem.

The same procedure applies to `config.json` — that's exactly how the 7-probe cold-storage
config got to the kiosk on 2026-08-02. `sync.py` reads `.env` and `config.json` from its
own folder, so nothing else needs touching.

---

## Handy commands (run on the kiosk, from the folder above)

| What | Command |
| --- | --- |
| Run a sync right now | `& "C:\Users\Cowboy Meat Co\AppData\Local\Programs\Python\Python314\python.exe" sync.py` |
| Last 30 lines of the log | `Get-Content sync.log -Tail 30` |
| Status without changing anything | `powershell -ExecutionPolicy Bypass -File .\setup-thermoworks.ps1 -CheckOnly` |
| Is the task actually enabled? | `Get-ScheduledTask -TaskName 'CMC ThermoWorks Sync' \| Select-Object State` |
| Where does the task point? | `(Get-ScheduledTask -TaskName 'CMC ThermoWorks Sync').Actions \| Select-Object Execute, Arguments, WorkingDirectory` |
| Is the kiosk on the current sync.py? | `(Select-String -Path sync.py -Pattern 'STALE_AFTER_MINUTES').Count` — `0` means it's behind the repo |
| Change the interval to 15 min | `powershell -ExecutionPolicy Bypass -File .\setup-thermoworks.ps1 -IntervalMinutes 15` |
| List every device/channel on the account | `& "C:\Users\Cowboy Meat Co\AppData\Local\Programs\Python\Python314\python.exe" discover.py` |

Re-running `setup-thermoworks.ps1` with anything other than `-CheckOnly` needs an
**elevated** PowerShell once the task exists — a task registered by an elevated process
can only be replaced by one.

---

## Appendix: installing from scratch on a new machine

Only needed if the kiosk is replaced or reimaged.

**1. Get the folder onto the machine.** Zip this folder on the laptop, then Chrome Remote
Desktop **side panel → File transfer → Upload file**. It lands in that user's `Downloads`.

> ⚠️ The folder contains `.env`, which holds the **ThermoWorks password** and the
> **Supabase service key** in plain text. Delete the zip from both machines afterward.

**2. Install Python.** <https://www.python.org/downloads/> — on the first installer
screen, tick **"Add python.exe to PATH"**.

**3. Unzip and run the installer.** These use `$env:USERPROFILE`, which is only safe here
because you're running as the user the sync will live under — see the warning above
before reusing them later.

```powershell
Expand-Archive -Path "$env:USERPROFILE\Downloads\thermoworks-sync.zip" -DestinationPath "$env:USERPROFILE\Desktop\Thermoworks" -Force
```

```powershell
cd "$env:USERPROFILE\Desktop\Thermoworks\thermoworks-usb\thermoworks"
powershell -ExecutionPolicy Bypass -File .\setup-thermoworks.ps1
```

Green `[ok]` lines are good. Fix any red `[FAIL]` and run it again — it's safe to re-run
as many times as you like.

**4. Test it by hand.**

```powershell
python sync.py
```

You want `Authenticated as ...`, the cold-storage probes each printing a temperature,
`Cold storage row inserted`, a couple of `SENSOR n: xx.x°F` lines, and
`--- sync complete ---`. That proves the whole chain: ThermoWorks login → reading the
probes → writing to Supabase.

**5. Disable the task everywhere else**, or both machines insert readings every 30
minutes and Supabase gets duplicate rows. Needs an elevated PowerShell (the task is owned
by `BUILTIN\Administrators`, so a normal window gets "Access is denied"): right-click
Start → **Terminal (Admin)** →

```powershell
Disable-ScheduledTask -TaskName 'CMC ThermoWorks Sync'
```

---

## What the task settings buy you

- **Battery restrictions removed.** The original laptop task refused to start on battery
  and stopped if it went onto battery — a real cause of missed runs.
- **Catch-up enabled** (`StartWhenAvailable`) plus `WakeToRun`. A missed run fires when
  the machine comes back instead of being skipped silently.
- **Auto-restart** (3 tries, 5 minutes apart) so a transient network blip doesn't cost a
  whole 30-minute slot.
- **10-minute time limit.** The script self-aborts at 5 minutes; the old task had no
  ceiling, so a hung run could sit there for days blocking the next one.
- **No hard-coded paths.** Works from any folder, any Windows username.
