@echo off
echo ============================================================
echo   TradeSpace Enterprise - Background Service Status
echo ============================================================
echo.

set "WEB_FOUND=0"
set "MT5_FOUND=0"

netstat -aon | findstr ":3000" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo [ONLINE]  TradeSpace Web is listening on port 3000 (http://localhost:3000)
    set "WEB_FOUND=1"
) else (
    echo [OFFLINE] TradeSpace Web is NOT running on port 3000.
)

netstat -aon | findstr ":8765" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo [ONLINE]  MT5 Bridge is listening on port 8765 (http://localhost:8765)
    set "MT5_FOUND=1"
) else (
    echo [OFFLINE] MT5 Bridge is NOT running on port 8765.
)

echo.
where pm2 >nul 2>&1
if not errorlevel 1 (
    echo --- PM2 Process Table ---
    call pm2 status
) else (
    where npx >nul 2>&1
    if not errorlevel 1 (
        call npx pm2 status 2>nul
    )
)

echo.
pause
