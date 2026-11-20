#!/usr/bin/env bash
# =============================================================================
# TradeSpace — MetaTrader 5 & Wine Setup for Linux VPS (Ubuntu 22.04/24.04 x86_64)
# =============================================================================
set -e

if [ "$EUID" -ne 0 ]; then
  echo "[-] Please run as root: sudo bash scripts/vps_setup_mt5.sh"
  exit 1
fi

ARCH=$(uname -m)
if [ "$ARCH" != "x86_64" ]; then
  echo "[-] Warning: MetaTrader5 Windows binaries run natively on x86_64."
  echo "    Detected $ARCH. If using ARM64 (Ampere A1), Box64 is required or run MT5 on an x86 instance."
fi

echo "[+] Step 1: Installing Wine & Headless Display Tools (Xvfb)..."
dpkg --add-architecture i386 || true
apt-get update -y
apt-get install -y wine64 wine32 xvfb winetricks wget cabextract

export WINEPREFIX="/root/.wine"
export WINEARCH="win64"
export DISPLAY=":99"

# Start virtual display
if ! pgrep -x "Xvfb" > /dev/null; then
  echo "[+] Starting Xvfb virtual framebuffer on DISPLAY=:99..."
  Xvfb :99 -screen 0 1024x768x16 &
  sleep 2
fi

echo "[+] Step 2: Downloading & Installing Windows Python 3.11 in Wine..."
mkdir -p /tmp/mt5_installer
cd /tmp/mt5_installer

if [ ! -f "python-3.11.9-amd64.exe" ]; then
  wget -q --show-progress https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe
fi

echo "[+] Installing Python 3.11 inside Wine..."
wine python-3.11.9-amd64.exe /quiet InstallAllUsers=1 PrependPath=1 Include_pip=1 TargetDir="C:\\Python311"
sleep 5

echo "[+] Installing MetaTrader5 package inside Wine Python..."
wine "C:\\Python311\\python.exe" -m pip install --upgrade pip
wine "C:\\Python311\\python.exe" -m pip install MetaTrader5

echo "[+] Step 3: Downloading & Installing MetaTrader 5..."
if [ ! -f "mt5setup.exe" ]; then
  wget -q --show-progress https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe
fi

echo "[+] Running MetaTrader 5 silent installer..."
wine mt5setup.exe /auto
sleep 15

echo "============================================================"
echo "  MT5 and Wine Python Environment Installed Successfully!"
echo "  Terminal: C:\\Program Files\\MetaTrader 5\\terminal64.exe"
echo "  Python:   C:\\Python311\\python.exe"
echo "============================================================"
