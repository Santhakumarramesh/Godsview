#!/usr/bin/env bash
# ── GodsView Production Start ────────────────────────────────────────
# Builds both dashboard + API, then starts the server.
#
# Usage:
#   ./scripts/start-prod.sh              # default port 3000
#   PORT=8080 ./scripts/start-prod.sh    # custom port

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "━━━ GodsView Production Build ━━━"
echo ""

# 1. Install deps
echo "→ Installing dependencies..."
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
echo ""

# 2. Build shared libs
echo "→ Building shared libraries..."
pnpm run typecheck:libs 2>/dev/null || true
echo ""

# 3. Build API server
echo "→ Building API server..."
cd "$ROOT_DIR/artifacts/api-server"
pnpm run build
echo ""

# 4. Build dashboard
echo "→ Building dashboard..."
cd "$ROOT_DIR/artifacts/godsview-dashboard"
pnpm run build
echo ""

# 5. Start
cd "$ROOT_DIR"
export NODE_ENV=production
export PORT="${PORT:-3000}"

echo "━━━ Starting GodsView on port $PORT ━━━"
echo "  Dashboard: http://localhost:$PORT"
echo "  API:       http://localhost:$PORT/api"
echo "  Health:    http://localhost:$PORT/api/healthz"
echo ""

exec node --enable-source-maps artifacts/api-server/dist/index.mjs
