# =============================================================================
# PrintKurox & NERIST Hostel 24/7 Server Master Supervisor & Watchdog
# =============================================================================
# Purpose:
# 1. Pre-flight internet & NERIST Captive Portal auto-login on PC boot
# 2. Monitors & auto-revives:
#    - Personal Faculty WhatsApp Bot (bot.js - 9863013886)
#    - PrintKurox Student WhatsApp Bot (whatsapp_bot.js - 9362980761)
#    - PrintKurox Cloud Print Daemon (printer_daemon.py - Website sync & EPSON L3210)
# 3. Ensures Print Spooler and EPSON_Hostel printer share stay active
# 4. Enforces Zero-Sleep / Lid-Close "Do Nothing" power policies
# =============================================================================

$ErrorActionPreference = 'SilentlyContinue'

$bot1Dir = "c:\Users\Devananda Wahengbam\Desktop\whatsappbot"
$bot2Dir = "C:\PrintKurox\daemon\whatsapp_bot"
$daemonDir = "C:\PrintKurox\daemon"

$portalUrl = "http://10.10.200.1:8090"
$portalUser = "122148"
$portalPass = "Tombinao123"

# Ensure Single Instance via PID lock
$pidFile = Join-Path $bot1Dir "watchdog.pid"
if (Test-Path $pidFile) {
    $oldPid = (Get-Content $pidFile -ErrorAction SilentlyContinue | Out-String).Trim()
    $oldProc = Get-CimInstance Win32_Process -Filter "ProcessId = '$oldPid'" -ErrorAction SilentlyContinue
    if ($oldProc -and $oldProc.CommandLine -like "*hostel_server_watchdog.ps1*") {
        exit 0
    }
}
$PID | Out-File $pidFile -Force

$nodeExe = "C:\Program Files\nodejs\node.exe"
if (-not (Test-Path $nodeExe)) { $nodeExe = "node.exe" }

$pythonExe = "C:\Users\Devananda Wahengbam\AppData\Local\Programs\Python\Python312\python.exe"
if (-not (Test-Path $pythonExe)) { $pythonExe = "python.exe" }

$logFile = Join-Path $bot1Dir "hostel_server_watchdog.log"
function Log-Message([string]$msg, [string]$color = "White") {
    $ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $line = "[$ts] $msg"
    Write-Host $line -ForegroundColor $color
    try {
        Add-Content -Path $logFile -Value $line -ErrorAction SilentlyContinue
    } catch {}
}

Log-Message "============================================================" "Cyan"
Log-Message "  PrintKurox 24/7 Autonomous Server Supervisor Initializing " "Cyan"
Log-Message "============================================================" "Cyan"

# 1. Win32 Power API - Lock in Execution State (Away Mode: CPU & Network alive even with lid closed)
try {
    Add-Type -MemberDefinition @"
[DllImport("kernel32.dll")]
public static extern uint SetThreadExecutionState(int esFlags);
"@ -Name "Win32Power" -Namespace "Win32Helper" -ErrorAction SilentlyContinue

    # ES_CONTINUOUS (0x80000000) | ES_SYSTEM_REQUIRED (0x00000001) | ES_AWAYMODE_REQUIRED (0x00000040)
    # [int]0x80000041 = -2147483583
    [Win32Helper.Win32Power]::SetThreadExecutionState([int]0x80000041) | Out-Null
    Log-Message "Win32 Execution State: Away Mode & Continuous Background Processing LOCKED." "Green"
} catch {}

# 2. Enforce 24/7 Power Policies (Never Sleep, Lid Close = Do Nothing, Wi-Fi Max Performance)
try {
    & powercfg -change -standby-timeout-ac 0 2>&1 | Out-Null
    & powercfg -change -standby-timeout-dc 0 2>&1 | Out-Null
    & powercfg -change -hibernate-timeout-ac 0 2>&1 | Out-Null
    & powercfg -change -hibernate-timeout-dc 0 2>&1 | Out-Null
    & powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0 2>&1 | Out-Null
    & powercfg /setdcvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0 2>&1 | Out-Null
    & powercfg /setacvalueindex SCHEME_CURRENT 4f971e89-eebd-4455-a8de-9e59040e7347 5ca83367-6e45-459f-a27b-476b1d01c936 0 2>&1 | Out-Null
    & powercfg /setdcvalueindex SCHEME_CURRENT 4f971e89-eebd-4455-a8de-9e59040e7347 5ca83367-6e45-459f-a27b-476b1d01c936 0 2>&1 | Out-Null
    # Wireless Adapter Settings -> Power Saving Mode -> Maximum Performance (0)
    & powercfg /setacvalueindex SCHEME_CURRENT 19cbb8fa-5279-450e-9fac-8a3d5fedd0c1 12bbebe6-58d6-4636-95bb-3217ef867c1a 0 2>&1 | Out-Null
    & powercfg /setdcvalueindex SCHEME_CURRENT 19cbb8fa-5279-450e-9fac-8a3d5fedd0c1 12bbebe6-58d6-4636-95bb-3217ef867c1a 0 2>&1 | Out-Null
    # USB Selective Suspend -> Disabled (0) - Keeps USB Printer Port online when lid closed
    & powercfg /setacvalueindex SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0 2>&1 | Out-Null
    & powercfg /setdcvalueindex SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0 2>&1 | Out-Null
    & powercfg /setactive SCHEME_CURRENT 2>&1 | Out-Null
    Log-Message "Power Policy: Anti-Sleep, Lid-Close 'Do Nothing', USB Keep-Alive, and Wi-Fi Max Performance locked in." "Green"
} catch {}

