#!/usr/bin/env bash
# migrate.sh — run Alembic migrations against the current DATABASE_URL.
#
# Defaults to upgrade head. Pass any Alembic subcommand to override:
#
#   ops/scripts/migrate.sh                 # upgrade head
#   ops/scripts/migrate.sh current         # show current revision
#   ops/scripts/migrate.sh downgrade -1    # rollback one revision
#   ops/scripts/migrate.sh history

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="ops/envs/.env.dev"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a
fi

cd services/control_plane
if [[ $# -eq 0 ]]; then
  exec python3 -m alembic upgrade head
fi
exec python3 -m alembic "$@"
