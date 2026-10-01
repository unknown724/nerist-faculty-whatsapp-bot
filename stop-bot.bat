@echo off
echo ============================================================
echo   Stopping All NERIST & PrintKurox Background Services
echo ============================================================
echo.

powershell -NoProfile -Command "Get-WmiObject Win32_Process | Where-Object { ($_.Name -eq 'node.exe' -and ($_.CommandLine -like '*bot.js*' -or $_.CommandLine -like '*whatsapp_bot.js*')) -or ($_.Name -like 'python*.exe' -and $_.CommandLine -like '*printer_daemon.py*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host ('[STOPPED] ' + $_.Name + ' (PID ' + $_.ProcessId + ')') -ForegroundColor Yellow }"

echo.
echo [OK] All bot and printer daemon processes stopped.
pause
