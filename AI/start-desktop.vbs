Option Explicit
Dim shell, files, root, runtime, env, command
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root
Set env = shell.Environment("PROCESS")
runtime = shell.ExpandEnvironmentStrings("%USERPROFILE%") & "\.dsh\electron"
If env("ELECTRON_OVERRIDE_DIST_PATH") = "" And files.FileExists(runtime & "\electron.exe") Then
  env("ELECTRON_OVERRIDE_DIST_PATH") = runtime
End If
command = "node.exe " & Chr(34) & root & "\scripts\run-electron.mjs" & Chr(34) & " --quiet"
shell.Run command, 0, False
