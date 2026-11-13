@echo off
REM Cowboy Meats - read every label format and graphic off ONE scale (read only).
REM Double-click for the first scale in config.json; or pass an IP.
REM Writes out\labels_<ip>.ht and out\graphics_<ip>.ht - send both on for decoding.
cd /d "%~dp0"
if exist "%~dp0node\node.exe" (
  "%~dp0node\node.exe" read-labels.mjs %*
) else (
  node read-labels.mjs %*
)
echo.
pause
