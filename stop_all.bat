@echo off
echo ============================================================
echo   TradeSpace Enterprise - Stopping All Background Services
echo ============================================================
echo.

REM 1. Stop PM2 apps if running
where pm2 >nul 2>&1
if not errorlevel 1 (
    echo [PM2] Stopping PM2 processes...
    call pm2 stop all >nul 2>&1
    call pm2 delete all >nul 2>&1
) else (
    where npx >nul 2>&1
    if not errorlevel 1 (
        call npx pm2 stop all >nul 2>&1
        call npx pm2 delete all >nul 2>&1
    )
)

REM 2. Terminate any process listening on port 3000 (TradeSpace Web)
echo [Stop] Checking port 3000 (TradeSpace Web)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo Stopping PID %%a on port 3000...
    taskkill /f /pid %%a >nul 2>&1
)

REM 3. Terminate any process listening on port 8765 (MT5 Bridge)
echo [Stop] Checking port 8765 (MT5 Bridge)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8765" ^| findstr "LISTENING"') do (
    echo Stopping PID %%a on port 8765...
    taskkill /f /pid %%a >nul 2>&1
)

echo.
echo ============================================================
echo [SUCCESS] All TradeSpace and MT5 Bridge processes stopped.
echo ============================================================
timeout /t 3 >nul
