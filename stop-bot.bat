@echo off
echo Stopping any running NERIST WhatsApp Bot background processes...
powershell -NoProfile -Command "Get-WmiObject Win32_Process -Filter \"name = 'node.exe'\" | Where-Object { $_.CommandLine -match 'bot\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host 'Stopped bot process:' $_.ProcessId }"
echo.
echo Done!
pause
