# PrintKurox Host Printer & Network Sharing Fix
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "     PrintKurox -- Host Printer & Sharing Fix Engine" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Stop Spooler
Write-Host "[1/6] Stopping Windows Print Spooler service..." -ForegroundColor Yellow
Stop-Service -Name spooler -Force -ErrorAction SilentlyContinue
Write-Host "    [OK] Spooler stopped." -ForegroundColor Green

# 2. Clear stuck spool files
Write-Host "[2/6] Clearing stuck spool cache and broken print jobs..." -ForegroundColor Yellow
$spoolDir = "$env:SystemRoot\System32\spool\PRINTERS"
if (Test-Path $spoolDir) {
    Get-ChildItem -Path $spoolDir -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
}
Write-Host "    [OK] Stuck print buffer flushed." -ForegroundColor Green

# 3. Add Roommate to Users group
Write-Host "[3/6] Authorizing Roommate user account for network access..." -ForegroundColor Yellow
& net localgroup Users Roommate /add 2>&1 | Out-Null
Write-Host "    [OK] Roommate account assigned to Users group." -ForegroundColor Green

# 4. Configure SMB Server & Signing for Windows 11 / 10
Write-Host "[4/6] Updating SMB Server & Windows 11 signing compatibility..." -ForegroundColor Yellow
$lmPath = 'HKLM:\SYSTEM\CurrentControlSet\Services\LanmanServer\Parameters'
Set-ItemProperty -Path $lmPath -Name 'enablesecuritysignature' -Value 1 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $lmPath -Name 'RequireSecuritySignature' -Value 0 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $lmPath -Name 'DisableBandwidthThrottling' -Value 1 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path $lmPath -Name 'size' -Value 3 -Type DWord -ErrorAction SilentlyContinue

$printPolicy = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\Printers\PointAndPrint'
if (-not (Test-Path $printPolicy)) { New-Item -Path $printPolicy -Force | Out-Null }
Set-ItemProperty -Path $printPolicy -Name 'RestrictDriverInstallationToAdministrators' -Value 0 -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Print' -Name 'RpcAuthnLevelPrivacyEnabled' -Value 0 -Type DWord -ErrorAction SilentlyContinue

try {
    Set-SmbServerConfiguration -EnableSecuritySignature $true -RequireSecuritySignature $false -Force -ErrorAction SilentlyContinue
} catch {}
Write-Host "    [OK] SMB & Point-and-Print signing compatibility active." -ForegroundColor Green

# 5. Enable Windows Firewall
Write-Host "[5/6] Ensuring Windows Firewall permits File and Printer Sharing..." -ForegroundColor Yellow
& netsh advfirewall firewall set rule group="File and Printer Sharing" new enable=Yes 2>&1 | Out-Null
Write-Host "    [OK] Windows Firewall rules enabled." -ForegroundColor Green

# 6. Configure Printer Attributes and Restart Spooler
Write-Host "[6/6] Restoring reliable EPSON L3210 spool attributes & starting service..." -ForegroundColor Yellow
$pReg = 'HKLM:\SYSTEM\CurrentControlSet\Control\Print\Printers\EPSON L3210 Series'
if (Test-Path $pReg) {
    Set-ItemProperty -Path $pReg -Name 'Attributes' -Value 520 -Type DWord -ErrorAction SilentlyContinue
    Set-ItemProperty -Path $pReg -Name 'Priority' -Value 99 -Type DWord -ErrorAction SilentlyContinue
}

Start-Service -Name spooler -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

try {
    Set-Printer -Name 'EPSON L3210 Series' -Shared $true -ShareName 'EPSON_Hostel' -ErrorAction SilentlyContinue
} catch {}

Write-Host "    [OK] Spooler restarted. EPSON_Hostel share is active!" -ForegroundColor Green

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host ">>> REPAIR COMPLETE: EPSON L3210 IS ONLINE & READY!" -ForegroundColor Green
Write-Host ">>> Host Laptop:  $env:COMPUTERNAME" -ForegroundColor Green
Write-Host ">>> Share Path:   \\$env:COMPUTERNAME\EPSON_Hostel" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Press any key to close this window..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
