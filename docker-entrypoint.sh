#!/bin/sh
set -e

# ─────────────────────────────────────────────────────────────────
# GodsView — Production Entrypoint (Node.js API Server)
# 1. Wait for PostgreSQL to accept connections
# 2. Run database migrations (Drizzle)
# 3. Ensure SQLite data directories exist
# 4. Start the Node.js API server
# ─────────────────────────────────────────────────────────────────

echo "╔══════════════════════════════════════════════╗"
echo "║    GodsView API Server — Starting Production ║"
echo "╚══════════════════════════════════════════════╝"

# ── Step 1: Wait for PostgreSQL ──────────────────────────────────
if [ -n "$DATABASE_URL" ]; then
  echo "[entrypoint] Waiting for PostgreSQL..."

  # Extract host:port from DATABASE_URL
  DB_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:/]*\).*|\1|p')
  DB_PORT=$(echo "$DATABASE_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
  DB_PORT=${DB_PORT:-5432}

  RETRIES=30
  until curl -sf "http://${DB_HOST}:${DB_PORT}" >/dev/null 2>&1 || \
        node -e "
          const net = require('net');
          const s = new net.Socket();
          s.connect(${DB_PORT}, '${DB_HOST}', () => { s.destroy(); process.exit(0); });
          s.on('error', () => process.exit(1));
        " 2>/dev/null; do
    RETRIES=$((RETRIES - 1))
    if [ "$RETRIES" -le 0 ]; then
      echo "[entrypoint] ERROR: PostgreSQL not reachable at ${DB_HOST}:${DB_PORT} after 30 attempts"
      exit 1
    fi
    echo "[entrypoint] PostgreSQL not ready — retrying in 1s (${RETRIES} left)..."
    sleep 1
  done

  echo "[entrypoint] PostgreSQL is accepting connections"

  # ── Step 2: Run Drizzle migrations ─────────────────────────────
  echo "[entrypoint] Running database migrations..."
  if npx tsx ./lib/db/src/migrate.ts 2>&1; then
    echo "[entrypoint] Migrations completed successfully"
  else
    echo "[entrypoint] WARNING: Migration runner failed — server will attempt to start anyway"
  fi
else
  echo "[entrypoint] No DATABASE_URL — using PGlite (in-process, dev mode)"
fi

# ── Step 3: Ensure SQLite data directories exist ──────────────────
echo "[entrypoint] Setting up data directories for SQLite databases..."
DATA_DIR="${GODSVIEW_DATA_DIR:-/app/data}"
mkdir -p "$DATA_DIR" || true

# Create governance directory for audit logs
GOVERNANCE_DIR="$(dirname "${GOVERNANCE_DB_PATH:-$DATA_DIR/governance.db}")"
mkdir -p "$GOVERNANCE_DIR" || true

# Create screenshot directory
mkdir -p "${SCREENSHOT_DIR:-$DATA_DIR/screenshots}" || true

# Create experiment tracking directory
EXPERIMENT_DIR="$(dirname "${EXPERIMENT_DB_PATH:-$DATA_DIR/experiments.db}")"
mkdir -p "$EXPERIMENT_DIR" || true

# Create promotion pipeline directory
PROMOTION_DIR="$(dirname "${PROMOTION_DB_PATH:-$DATA_DIR/promotions.db}")"
mkdir -p "$PROMOTION_DIR" || true

echo "[entrypoint] Data directories ready"

# ── Step 4: Start API server ─────────────────────────────────────
echo "[entrypoint] Starting GodsView API server on port ${PORT:-3001}..."
echo "[entrypoint] Python v2 services enabled: ${PY_SERVICES_ENABLED:-true}"
echo "[entrypoint] System mode: ${GODSVIEW_SYSTEM_MODE:-paper}"
exec node --enable-source-maps ./artifacts/api-server/dist/index.mjs
