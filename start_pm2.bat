@echo off
setlocal
cd /d "%~dp0"
echo ============================================================
echo   TradeSpace Enterprise - Starting PM2 Background Daemon
echo ============================================================
echo.

if not exist "logs" mkdir "logs"

where pm2 >nul 2>&1
if not errorlevel 1 (
    echo [PM2] Starting all services via PM2...
    call pm2 start ecosystem.config.cjs
    call pm2 save
    echo.
    echo ============================================================
    echo [SUCCESS] TradeSpace ^& MT5 Bridge are running in background!
    echo You can CLOSE this terminal window now. Services will keep running.
    echo ============================================================
    echo.
    call pm2 status
    pause
    exit /b 0
)

where npx >nul 2>&1
if not errorlevel 1 (
    echo [PM2] PM2 not in PATH. Starting via npx pm2...
    call npx pm2 start ecosystem.config.cjs
    echo.
    echo ============================================================
    echo [SUCCESS] TradeSpace ^& MT5 Bridge are running in background!
    echo You can CLOSE this terminal window now. Services will keep running.
    echo ============================================================
    echo.
    call npx pm2 status
    pause
    exit /b 0
)

echo [ERROR] Neither pm2 nor npx found in system PATH!
echo You can run 'npm install -g pm2' or double-click 'start_silent.vbs'.
pause
