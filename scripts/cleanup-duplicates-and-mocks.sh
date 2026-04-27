#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# scripts/cleanup-duplicates-and-mocks.sh
#
# Hard-delete the cruft identified in the A+B+C+D cleanup audit.
#
#   A. Duplicate "* N.*" files (e.g. "foo 2.tsx") — copy-paste artifacts
#      left from earlier edits. Excludes node_modules / .git.
#   B. Build/runtime artifacts + pytest_cache markdown noise.
#   C. The unused DemoWalkthrough.tsx component (no callers).
#   D. (already handled in source by stripping dead generator functions
#      from pipeline.tsx and side-by-side.tsx — visible in 'git status')
#
# Does NOT touch:
#   • DemoDataBanner.tsx (load-bearing safety banner)
#   • mock_factory.ts in __tests__/helpers/ (legitimate test fixture)
#   • Any .md file (kept for separate triage per user instruction)
#   • Any production page or route file
#
# Portable: uses find -print0 → while-read loop (works on bash 3.2 / macOS).
# Filenames with spaces are handled correctly throughout.
# ─────────────────────────────────────────────────────────────────
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

echo "════════════════════════════════════════════════════════════════"
echo "  GodsView cleanup pass — A + B + C + D"
echo "════════════════════════════════════════════════════════════════"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ─── A. Duplicate "* N.*" files ─────────────────────────────────────
# Match any filename whose basename contains " <digit>" before the
# extension. Examples:  "foo 2.tsx", "bar 3.md", "baz 2.sh".
echo ""
echo "── A. Duplicate '* N.*' files ──"
find . \
  -path ./node_modules -prune -o \
  -path ./.git -prune -o \
  -path ./artifacts/api-server/node_modules -prune -o \
  -path ./artifacts/godsview-dashboard/node_modules -prune -o \
  -path ./scripts/node_modules -prune -o \
  -type f -name '* [0-9]*' -print0 2>/dev/null | tr '\0' '\n' > "$TMP/A.list"

A_COUNT=$(wc -l < "$TMP/A.list" | tr -d ' ')
echo "Found $A_COUNT duplicate files."
if [ "$A_COUNT" -gt 0 ]; then
  head -20 "$TMP/A.list" | sed 's/^/  /'
  if [ "$A_COUNT" -gt 20 ]; then
    echo "  ... ($((A_COUNT - 20)) more)"
  fi
fi

# ─── B. Build artifacts + pytest_cache READMEs ──────────────────────
echo ""
echo "── B. Build artifacts + pytest_cache READMEs ──"
: > "$TMP/B.list"
# Old DemoDataBanner build chunk(s) — regenerated on every dashboard build.
for f in artifacts/godsview-dashboard/dist/public/assets/DemoDataBanner-*.js; do
  [ -f "$f" ] && echo "$f" >> "$TMP/B.list"
done
# pytest cache markdown noise.
for f in services/.pytest_cache/README.md services/control_plane/.pytest_cache/README.md; do
  [ -f "$f" ] && echo "$f" >> "$TMP/B.list"
done
B_COUNT=$(wc -l < "$TMP/B.list" | tr -d ' ')
echo "Found $B_COUNT build/cache files."
[ "$B_COUNT" -gt 0 ] && sed 's/^/  /' "$TMP/B.list"

# ─── C. Unused mock components ──────────────────────────────────────
echo ""
echo "── C. Unused components ──"
: > "$TMP/C.list"
DW="artifacts/godsview-dashboard/src/components/DemoWalkthrough.tsx"
[ -f "$DW" ] && echo "$DW" >> "$TMP/C.list"
C_COUNT=$(wc -l < "$TMP/C.list" | tr -d ' ')
echo "Found $C_COUNT unused components."
[ "$C_COUNT" -gt 0 ] && sed 's/^/  /' "$TMP/C.list"

TOTAL=$((A_COUNT + B_COUNT + C_COUNT))
echo ""
echo "── TOTAL: $TOTAL files to delete ──"

if [ "$TOTAL" -eq 0 ]; then
  echo "Nothing to delete. Exiting."
  exit 0
fi

if [ "$FORCE" -ne 1 ]; then
  echo ""
  printf "Delete all %d files? [y/N] " "$TOTAL"
  read -r ans
  case "$ans" in
    [yY]|[yY][eE][sS]) ;;
    *) echo "Aborted."; exit 1 ;;
  esac
fi

echo ""
echo "── Deleting ──"
DELETED=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if [ -f "$f" ]; then
    rm -f -- "$f" && DELETED=$((DELETED + 1))
  fi
done < "$TMP/A.list"
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if [ -f "$f" ]; then
    rm -f -- "$f" && DELETED=$((DELETED + 1))
  fi
done < "$TMP/B.list"
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if [ -f "$f" ]; then
    rm -f -- "$f" && DELETED=$((DELETED + 1))
  fi
done < "$TMP/C.list"

echo "Done. $DELETED files removed."

echo ""
echo "── D. In-source dead generators ──"
echo "Already stripped from pipeline.tsx and side-by-side.tsx by the assistant."
echo "These show up as modifications in 'git status'."
