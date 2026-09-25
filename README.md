# 🤖 NERIST Faculty Search WhatsApp Bot

A fast, lightweight WhatsApp group & direct-message bot powered by [`@whiskeysockets/baileys`](https://github.com/WhiskeySockets/Baileys) (100% native WebSocket, zero Chromium / headless browser overhead) that allows students, scholars, and staff to instantly search for faculty contact information, mobile numbers, and direct links to the official [NERIST Faculty Explorer](https://nerist-faculty-search.pages.dev/).

---

## 🚀 Features

- **Smart Multi-Query & Nickname/Acronym Search**:
  - Full / Partial Name: `@find Rajesh Kumar` or `@find Ashok`
  - **Initials & Acronyms**: `@find akr` (matches **Dr. Ashok Kumar Ray**), `@find jb` (matches **Joyotri Bora Hazarika**, **Jagannath Bhuyan**, **Jyotisman Borah**), `@find akg`, etc.
  - Matches common student nicknames (e.g. `jb ma'am` / `jb sir`).
  - Email Handles: `@find kry` (matches `kry@nerist.ac.in`).
- **One-Tap Copyable Search Suggestions**:
  - When multiple matches exist, each additional match is formatted on its own single line: `👤 Name (@find Name)` so mobile users can tap or long-press and copy in one touch.
- **Clean Output**: Responds cleanly with only the **Faculty Name**, **Department**, **Mobile Number**, and official web link.
- **Embedded Database**: 350+ official faculty records preloaded in `faculty.json`.
- **Works Everywhere**: Responds in WhatsApp group chats and direct messages.
- **Student Help Guide**: Send `@help` for usage instructions.
- **Admin Remote Management**:
  - Send `#status`, `#wifilogin`, `#wifi <user> <pass>`, `#update`, or `#shutdown` directly from the host WhatsApp account.
- **Automated 24/7 Server Power Plan**:
  - Automated scripts to prevent Windows / Linux from sleeping, keep running when laptop lid is closed, and automatically start on boot.

---

## 🔋 24/7 Dedicated Server Setup (Windows / Linux)

### Option A: Windows Laptop / Desktop
1. Clone or download your repository on the machine:
   ```cmd
   git clone https://github.com/unknown724/nerist-faculty-whatsapp-bot.git
   cd nerist-faculty-whatsapp-bot
   npm install
   ```
2. Run the bot once to pair with QR code:
   ```cmd
   node bot.js
   ```
   *(Scan the terminal QR code in WhatsApp > Linked Devices)*
3. Double-click **[`install-autostart.bat`](file:///c:/Users/Richard%20Konsam/Desktop/DEVANANDA/whatsappbot/install-autostart.bat)** as Administrator:
   - Registers a Windows Scheduled Task to auto-launch the bot on startup/login.
   - Sets Windows Standby / Sleep to **Never**.
   - Sets Windows Hibernate to **Never**.
   - Sets "When I close the lid" to **Do Nothing** (AC & Battery).
   - Sets Display turn-off to **5 minutes** (protects screen backlight while bot runs 24/7).

#### 🛠️ Recommended Manual Checks for Windows:
- **Prevent Wi-Fi Sleep**:
  1. Press `Win + X` -> select **Device Manager**.
  2. Expand **Network adapters** -> Right-click your Wi-Fi adapter -> **Properties**.
  3. Go to the **Power Management** tab.
  4. **Uncheck** *"Allow the computer to turn off this device to save power"*, then click **OK**.
- **Auto Turn-On after Hostel Power Outage (BIOS)**:
  1. Restart PC and tap `F2` / `F10` / `Del` to enter BIOS.
  2. Look for **Power Management** or **Advanced**.
  3. Change **AC Power Recovery** / **Restore on AC Power Loss** to **Power On**.
  *(Whenever hostel electricity comes back, the laptop turns on automatically and boots the bot)*.

---

### Option B: Linux Server / Old Laptop (Ubuntu / Debian / Raspberry Pi)
1. Run:
   ```bash
   chmod +x install-autostart-linux.sh
   ./install-autostart-linux.sh
   ```
2. The script automatically:
   - Installs `pm2` process manager.
   - Configures the bot service to auto-revive on crashes and boot on startup.
   - Disables lid-switch sleep in `/etc/systemd/logind.conf` (`HandleLidSwitch=ignore`).
   - Masks system suspend/sleep targets.

---

## 💬 Usage Examples

### 1. Initials / Acronym Shortcut (e.g. `jb`)
Send:
```text
@find jb
```
**Bot Reply:**
```text
Found "jb" - official contact here:
https://nerist-faculty-search.pages.dev/?q=jb

👤 Dr. Jagannath Bhuyan
🏛️ Department: Chemistry
📱 Mobile: 9436895318

────────────────────
Also found:
👤 Joyotri Bora Hazarika (@find Joyotri Bora Hazarika)
👤 Jyotisman Borah (@find Jyotisman Borah)
```

### 2. Help Command
Send:
```text
@help
```

### 3. Admin Remote Controls (Send from Host Number)
- `#status` - Shows bot uptime, RAM usage, ping, and server health.
- `#wifilogin` - Triggers automated campus Fortinet/Captive Wi-Fi re-authentication.
- `#wifi <user> <pass>` - Saves or updates Wi-Fi portal credentials.
- `#update` - Pulls the latest code from GitHub and reloads.
- `#shutdown` - Gracefully stops the bot process.

---

## 🧪 Testing Locally (Without WhatsApp)
Run:
```bash
npm test
```

