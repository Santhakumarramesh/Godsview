#!/usr/bin/env bash
# bootstrap.sh — one-shot local environment bring-up.
#
# Safe to re-run. Intended for a fresh clone or after `make dev-reset`.
#
# Steps:
#   1. Verify required toolchains (docker, pnpm, python, uv).
#   2. Install workspace node modules.
#   3. Install control plane python deps (editable + dev extras).
#   4. Stand up the compose stack.
#   5. Wait for postgres to be ready, then run Alembic migrations.
#   6. Seed bootstrap admin + feature flags + system config.
#   7. Print access summary.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# ── env loader ───────────────────────────────────────────────────────
ENV_FILE="ops/envs/.env.dev"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "→ First run: copying ops/envs/.env.dev.example → $ENV_FILE"
  cp ops/envs/.env.dev.example "$ENV_FILE"
fi
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

# ── tool checks ──────────────────────────────────────────────────────
need() { command -v "$1" >/dev/null 2>&1 || { echo "✗ missing: $1"; exit 1; }; }
need docker
need pnpm
need python3

# ── node deps ────────────────────────────────────────────────────────
echo "→ pnpm install"
pnpm install --frozen-lockfile=false

# ── python deps ──────────────────────────────────────────────────────
echo "→ python deps for services/control_plane"
(
  cd services/control_plane
  python3 -m pip install --upgrade pip >/dev/null
  python3 -m pip install -e '.[dev]'
)

# ── compose ──────────────────────────────────────────────────────────
echo "→ docker compose up"
docker compose -f infra/compose/docker-compose.yml up -d

# ── wait for postgres ────────────────────────────────────────────────
echo -n "→ waiting for postgres"
for _ in $(seq 1 60); do
  if docker exec gv-postgres pg_isready -U godsview -d godsview >/dev/null 2>&1; then
    echo " ✓"
    break
  fi
  echo -n "."
  sleep 1
done

# ── migrate + seed ───────────────────────────────────────────────────
echo "→ alembic upgrade head"
(cd services/control_plane && python3 -m alembic upgrade head)

echo "→ seed bootstrap admin + flags + system config"
(cd services/control_plane && python3 -m app.scripts.seed_bootstrap)

# ── summary ──────────────────────────────────────────────────────────
cat <<EOF

────────────────────────────────────────────────────────────────────
GodsView v2 dev stack is up.

  control plane  → http://localhost:8000   (FastAPI)
  web app        → http://localhost:3000   (run: pnpm --filter @gv/web dev)
  postgres       → localhost:5432          user=godsview pw=godsview
  redis          → localhost:6379
  minio console  → http://localhost:9001   user=godsview pw=godsview-dev-secret
  mailhog        → http://localhost:8025
  localstack     → http://localhost:4566

  bootstrap admin → ${BOOTSTRAP_ADMIN_EMAIL}

Next steps:
  make api          # run the control plane in the foreground
  make web          # run the Next.js dev server
  make logs         # tail compose service logs
────────────────────────────────────────────────────────────────────
EOF
