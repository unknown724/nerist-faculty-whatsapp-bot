"""
=============================================================================
PrintKurox Hostel Station — Always-Online & Anti-Disconnect Watchdog Daemon
=============================================================================
Purpose:
1. Prevents Windows, Laptop CPU, and Wi-Fi card from sleeping (Sleep: OFF).
2. Transmits continuous heartbeats directly to Cloudflare D1 every 8 seconds
   so the hostel station NEVER displays "Offline" on the website.
3. Automatically detects network drops and reconnects Wi-Fi.
4. Auto-heals / restarts Print Daemon and WhatsApp Bot if they ever stop.
=============================================================================
"""

import os
import sys
import time
import socket
import subprocess
CREATE_NO_WINDOW = 0x08000000 if sys.platform == 'win32' else 0

# Ensure pythonw does not crash on print()
if sys.stdout is None:
    try:
        sys.stdout = open(os.devnull, 'w', encoding='utf-8')
    except Exception:
        class _DummyStream:
            def write(self, *a, **k): pass
            def flush(self, *a, **k): pass
        sys.stdout = _DummyStream()

if sys.stderr is None:
    try:
        sys.stderr = open(os.devnull, 'w', encoding='utf-8')
    except Exception:
        class _DummyStream:
            def write(self, *a, **k): pass
            def flush(self, *a, **k): pass
        sys.stderr = _DummyStream()
import requests
import json
import ctypes
import threading
import xml.etree.ElementTree as ET
from datetime import datetime
from dotenv import load_dotenv
import tkinter as tk
from tkinter import ttk, messagebox
import pystray
from PIL import Image

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(BASE_DIR)
load_dotenv(os.path.join(BASE_DIR, '.env'))

ICON_PATH = os.path.join(ROOT_DIR, "app_icon.ico")
if not os.path.exists(ICON_PATH):
    ICON_PATH = os.path.join(BASE_DIR, "app_icon.ico")

# Configuration
STATION_ID = os.getenv('STATION_ID', 'block_b')
STATION_NAME = os.getenv('STATION_NAME', 'NERIST Block B (Pare Hostel)')
PRINTER_NAME = os.getenv('PRINTER_NAME', 'EPSON L3210 Series')
SERVER_URL = os.getenv('SERVER_URL', 'https://printkurox.vercel.app').rstrip('/')

CF_ACCOUNT_ID = os.getenv('CLOUDFLARE_ACCOUNT_ID') or '948fd75d8b84a5cf20559d6aa789d4dd'
CF_API_TOKEN = os.getenv('CLOUDFLARE_API_TOKEN', '')
CF_D1_DB_ID = os.getenv('CLOUDFLARE_D1_DATABASE_ID') or '3f4d4547-e86b-4cdd-a867-9ebba19c12c9'
STATION_TOKEN = os.getenv('STATION_TOKEN', '')

# Campus Wi-Fi Captive Portal Settings (Cyberoam / Sophos)
CAMPUS_PORTAL_ENABLED = os.getenv('CAMPUS_PORTAL_ENABLED', 'true').lower() in ('true', '1', 'yes')
CAMPUS_PORTAL_URL = os.getenv('CAMPUS_PORTAL_URL', 'http://10.10.200.1:8090').rstrip('/')
CAMPUS_WIFI_USER = os.getenv('CAMPUS_WIFI_USER', '')
CAMPUS_WIFI_PASS = os.getenv('CAMPUS_WIFI_PASS', '')
TARGET_WIFI_PROFILE = os.getenv('TARGET_WIFI_PROFILE', 'BLOCK-B')



STATION_SLOTS = {
    'main': 1,
    'block_b': 1,
    'block_c': 2,
    'block_a': 3,
    'block_d': 4,
    'block_e': 5,
    'block_f': 6,
    'block_g': 7,
    'block_h': 8,
    'girls_hostel': 9,
    'romen': 154,
    'romen_xerox': 154,
}
def resolve_station_slot(s_id):
    norm = s_id.lower()
    for k, v in STATION_SLOTS.items():
        if k in norm:
            return v
    return 1

STATION_SLOT = resolve_station_slot(STATION_ID)

