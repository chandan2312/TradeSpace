' ==============================================================================
' TradeSpace Enterprise - Silent Background Launcher (VBScript)
' Runs TradeSpace Web (port 3000) and MT5 Bridge (port 8765) completely in the background.
' ZERO terminal windows will stay open.
' ==============================================================================

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
strPath = fso.GetParentFolderName(WScript.ScriptFullName)

' Check if logs folder exists
If Not fso.FolderExists(strPath & "\logs") Then
    fso.CreateFolder(strPath & "\logs")
End If

' Check if PM2 is available
intPM2 = WshShell.Run("cmd /c where pm2", 0, True)

If intPM2 = 0 Then
    ' Start both via PM2 silently
    WshShell.Run "cmd /c cd /d """ & strPath & """ && pm2 start ecosystem.config.cjs", 0, True
Else
    ' Start MT5 Bridge in completely hidden background mode (0 = hidden)
    WshShell.Run "cmd /c cd /d """ & strPath & """ && chcp 65001 >nul && set PYTHONIOENCODING=utf-8 && python mt5_server.py --host 0.0.0.0 --port 8765 > logs\mt5-out.log 2> logs\mt5-error.log", 0, False
    WScript.Sleep 2000
    
    ' Start TradeSpace Web in completely hidden background mode (0 = hidden)
    WshShell.Run "cmd /c cd /d """ & strPath & """ && node --max-old-space-size=768 server.js > logs\tradespace-out.log 2> logs\tradespace-error.log", 0, False
End If

MsgBox "TradeSpace & MT5 Bridge are now running in the background!" & vbCrLf & vbCrLf & _
       "  TradeSpace Web: http://localhost:3000" & vbCrLf & _
       "  MT5 Bridge:     http://localhost:8765" & vbCrLf & vbCrLf & _
       "No terminal windows are open. Survives terminal closure." & vbCrLf & _
       "To check status, double-click status.bat" & vbCrLf & _
       "To stop services, double-click stop_all.bat", 64, "TradeSpace Enterprise"
