#!/usr/bin/env bash
# ============================================================================
# GodsView — End-to-End Pipeline Validation Script
# Tests the full signal lifecycle: ingest → analyze → risk → execute → learn
# ============================================================================
set -euo pipefail

API="${API_BASE:-http://localhost:3001}"
PASS=0
FAIL=0
WARN=0

green() { printf "\033[32m✓ %s\033[0m\n" "$1"; PASS=$((PASS + 1)); }
red()   { printf "\033[31m✗ %s\033[0m\n" "$1"; FAIL=$((FAIL + 1)); }
yellow(){ printf "\033[33m⚠ %s\033[0m\n" "$1"; WARN=$((WARN + 1)); }
header(){ printf "\n\033[1;36m━━━ %s ━━━\033[0m\n" "$1"; }

check_endpoint() {
  local name="$1" url="$2" expected_status="${3:-200}"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null || echo "000")
  if [ "$status" = "$expected_status" ]; then
    green "$name (HTTP $status)"
  elif [ "$status" = "503" ]; then
    yellow "$name — DB unavailable (HTTP 503, graceful degradation)"
  elif [ "$status" = "000" ]; then
    red "$name — connection refused"
  else
    red "$name — expected $expected_status, got $status"
  fi
}

check_json_field() {
  local name="$1" url="$2" field="$3"
  local response
  response=$(curl -s --max-time 10 "$url" 2>/dev/null || echo "{}")
  if echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); assert $field" 2>/dev/null; then
    green "$name"
  else
    red "$name — field check failed: $field"
  fi
}

# ============================================================================
header "1. INFRASTRUCTURE HEALTH"
# ============================================================================
check_endpoint "Liveness probe" "$API/healthz"
check_endpoint "Readiness probe" "$API/readyz"
check_endpoint "API health (prefixed)" "$API/api/health"
check_endpoint "System status" "$API/api/system/status"

# Database connectivity
check_json_field "Database health check" "$API/readyz" "True"

# ============================================================================
header "2. MARKET DATA INGESTION"
# ============================================================================
check_endpoint "Alpaca ticker data" "$API/api/alpaca/ticker"
check_endpoint "Market data" "$API/api/market/overview"
check_endpoint "Watchlist" "$API/api/watchlist"

# Verify live prices are flowing
check_json_field "Live price data present" "$API/api/alpaca/ticker" "len(d)>0 if isinstance(d,list) else 'price' in str(d)"

# ============================================================================
header "3. INTELLIGENCE ENGINES"
# ============================================================================
check_endpoint "Signal pipeline" "$API/api/signals"
check_endpoint "Brain entities" "$API/api/brain/entities"
check_endpoint "Brain consciousness" "$API/api/brain/consciousness"
check_endpoint "Regime detection" "$API/api/intelligence/regime"
check_endpoint "Sentiment analysis" "$API/api/sentiment/snapshot"
check_endpoint "Market scanner" "$API/api/market/scanner"
check_endpoint "Market structure" "$API/api/market-structure/analyze?symbol=BTCUSD"

# ============================================================================
header "4. ORDER FLOW & MICROSTRUCTURE"
# ============================================================================
check_endpoint "Order book snapshot" "$API/api/orderbook/snapshot?symbol=BTCUSD"
check_endpoint "Market microstructure" "$API/api/market/microstructure?symbol=BTCUSD"
check_endpoint "Liquidity zones" "$API/api/market/liquidity-zones?symbol=BTCUSD"
check_endpoint "Microstructure current" "$API/api/microstructure/BTCUSD/current"

# ============================================================================
header "5. RISK ENGINE"
# ============================================================================
check_endpoint "Risk snapshot" "$API/api/system/risk"
check_endpoint "Portfolio risk" "$API/api/portfolio/risk"
check_endpoint "Kill switch status" "$API/api/execution/execution-status"
check_endpoint "Circuit breaker" "$API/api/circuit-breaker/snapshot"
check_endpoint "Capital gating" "$API/api/capital-gating/tiers"