# =============================================================================
# 1. WINDOWS ANTI-SLEEP KEEP-ALIVE (PREVENT LAPTOP & WI-FI STANDBY)
# =============================================================================
ES_CONTINUOUS = 0x80000000
ES_SYSTEM_REQUIRED = 0x00000001
ES_DISPLAY_REQUIRED = 0x00000002
ES_AWAYMODE_REQUIRED = 0x00000040

def set_windows_anti_sleep(enable=True):
    """
    Commands the Windows Power Manager to prevent sleep, standby,
    and Wi-Fi adapter power-down. Keeps the station running 24/7.
    """
    try:
        if sys.platform == 'win32':
            if enable:
                flags = ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_AWAYMODE_REQUIRED
                ctypes.windll.kernel32.SetThreadExecutionState(flags)
            else:
                ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS)
            return True
    except Exception as e:
        print(f"[Anti-Sleep Warning]: {e}")
    return False

# =============================================================================
# 2. CLOUDFLARE D1 DIRECT HEARTBEAT SENDER
# =============================================================================
def send_d1_heartbeat():
    """
    Sends an atomic heartbeat directly to Cloudflare D1 or via server proxy.
    Guarantees the hostel station is displayed 100% ONLINE on the website.
    """
    start = time.time()

    # 1. Direct Cloudflare D1
    if CF_ACCOUNT_ID and CF_API_TOKEN and CF_D1_DB_ID:
        url = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/d1/database/{CF_D1_DB_ID}/query"
        headers = {
            "Authorization": f"Bearer {CF_API_TOKEN}",
            "Content-Type": "application/json"
        }
        sql = "UPDATE stations SET last_heartbeat = datetime('now'), status = 'online' WHERE id = ?;"
        payload = {
            "sql": sql,
            "params": [STATION_ID]
        }
        try:
            r = requests.post(url, headers=headers, json=payload, timeout=5.0)
            latency_ms = int((time.time() - start) * 1000)
            if r.status_code == 200 and r.json().get("success"):
                return True, f"D1 {latency_ms}ms"
        except Exception:
            pass

    # 2. Server Proxy Heartbeat Fallback
    try:
        url = f"{SERVER_URL}/api/daemon/heartbeat"
        headers = {
            "X-Station-Token": STATION_TOKEN,
            "Content-Type": "application/json"
        }
        r = requests.post(url, headers=headers, json={"station_id": STATION_ID}, timeout=5.0)
        latency_ms = int((time.time() - start) * 1000)
        if r.status_code == 200 and r.json().get("success"):
            return True, f"Proxy {latency_ms}ms"
        return False, f"HTTP {r.status_code}"
    except Exception as e:
        return False, str(e)

# =============================================================================
# 3. CAMPUS WI-FI (NERIST / SOPHOS CYBEROAM) AUTO-LOGIN WATCHDOG
# =============================================================================
def check_internet_probe():
    """
    Checks if genuine external internet is reachable, or if traffic is being
    intercepted by the campus captive portal (HTTP 204 detection probe).
    Returns: (is_online: bool, reason: str)
      - (True, "ONLINE")
      - (False, "CAPTIVE_PORTAL")
      - (False, "NO_CONNECTION")
    """
    # 1. Probe HTTP 204 endpoint (standard captive portal detector)
    try:
        r = requests.get('http://connectivitycheck.gstatic.com/generate_204', timeout=3.0, allow_redirects=False)
        if r.status_code == 204:
            return True, "ONLINE"
        elif r.status_code in (301, 302, 303, 307) or '10.10.200.1' in r.text or 'httpclient' in r.text:
            return False, "CAPTIVE_PORTAL"
    except Exception:
        pass

    # 2. Probe direct DNS over TCP socket
    for host in ["1.1.1.1", "8.8.8.8"]:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(2.0)
            s.connect((host, 53))
            s.close()
            return True, "ONLINE"
        except Exception:
            continue

    # 3. Check if campus portal gateway is reachable
    try:
        r = requests.get(f"{CAMPUS_PORTAL_URL}/httpclient.html", timeout=2.0)
        if r.status_code == 200:
            return False, "CAPTIVE_PORTAL"
    except Exception:
        pass

    return False, "NO_CONNECTION"

