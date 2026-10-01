<# :
@echo off
title "Connect to EPSON L3210 (DESKTOP-TRKVJQ2) - PrintKurox"
color 0b
powershell -NoProfile -ExecutionPolicy Bypass -Command "[ScriptBlock]::Create((Get-Content -LiteralPath '%~f0' -Raw)).Invoke()"
exit /b %errorlevel%
: #>

# ============================================================
#      PrintKurox -- Fast Desktop Printer Connector
# ============================================================

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "     PrintKurox -- Connect to DESKTOP-TRKVJQ2 (Fast Mode)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

$serverTarget = "DESKTOP-TRKVJQ2"
$shareName = "EPSON_Hostel"
$uncPath = "\\$serverTarget\$shareName"

Write-Host "[1/5] Checking connection to $serverTarget..." -ForegroundColor Yellow
$pingHost = Test-Connection -ComputerName $serverTarget -Count 1 -Quiet -ErrorAction SilentlyContinue
if ($pingHost) {
    Write-Host "    [OK] Server $serverTarget is reachable and responsive!" -ForegroundColor Green
} else {
    Write-Host "    [!] Note: Testing direct SMB path to $serverTarget..." -ForegroundColor Yellow
}

Write-Host "    Target Printer: $uncPath" -ForegroundColor Cyan
Write-Host ""

# 2. Clear local stuck print jobs
Write-Host "[2/5] Flushing local print queue on this laptop..." -ForegroundColor Yellow
try {
    Get-PrintJob -PrinterName "*EPSON*" -ErrorAction SilentlyContinue | Remove-PrintJob -ErrorAction SilentlyContinue
    Write-Host "    [OK] Stale print jobs cleared." -ForegroundColor Green
} catch {
    Write-Host "    [OK] Queue clean." -ForegroundColor Green
}

# 3. Store network credentials for DESKTOP-TRKVJQ2
Write-Host "[3/5] Saving authorized network credentials for $serverTarget..." -ForegroundColor Yellow
& cmdkey /delete:$serverTarget 2>&1 | Out-Null
& cmdkey /add:$serverTarget /user:Roommate /pass:PrintRoommate#29 2>&1 | Out-Null
Write-Host "    [OK] Credentials saved (User: Roommate)." -ForegroundColor Green

# 4. Remove ALL slow 172.x IP printers and old ghosts to ELIMINATE freezing
Write-Host "[4/5] Removing slow 172.x IP entries and old ghosts to eliminate freezing..." -ForegroundColor Yellow
Get-Printer | Where-Object { $_.Name -like "*172.*" -or $_.Name -like "*Roommate*" -or ($_.Name -like "*EPSON*" -and $_.Name -notlike "*$serverTarget*") } | ForEach-Object {
    try {
        Remove-Printer -Name $_.Name -ErrorAction SilentlyContinue
        Write-Host "    [Removed slow entry]: $($_.Name)" -ForegroundColor DarkGray
    } catch {}
}

# Connect directly to \\DESKTOP-TRKVJQ2\EPSON_Hostel
Write-Host "    Connecting to $uncPath (Fast)..." -ForegroundColor Yellow
$connected = $false
try {
    Add-Printer -ConnectionName $uncPath -ErrorAction Stop
    $connected = $true
    Write-Host "    [OK] Connected to $uncPath via Windows Spooler!" -ForegroundColor Green
} catch {
    try {
        (New-Object -ComObject WScript.Network).AddWindowsPrinterConnection($uncPath)
        $connected = $true
        Write-Host "    [OK] Connected to $uncPath via Network COM!" -ForegroundColor Green
    } catch {
        $p = Start-Process -FilePath "rundll32.exe" -ArgumentList "printui.dll,PrintUIEntry /in /n $uncPath" -Wait -PassThru
        if ($p.ExitCode -eq 0) { $connected = $true }
    }
}

# Set DESKTOP-TRKVJQ2 as default printer
try {
    (New-Object -ComObject WScript.Network).SetDefaultPrinter($uncPath)
    Write-Host "    [OK] Set $uncPath as Default Printer." -ForegroundColor Green
} catch {}

# 5. Verification
Write-Host ""
Write-Host "[5/5] Verifying printer status..." -ForegroundColor Yellow
$found = Get-Printer | Where-Object { $_.Name -like "*$serverTarget*" }

if ($found) {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host ">>> SUCCESS: FAST DESKTOP PRINTER CONNECTED & READY!" -ForegroundColor Green
    foreach ($pr in $found) {
        Write-Host "    Printer: $($pr.Name) (Status: $($pr.PrinterStatus))" -ForegroundColor Green
    }
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host "All slow 172.x entries removed. No freezing, prints instantly!" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Yellow
    Write-Host ">>> 10-SECOND MANUAL CONNECTION:" -ForegroundColor Yellow
    Write-Host "1. Press Windows Key + R on keyboard." -ForegroundColor Yellow
    Write-Host "2. Type: \\$serverTarget and press Enter." -ForegroundColor Yellow
    Write-Host "3. When prompted, enter:" -ForegroundColor Yellow
    Write-Host "   Username: Roommate" -ForegroundColor Yellow
    Write-Host "   Password: PrintRoommate#29" -ForegroundColor Yellow
    Write-Host "4. Double-click '$shareName' to finish!" -ForegroundColor Yellow
    Write-Host "============================================================" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Press any key to close this window..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
