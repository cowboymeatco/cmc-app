@echo off
REM Cowboy Meats - kiosk watcher. Leave this running on the kiosk.
REM It waits for "Push to scales" clicks in the app and pushes to the scales.
cd /d "%~dp0"
if exist "%~dp0node\node.exe" (
  "%~dp0node\node.exe" push.mjs --watch
) else (
  node push.mjs --watch
)
pause
