#!/usr/bin/env bash
# scripts/per-page-health.sh
# For each major dashboard page, hit its key API endpoint(s) with a
# generous timeout and report which pages are fully alive vs degraded.

set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# format: PAGE_NAME|URL_PATH|primary_endpoint
PAGES="
home|/|/api/system/status
god-brain|/|/api/system/status
brain-graph|/brain-graph|/api/signals
brain|/brain|/api/brain/state
brain-nodes|/brain-nodes|/api/system/health/deep
bloomberg-terminal|/bloomberg-terminal|/api/alpaca/positions/live
trade-journal|/trade-journal|/api/trade-journal/snapshot
market-scanner|/market-scanner|/api/signals
watchlist|/watchlist|/api/alpaca/ticker?symbols=AAPL,MSFT
risk|/risk|/api/correlation/matrix
risk-command-v2|/risk-command-v2|/api/correlation/matrix
portfolio|/portfolio|/api/portfolio/summary
performance-analytics|/performance-analytics|/api/analytics/summary
pipeline|/pipeline|/api/system/pipeline/latest
microstructure|/microstructure|/api/microstructure/heatmap
order-flow|/order-flow|/api/orderflow/snapshot/BTCUSD
order-blocks|/order-blocks|/api/structure/order-blocks/BTCUSD
multi-timeframe|/multi-timeframe|/api/intelligence/mtf/confluence
regime-detection|/regime-detection|/api/intelligence/regime/current
regime-intelligence|/regime-intelligence|/api/intelligence/regime/current
candle-xray|/candle-xray|/api/alpaca/bars?symbol=BTCUSD&timeframe=1Hour
heatmap-liquidity|/heatmap-liquidity|/api/orderbook/snapshot/BTCUSD
footprint-delta|/footprint-delta|/api/features/BTCUSD
flow-confluence|/flow-confluence|/api/orderflow/snapshot/BTCUSD
liquidity-environment|/liquidity-environment|/api/orderflow/snapshot/BTCUSD
liquidity-sweep|/liquidity-sweep|/api/orderflow/snapshot/BTCUSD
absorption-detector|/absorption-detector|/api/orderflow/snapshot/BTCUSD
imbalance-engine|/imbalance-engine|/api/orderflow/snapshot/BTCUSD
execution-pressure|/execution-pressure|/api/orderflow/snapshot/BTCUSD
dom-depth|/dom-depth|/api/orderbook/snapshot/BTCUSD
trades|/trades|/api/trades
execution|/execution|/api/alpaca/orders
execution-control|/execution-control|/api/alpaca/orders
exec-reliability|/exec-reliability|/api/execution-truth/reliability
position-monitor|/position-monitor|/api/alpaca/positions/live
allocation-engine|/allocation-engine|/api/portfolio/allocation
correlation-risk|/correlation-risk|/api/correlation/matrix
correlation-lab|/correlation-lab|/api/correlation/matrix
drawdown-protection|/drawdown-protection|/api/correlation/drawdown
risk-policies|/risk-policies|/api/risk/policies
pretrade-gate|/pretrade-gate|/api/risk/policies
capital-efficiency|/capital-efficiency|/api/capital-gating/launch/status
capital-gating|/capital-gating|/api/capital-gating/launch/status
slippage-quality|/slippage-quality|/api/microstructure/slippage?symbol=BTCUSD&side=buy&quantity=10
emergency-controls|/emergency-controls|/api/system/kill-switch
session-control|/session-control|/api/system/status
alerts|/alerts|/api/alerts/active
alert-center|/alert-center|/api/alerts/active
sentiment-intel|/sentiment-intel|/api/sentiment/snapshot
news-sentiment|/news-sentiment|/api/news/sentiment
data-integrity|/data-integrity|/api/data-integrity/health
system|/system|/api/system/status
system-audit|/system-audit|/api/governance/audit
proof|/proof|/api/proof/status
super-intelligence|/super-intelligence|/api/super-intelligence/status
intelligence-center|/intelligence-center|/api/intelligence/health
recall-engine|/recall-engine|/api/memory/stats
case-library|/case-library|/api/memory/failures
setup-similarity|/setup-similarity|/api/memory/stats
screenshot-vault|/screenshot-vault|/api/memory/stats
learning-loop|/learning-loop|/api/learning/snapshot
quant-lab|/quant-lab|/api/strategies
strategy-builder|/strategy-builder|/api/strategies
backtester|/backtester|/api/backtest-v2/results
mcp-backtester|/mcp-backtester|/api/backtest-v2/results
backtest-credibility|/backtest-credibility|/api/backtest-v2/results
walk-forward|/walk-forward|/api/walk-forward/status
experiment-tracker|/experiment-tracker|/api/strategies
promotion-pipeline|/promotion-pipeline|/api/capital-gating/launch/status
trust-surface|/trust-surface|/api/trust/surface
model-governance|/model-governance|/api/governance/audit
trade-credibility|/backtest-credibility|/api/backtest-v2/results
strategy-radar|/system|/api/strategies
heat-board|/heat-board|/api/signals
opportunity-queue|/heat-board|/api/signals
chart-action-bridge|/chart-action-bridge|/api/tradingview/health
chart-annotations|/chart-annotations|/api/tradingview/health
tradingview-mcp|/tradingview-mcp|/api/tradingview/health
tv-replay|/tv-replay|/api/tradingview/health
tv-strategy-sync|/tv-strategy-sync|/api/tradingview/health
pine-scripts|/pine-scripts|/api/tradingview/health
webhook-router|/webhook-router|/api/tradingview/health
tradingview-chart|/tradingview-chart|/api/alpaca/bars?symbol=AAPL&timeframe=1Hour
"

REAL=0; DEGRADED=0; BROKEN=0
echo "Per-page health (15s timeout per endpoint):"
echo "──────────────────────────────────────────────────────────────"
printf "%-30s %-8s %s\n" "PAGE" "STATUS" "ENDPOINT"
echo "──────────────────────────────────────────────────────────────"

while IFS='|' read -r PAGE RPATH EP; do
  [ -z "$PAGE" ] && continue
  [ "$PAGE" = "PAGE_NAME" ] && continue
  CODE=$(curl -sS -m 15 -o /dev/null -w "%{http_code}" "http://localhost${EP}" 2>/dev/null || echo 000)
  case "$CODE" in
    200|307)
      printf "  \033[1;32m✓\033[0m %-26s %-8s %s\n" "$PAGE" "$CODE" "$EP"
      REAL=$((REAL+1)) ;;
    400|401|403|404|423)
      printf "  \033[1;33m~\033[0m %-26s %-8s %s\n" "$PAGE" "$CODE" "$EP"
      DEGRADED=$((DEGRADED+1)) ;;
    *)
      printf "  \033[1;31m✗\033[0m %-26s %-8s %s\n" "$PAGE" "$CODE" "$EP"
      BROKEN=$((BROKEN+1)) ;;
  esac
done <<< "$PAGES"

echo "──────────────────────────────────────────────────────────────"
TOTAL=$((REAL + DEGRADED + BROKEN))
printf "  \033[1;32mLive: %d\033[0m   \033[1;33mDegraded: %d\033[0m   \033[1;31mBroken: %d\033[0m   /  %d total\n" "$REAL" "$DEGRADED" "$BROKEN" "$TOTAL"
