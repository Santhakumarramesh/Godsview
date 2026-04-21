#!/bin/bash
# GodsView Deploy Readiness Check
# Run before any production deployment

set -e

echo "=================================="
echo "  GodsView Deploy Readiness"
echo "=================================="

errors=0

# 1. Check service count
svc_count=$(ls -d services/*/main.py services/*/app/main.py 2>/dev/null | wc -l)
echo "Services: $svc_count (need >= 12)"
[ "$svc_count" -ge 12 ] || { echo "  FAIL: Missing services"; errors=$((errors+1)); }

# 2. Check page count
page_count=$(find apps/web/src/app -name "page.tsx" 2>/dev/null | wc -l)
echo "Pages: $page_count (need >= 68)"
[ "$page_count" -ge 68 ] || { echo "  FAIL: Missing pages"; errors=$((errors+1)); }

# 3. Check sidebar routes
sidebar_routes=$(grep -c 'href:' apps/web/src/lib/sidebar.ts 2>/dev/null)
echo "Sidebar routes: $sidebar_routes (need >= 68)"
[ "$sidebar_routes" -ge 68 ] || { echo "  FAIL: Sidebar incomplete"; errors=$((errors+1)); }

# 4. Check shared types
type_count=$(ls packages/types/src/*.ts 2>/dev/null | wc -l)
echo "Type modules: $type_count (need >= 14)"
[ "$type_count" -ge 14 ] || { echo "  FAIL: Missing types"; errors=$((errors+1)); }

# 5. Check docker-compose
compose_svcs=$(grep -c 'image:\|command:' services/docker-compose.yml 2>/dev/null)
echo "Docker services: $compose_svcs"

# 6. Check migrations
migration_count=$(ls services/control_plane/alembic/versions/*.py 2>/dev/null | grep -v __init__ | grep -v __pycache__ | wc -l)
echo "Migrations: $migration_count"

# 7. Check env template
[ -f env.production.template ] && echo "Env template: present" || echo "Env template: MISSING"

echo ""
if [ "$errors" -eq 0 ]; then
  echo "DEPLOY READINESS: PASS"
  exit 0
else
  echo "DEPLOY READINESS: FAIL ($errors issues)"
  exit 1
fi
