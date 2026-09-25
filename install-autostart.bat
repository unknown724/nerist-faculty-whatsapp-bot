@echo off
setlocal
echo ==========================================================
echo   Installing NERIST WhatsApp Bot to Windows Startup...
echo ==========================================================

set "BOT_DIR=%~dp0"
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS_SOURCE=%BOT_DIR%run-silent.vbs"
set "VBS_TARGET=%STARTUP_FOLDER%\NERIST_WhatsApp_Bot.vbs"

:: 1. Copy silent launcher to Windows Startup Folder
copy /Y "%VBS_SOURCE%" "%VBS_TARGET%" >nul
if %errorlevel% equ 0 (
    echo [OK] Added to Windows Startup folder:
    echo      %VBS_TARGET%
) else (
    echo [ERROR] Failed to copy to Startup folder.
)

:: 2. Also register in Windows Task Scheduler for high reliability
echo.
echo Registering Windows Scheduled Task...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument '\"%VBS_SOURCE%\"' -WorkingDirectory '%BOT_DIR%'; " ^
  "$trigger = New-ScheduledTaskTrigger -AtLogOn; " ^
  "$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 365); " ^
  "Register-ScheduledTask -TaskName 'NERIST_WhatsApp_Bot' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null; " ^
  "Write-Host '[OK] Windows Scheduled Task registered successfully.'"

echo.
echo ==========================================================
echo   Auto-start successfully configured!
echo   The bot will automatically start whenever your laptop
echo   turns on, logs in, or restarts!
echo ==========================================================
echo.
pause
