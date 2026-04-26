#!/usr/bin/env bash
# cleanup_duplicates.sh — Remove macOS Finder duplicate files ("* 2.*")
# Run from repo root: bash scripts/cleanup_duplicates.sh

set -euo pipefail

echo "🧹 Removing duplicate '* 2.*' files from GodsView repo..."

count=0
while IFS= read -r -d '' file; do
  echo "  Removing: $file"
  git rm -f "$file" 2>/dev/null || rm -f "$file"
  ((count++))
done < <(find . -name '* 2.*' -not -path './.git/*' -print0)

echo "✅ Removed $count duplicate files"
echo ""
echo "Now run:"
echo "  git add -A && git commit -m 'chore: remove 187 macOS Finder duplicate files'"
