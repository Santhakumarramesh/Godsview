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

  # ── Step 2b: Run all SQL migration files (IF NOT EXISTS — safe to re-run) ──
  echo "[entrypoint] Applying supplemental migration SQL files..."
  for sqlfile in ./lib/db/migrations/*.sql; do
    if [ -f "$sqlfile" ]; then
      echo "[entrypoint]   Running $(basename "$sqlfile")..."
      # Use node with dynamic import for ESM pg driver, fallback to warning
      node -e "
        import('pg').then(({ default: pg }) => {
          const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
          const fs = require('fs');
          pool.query(fs.readFileSync('$sqlfile', 'utf8'))
            .then(() => { console.log('  OK'); pool.end(); })
            .catch(e => { console.error('  WARN:', e.message); pool.end(); });
        }).catch(() => {
          console.log('  SKIP (pg module not available — migrations handled by drizzle)');
        });
      " 2>&1 || echo "[entrypoint]   SKIP: supplemental SQL (non-critical)"
    fi
  done
else
  echo "[entrypoint] No DATABASE_URL — using PGlite (in-process, dev mode)"
fi

# ── Step 3: Start API server ─────────────────────────────────────
echo "[entrypoint] Starting GodsView API server on port ${PORT:-3001}..."
exec node --enable-source-maps ./artifacts/api-server/dist/index.mjs