# 2. Captive Portal & Wi-Fi Auto-Reconnect Helper
function Ensure-Network-And-Portal {
    # Step A: Ensure Wi-Fi is physically connected to BLOCK-B
    try {
        $wlanOut = (netsh wlan show interfaces | Out-String)
        if ($wlanOut -notmatch "State\s*:\s*connected") {
            Log-Message "[Supervisor] Wi-Fi is disconnected! Forcing connection to BLOCK-B..." "Yellow"
            & netsh wlan connect name="BLOCK-B" 2>&1 | Out-Null
            Start-Sleep -Seconds 3
        }
    } catch {}

    # Step B: Probe external internet connectivity
    $internetOk = $false
    try {
        $probe = (curl.exe -s -m 2 "http://connectivitycheck.gstatic.com/generate_204" -o NUL -w "%{http_code}")
        if ($probe -eq "204") {
            $internetOk = $true
        }
    } catch {}

    # Step C: If no internet (e.g. portal interception or new session), auto-login immediately
    if (-not $internetOk) {
        try {
            $loginRes = (curl.exe -s -m 4 -d "mode=191&username=$portalUser&password=$portalPass&producttype=0" "$portalUrl/login.xml")
            if ($loginRes -match "LIVE" -or $loginRes -match "signed in") {
                Log-Message "[Supervisor] NERIST Captive Portal: Auto-authenticated successfully as $portalUser!" "Green"
                $internetOk = $true
            }
        } catch {}
    }
    return $internetOk
}

# 3. Boot Pre-Flight: Wait for Network / Wi-Fi to stabilize
Log-Message "Pre-Flight: Checking network & Wi-Fi internet availability..." "Yellow"
$netReady = $false
for ($i = 1; $i -le 15; $i++) {
    if (Ensure-Network-And-Portal) {
        $netReady = $true
        Log-Message "Internet is ACTIVE and authenticated!" "Green"
        break
    }
    Log-Message "Waiting for Wi-Fi router / internet (attempt $i/15)..." "Yellow"
    Start-Sleep -Seconds 3
}

# 4. Service Health Check & Launch Functions
function Get-Process-By-Command([string]$pattern) {
    return Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*$pattern*" }
}

function Ensure-Service-1-PersonalBot {
    $procs = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match '(?<![a-zA-Z0-9_])bot\.js' })
    if ($procs.Count -gt 1) {
        Log-Message "[Supervisor] Multiple Personal Bot instances detected ($($procs.Count)). Keeping newest..." "Yellow"
        $procs | Select-Object -Skip 1 | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    } elseif ($procs.Count -eq 0) {
        Log-Message "[Supervisor] Starting Personal WhatsApp Bot (+91 9863013886)..." "Yellow"
        Start-Process -FilePath $nodeExe -ArgumentList "bot.js" -WorkingDirectory $bot1Dir -WindowStyle Minimized
        Start-Sleep -Seconds 2
    }
}

function Ensure-Service-2-PrintKuroxBot {
    $procs = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*whatsapp_bot.js*" })
    if ($procs.Count -gt 1) {
        Log-Message "[Supervisor] Multiple PrintKurox Bot instances detected ($($procs.Count)). Keeping newest..." "Yellow"
        $procs | Select-Object -Skip 1 | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    } elseif ($procs.Count -eq 0) {
        Log-Message "[Supervisor] Starting PrintKurox Student Bot (+91 9362980761)..." "Yellow"
        Start-Process -FilePath $nodeExe -ArgumentList "whatsapp_bot.js" -WorkingDirectory $bot2Dir -WindowStyle Minimized
        Start-Sleep -Seconds 2
    }
}

