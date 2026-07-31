#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/bufet.lol}"
SERVICE="bufet"

echo "==> Pulling latest code, installing deps, building..."
sudo -u bufet sh -c "cd '$APP_DIR' && git pull && pnpm install && pnpm build"

echo "==> Restarting service..."
sudo systemctl restart "$SERVICE"

echo "==> Done. Service status:"
systemctl is-active "$SERVICE"
