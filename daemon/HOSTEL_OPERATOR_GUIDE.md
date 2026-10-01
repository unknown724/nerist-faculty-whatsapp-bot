# NERIST PrintHub — Hostel Station Operator Guide

Welcome to the **NERIST PrintHub** campus printing network! This guide explains how to connect your printer (in Block B, Block C, or any other hostel block) to the campus system in less than 2 minutes.

---

## 🚀 30-Second Quick Start

### What You Need
1. Any Windows laptop or PC connected to the internet (campus Wi-Fi, LAN, or mobile hotspot).
2. A printer connected to the laptop via USB cable (or local Wi-Fi).
3. Plain A4 paper loaded in the printer tray.

---

### Step-by-Step Setup

1. **Connect & Power On Your Printer**
   - Plug the printer into your laptop via USB and turn it on.
   - Ensure a test page prints cleanly from Windows.

2. **Open the `daemon` Folder**
   - Open folder: `autoprint\daemon`

3. **Run the Setup Wizard**
   - Double-click **`SETUP_HOSTEL_STATION.bat`**.
   - Select your hostel block:
     - `1` for **Block B — Pare Hostel** (Room 29)
     - `2` for **Block C — Dibang Hostel** (e.g., Room 104)
     - `3` through `9` for other blocks (Tirap, Panyor, Kameng, Lohit, Siang, Kurung-Paniu, Subansiri)
   - Enter your room number or custodian name.
   - The wizard will list all printers connected to your PC — press Enter to use the default or type your printer name.

4. **That's It!**
   - The daemon immediately transmits an encrypted heartbeat to Cloudflare D1.
   - On the web app, your hostel block instantly switches to **🟢 Ready to Print**.

---

## 🖨️ How Campus Orders Work

1. **Student Places Order:**
   - A student visits the website on mobile or PC.
   - They pick your hostel station (e.g. *Hostel Block B · Pare* or *Hostel Block C · Dibang*).
   - They pay online via UPI (₹3 B&W / ₹5 Color).
   - The order gets assigned a **6-digit Pickup Code** (e.g. `PK-7842`).

2. **Automatic Silent Printing:**
   - Your laptop daemon chimes to alert you.
   - The document is automatically downloaded, verified, and sent directly to your printer spooler.
   - Zero clicks needed from you!

3. **Collection:**
   - The student visits your room and provides their 6-digit Pickup Code.
   - Hand them their printed sheets.

---

## ⚙️ Configuration File: `station_config.json`

The setup wizard automatically creates `station_config.json` in the `daemon` folder:

```json
{
  "station_id": "block_b",
  "station_name": "NERIST Block B (Pare Hostel)",
  "room_info": "Room 29",
  "printer_name": "",
  "auto_duplex": false,
  "poll_interval_seconds": 2
}
```

- **`station_id`**: Set to `block_b`, `block_c`, `block_a`, etc.
- **`printer_name`**: Name of the Windows printer queue (empty string `""` uses Windows default).
- **`auto_duplex`**: Set to `false` for standard single-sided campus printing.
- **`poll_interval_seconds`**: Defaults to `2` seconds for near-instant responsiveness.

---

## 🔄 Running as a Background Service (Optional)

If you want the print daemon to run silently in the background whenever Windows starts up (without keeping a terminal window open):

1. Right-click **`install_service.bat`** and choose **"Run as Administrator"**.
2. To check service status or restart, double-click **`manage_service.bat`**.

---

## ❓ FAQ & Troubleshooting

### 1. The web app shows "Station Inactive / Offline"?
- Ensure `python -u printer_daemon.py` or `start_daemon.bat` is actively running.
- Ensure your laptop has active internet connectivity.
- Check the console logs — it will print `Heartbeat synced [block_b] (Slot 1)` every 30 seconds.

### 2. Printer is not printing?
- Check if the printer has paper and ink/toner.
- Clear any stuck jobs in Windows Print Spooler (`Win + R` -> `services.msc` -> restart *Print Spooler*).
- Check `daemon/temp_prints` or `daemon/logs` for any error messages.

### 3. Duplex / Double-Sided Printing?
- Per campus policy, online printing is single-sided simplex (₹3 B&W / ₹5 Color) for high speed and reliability.
- If a student requests manual double-sided printing, they can request it in person at your room counter.