def login_campus_portal():
    """
    Automatically authenticates with the NERIST Cyberoam / Sophos captive portal
    via HTTP POST to /login.xml. Restores internet connectivity in < 500ms.
    Returns: (success: bool, message: str)
    """
    if not CAMPUS_PORTAL_ENABLED or not CAMPUS_WIFI_USER or not CAMPUS_WIFI_PASS:
        return False, "Portal credentials not configured in daemon/.env"

    try:
        t_ms = int(time.time() * 1000)
        payload = {
            'mode': '191',
            'username': CAMPUS_WIFI_USER,
            'password': CAMPUS_WIFI_PASS,
            'a': str(t_ms),
            'producttype': '0'
        }
        r = requests.post(f"{CAMPUS_PORTAL_URL}/login.xml", data=payload, timeout=5.0)
        if r.status_code == 200:
            try:
                root = ET.fromstring(r.text)
                status = root.findtext('status', default='').strip()
                msg = root.findtext('message', default='').strip()
                if status == 'LIVE':
                    return True, f"Logged in ({CAMPUS_WIFI_USER})"
                elif status == 'LOGIN':
                    return False, f"Rejected: {msg or 'Invalid credentials'}"
                return True, f"{status}: {msg}"
            except Exception:
                if 'LIVE' in r.text or 'signed in' in r.text:
                    return True, f"Logged in ({CAMPUS_WIFI_USER})"
        return False, f"Portal HTTP {r.status_code}"
    except Exception as e:
        return False, f"Portal error: {e}"

def keepalive_campus_portal():
    """
    Sends periodic keepalive ping to the campus portal live endpoint.
    """
    if not CAMPUS_PORTAL_ENABLED or not CAMPUS_WIFI_USER:
        return
    try:
        t_ms = int(time.time() * 1000)
        url = f"{CAMPUS_PORTAL_URL}/live?mode=192&username={CAMPUS_WIFI_USER}&a={t_ms}&producttype=0"
        requests.get(url, timeout=3.0)
    except Exception:
        pass

CREATE_NO_WINDOW = 0x08000000 if sys.platform == 'win32' else 0

# In-memory Win32 process enumeration (prevents console creation and screen flicker)
TH32CS_SNAPPROCESS = 0x00000002
if sys.platform == 'win32':
    from ctypes import wintypes
    class PROCESSENTRY32(ctypes.Structure):
        _fields_ = [
            ('dwSize', wintypes.DWORD),
            ('cntUsage', wintypes.DWORD),
            ('th32ProcessID', wintypes.DWORD),
            ('th32DefaultHeapID', ctypes.c_size_t),
            ('th32ModuleID', wintypes.DWORD),
            ('cntThreads', wintypes.DWORD),
            ('th32ParentProcessID', wintypes.DWORD),
            ('pcPriClassBase', wintypes.LONG),
            ('dwFlags', wintypes.DWORD),
            ('szExeFile', ctypes.c_char * 260)
        ]

def is_process_running(process_name):
    if sys.platform != 'win32':
        return False
    try:
        hSnapshot = ctypes.windll.kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
        if hSnapshot == -1:
            return False
        entry = PROCESSENTRY32()
        entry.dwSize = ctypes.sizeof(PROCESSENTRY32)
        p_name_lower = process_name.lower().encode('utf-8')
        try:
            success = ctypes.windll.kernel32.Process32First(hSnapshot, ctypes.byref(entry))
            while success:
                if entry.szExeFile.lower() == p_name_lower:
                    return True
                success = ctypes.windll.kernel32.Process32Next(hSnapshot, ctypes.byref(entry))
            return False
        finally:
            ctypes.windll.kernel32.CloseHandle(hSnapshot)
    except Exception:
        return False

def get_wifi_interface_info():
    """
    Returns (state, connected_ssid, connected_profile) from netsh wlan show interfaces.
    """
    if sys.platform != 'win32':
        return "unknown", None, None
    try:
        res = subprocess.run(
            ["netsh", "wlan", "show", "interfaces"],
            capture_output=True,
            text=True,
            timeout=5,
            creationflags=CREATE_NO_WINDOW
        )
        state = None
        ssid = None
        profile = None
        for line in res.stdout.splitlines():
            line_strip = line.strip()
            if line_strip.startswith("State") and ":" in line_strip:
                state = line_strip.split(":", 1)[1].strip().lower()
            elif line_strip.startswith("SSID") and not line_strip.startswith("BSSID") and ":" in line_strip:
                ssid = line_strip.split(":", 1)[1].strip()
            elif line_strip.startswith("Profile") and ":" in line_strip:
                profile = line_strip.split(":", 1)[1].strip()
        return state or "unknown", ssid, profile
    except Exception:
        return "error", None, None

