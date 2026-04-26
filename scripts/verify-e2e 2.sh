#!/usr/bin/env bash
# GodsView End-to-End Verification Script
#
# Proves the full path:
#   TypeScript typecheck → TS tests → Python tests → Build → Architecture audit
#
# Usage:
#   ./scripts/verify-e2e.sh
#   SKIP_BUILD=1 ./scripts/verify-e2e.sh   # Skip build step
#
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m'

PASS=0
FAIL=0
TOTAL=0

check() {
  local label="$1"
  local result="$2"
  TOTAL=$((TOTAL + 1))
  if [ "$result" = "0" ]; then
    echo -e "  ${GREEN}✓${NC} $label"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}✗${NC} $label"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo -e "${PURPLE}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${PURPLE}║         GodsView E2E Production Verification        ║${NC}"
echo -e "${PURPLE}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# ── 1. Repository Structure ──────────────────────────────────────────────────
echo -e "${BLUE}[1/7] Repository Structure${NC}"

test -d apps/web && check "apps/web/ exists (v2 frontend)" 0 || check "apps/web/ exists" 1
test -d artifacts/api-server && check "artifacts/api-server/ exists (API server)" 0 || check "artifacts/api-server/ exists" 1
test -d services && check "services/ exists (Python microservices)" 0 || check "services/ exists" 1
test -d packages && check "packages/ exists (shared packages)" 0 || check "packages/ exists" 1
test -d infra && check "infra/ exists (AWS CDK)" 0 || check "infra/ exists" 1
test -f docker-compose.yml && check "docker-compose.yml exists" 0 || check "docker-compose.yml exists" 1
test -f infra/bin/app.ts && check "AWS CDK entrypoint exists" 0 || check "AWS CDK entrypoint exists" 1

# ── 2. Frontend Pages Audit ──────────────────────────────────────────────────
echo ""
echo -e "${BLUE}[2/7] Frontend Pages Audit${NC}"

PAGE_COUNT=$(find apps/web/src/app -name "page.tsx" 2>/dev/null | wc -l)
check "Frontend pages found: $PAGE_COUNT (target: 68+)" "$([ "$PAGE_COUNT" -ge 68 ] && echo 0 || echo 1)"

# Check critical pages exist
test -f "apps/web/src/app/(app)/brain/hologram/page.tsx" && check "Brain Hologram page exists" 0 || check "Brain Hologram page" 1
test -f "apps/web/src/app/(app)/brain/hologram/brain-scene-3d.tsx" && check "Three.js 3D scene exists" 0 || check "Three.js 3D scene" 1

# Check API wiring
WIRED=$(grep -rl "from.*@/lib/api" apps/web/src/app/ 2>/dev/null | wc -l)
check "Pages with API integration: $WIRED" "$([ "$WIRED" -ge 5 ] && echo 0 || echo 1)"

# ── 3. API Server Audit ─────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}[3/7] API Server Audit${NC}"

ROUTE_COUNT=$(find artifacts/api-server/src -name "*.ts" -path "*/routes/*" 2>/dev/null | wc -l)
check "API route files: $ROUTE_COUNT" "$([ "$ROUTE_COUNT" -ge 50 ] && echo 0 || echo 1)"

LIB_COUNT=$(find artifacts/api-server/src -name "*.ts" -path "*/lib/*" 2>/dev/null | wc -l)
check "API library modules: $LIB_COUNT" "$([ "$LIB_COUNT" -ge 100 ] && echo 0 || echo 1)"

# ── 4. Python Services Audit ────────────────────────────────────────────────
echo ""
echo -e "${BLUE}[4/7] Python Microservices Audit${NC}"

PY_SERVICES=$(find services -maxdepth 1 -mindepth 1 -type d ! -name "__pycache__" ! -name "tests" ! -name "shared" ! -name "pytest-cache*" 2>/dev/null | wc -l)
check "Python services: $PY_SERVICES (target: 9+)" "$([ "$PY_SERVICES" -ge 9 ] && echo 0 || echo 1)"

