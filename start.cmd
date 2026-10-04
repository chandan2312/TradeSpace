@echo off
setlocal enabledelayedexpansion

echo ============================================================
echo   TradeSpace Enterprise - Windows VPS Launcher
echo ============================================================

REM 1. Verify .env exists
if not exist ".env" (
    echo [ERROR] .env file not found!
    echo Please make sure .env is created in this directory.
    pause
    exit /b 1
)

REM 2. Check if user requested MT5 bridge via argument
set "LAUNCH_MT5=0"
if "%1"=="--with-mt5" set "LAUNCH_MT5=1"
if "%1"=="mt5" set "LAUNCH_MT5=1"
if "%2"=="--with-mt5" set "LAUNCH_MT5=1"

if "!LAUNCH_MT5!"=="1" (
    echo [Launcher] Spawning MT5 Bridge Server on port 8765 in background window...
    start "TradeSpace MT5 Bridge (Port 8765)" cmd /k "python mt5_server.py"
    timeout /t 2 /nobreak >nul
)

REM 3. Verify production build exists
if not exist ".next" (
    echo [Launcher] Production build (.next) not found.
    echo [Launcher] Running "npm run build" first...
    call npm run build
)

REM 4. Launch TradeSpace
echo [Launcher] Starting TradeSpace Server on port 3000...
node server.js
