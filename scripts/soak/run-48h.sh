#!/usr/bin/env bash
# P1-7: 48-hour soak runner wrapping scripts/chaos/long-running-stability.mjs.
#
# Persists per-minute snapshots (RSS, p95, p99, error budget) to
# artifacts/soak/<ts>.md. Exits non-zero on p99 > 500ms or error_pct > 0.5%.
#
# USAGE
#   # foreground (blocks for 48h):
#   GODSVIEW_BASE=http://localhost:3000 scripts/soak/run-48h.sh
#
#   # nohup:
#   nohup scripts/soak/run-48h.sh > artifacts/soak/run.log 2>&1 &
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

DURATION_MS="${CHAOS_STABILITY_DURATION_MS:-172800000}"   # 48h
SNAP_INTERVAL_S="${CHAOS_SOAK_SNAPSHOT_SECONDS:-60}"      # 1 minute
P99_BUDGET_MS="${CHAOS_SOAK_P99_BUDGET_MS:-500}"
ERROR_PCT_BUDGET="${CHAOS_SOAK_ERROR_PCT_BUDGET:-0.5}"
BASE="${GODSVIEW_BASE:-http://localhost:3000}"

TS="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
OUT_DIR="$REPO_ROOT/artifacts/soak"
mkdir -p "$OUT_DIR"
SNAP_MD="$OUT_DIR/${TS}.md"
SNAP_JSON="$OUT_DIR/${TS}.jsonl"
DRILL_LOG="$OUT_DIR/${TS}.drill.log"

printf "# GodsView 48h soak — %s\n\n" "$TS"                          > "$SNAP_MD"
printf "base=%s duration_ms=%s p99_budget_ms=%s error_pct_budget=%s\n\n" \
  "$BASE" "$DURATION_MS" "$P99_BUDGET_MS" "$ERROR_PCT_BUDGET"       >> "$SNAP_MD"
printf "| t_iso | rss_mb | p95_ms | p99_ms | err_pct |\n"           >> "$SNAP_MD"
printf "|-------|--------|--------|--------|---------|\n"           >> "$SNAP_MD"

CHAOS_STABILITY_DURATION_MS="$DURATION_MS" \
GODSVIEW_BASE="$BASE" \
  node scripts/chaos/long-running-stability.mjs > "$DRILL_LOG" 2>&1 &
DRILL_PID=$!
trap 'kill "$DRILL_PID" 2>/dev/null || true' EXIT INT TERM

VIOLATED=0

while kill -0 "$DRILL_PID" 2>/dev/null; do
  SNAP_T="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  RSS_MB="$(ps -o rss= -p "$DRILL_PID" 2>/dev/null | awk '{printf "%.1f", $1/1024}')"

  LAT_LINE="$(curl -s "$BASE/api/system/metrics" || true)"
  P95="$(printf '%s' "$LAT_LINE" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);console.log(j.p95_ms ?? j.latency?.p95_ms ?? "")}catch{console.log("")}})')"
  P99="$(printf '%s' "$LAT_LINE" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);console.log(j.p99_ms ?? j.latency?.p99_ms ?? "")}catch{console.log("")}})')"
  ERR_PCT="$(printf '%s' "$LAT_LINE" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);console.log(j.error_pct ?? j.errors?.pct ?? 0)}catch{console.log(0)}})')"

  P95="${P95:-0}"; P99="${P99:-0}"; ERR_PCT="${ERR_PCT:-0}"

  printf "| %s | %s | %s | %s | %s |\n" "$SNAP_T" "$RSS_MB" "$P95" "$P99" "$ERR_PCT" >> "$SNAP_MD"
  printf '{"t":"%s","rss_mb":%s,"p95_ms":%s,"p99_ms":%s,"err_pct":%s}\n' \
    "$SNAP_T" "${RSS_MB:-0}" "$P95" "$P99" "$ERR_PCT" >> "$SNAP_JSON"

  if awk -v v="$P99" -v b="$P99_BUDGET_MS" 'BEGIN{exit !(v+0 > b+0)}'; then
    printf "\n**BUDGET VIOLATION**: p99_ms=%s exceeds %s at %s\n" "$P99" "$P99_BUDGET_MS" "$SNAP_T" >> "$SNAP_MD"
    VIOLATED=1
    break
  fi
  if awk -v v="$ERR_PCT" -v b="$ERROR_PCT_BUDGET" 'BEGIN{exit !(v+0 > b+0)}'; then
    printf "\n**BUDGET VIOLATION**: error_pct=%s exceeds %s at %s\n" "$ERR_PCT" "$ERROR_PCT_BUDGET" "$SNAP_T" >> "$SNAP_MD"
    VIOLATED=1
    break
  fi

  sleep "$SNAP_INTERVAL_S"
done

wait "$DRILL_PID" 2>/dev/null || DRILL_EXIT=$?
DRILL_EXIT="${DRILL_EXIT:-0}"

printf "\n_drill exit code: %s_\n" "$DRILL_EXIT" >> "$SNAP_MD"
printf "_soak artifact: %s_\n"     "$SNAP_MD"   >> "$SNAP_MD"

if [ "$VIOLATED" -ne 0 ] || [ "$DRILL_EXIT" -ne 0 ]; then
  echo "soak FAILED — see $SNAP_MD" >&2
  exit 1
fi

echo "soak PASS — see $SNAP_MD"