def auto_reconnect_wifi(target_profile=TARGET_WIFI_PROFILE):
    """
    Actively checks and only reconnects if completely disconnected.
    If already connected to ANY Wi-Fi network (mobile hotspot, home, etc.), leaves it untouched!
    """
    if sys.platform != 'win32':
        return False, "Non-Windows OS"
    
    try:
        state, current_ssid, current_profile = get_wifi_interface_info()
        
        # If already connected to ANY Wi-Fi network, DO NOT disconnect or force-switch!
        if state == "connected":
            active_net = current_profile or current_ssid or "Active Wi-Fi"
            return True, f"Connected ({active_net})"
        
        print(f"[Wi-Fi Watchdog] Wi-Fi is '{state}'. Searching and connecting to '{target_profile}'...")
        
        # 1. Ensure WLAN interface is enabled
        try:
            subprocess.run(
                ["netsh", "interface", "set", "interface", "name=Wi-Fi", "admin=ENABLED"],
                capture_output=True,
                timeout=3,
                creationflags=CREATE_NO_WINDOW
            )
        except Exception:
            pass

        # 2. Trigger scan by querying available networks
        try:
            subprocess.run(
                ["netsh", "wlan", "show", "networks"],
                capture_output=True,
                timeout=5,
                creationflags=CREATE_NO_WINDOW
            )
        except Exception:
            pass
            
        # 3. Request connection to the target profile
        cmd = ["netsh", "wlan", "connect"]
        if target_profile:
            cmd.append(f"name={target_profile}")
        subprocess.run(cmd, capture_output=True, text=True, timeout=8, creationflags=CREATE_NO_WINDOW)
        
        # 4. Wait up to 10 seconds for association
        for _ in range(10):
            time.sleep(1)
            state, current_ssid, current_profile = get_wifi_interface_info()
            if state == "connected":
                return True, f"Connected to {current_profile or target_profile}"
        
        return False, f"Timeout connecting to {target_profile} (state: {state})"
    except Exception as e:
        return False, f"Wi-Fi reconnect error: {e}"

# =============================================================================
# 4. SERVICE MONITOR & AUTO-HEAL
# =============================================================================
_PRINT_DAEMON_PROC = None

def is_process_running(proc_name):
    """Checks if a process name or script is running via tasklist."""
    if sys.platform != 'win32':
        return False
    try:
        res = subprocess.run(
            ["tasklist", "/fi", f"imagename eq {proc_name}"],
            capture_output=True,
            text=True,
            timeout=3,
            creationflags=CREATE_NO_WINDOW
        )
        return proc_name.lower() in res.stdout.lower()
    except Exception:
        return False

def is_pid_alive(pid):
    """Check if process ID is currently alive via Windows kernel32 OpenProcess."""
    if not pid or sys.platform != 'win32':
        return False
    try:
        kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
        h = kernel32.OpenProcess(0x1000, False, int(pid))
        if h:
            kernel32.CloseHandle(h)
            return True
    except Exception:
        pass
    return False

