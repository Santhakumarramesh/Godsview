#!/usr/bin/env bash
# GodsView — Replit startup script
# Installs runtime deps (pglite) then launches the pre-built server.
set -e

echo "=== GodsView startup ==="

# ── Install @electric-sql/pglite (the only external dep not bundled) ──────
if [ ! -d "node_modules/@electric-sql/pglite" ]; then
  echo "[setup] Installing @electric-sql/pglite runtime dep..."
  mkdir -p /tmp/gv-deps
  cat > /tmp/gv-deps/package.json << 'EOF'
{"name":"gv-deps","version":"1.0.0","dependencies":{"@electric-sql/pglite":"^0.2.17"}}
EOF
  npm install --prefix /tmp/gv-deps --ignore-scripts --no-audit --no-fund 2>&1 | tail -3
  mkdir -p node_modules
  cp -r /tmp/gv-deps/node_modules/@electric-sql node_modules/@electric-sql
  echo "[setup] pglite installed ✓"
else
  echo "[setup] pglite already present ✓"
fi

# ── Defaults ──────────────────────────────────────────────────────────────
export PORT="${PORT:-3000}"
export NODE_ENV="${NODE_ENV:-production}"
export GODSVIEW_SYSTEM_MODE="${GODSVIEW_SYSTEM_MODE:-paper}"
export GODSVIEW_TRUST_PROXY="${GODSVIEW_TRUST_PROXY:-1}"

# Build a CORS origin list that covers all Replit URL patterns
REPLIT_ORIGINS=""
if [ -n "$REPL_SLUG" ] && [ -n "$REPL_OWNER" ]; then
  REPLIT_ORIGINS="https://${REPL_SLUG}.${REPL_OWNER}.repl.co,https://${REPL_SLUG}.${REPL_OWNER}.replit.app,https://${REPL_SLUG}.${REPL_OWNER}.replit.dev"
fi
export CORS_ORIGIN="${CORS_ORIGIN:-${REPLIT_ORIGINS:-http://localhost:3000}}"

# ── Launch ────────────────────────────────────────────────────────────────
echo "[start] PORT=$PORT NODE_ENV=$NODE_ENV mode=$GODSVIEW_SYSTEM_MODE"
exec node --enable-source-maps artifacts/api-server/dist/index.mjs
