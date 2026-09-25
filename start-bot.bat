@echo off
cd /d "%~dp0"
echo [%date% %time%] Starting NERIST WhatsApp Bot... >> "%~dp0bot.log"
node bot.js >> "%~dp0bot.log" 2>&1
