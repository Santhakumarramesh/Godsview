#!/usr/bin/env bash
# ============================================================================
# GodsView — Repository Cleanup Script  (v2 — comprehensive)
# Removes temp files, build artifacts, stale docs, duplicates, worktrees, cruft
# Run from repo root: bash scripts/cleanup.sh
# ============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

removed=0
freed=0
r()   { echo -e "  ${GREEN}✓${NC} $1"; removed=$((removed + 1)); }
skip(){ echo -e "  ${YELLOW}⊘${NC} $1 (not found)"; }
hdr() { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║          GodsView — Production Cleanup  v2                  ║"
echo "╚══════════════════════════════════════════════════════════════╝"

# ── 1. Temp files at root ────────────────────────────────────────────────────
hdr "1. Temp files (_tmp_*)"
count=$(ls _tmp_* 2>/dev/null | wc -l | tr -d ' ')
if [ "$count" -gt 0 ]; then rm -f _tmp_*; r "Removed $count _tmp_ files"; else skip "No _tmp_ files"; fi

# ── 2. Git lock files ────────────────────────────────────────────────────────
hdr "2. Git lock files"
find .git -name "*.lock" -type f 2>/dev/null | while read -r f; do
  rm -f "$f"; r "Removed $f"
done

# ── 3. Phase directories (old build notes — not part of app) ─────────────────
hdr "3. Phase directories"
for d in phase-0 phase-1a phase-1b phase-1c phase-2 phase-3 phase-4 phase-5 \
         phase-6 phase-7 phase-8 phase-9 phase-10 phase-11 phase-12 phase-13 phase-14; do
  if [ -d "$d" ]; then rm -rf "$d"; r "Removed $d/"; fi
done

# ── 4. Stale root documents → docs/archive/ ──────────────────────────────────
hdr "4. Stale root documents"
mkdir -p docs/archive
for f in CHANGES_SUMMARY.txt CLAUDE_DESIGN_MASTER_SPEC.md CLAUDE_DESIGN_PROJECT.txt \
         GODSVIEW_PRODUCTION_AUDIT_AND_BLUEPRINT.md IMPLEMENTATION_COMPLETION_REPORT.md \
         PHASES_12_16_SUMMARY.md PRODUCTION.md PRODUCTION_READINESS.md \
         SESSION_HANDOFF.md SYNTHETIC_DATA_SAFETY_FIXES.md QUICK_START.md \
         godsview_engine_analysis_dashboard.html; do
  if [ -f "$f" ]; then mv "$f" docs/archive/; r "Archived $f → docs/archive/"; fi
done
# Move DEPLOYMENT_GUIDE.md into docs/ (still useful, just wrong place)
if [ -f "DEPLOYMENT_GUIDE.md" ]; then mv DEPLOYMENT_GUIDE.md docs/; r "Moved DEPLOYMENT_GUIDE.md → docs/"; fi

# ── 5. Replit-specific files ─────────────────────────────────────────────────
hdr "5. Replit files"
for f in .replit .replitignore replit.md replit-start.sh .bashrc .bash_logout .profile; do
  if [ -f "$f" ]; then rm -f "$f"; r "Removed $f"; fi
done
for d in .local; do
  if [ -d "$d" ]; then rm -rf "$d"; r "Removed $d/"; fi
done

# ── 6. Duplicate godsview_openbb directories ─────────────────────────────────
hdr "6. Duplicate Python directories"
if [ -d "godsview_openbb 2" ]; then
  rm -rf "godsview_openbb 2"
  r "Removed 'godsview_openbb 2/' (46 MB duplicate)"
fi
if [ -d "godsview_openbb" ]; then
  fcount=$(find "godsview_openbb" -type f 2>/dev/null | wc -l | tr -d ' ')
  if [ "$fcount" -eq 0 ]; then
    rm -rf "godsview_openbb"
    r "Removed empty godsview_openbb/"
  else
    skip "godsview_openbb/ has $fcount files, keeping (rename of godsview-openbb)"
  fi
fi

# ── 7. Empty directories ────────────────────────────────────────────────────
hdr "7. Empty directories"
for d in data mnt; do
  if [ -d "$d" ]; then
    fcount=$(find "$d" -type f 2>/dev/null | wc -l | tr -d ' ')
    if [ "$fcount" -eq 0 ]; then rm -rf "$d"; r "Removed empty $d/"; else skip "$d/ has $fcount files"; fi
  fi
done

# ── 8. Claude worktrees (stale agent copies — ~616 MB) ───────────────────────
hdr "8. Claude worktrees"
if [ -d ".claude/worktrees" ]; then
  wt_size=$(du -sh .claude/worktrees 2>/dev/null | cut -f1)
  rm -rf .claude/worktrees
  r "Removed .claude/worktrees/ ($wt_size freed)"
fi
# Also prune git's own worktree refs
if [ -d ".git/worktrees" ]; then
  git worktree prune 2>/dev/null && r "Pruned git worktree refs" || true
fi

# ── 9. Duplicate top-level directories (artifacts/ is canonical) ─────────────
hdr "9. Duplicate top-level directories"
# Dockerfile, docker-compose, and pnpm-workspace ALL use artifacts/ only
if [ -d "api-server" ] && [ -d "artifacts/api-server" ]; then
  rm -rf api-server
  r "Removed duplicate api-server/ (artifacts/api-server is canonical)"
fi
if [ -d "godsview-dashboard" ] && [ -d "artifacts/godsview-dashboard" ]; then
  rm -rf godsview-dashboard
  r "Removed duplicate godsview-dashboard/ (artifacts/ is canonical)"
fi
if [ -d "mockup-sandbox" ] && [ -d "artifacts/mockup-sandbox" ]; then
  rm -rf mockup-sandbox
  r "Removed duplicate mockup-sandbox/ (artifacts/ has it)"
fi

# ── 10. Build output directories ─────────────────────────────────────────────
hdr "10. Build outputs (dist/)"
for d in artifacts/api-server/dist artifacts/godsview-dashboard/dist \
         chrome-extension/dist lib/common-types/dist lib/api-zod/dist \
         lib/strategy-core/dist lib/db/dist lib/api-client-react/dist \
         lib/api-spec/dist godsview-openbb/.cache; do
  if [ -d "$d" ]; then rm -rf "$d"; r "Removed $d/"; fi
done

# ── 11. tsbuildinfo files ────────────────────────────────────────────────────
hdr "11. TypeScript build info"
count=$(find . -name "*.tsbuildinfo" -not -path "*/node_modules/*" -not -path "*/.claude/*" 2>/dev/null | wc -l | tr -d ' ')
if [ "$count" -gt 0 ]; then
  find . -name "*.tsbuildinfo" -not -path "*/node_modules/*" -not -path "*/.claude/*" -delete
  r "Removed $count .tsbuildinfo files"
else
  skip "No .tsbuildinfo files"
fi

# ── 12. Secret .env files ───────────────────────────────────────────────────
hdr "12. Secret .env files"
for f in godsview-openbb/.env .env; do
  if [ -f "$f" ]; then rm -f "$f"; r "Removed $f (secret)"; fi
done

# ── 13. OS junk files ───────────────────────────────────────────────────────
hdr "13. OS junk files"
count=$(find . -name ".DS_Store" -not -path "*/node_modules/*" -not -path "*/.claude/*" 2>/dev/null | wc -l | tr -d ' ')
if [ "$count" -gt 0 ]; then
  find . -name ".DS_Store" -not -path "*/node_modules/*" -not -path "*/.claude/*" -delete
  r "Removed $count .DS_Store files"
else
  skip "No .DS_Store files"
fi

# ── 14. Brain sync temp files ────────────────────────────────────────────────
hdr "14. Brain sync temp files"
for f in _brain_sync.b64 _brain_sync.tar.gz; do
  if [ -f "$f" ]; then rm -f "$f"; r "Removed $f"; fi
done

# ── 15. Runtime state files ──────────────────────────────────────────────────
hdr "15. Runtime state files"
count=$(find . \( -name "*_guard_state*.json" -o -name "*.runtime.json" \) -not -path "*/node_modules/*" 2>/dev/null | wc -l | tr -d ' ')
if [ "$count" -gt 0 ]; then
  find . \( -name "*_guard_state*.json" -o -name "*.runtime.json" \) -not -path "*/node_modules/*" -delete 2>/dev/null
  r "Removed $count runtime state files"
else
  skip "No runtime state files"
fi

# ── 16. .pnpm-store (local cache) ───────────────────────────────────────────
hdr "16. pnpm store"
if [ -d ".pnpm-store" ]; then rm -rf .pnpm-store; r "Removed .pnpm-store/"; else skip ".pnpm-store"; fi

# ── 17. Nested Godsview clone prevention ─────────────────────────────────────
hdr "17. Nested clones"
if [ -d "Godsview" ] && [ -d "Godsview/.git" ]; then
  rm -rf Godsview
  r "Removed nested Godsview/ clone"
fi

# ── 18. Attached assets / scratch ────────────────────────────────────────────
hdr "18. Scratch files"
if [ -d "attached_assets" ]; then rm -rf attached_assets; r "Removed attached_assets/"; fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Cleanup complete: $removed items removed                          ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo -e "${CYAN}Estimated space freed:${NC}"
echo "  .claude/worktrees  ~616 MB"
echo "  godsview_openbb 2  ~ 46 MB"
echo "  godsview-dashboard ~ 29 MB"
echo "  phase-* dirs       ~  5 MB"
echo "  api-server dup     ~  6 MB"
echo "  ────────────────────────────"
echo "  Total estimated    ~700 MB"
echo ""
echo -e "${CYAN}Next steps:${NC}"
echo "  git add -A"
echo "  git status              # review what changed"
echo "  git diff --cached --stat  # see file counts"
echo "  git commit -m 'chore: production cleanup — remove 700MB of duplicates, worktrees, phase dirs, temp files'"
echo "  git push origin main"
echo ""
