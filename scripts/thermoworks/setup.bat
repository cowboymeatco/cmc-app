@echo off
setlocal
set SCRIPT_DIR=%~dp0

echo ============================================================
echo  ThermoWorks Sync - Setup
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

:: Create .env if it doesn't exist. Written inline rather than copied from a
:: template file - .env* is gitignored, so no template survives a fresh clone.
if not exist "%SCRIPT_DIR%.env" (
    >  "%SCRIPT_DIR%.env" echo # ThermoWorks Cloud login
    >> "%SCRIPT_DIR%.env" echo THERMOWORKS_EMAIL=
    >> "%SCRIPT_DIR%.env" echo THERMOWORKS_PASSWORD=
    >> "%SCRIPT_DIR%.env" echo.
    >> "%SCRIPT_DIR%.env" echo # Supabase project - service role key, not the anon key
    >> "%SCRIPT_DIR%.env" echo SUPABASE_URL=
    >> "%SCRIPT_DIR%.env" echo SUPABASE_KEY=
    echo .env template created - all four values are blank.
    echo.
    echo *** IMPORTANT: Fill in .env before continuing ***
    echo File: %SCRIPT_DIR%.env
    echo.
    pause
) else (
    echo .env already exists - keeping it.
)

echo.

:: Find pythonw.exe - the windowless interpreter, so the scheduled run
:: doesn't flash a console window every 30 minutes.
set "PYTHONW_EXE="
for /f "delims=" %%i in ('where pythonw 2^>nul') do if not defined PYTHONW_EXE set "PYTHONW_EXE=%%i"
if defined PYTHONW_EXE goto :found_python

:: Not on PATH - derive it from python.exe's install directory
set "PYTHON_EXE="
for /f "delims=" %%i in ('where python 2^>nul') do if not defined PYTHON_EXE set "PYTHON_EXE=%%i"
if not defined PYTHON_EXE (
    echo ERROR: neither pythonw nor python found in PATH.
    pause
    exit /b 1
)
for %%i in ("%PYTHON_EXE%") do set "PYTHONW_EXE=%%~dpipythonw.exe"

:found_python
if not exist "%PYTHONW_EXE%" (
    echo ERROR: pythonw.exe not found at: %PYTHONW_EXE%
    echo        This Python install may be missing the windowless launcher.
    pause
    exit /b 1
)
echo Using Python ^(windowless^): %PYTHONW_EXE%

echo.

:: Register scheduled task (every 30 minutes)
echo Registering Windows Scheduled Task "CMC ThermoWorks Sync"...
schtasks /create ^
  /tn "CMC ThermoWorks Sync" ^
  /tr "\"%PYTHONW_EXE%\" \"%SCRIPT_DIR%sync.py\"" ^
  /sc minute ^
  /mo 30 ^
  /f

if errorlevel 1 (
    echo ERROR: Failed to create scheduled task. Try running as Administrator.
) else (
    echo Scheduled task created - runs every 30 minutes.
)

echo.
echo ============================================================
echo  Setup complete. Next steps:
echo  1. Edit %SCRIPT_DIR%.env with your credentials
echo  2. Run: python "%SCRIPT_DIR%discover.py"
echo  3. Edit %SCRIPT_DIR%config.json to map channels
echo  4. Test: python "%SCRIPT_DIR%sync.py"
echo  5. Task Scheduler will handle it from there automatically
echo ============================================================
echo.
pause
