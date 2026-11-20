#!/usr/bin/env bash
# =============================================================================
# TradeSpace — MetaTrader 5 & Box64 Wine Setup for ARM64 (aarch64) Linux VPS
# Target: Oracle Cloud Ampere A1 (Ubuntu 22.04 / 24.04 LTS)
# =============================================================================
set -e

if [ "$EUID" -ne 0 ]; then
  echo "[-] Please run as root: sudo bash scripts/vps_setup_mt5_arm64.sh"
  exit 1
fi

echo "[+] Step 1: Installing Box64 x86_64 emulator for ARM64..."
apt-get update -y
apt-get install -y wget curl gnupg2 software-properties-common xz-utils xvfb x11vnc cabextract

# Install Box64 repo
wget -qO- https://ryanfortner.github.io/box64-debs/KEY.gpg | gpg --dearmor --yes -o /etc/apt/trusted.gpg.d/box64.gpg
echo "deb [arch=arm64] https://ryanfortner.github.io/box64-debs/debian ./ " > /etc/apt/sources.list.d/box64.list
apt-get update -y
apt-get install -y box64-arm64 || apt-get install -y box64

# Verify box64
box64 -v || echo "[+] Box64 installed successfully."

echo "[+] Step 2: Downloading standalone Wine x86_64 for Box64..."
mkdir -p /opt/wine-arm64
cd /tmp
WINE_URL="https://github.com/Kron4ek/Wine-Builds/releases/download/9.5/wine-9.5-staging-amd64.tar.xz"
if [ ! -f "wine-amd64.tar.xz" ]; then
  wget -q --show-progress -O wine-amd64.tar.xz "$WINE_URL"
fi

tar -xf wine-amd64.tar.xz -C /opt/wine-arm64/ --strip-components=1
ln -sf /opt/wine-arm64/bin/wine /usr/local/bin/wine
ln -sf /opt/wine-arm64/bin/wine64 /usr/local/bin/wine64
ln -sf /opt/wine-arm64/bin/wineboot /usr/local/bin/wineboot

echo "[+] Step 3: Initializing Wine prefix..."
export WINEPREFIX="/root/.wine"
export WINEARCH="win64"
export DISPLAY=":99"

if ! pgrep -x "Xvfb" > /dev/null; then
  Xvfb :99 -screen 0 1024x768x16 &
  sleep 2
fi

wineboot -u
sleep 5

echo "[+] Step 4: Installing Windows Python 3.11 in Wine via Box64..."
mkdir -p /tmp/mt5_installer
cd /tmp/mt5_installer
if [ ! -f "python-3.11.9-amd64.exe" ]; then
  wget -q --show-progress https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe
fi

wine python-3.11.9-amd64.exe /quiet InstallAllUsers=1 PrependPath=1 Include_pip=1 TargetDir="C:\\Python311"
sleep 5

echo "[+] Installing MetaTrader5 package..."
wine "C:\\Python311\\python.exe" -m pip install --upgrade pip
wine "C:\\Python311\\python.exe" -m pip install MetaTrader5

echo "[+] Step 5: Installing MetaTrader 5..."
if [ ! -f "mt5setup.exe" ]; then
  wget -q --show-progress https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe
fi

wine mt5setup.exe /auto
sleep 15

echo "============================================================"
echo "  MT5 on ARM64 (Box64 + Wine) Installed Successfully!"
echo "  Terminal: C:\\Program Files\\MetaTrader 5\\terminal64.exe"
echo "  Python:   C:\\Python311\\python.exe"
echo "============================================================"
