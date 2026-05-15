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

:: Create .env if it doesn't exist
if not exist "%SCRIPT_DIR%.env" (
    copy "%SCRIPT_DIR%.env.example" "%SCRIPT_DIR%.env" >nul
    echo .env created from template.
    echo.
    echo *** IMPORTANT: Edit .env with your credentials before continuing ***
    echo File: %SCRIPT_DIR%.env
    echo.
    pause
) else (
    echo .env already exists - keeping it.
)

echo.

:: Find Python executable
for /f "delims=" %%i in ('where python') do set PYTHON_EXE=%%i
if not defined PYTHON_EXE (
    echo ERROR: python not found in PATH.
    pause
    exit /b 1
)
echo Using Python: %PYTHON_EXE%

echo.

:: Register scheduled task (every 30 minutes)
echo Registering Windows Scheduled Task "CMC ThermoWorks Sync"...
schtasks /create ^
  /tn "CMC ThermoWorks Sync" ^
  /tr "\"%PYTHON_EXE%\" \"%SCRIPT_DIR%sync.py\"" ^
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
