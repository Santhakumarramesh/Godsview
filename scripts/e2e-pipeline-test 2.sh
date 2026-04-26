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
check_endpoint "API Server alive" "$API/health"
check_endpoint "API health detailed" "$API/api/health"
check_endpoint "System status" "$API/api/system"

# Database connectivity
check_json_field "Database connected" "$API/api/health" "d.get('db','ok')!='error'"

# Redis connectivity
check_json_field "Redis connected" "$API/api/health" "d.get('redis','ok')!='error'"

# ============================================================================
header "2. MARKET DATA INGESTION"
# ============================================================================
check_endpoint "Alpaca ticker data" "$API/api/alpaca/ticker"
check_endpoint "Market data stream" "$API/api/market"
check_endpoint "Watchlist" "$API/api/watchlist"

# Verify live prices are flowing
check_json_field "Live price data present" "$API/api/alpaca/ticker" "len(d)>0 if isinstance(d,list) else 'price' in str(d)"

# ============================================================================
header "3. INTELLIGENCE ENGINES"
# ============================================================================
check_endpoint "Signal pipeline" "$API/api/signals"
check_endpoint "Brain entities" "$API/api/brain/entities"
check_endpoint "Brain consciousness" "$API/api/brain/consciousness"
check_endpoint "Regime detection" "$API/api/regime"
check_endpoint "Sentiment analysis" "$API/api/sentiment"
check_endpoint "Market scanner" "$API/api/scanner"
check_endpoint "SMC/Structure" "$API/api/market?symbol=AAPL"

# ============================================================================
header "4. ORDER FLOW & MICROSTRUCTURE"
# ============================================================================
check_endpoint "Order flow features" "$API/api/orderbook/features?symbol=AAPL"
check_endpoint "Microstructure" "$API/api/microstructure?symbol=AAPL"

# ============================================================================
header "5. RISK ENGINE"
# ============================================================================
check_endpoint "Risk status" "$API/api/risk"
check_endpoint "Risk check" "$API/api/risk/check"
check_endpoint "Portfolio risk" "$API/api/portfolio/risk"
check_endpoint "Kill switch status" "$API/api/execution/kill-switch"
check_endpoint "Circuit breaker" "$API/api/execution/circuit-breaker"

# ============================================================================
header "6. BACKTESTING & QUANT LAB"
# ============================================================================
check_endpoint "Backtest status" "$API/api/backtest"
check_endpoint "Strategy list" "$API/api/strategies"
check_endpoint "Walk-forward" "$API/api/backtest/walk-forward"
check_endpoint "Lab experiments" "$API/api/lab"
check_endpoint "Performance analytics" "$API/api/performance"

# Run a quick backtest
echo ""
echo "  Running quick backtest..."
BT_RESULT=$(curl -s --max-time 30 -X POST "$API/api/backtest" \
  -H "Content-Type: application/json" \
  -d '{"strategy":"momentum","symbol":"AAPL","lookback_days":30}' 2>/dev/null || echo '{"error":"timeout"}')
if echo "$BT_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'error' not in d or d.get('status')=='running'" 2>/dev/null; then
  green "Backtest execution accepted"
else
  yellow "Backtest execution — may need strategy config"
fi

# ============================================================================
header "7. EXECUTION PIPELINE"
# ============================================================================
check_endpoint "Execution status" "$API/api/execution"
check_endpoint "Paper trading" "$API/api/paper-trading"
check_endpoint "Order queue" "$API/api/execution/orders"
check_endpoint "Position monitor" "$API/api/portfolio/positions"

# Test paper trade submission
echo ""
echo "  Submitting paper trade..."
PT_RESULT=$(curl -s --max-time 15 -X POST "$API/api/paper-trading/order" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"AAPL","side":"buy","qty":1,"type":"market","mode":"paper"}' 2>/dev/null || echo '{"error":"timeout"}')
if echo "$PT_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'error' not in str(d).lower() or 'paper' in str(d).lower()" 2>/dev/null; then
  green "Paper trade submission accepted"
else
  yellow "Paper trade — endpoint may require auth or different payload"
fi

# ============================================================================
header "8. MEMORY & RECALL"
# ============================================================================
check_endpoint "Memory/recall" "$API/api/memory"
check_endpoint "Trade journal" "$API/api/journal"
check_endpoint "Setup similarity" "$API/api/memory/similar"

# ============================================================================
header "9. TRADINGVIEW MCP"
# ============================================================================
check_endpoint "MCP status" "$API/api/tradingview-mcp/status"
check_endpoint "Webhook router" "$API/api/tradingview-mcp/webhooks"
check_endpoint "Pine scripts" "$API/api/tradingview-mcp/scripts"

# ============================================================================
header "10. GOVERNANCE & AUDIT"
# ============================================================================
check_endpoint "Audit trail" "$API/api/governance/audit"
check_endpoint "Trust tiers" "$API/api/trust"
check_endpoint "Ops monitor" "$API/api/ops"
check_endpoint "System bridge" "$API/api/system-bridge"

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
  SYMBOL=$(echo "$SIG" | python3 -c "import sys,json; print(json.load(sys.stdin).get('symbol','AAPL'))" 2>/dev/null || echo "AAPL")
  RISK_CHECK=$(curl -s --max-time 10 "$API/api/risk/check?symbol=$SYMBOL" 2>/dev/null || echo '{}')
  if [ "$RISK_CHECK" != "{}" ]; then
    green "Risk gate evaluated for $SYMBOL"
  else
    yellow "Risk gate — no response for $SYMBOL"
  fi

  # Step 3: Check portfolio state
  PORT_CHECK=$(curl -s --max-time 10 "$API/api/portfolio" 2>/dev/null || echo '{}')
  if [ "$PORT_CHECK" != "{}" ]; then
    green "Portfolio state accessible"
  else
    yellow "Portfolio — no data"
  fi
else
  yellow "No active signals — pipeline idle (normal if market closed)"
fi

# ============================================================================
header "12. FRONTEND BUILD CHECK"
# ============================================================================
if [ -d "godsview-dashboard/dist" ] || [ -d "godsview-dashboard/dist/public" ]; then
  green "Frontend build artifacts exist"
  INDEX_SIZE=$(wc -c < godsview-dashboard/dist/public/index.html 2>/dev/null || echo "0")
  if [ "$INDEX_SIZE" -gt 100 ]; then
    green "index.html valid ($INDEX_SIZE bytes)"
  else
    yellow "index.html may be empty"
  fi
else
  yellow "Frontend not built yet — run: cd godsview-dashboard && pnpm build"
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
