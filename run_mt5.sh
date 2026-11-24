#!/bin/bash
# =============================================================================
# TradeSpace Institutional MT5 Bridge Server (Linux/Mac/WSL Launcher)
# =============================================================================
set -e
cd "$(dirname "$0")"

export PYTHONIOENCODING=utf-8
export PYTHONUNBUFFERED=1

PYTHON_CMD=""
for cmd in python3 python py; do
    if command -v "$cmd" >/dev/null 2>&1; then
        PYTHON_CMD="$cmd"
        break
    fi
done

if [ -z "$PYTHON_CMD" ]; then
    echo "Error: Python 3 not found in system PATH."
    exit 1
fi

echo "============================================================"
echo "  TradeSpace Institutional MT5 Bridge Server"
echo "  Python executable: $($PYTHON_CMD --version)"
echo "  Listening on: http://0.0.0.0:8765"
echo "============================================================"

while true; do
    "$PYTHON_CMD" mt5_server.py --host 0.0.0.0 --port 8765
    EXIT_CODE=$?
    echo "[WATCHDOG] mt5_server.py exited with code ${EXIT_CODE}. Reviving in 3 seconds..."
    sleep 3
done
