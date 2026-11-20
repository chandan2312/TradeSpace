#!/usr/bin/env bash
# =============================================================================
# TradeSpace Enterprise — Self-Healing MT5 Bridge & Supervisor under Wine
# =============================================================================
set -e
cd "$(dirname "$0")"

export WINEPREFIX="${WINEPREFIX:-$HOME/.wine}"
export WINEARCH="win64"
export DISPLAY="${DISPLAY:-:99}"

# Graceful termination handling
cleanup() {
  echo "[WATCHDOG] Received shutdown signal. Terminating child processes..."
  pkill -P $$ 2>/dev/null || true
  exit 0
}
trap cleanup SIGINT SIGTERM

echo "[+] Starting TradeSpace MT5 Supervisor on DISPLAY=$DISPLAY..."

# Infinite resilience loop: if MT5 or Python ever exits, auto-heal and restart
while true; do
  # 1. Ensure Xvfb virtual display is running (clean stale locks if any)
  if ! pgrep -x "Xvfb" > /dev/null; then
    if [ -f "/tmp/.X99-lock" ]; then
      echo "[+] Clearing stale Xvfb lock /tmp/.X99-lock..."
      rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 2>/dev/null || true
    fi
    echo "[+] Virtual display Xvfb not running. Launching on $DISPLAY..."
    Xvfb "$DISPLAY" -screen 0 1280x800x24 -ac &
    sleep 2
  fi

  # 2. Ensure MetaTrader 5 terminal is running
  if ! pgrep -f "terminal64.exe" > /dev/null; then
    echo "[+] MetaTrader 5 is not running. Launching terminal64.exe in Wine..."
    nohup wine "C:\\Program Files\\MetaTrader 5\\terminal64.exe" /portable > /tmp/mt5_daemon.log 2>&1 &
    echo "[+] Waiting 8 seconds for MT5 IPC named pipe to initialize..."
    sleep 8
  fi

  # 3. Launch Python MT5 REST/WebSocket Bridge
  echo "[+] Starting mt5_server.py bridge on port 8765..."
  wine "C:\\Python311\\python.exe" mt5_server.py --host 0.0.0.0 --port 8765 --token chandan-yashwant-chaudhari-2312
  EXIT_CODE=$?

  echo "[WATCHDOG] MT5 bridge process exited with code $EXIT_CODE. Re-verifying MT5 health and restarting in 3s..."
  sleep 3
done
