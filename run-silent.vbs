Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
If Not fso.FileExists(scriptDir & "\start_watchdog.bat") Then
    scriptDir = "c:\Users\Devananda Wahengbam\Desktop\whatsappbot"
End If

WshShell.CurrentDirectory = scriptDir

q = Chr(34)
batPath = q & scriptDir & "\start_watchdog.bat" & q

WshShell.Run batPath, 0, False
