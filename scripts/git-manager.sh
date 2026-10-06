#!/usr/bin/env bash
# ==============================================================================
# TradeSpace Dual Git Manager (TradeSpace <-> TradeSpace_DEV)
#
# Roles:
#   - dev  (TradeSpace_DEV) : UAT & continuous development repository (UNLOCKED)
#   - prod (TradeSpace)     : Main production repository (LOCKED by default)
# ==============================================================================

set -euo pipefail

GIT_DIR="$(git rev-parse --git-dir 2>/dev/null || echo .git)"
LOCK_TOKEN="$GIT_DIR/TRADESPACE_PUSH_UNLOCKED"
PROD_REAL_URL="https://github.com/chandan2312/TradeSpace.git"
DEV_REAL_URL="https://github.com/chandan2312/TradeSpace_DEV.git"
LOCKED_DUMMY_URL="LOCKED_DO_NOT_PUSH_TO_TRADESPACE"

# Colors for terminal output
BOLD="\033[1m"
RED="\033[31m"
GREEN="\033[32m"
YELLOW="\033[33m"
CYAN="\033[36m"
MAGENTA="\033[35m"
RESET="\033[0m"

function get_lock_status() {
    local push_url
    push_url="$(git config --get remote.prod.pushurl 2>/dev/null || echo "")"
    if [ "$push_url" = "$LOCKED_DUMMY_URL" ] || [ ! -f "$LOCK_TOKEN" ]; then
        echo "LOCKED"
    else
        echo "UNLOCKED"
    fi
}

function lock_prod() {
    git remote set-url --push prod "$LOCKED_DUMMY_URL" 2>/dev/null || true
    rm -f "$LOCK_TOKEN"
    echo -e "${GREEN}🔒 [TradeSpace Main Repo] is now strictly LOCKED.${RESET}"
    echo -e "   Push URL set to: ${YELLOW}$LOCKED_DUMMY_URL${RESET}"
}

function unlock_prod() {
    git remote set-url --push prod "$PROD_REAL_URL" 2>/dev/null || true
    date -u +"%Y-%m-%dT%H:%M:%SZ" > "$LOCK_TOKEN"
    echo -e "${YELLOW}🔓 [TradeSpace Main Repo] is temporarily UNLOCKED.${RESET}"
    echo -e "   Push URL restored to: ${CYAN}$PROD_REAL_URL${RESET}"
}

function show_status() {
    local branch
    branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")"
    local lock_st
    lock_st="$(get_lock_status)"

    echo -e "${BOLD}${CYAN}====================================================================${RESET}"
    echo -e "${BOLD}${CYAN}            TRADESPACE DUAL GIT REPOSITORY MANAGER                  ${RESET}"
    echo -e "${BOLD}${CYAN}====================================================================${RESET}"
    echo -e "Current Branch    : ${BOLD}${GREEN}$branch${RESET}"
    
    if [ "$lock_st" = "LOCKED" ]; then
        echo -e "Main Repo (PROD)  : ${BOLD}${RED}🔒 LOCKED (TradeSpace)${RESET}"
    else
        echo -e "Main Repo (PROD)  : ${BOLD}${YELLOW}🔓 UNLOCKED (TradeSpace)${RESET}"
    fi
    echo -e "Dev Repo (DEV)    : ${BOLD}${GREEN}✓ ACTIVE (TradeSpace_DEV)${RESET}"
    echo ""
    echo -e "${BOLD}Configured Remotes:${RESET}"
    echo -e "  • ${BOLD}dev${RESET}   : $DEV_REAL_URL (Active UAT/Development push target)"
    echo -e "  • ${BOLD}origin${RESET}: $DEV_REAL_URL (Default push target)"
    echo -e "  • ${BOLD}prod${RESET}  : $PROD_REAL_URL (Fetch) | Push: $(git config --get remote.prod.pushurl 2>/dev/null || echo "$PROD_REAL_URL")"
    echo ""

    # Fetch status without disturbing working directory
    echo -e "${CYAN}Fetching latest remote refs...${RESET}"
    git fetch dev --quiet 2>/dev/null || true
    git fetch prod --quiet 2>/dev/null || true

    local local_sha prod_sha dev_sha
    local_sha="$(git rev-parse --short HEAD 2>/dev/null || echo "N/A")"
    dev_sha="$(git rev-parse --short "dev/$branch" 2>/dev/null || echo "N/A")"
    prod_sha="$(git rev-parse --short "prod/$branch" 2>/dev/null || echo "N/A")"

    echo -e "Commit Head:"
    echo -e "  • Local Head    : ${BOLD}$local_sha${RESET} ($(git log -1 --pretty=%s 2>/dev/null || echo ""))"
    echo -e "  • DEV (dev/$branch) : ${BOLD}$dev_sha${RESET}"
    echo -e "  • PROD (prod/$branch): ${BOLD}$prod_sha${RESET}"
    echo ""

    if git rev-parse --verify "prod/$branch" >/dev/null 2>&1; then
        local unpromoted
        unpromoted="$(git rev-list --count "prod/$branch..HEAD" 2>/dev/null || echo 0)"
        if [ "$unpromoted" -gt 0 ]; then
            echo -e "${YELLOW}⚡ $unpromoted commit(s) ready in DEV/Local awaiting promotion to PROD (TradeSpace).${RESET}"
            git log --oneline "prod/$branch..HEAD" -n 5 | sed 's/^/    /'
        else
            echo -e "${GREEN}✓ Main PROD (TradeSpace) is completely in sync with local branch.${RESET}"
        fi
    fi

    local dirty_files
    dirty_files="$(git status --porcelain | wc -l)"
    if [ "$dirty_files" -gt 0 ]; then
        echo ""
        echo -e "${YELLOW}Working directory has $dirty_files uncommitted changes.${RESET}"
    else
        echo ""
        echo -e "${GREEN}Working directory is clean.${RESET}"
    fi
    echo -e "${BOLD}${CYAN}====================================================================${RESET}"
}

