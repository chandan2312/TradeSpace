#!/usr/bin/env bash
# =============================================================================
# TradeSpace — Run MT5 Server under Wine on Linux VPS
# =============================================================================
set -e
cd "$(dirname "$0")"

export WINEPREFIX="${WINEPREFIX:-$HOME/.wine}"
export WINEARCH="win64"
export DISPLAY="${DISPLAY:-:99}"

# Start Xvfb if not running
if ! pgrep -x "Xvfb" > /dev/null; then
  echo "[+] Starting virtual display Xvfb on $DISPLAY..."
  Xvfb "$DISPLAY" -screen 0 1024x768x16 &
  sleep 2
fi

# Launch MT5 terminal if not already running
if ! pgrep -f "terminal64.exe" > /dev/null; then
  echo "[+] Launching MetaTrader 5 in Wine..."
  wine "C:\\Program Files\\MetaTrader 5\\terminal64.exe" /portable &
  sleep 8
fi

# Run the python MT5 bridge
echo "[+] Starting TradeSpace MT5 bridge on port 8765..."
while true; do
  wine "C:\\Python311\\python.exe" mt5_server.py --host 0.0.0.0 --port 8765
  EXIT_CODE=$?
  echo "[WATCHDOG] MT5 bridge exited with code $EXIT_CODE. Restarting in 3s..."
  sleep 3
done
