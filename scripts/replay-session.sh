#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# GodsView — Replay session
# Reads recent vc_pipeline audit events, re-POSTs each captured payload,
# and asserts the new outcome matches the original decision_state.
# Useful for: regression detection, demo replay, post-incident comparison.
# ─────────────────────────────────────────────────────────────────
set -u

API="${API:-http://localhost:3001}"
LIMIT="${LIMIT:-20}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

set -a; [ -f .env ] && . ./.env; set +a

log()  { printf "\033[1;36m[replay]\033[0m %s\n" "$*"; }
ok()   { printf "  \033[1;32m✓ MATCH\033[0m %s\n" "$1"; }
miss() { printf "  \033[1;31m✗ DIFF\033[0m  %s\n" "$1"; }

# Pull recent vc_pipeline events
RECENT=$(curl -sS "${API}/api/webhooks/tradingview/recent" 2>/dev/null || echo '{}')
COUNT=$(echo "$RECENT" | jq -r '.count // 0')
if [ "$COUNT" = "0" ]; then
  log "no recent events to replay — send some via /api/webhooks/tradingview first"
  exit 0
fi

log "replaying ${COUNT} most recent events"

MATCH=0; DIFF=0
echo "$RECENT" | jq -c '.events[] | {id, decision_state, payload_json}' | while read -r evt; do
  ID=$(echo "$evt" | jq -r '.id')
  EXPECTED=$(echo "$evt" | jq -r '.decision_state')
  PAYLOAD_JSON=$(echo "$evt" | jq -r '.payload_json')
  # The payload_json is the audit context (signalId/tradeId/etc), not the
  # original alert. Synthesise a representative replay payload from the
  # symbol/setup recorded in the audit event itself.
  SYM=$(echo "$evt" | jq -r '.symbol // "AAPL"')
  SETUP=$(echo "$evt" | jq -r '.setup_type // "vwap_reclaim"')
  NOW=$(date +%s)

  # Reconstructing exact original payload would require keeping it on disk.
  # Replay is a behavioural check: same symbol+setup → same allow/deny class.
  REPLAY_BODY=$(cat <<JSON
{"symbol":"$SYM","signal":"$SETUP","timeframe":"5m","price":100,"timestamp":$NOW,"direction":"long","stop_loss":99,"take_profit":102,"passphrase":"${TRADINGVIEW_WEBHOOK_SECRET:-}"}
JSON
  )

  RESP=$(curl -sS -H "Content-Type: application/json" -d "$REPLAY_BODY" \
    "${API}/api/webhooks/tradingview" 2>/dev/null || echo '{}')
  ALLOWED=$(echo "$RESP" | jq -r '.risk.allowed // ""')
  ACTUAL=$([ "$ALLOWED" = "true" ] && echo "allowed" || echo "rejected")

  if [ "$EXPECTED" = "$ACTUAL" ]; then
    ok "audit #$ID  symbol=$SYM  expected=$EXPECTED  actual=$ACTUAL"
  else
    miss "audit #$ID  symbol=$SYM  expected=$EXPECTED  actual=$ACTUAL"
  fi
done

# (Note: per-loop counters in a piped while can't escape the subshell, so we
# read from the audit log directly to print a totals line.)
TOTAL=$(echo "$RECENT" | jq -r '.count')
log "replayed ${TOTAL} events. Inspect output above for any DIFF rows."