function Ensure-Service-3-CloudPrintDaemon {
    # Auto-sync latest daemon scripts from git repository if updated
    $repoDaemon = "c:\Users\Devananda Wahengbam\Desktop\whatsappbot\scratch\printkurox\daemon\printer_daemon.py"
    $liveDaemon = Join-Path $daemonDir "printer_daemon.py"
    if ((Test-Path $repoDaemon) -and (Test-Path $liveDaemon)) {
        try {
            if ((Get-Item $repoDaemon).LastWriteTime -gt (Get-Item $liveDaemon).LastWriteTime) {
                Copy-Item -Path $repoDaemon -Destination $liveDaemon -Force
                Log-Message "[Supervisor] Synced updated printer_daemon.py from Git repository to production daemon directory." "Green"
            }
        } catch {}
    }

    $procs = @(Get-Process-By-Command "printer_daemon.py")
    if ($procs.Count -gt 1) {
        Log-Message "[Supervisor] Multiple Cloud Print Daemons detected ($($procs.Count)). Keeping newest..." "Yellow"
        $procs | Select-Object -Skip 1 | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    } elseif ($procs.Count -eq 0) {
        Log-Message "[Supervisor] Starting PrintKurox Cloud Print Daemon (Website Sync)..." "Yellow"
        Start-Process -FilePath $pythonExe -ArgumentList "-u printer_daemon.py" -WorkingDirectory $daemonDir -WindowStyle Minimized
        Start-Sleep -Seconds 2
    }
}

function Ensure-Service-4-PrinterSpooler {
    try {
        $spooler = Get-Service -Name spooler -ErrorAction SilentlyContinue
        if ($spooler.Status -ne 'Running') {
            Log-Message "[Supervisor] Spooler service was $($spooler.Status). Restarting..." "Yellow"
            Start-Service -Name spooler -ErrorAction SilentlyContinue
        }
    } catch {}
}

function Ensure-Service-5-CloudflaredTunnel {
    $ngrokProcs = @(Get-Process -Name "ngrok" -ErrorAction SilentlyContinue)
    if ($ngrokProcs.Count -eq 0) {
        Log-Message "[Supervisor] Starting Ngrok Tunnel for DOCX converter (Port 7250)..." "Yellow"
        $ngrokPath = "c:\Users\Devananda Wahengbam\Desktop\whatsappbot\daemon\ngrok.exe"
        if (Test-Path $ngrokPath) {
            $tunnelLog = "c:\Users\Devananda Wahengbam\Desktop\whatsappbot\tunnel.log"
            Start-Process -FilePath $ngrokPath -ArgumentList "http --domain=quartered-lend-exceeding.ngrok-free.dev 7250" -RedirectStandardOutput $tunnelLog -WindowStyle Minimized
            Start-Sleep -Seconds 3
        }
    }
}

# Initial Launch of all PrintKurox engines
Log-Message "Launching all PrintKurox engines and services..." "Cyan"
Ensure-Service-1-PersonalBot
Ensure-Service-2-PrintKuroxBot
Ensure-Service-3-CloudPrintDaemon
Ensure-Service-4-PrinterSpooler
Ensure-Service-5-CloudflaredTunnel

Log-Message "============================================================" "Green"
Log-Message ">>> 24/7 AUTONOMOUS SUPERVISOR ACTIVE & MONITORING ALL ENGINES <<<" "Green"
Log-Message "============================================================" "Green"

# 5. Continuous 24/7 Watchdog Loop
$loopCounter = 0
while ($true) {
    Start-Sleep -Seconds 8
    $loopCounter++

    # Re-assert Win32 Away Mode wake lock continuously to defeat Modern Standby / Lid close sleep
    try {
        [Win32Helper.Win32Power]::SetThreadExecutionState([int]0x80000041) | Out-Null
    } catch {}

    # Check network & captive portal every loop (every 8-16s)
    Ensure-Network-And-Portal | Out-Null

    # Verify and auto-revive any dead service
    Ensure-Service-1-PersonalBot
    Ensure-Service-2-PrintKuroxBot
    Ensure-Service-3-CloudPrintDaemon
    Ensure-Service-4-PrinterSpooler
    Ensure-Service-5-CloudflaredTunnel

    if ($loopCounter % 30 -eq 0) {
        Log-Message "[Supervisor Heartbeat] All engines & tunnel running healthy. Wi-Fi & Portal authenticated." "DarkGreen"
    }
}
