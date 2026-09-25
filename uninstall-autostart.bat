@echo off
setlocal
echo ==========================================================
echo   Removing NERIST WhatsApp Bot from Windows Startup...
echo ==========================================================

set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS_TARGET=%STARTUP_FOLDER%\NERIST_WhatsApp_Bot.vbs"

if exist "%VBS_TARGET%" (
    del /f /q "%VBS_TARGET%"
    echo [OK] Removed from Windows Startup folder.
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Unregister-ScheduledTask -TaskName 'NERIST_WhatsApp_Bot' -Confirm:$false -ErrorAction SilentlyContinue; " ^
  "Write-Host '[OK] Removed from Windows Scheduled Tasks.'"

echo.
echo Auto-start has been disabled.
pause