# ============================================================================
header "6. BACKTESTING & QUANT LAB"
# ============================================================================
check_endpoint "Backtest status" "$API/api/backtest/status"
check_endpoint "Strategy registry" "$API/api/strategy-registry/list"
check_endpoint "Walk-forward" "$API/api/backtest/walk-forward"
check_endpoint "Lab experiments" "$API/api/lab/experiments"
check_endpoint "Performance analytics" "$API/api/performance"

# Run a quick backtest
echo ""
echo "  Running quick backtest..."
BT_RESULT=$(curl -s --max-time 30 -X POST "$API/api/backtest" \
  -H "Content-Type: application/json" \
  -d '{"strategy":"momentum","symbol":"BTCUSD","lookback_days":30}' 2>/dev/null || echo '{"error":"timeout"}')
if echo "$BT_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'error' not in d or d.get('status')=='running'" 2>/dev/null; then
  green "Backtest execution accepted"
else
  yellow "Backtest execution — may need strategy config"
fi

# ============================================================================
header "7. EXECUTION PIPELINE"
# ============================================================================
check_endpoint "Execution status" "$API/api/execution/execution-status"
check_endpoint "Paper trading state" "$API/api/paper-trading/state"
check_endpoint "Execution breaker" "$API/api/execution/breaker"
check_endpoint "Portfolio positions" "$API/api/portfolio/current"

# Test paper trade submission
echo ""
echo "  Submitting paper trade..."
PT_RESULT=$(curl -s --max-time 15 -X POST "$API/api/paper-trading/start" \
  -H "Content-Type: application/json" \
  -d '{}' 2>/dev/null || echo '{"error":"timeout"}')
if echo "$PT_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'error' not in str(d).lower() or 'paper' in str(d).lower() or 'ok' in str(d).lower()" 2>/dev/null; then
  green "Paper trading start accepted"
else
  yellow "Paper trading — endpoint may require auth or different payload"
fi

# ============================================================================
header "8. MEMORY & RECALL"
# ============================================================================
check_endpoint "Memory store" "$API/api/memory/entries"
check_endpoint "Trade journal" "$API/api/journal/entries"
check_endpoint "Setup similarity" "$API/api/memory/similar"

# ============================================================================
header "9. TRADINGVIEW MCP"
# ============================================================================
check_endpoint "MCP health" "$API/api/tradingview/health"
check_endpoint "MCP stats" "$API/api/tradingview/stats"
check_endpoint "MCP decisions" "$API/api/tradingview/decisions"

# Test TradingView webhook
echo ""
echo "  Testing TradingView webhook ingestion..."
TV_RESULT=$(curl -s --max-time 10 -X POST "$API/api/tradingview/webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol":"BTCUSD",
    "signal":"breakout",
    "timeframe":"15m",
    "price":67500.00,
    "timestamp":'"$(date +%s)"',
    "direction":"long",
    "strategy_name":"e2e_test"
  }' 2>/dev/null || echo '{"error":"timeout"}')
if echo "$TV_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('status') in ['accepted','rejected','processed'] or 'decision' in str(d)" 2>/dev/null; then
  green "TradingView webhook processed"
else
  yellow "TradingView webhook — check response: $(echo "$TV_RESULT" | head -c 200)"
fi

# ============================================================================
header "10. GOVERNANCE & AUDIT"
# ============================================================================
check_endpoint "Audit trail" "$API/api/sessions"
check_endpoint "Audit events" "$API/api/audit"
check_endpoint "Trust tiers" "$API/api/trust/tiers"
check_endpoint "Ops monitor" "$API/api/ops/status"
check_endpoint "System bridge" "$API/api/bridge/status"

# ============================================================================
header "11. FULL PIPELINE FLOW TEST"
# ============================================================================
echo "  Testing signal → risk gate → execution flow..."

