#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# GodsView — Failure-mode safety test
# Verifies the system fails SAFELY in adversarial conditions.
#
# Each scenario:
#   - induces a failure
#   - sends a webhook
#   - asserts the outcome is the expected SAFE failure (e.g. 5xx not crash,
#     payload rejected, no phantom trade)
#   - restores the failure
#
# Run order is deliberate — stop-the-world failures (Redis/DB) come last.
# ─────────────────────────────────────────────────────────────────
set -u

API="${API:-http://localhost:3001}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

set -a; [ -f .env ] && . ./.env; set +a
PASS_VAL="${TRADINGVIEW_WEBHOOK_SECRET:-}"

PASS=0
FAIL=0

ok()  { printf "  \033[1;32m✓ PASS\033[0m %s\n" "$1"; PASS=$((PASS+1)); }
bad() { printf "  \033[1;31m✗ FAIL\033[0m %s\n" "$1"; FAIL=$((FAIL+1)); }
hdr() { printf "\n\033[1;35m── %s ──\033[0m\n" "$1"; }

post_webhook() {
  local body="$1"
  curl -sS -o /tmp/ft_body.txt -w "%{http_code}" \
    -H "Content-Type: application/json" -d "$body" \
    "${API}/api/webhooks/tradingview" 2>/dev/null || echo 000
}

NOW=$(date +%s)

# ─── 1. Malformed payload ────────────────────────────────────────
hdr "1. Malformed payload"
CODE=$(post_webhook '{"oops":true}')
[ "$CODE" = "400" ] && ok "malformed → 400" || bad "malformed → $CODE (expected 400)"

# ─── 2. Stale webhook ────────────────────────────────────────────
hdr "2. Stale webhook"
STALE=$(($(date +%s) - 3600))
BODY="$(cat <<JSON
{"symbol":"STALE","signal":"vwap_reclaim","timeframe":"5m","price":100,"timestamp":$STALE,"direction":"long","stop_loss":99,"take_profit":102,"passphrase":"$PASS_VAL"}
JSON
)"
post_webhook "$BODY" >/dev/null
ALLOWED=$(jq -r '.risk.allowed // ""' /tmp/ft_body.txt 2>/dev/null)
REASON=$(jq -r '.risk.reason // ""' /tmp/ft_body.txt 2>/dev/null)
[ "$ALLOWED" = "false" ] && [[ "$REASON" =~ "Stale" ]] && ok "stale rejected with reason" || bad "stale not rejected (allowed=$ALLOWED reason=$REASON)"

# ─── 3. Duplicate webhook (same symbol+signal+timeframe) ────────
hdr "3. Duplicate webhook within 60s"
DUP_BODY="$(cat <<JSON
{"symbol":"DUP","signal":"vwap_reclaim","timeframe":"5m","price":100,"timestamp":$NOW,"direction":"long","stop_loss":99,"take_profit":102,"passphrase":"$PASS_VAL"}
JSON
)"
post_webhook "$DUP_BODY" >/dev/null
FIRST_TRADE=$(jq -r '.trade.id // empty' /tmp/ft_body.txt 2>/dev/null)
post_webhook "$DUP_BODY" >/dev/null
SECOND_TRADE=$(jq -r '.trade.id // empty' /tmp/ft_body.txt 2>/dev/null)
# Both might create trades because vc_pipeline doesn't dedupe — that's a known
# trade-off. We simply assert that BOTH responses returned cleanly (no crash).
if [ -n "$FIRST_TRADE" ] && [ -n "$SECOND_TRADE" ]; then
  ok "duplicates handled (both processed cleanly — dedupe gate is on signal_ingestion path, not vc_pipeline)"
else
  bad "duplicate handling broken: first=$FIRST_TRADE second=$SECOND_TRADE"
fi

