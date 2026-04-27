#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# scripts/probe-dashboard-endpoints.sh — method-aware endpoint probe
#
# Walks the dashboard source and extracts every apiFetch call WITH its
# HTTP method. Probes each one against http://localhost using the right
# verb, so POST-only endpoints don't show up as fake 404s.
#
# Output:
#   <CODE>  <METHOD>  <URL>
#
# 200/201/204     = live, working
# 400/422         = live (rejected payload — expected for empty POST)
# 401/403         = live (auth-gated — expected for operator endpoints)
# 404             = genuinely missing endpoint (THESE need fixing)
# 5xx             = real bug or upstream service down
# 000             = couldn't reach
# ─────────────────────────────────────────────────────────────────
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API="${API:-http://localhost}"
TMP="$(mktemp -d)"

set -a; [ -f "$ROOT/.env" ] && . "$ROOT/.env"; set +a

# Use a small Node script to extract (method, url) pairs from dashboard
# source. Easier than wrestling regex around multiline arg lists.
node - <<'NODE' > "$TMP/calls.tsv"
const fs = require("fs");
const path = require("path");

const ROOT = process.env.DASHBOARD_ROOT || "artifacts/godsview-dashboard/src";

function walk(dir, acc=[]) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) continue;
    if (/ 2\.tsx?$/.test(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

const files = walk(ROOT);
const seen = new Set();

// match apiFetch<...>(URL, options?)
// URL: a string literal "/..." or `/...` (we drop template-only URLs)
// options: optional second arg — may contain method: "POST" etc.
const re = /apiFetch\s*(?:<[^>]+>)?\s*\(\s*([`"'])([^`"']+)\1\s*(?:,\s*(\{[\s\S]*?\}))?\s*\)/g;

for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  let m;
  while ((m = re.exec(src)) !== null) {
    const url = m[2];
    const opts = m[3] || "";
    if (!url.startsWith("/")) continue;
    if (url.includes("${")) continue; // skip dynamic template fragments
    let method = "GET";
    const mm = opts.match(/method\s*:\s*["'`]([A-Z]+)["'`]/);
    if (mm) method = mm[1];
    const key = method + " " + url;
    if (!seen.has(key)) { seen.add(key); console.log(method + "\t" + url); }
  }
}
NODE

TOTAL=$(wc -l < "$TMP/calls.tsv" | tr -d ' ')
echo "Probing $TOTAL endpoints (method-aware) against $API ..." >&2

> "$TMP/out"
while IFS=$'\t' read -r METHOD RAW; do
  [ -z "$METHOD" ] && continue
  if [[ "$RAW" == /api/* ]]; then URL="$RAW"; else URL="/api${RAW}"; fi

  # Normalize doubled slashes
  URL=$(echo "$URL" | sed -E 's:/+:/:g; s:/$::')

  if [[ "$METHOD" == "GET" || "$METHOD" == "DELETE" ]]; then
    CODE=$(curl -sS -o /dev/null -m 5 -X "$METHOD" \
      -H "Authorization: Bearer ${GODSVIEW_OPERATOR_TOKEN:-}" \
      -w "%{http_code}" "${API}${URL}" 2>/dev/null || echo 000)
  else
    # POST/PUT/PATCH — send empty JSON body. We're not testing semantics,
    # only existence. A real handler returns 400/422 (empty body rejected),
    # a missing route returns 404. Either is informative.
    CODE=$(curl -sS -o /dev/null -m 5 -X "$METHOD" \
      -H "Authorization: Bearer ${GODSVIEW_OPERATOR_TOKEN:-}" \
      -H "Content-Type: application/json" -d "{}" \
      -w "%{http_code}" "${API}${URL}" 2>/dev/null || echo 000)
  fi
  printf "%-5s  %-6s  %s\n" "$CODE" "$METHOD" "$URL" >> "$TMP/out"
done < "$TMP/calls.tsv"

# Print verbose (sorted) and summary
{
  printf "%-5s  %-6s  %s\n" "CODE" "METHOD" "URL"
  printf "%-5s  %-6s  %s\n" "-----" "------" "---"
  sort -k1,1 -k3,3 "$TMP/out"
  echo ""
  echo "=== Summary by HTTP code ==="
  awk '{print $1}' "$TMP/out" | sort | uniq -c | sort -rn
}

rm -rf "$TMP"