def is_port_open(port):
    """Fast socket probe to check if a local daemon server is active."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.4)
            return s.connect_ex(('127.0.0.1', port)) == 0
    except Exception:
        return False

def check_service_status(service_name):
    """Checks if a Windows background service or process is alive."""
    global _PRINT_DAEMON_PROC
    if sys.platform != 'win32':
        return "UNKNOWN"
    try:
        if service_name == "PrintKuroxDaemon":
            if _PRINT_DAEMON_PROC is not None and _PRINT_DAEMON_PROC.poll() is None:
                return "RUNNING"
            # Check PID file
            pid_file = os.path.join(BASE_DIR, 'printer_daemon.pid')
            if os.path.exists(pid_file):
                try:
                    with open(pid_file, 'r') as pf:
                        saved_pid = int(pf.read().strip())
                    if is_pid_alive(saved_pid):
                        return "RUNNING"
                except Exception:
                    pass
            # Check local preview server port 7250
            if is_port_open(7250):
                return "RUNNING"
            if is_process_running("PrintKurox_Daemon.exe"):
                return "RUNNING"
            return "STANDBY"
        res = subprocess.run(
            ["sc", "query", service_name],
            capture_output=True,
            text=True,
            timeout=3,
            creationflags=CREATE_NO_WINDOW
        )
        if "RUNNING" in res.stdout:
            return "RUNNING"
        elif "STOPPED" in res.stdout:
            return "STOPPED"
        elif "does not exist" in res.stdout or "1060" in res.stdout:
            return "OPTIONAL" if service_name == "PrintKuroxWhatsAppBot" else "STANDBY"
        return "INACTIVE"
    except Exception:
        return "CHECK_ERROR"

shared_status = {
    'hb_success': True,
    'hb_info': 'Connecting...',
    'portal_status': f"Configured ({CAMPUS_WIFI_USER})" if CAMPUS_WIFI_USER else "Disabled",
    'has_internet': True,
    'heartbeat_count': 0,
    'svc_print': 'RUNNING',
    'last_time': datetime.now().strftime("%I:%M:%S %p")
}
status_lock = threading.Lock()
watchdog_running = True

def ensure_services_running():
    """Checks and restarts services if they are stopped."""
    global _PRINT_DAEMON_PROC
    status_print = check_service_status("PrintKuroxDaemon")
    status_wa = check_service_status("PrintKuroxWhatsAppBot")

    if status_print != "RUNNING":
        daemon_py = os.path.join(BASE_DIR, "printer_daemon.py")
        daemon_exe = os.path.join(BASE_DIR, "dist_romen", "PrintKurox_Daemon.exe")
        
        # 1. PRIMARY: Always run printer_daemon.py via pythonw (latest code, zero window flashing)
        if os.path.exists(daemon_py):
            for py_cmd in ["pythonw.exe", "pythonw", "python.exe", "python"]:
                try:
                    _PRINT_DAEMON_PROC = subprocess.Popen(
                        [py_cmd, daemon_py],
                        cwd=BASE_DIR,
                        creationflags=CREATE_NO_WINDOW if os.name == 'nt' else 0
                    )
                    status_print = "RUNNING"
                    break
                except Exception:
                    continue
        elif os.path.exists(daemon_exe):
            try:
                _PRINT_DAEMON_PROC = subprocess.Popen(
                    [daemon_exe],
                    cwd=os.path.dirname(daemon_exe),
                    creationflags=CREATE_NO_WINDOW if os.name == 'nt' else 0
                )
                status_print = "RUNNING"
            except Exception:
                pass

    return status_print, status_wa

def watchdog_worker():
    global watchdog_running
    set_windows_anti_sleep(True)
    wifi_ok, wifi_msg = auto_reconnect_wifi(TARGET_WIFI_PROFILE)

    has_internet, net_reason = check_internet_probe()
    if net_reason == "CAPTIVE_PORTAL":
        login_campus_portal()

    heartbeat_count = 0
    fail_count = 0
    portal_status_msg = f"Configured ({CAMPUS_WIFI_USER})" if CAMPUS_WIFI_USER else "Disabled"
    last_portal_ping = 0
    last_converter_ping = 0

    while watchdog_running:
        # Keep cloud DOCX converter on Render warm (every 8 minutes)
        if time.time() - last_converter_ping > 480:
            try:
                requests.get("https://printkurox-converter.onrender.com/health", timeout=4.0)
                last_converter_ping = time.time()
            except Exception:
                pass
        try:
            has_internet, net_reason = check_internet_probe()
            if net_reason == "CAPTIVE_PORTAL":
                portal_status_msg = "Logging in to Campus Portal..."
                ok, msg = login_campus_portal()
                portal_status_msg = msg
                time.sleep(1)
                has_internet, net_reason = check_internet_probe()
            elif net_reason == "NO_CONNECTION":
                fail_count += 1
                portal_status_msg = f"Reconnecting to {TARGET_WIFI_PROFILE}..."
                wifi_ok, reconn_msg = auto_reconnect_wifi(TARGET_WIFI_PROFILE)
                if wifi_ok:
                    fail_count = 0
                    time.sleep(1)
                    has_internet, net_reason = check_internet_probe()
                    if net_reason == "CAPTIVE_PORTAL":
                        portal_status_msg = "Logging in to Campus Portal..."
                        ok, msg = login_campus_portal()
                        portal_status_msg = msg
                        time.sleep(1)
                        has_internet, net_reason = check_internet_probe()
                else:
                    portal_status_msg = reconn_msg
            else:
                fail_count = 0
                portal_status_msg = f"Authenticated ({CAMPUS_WIFI_USER})"
                if time.time() - last_portal_ping > 90:
                    keepalive_campus_portal()
                    last_portal_ping = time.time()

            hb_success, hb_info = send_d1_heartbeat()
            if hb_success:
                heartbeat_count += 1

            svc_print, svc_wa = ensure_services_running()

            with status_lock:
                shared_status['hb_success'] = hb_success
                shared_status['hb_info'] = hb_info
                shared_status['portal_status'] = portal_status_msg
                shared_status['has_internet'] = has_internet
                shared_status['heartbeat_count'] = heartbeat_count
                shared_status['svc_print'] = svc_print
                shared_status['last_time'] = datetime.now().strftime("%I:%M:%S %p")

        except Exception as ex:
            print("Watchdog loop notice:", ex)

        time.sleep(10)


class StationMonitorApp:
    def __init__(self, root, start_minimized=False):
        self.root = root
        self.root.title("PrintKurox Station Monitor")
        self.root.geometry("480x490")
        self.root.resizable(False, False)

        if os.path.exists(ICON_PATH):
            try:
                self.root.iconbitmap(ICON_PATH)
            except Exception:
                pass

        self.style = ttk.Style(self.root)
        self.style.theme_use('vista' if 'vista' in self.style.theme_names() else 'clam')
        self.style.configure(".", font=("Segoe UI", 9))
        self.style.configure("Header.TLabel", font=("Segoe UI", 12, "bold"))
        self.style.configure("SubHeader.TLabel", font=("Segoe UI", 9))
        self.style.configure("StatusOnline.TLabel", font=("Segoe UI", 10, "bold"), foreground="#16a34a")
        self.style.configure("StatusOffline.TLabel", font=("Segoe UI", 10, "bold"), foreground="#dc2626")
        self.style.configure("Accent.TButton", font=("Segoe UI", 9, "bold"))

        self.root.protocol("WM_DELETE_WINDOW", self.hide_to_tray)

        self._build_ui()
        self._setup_tray()

        if start_minimized:
            self.root.withdraw()

        self.root.after(1000, self._periodic_ui_update)

    def _build_ui(self):
        container = ttk.Frame(self.root, padding=20)
        container.pack(fill="both", expand=True)

        hdr_frame = ttk.Frame(container)
        hdr_frame.pack(fill="x", pady=(0, 10))

        self.lbl_station_name = ttk.Label(
            hdr_frame,
            text=f"{STATION_NAME}",
            style="Header.TLabel"
        )
        self.lbl_station_name.pack(anchor="w")

        lbl_sub = ttk.Label(
            hdr_frame,
            text="Autonomous Always-Online Watchdog & Print Dispatcher",
            style="SubHeader.TLabel"
        )
        lbl_sub.pack(anchor="w")

        cards_frame = ttk.LabelFrame(container, text=" Live Station Telemetry ", padding=14)
        cards_frame.pack(fill="both", expand=True, pady=(0, 12))

        ttk.Label(cards_frame, text="Cloud Status:", font=("Segoe UI", 9, "bold")).grid(row=0, column=0, sticky="w", pady=4)
        self.lbl_web_status = ttk.Label(cards_frame, text="● Connecting...", style="StatusOnline.TLabel")
        self.lbl_web_status.grid(row=0, column=1, sticky="w", padx=(10, 0), pady=4)

        ttk.Label(cards_frame, text="Cloud Heartbeat:", font=("Segoe UI", 9, "bold")).grid(row=1, column=0, sticky="w", pady=4)
        self.lbl_heartbeat = ttk.Label(cards_frame, text="Syncing...", font=("Segoe UI", 9))
        self.lbl_heartbeat.grid(row=1, column=1, sticky="w", padx=(10, 0), pady=4)

        ttk.Label(cards_frame, text="Campus Wi-Fi:", font=("Segoe UI", 9, "bold")).grid(row=2, column=0, sticky="w", pady=4)
        self.lbl_wifi = ttk.Label(cards_frame, text=f"Checking ({TARGET_WIFI_PROFILE})...", font=("Segoe UI", 9))
        self.lbl_wifi.grid(row=2, column=1, sticky="w", padx=(10, 0), pady=4)

        ttk.Label(cards_frame, text="Print Dispatcher:", font=("Segoe UI", 9, "bold")).grid(row=3, column=0, sticky="w", pady=4)
        self.lbl_daemon = ttk.Label(cards_frame, text="Active", font=("Segoe UI", 9))
        self.lbl_daemon.grid(row=3, column=1, sticky="w", padx=(10, 0), pady=4)

        ttk.Label(cards_frame, text="Laptop Power:", font=("Segoe UI", 9, "bold")).grid(row=4, column=0, sticky="w", pady=4)
        self.lbl_power = ttk.Label(cards_frame, text="Anti-Sleep Mode (Active 24/7)", font=("Segoe UI", 9))
        self.lbl_power.grid(row=4, column=1, sticky="w", padx=(10, 0), pady=4)

        ttk.Label(cards_frame, text="Sync Statistics:", font=("Segoe UI", 9, "bold")).grid(row=5, column=0, sticky="w", pady=4)
        self.lbl_stats = ttk.Label(cards_frame, text="0 heartbeats sent", font=("Segoe UI", 8, "italic"))
        self.lbl_stats.grid(row=5, column=1, sticky="w", padx=(10, 0), pady=4)

        tip_frame = ttk.Frame(container)
        tip_frame.pack(fill="x", pady=(0, 14))
        lbl_tip = ttk.Label(
            tip_frame,
            text="💡 Tip: Clicking [X] will minimize this station to the Windows System Tray near the clock without disconnecting.",
            font=("Segoe UI", 8, "italic"),
            wraplength=440
        )
        lbl_tip.pack(anchor="w")

        btn_frame = ttk.Frame(container)
        btn_frame.pack(fill="x", side="bottom")

        btn_hide = ttk.Button(btn_frame, text="Minimize to Tray", command=self.hide_to_tray)
        btn_hide.pack(side="left", expand=True, fill="x", padx=(0, 4))

        btn_info = ttk.Button(btn_frame, text="📄 View Login Info", command=self.open_login_info)
        btn_info.pack(side="left", expand=True, fill="x", padx=(4, 4))

        btn_dash = ttk.Button(btn_frame, text="🌐 Open Admin Portal", style="Accent.TButton", command=self.open_dashboard)
        btn_dash.pack(side="right", expand=True, fill="x", padx=(4, 0))

    def _setup_tray(self):
        try:
            if os.path.exists(ICON_PATH):
                tray_img = Image.open(ICON_PATH)
            else:
                tray_img = Image.new('RGB', (64, 64), color=(34, 197, 94))

            def _show_action(icon, item):
                self.show_from_tray()

            def _hide_action(icon, item):
                self.hide_to_tray()

            def _dash_action(icon, item):
                self.open_dashboard()

            def _info_action(icon, item):
                self.open_login_info()

            def _exit_action(icon, item):
                self.root.after(0, self.confirm_exit)

            menu = pystray.Menu(
                pystray.MenuItem("Open Status Monitor", _show_action, default=True),
                pystray.MenuItem("Open Admin Dashboard", _dash_action),
                pystray.MenuItem("Open Login Info (LOGIN_INFO.txt)", _info_action),
                pystray.MenuItem("Minimize to Tray", _hide_action),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Exit & Stop Station", _exit_action)
            )

            self.tray_icon = pystray.Icon(
                "PrintKuroxStation",
                tray_img,
                f"PrintKurox - {STATION_NAME} [ONLINE]",
                menu
            )
            self.tray_icon.run_detached()
        except Exception as e:
            print("Notice setting up system tray:", e)
            self.tray_icon = None

    def hide_to_tray(self):
        self.root.withdraw()
        if self.tray_icon:
            try:
                self.tray_icon.notify(
                    "PrintKurox is running in the background.\nDouble-click the tray icon near the clock to open.",
                    f"{STATION_NAME} Active"
                )
            except Exception:
                pass

    def show_from_tray(self):
        self.root.after(0, lambda: (self.root.deiconify(), self.root.lift(), self.root.focus_force()))

    def open_dashboard(self):
        dash_url = f"{SERVER_URL}/admin/{STATION_ID}?token={STATION_TOKEN}"
        try:
            subprocess.Popen(["cmd.exe", "/c", "start", "", dash_url], shell=True)
        except Exception:
            try:
                import webbrowser
                webbrowser.open(dash_url)
            except Exception:
                pass

    def open_login_info(self):
        possible_paths = [
            os.path.join(ROOT_DIR, "LOGIN_INFO.txt"),
            os.path.join(BASE_DIR, "LOGIN_INFO.txt"),
            os.path.join(ROOT_DIR, "LOGIN_INFO.TXT"),
        ]
        for p in possible_paths:
            if os.path.exists(p):
                try:
                    subprocess.Popen(["notepad.exe", p])
                    return
                except Exception:
                    pass

    def confirm_exit(self):
        confirm = messagebox.askyesno(
            "Exit PrintKurox Station",
            "Stopping PrintKurox will take this print station offline on campus.\n\n"
            "Students will no longer be able to send print jobs to this machine.\n\n"
            "Are you sure you want to stop?",
            parent=self.root
        )
        if confirm:
            global watchdog_running
            watchdog_running = False
            if self.tray_icon:
                try: self.tray_icon.stop()
                except Exception: pass
            set_windows_anti_sleep(False)
            self.root.destroy()
            sys.exit(0)

    def _periodic_ui_update(self):
        with status_lock:
            st = dict(shared_status)

        if st.get('hb_success'):
            self.lbl_web_status.config(text="● ONLINE (Always Connected)", style="StatusOnline.TLabel")
            self.lbl_heartbeat.config(text=f"✓ OK ({st.get('hb_info', 'D1')})", foreground="#16a34a")
        else:
            self.lbl_web_status.config(text="● Connecting...", style="StatusOffline.TLabel")
            self.lbl_heartbeat.config(text=f"Syncing... ({st.get('hb_info', '')})", foreground="#d97706")

        self.lbl_wifi.config(text=st.get('portal_status', 'Connected'))
        self.lbl_daemon.config(text=f"{st.get('svc_print', 'RUNNING')}")
        self.lbl_stats.config(
            text=f"{st.get('heartbeat_count', 0)} consecutive heartbeats · Last sync: {st.get('last_time', '--')}"
        )

        if self.tray_icon:
            try:
                status_word = "ONLINE" if st.get('hb_success') else "SYNCING"
                self.tray_icon.title = f"PrintKurox - {STATION_NAME} [{status_word}]"
            except Exception:
                pass

        self.root.after(1000, self._periodic_ui_update)


_APP_MUTEX = None

def main():
    global _APP_MUTEX
    if sys.platform == 'win32':
        ERROR_ALREADY_EXISTS = 183
        mutex_name = f"PrintKurox_Hostel_Keepalive_Mutex_{STATION_ID}"
        _APP_MUTEX = ctypes.windll.kernel32.CreateMutexW(None, False, mutex_name)
        if ctypes.windll.kernel32.GetLastError() == ERROR_ALREADY_EXISTS:
            # Another instance is already running! Bring existing window to front and exit
            try:
                hwnd = ctypes.windll.user32.FindWindowW(None, "PrintKurox Station Monitor")
                if hwnd:
                    ctypes.windll.user32.ShowWindow(hwnd, 9) # SW_RESTORE
                    ctypes.windll.user32.SetForegroundWindow(hwnd)
            except Exception:
                pass
            sys.exit(0)

    threading.Thread(target=watchdog_worker, daemon=True).start()

    root = tk.Tk()
    start_min = ("--minimized" in sys.argv) or ("--silent" in sys.argv)
    app = StationMonitorApp(root, start_minimized=start_min)
    root.mainloop()

if __name__ == '__main__':
    main()

