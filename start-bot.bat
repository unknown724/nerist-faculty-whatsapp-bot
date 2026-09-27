@echo off
cd /d "%~dp0"
echo [%date% %time%] Starting NERIST WhatsApp Bots (Personal & Business)... >> "%~dp0bot.log"
start /B node bot.js >> "%~dp0bot.log" 2>&1
start /B node bot_business.js >> "%~dp0bot_business.log" 2>&1

