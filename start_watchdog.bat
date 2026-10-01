@echo off
cd /d "c:\Users\Devananda Wahengbam\Desktop\whatsappbot"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\hostel_server_watchdog.ps1 >> start_watchdog.log 2>&1
