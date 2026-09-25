#!/bin/bash
# ==============================================================================
# Auto-Start Installer for Linux (Ubuntu / Debian / Raspberry Pi)
# ==============================================================================

set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "=== 1. Ensuring PM2 is installed ==="
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
fi

echo "=== 2. Starting bot with PM2 ==="
pm2 start bot.js --name "nerist-whatsapp-bot"

echo "=== 3. Saving PM2 process list ==="
pm2 save

echo "=== 4. Setting up PM2 systemd startup service ==="
STARTUP_CMD=$(pm2 startup systemd | grep "sudo env")
if [ -n "$STARTUP_CMD" ]; then
    eval "$STARTUP_CMD"
fi

echo "=============================================================================="
echo " [OK] NERIST WhatsApp Bot is now configured to start automatically on boot!"
echo " Useful commands:"
echo "   pm2 status              # Check bot status"
echo "   pm2 logs nerist-whatsapp-bot  # View live logs"
echo "   pm2 restart nerist-whatsapp-bot # Restart bot"
echo "   pm2 stop nerist-whatsapp-bot    # Stop bot"
echo "=============================================================================="
