# PrintKurox Roommate Printer Connection Engine
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "     PrintKurox -- Roommate Printer Auto-Connect" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

$hostName = "DESKTOP-TRKVJQ2"
$fallbackIp = "172.17.2.232"
$shareName = "EPSON_Hostel"

Write-Host "[1/5] Detecting server on network..." -ForegroundColor Yellow

$serverTarget = $null

# Test hostname first
$pingHost = Test-Connection -ComputerName $hostName -Count 1 -Quiet -ErrorAction SilentlyContinue
if ($pingHost) {
    $serverTarget = $hostName
    Write-Host "    [OK] Host computer detected via name: $hostName" -ForegroundColor Green
} else {
    $pingIp = Test-Connection -ComputerName $fallbackIp -Count 1 -Quiet -ErrorAction SilentlyContinue
    if ($pingIp) {
        $serverTarget = $fallbackIp
        Write-Host "    [OK] Host computer detected via IP: $fallbackIp" -ForegroundColor Green
    } else {
        $serverTarget = $fallbackIp
        Write-Host ""
        Write-Host "    [!] WARNING: Cannot ping server ($hostName or $fallbackIp)." -ForegroundColor Red
        Write-Host "        Reason: Hostel Wi-Fi might have client isolation enabled." -ForegroundColor Yellow
        Write-Host "        QUICK FIX: Ask the host to turn on 'Mobile Hotspot', and connect your laptop to it!" -ForegroundColor Yellow
        Write-Host ""
    }
}

$uncPath = "\\$serverTarget\$shareName"
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

# 3. Store network credentials
Write-Host "[3/5] Saving authorized network credentials..." -ForegroundColor Yellow
& cmdkey /delete:$hostName 2>&1 | Out-Null
& cmdkey /delete:$fallbackIp 2>&1 | Out-Null
& cmdkey /add:$hostName /user:Roommate /pass:PrintRoommate#29 2>&1 | Out-Null
& cmdkey /add:$fallbackIp /user:Roommate /pass:PrintRoommate#29 2>&1 | Out-Null
Write-Host "    [OK] Credentials saved (User: Roommate)." -ForegroundColor Green

# 4. Remove broken old connection and connect fresh
Write-Host "[4/5] Connecting to shared printer $uncPath..." -ForegroundColor Yellow
try {
    Remove-Printer -Name $uncPath -ErrorAction SilentlyContinue
} catch {}

$connected = $false
try {
    Add-Printer -ConnectionName $uncPath -ErrorAction Stop
    $connected = $true
    Write-Host "    [OK] Connected via Windows Spooler!" -ForegroundColor Green
} catch {
    Write-Host "    [INFO] PowerShell Add-Printer: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "    [INFO] Launching Windows Print Wizard..." -ForegroundColor Yellow
    $p = Start-Process -FilePath "rundll32.exe" -ArgumentList "printui.dll,PrintUIEntry /in /n $uncPath" -Wait -PassThru
    if ($p.ExitCode -eq 0) {
        $connected = $true
    }
}

# 5. Verification
Write-Host ""
Write-Host "[5/5] Verifying printer connection status..." -ForegroundColor Yellow
$found = Get-Printer | Where-Object { $_.Name -like "*EPSON*" -or $_.Name -like "*Hostel*" }

if ($found) {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host ">>> SUCCESS: PRINTER IS CONNECTED AND READY TO PRINT!" -ForegroundColor Green
    foreach ($pr in $found) {
        Write-Host "    Printer: $($pr.Name) (Status: $($pr.PrinterStatus))" -ForegroundColor Green
    }
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host "You can now open any document and print to EPSON L3210!" -ForegroundColor Green
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
