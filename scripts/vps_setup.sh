#!/usr/bin/env bash
# =============================================================================
# TradeSpace — Oracle Cloud Linux Always Free VPS Auto-Installer
# Supported OS: Ubuntu 22.04 / 24.04 LTS (x86_64 or aarch64)
# =============================================================================
set -e

echo "============================================================"
echo "  TradeSpace Production Installer for Oracle Cloud Linux"
echo "============================================================"

# 1. Root Check
if [ "$EUID" -ne 0 ]; then
  echo "[-] Please run as root: sudo bash scripts/vps_setup.sh"
  exit 1
fi

ARCH=$(uname -m)
echo "[+] Detected CPU Architecture: $ARCH"

# 2. Swap Space Setup (Mandatory for Oracle Free Tier 1GB RAM to prevent OOM)
SWAP_SIZE="4G"
if ! swapon --show | grep -q "/swapfile"; then
  echo "[+] Creating $SWAP_SIZE swap file to prevent Next.js build Out-Of-Memory crashes..."
  fallocate -l $SWAP_SIZE /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "[+] Swap created successfully."
else
  echo "[+] Swap is already active."
fi

# 3. System Updates & Essential Tools
echo "[+] Updating system packages..."
apt-get update -y && apt-get upgrade -y
apt-get install -y curl wget git build-essential ufw software-properties-common unzip xvfb x11vnc

# 4. Open Oracle Linux Firewall (iptables + UFW)
echo "[+] Configuring Linux Firewall for TradeSpace..."
# Oracle Ubuntu images have default iptables rules that block non-SSH ports
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3000 -j ACCEPT || true
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 8765 -j ACCEPT || true
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT || true
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT || true

if command -v netfilter-persistent >/dev/null 2>&1; then
  netfilter-persistent save || true
fi

# 5. Node.js 20 LTS Setup
if ! command -v node >/dev/null 2>&1; then
  echo "[+] Installing Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  echo "[+] Node.js is already installed: $(node -v)"
fi

# 6. PM2 Process Manager
if ! command -v pm2 >/dev/null 2>&1; then
  echo "[+] Installing PM2..."
  npm install -g pm2
fi

echo "============================================================"
echo "  Base TradeSpace Dependencies Installed Successfully!"
echo "============================================================"
