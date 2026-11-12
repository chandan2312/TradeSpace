@echo off
setlocal enabledelayedexpansion
title TradeSpace MT5 Bridge Server (Port 8765) - Auto-Healing Supervisor

cd /d "%~dp0"
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
set PYTHONUNBUFFERED=1

echo ============================================================
echo   TradeSpace Institutional MT5 Bridge Server Launcher
echo   [Auto-Healing 24/7 Supervisor Active]
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

REM 3. Check if MetaTrader 5 Terminal [terminal64.exe] is running
tasklist /FI "IMAGENAME eq terminal64.exe" 2>nul | find /I "terminal64.exe" >nul
if errorlevel 1 (
    echo [Launcher] MetaTrader 5 terminal [terminal64.exe] is NOT running.
    echo [Launcher] Searching for installed MetaTrader 5 terminal to auto-launch...
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
        echo [Launcher] Auto-launching MetaTrader 5: "!FOUND_MT5!" ...
        start "" "!FOUND_MT5!"
        echo [Launcher] Waiting 8 seconds for terminal to connect to broker...
        timeout /t 8 /nobreak >nul
    ) else (
        echo ------------------------------------------------------------
        echo [WARNING] MetaTrader 5 terminal [terminal64.exe] is NOT running!
        echo [WARNING] Please ensure MetaTrader 5 is launched or set MT5_PATH.
        echo ------------------------------------------------------------
    )
) else (
    echo [Launcher] MetaTrader 5 terminal detected [terminal64.exe is running].
)

echo.
echo ============================================================
echo [Auto-Heal] Initializing clean state before starting...
call :auto_heal_cleanse
echo ============================================================

:mt5_supervise_loop
echo.
echo [Supervisor] Launching mt5_server.py on http://0.0.0.0:8765 ...
echo [Supervisor] Active health sentinel monitoring http://127.0.0.1:8765/health every 5s
echo ============================================================

REM Launch mt5_server.py in the background of this console
start "TradeSpace MT5 Engine" /b !PY_CMD! mt5_server.py --host 0.0.0.0 --port 8765

REM Allow 4 seconds for server socket binding and initialization
ping 127.0.0.1 -n 5 >nul

set /a FAIL_STREAK=0
set /a HEARTBEAT_TICKS=0

:health_sentinel_loop
ping 127.0.0.1 -n 6 >nul

REM Check 1: Is Port 8765 currently listening?
netstat -aon | findstr ":8765" | findstr "LISTENING" >nul
if errorlevel 1 (
    echo.
    echo ============================================================
    echo [ALERT] Port 8765 is no longer listening. Server process exited or died.
    goto :recover_and_restart
)

REM Check 2: Probe HTTP /health with 8s timeout using built-in curl.exe
curl.exe -s -m 8 http://127.0.0.1:8765/health >nul 2>&1
if errorlevel 1 (
    set /a FAIL_STREAK+=1
    echo [Watchdog] Health probe failed [Streak: !FAIL_STREAK!/8]...
    if !FAIL_STREAK! geq 8 (
        echo.
        echo ============================================================
        echo [CRITICAL AUTO-HEAL] Server is hung/unresponsive [8 consecutive failed probes].
        echo [CRITICAL AUTO-HEAL] Forcibly terminating clogged process and reviving...
        goto :recover_and_restart
    )
) else (
    set /a FAIL_STREAK=0
)

set /a HEARTBEAT_TICKS+=1
if !HEARTBEAT_TICKS! geq 12 (
    echo [Watchdog] MT5 Bridge Server active and healthy [Port 8765 responding].
    set /a HEARTBEAT_TICKS=0
)

goto :health_sentinel_loop


:recover_and_restart
echo [Auto-Heal] Initiating deep process and socket purge...
call :auto_heal_cleanse
echo [Auto-Heal] Cooling down for 3 seconds before revival...
ping 127.0.0.1 -n 4 >nul
echo [Auto-Heal] Reviving MT5 Bridge Server now.
echo ============================================================
goto :mt5_supervise_loop


:auto_heal_cleanse
REM 1. Forcibly terminate any process listening on port 8765
for /f "tokens=5" %%p in ('netstat -aon ^| findstr ":8765" ^| findstr "LISTENING"') do (
    echo [Auto-Heal] Found process PID %%p holding port 8765. Terminating...
    taskkill /F /PID %%p >nul 2>&1
)

REM 2. Forcibly terminate any lingering python.exe running mt5_server.py
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"name = 'python.exe'\" | Where-Object { $_.CommandLine -like '*mt5_server.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1

REM 3. Remove orphaned temporary SQLite shared memory locks if process crashed
if exist "%~dp0mt5_requests.sqlite3-shm" (
    del /f /q "%~dp0mt5_requests.sqlite3-shm" >nul 2>&1
)

REM 4. Flush unused system memory / GC on Windows VPS
powershell -NoProfile -Command "[System.GC]::Collect(); [System.GC]::WaitForPendingFinalizers()" >nul 2>&1
goto :eof