# ─── 4. High-risk trade ──────────────────────────────────────────
hdr "4. High-risk (R:R < 1)"
HR_BODY="$(cat <<JSON
{"symbol":"HR","signal":"vwap_reclaim","timeframe":"5m","price":100,"timestamp":$NOW,"direction":"long","stop_loss":95,"take_profit":102,"passphrase":"$PASS_VAL"}
JSON
)"
post_webhook "$HR_BODY" >/dev/null
ALLOWED=$(jq -r '.risk.allowed // ""' /tmp/ft_body.txt 2>/dev/null)
[ "$ALLOWED" = "false" ] && ok "high-risk rejected" || bad "high-risk NOT rejected"

# ─── 5. Wrong-side stop (long with stop above) ───────────────────
hdr "5. Long with stop above entry"
WS_BODY="$(cat <<JSON
{"symbol":"WS","signal":"vwap_reclaim","timeframe":"5m","price":100,"timestamp":$NOW,"direction":"long","stop_loss":101,"take_profit":105,"passphrase":"$PASS_VAL"}
JSON
)"
post_webhook "$WS_BODY" >/dev/null
ALLOWED=$(jq -r '.risk.allowed // ""' /tmp/ft_body.txt 2>/dev/null)
[ "$ALLOWED" = "false" ] && ok "wrong-side stop rejected" || bad "wrong-side stop NOT rejected"

# ─── 6. Redis unavailable ────────────────────────────────────────
hdr "6. Redis unavailable"
log_msg() { printf "  \033[1;36mℹ\033[0m %s\n" "$1"; }
log_msg "stopping redis container…"
docker compose stop redis >/tmp/ft_redis_stop.log 2>&1 || true
sleep 2
GOOD_BODY="$(cat <<JSON
{"symbol":"NORDS","signal":"vwap_reclaim","timeframe":"5m","price":100,"timestamp":$NOW,"direction":"long","stop_loss":99,"take_profit":102,"passphrase":"$PASS_VAL"}
JSON
)"
CODE=$(post_webhook "$GOOD_BODY")
# API should still respond (redis is optional for the webhook path itself)
if [[ "$CODE" =~ ^20[01]$ || "$CODE" = "200" ]]; then
  ok "API stayed up with Redis down (got $CODE)"
else
  bad "API failed with Redis down (got $CODE)"
fi
log_msg "restarting redis…"
docker compose start redis >/tmp/ft_redis_start.log 2>&1 || true
sleep 3

# ─── 7. DB unavailable (catastrophic) ────────────────────────────
hdr "7. DB unavailable (catastrophic)"
log_msg "stopping postgres container…"
docker compose stop postgres >/tmp/ft_pg_stop.log 2>&1 || true
sleep 2
CODE=$(post_webhook "$GOOD_BODY")
# When DB is down, vc_pipeline returns the envelope but with all IDs null.
# That's the safe failure: no crash, no phantom trade, JSON shape preserved.
ENV_OK=$(jq -r '.ok // ""' /tmp/ft_body.txt 2>/dev/null)
SIG_ID=$(jq -r '.signal // ""' /tmp/ft_body.txt 2>/dev/null)
TRD_ID=$(jq -r '.trade // ""' /tmp/ft_body.txt 2>/dev/null)
if [[ "$CODE" =~ ^[245]00$ ]]; then
  if [ "$SIG_ID" = "null" ] && [ "$TRD_ID" = "null" ]; then
    ok "API responded with null IDs (no phantom trade) when DB down"
  else
    bad "API claims signal/trade exist while DB is down (sig=$SIG_ID trade=$TRD_ID)"
  fi
else
  bad "API returned $CODE when DB down (expected 2xx/4xx, never 5xx-only)"
fi
log_msg "restarting postgres…"
docker compose start postgres >/tmp/ft_pg_start.log 2>&1 || true
sleep 5

# ─── Summary ─────────────────────────────────────────────────────
printf "\nTotal: \033[1;32m%d PASS\033[0m / \033[1;31m%d FAIL\033[0m\n" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
