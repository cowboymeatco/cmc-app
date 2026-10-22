@echo off
rem Cowboy Meat Co — scale reader. Double-click to run in a window; close the
rem window to stop. The scheduled task runs the same thing with pythonw.exe.
cd /d "%~dp0"
python reader.py
pause
