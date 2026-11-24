#!/usr/bin/env bash
# =============================================================================
# TradeSpace Enterprise — Master Control CLI (manage.sh)
# =============================================================================
# Usage:
#   ./manage.sh status     -> Deep health check across all services
#   ./manage.sh restart    -> Clean 1-command restart of all systems
#   ./manage.sh start      -> Start all services under PM2 supervisor
#   ./manage.sh stop       -> Stop all services cleanly
#   ./manage.sh logs       -> Live consolidated logs (PM2)
#   ./manage.sh vnc        -> Start temporary noVNC on port 6080
#   ./manage.sh vnc-stop   -> Stop noVNC service
# =============================================================================

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
cd "$SCRIPT_DIR"

mkdir -p logs

TOKEN="chandan-yashwant-chaudhari-2312"

check_status() {
  echo -e "\n${CYAN}${BOLD}=======================================================${NC}"
  echo -e "${CYAN}${BOLD}         TradeSpace Enterprise System Status           ${NC}"
  echo -e "${CYAN}${BOLD}=======================================================${NC}\n"

  # 1. Check Virtual Display (Xvfb)
  echo -n "  • Virtual Display (Xvfb :99)    : "
  if pgrep -x "Xvfb" > /dev/null; then
    echo -e "${GREEN}${BOLD}ACTIVE (PID: $(pgrep -x Xvfb | head -n1))${NC}"
  else
    echo -e "${RED}${BOLD}STOPPED${NC}"
  fi

  # 2. Check MetaTrader 5 Terminal
  echo -n "  • MetaTrader 5 (Wine x64)       : "
  if pgrep -f "terminal64.exe" > /dev/null; then
    echo -e "${GREEN}${BOLD}RUNNING (PID: $(pgrep -f terminal64.exe | head -n1))${NC}"
  else
    echo -e "${RED}${BOLD}STOPPED${NC}"
  fi

  # 3. Check MT5 Bridge (Port 8765)
  echo -n "  • MT5 Bridge Service (:8765)    : "
  BRIDGE_HEALTH=$(curl -s --connect-timeout 2 http://127.0.0.1:8765/health 2>/dev/null || echo "")
  if [[ "$BRIDGE_HEALTH" == *"bridge-ready"* ]]; then
    echo -e "${GREEN}${BOLD}ONLINE (Ready)${NC}"
  else
    echo -e "${RED}${BOLD}OFFLINE${NC}"
  fi

  # 4. Check Broker Connection & Balance
  echo -n "  • Broker Account Sync           : "
  ACCOUNT_JSON=$(curl -s --connect-timeout 3 -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8765/account 2>/dev/null || echo "")
  if [[ "$ACCOUNT_JSON" == *"\"ok\": true"* || "$ACCOUNT_JSON" == *"\"ok\":true"* ]]; then
    LOGIN=$(echo "$ACCOUNT_JSON" | grep -o '"login": *[0-9]*' | head -n1 | cut -d: -f2 | tr -d ' ')
    SERVER=$(echo "$ACCOUNT_JSON" | grep -o '"server": *"[^"]*"' | head -n1 | cut -d: -f2 | tr -d '" ')
    BALANCE=$(echo "$ACCOUNT_JSON" | grep -o '"balance": *[0-9.]*' | head -n1 | cut -d: -f2 | tr -d ' ')
    EQUITY=$(echo "$ACCOUNT_JSON" | grep -o '"equity": *[0-9.]*' | head -n1 | cut -d: -f2 | tr -d ' ')
    echo -e "${GREEN}${BOLD}CONNECTED ($SERVER | Login: $LOGIN)${NC}"
    echo -e "    └─ ${YELLOW}Live Balance: \$${BALANCE} USD | Equity: \$${EQUITY} USD${NC}"
  else
    echo -e "${RED}${BOLD}NOT CONNECTED / SYNCING${NC}"
  fi

  # 5. Check TradeSpace Web App (Port 3000)
  echo -n "  • TradeSpace Web Server (:3000) : "
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 http://127.0.0.1:3000 || echo "000")
  if [ "$HTTP_CODE" == "200" ]; then
    echo -e "${GREEN}${BOLD}ONLINE (HTTP 200 OK)${NC}"
  else
    echo -e "${RED}${BOLD}OFFLINE (HTTP $HTTP_CODE)${NC}"
  fi

  # 6. PM2 Status Summary
  echo -e "\n${BOLD}--- PM2 Managed Processes ---${NC}"
  if command -v pm2 > /dev/null; then
    pm2 status
  else
    echo -e "${YELLOW}PM2 is not installed or not in PATH.${NC}"
  fi
  echo ""
}

start_services() {
  echo -e "\n${CYAN}[+] Starting all TradeSpace services via PM2...${NC}"
  
  # Ensure Xvfb lock isn't stale
  if [ -f "/tmp/.X99-lock" ] && ! pgrep -x "Xvfb" > /dev/null; then
    rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 2>/dev/null || true
  fi

  if ! pgrep -x "Xvfb" > /dev/null; then
    echo "[+] Launching virtual display Xvfb on :99..."
    Xvfb :99 -screen 0 1280x800x24 -ac &
    sleep 2
  fi

  pm2 start ecosystem.config.cjs
  pm2 save
  echo "[+] Waiting 5 seconds for systems to initialize..."
  sleep 5
  check_status
}

stop_services() {
  echo -e "\n${YELLOW}[+] Stopping all TradeSpace services...${NC}"
  pm2 stop all 2>/dev/null || true
  pkill -9 -f "mt5_server.py" 2>/dev/null || true
  pkill -9 -f "terminal64.exe" 2>/dev/null || true
  wineserver -k 2>/dev/null || true
  echo -e "${GREEN}[✔] All services stopped.${NC}\n"
}

restart_services() {
  echo -e "\n${YELLOW}[+] Initiating Clean 1-Command Restart...${NC}"
  stop_services
  sleep 2
  start_services
}

update_services() {
  echo -e "\n${CYAN}${BOLD}=======================================================${NC}"
  echo -e "${CYAN}${BOLD}    TradeSpace 1-Command Pull, Build & Restart         ${NC}"
  echo -e "${CYAN}${BOLD}=======================================================${NC}\n"

  echo -e "${CYAN}[1/3] Pulling latest updates from git...${NC}"
  git pull origin main

  echo -e "\n${CYAN}[2/3] Building TradeSpace web application (npm run build)...${NC}"
  npm run build

  echo -e "\n${CYAN}[3/3] Restarting all services (MT5, Bridge, Web)...${NC}"
  restart_services
}

start_vnc() {
  echo -e "\n${CYAN}[+] Starting noVNC GUI access on port 6080...${NC}"
  if ! pgrep -f "x11vnc" > /dev/null; then
    x11vnc -display :99 -forever -nopw -rfbport 5900 -bg 2>/dev/null || true
  fi
  if ! pgrep -f "websockify.*6080" > /dev/null; then
    nohup websockify --web /usr/share/novnc 6080 localhost:5900 > /tmp/novnc.log 2>&1 &
  fi
  echo -e "${GREEN}[✔] noVNC active! Open in browser: http://$(curl -s ifconfig.me):6080/vnc.html${NC}\n"
}

stop_vnc() {
  echo -e "\n${YELLOW}[+] Stopping noVNC GUI access...${NC}"
  pkill -f "websockify.*6080" 2>/dev/null || true
  pkill -f "x11vnc" 2>/dev/null || true
  echo -e "${GREEN}[✔] noVNC stopped.${NC}\n"
}

case "$1" in
  update|deploy)
    update_services
    ;;
  status)
    check_status
    ;;
  restart)
    restart_services
    ;;
  start)
    start_services
    ;;
  stop)
    stop_services
    ;;
  logs)
    pm2 logs
    ;;
  vnc)
    start_vnc
    ;;
  vnc-stop)
    stop_vnc
    ;;
  *)
    echo -e "${BOLD}TradeSpace Enterprise — Service Controller${NC}"
    echo "Usage: ./manage.sh [command]"
    echo ""
    echo "Commands:"
    echo "  update     - Pull git changes, build web app, and restart all services"
    echo "  status     - Show comprehensive real-time status of all systems"
    echo "  restart    - Clean 1-command restart of MT5, bridge, and web app"
    echo "  start      - Start all services under PM2"
    echo "  stop       - Stop all services cleanly"
    echo "  logs       - Tail live logs from all services"
    echo "  vnc        - Start temporary browser GUI (port 6080)"
    echo "  vnc-stop   - Stop browser GUI"
    echo ""
    exit 1
    ;;
esac
