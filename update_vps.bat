@echo off
title TradeSpace VPS Updater
cd /d "%~dp0"
echo ============================================================
echo TradeSpace Institutional VPS Updater
echo ============================================================
echo.
echo [1/3] Stashing any local file changes...
git stash
echo.
echo [2/3] Pulling latest fixes from GitHub...
git pull origin main
echo.
echo [3/3] Update complete!
echo ============================================================
echo All latest MT5 bridge and dashboard fixes are now applied.
echo Please restart your run_mt5.bat window now.
echo ============================================================
pause