function push_dev() {
    local branch
    branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")"
    echo -e "${CYAN}🚀 Pushing branch '${BOLD}$branch${RESET}${CYAN}' to DEV repository (TradeSpace_DEV)...${RESET}"
    git push dev "$branch" "$@"
    echo -e "${GREEN}✓ Successfully pushed to TradeSpace_DEV!${RESET}"
}

function push_prod() {
    local branch
    branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")"
    local explicit=0

    for arg in "$@"; do
        if [ "$arg" = "--explicit" ] || [ "$arg" = "--yes" ] || [ "$arg" = "-y" ]; then
            explicit=1
        fi
    done

    if [ "$explicit" -eq 0 ]; then
        echo -e "${RED}${BOLD}⚠️  ATTENTION: YOU ARE ATTEMPTING TO PUSH TO MAIN REPO (TradeSpace)!${RESET}"
        echo -e "By policy, TradeSpace is push-locked. Only push to TradeSpace when fully tested."
        read -r -p "Are you sure you want to unlock, push, and re-lock TradeSpace? [y/N]: " confirm
        if [[ ! "$confirm" =~ ^[yY](es)?$ ]]; then
            echo -e "${YELLOW}Push to TradeSpace cancelled.${RESET}"
            exit 0
        fi
    fi

    # Trap ensures re-locking even if push fails or is interrupted
    trap lock_prod EXIT INT TERM

    echo -e "${YELLOW}🔓 Unlocking TradeSpace main repo...${RESET}"
    unlock_prod

    echo -e "${CYAN}🚀 Pushing '${BOLD}$branch${RESET}${CYAN}' to TradeSpace (Production)...${RESET}"
    # Filter out --explicit or --yes flags before passing to git push
    local filtered_args=()
    for arg in "$@"; do
        if [ "$arg" != "--explicit" ] && [ "$arg" != "--yes" ] && [ "$arg" != "-y" ]; then
            filtered_args+=("$arg")
        fi
    done

    git push prod "$branch" "${filtered_args[@]}"

    echo -e "${GREEN}✓ Push to TradeSpace succeeded!${RESET}"
    # trap will automatically execute lock_prod
}

function show_diff() {
    local branch
    branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")"
    git fetch dev --quiet 2>/dev/null || true
    git fetch prod --quiet 2>/dev/null || true

    echo -e "${CYAN}Commits in DEV ($branch) not yet pushed to PROD (TradeSpace):${RESET}"
    git log --oneline --graph "prod/$branch..dev/$branch" || true
}

case "${1:-status}" in
    status)
        show_status
        ;;
    push-dev)
        shift
        push_dev "$@"
        ;;
    push-prod)
        shift
        push_prod "$@"
        ;;
    lock-prod)
        lock_prod
        ;;
    unlock-prod)
        unlock_prod
        ;;
    diff)
        show_diff
        ;;
    *)
        echo "Usage: $0 {status|push-dev|push-prod|lock-prod|unlock-prod|diff}"
        echo ""
        echo "Commands:"
        echo "  status       - Show remotes, lock status, and commit divergence"
        echo "  push-dev     - Push current branch to TradeSpace_DEV (UAT)"
        echo "  push-prod    - Unlock, push to TradeSpace (PROD), and immediately re-lock"
        echo "  lock-prod    - Enforce push lock on TradeSpace"
        echo "  unlock-prod  - Temporarily unlock TradeSpace"
        echo "  diff         - Show commits in DEV awaiting promotion to PROD"
        exit 1
        ;;
esac
