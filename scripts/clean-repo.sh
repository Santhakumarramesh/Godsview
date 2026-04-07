#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# clean-repo.sh — GodsView automated repository cleanup
# Phase 118: Production Hardening
#
# Usage:
#   ./scripts/clean-repo.sh              # dry-run (default)
#   ./scripts/clean-repo.sh --execute    # actually delete
#   ./scripts/clean-repo.sh --help       # show help
# ─────────────────────────────────────────────────────────────

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

DRY_RUN=true
TOTAL_FREED=0
ITEMS_FOUND=0

usage() {
  echo "Usage: $0 [--execute | --dry-run | --help]"
  echo ""
  echo "  --dry-run   (default) Show what would be removed without deleting"
  echo "  --execute   Actually remove files and directories"
  echo "  --help      Show this message"
  exit 0
}

log_info()  { echo -e "${CYAN}[INFO]${NC}  $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_clean() { echo -e "${GREEN}[CLEAN]${NC} $1"; }
log_skip()  { echo -e "${YELLOW}[SKIP]${NC}  $1"; }
log_err()   { echo -e "${RED}[ERROR]${NC} $1"; }

# Parse args
case "${1:-}" in
  --execute) DRY_RUN=false ;;
  --dry-run|"") DRY_RUN=true ;;
  --help|-h) usage ;;
  *) log_err "Unknown flag: $1"; usage ;;
esac

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  GodsView Repository Cleanup"
if $DRY_RUN; then
  echo -e "  Mode: ${YELLOW}DRY RUN${NC} (use --execute to apply)"
else
  echo -e "  Mode: ${RED}EXECUTE${NC} (changes will be permanent)"
fi
echo "═══════════════════════════════════════════════════════════"
echo ""

# ─── Helper: track size and remove ───
remove_target() {
  local target="$1"
  local desc="$2"

  if [ ! -e "$target" ]; then
    return
  fi

  local size
  if [ -d "$target" ]; then
    size=$(du -sh "$target" 2>/dev/null | cut -f1)
  else
    size=$(du -sh "$target" 2>/dev/null | cut -f1)
  fi

  ITEMS_FOUND=$((ITEMS_FOUND + 1))

  if $DRY_RUN; then
    log_clean "[DRY] Would remove: $target ($size) — $desc"
  else
    rm -rf "$target"
    log_clean "Removed: $target ($size) — $desc"
  fi
}

# ─── 1. Temporary files ───
log_info "1/8 Scanning for temporary files..."
for tmp in _tmp_*; do
  [ -e "$tmp" ] && remove_target "$tmp" "temp file"
done
for tmp in $(find . -maxdepth 3 -name "*.tmp" -o -name "*.bak" -o -name "*.swp" -o -name "*~" 2>/dev/null | grep -v node_modules || true); do
  remove_target "$tmp" "editor temp"
done

# ─── 2. OS junk files ───
log_info "2/8 Scanning for OS junk files..."
for junk in $(find . -name ".DS_Store" -o -name "Thumbs.db" -o -name "Desktop.ini" 2>/dev/null | grep -v node_modules || true); do
  remove_target "$junk" "OS junk"
done

# ─── 3. Python bytecode ───
log_info "3/8 Scanning for Python bytecode..."
for pyc_dir in $(find . -type d -name "__pycache__" 2>/dev/null | grep -v node_modules || true); do
  remove_target "$pyc_dir" "Python cache"
done
for pyc in $(find . -name "*.pyc" -o -name "*.pyo" 2>/dev/null | grep -v node_modules || true); do
  remove_target "$pyc" "Python bytecode"
done

# ─── 4. Build artifacts that shouldn't be committed ───
log_info "4/8 Scanning for stale build artifacts..."
for dir in .expo .expo-shared out-tsc coverage .sass-cache; do
  remove_target "$dir" "build artifact"
done
# tsbuildinfo files (incremental build cache)
for tsb in $(find . -name "*.tsbuildinfo" 2>/dev/null | grep -v node_modules || true); do
  remove_target "$tsb" "TS build cache"
done

# ─── 5. Runtime state files that leaked into repo ───
log_info "5/8 Scanning for leaked runtime state..."
for state in $(find . -name "*_guard_state*.json" -o -name "*_idempotency_state*.json" 2>/dev/null | grep -v node_modules || true); do
  remove_target "$state" "leaked runtime state"
done
remove_target "_brain_sync.b64" "brain sync temp"
remove_target "_brain_sync.tar.gz" "brain sync archive"

# ─── 6. Duplicate public directories ───
log_info "6/8 Scanning for duplicate build directories..."
remove_target "artifacts/api-server/public/public" "duplicate nested public"

# ─── 7. Log files ───
log_info "7/8 Scanning for log files..."
for log in $(find . -maxdepth 3 -name "*.log" -o -name "npm-debug.log*" -o -name "yarn-error.log" 2>/dev/null | grep -v node_modules || true); do
  remove_target "$log" "log file"
done

# ─── 8. Environment files (safety check) ───
log_info "8/8 Checking for accidentally tracked secrets..."
for env in .env .env.local .env.production .env.staging; do
  if [ -f "$env" ] && git ls-files --error-unmatch "$env" 2>/dev/null; then
    log_err "DANGER: $env is tracked by git! Remove it immediately."
    log_err "  Run: git rm --cached $env"
  fi
done

# ─── Summary ───
echo ""
echo "═══════════════════════════════════════════════════════════"
if [ $ITEMS_FOUND -eq 0 ]; then
  echo -e "  ${GREEN}Repository is clean.${NC} Nothing to remove."
else
  echo -e "  Found ${YELLOW}${ITEMS_FOUND}${NC} items to clean."
  if $DRY_RUN; then
    echo -e "  Run ${CYAN}$0 --execute${NC} to apply."
  else
    echo -e "  ${GREEN}Cleanup complete.${NC}"
  fi
fi
echo "═══════════════════════════════════════════════════════════"
echo ""
