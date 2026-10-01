@echo off
title PrintKurox Cloudflare Tunnel (DOCX Conversion Service)
color 0b

echo ============================================================
echo   PrintKurox Kiosk - DOCX Converter Remote Tunnel
echo ============================================================
echo This tunnel allows the cloud website (Vercel) to reach the
echo local LibreOffice converter on port 7250 securely.
echo ============================================================
echo.

cd /d "%~dp0"

:: 1. Check if cloudflared.exe is present, download if missing
if not exist "cloudflared.exe" (
    echo [INFO] Downloading official cloudflared binary...
    curl -L -o cloudflared.exe https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
    if errorlevel 1 (
        echo [ERROR] Failed to download cloudflared. Please download manually:
        echo https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
        pause
        exit /b 1
    )
    echo [SUCCESS] Download complete!
    echo.
)

echo [INFO] Starting Cloudflare Tunnel connected to local port 7250...
echo.
echo ============================================================
echo  Copy the *.trycloudflare.com URL shown below and set it in
echo  your Vercel Project Environment Variables as:
echo    DOCX_CONVERTER_URL = https://xxxx.trycloudflare.com
echo ============================================================
echo.

cloudflared.exe tunnel --url http://127.0.0.1:7250
pause
