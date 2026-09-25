Set WshShell = CreateObject("WScript.Shell")
scriptDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = scriptDir
batchPath = scriptDir & "\start-bot.bat"
' 0 hides the window completely, False allows it to run asynchronously
WshShell.Run Chr(34) & batchPath & Chr(34), 0, False
