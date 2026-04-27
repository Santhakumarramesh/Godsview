#!/usr/bin/env bash
# scripts/full-system-check.sh
# One-shot end-to-end verification: containers up, keys loaded, Alpaca
# authenticated, endpoints clean, daily validation green. Outputs a
# clean summary so we can see exactly what's working and what isn't.
#
# Run with:  bash scripts/full-system-check.sh

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PASS=0
FAIL=0
WARN=0
ok()   { printf "  \033[1;32m✓ PASS\033[0m %s\n" "$1"; PASS=$((PASS+1)); }
bad()  { printf "  \033[1;31m✗ FAIL\033[0m %s\n" "$1"; FAIL=$((FAIL+1)); }
warn() { printf "  \033[1;33m! WARN\033[0m %s\n" "$1"; WARN=$((WARN+1)); }
hdr()  { printf "\n\033[1;35m── %s ──\033[0m\n" "$1"; }

# ─── 1. Containers running ─────────────────────────────────────
hdr "1. Docker stack"
for svc in postgres redis api nginx; do
  state=$(docker compose ps --format json 2>/dev/null \
    | grep -o "\"Service\":\"$svc\"[^}]*\"State\":\"[a-z]*\"" \
    | grep -o '"State":"[a-z]*"' \
    | cut -d'"' -f4 | head -1)
  if [ "$state" = "running" ]; then
    ok "$svc: running"
  else
    bad "$svc: not running (state=$state)"
  fi
done

