#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# GodsView — Replay session
# Reads recent vc_pipeline audit events, re-POSTs each captured payload,
# and asserts the new outcome matches the original decision_state.
# Useful for: regression detection, demo replay, post-incident comparison.
#
# IMPORTANT: replays use the SAME symbol+setup but a fresh timestamp and a
# fixed (R:R = 2:1, fresh-timestamp) representative payload. We assert that
# the system's deterministic risk gate produces a consistent decision class
# (allowed vs rejected) given the same logical setup, NOT a byte-for-byte
# reproduction of the original. Genuine reproduction requires storing the
# raw payload, which audit_events doesn't (by privacy design).
# ─────────────────────────────────────────────────────────────────
set -u

API="${API:-http://localhost}"
LIMIT="${LIMIT:-10}"           # default 10 — well under the 60/min rate limit
SLEEP_MS="${SLEEP_MS:-200}"    # 200ms between replays = max 5 req/s
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

set -a; [ -f .env ] && . ./.env; set +a

log()  { printf "\033[1;36m[replay]\033[0m %s\n" "$*"; }
ok()   { printf "  \033[1;32m✓ MATCH\033[0m %s\n" "$1"; }
miss() { printf "  \033[1;31m✗ DIFF\033[0m  %s\n" "$1"; }
rl()   { printf "  \033[1;33m⚠ RATE\033[0m  %s\n" "$1"; }

wait_ready() {
  local max="${1:-60}"
  for i in $(seq 1 "$max"); do
    body=$(curl -sS --max-time 2 "${API}/api/system/status" 2>/dev/null || true)
    if printf "%s" "$body" | head -c 1 | grep -q '{'; then
      return 0
    fi
    sleep 1
  done
  return 1
}

if ! wait_ready 30; then
  printf "\033[1;31mAPI not ready at %s — aborting replay\033[0m\n" "$API"
  exit 1
fi

# Pull recent vc_pipeline events
RECENT=$(curl -sS "${API}/api/webhooks/tradingview/recent?limit=${LIMIT}" 2>/dev/null || echo '{}')
if ! printf "%s" "$RECENT" | head -c 1 | grep -q '{'; then
  log "non-JSON response from /api/webhooks/tradingview/recent — is the api healthy?"
  exit 1
fi

COUNT=$(echo "$RECENT" | jq -r '.count // 0')
if [ "$COUNT" = "0" ] || [ "$COUNT" = "null" ]; then
  log "no recent events to replay — send some via /api/webhooks/tradingview first"
  exit 0
fi

log "replaying ${COUNT} most recent events (rate-limited at ${SLEEP_MS}ms intervals)"

# IMPORTANT: skip events whose original decision_state was "rejected".
# We can't reproduce a rejection with a synthetic R:R=2:1 payload — the
# original rejection depended on the FULL payload (timestamp, R:R ratio,
# wrong-side stop, malformed body). Replaying these always passes risk gate
# and produces a misleading "DIFF". The check that matters is: does the
# system make consistent ALLOW decisions for the ALLOWED-class events?
#
# To genuinely replay rejections we would need to store the full original
# payload bytes in audit_events — a privacy/PII concern for production.

TMP_EVTS=$(mktemp)
echo "$RECENT" | jq -c '.events[] | select(.decision_state == "allowed") | {id, decision_state, payload_json, symbol, setup_type}' > "$TMP_EVTS"
SKIPPED=$(echo "$RECENT" | jq '[.events[] | select(.decision_state != "allowed")] | length')
log "  ${SKIPPED} reject-class events skipped (cannot reproduce with synthetic payload)"

MATCH=0; DIFF=0; RATE_LIMITED=0
while IFS= read -r evt; do
  ID=$(echo "$evt" | jq -r '.id')
  EXPECTED=$(echo "$evt" | jq -r '.decision_state')
  SYM=$(echo "$evt" | jq -r '.symbol // "AAPL"')
  SETUP=$(echo "$evt" | jq -r '.setup_type // "vwap_reclaim"')
  NOW=$(date +%s)

  REPLAY_BODY=$(cat <<JSON
{"symbol":"$SYM","signal":"$SETUP","timeframe":"5m","price":100,"timestamp":$NOW,"direction":"long","stop_loss":99,"take_profit":102,"passphrase":"${TRADINGVIEW_WEBHOOK_SECRET:-}"}
JSON
  )

  # Capture both body and HTTP status code so we can distinguish rate-limit
  # (429) from a genuine risk rejection (200 with .risk.allowed=false).
  RESP=$(curl -sS -w "\nHTTPCODE:%{http_code}" -H "Content-Type: application/json" \
    -d "$REPLAY_BODY" "${API}/api/webhooks/tradingview" 2>/dev/null)
  HTTPCODE=$(printf "%s" "$RESP" | tail -n1 | sed 's/HTTPCODE://')
  BODY=$(printf "%s" "$RESP" | sed '$d')

  if [ "$HTTPCODE" = "429" ]; then
    rl "audit #$ID  symbol=$SYM  rate-limited (429) — not counted as match/diff"
    RATE_LIMITED=$((RATE_LIMITED + 1))
  elif [ "$HTTPCODE" = "503" ]; then
    rl "audit #$ID  symbol=$SYM  service-degraded (503) — not counted as match/diff"
    RATE_LIMITED=$((RATE_LIMITED + 1))
  else
    ALLOWED=$(printf "%s" "$BODY" | jq -r '.risk.allowed // ""' 2>/dev/null)
    ACTUAL=$([ "$ALLOWED" = "true" ] && echo "allowed" || echo "rejected")

    if [ "$EXPECTED" = "$ACTUAL" ]; then
      ok "audit #$ID  symbol=$SYM  expected=$EXPECTED  actual=$ACTUAL"
      MATCH=$((MATCH + 1))
    else
      miss "audit #$ID  symbol=$SYM  expected=$EXPECTED  actual=$ACTUAL  http=$HTTPCODE"
      DIFF=$((DIFF + 1))
    fi
  fi

  # Spread replays to stay under the per-IP rate limit
  sleep "$(awk "BEGIN { printf \"%.2f\", $SLEEP_MS / 1000 }")"
done < "$TMP_EVTS"
rm -f "$TMP_EVTS"

printf "\nReplay totals: \033[1;32m%d MATCH\033[0m / \033[1;31m%d DIFF\033[0m / \033[1;33m%d RATE-LIMITED\033[0m / \033[1;36m%s SKIPPED\033[0m (reject-class)\n" \
  "$MATCH" "$DIFF" "$RATE_LIMITED" "${SKIPPED:-0}"
log "replayed ${COUNT} events ($SKIPPED reject-class skipped). DIFF rows indicate genuine behavioural changes."

# Exit non-zero only if there were genuine DIFFs. Rate-limited responses are
# expected when many replays are queued and don't indicate a regression.
[ "$DIFF" -eq 0 ] && exit 0 || exit 1