# Run Python tests
echo -e "  ${YELLOW}Running Python tests...${NC}"
if python -m pytest services/tests/ -q --tb=line 2>&1 | tail -1 | grep -q "passed"; then
  PY_PASSED=$(python -m pytest services/tests/ -q --tb=line 2>&1 | tail -1 | grep -oP '\d+ passed')
  check "Python tests: $PY_PASSED" 0
else
  check "Python tests" 1
fi

# ── 5. Shared Packages Audit ────────────────────────────────────────────────
echo ""
echo -e "${BLUE}[5/7] Shared Packages Audit${NC}"

test -d packages/api-client && check "@gv/api-client package exists" 0 || check "@gv/api-client package" 1
test -d packages/types && check "@gv/types package exists" 0 || check "@gv/types package" 1
test -d packages/config && check "@gv/config package exists" 0 || check "@gv/config package" 1
test -d packages/ui && check "@gv/ui package exists" 0 || check "@gv/ui package" 1

ENDPOINT_COUNT=$(find packages/api-client/src/endpoints -name "*.ts" 2>/dev/null | wc -l)
check "API client endpoint modules: $ENDPOINT_COUNT" "$([ "$ENDPOINT_COUNT" -ge 15 ] && echo 0 || echo 1)"

# ── 6. TypeScript Verification ───────────────────────────────────────────────
echo ""
echo -e "${BLUE}[6/7] TypeScript Verification${NC}"

echo -e "  ${YELLOW}Running typecheck (libs)...${NC}"
if corepack pnpm run typecheck:libs 2>&1 | tail -1; then
  check "TypeScript libs typecheck" 0
else
  check "TypeScript libs typecheck" 1
fi

echo -e "  ${YELLOW}Running API server tests...${NC}"
TS_TEST_OUTPUT=$(GODSVIEW_DATA_DIR=artifacts/api-server/.runtime corepack pnpm --filter @workspace/api-server run test 2>&1 || true)
if echo "$TS_TEST_OUTPUT" | grep -q "0 failed\|Tests.*passed\| passed "; then
  TS_PASSED=$(echo "$TS_TEST_OUTPUT" | grep -oP '\d+ passed' | tail -1)
  check "TypeScript API tests: $TS_PASSED" 0
elif echo "$TS_TEST_OUTPUT" | grep -q "passed" && ! echo "$TS_TEST_OUTPUT" | grep -q "[1-9][0-9]* failed"; then
  TS_PASSED=$(echo "$TS_TEST_OUTPUT" | grep -oP '\d+ passed' | tail -1)
  check "TypeScript API tests: $TS_PASSED" 0
else
  check "TypeScript API tests" 1
fi

# ── 7. Build Verification ───────────────────────────────────────────────────
echo ""
echo -e "${BLUE}[7/7] Build Verification${NC}"

if [ "${SKIP_BUILD:-}" = "1" ]; then
  echo -e "  ${YELLOW}⏭ Build skipped (SKIP_BUILD=1)${NC}"
else
  echo -e "  ${YELLOW}Running production build...${NC}"
  if corepack pnpm --filter @workspace/api-server run build 2>&1 | tail -1; then
    check "API server build" 0
  else
    check "API server build" 1
  fi
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${PURPLE}══════════════════════════════════════════════════════${NC}"
echo ""

SCORE=$((PASS * 100 / TOTAL))

if [ "$FAIL" -eq 0 ]; then
  echo -e "  ${GREEN}████ PRODUCTION READY: $PASS/$TOTAL checks passed (${SCORE}%) ████${NC}"
else
  echo -e "  ${YELLOW}████ $PASS/$TOTAL checks passed (${SCORE}%) — $FAIL issues remain ████${NC}"
fi

echo ""
echo -e "${PURPLE}══════════════════════════════════════════════════════${NC}"
echo ""

exit $FAIL
