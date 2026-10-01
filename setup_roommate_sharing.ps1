# =============================================================================
# PrintKurox Secure Roommate Printer Sharing Setup (Full Fix)
# =============================================================================
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "     PrintKurox Secure Roommate Printer Sharing Setup       " -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# 1. Switch Network Category to Private (Allows printer discovery & sharing)
Write-Host "[1/6] Setting Wi-Fi network profile to Private..." -ForegroundColor Yellow
try {
    Get-NetConnectionProfile | Where-Object { $_.InterfaceAlias -like '*Wi-Fi*' -or $_.IPv4Connectivity -eq 'LocalNetwork' } | Set-NetConnectionProfile -NetworkCategory Private -ErrorAction SilentlyContinue
    Write-Host "[SUCCESS] Network profile set to Private." -ForegroundColor Green
} catch {
    Write-Host "[WARN] Could not set network profile: $_" -ForegroundColor Yellow
}

# 2. Fix PrintNightmare 0x0000011b (RpcAuthnLevelPrivacyEnabled = 0)
Write-Host "[2/6] Applying PrintNightmare fix (RpcAuthnLevelPrivacyEnabled = 0)..." -ForegroundColor Yellow
try {
    New-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Print' -Name 'RpcAuthnLevelPrivacyEnabled' -Value 0 -PropertyType DWORD -Force -ErrorAction SilentlyContinue | Out-Null
    Write-Host "[SUCCESS] RpcAuthnLevelPrivacyEnabled set to 0." -ForegroundColor Green
} catch {
    Write-Host "[WARN] Registry write failed: $_" -ForegroundColor Yellow
}

# 3. Allow Non-Admin Driver Installation (PointAndPrint 0x0000007c fix)
Write-Host "[3/6] Configuring Point and Print driver permissions..." -ForegroundColor Yellow
try {
    if (-not (Test-Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\Printers\PointAndPrint')) {
        New-Item -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\Printers\PointAndPrint' -Force | Out-Null
    }
    New-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\Printers\PointAndPrint' -Name 'RestrictDriverInstallationToAdministrators' -Value 0 -PropertyType DWORD -Force -ErrorAction SilentlyContinue | Out-Null
    Write-Host "[SUCCESS] Point and Print restrictions loosened for LAN clients." -ForegroundColor Green
} catch {
    Write-Host "[WARN] Point and print config warning: $_" -ForegroundColor Yellow
}

# 4. Enable File & Printer Sharing in Windows Firewall
Write-Host "[4/6] Enabling File and Printer Sharing in Windows Firewall..." -ForegroundColor Yellow
netsh advfirewall firewall set rule group="File and Printer Sharing" new enable=Yes | Out-Null
Enable-NetFirewallRule -DisplayGroup "File and Printer Sharing" -ErrorAction SilentlyContinue
Write-Host "[SUCCESS] Firewall rules enabled." -ForegroundColor Green

# 5. Create or Refresh Restricted Local User for Roommate
Write-Host "[5/6] Verifying Roommate user account..." -ForegroundColor Yellow
$UserName = "Roommate"
$UserPass = "PrintRoommate#29"
$SecurePass = ConvertTo-SecureString $UserPass -AsPlainText -Force

if (-not (Get-LocalUser -Name $UserName -ErrorAction SilentlyContinue)) {
    New-LocalUser -Name $UserName -Password $SecurePass -Description "PrintKurox Authorized Roommate Account" -PasswordNeverExpires -UserMayNotChangePassword
    Write-Host "[SUCCESS] Created restricted local user: $UserName" -ForegroundColor Green
} else {
    Set-LocalUser -Name $UserName -Password $SecurePass
    Write-Host "[SUCCESS] Local user $UserName active." -ForegroundColor Green
}

# 6. Share the EPSON Printer as 'EPSON_Hostel' & Restart Spooler
Write-Host "[6/6] Sharing 'EPSON L3210 Series' & restarting Print Spooler..." -ForegroundColor Yellow
Set-Printer -Name "EPSON L3210 Series" -Shared 1 -ShareName "EPSON_Hostel" -ErrorAction SilentlyContinue
Restart-Service -Name Spooler -Force -ErrorAction SilentlyContinue
Write-Host "[SUCCESS] Printer shared and spooler restarted." -ForegroundColor Green

# 7. Display Connection Info
$IP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -like '*Wi-Fi*' } | Select-Object -First 1).IPAddress
$HostName = $env:COMPUTERNAME

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host "             PRINTER SHARING IS CONFIGURED!                 " -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Host PC Name:    $HostName" -ForegroundColor White
Write-Host "Host IP Address: $IP" -ForegroundColor White
Write-Host "Share Name:      EPSON_Hostel" -ForegroundColor White
Write-Host "Username:        $UserName" -ForegroundColor White
Write-Host "Password:        $UserPass" -ForegroundColor White
Write-Host "============================================================`n" -ForegroundColor Cyan
