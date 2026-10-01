@echo off
net session >nul 2>&1
if %errorLevel% NEQ 0 (
    echo Requesting Administrator privileges to configure secure printer sharing...
    powershell -Command "Start-Process cmd -ArgumentList '/c \"%~dp0setup_roommate_sharing.bat\"' -Verb RunAs"
    exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup_roommate_sharing.ps1"
pause
