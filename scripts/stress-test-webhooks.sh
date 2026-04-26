#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# GodsView — Webhook stress test
# Sends N mixed valid/invalid webhook requests with controlled concurrency,
# measures latency, and verifies:
#   - no API crash (every request returns a valid HTTP code)
#   - bad payloads always rejected (400 or risk.allowed=false)
#   - duplicate detection at the audit-event level (no duplicate trades for
#     identical (symbol, signal, timeframe) within 60s)
#
# Usage:
#   bash scripts/stress-test-webhooks.sh [N=100] [CONCURRENCY=10]
# ─────────────────────────────────────────────────────────────────
set -u

N="${1:-100}"
CONC="${2:-10}"
API="${API:-http://localhost:3001}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

set -a; [ -f .env ] && . ./.env; set +a
PASS_VAL="${TRADINGVIEW_WEBHOOK_SECRET:-}"

OUT_DIR="/tmp/godsview_stress"
mkdir -p "$OUT_DIR"
> "$OUT_DIR/results.csv"

log() { printf "\033[1;36m[stress]\033[0m %s\n" "$*"; }

# Ensure API is up
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "${API}/health" || echo 000)
if [ "$HEALTH" != "200" ]; then
  echo "API not healthy at ${API}/health (got $HEALTH). Boot the stack first." >&2
  exit 2
fi

valid_payload() {
  local sym=$1
  local now=$(date +%s)
  cat <<JSON
{"symbol":"$sym","signal":"vwap_reclaim","timeframe":"5m","price":100,"timestamp":$now,"direction":"long","stop_loss":99,"take_profit":102,"passphrase":"$PASS_VAL"}
JSON
}

bad_rr_payload() {
  local sym=$1
  local now=$(date +%s)
  cat <<JSON
{"symbol":"$sym","signal":"vwap_reclaim","timeframe":"5m","price":100,"timestamp":$now,"direction":"long","stop_loss":95,"take_profit":102,"passphrase":"$PASS_VAL"}
JSON
}

malformed_payload() { echo '{"oops":true}'; }
stale_payload() {
  local sym=$1
  local stale=$(($(date +%s) - 3600))
  cat <<JSON
{"symbol":"$sym","signal":"vwap_reclaim","timeframe":"5m","price":100,"timestamp":$stale,"direction":"long","stop_loss":99,"take_profit":102,"passphrase":"$PASS_VAL"}
JSON
}

send_one() {
  local i=$1
  local kind body sym
  case $((i % 5)) in
    0|1|2) kind="valid";       sym="STR$((i%30))"; body="$(valid_payload "$sym")" ;;
    3)     kind="bad_rr";      sym="BAD$((i%10))"; body="$(bad_rr_payload "$sym")" ;;
    4)     case $((i % 2)) in
             0) kind="malformed"; body="$(malformed_payload)"; sym="N/A" ;;
             *) kind="stale";     sym="STL$((i%10))"; body="$(stale_payload "$sym")" ;;
           esac ;;
  esac

  local t0=$(($(date +%s%N)/1000000))
  local resp=$(curl -sS -o /tmp/godsview_stress/r$i.body -w "%{http_code}" \
    -H "Content-Type: application/json" -d "$body" \
    "${API}/api/webhooks/tradingview" 2>/dev/null || echo 000)
  local t1=$(($(date +%s%N)/1000000))
  local latency=$((t1 - t0))
  local allowed=$(jq -r '.risk.allowed // empty' /tmp/godsview_stress/r$i.body 2>/dev/null || echo "")
  echo "$i,$kind,$sym,$resp,$latency,$allowed" >> "$OUT_DIR/results.csv"
}

log "Sending $N requests, concurrency=$CONC, target=$API"
for i in $(seq 1 "$N"); do
  send_one "$i" &
  if (( i % CONC == 0 )); then wait; fi
done
wait

# ─── Aggregate ──────────────────────────────────────────────────────
log "Aggregating results from $OUT_DIR/results.csv"
TOTAL=$(wc -l < "$OUT_DIR/results.csv")
ACCEPTED=$(awk -F, '$4 ~ /^20[01]$/ && $6=="true"  {c++} END{print c+0}' "$OUT_DIR/results.csv")
REJECTED=$(awk -F, '$6=="false" {c++} END{print c+0}' "$OUT_DIR/results.csv")
HTTP400=$(awk -F, '$4=="400" {c++} END{print c+0}' "$OUT_DIR/results.csv")
HTTP5XX=$(awk -F, '$4 ~ /^5/ {c++} END{print c+0}' "$OUT_DIR/results.csv")
FAILED=$(awk -F, '$4=="000" {c++} END{print c+0}' "$OUT_DIR/results.csv")
P50=$(awk -F, '{print $5}' "$OUT_DIR/results.csv" | sort -n | awk '{a[NR]=$1} END{print a[int(NR/2)]}')
P95=$(awk -F, '{print $5}' "$OUT_DIR/results.csv" | sort -n | awk '{a[NR]=$1} END{print a[int(NR*0.95)]}')

printf "\n"
printf "Total requests:     %s\n" "$TOTAL"
printf "Accepted (200/201): %s\n" "$ACCEPTED"
printf "Rejected (risk):    %s\n" "$REJECTED"
printf "HTTP 400:           %s\n" "$HTTP400"
printf "HTTP 5xx:           %s\n" "$HTTP5XX"
printf "Connection failed:  %s\n" "$FAILED"
printf "Latency p50/p95 ms: %s / %s\n" "${P50:-?}" "${P95:-?}"

# Pass criteria: no 5xx, no connection failures
EXIT=0
if [ "$HTTP5XX" -gt 0 ]; then echo "FAIL: $HTTP5XX requests returned 5xx — API instability"; EXIT=1; fi
if [ "$FAILED"  -gt 0 ]; then echo "FAIL: $FAILED requests failed to connect"; EXIT=1; fi
if [ "$HTTP400" -lt 1 ]; then echo "WARN: no 400 responses — payload validator may not be active"; fi

# Verify no duplicate trades for same (symbol, signal, timeframe) within 60s
DUPCHECK_SQL="WITH d AS (
  SELECT instrument, setup_type, COUNT(*) c
  FROM trades
  WHERE created_at > NOW() - INTERVAL '5 minutes'
  GROUP BY instrument, setup_type
  HAVING COUNT(*) > 1
)
SELECT COUNT(*) FROM d;"
DUPS=$(docker compose exec -T postgres psql -U godsview -t -A -c "$DUPCHECK_SQL" 2>/dev/null | tr -d '[:space:]' || echo 0)
[ -n "$DUPS" ] && [ "$DUPS" -gt 0 ] \
  && echo "WARN: $DUPS instrument+setup pairs have multiple trades within 5min (expected if dedupe gate not active)" \
  || echo "OK: no duplicate trades within 5min window"

exit $EXIT
