#!/bin/bash
# ==============================================================================
# Automated 24/7 Setup Script for NERIST WhatsApp Bot on Google Cloud (Ubuntu)
# ==============================================================================

set -e

echo "=== 1. Setting up 2GB Swap Memory (Crucial for Chromium on 1GB RAM) ==="
if [ ! -f /swapfile ]; then
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    echo "Swap created successfully!"
else
    echo "Swapfile already exists."
fi

echo "=== 2. Updating System Packages ==="
sudo apt-get update -y

echo "=== 3. Installing Node.js 20.x and Git ==="
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git

echo "=== 4. Installing Chromium & Puppeteer System Dependencies ==="
sudo apt-get install -y \
  ca-certificates \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libc6 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libexpat1 \
  libfontconfig1 \
  libgbm1 \
  libgcc1 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libstdc++6 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxi6 \
  libxrandr2 \
  libxrender1 \
  libxss1 \
  libxtst6 \
  lsb-release \
  wget \
  xdg-utils

echo "=== 5. Installing PM2 (Process Manager for 24/7 Uptime) ==="
sudo npm install -g pm2

echo "=== 6. Installing Project Dependencies ==="
npm install

echo "=============================================================================="
echo " Setup complete! Now run:"
echo "   node bot.js"
echo " Scan the QR code once with WhatsApp."
echo " Once it shows 'Bot ready', press Ctrl+C and run:"
echo "   pm2 start bot.js --name 'nerist-bot'"
echo "   pm2 save"
echo "   pm2 startup"
echo "=============================================================================="
