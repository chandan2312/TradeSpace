@echo off
setlocal
title TradeSpace - Emergency VPS Reboot Utility

echo ============================================================
echo   TradeSpace Enterprise - Emergency VPS Reboot Utility
echo ============================================================
echo.
echo WARNING: This will restart your Windows VPS!
echo.
echo Because TradeSpace Autostart is configured, Windows will reboot
echo and automatically start:
echo   1. MetaTrader 5 Terminal [terminal64.exe]
echo   2. MT5 Bridge Server     [run_mt5.bat]
echo   3. TradeSpace Web Server [start.bat]
echo.
echo Press Ctrl+C to abort, or press any key to reboot now...
pause >nul
echo.
echo [Reboot] Initiating graceful Windows reboot in 5 seconds...
shutdown /r /f /t 5
exit /b 0
