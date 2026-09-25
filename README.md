# 🤖 NERIST Faculty Search WhatsApp Bot

A WhatsApp group & direct-message bot powered by [`whatsapp-web.js`](https://wwebjs.dev/) and `qrcode-terminal` that allows students, scholars, and staff to instantly search for faculty contact information, mobile numbers, and direct links to the official [NERIST Faculty Explorer](https://nerist-faculty-search.pages.dev/).

---

## 🚀 Features

- **Smart Search & Shortcuts**:
  - Full/Partial Name: `@find Rajesh Kumar` or `@find Ashok`
  - **Initials / Acronyms**: `@find akr` (matches **Dr. Ashok Kumar Ray**), `@find kry` (matches **Dr. Kaushik Ray**), `@find akg`, etc.
  - Email Handles: `@find kry` (matches `kry@nerist.ac.in`)
- **Clean Display**: Responds cleanly with only the **Faculty Name**, **Mobile Number**, and official web link.
- **Embedded Database**: 350+ official faculty records preloaded in `faculty.json`.
- **Works Everywhere**: Responds in WhatsApp group chats and direct messages.
- **Student Help Guide**: Send `@help` for usage instructions.
- **Auto-Start on Laptop Boot**: Configured to run automatically and silently whenever your laptop turns on or restarts!
- **Session Persistence**: Saves login session in `.wwebjs_auth` so you don't have to rescan QR code on restarts.

---

## ⚡ Windows Auto-Start (Runs Silently on Boot & Restart)

The bot is configured to run automatically in the background whenever Windows boots or logs in.

### Quick Actions:
- **Enable / Re-install Auto-Start**:
  Double-click [`install-autostart.bat`](file:///c:/Users/Richard%20Konsam/Desktop/DEVANANDA/whatsappbot/install-autostart.bat)
- **Stop the Bot**:
  Double-click [`stop-bot.bat`](file:///c:/Users/Richard%20Konsam/Desktop/DEVANANDA/whatsappbot/stop-bot.bat)
- **Disable Auto-Start**:
  Double-click [`uninstall-autostart.bat`](file:///c:/Users/Richard%20Konsam/Desktop/DEVANANDA/whatsappbot/uninstall-autostart.bat)
- **View Bot Logs**:
  Open `bot.log` in the project folder to inspect connection status and processed queries.

---

## 💬 Usage Examples

### 1. Initials Shortcut (e.g. `akr`)
Send:
```text
@find akr
```
**Bot Reply:**
```text
Found "akr" - official contact here:
https://nerist-faculty-search.pages.dev/?q=akr

👤 Dr. Ashok Kumar Ray
📱 Mobile: 8638091859
```

### 2. Full Name Search
Send:
```text
@find Rajesh Kumar
```
**Bot Reply:**
```text
Found "Rajesh Kumar" - official contact here:
https://nerist-faculty-search.pages.dev/?q=Rajesh%20Kumar

👤 Dr. Rajesh Kumar
📱 Mobile: 9868576783
──────────────────
👤 Dr. Rajesh Kumar Yadav
📱 Mobile: 8974555972
```

### 3. Help Command
Send:
```text
@help
```

---

## 🧪 Testing Locally (Without WhatsApp)
Run:
```bash
npm test
```
