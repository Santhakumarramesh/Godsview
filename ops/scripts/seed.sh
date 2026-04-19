#!/usr/bin/env bash
# seed.sh — idempotent seed of bootstrap admin + feature flags + system config.
#
# Source of truth: services/control_plane/app/scripts/seed_bootstrap.py
# Safe to re-run; uses upsert semantics everywhere.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="ops/envs/.env.dev"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a
fi

cd services/control_plane
exec python3 -m app.scripts.seed_bootstrap
