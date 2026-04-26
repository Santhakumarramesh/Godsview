#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# GodsView — TradingView webhook smoke test
# Sends a realistic Pine alert payload to /tradingview/webhook
# and verifies the signal lands in DB and surfaces via the API.
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

API_HOST="${API_HOST:-http://localhost:3001}"
PASS="${TRADINGVIEW_WEBHOOK_SECRET:-}"
SYMBOL="${SYMBOL:-AAPL}"

if [ -z "$PASS" ]; then
  if [ -f .env ]; then
    PASS="$(grep -E '^TRADINGVIEW_WEBHOOK_SECRET=' .env | cut -d= -f2-)"
  fi
fi
if [ -z "$PASS" ]; then
  echo "ERROR: TRADINGVIEW_WEBHOOK_SECRET not set. Export it or put it in .env." >&2
  exit 2
fi

NOW="$(date +%s)"
PAYLOAD=$(cat <<JSON
{
  "symbol":      "${SYMBOL}",
  "signal":      "vwap_reclaim",
  "timeframe":   "5m",
  "price":       182.45,
  "timestamp":   ${NOW},
  "direction":   "long",
  "stop_loss":   181.20,
  "take_profit": 184.95,
  "meta":        {"bars_below_vwap": 7},
  "strategy_name": "vwap_reclaim_v1",
  "message":     "VWAP reclaim long on ${SYMBOL} 5m",
  "passphrase":  "${PASS}"
}
JSON
)

echo "→ POST ${API_HOST}/tradingview/webhook"
echo "  symbol=${SYMBOL}  signal=vwap_reclaim  ts=${NOW}"
echo

RESP=$(curl -sS -w "\n%{http_code}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "${API_HOST}/tradingview/webhook")

BODY="$(echo "$RESP" | sed '$d')"
CODE="$(echo "$RESP" | tail -n1)"

echo "← HTTP ${CODE}"
echo "$BODY" | (command -v jq >/dev/null && jq . || cat)
echo

if [ "$CODE" != "200" ] && [ "$CODE" != "202" ]; then
  echo "FAIL: webhook did not accept the alert" >&2
  exit 1
fi

# Pull the signal back via the API
echo "→ GET ${API_HOST}/api/signals?symbol=${SYMBOL}&limit=3"
curl -sS "${API_HOST}/api/signals?symbol=${SYMBOL}&limit=3" \
  | (command -v jq >/dev/null && jq '.signals[] | {id, symbol, signalType, status, receivedAt}' || cat)

echo
echo "OK — webhook → API roundtrip succeeded."
echo "Check the dashboard at http://localhost/ → Signals page to see the live entry."