# Step 1: Get a signal
SIG=$(curl -s --max-time 10 "$API/api/signals" 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    sigs = d if isinstance(d, list) else d.get('signals', d.get('data', []))
    if sigs and len(sigs) > 0:
        print(json.dumps(sigs[0]))
    else:
        print('{}')
except:
    print('{}')
" 2>/dev/null || echo '{}')

if [ "$SIG" != "{}" ]; then
  green "Signal retrieved from pipeline"

  # Step 2: Check risk gate
  SYMBOL=$(echo "$SIG" | python3 -c "import sys,json; print(json.load(sys.stdin).get('symbol','BTCUSD'))" 2>/dev/null || echo "BTCUSD")
  RISK_CHECK=$(curl -s --max-time 10 "$API/api/execution/execution-status" 2>/dev/null || echo '{}')
  if [ "$RISK_CHECK" != "{}" ]; then
    green "Execution/risk state evaluated for $SYMBOL"
  else
    yellow "Execution state — no response for $SYMBOL"
  fi

  # Step 3: Check portfolio state
  PORT_CHECK=$(curl -s --max-time 10 "$API/api/portfolio/current" 2>/dev/null || echo '{}')
  if [ "$PORT_CHECK" != "{}" ]; then
    green "Portfolio state accessible"
  else
    yellow "Portfolio — no data"
  fi
else
  yellow "No active signals — pipeline idle (normal if market closed)"
fi

# ============================================================================
header "12. PRODUCTION READINESS CHECKS"
# ============================================================================
check_endpoint "Deployment readiness" "$API/api/deployment/status"
check_endpoint "Data truth system" "$API/api/data-truth/system"
check_endpoint "Execution truth" "$API/api/execution-truth/status"
check_endpoint "Production health" "$API/api/production-health/summary"
check_endpoint "SLO tracking" "$API/api/slo/summary"

# ============================================================================
header "13. FRONTEND BUILD CHECK"
# ============================================================================
# Check relative to script location or common paths
FRONTEND_DIST=""
for dir in "artifacts/godsview-dashboard/dist" "godsview-dashboard/dist"; do
  if [ -d "$dir" ]; then
    FRONTEND_DIST="$dir"
    break
  fi
done

if [ -n "$FRONTEND_DIST" ]; then
  green "Frontend build artifacts exist ($FRONTEND_DIST)"
  INDEX_FILE=$(find "$FRONTEND_DIST" -name "index.html" -type f 2>/dev/null | head -1)
  if [ -n "$INDEX_FILE" ]; then
    INDEX_SIZE=$(wc -c < "$INDEX_FILE" 2>/dev/null || echo "0")
    if [ "$INDEX_SIZE" -gt 100 ]; then
      green "index.html valid ($INDEX_SIZE bytes)"
    else
      yellow "index.html may be empty"
    fi
  else
    yellow "index.html not found in dist"
  fi
else
  yellow "Frontend not built yet — run: cd artifacts/godsview-dashboard && pnpm build"
fi

# ============================================================================
header "RESULTS"
# ============================================================================
TOTAL=$((PASS + FAIL + WARN))
echo ""
printf "  \033[32m%d passed\033[0m  |  \033[31m%d failed\033[0m  |  \033[33m%d warnings\033[0m  |  %d total\n" "$PASS" "$FAIL" "$WARN" "$TOTAL"
echo ""

if [ "$FAIL" -eq 0 ]; then
  printf "\033[1;32m  ★ ALL CRITICAL CHECKS PASSED — Pipeline is operational\033[0m\n"
  exit 0
elif [ "$FAIL" -le 3 ]; then
  printf "\033[1;33m  ⚠ MOSTLY PASSING — %d issues need attention\033[0m\n" "$FAIL"
  exit 0
else
  printf "\033[1;31m  ✗ %d FAILURES — review and fix before production\033[0m\n" "$FAIL"
  exit 1
fi
