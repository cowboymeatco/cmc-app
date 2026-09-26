@echo off
REM Cowboy Meats - push current app prices to the Hobart scales.
REM Double-click to push to all scales; or pass one IP for a single scale.
cd /d "%~dp0"
if exist "%~dp0node\node.exe" (
  "%~dp0node\node.exe" push.mjs %*
) else (
  node push.mjs %*
)
echo.
pause
