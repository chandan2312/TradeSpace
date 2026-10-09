@echo off
setlocal enabledelayedexpansion
title TradeSpace MT5 Bridge Server (Port 8765)

cd /d "%~dp0"
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
set PYTHONUNBUFFERED=1

echo ============================================================
echo   TradeSpace Institutional MT5 Bridge Server Launcher
echo ============================================================

REM 1. Detect Python executable
set "PY_CMD="
if exist "%~dp0.venv\Scripts\python.exe" (
    set "PY_CMD=%~dp0.venv\Scripts\python.exe"
) else if exist "%~dp0venv\Scripts\python.exe" (
    set "PY_CMD=%~dp0venv\Scripts\python.exe"
) else if exist "%~dp0quant_service\.venv\Scripts\python.exe" (
    set "PY_CMD=%~dp0quant_service\.venv\Scripts\python.exe"
) else (
    where py >nul 2>&1
    if not errorlevel 1 (
        set "PY_CMD=py -3"
    ) else (
        where python >nul 2>&1
        if not errorlevel 1 (
            set "PY_CMD=python"
        )
    )
)

if "!PY_CMD!"=="" (
    echo [ERROR] Python not found in system PATH!
    echo Please install Python 3.9+ from python.org and check "Add Python to PATH".
    pause
    exit /b 1
)

echo [Launcher] Using Python: !PY_CMD!

REM 2. Verify MetaTrader5 package is installed
!PY_CMD! -c "import MetaTrader5" >nul 2>&1
if errorlevel 1 (
    echo [WARNING] MetaTrader5 python package not detected!
    echo Attempting automatic installation via pip...
    !PY_CMD! -m pip install MetaTrader5
    if errorlevel 1 (
        echo [ERROR] Failed to install MetaTrader5 package automatically.
        echo Please run manually in terminal: pip install MetaTrader5
        pause
    )
)

REM 3. Run MT5 Server with 24/7 Watchdog Auto-Restart
echo.
echo [Launcher] Starting mt5_server.py on http://0.0.0.0:8765 ...
echo [Launcher] Press Ctrl+C in this window if you wish to stop the bridge.
echo ============================================================

:mt5_watchdog
!PY_CMD! mt5_server.py --host 0.0.0.0 --port 8765
set "EXIT_CODE=!errorlevel!"

echo.
echo ============================================================
echo [WATCHDOG] MT5 Bridge Server exited (Exit Code: !EXIT_CODE!).
echo [WATCHDOG] Automatically reviving MT5 Bridge Server in 3 seconds...
echo ============================================================
timeout /t 3 /nobreak >nul
goto mt5_watchdog
