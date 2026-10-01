$botDir = "c:\Users\Devananda Wahengbam\Desktop\whatsappbot"
$vbsSource = "$botDir\run-silent.vbs"
$startupFolder = [System.Environment]::GetFolderPath('Startup')
$vbsTarget = "$startupFolder\NERIST_WhatsApp_Bot.vbs"

# 1. Copy to Startup folder
Copy-Item -Path $vbsSource -Destination $vbsTarget -Force
Write-Host "[OK] Added to Startup Folder: $vbsTarget"

# 2. Register Scheduled Task
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbsSource`"" -WorkingDirectory $botDir
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 365)
Register-ScheduledTask -TaskName 'NERIST_WhatsApp_Bot' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "[OK] Registered Windows Scheduled Task: NERIST_WhatsApp_Bot"

# 3. Power settings (Never Sleep, Lid Close = Do Nothing, Wi-Fi Maximum Performance)
powercfg -change -standby-timeout-ac 0
powercfg -change -standby-timeout-dc 0
powercfg -change -hibernate-timeout-ac 0
powercfg -change -hibernate-timeout-dc 0
powercfg -change -monitor-timeout-ac 5
powercfg -setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
powercfg -setdcvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
powercfg /setacvalueindex SCHEME_CURRENT 4f971e89-eebd-4455-a8de-9e59040e7347 5ca83367-6e45-459f-a27b-476b1d01c936 0
powercfg /setdcvalueindex SCHEME_CURRENT 4f971e89-eebd-4455-a8de-9e59040e7347 5ca83367-6e45-459f-a27b-476b1d01c936 0
powercfg /setacvalueindex SCHEME_CURRENT 19cbb8fa-5279-450e-9fac-8a3d5fedd0c1 12bbebe6-58d6-4636-95bb-3217ef867c1a 0
powercfg /setdcvalueindex SCHEME_CURRENT 19cbb8fa-5279-450e-9fac-8a3d5fedd0c1 12bbebe6-58d6-4636-95bb-3217ef867c1a 0
# USB Selective Suspend = Disabled (Prevents USB printer from going offline when lid is closed)
powercfg /setacvalueindex SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0
powercfg /setdcvalueindex SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0
powercfg -SetActive SCHEME_CURRENT
Write-Host "[OK] 24/7 Power Plan Configured: Sleep NEVER, Lid Close DO NOTHING, USB Active ALWAYS, Wi-Fi Max Performance."
