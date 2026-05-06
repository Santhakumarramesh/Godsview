#!/bin/sh
set -e

# ─────────────────────────────────────────────────────────────────
# GodsView — Production Entrypoint
# 1. Wait for PostgreSQL to accept connections
# 2. Run database migrations (Drizzle)
# 3. Start the API server
# ─────────────────────────────────────────────────────────────────

echo "╔══════════════════════════════════════════════╗"
echo "║        GodsView — Starting Production        ║"
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

  # ── Step 2b: Apply supplemental SQL migrations ────────────────────────
  #
  # The Drizzle migrator above only applies entries listed in
  # lib/db/migrations/meta/_journal.json (currently just 0000_initial).
  # Migrations 0001-NNNN are kept as standalone idempotent .sql files
  # using ADD COLUMN IF NOT EXISTS / ADD CONSTRAINT IF NOT EXISTS, applied
  # by lib/db/src/run-sql-migrations.ts on every boot.
  #
  # Why we use the dedicated runner instead of an inline `node -e` block:
  # pnpm does not hoist the `pg` dependency to /app/node_modules (it lives
  # under /app/lib/db/node_modules/pg via symlink), so an inline
  # `import('pg')` from /app silently fails to resolve and every .sql
  # file gets logged as SKIP. tsx resolves workspace symlinks correctly,
  # so npx tsx finds pg through @workspace/db without any hoisting.
  echo "[entrypoint] Applying supplemental migration SQL files..."
  if npx tsx ./lib/db/src/run-sql-migrations.ts 2>&1; then
    echo "[entrypoint] Supplemental SQL migrations applied"
  else
    echo "[entrypoint] WARNING: supplemental SQL runner failed — server will attempt to start anyway"
  fi
else
  echo "[entrypoint] No DATABASE_URL — using PGlite (in-process, dev mode)"
fi

# ── Step 3: Start API server ─────────────────────────────────────
echo "[entrypoint] Starting GodsView API server on port ${PORT:-3001}..."
exec node --enable-source-maps ./artifacts/api-server/dist/index.mjs
