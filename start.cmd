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

REM 2. Check arguments for MT5 and Build
set "LAUNCH_MT5=0"
set "FORCE_BUILD=0"

for %%A in (%*) do (
    if "%%A"=="--with-mt5" set "LAUNCH_MT5=1"
    if "%%A"=="mt5" set "LAUNCH_MT5=1"
    if "%%A"=="--build" set "FORCE_BUILD=1"
    if "%%A"=="-b" set "FORCE_BUILD=1"
)

if "!LAUNCH_MT5!"=="1" (
    echo [Launcher] Spawning MT5 Bridge Server on port 8765 in background window...
    start "TradeSpace MT5 Bridge (Port 8765)" cmd /k "python mt5_server.py"
    timeout /t 2 /nobreak >nul
)

REM 3. Verify production build exists and is up to date (checks BUILD_ID and autonomous route)
set "NEED_BUILD=0"
if "!FORCE_BUILD!"=="1" set "NEED_BUILD=1"
if not exist ".next" set "NEED_BUILD=1"
if not exist ".next\BUILD_ID" set "NEED_BUILD=1"
if not exist ".next\server\app\autonomous\page.js" set "NEED_BUILD=1"

if "!NEED_BUILD!"=="1" (
    echo [Launcher] Compiling fresh Next.js production build (npm run build)...
    call npm run build
    if errorlevel 1 (
        echo [ERROR] Build failed! Please review errors above.
        pause
        exit /b 1
    )
    echo [Launcher] Production build completed successfully.
)

REM 4. Launch TradeSpace
echo [Launcher] Starting TradeSpace Server on port 3000...
node server.js
