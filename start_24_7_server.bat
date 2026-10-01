@echo off
title "PrintKurox 24/7 Server Master Supervisor"
color 0b
cd /d "%~dp0"

echo ============================================================
echo      PrintKurox 24/7 Autonomous Server Supervisor
echo ============================================================
echo.
echo Launching 24/7 Master Watchdog...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0hostel_server_watchdog.ps1"
pause
