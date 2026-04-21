#!/usr/bin/env bash
# reset.sh — tear down the compose stack AND all persistent volumes.
#
# DESTRUCTIVE. Prompts for confirmation unless RESET_FORCE=1 is exported.
# Useful when a migration goes sideways locally and you just want a
# blank slate.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

if [[ "${RESET_FORCE:-0}" != "1" ]]; then
  echo "This will remove gv-postgres-data, gv-redis-data, gv-minio-data, gv-localstack-data."
  read -rp "Type 'wipe' to continue: " answer
  if [[ "$answer" != "wipe" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

docker compose -f infra/compose/docker-compose.yml down -v
echo "✓ compose stack down, volumes removed."
