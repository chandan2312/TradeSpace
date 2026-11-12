@echo off
setlocal enabledelayedexpansion
title TradeSpace VPS Autostart & 24/7 Resilience Installer

cd /d "%~dp0"
echo ============================================================
echo   TradeSpace Enterprise - 24/7 Autostart & Reboot Installer
echo ============================================================
echo.
echo This utility configures Windows to automatically start:
echo   1. MetaTrader 5 Terminal [terminal64.exe]
echo   2. TradeSpace MT5 Bridge [run_mt5.bat] on Port 8765
echo   3. TradeSpace Web Server [start.bat]   on Port 3000
echo.
echo Whenever your VPS or PC reboots, these 3 services will
echo immediately launch automatically in the background!
echo ============================================================
echo.

REM 1. Ensure logs directory exists
if not exist "%~dp0logs" (
    mkdir "%~dp0logs"
    echo [Setup] Created logs directory.
)

REM 2. Install to Windows Startup Folder (Interactive Desktop Session)
echo [Setup] Configuring Windows Startup folder...
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
if exist "!STARTUP_FOLDER!" (
    echo @echo off > "!STARTUP_FOLDER!\TradeSpace_Autostart.bat"
    echo cd /d "%~dp0" >> "!STARTUP_FOLDER!\TradeSpace_Autostart.bat"
    echo start "" "%~dp0autostart_all.bat" >> "!STARTUP_FOLDER!\TradeSpace_Autostart.bat"
    echo [Setup] Created launcher in Windows Startup folder:
    echo         !STARTUP_FOLDER!\TradeSpace_Autostart.bat
) else (
    echo [WARN] Windows Startup folder not found at %STARTUP_FOLDER%
)

REM 3. Register Windows Scheduled Task for Elevated ONLOGON
echo.
echo [Setup] Configuring Windows Scheduled Task [TradeSpace_Master_Autostart]...
set "TARGET_LAUNCHER=%~dp0autostart_all.bat"

schtasks /query /tn "TradeSpace_Master_Autostart" >nul 2>&1
if not errorlevel 1 (
    schtasks /delete /tn "TradeSpace_Master_Autostart" /f >nul 2>&1
)

schtasks /create /tn "TradeSpace_Master_Autostart" /tr "\"%TARGET_LAUNCHER%\"" /sc ONLOGON /rl HIGHEST /f >nul 2>&1
if not errorlevel 1 (
    echo [Setup] Successfully registered elevated Scheduled Task!
) else (
    echo [Setup] Registering standard user logon task...
    schtasks /create /tn "TradeSpace_Master_Autostart" /tr "\"%TARGET_LAUNCHER%\"" /sc ONLOGON /f >nul 2>&1
    if not errorlevel 1 (
        echo [Setup] Registered standard user Scheduled Task!
    ) else (
        echo [WARN] Scheduled Task registration skipped. Startup folder launcher will be used.
    )
)

REM 4. Check for MetaTrader 5 terminal
echo.
echo [Setup] Checking for MetaTrader 5 Terminal [terminal64.exe]...
set "FOUND_MT5="
if defined MT5_PATH if exist "!MT5_PATH!" set "FOUND_MT5=!MT5_PATH!"
if "!FOUND_MT5!"=="" if exist "C:\Program Files\MetaTrader 5\terminal64.exe" set "FOUND_MT5=C:\Program Files\MetaTrader 5\terminal64.exe"
if "!FOUND_MT5!"=="" if exist "C:\Program Files (x86)\MetaTrader 5\terminal64.exe" set "FOUND_MT5=C:\Program Files (x86)\MetaTrader 5\terminal64.exe"
if "!FOUND_MT5!"=="" (
    for /d %%D in ("C:\Program Files\*MetaTrader 5*") do (
        if exist "%%D\terminal64.exe" set "FOUND_MT5=%%D\terminal64.exe"
    )
)
if "!FOUND_MT5!"=="" (
    for /d %%D in ("C:\Program Files (x86)\*MetaTrader 5*") do (
        if exist "%%D\terminal64.exe" set "FOUND_MT5=%%D\terminal64.exe"
    )
)

if not "!FOUND_MT5!"=="" (
    echo [Setup] MetaTrader 5 located at: "!FOUND_MT5!"
) else (
    echo [NOTICE] MetaTrader 5 was not found in standard directories.
    echo          If installed in a custom location, set MT5_PATH in system environment variables.
)

echo.
echo ============================================================
echo [SUCCESS] Auto-Start Configuration Complete!
echo.
echo How the resilience system works:
echo   - After any reboot, Windows will automatically start MT5,
echo     run_mt5.bat (port 8765), and start.bat (port 3000).
echo   - If start.bat detects 5 rapid crashes in a row, it will
echo     automatically reboot Windows to clear memory/socket clogs.
echo   - To manually reboot the VPS cleanly at any time, run:
echo     reboot_vps.bat (or 'start.bat --reboot').
echo.
echo [IMPORTANT FOR VPS USERS]:
echo Ensure Windows AutoLogon is enabled so Windows logs in after
echo reboot without waiting for a password at the lock screen:
echo   Run: netplwiz  (and uncheck 'Users must enter a password')
echo   Or use Microsoft Sysinternals Autologon tool.
echo ============================================================
echo.
pause
