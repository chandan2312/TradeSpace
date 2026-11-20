#!/usr/bin/env bash
# =============================================================================
# TradeSpace — Native ARM64 Hangover + MT5 Setup
# Target: Oracle Cloud Ampere A1 (Ubuntu 24.04 LTS Noble aarch64)
# =============================================================================
set -e

echo "=== [1/7] Backing up existing MT5 files ==="
mkdir -p /tmp/mt5_backup
if [ -d "/home/ubuntu/.wine/drive_c/Program Files/MetaTrader 5" ]; then
    echo "[+] Found existing MT5 installation. Backing up..."
    cp -r "/home/ubuntu/.wine/drive_c/Program Files/MetaTrader 5" /tmp/mt5_backup/
fi

echo "=== [2/7] Removing legacy Wine wrappers and conflicts ==="
sudo rm -f /usr/local/bin/wine /usr/local/bin/wine64 /usr/local/bin/wineboot /usr/local/bin/wineserver
sudo apt-get remove -y wine64 libwine 2>/dev/null || true
sudo dpkg -r fonts-wine libwine wine64 2>/dev/null || true

echo "=== [3/7] Downloading and installing Hangover 11.4 ==="
cd /tmp
if [ ! -f "hangover_11.4_ubuntu2404_noble_arm64.tar" ]; then
    echo "[+] Downloading Hangover 11.4 for Ubuntu 24.04 ARM64..."
    wget -q --show-progress "https://github.com/AndreRH/hangover/releases/download/hangover-11.4/hangover_11.4_ubuntu2404_noble_arm64.tar" -O hangover.tar
else
    cp hangover_11.4_ubuntu2404_noble_arm64.tar hangover.tar
fi

tar -xf hangover.tar
sudo apt-get update -y
sudo apt-get install -y ./hangover-libwow64fex_11.4_arm64.deb \
                        ./hangover-libarm64ecfex_11.4_arm64.deb \
                        ./hangover-wowbox64_11.4_arm64.deb \
                        ./hangover-wine_11.4~noble_arm64.deb

echo "[+] Verifying Wine version..."
wine --version

echo "=== [4/7] Rebuilding clean ARM64 Wine prefix ==="
wineserver -k 2>/dev/null || true
sleep 2

# Ensure Xvfb is running on :99
if ! pgrep -x "Xvfb" > /dev/null; then
    echo "[+] Starting Xvfb on DISPLAY=:99..."
    Xvfb :99 -screen 0 1024x768x24 &
    sleep 2
fi

rm -rf /home/ubuntu/.wine
export DISPLAY=:99
export WINEPREFIX="/home/ubuntu/.wine"
export WINEARCH="win64"

echo "[+] Initializing wineboot..."
wine wineboot --init
sleep 5

echo "[+] Verifying kernel32 architecture..."
file /home/ubuntu/.wine/drive_c/windows/system32/kernel32.dll

echo "=== [5/7] Restoring MetaTrader 5 terminal ==="
mkdir -p "/home/ubuntu/.wine/drive_c/Program Files"
if [ -d "/tmp/mt5_backup/MetaTrader 5" ]; then
    echo "[+] Restoring MT5 terminal files from backup..."
    cp -r "/tmp/mt5_backup/MetaTrader 5" "/home/ubuntu/.wine/drive_c/Program Files/MetaTrader 5"
else
    echo "[+] Downloading and running MT5 silent installer..."
    cd /tmp
    wget -q --show-progress https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe
    wine mt5setup.exe /auto
    sleep 30
fi
chmod -R 775 "/home/ubuntu/.wine/drive_c/Program Files/MetaTrader 5" 2>/dev/null || true

echo "=== [6/7] Installing Windows Python 3.11 & MetaTrader5 package ==="
cd /tmp
if [ ! -f "python-3.11.9-amd64.exe" ]; then
    wget -q --show-progress https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe
fi
echo "[+] Installing Windows Python 3.11..."
wine python-3.11.9-amd64.exe /quiet InstallAllUsers=1 PrependPath=1 Include_pip=1 TargetDir="C:\\Python311"
sleep 5

echo "[+] Installing NumPy <2 and MetaTrader5 package inside Wine Python..."
wine "C:\\Python311\\python.exe" -m pip install --upgrade pip
wine "C:\\Python311\\python.exe" -m pip install "numpy<2" MetaTrader5 flask requests

echo "=== [7/7] Launching MT5 and verifying Python IPC connection ==="
nohup wine "/home/ubuntu/.wine/drive_c/Program Files/MetaTrader 5/terminal64.exe" /portable > /tmp/mt5_runtime.log 2>&1 &
sleep 10

echo "[+] Checking if terminal64.exe is running..."
pgrep -f "terminal64.exe" || echo "[-] Warning: terminal64.exe not found in ps"

echo "[+] Testing MetaTrader5 Python IPC bridge..."
wine "C:\\Python311\\python.exe" -c "
import MetaTrader5 as m
print('Initializing MT5 connection...')
res = m.initialize(path=r'C:\Program Files\MetaTrader 5\terminal64.exe')
print('Initialize Result:', res)
if res:
    print('Terminal Info:', m.terminal_info())
    print('Version:', m.version())
else:
    print('Error:', m.last_error())
"

echo "============================================================"
echo "  Hangover MT5 Setup Complete!"
echo "============================================================"
