@echo off
echo ===================================================================
echo  Closing active language_server instances to ensure clean write...
echo ===================================================================
taskkill /F /IM language_server.exe >nul 2>&1
timeout /t 1 /nobreak >nul

echo.
echo Running TradeSpace Antigravity Conversation Repair...
python "%~dp0scripts\repair_antigravity_conversations.py"

echo.
echo Done! You can now start or switch back to Antigravity IDE.
echo All past TradeSpace conversations will appear in the left sidebar.
pause
