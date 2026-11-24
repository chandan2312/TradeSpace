#!/usr/bin/env bash
# =============================================================================
# TradeSpace Enterprise — Autostart & Resilience Setup Script
# =============================================================================
set -e
cd "$(dirname "$0")"
SCRIPT_DIR="$(pwd)"

echo -e "\n======================================================="
echo -e "   TradeSpace Enterprise — Autostart Configuration     "
echo -e "=======================================================\n"

# 1. Ensure scripts are executable
echo "[1/5] Making scripts executable..."
chmod +x manage.sh run_mt5_wine.sh

# 2. Create global symlink 'tradespace' and 'ts' in /usr/local/bin
echo "[2/5] Creating global CLI shortcuts ('tradespace' & 'ts')..."
sudo ln -sf "$SCRIPT_DIR/manage.sh" /usr/local/bin/tradespace
sudo ln -sf "$SCRIPT_DIR/manage.sh" /usr/local/bin/ts

# 3. Ensure firewall rules are permanently persistent across reboots
echo "[3/5] Persisting firewall rules for ports 3000 & 8765..."
sudo iptables -I INPUT 1 -p tcp --dport 3000 -j ACCEPT 2>/dev/null || true
sudo iptables -I INPUT 1 -p tcp --dport 8765 -j ACCEPT 2>/dev/null || true
sudo iptables -I INPUT 1 -p tcp --dport 6080 -j ACCEPT 2>/dev/null || true
sudo netfilter-persistent save 2>/dev/null || (sudo iptables-save | sudo tee /etc/iptables/rules.v4 > /dev/null)
sudo systemctl enable netfilter-persistent 2>/dev/null || true

# 4. Configure PM2 for automatic startup on reboot
echo "[4/5] Configuring PM2 systemd daemon for automatic startup on reboot..."
pm2 delete all 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save

# Automatically register with systemd
STARTUP_CMD=$(pm2 startup systemd -u "$USER" --hp "$HOME" 2>&1 | grep "sudo env" | tail -n 1)
if [ -n "$STARTUP_CMD" ]; then
  echo "[+] Executing PM2 systemd registration: $STARTUP_CMD"
  eval "$STARTUP_CMD"
fi
pm2 save

# 5. Verify system status
echo -e "\n[5/5] Performing verification..."
sleep 4
"$SCRIPT_DIR/manage.sh" status

echo -e "\n======================================================="
echo -e "   ✔ AUTOMATION SETUP COMPLETE!                        "
echo -e "======================================================="
echo -e "From now on, on server reboot or failure:"
echo -e "  • All services start automatically in the background"
echo -e "  • Auto-restart is handled automatically by PM2 & Wine Watchdog"
echo -e ""
echo -e "To manage your system anytime from ANY directory:"
echo -e "  • tradespace status    -> Check complete system health"
echo -e "  • tradespace restart   -> Restart everything in 1 command"
echo -e "  • tradespace logs      -> View live logs"
echo -e "=======================================================\n"
