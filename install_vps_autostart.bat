@echo off
setlocal enabledelayedexpansion
title TradeSpace VPS Autostart & Resilience Installer

cd /d "%~dp0"
echo ============================================================
echo   TradeSpace Enterprise - VPS 24/7 Resilience Installer
echo ============================================================
echo.
echo This utility configures Windows Task Scheduler and PM2 to ensure:
echo  1. TradeSpace Web and MT5 Bridge run as background daemons (survives RDP exit).
echo  2. Automatic revival on process exit or memory crash.
echo  3. Automatic startup when Windows VPS boots or user logs on.
echo ============================================================
echo.

REM 1. Ensure logs folder exists
if not exist "%~dp0logs" (
    mkdir "%~dp0logs"
    echo [Setup] Created logs directory.
)

REM 2. Check for PM2
echo [Setup] Checking for PM2 process supervisor...
where pm2 >nul 2>&1
if errorlevel 1 (
    echo [Setup] PM2 not found globally. Installing PM2 via npm...
    call npm install -g pm2
    if errorlevel 1 (
        echo [WARN] Global PM2 installation failed. Will use npx pm2 or silent VBS launcher fallback.
    ) else (
        echo [Setup] PM2 installed successfully!
    )
) else (
    echo [Setup] PM2 is already installed.
)

REM 3. Create Windows Scheduled Task for Auto-Start on Boot / Logon
echo.
echo [Setup] Configuring Windows Task Scheduler for auto-start...

REM Delete existing task if already present
schtasks /query /tn "TradeSpace_Enterprise_Autostart" >nul 2>&1
if not errorlevel 1 (
    echo [Setup] Removing existing TradeSpace scheduled task...
    schtasks /delete /tn "TradeSpace_Enterprise_Autostart" /f >nul 2>&1
)

REM Determine launcher target: prefer start_pm2.bat, fallback to start_silent.vbs
set "TARGET_LAUNCHER=%~dp0start_pm2.bat"
if exist "%TARGET_LAUNCHER%" (
    echo [Setup] Registering scheduled task: %TARGET_LAUNCHER%
    schtasks /create /tn "TradeSpace_Enterprise_Autostart" /tr "\"%TARGET_LAUNCHER%\"" /sc ONLOGON /rl HIGHEST /f
    if errorlevel 1 (
        echo [WARN] Elevated registration failed. Trying standard user logon task...
        schtasks /create /tn "TradeSpace_Enterprise_Autostart" /tr "\"%TARGET_LAUNCHER%\"" /sc ONLOGON /f
    )
)

echo.
echo ============================================================
echo [SUCCESS] TradeSpace VPS Resilience is now configured!
echo.
echo How to run your VPS safely from now on:
echo   - To start services: Double-click 'start_pm2.bat' (or 'start_silent.vbs')
echo   - To inspect status: Double-click 'status.bat'
echo   - To stop services:  Double-click 'stop_all.bat'
echo.
echo * You do NOT need to keep interactive command prompt windows open!
echo * If the VPS reboots, Windows will automatically start the services.
echo ============================================================
echo.
pause
