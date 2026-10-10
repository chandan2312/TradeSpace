@echo off
title TradeSpace Web Server (Port 3000)

REM Always ensure execution from the directory containing this script
cd /d "%~dp0"

echo ============================================================
echo   TradeSpace Enterprise - Web Server Launcher
echo ============================================================

REM 1. Check if user requested MT5 bridge via argument
if "%1"=="--with-mt5" (
    if exist "%~dp0run_mt5.bat" (
        echo [Launcher] Launching MT5 Bridge Server in separate window...
        start "TradeSpace MT5 Bridge" cmd /c "%~dp0run_mt5.bat"
        timeout /t 2 /nobreak >nul
    )
)
if "%1"=="mt5" (
    if exist "%~dp0run_mt5.bat" (
        echo [Launcher] Launching MT5 Bridge Server in separate window...
        start "TradeSpace MT5 Bridge" cmd /c "%~dp0run_mt5.bat"
        timeout /t 2 /nobreak >nul
    )
)

REM 2. Verify production build exists
if not exist ".next\server\app\page.js" (
    echo [Launcher] No existing build found. Compiling Next.js production build...
    call npm run build
    if errorlevel 1 (
        echo [ERROR] Build failed. Please inspect errors above.
        pause
        exit /b 1
    )
)

REM 3. Launch TradeSpace with 24/7 Watchdog Supervisor
echo [Launcher] Starting TradeSpace Server on port 3000...
echo [Launcher] Memory allocation: 768 MB heap (calibrated for VPS stability).
echo [Launcher] Auto-revives if process ever exits.
echo [Launcher] Server URL: http://localhost:3000
echo ============================================================
echo.

:run_server
node --max-old-space-size=768 server.js
set "EXIT_CODE=%errorlevel%"

echo.
echo ============================================================
echo [WATCHDOG] TradeSpace process exited with code %EXIT_CODE%.
echo [WATCHDOG] Reviving server in 3 seconds... Press Ctrl+C to terminate.
echo ============================================================
timeout /t 3 /nobreak >nul
goto run_server
