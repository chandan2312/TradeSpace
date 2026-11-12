@echo off
setlocal enabledelayedexpansion
title TradeSpace Web Server (Port 3000)

REM Always ensure execution from the directory containing this script
cd /d "%~dp0"

if "%1"=="--reboot" goto :do_reboot
if "%1"=="reboot" goto :do_reboot

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
echo [Launcher] Memory allocation: 768 MB heap (VPS optimized).
echo [Launcher] Auto-revives if process ever exits.
echo [Launcher] Auto-reboots VPS if stuck in consecutive crash loop.
echo [Launcher] Server URL: http://localhost:3000
echo ============================================================
echo.

set /a CRASH_STREAK=0
set /a MAX_CRASH_STREAK=5

:run_server
set "START_SEC="
for /f %%A in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()" 2^>nul') do set "START_SEC=%%A"

node --expose-gc --max-old-space-size=768 --optimize_for_size server.js
set "EXIT_CODE=%errorlevel%"

set "END_SEC="
for /f %%B in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()" 2^>nul') do set "END_SEC=%%B"

set /a RUN_DURATION=0
if defined START_SEC if defined END_SEC set /a RUN_DURATION=END_SEC-START_SEC

if !RUN_DURATION! geq 120 (
    set /a CRASH_STREAK=0
    echo [WATCHDOG] Process ran stably for !RUN_DURATION!s. Crash counter reset to 0.
) else (
    set /a CRASH_STREAK+=1
    echo [WATCHDOG] Rapid exit detected [Duration: !RUN_DURATION!s, Rapid Crash Streak: !CRASH_STREAK!/!MAX_CRASH_STREAK!].
)

if !CRASH_STREAK! geq !MAX_CRASH_STREAK! (
    echo.
    echo ============================================================
    echo [CRITICAL WATCHDOG] !MAX_CRASH_STREAK! consecutive rapid crashes detected!
    echo [CRITICAL WATCHDOG] Operating system sockets/resources appear corrupted or stuck.
    echo [CRITICAL WATCHDOG] Initiating automatic Windows reboot in 15 seconds to self-heal...
    echo [CRITICAL WATCHDOG] Press Ctrl+C in this console to cancel reboot.
    echo ============================================================
    timeout /t 15
    shutdown /r /f /t 0
    exit /b 1
)

echo.
echo ============================================================
echo [WATCHDOG] TradeSpace process exited with code %EXIT_CODE%.
echo [WATCHDOG] Reviving server in 3 seconds... Press Ctrl+C to terminate.
echo ============================================================
timeout /t 3 /nobreak >nul
goto run_server

:do_reboot
echo.
echo ============================================================
echo [REBOOT] Emergency Windows VPS reboot requested!
echo [REBOOT] Rebooting system in 5 seconds... Press Ctrl+C to cancel.
echo ============================================================
timeout /t 5
shutdown /r /f /t 0
exit /b 0