# ─── 2. API health ─────────────────────────────────────────────
hdr "2. API health"
HEALTH=$(curl -sS -m 5 -o /dev/null -w "%{http_code}" http://localhost/health 2>/dev/null || echo 000)
[ "$HEALTH" = "200" ] && ok "/health → 200" || bad "/health → $HEALTH"

# ─── 3. Keys loaded into container ─────────────────────────────
hdr "3. API keys reaching container"
docker compose exec -T api sh -c '
  printf "  ALPACA_API_KEY length:    "; v=$(printenv ALPACA_API_KEY); echo "${#v}"
  printf "  ALPACA_SECRET_KEY length: "; v=$(printenv ALPACA_SECRET_KEY); echo "${#v}"
  printf "  ANTHROPIC_API_KEY length: "; v=$(printenv ANTHROPIC_API_KEY); echo "${#v}"
  printf "  FINNHUB_API_KEY length:   "; v=$(printenv FINNHUB_API_KEY); echo "${#v}"
  printf "  ALPHA_VANTAGE_API_KEY length: "; v=$(printenv ALPHA_VANTAGE_API_KEY); echo "${#v}"
  printf "  TIINGO_API_KEY length:    "; v=$(printenv TIINGO_API_KEY); echo "${#v}"
  printf "  FRED_API_KEY length:      "; v=$(printenv FRED_API_KEY); echo "${#v}"
'

# ─── 4. Alpaca account authenticated ───────────────────────────
hdr "4. Alpaca authentication"
sleep 2  # let WS handshake complete
ACCT=$(curl -sS -m 8 -o /tmp/gv-acct.json -w "%{http_code}" \
  http://localhost/api/alpaca/account 2>/dev/null || echo 000)
if [ "$ACCT" = "200" ]; then
  STATUS=$(jq -r .status /tmp/gv-acct.json 2>/dev/null)
  EQUITY=$(jq -r .equity /tmp/gv-acct.json 2>/dev/null)
  BUYING=$(jq -r .buying_power /tmp/gv-acct.json 2>/dev/null)
  if [ "$STATUS" = "ACTIVE" ]; then
    ok "Alpaca authenticated — equity=\$$EQUITY, buying_power=\$$BUYING"
  else
    warn "Alpaca returned 200 but status=$STATUS"
  fi
else
  bad "/api/alpaca/account → $ACCT"
  echo "    body: $(head -c 200 /tmp/gv-acct.json 2>/dev/null)"
fi
rm -f /tmp/gv-acct.json

# ─── 5. Stream authenticated ───────────────────────────────────
hdr "5. Alpaca stream"
SS=$(curl -sS -m 5 http://localhost/api/alpaca/stream-status 2>/dev/null)
AUTH=$(echo "$SS" | jq -r .authenticated 2>/dev/null)
WS=$(echo "$SS"   | jq -r .wsState 2>/dev/null)
TICKS=$(echo "$SS"| jq -r .ticksReceived 2>/dev/null)
[ "$AUTH" = "true" ] && ok "Stream authenticated (ws=$WS, ticks=$TICKS)" \
  || warn "Stream not yet authenticated (ws=$WS, auth=$AUTH) — may take ~30s after restart"

# ─── 6. Endpoint sweep ─────────────────────────────────────────
hdr "6. Dashboard endpoint sweep"
if [ -f scripts/probe-dashboard-endpoints.sh ]; then
  bash scripts/probe-dashboard-endpoints.sh > /tmp/gv-probe.txt 2>&1
  N200=$(grep -c "^200" /tmp/gv-probe.txt 2>/dev/null || echo 0)
  N404=$(grep -c "^404" /tmp/gv-probe.txt 2>/dev/null || echo 0)
  N500=$(grep -cE "^5[0-9][0-9]" /tmp/gv-probe.txt 2>/dev/null || echo 0)
  N503=$(grep -c "^503" /tmp/gv-probe.txt 2>/dev/null || echo 0)
  ok "Endpoints returning 200: $N200"
  [ "$N404" = "0" ] && ok "404s: 0" || bad "404s: $N404"
  [ "$N500" = "0" ] && ok "5xx: 0" || (
    if [ "$N500" -gt "0" ] && [ "$N503" -gt "0" ]; then
      warn "5xx: $N500 ($N503 are 503 — Alpaca-dependent, expected if you haven't keyed Alpaca yet)"
    else
      bad "5xx: $N500"
      grep -E "^5[0-9][0-9]" /tmp/gv-probe.txt | sed 's/^/      /'
    fi
  )
  rm -f /tmp/gv-probe.txt
else
  warn "probe-dashboard-endpoints.sh not present, skipping sweep"
fi

# ─── 7. Daily validation ───────────────────────────────────────
hdr "7. Daily paper validation"
if bash scripts/daily-paper-validation.sh > /tmp/gv-daily.log 2>&1; then
  RESULT=$(grep -E "^RESULT:" /tmp/gv-daily.log | head -1)
  PCOUNT=$(grep -E "^PASS:"   /tmp/gv-daily.log | head -1)
  FCOUNT=$(grep -E "^FAIL:"   /tmp/gv-daily.log | head -1)
  ok "$PCOUNT  $FCOUNT  $RESULT"
else
  RESULT=$(grep -E "^RESULT:" /tmp/gv-daily.log | head -1)
  PCOUNT=$(grep -E "^PASS:"   /tmp/gv-daily.log | head -1)
  FCOUNT=$(grep -E "^FAIL:"   /tmp/gv-daily.log | head -1)
  bad "$PCOUNT  $FCOUNT  $RESULT"
  echo "    failures:"
  grep "✗ FAIL" /tmp/gv-daily.log | head -5 | sed 's/^/      /'
fi
rm -f /tmp/gv-daily.log

# ─── 8. URLs to open in browser ────────────────────────────────
hdr "8. Browser entry points"
echo "  Dashboard:        http://localhost/"
echo "  Mission control:  http://localhost/vc-mode"
echo "  Bloomberg term:   http://localhost/bloomberg-terminal"
echo "  Trade journal:    http://localhost/trade-journal"
echo "  Brain graph:      http://localhost/brain-graph"

# ─── Summary ────────────────────────────────────────────────────
hdr "Summary"
printf "  PASS: \033[1;32m%d\033[0m   WARN: \033[1;33m%d\033[0m   FAIL: \033[1;31m%d\033[0m\n" "$PASS" "$WARN" "$FAIL"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
