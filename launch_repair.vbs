Set UAC = CreateObject("Shell.Application")
UAC.ShellExecute "cmd.exe", "/c """ & "c:\Users\Devananda Wahengbam\Desktop\whatsappbot\restart_printer_spooler.bat" & """", "", "runas", 1
