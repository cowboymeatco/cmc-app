<#
    ThermoWorks Cloud -> Supabase sync — installer
    ---------------------------------------------
    Run this ON THE MACHINE THAT WILL HOST THE SYNC, from inside this folder:

        cd <this folder>
        powershell -ExecutionPolicy Bypass -File .\setup-thermoworks.ps1

    Checks prerequisites, installs Python packages, and registers the repeating
    scheduled task. Safe to re-run — it replaces its own task.

    Switches:
        -CheckOnly              report status, change nothing
        -IntervalMinutes <n>    how often to sync (default 30)
        -TaskName <name>        override the task name (default "CMC ThermoWorks Sync")
#>

[CmdletBinding()]
param(
    [switch]$CheckOnly,
    [int]$IntervalMinutes = 30,
    [string]$TaskName = 'CMC ThermoWorks Sync'
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$fail = $false

function Ok   ($m) { Write-Host "  [ok]   $m" -ForegroundColor Green }
function Warn ($m) { Write-Host "  [warn] $m" -ForegroundColor Yellow }
function Bad  ($m) { Write-Host "  [FAIL] $m" -ForegroundColor Red; $script:fail = $true }
function Head ($m) { Write-Host ""; Write-Host $m -ForegroundColor Cyan }

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  ThermoWorks sync - setup" -ForegroundColor Cyan
Write-Host "  Folder: $root" -ForegroundColor DarkGray
Write-Host "==================================================" -ForegroundColor Cyan

# ---------------------------------------------------------------- 0. elevation
# A task registered by an elevated process can only be replaced by one. Without
# this check the script does five minutes of work and then dies on Unregister.
if (-not $CheckOnly) {
    $me = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        if ($existing) {
            Write-Host ""
            Write-Host "  [FAIL] '$TaskName' already exists and this window is not elevated." -ForegroundColor Red
            Write-Host "         Re-run from an Administrator PowerShell, or use -CheckOnly to look without changing." -ForegroundColor DarkGray
            Write-Host ""
            exit 1
        }
    }
}

