#!/bin/bash
# =============================================================================
# TradeSpace Enterprise — Master Service Orchestrator
# =============================================================================
# Usage:
#   ./start.sh              # Starts in production mode (default)
#   ./start.sh prod         # Explicit production mode (auto-builds if needed)
#   ./start.sh dev          # Starts in development mode with hot-reloading
#   ./start.sh --with-mt5   # Also starts local mt5_server.py bridge (port 8765)
#   ./start.sh prod --with-mt5
# =============================================================================

set -e

# Terminal Colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

# Mode & Argument Parsing
MODE="prod"
START_MT5=false
FORCE_BUILD=false

for arg in "$@"; do
    case "$arg" in
        dev|development)
            MODE="dev"
            ;;
        prod|production)
            MODE="prod"
            ;;
        --build|-b)
            FORCE_BUILD=true
            ;;
        --with-mt5)
            START_MT5=true
            ;;
        -h|--help)
            echo -e "${BOLD}TradeSpace Service Runner${NC}"
            echo "Usage: ./start.sh [prod|dev] [--build] [--with-mt5]"
            echo ""
            echo "Options:"
            echo "  prod        Start in production mode (default, optimized)"
            echo "  dev         Start in development mode (hot-reloading)"
            echo "  --build, -b Force a fresh production build (npm run build)"
            echo "  --with-mt5  Also launch local python mt5_server.py on port 8765"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown argument: $arg${NC}"
            echo "Usage: ./start.sh [prod|dev] [--build] [--with-mt5]"
            exit 1
            ;;
    esac
done

ENV_FILE=".env"
LOG_FILE="tradespace_${MODE}.log"

