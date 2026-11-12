@echo off
setlocal enabledelayedexpansion
title TradeSpace Enterprise - Master 24/7 Autostart Supervisor

cd /d "%~dp0"
echo ============================================================
echo   TradeSpace Enterprise - Master 24/7 Autostart Supervisor
echo   [Windows Boot / Logon Auto-Revival Active]
echo ============================================================
echo.

REM 1. Allow 5 seconds for Windows networking and system services to stabilize
echo [Autostart] Initializing system services...
timeout /t 5 /nobreak >nul

REM 2. Check and launch MetaTrader 5 Terminal if not running
tasklist /FI "IMAGENAME eq terminal64.exe" 2>nul | find /I "terminal64.exe" >nul
if errorlevel 1 (
    echo [Autostart] Searching for MetaTrader 5 terminal [terminal64.exe]...
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
        echo [Autostart] Launching MetaTrader 5: "!FOUND_MT5!" ...
        start "" "!FOUND_MT5!"
        echo [Autostart] Waiting 8 seconds for broker network connection...
        timeout /t 8 /nobreak >nul
    ) else (
        echo [WARNING] Could not find terminal64.exe in standard directories.
    )
) else (
    echo [Autostart] MetaTrader 5 terminal is already running.
)

REM 3. Launch MT5 Bridge Server in separate console window
echo [Autostart] Launching TradeSpace MT5 Bridge [run_mt5.bat]...
start "TradeSpace MT5 Bridge" cmd /k "%~dp0run_mt5.bat"
timeout /t 5 /nobreak >nul

REM 4. Launch TradeSpace Web Server in separate console window
echo [Autostart] Launching TradeSpace Web Server [start.bat]...
start "TradeSpace Web Server" cmd /k "%~dp0start.bat"

echo.
echo ============================================================
echo [SUCCESS] TradeSpace 24/7 Ecosystem is running!
echo   1. MetaTrader 5 Terminal [terminal64.exe]
echo   2. MT5 Bridge Server     [Port 8765]
echo   3. TradeSpace Web Server [Port 3000]
echo ============================================================
timeout /t 5 /nobreak >nul
exit /b 0
