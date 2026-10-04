@echo off
setlocal enabledelayedexpansion

echo ============================================================
echo        TRADESPACE ENTERPRISE QUANT TERMINAL (WINDOWS)
echo ============================================================

if not exist ".env" (
    echo [ERROR] .env file not found! Please create .env from .env.example.
    pause
    exit /b 1
)

:: Check if production build exists
if not exist ".next\BUILD_ID" (
    echo [INFO] Production build (.next) not found.
    echo [INFO] Running 'npm run build' before first start...
    call npm run build
    if errorlevel 1 (
        echo [ERROR] Build failed! Check errors above.
        pause
        exit /b 1
    )
)

:: Optional argument to also launch MT5 bridge in a companion window:
:: Usage: start.bat --with-mt5
set START_MT5=0
if "%1"=="--with-mt5" set START_MT5=1
if "%2"=="--with-mt5" set START_MT5=1

if "!START_MT5!"=="1" (
    echo [INFO] Launching MT5 Bridge Server in companion window...
    start "TradeSpace MT5 Bridge" cmd /k "python mt5_server.py"
)

echo [INFO] Starting TradeSpace Server on port 3000...
node server.js