echo -e "${CYAN}${BOLD}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║          TRADESPACE ENTERPRISE QUANT TERMINAL                ║"
echo "║       Real-Time Charts · Alerts · Autonomous Brain           ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# -----------------------------------------------------------------------------
# 1. Environment Loading & Pre-flight Validation
# -----------------------------------------------------------------------------
if [ -f "$ENV_FILE" ]; then
    echo -e "${BLUE}ℹ Loading environment from ${ENV_FILE}...${NC}"
    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%$'\r'}"
        if [ -z "$line" ] || [[ "$line" == \#* ]] || [[ "$line" != *=* ]]; then
            continue
        fi
        key="${line%%=*}"
        value="${line#*=}"
        value="${value%$'\r'}"
        # Strip outer quotes if present
        value="${value#\"}"
        value="${value%\"}"
        value="${value#\'}"
        value="${value%\'}"
        export "$key=$value"
    done < "$ENV_FILE"
else
    echo -e "${RED}✘ Missing ${ENV_FILE}!${NC}"
    echo "Please copy .env.example to .env and configure your variables:"
    echo "  cp .env.example .env"
    exit 1
fi

PORT="${PORT:-3000}"
export PORT
export NODE_ENV=$([ "$MODE" = "prod" ] && echo "production" || echo "development")

# Validate Critical Variables
if [ -z "${MONGODB_URI:-}" ]; then
    echo -e "${RED}✘ MONGODB_URI is not set in ${ENV_FILE}!${NC}"
    exit 1
fi

MT5_URL="${NEXUS_MT5_REMOTE_URL:-${MT5_BRIDGE_URL:-http://3.134.38.206:8765}}"
echo -e "${GREEN}✔ Environment loaded successfully.${NC}"
echo -e "  • Mode:            ${BOLD}${MODE^^}${NC}"
echo -e "  • Web Port:        ${BOLD}${PORT}${NC}"
echo -e "  • MT5 Bridge URL:  ${BOLD}${MT5_URL}${NC}"

# -----------------------------------------------------------------------------
# 2. MT5 Bridge Connectivity Check
# -----------------------------------------------------------------------------
echo -e "\n${BLUE}ℹ Checking MT5 Bridge connectivity at ${MT5_URL}...${NC}"
if command -v curl >/dev/null 2>&1; then
    HEALTH_RESP=$(curl -s --max-time 3 "${MT5_URL}/health" 2>/dev/null || true)
    if [[ "$HEALTH_RESP" == *"ok"* ]] || [[ "$HEALTH_RESP" == *"terminal"* ]]; then
        echo -e "${GREEN}✔ MT5 Remote Bridge is ONLINE and reachable.${NC}"
    else
        echo -e "${YELLOW}⚠ MT5 Remote Bridge is not responding at ${MT5_URL}/health.${NC}"
        echo -e "${YELLOW}  (Ensure mt5_server.py is running on your Windows VPS or pass --with-mt5 if running locally).${NC}"
    fi
else
    echo -e "${YELLOW}curl not installed; skipping MT5 pre-check.${NC}"
fi

# -----------------------------------------------------------------------------
# 3. Port Cleanup (Prevent EADDRINUSE)
# -----------------------------------------------------------------------------
echo -e "\n${BLUE}ℹ Verifying port ${PORT} availability...${NC}"
kill_port() {
    local target_port="$1"
    local pid=""
    if command -v lsof >/dev/null 2>&1; then
        pid=$(lsof -ti :"$target_port" 2>/dev/null || true)
    elif command -v fuser >/dev/null 2>&1; then
        pid=$(fuser "$target_port"/tcp 2>/dev/null || true)
    fi

    if [ -n "$pid" ]; then
        echo -e "${YELLOW}Port ${target_port} is currently occupied by PID(s): ${pid}. Terminating stale process...${NC}"
        kill -9 $pid 2>/dev/null || true
        sleep 1
        echo -e "${GREEN}✔ Port ${target_port} released.${NC}"
    else
        echo -e "${GREEN}✔ Port ${target_port} is clear.${NC}"
    fi
}

kill_port "$PORT"

# -----------------------------------------------------------------------------
# 4. Process Cleanup Traps (Graceful Shutdown)
# -----------------------------------------------------------------------------
SERVER_PID=""
MT5_PID=""
TAIL_PID=""

cleanup() {
    echo -e "\n\n${YELLOW}Caught shutdown signal (Ctrl+C / SIGTERM). Stopping TradeSpace services...${NC}"
    
    if [ -n "$TAIL_PID" ]; then
        kill -9 "$TAIL_PID" 2>/dev/null || true
    fi

    if [ -n "$SERVER_PID" ]; then
        echo -e "Stopping TradeSpace Server (PID: $SERVER_PID)..."
        kill -TERM "$SERVER_PID" 2>/dev/null || true
    fi

    if [ -n "$MT5_PID" ]; then
        echo -e "Stopping Local MT5 Server (PID: $MT5_PID)..."
        kill -TERM "$MT5_PID" 2>/dev/null || true
    fi

    sleep 1
    echo -e "${GREEN}All TradeSpace services stopped cleanly.${NC}"
    exit 0
}

trap cleanup SIGINT SIGTERM

# -----------------------------------------------------------------------------
# 5. Optional Local MT5 Server Launch
# -----------------------------------------------------------------------------
if [ "$START_MT5" = true ]; then
    echo -e "\n${BLUE}ℹ Launching local python mt5_server.py on port 8765...${NC}"
    kill_port 8765
    
    PYTHON_CMD=""
    for cmd in python3 python py; do
        if command -v "$cmd" >/dev/null 2>&1; then
            PYTHON_CMD="$cmd"
            break
        fi
    done

    if [ -n "$PYTHON_CMD" ]; then
        "$PYTHON_CMD" mt5_server.py --host 0.0.0.0 --port 8765 > mt5_server.log 2>&1 &
        MT5_PID=$!
        echo -e "${GREEN}✔ Local MT5 Bridge started (PID: $MT5_PID, Log: mt5_server.log)${NC}"
    else
        echo -e "${RED}✘ Python 3 not found. Skipping local MT5 server launch.${NC}"
    fi
fi

# -----------------------------------------------------------------------------
# 6. Production Build Check & Launch
# -----------------------------------------------------------------------------
if [ "$MODE" = "prod" ]; then
    echo -e "\n${BLUE}ℹ Production Mode Selected.${NC}"
    if [ "$FORCE_BUILD" = true ] || [ ! -d ".next" ] || [ ! -f ".next/BUILD_ID" ] || [ ! -f ".next/server/app/autonomous/page.js" ]; then
        if [ "$FORCE_BUILD" = true ]; then
            echo -e "${YELLOW}Fresh build requested via --build flag.${NC}"
        else
            echo -e "${YELLOW}Production build (.next) not found or incomplete.${NC}"
        fi
        echo -e "${YELLOW}Compiling optimized Next.js production build (npm run build)...${NC}"
        npm run build
        echo -e "${GREEN}✔ Production build completed successfully.${NC}"
    else
        echo -e "${GREEN}✔ Existing production build found (.next/BUILD_ID).${NC}"
        echo -e "  ${YELLOW}(Tip: pass --build if you pulled new code: ./start.sh --build)${NC}"
    fi

    echo -e "\n${GREEN}🚀 Starting TradeSpace Production Server...${NC}"
    NODE_ENV=production node --max-old-space-size=1024 server.js > "$LOG_FILE" 2>&1 &
    SERVER_PID=$!
else
    # Clean stale production build cache to prevent Webpack runtime chunk collisions (MODULE_NOT_FOUND)
    if [ -f ".next/BUILD_ID" ]; then
        echo -e "${YELLOW}ℹ Clearing stale production build cache for development mode...${NC}"
        rm -rf .next
    fi
    echo -e "\n${GREEN}🚀 Starting TradeSpace Development Server (with hot reload)...${NC}"
    NODE_ENV=development node --max-old-space-size=1024 server.js > "$LOG_FILE" 2>&1 &
    SERVER_PID=$!
fi

# Verify process stayed alive
sleep 2
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo -e "${RED}✘ Server failed to start! Last 20 lines of ${LOG_FILE}:${NC}"
    tail -n 20 "$LOG_FILE"
    exit 1
fi

echo -e "${GREEN}✔ TradeSpace Server is running! (PID: ${SERVER_PID})${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
echo -e "  🌐 Dashboard URL:       ${BOLD}http://localhost:${PORT}${NC}"
echo -e "  🤖 Autonomous Cockpit:  ${BOLD}http://localhost:${PORT}/autonomous${NC}"
echo -e "  📡 WebSocket Feed:      ${BOLD}ws://localhost:${PORT}/ws${NC}"
echo -e "  📄 Server Logs:         ${BOLD}tail -f ${LOG_FILE}${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}Press [Ctrl+C] to stop all services gracefully.${NC}\n"

# Stream logs in foreground so user sees live health and can Ctrl+C
tail -n 15 -f "$LOG_FILE" &
TAIL_PID=$!

# Wait for server process
wait "$SERVER_PID"
