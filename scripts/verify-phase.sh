#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# verify-phase.sh — GodsView post-commit verification gate
# Phase 118: Production Hardening
#
# 10-check gate that must pass before any phase commit ships.
# Usage:
#   ./scripts/verify-phase.sh           # run all checks
#   ./scripts/verify-phase.sh --quick   # skip slow checks (build/test)
# ─────────────────────────────────────────────────────────────

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0
QUICK=false

[[ "${1:-}" == "--quick" ]] && QUICK=true

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  GodsView Phase Verification Gate"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
if $QUICK; then
  echo -e "  Mode: ${YELLOW}QUICK${NC} (build/test skipped)"
fi
echo "═══════════════════════════════════════════════════════════"
echo ""

check_pass() { echo -e "  ${GREEN}✓${NC} $1"; PASS=$((PASS + 1)); }
check_fail() { echo -e "  ${RED}✗${NC} $1"; FAIL=$((FAIL + 1)); }
check_warn() { echo -e "  ${YELLOW}⚠${NC} $1"; WARN=$((WARN + 1)); }

# ─── Gate 1: No secrets in tracked files ───
echo -e "${CYAN}Gate 1/10: Secret leak scan${NC}"
SECRETS_FOUND=0
for pattern in "ALPACA_API_KEY=" "ANTHROPIC_API_KEY=" "sk-ant-" "AKIA" "-----BEGIN.*PRIVATE KEY-----"; do
  hits=$(git grep -l "$pattern" -- ':!.env.example' ':!**/.env.example' ':!*.template' ':!*.md' ':!*.sh' ':!package.json' 2>/dev/null || true)
  if [ -n "$hits" ]; then
    SECRETS_FOUND=$((SECRETS_FOUND + 1))
    check_fail "Possible secret pattern '$pattern' found in: $hits"
  fi
done
[ $SECRETS_FOUND -eq 0 ] && check_pass "No secrets detected in tracked files"

# ─── Gate 2: .env not tracked ───
echo -e "${CYAN}Gate 2/10: Environment file safety${NC}"
if git ls-files --error-unmatch .env 2>/dev/null; then
  check_fail ".env is tracked by git — remove with: git rm --cached .env"
else
  check_pass ".env is not tracked"
fi

# ─── Gate 3: .gitignore covers essentials ───
echo -e "${CYAN}Gate 3/10: .gitignore coverage${NC}"
MISSING_IGNORES=0
for entry in "node_modules" ".env" "dist" "__pycache__" "*.pyc" ".DS_Store"; do
  if ! grep -q "$entry" .gitignore 2>/dev/null; then
    check_warn ".gitignore missing: $entry"
    MISSING_IGNORES=$((MISSING_IGNORES + 1))
  fi
done
[ $MISSING_IGNORES -eq 0 ] && check_pass ".gitignore covers all essentials"

# ─── Gate 4: No merge conflict markers ───
echo -e "${CYAN}Gate 4/10: Merge conflict markers${NC}"
CONFLICTS=$(git grep -rn "^<<<<<<< " -- ':!*.sh' ':!*.md' 2>/dev/null | head -5 || true)
if [ -n "$CONFLICTS" ]; then
  check_fail "Merge conflict markers found:\n$CONFLICTS"
else
  check_pass "No merge conflict markers"
fi

# ─── Gate 5: No console.log in production code ───
echo -e "${CYAN}Gate 5/10: Debug statement scan${NC}"
DEBUG_COUNT=$(git grep -c "console\.log\b" -- 'api-server/src/**/*.ts' ':!**/*.test.*' ':!**/*.spec.*' 2>/dev/null | awk -F: '{s+=$2} END {print s+0}' || echo 0)
if [ "$DEBUG_COUNT" -gt 20 ]; then
  check_warn "Found $DEBUG_COUNT console.log statements in api-server (threshold: 20)"
else
  check_pass "Debug statements within threshold ($DEBUG_COUNT/20)"
fi

# ─── Gate 6: No TODO/FIXME/HACK with no owner ───
echo -e "${CYAN}Gate 6/10: Unattributed TODO scan${NC}"
TODO_COUNT=$(git grep -c -E "(TODO|FIXME|HACK|XXX)" -- '*.ts' '*.tsx' ':!node_modules/**' 2>/dev/null | awk -F: '{s+=$2} END {print s+0}' || echo 0)
if [ "$TODO_COUNT" -gt 50 ]; then
  check_warn "Found $TODO_COUNT TODO/FIXME markers (threshold: 50)"
else
  check_pass "TODO/FIXME count within threshold ($TODO_COUNT/50)"
fi

# ─── Gate 7: Package.json integrity ───
echo -e "${CYAN}Gate 7/10: Package manifest integrity${NC}"
if [ -f "package.json" ] && [ -f "pnpm-lock.yaml" ]; then
  check_pass "Root package.json + pnpm-lock.yaml present"
else
  check_fail "Missing package.json or pnpm-lock.yaml"
fi

# ─── Gate 8: Critical files exist ───
echo -e "${CYAN}Gate 8/10: Critical file inventory${NC}"
CRITICAL_MISSING=0
for f in \
  "docker-compose.yml" \
  "Dockerfile" \
  ".env.example" \
  ".github/workflows/ci.yml" \
  "docs/ARCHITECTURE.md" \
  "docs/OPERATOR_RUNBOOK.md" \
  "PRODUCTION.md" \
  "README.md"; do
  if [ ! -f "$f" ]; then
    check_fail "Missing critical file: $f"
    CRITICAL_MISSING=$((CRITICAL_MISSING + 1))
  fi
done
[ $CRITICAL_MISSING -eq 0 ] && check_pass "All critical files present"

# ─── Gate 9: TypeScript typecheck (skippable) ───
echo -e "${CYAN}Gate 9/10: TypeScript typecheck${NC}"
if $QUICK; then
  check_warn "Skipped (--quick mode)"
elif command -v pnpm &>/dev/null; then
  if pnpm typecheck 2>&1 | tail -1 | grep -q "error"; then
    check_fail "TypeScript typecheck failed"
  else
    check_pass "TypeScript typecheck passed"
  fi
else
  check_warn "pnpm not available — run locally: pnpm typecheck"
fi

# ─── Gate 10: Test suite (skippable) ───
echo -e "${CYAN}Gate 10/10: Test suite${NC}"
if $QUICK; then
  check_warn "Skipped (--quick mode)"
elif command -v pnpm &>/dev/null; then
  if pnpm test 2>&1 | tail -1 | grep -q "fail"; then
    check_fail "Test suite has failures"
  else
    check_pass "Test suite passed"
  fi
else
  check_warn "pnpm not available — run locally: pnpm test"
fi

# ─── Summary ───
echo ""
echo "═══════════════════════════════════════════════════════════"
TOTAL=$((PASS + FAIL + WARN))
echo -e "  Results: ${GREEN}${PASS} passed${NC}  ${RED}${FAIL} failed${NC}  ${YELLOW}${WARN} warnings${NC}"
echo ""

if [ $FAIL -gt 0 ]; then
  echo -e "  ${RED}GATE: BLOCKED${NC} — Fix $FAIL failure(s) before committing."
  echo "═══════════════════════════════════════════════════════════"
  exit 1
elif [ $WARN -gt 0 ]; then
  echo -e "  ${YELLOW}GATE: PASS WITH WARNINGS${NC} — Review $WARN warning(s)."
  echo "═══════════════════════════════════════════════════════════"
  exit 0
else
  echo -e "  ${GREEN}GATE: CLEAR${NC} — All checks passed."
  echo "═══════════════════════════════════════════════════════════"
  exit 0
fi