# ---------------------------------------------------------------- 1. files
Head "1. Project files"
foreach ($f in 'sync.py','discover.py','requirements.txt','config.json') {
    if (Test-Path (Join-Path $root $f)) { Ok $f } else { Bad "$f is missing - copy the whole folder over" }
}
if (Test-Path (Join-Path $root '.env')) { Ok ".env" }
else { Bad ".env is missing - it holds the ThermoWorks and Supabase credentials and is NOT in git. Copy it from the laptop." }
if ($fail) { Write-Host "`nStopping: files incomplete.`n" -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------- 2. python
Head "2. Python"
$py = $null
if (-not $py) { $c = Get-Command python -ErrorAction SilentlyContinue; if ($c) { $py = $c.Source } }
if (-not $py -and (Test-Path (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python314\python.exe'))) {
    $py = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python314\python.exe'
}
if (-not $py) { $c = Get-Command py -ErrorAction SilentlyContinue; if ($c) { $py = $c.Source } }
if (-not $py) {
    Bad "No Python found. Install from https://www.python.org/downloads/ (tick 'Add python.exe to PATH'), then re-run."
    exit 1
}
Ok "$py"
Write-Host "         $(& $py --version 2>&1)" -ForegroundColor DarkGray

# pythonw.exe runs with no console window - preferred for a task firing every 30 min
$pyw = Join-Path (Split-Path $py -Parent) 'pythonw.exe'
if (Test-Path $pyw) { Ok "pythonw.exe found - task will run with no popup window" }
else { $pyw = $py; Warn "no pythonw.exe next to python.exe - a console window will flash every $IntervalMinutes min" }

# ---------------------------------------------------------------- 3. packages
Head "3. Python packages"
if ($CheckOnly) {
    $missing = @()
    foreach ($m in 'thermoworks_cloud','requests','dotenv','aiohttp') {
        & $py -c "import $m" 2>$null
        if ($LASTEXITCODE -ne 0) { $missing += $m }
    }
    if ($missing.Count) { Warn "not installed: $($missing -join ', ')" } else { Ok "all imports present" }
} else {
    Write-Host "  installing from requirements.txt (this can take a minute)..." -ForegroundColor DarkGray
    & $py -m pip install --disable-pip-version-check -q -r (Join-Path $root 'requirements.txt')
    if ($LASTEXITCODE -eq 0) { Ok "requirements installed" } else { Bad "pip install failed - see output above" }
}

# ---------------------------------------------------------------- 4. credentials
Head "4. Credentials (.env)"
$envText = Get-Content (Join-Path $root '.env') -Raw
foreach ($k in 'THERMOWORKS_EMAIL','THERMOWORKS_PASSWORD','SUPABASE_URL','SUPABASE_KEY') {
    if ($envText -match "(?m)^\s*$k\s*=\s*(?<v>\S+)") { Ok "$k is set" }
    else { Bad "$k is blank or missing in .env" }
}

# ---------------------------------------------------------------- 5. device map
Head "5. Device mapping (config.json)"
$cfg = Get-Content (Join-Path $root 'config.json') -Raw | ConvertFrom-Json
$coldCount = @($cfg.cold_storage).Count
if ($coldCount -gt 0) { Ok "$coldCount cold-storage channel(s) mapped" }
else {
    Warn "cold_storage is EMPTY - no cooler/freezer temperatures are being logged at all."
    Write-Host "         To set it up: run  $py discover.py  to list your devices and channels," -ForegroundColor DarkGray
    Write-Host "         then add them to the cold_storage array in config.json." -ForegroundColor DarkGray
}
if ($cfg.cook_logger -and $cfg.cook_logger.serial) {
    Ok "cook logger $($cfg.cook_logger.serial) with $(@($cfg.cook_logger.channels).Count) channel(s)"
} else {
    Warn "no cook_logger configured"
}

# ---------------------------------------------------------------- 6. task
Head "6. Scheduled task"
if ($CheckOnly) {
    $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($t) {
        $t | Get-ScheduledTaskInfo | Select-Object TaskName,LastRunTime,LastTaskResult,NextRunTime |
            Format-Table -AutoSize | Out-String | Write-Host
    } else { Warn "task '$TaskName' is not registered on this machine" }
} else {
    $action = New-ScheduledTaskAction -Execute $pyw `
                                      -Argument "`"$(Join-Path $root 'sync.py')`"" `
                                      -WorkingDirectory $root
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddMinutes(1) `
                                        -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
                                        -RepetitionDuration (New-TimeSpan -Days 3650)
    # WakeToRun + StartWhenAvailable are what keep a HACCP record unbroken on a
    # machine that sleeps: wake for the run, and if the wake was refused, catch
    # up on the missed one as soon as the machine is back.
    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -WakeToRun `
        -MultipleInstances IgnoreNew `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
        -RestartInterval (New-TimeSpan -Minutes 5) `
        -RestartCount 3
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive

    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    }
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
        -Settings $settings -Principal $principal `
        -Description "ThermoWorks Cloud -> Supabase temperature sync, every $IntervalMinutes minutes" | Out-Null
    Ok "'$TaskName' registered - every $IntervalMinutes minutes, starting within the hour"
    Write-Host "         runs: $pyw" -ForegroundColor DarkGray
    Write-Host "         script: $(Join-Path $root 'sync.py')" -ForegroundColor DarkGray
}

# ---------------------------------------------------------------- 7. power
Head "7. Power settings"
$ac = powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE 2>$null | Select-String 'Current AC Power Setting Index' | Select-Object -First 1
if (-not $ac) { Warn "couldn't read the sleep setting - check it by hand in Settings > System > Power" }
elseif ($ac.ToString() -match '0x00000000') { Ok "machine never sleeps on AC power" }
else {
    Warn "this machine sleeps on AC power - syncs will be missed. Fix with:"
    Write-Host "         powercfg /change standby-timeout-ac 0" -ForegroundColor DarkGray
    Write-Host "         powercfg /change hibernate-timeout-ac 0" -ForegroundColor DarkGray
}

# ---------------------------------------------------------------- done
Write-Host ""
if ($fail) {
    Write-Host "Finished WITH PROBLEMS - fix the [FAIL] lines above and re-run." -ForegroundColor Red
} elseif ($CheckOnly) {
    Write-Host "Check complete - nothing was changed." -ForegroundColor Green
} else {
    Write-Host "Setup complete." -ForegroundColor Green
    Write-Host "Next: test it by hand with   $py sync.py" -ForegroundColor DarkGray
    Write-Host "then confirm the tail of     sync.log   ends with 'sync complete'." -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "IMPORTANT: once this machine is confirmed working, DISABLE the laptop's" -ForegroundColor Yellow
    Write-Host "'CMC ThermoWorks Sync' task, or both will insert readings every 30 min." -ForegroundColor Yellow
}
Write-Host ""
