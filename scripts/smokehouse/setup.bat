@echo off
setlocal
set SCRIPT_DIR=%~dp0

echo ============================================================
echo  Smokehouse FTP Receiver - Setup
echo ============================================================
echo.

:: Install Python packages
echo Installing Python packages...
pip install -r "%SCRIPT_DIR%requirements.txt"
if errorlevel 1 (
    echo ERROR: pip install failed. Make sure Python is installed and in PATH.
    pause
    exit /b 1
)

echo.

:: Create .env if it doesn't exist
if not exist "%SCRIPT_DIR%.env" (
    copy "%SCRIPT_DIR%.env.example" "%SCRIPT_DIR%.env" >nul
    echo .env created from template.
    echo.
    echo *** IMPORTANT: Edit .env with your Supabase credentials before continuing ***
    echo File: %SCRIPT_DIR%.env
    echo.
    pause
) else (
    echo .env already exists - keeping it.
)

echo.

:: Open Windows Firewall for FTP control + passive data ports
echo Adding Windows Firewall rules for FTP (port 21, 60000-60099)...
netsh advfirewall firewall add rule name="CMC Smokehouse FTP" dir=in action=allow protocol=TCP localport=21,60000-60099 >nul
if errorlevel 1 (
    echo WARNING: could not add firewall rule. Try running as Administrator.
)

echo.

:: Find Python executable (python.org install required — the Microsoft
:: Store version cannot be launched by a SYSTEM scheduled task)
set PYTHON_EXE=
for %%v in (314 313 312 311) do (
    if not defined PYTHON_EXE if exist "C:\Program Files\Python%%v\python.exe" set "PYTHON_EXE=C:\Program Files\Python%%v\python.exe"
    if not defined PYTHON_EXE if exist "%LocalAppData%\Programs\Python\Python%%v\python.exe" set "PYTHON_EXE=%LocalAppData%\Programs\Python\Python%%v\python.exe"
)
if not defined PYTHON_EXE for /f "delims=" %%i in ('where python 2^>nul') do if not defined PYTHON_EXE set "PYTHON_EXE=%%i"
if defined PYTHON_EXE echo %PYTHON_EXE% | find /i "WindowsApps" >nul && set "PYTHON_EXE="
if not defined PYTHON_EXE (
    echo ERROR: no usable Python found. Install from python.org/downloads
    echo        and check "Add python.exe to PATH" during install.
    pause
    exit /b 1
)
echo Using Python: %PYTHON_EXE%

echo.

:: Register scheduled task (runs at boot, restarts if it dies)
echo Registering Windows Scheduled Task "CMC Smokehouse FTP Receiver"...
schtasks /create ^
  /tn "CMC Smokehouse FTP Receiver" ^
  /tr "\"%PYTHON_EXE%\" \"%SCRIPT_DIR%ftp_server.py\"" ^
  /sc onstart ^
  /ru SYSTEM ^
  /f

if errorlevel 1 (
    echo ERROR: Failed to create scheduled task. Try running as Administrator.
) else (
    echo Scheduled task created - starts with Windows.
    echo Starting it now...
    schtasks /run /tn "CMC Smokehouse FTP Receiver"
)

echo.
echo ============================================================
echo  Setup complete. Next steps:
echo  1. Edit %SCRIPT_DIR%.env with Supabase credentials
echo  2. Run supabase_tables.sql in the Supabase SQL Editor (once)
echo  3. Give this PC a static IP / DHCP reservation
echo  4. On the smokehouse touchscreen (Datalogging menu):
echo     - FTP IP Add = this PC's IP address
echo     - User Name / Password = blank (anonymous)
echo     - Server Dir = Oven1
echo     - Leave "Delete Internal Data Files After FTP" UNCHECKED
echo     - Turn the DATA LOGGER ON
echo     - Press "Backup Now" to test
echo  5. Watch ftp_server.log / ingest.log in this folder
echo ============================================================
echo.
pause
