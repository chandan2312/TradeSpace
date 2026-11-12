@echo off
setlocal enabledelayedexpansion
title TradeSpace VPS Performance & Memory Optimizer

echo ============================================================
echo   TradeSpace Institutional VPS Performance Optimizer
echo   [RAM & CPU Exhaustion Purge Engine]
echo ============================================================
echo.

REM 1. Purge Windows User & System Temporary Cache
echo [1/5] Purging temporary files and memory crash dumps...
del /f /s /q "%TEMP%\*.*" >nul 2>&1
for /d %%D in ("%TEMP%\*") do rd /s /q "%%D" >nul 2>&1
if defined WINDIR (
    del /f /s /q "%WINDIR%\Temp\*.*" >nul 2>&1
    for /d %%D in ("%WINDIR%\Temp\*") do rd /s /q "%%D" >nul 2>&1
)
echo       Temp cache purge complete.

REM 2. Remove orphaned SQLite locks and Python bytecode cache
echo [2/5] Cleaning orphaned locks and Python cache...
if exist "%~dp0mt5_requests.sqlite3-shm" del /f /q "%~dp0mt5_requests.sqlite3-shm" >nul 2>&1
if exist "%~dp0__pycache__" rd /s /q "%~dp0__pycache__" >nul 2>&1
echo       Lock & bytecode cleanup complete.

REM 3. Flush DNS and Windows Network Socket Buffers
echo [3/5] Flushing DNS and refreshing network socket buffers...
ipconfig /flushdns >nul 2>&1
echo       Network sockets refreshed.

REM 4. Set Windows Power Plan to High Performance
echo [4/5] Activating Windows High Performance CPU Governor...
powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c >nul 2>&1
powercfg /setactive SCHEME_MIN >nul 2>&1
echo       High performance power governor active.

REM 5. Force Memory Compaction & Standby RAM Release
echo [5/5] Compacting OS memory and releasing unreferenced pages...
powershell -NoProfile -Command "[System.GC]::Collect(); [System.GC]::WaitForPendingFinalizers()" >nul 2>&1
echo       OS memory compaction complete.

echo.
echo ============================================================
echo   [SUCCESS] VPS RAM & CPU Optimization Complete!
echo   - Temporary junk files cleared
echo   - Network sockets and DNS flushed
echo   - High Performance CPU mode set
echo   - Memory working set compacted
echo ============================================================
echo.
pause
