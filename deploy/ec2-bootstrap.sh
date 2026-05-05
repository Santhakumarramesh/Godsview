#!/usr/bin/env bash
# Phase 5 — Single-EC2 bootstrap.
# Idempotent: safe to re-run.
# Tested on Amazon Linux 2023 and Ubuntu 24.04.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo bash $0" >&2
  exit 1
fi

# Detect package manager
if command -v dnf >/dev/null 2>&1; then PM="dnf"
elif command -v apt-get >/dev/null 2>&1; then PM="apt-get"
else echo "Unsupported distro (need dnf or apt-get)" >&2; exit 1; fi

echo "[bootstrap] Updating package index ..."
case "$PM" in
  dnf)     dnf -y update ;;
  apt-get) apt-get update -y ;;
esac

echo "[bootstrap] Installing baseline tools ..."
case "$PM" in
  dnf)     dnf -y install git curl jq tar gzip ;;
  apt-get) apt-get install -y git curl jq ca-certificates ;;
esac

echo "[bootstrap] Installing Docker ..."
case "$PM" in
  dnf)
    dnf -y install docker
    systemctl enable --now docker
    ;;
  apt-get)
    apt-get install -y docker.io docker-compose-plugin
    systemctl enable --now docker
    ;;
esac

# Compose plugin (Amazon Linux ships docker but not the plugin by default)
if ! docker compose version >/dev/null 2>&1; then
  echo "[bootstrap] Installing docker compose plugin ..."
  mkdir -p /usr/local/lib/docker/cli-plugins
  curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
  chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi

echo "[bootstrap] Creating directories under /opt/godsview and /data ..."
mkdir -p /opt/godsview /data/memory /data/postgres /data/backups
chown -R "${SUDO_USER:-ec2-user}":"${SUDO_USER:-ec2-user}" /opt/godsview /data || true

echo "[bootstrap] Adding ${SUDO_USER:-ec2-user} to docker group ..."
usermod -aG docker "${SUDO_USER:-ec2-user}" || true

echo ""
echo "==============================================================="
echo "Bootstrap complete."
echo ""
echo "Next steps (as ${SUDO_USER:-ec2-user}):"
echo "  1. Log out and back in (so docker group takes effect)"
echo "  2. cd /opt && git clone <your repo> godsview && cd godsview"
echo "  3. cp .env.example .env && \$EDITOR .env"
echo "  4. docker compose -f docker-compose.minimal.yml up -d --build"
echo "  5. See docs/PHASE_5/DEPLOY_SINGLE_EC2.md for the full guide."
echo "==============================================================="
