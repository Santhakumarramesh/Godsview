# GodsView Operator Runbook

This document provides step-by-step procedures for operating GodsView in production.

## Table of Contents

1. [Starting the System](#starting-the-system)
2. [Monitoring](#monitoring)
3. [Emergency Procedures](#emergency-procedures)
4. [Strategy Management](#strategy-management)
5. [Daily Operations](#daily-operations)
6. [Troubleshooting](#troubleshooting)
7. [Data Directory Structure](#data-directory-structure)

## Starting the System

### Environment Variables Required

Before starting, ensure these variables are set in `.env`:

```bash
# Alpaca Trading Credentials (paper or live)
ALPACA_API_KEY=your_key
ALPACA_API_SECRET=your_secret
ALPACA_PAPER=true        # Set to false for live trading

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/godsview

# System
NODE_ENV=production
PORT=3000
GODSVIEW_DATA_DIR=/path/to/artifacts/api-server/.runtime

# Optional
ANTHROPIC_API_KEY=your_claude_key
QUALITY_THRESHOLD=0.75
```

### Start Commands

#### Docker Compose (Recommended)

```bash
# Start all services (PostgreSQL + API Server)
docker compose up -d

# Verify services started
docker compose ps

# View API logs
docker compose logs -f api-server

# View database logs
docker compose logs -f postgres

# Stop services
docker compose down
```

#### Bare Metal

```bash
# Set data directory
export GODSVIEW_DATA_DIR=artifacts/api-server/.runtime

# Install dependencies (if needed)
pnpm install

# Build the API server
pnpm build

# Start API server
pnpm start

# Logs appear in console
# Press Ctrl+C to stop
```

### Health Check Verification

After startup, verify the system is ready:

```bash
# Liveness check (service running)
curl http://localhost:3000/api/healthz
# Expected response: { "status": "ok" }

# Readiness check (ready to serve traffic)
curl http://localhost:3000/api/readyz
# Expected response: { "status": "ready" } or { "status": "degraded" }

# System manifest (engine inventory)
curl http://localhost:3000/api/system/manifest
# Expected response: List of all loaded modules and versions

# Access dashboard
# Open http://localhost:3000 in browser
```

**Readiness States:**
- `READY` — All systems operational, safe to trade
- `DEGRADED` — Minor issues (e.g., slow market data feed), trading allowed with caution
- `INIT` — Starting up, wait for READY or DEGRADED
- `UNHEALTHY` — Critical issue, do not trade

Wait for readiness status before approving any strategies for autonomous execution.

## Monitoring

### Health Endpoints

#### /api/healthz (Liveness)
```bash
curl http://localhost:3000/api/healthz
```
Response when healthy:
```json
{
  "status": "ok",
  "timestamp": "2026-04-05T12:00:00Z"
}
```

#### /api/readyz (Readiness)
```bash
curl http://localhost:3000/api/readyz
```
Response:
```json
{
  "status": "ready",
  "reason": "All systems operational",
  "checks": {
    "database": "ok",
    "market_data": "ok",
    "alpaca": "ok"
  }
}
```

#### /api/system/manifest (Engine Inventory)
```bash
curl http://localhost:3000/api/system/manifest
```
Returns list of all loaded engines:
```json
{
  "version": "1.0.0",
  "engines": [
    {
      "name": "strategy_engine",
      "status": "ready",
      "setup_families": 5,
      "loaded_strategies": 12
    },
    {
      "name": "smc_engine",
      "status": "ready",
      "symbols_cached": 45
    },
    ...
  ]
}
```

#### /api/degradation (Service Degradation)
```bash
curl http://localhost:3000/api/degradation
```
Returns current degradation status:
```json
{
  "status": "healthy",
  "degradations": [],
  "last_check": "2026-04-05T12:00:00Z"
}
```

When degradations exist:
```json
{
  "status": "degraded",
  "degradations": [
    {
      "service": "market_data",
      "reason": "Alpaca WebSocket disconnected",
      "severity": "warning",
      "duration_seconds": 45
    }
  ]
}
```

### System Diagnostics

View detailed system state:

```bash
curl http://localhost:3000/api/system/diagnostics
```

Returns:
- Database connection status
- Market data feed latency
- Alpaca account status
- Open positions and P&L
- Risk guard status (kill switch, daily loss, exposure)
- ML model health (training samples, accuracy, drift)
- Recent error logs

### Live Event Stream

Monitor real-time intelligence events:

```bash
# WebSocket connection (in browser console or curl)
curl http://localhost:3000/api/brain/stream

# Events include:
# - Signal detection
# - Regime shift
# - Fill confirmation
# - Degradation alerts
# - Risk guard triggers
```

### Prometheus Metrics (Optional)

If Prometheus is configured:

```bash
# Scrape endpoint
curl http://localhost:3000/api/metrics

# Key metrics to monitor:
# - http_requests_total
# - signal_detection_rate
# - execution_rate
# - guard_rejection_rate
# - circuit_breaker_trips
# - model_drift_status
# - open_positions
# - equity_dollars
```

## Emergency Procedures

### Kill Switch Activation

**When to use**: Any time you need to stop all trading immediately (market crash, system error, etc.)

```bash
# Activate kill switch
curl -X POST http://localhost:3000/api/system/risk/kill-switch \
  -H "Content-Type: application/json" \
  -d '{"action": "activate", "reason": "Emergency market closure"}'

# Response
{
  "kill_switch_active": true,
  "timestamp": "2026-04-05T12:00:00Z",
  "all_orders_cancelled": true
}
```

**Effects:**
- All open orders cancelled immediately
- All new orders rejected with "kill switch active" error
- Does not close existing positions (use manual closing instead)
- Can be deactivated only by operator with token

```bash
# Deactivate kill switch (requires operator token)
curl -X POST http://localhost:3000/api/system/risk/kill-switch \
  -H "Authorization: Bearer $GODSVIEW_OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "deactivate"}'
```

### Circuit Breaker Manual Trip

**When to use**: When automated drawdown protection should trigger but hasn't

```bash
# Check current drawdown status
curl http://localhost:3000/api/system/risk

# If drawdown exceeds threshold, manually trip breaker
curl -X POST http://localhost:3000/api/system/risk/circuit-breaker \
  -H "Authorization: Bearer $GODSVIEW_OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "trip", "reason": "Manual operator trigger"}'

# Response
{
  "circuit_breaker_tripped": true,
  "all_positions_closed": true,
  "realized_pnl": -1250.50,
  "timestamp": "2026-04-05T12:00:00Z"
}
```

### Force Stop Autonomous Mode

**When to use**: Pause all autonomous trading while keeping the system running

```bash
# Stop autonomous execution
curl -X POST http://localhost:3000/api/system/mode \
  -H "Authorization: Bearer $GODSVIEW_OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mode": "assisted", "reason": "Manual mode switch for investigation"}'

# Response
{
  "execution_mode": "assisted",
  "autonomous_execution": false,
  "pending_orders": 3,
  "requires_operator_approval": true
}
```

Strategies revert to **live_assisted_approved** state. Orders still require manual operator approval via dashboard.

### Emergency Liquidation

**When to use**: Close all positions immediately (highest priority emergency)

```bash
# Close all open positions at market price
curl -X POST http://localhost:3000/api/execution/liquidate-all \
  -H "Authorization: Bearer $GODSVIEW_OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "liquidate_mode": "market",
    "reason": "Emergency full liquidation"
  }'

# Response
{
  "liquidation_status": "in_progress",
  "positions_to_close": 5,
  "estimated_time_seconds": 30,
  "timestamp": "2026-04-05T12:00:00Z"
}

# Poll for completion
curl http://localhost:3000/api/execution/liquidation-status
```

## Strategy Management

### Promoting a Strategy

Strategies follow a strict lifecycle. Each transition requires operator approval.

```bash
# 1. Check current status
curl http://localhost:3000/api/market/strict-setup?symbol=AAPL

# 2. Review backtest results
curl http://localhost:3000/api/market/strict-setup/backtest?strategy_id=absorption_reversal_001

# Expected response:
# {
#   "status": "backtested",
#   "backtest_metrics": {
#     "sharpe_ratio": 1.45,
#     "win_rate": 0.62,
#     "max_drawdown": -0.08,
#     "total_trades": 243
#   },
#   "equity_curve": [ ... ],
#   "trade_list": [ ... ]
# }

# 3. Check promotion readiness
curl http://localhost:3000/api/market/strict-setup/promotion-check?strategy_id=absorption_reversal_001

# Response:
# {
#   "ready_to_promote": true,
#   "current_state": "backtested",
#   "next_state": "stress_tested",
#   "checks": {
#     "sharpe_minimum": { "required": 1.0, "actual": 1.45, "pass": true },
#     "win_rate_minimum": { "required": 0.50, "actual": 0.62, "pass": true },
#     "max_drawdown_limit": { "required": 0.15, "actual": 0.08, "pass": true },
#     "walk_forward_window": { "required": "3m", "actual": "3m", "pass": true }
#   }
# }

# 4. If ready, promote to next stage
curl -X POST http://localhost:3000/api/market/strict-setup/promote \
  -H "Authorization: Bearer $GODSVIEW_OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "strategy_id": "absorption_reversal_001",
    "next_state": "stress_tested",
    "operator_notes": "Backtest looks good, proceeding to stress testing"
  }'

# 5. Once at paper_approved, monitor paper trades
curl http://localhost:3000/api/journal/trades?state=paper_trading

# 6. After min 20 paper trades, operator approves live
curl -X POST http://localhost:3000/api/market/strict-setup/promote \
  -H "Authorization: Bearer $GODSVIEW_OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "strategy_id": "absorption_reversal_001",
    "next_state": "live_assisted_approved",
    "operator_notes": "20 paper trades completed, fills match backtest, ready for live"
  }'
```

### Rolling Back a Strategy

If a strategy shows degradation or fails validation:

```bash
# Move strategy back to previous state
curl -X POST http://localhost:3000/api/market/strict-setup/rollback \
  -H "Authorization: Bearer $GODSVIEW_OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "strategy_id": "absorption_reversal_001",
    "target_state": "backtested",
    "reason": "Model drift detected, reverting to stress testing phase"
  }'

# All autonomous orders stop immediately
# Strategy returns to previous promotion state
# Drift report saved for investigation
```

### Retiring a Strategy

When a strategy reaches end-of-life:

```bash
# Retire strategy (stops all execution)
curl -X POST http://localhost:3000/api/market/strict-setup/retire \
  -H "Authorization: Bearer $GODSVIEW_OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "strategy_id": "absorption_reversal_001",
    "reason": "Model drift exceeded threshold, no longer profitable",
    "archive": true
  }'

# Response:
# {
#   "status": "retired",
#   "all_orders_cancelled": true,
#   "positions_to_close": 0,
#   "archived_at": "2026-04-05T12:00:00Z",
#   "final_statistics": {
#     "total_trades": 487,
#     "lifetime_pnl": 3250.75,
#     "final_state": "autonomous_approved"
#   }
# }

# Archive is stored in PostgreSQL with full audit trail
```

### Viewing Validation Reports

```bash
# Backtest report
curl http://localhost:3000/api/market/strict-setup/backtest?strategy_id=absorption_reversal_001

# Stress test report
curl http://localhost:3000/api/market/strict-setup/stress-test?strategy_id=absorption_reversal_001

# Walk-forward report
curl http://localhost:3000/api/proof/walk-forward?strategy_id=absorption_reversal_001

# All reports as HTML (for dashboard)
curl http://localhost:3000/api/market/strict-setup/report?strategy_id=absorption_reversal_001&format=html
```

## Daily Operations

### Morning Checklist (Before Market Open)

```bash
# 1. Verify system readiness
curl http://localhost:3000/api/readyz
# Must return "ready" or "degraded" (not "unhealthy")

# 2. Check kill switch is off
curl http://localhost:3000/api/system/risk | jq '.kill_switch_active'
# Expected: false

# 3. Verify all strategies in correct state
curl http://localhost:3000/api/market/strict-setup

# 4. Review overnight events
curl http://localhost:3000/api/brain/events?since=24h

# 5. Check current P&L and positions
curl http://localhost:3000/api/alpaca/account | jq '{equity, buying_power, unrealized_pl}'

# 6. Verify market regime
curl http://localhost:3000/api/market/regime
# Check for "news_distorted" or "chop_low_edge" (typically avoid trading)
```

### Starting the Scanner

The scanner continuously monitors watchlist symbols for new signals.

```bash
# Start scanner (if not already running)
curl -X POST http://localhost:3000/api/system/scanner/start \
  -H "Authorization: Bearer $GODSVIEW_OPERATOR_TOKEN"

# Check scanner status
curl http://localhost:3000/api/system/scanner/status
# Response:
# {
#   "running": true,
#   "symbols_monitored": 47,
#   "signals_per_minute": 3.2,
#   "uptime_seconds": 14400
# }

# Modify watchlist
curl -X PATCH http://localhost:3000/api/watchlist \
  -H "Authorization: Bearer $GODSVIEW_OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "add",
    "symbols": ["NVDA", "TSLA"]
  }'

# Stop scanner (emergency only)
curl -X POST http://localhost:3000/api/system/scanner/stop \
  -H "Authorization: Bearer $GODSVIEW_OPERATOR_TOKEN"
```

### Generating Daily Reviews

Daily reports are generated automatically at market close. To manually generate:

```bash
# Generate daily review for today
curl -X POST http://localhost:3000/api/journal/generate-daily-review \
  -H "Authorization: Bearer $GODSVIEW_OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2026-04-05",
    "format": "html"
  }'

# Response:
# {
#   "report_id": "daily_2026-04-05",
#   "file_path": "/path/to/reports/daily_2026-04-05.html",
#   "traded_symbols": ["AAPL", "SPY", "QQQ"],
#   "total_trades": 12,
#   "daily_pnl": 2150.30,
#   "generated_at": "2026-04-05T16:30:00Z"
# }

# Access report in browser
# http://localhost:3000/api/journal/daily-review/2026-04-05

# Also generate Markdown for archiving
curl -X POST http://localhost:3000/api/journal/generate-daily-review \
  -H "Authorization: Bearer $GODSVIEW_OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2026-04-05",
    "format": "markdown"
  }'
```

### Checking Monitor Events

Review real-time events that occurred during the day:

```bash
# Last 24 hours of events
curl http://localhost:3000/api/brain/events?since=24h

# Specific event type
curl http://localhost:3000/api/brain/events?type=signal_rejection&since=24h

# Unresolved alerts
curl http://localhost:3000/api/brain/alerts?status=unresolved

# Recent degradations
curl http://localhost:3000/api/degradation?history=true
```

### Reviewing Unresolved Alerts

```bash
# Get all unresolved alerts
curl http://localhost:3000/api/brain/alerts?status=unresolved

# Example response:
# [
#   {
#     "alert_id": "alert_123",
#     "severity": "warning",
#     "message": "Model drift detected in absorption_reversal strategy",
#     "timestamp": "2026-04-05T14:30:00Z",
#     "actions": ["review_drift_report", "rollback_strategy", "dismiss"]
#   }
# ]

# Dismiss alert after reviewing
curl -X POST http://localhost:3000/api/brain/alerts/alert_123/dismiss \
  -H "Authorization: Bearer $GODSVIEW_OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"operator_notes": "Reviewed drift report, waiting for more data"}'
```

## Troubleshooting

### Common Errors and Fixes

#### "Service Unhealthy" or "Readiness: UNHEALTHY"

```bash
# 1. Check API server logs
docker compose logs -f api-server | head -50

# 2. Verify database connection
curl http://localhost:3000/api/system/diagnostics | jq '.database'

# 3. Verify Alpaca credentials
# Check .env file:
cat .env | grep ALPACA

# 4. Restart API server
docker compose restart api-server

# 5. If still failing, check database status
docker compose logs -f postgres | head -50
```

#### "Market Data Feed Disconnected"

```bash
# 1. Check Alpaca WebSocket status
curl http://localhost:3000/api/system/diagnostics | jq '.alpaca'

# 2. Verify Alpaca credentials are valid
# (Try trading in Alpaca dashboard directly)

# 3. Restart market data stream
curl -X POST http://localhost:3000/api/alpaca/stream/reconnect \
  -H "Authorization: Bearer $GODSVIEW_OPERATOR_TOKEN"

# 4. Check for firewall/proxy issues blocking WebSocket
# Try: telnet data.alpaca.markets 443
```

#### "Database Connection Timeout"

```bash
# 1. Verify PostgreSQL is running
docker compose ps postgres

# 2. Check database logs
docker compose logs postgres | tail -20

# 3. Verify DATABASE_URL in .env
cat .env | grep DATABASE_URL

# 4. Test connection manually
psql postgresql://user:password@localhost:5432/godsview

# 5. Restart PostgreSQL if needed
docker compose restart postgres
```

#### "Strategy Won't Promote - Backtest Threshold Failed"

```bash
# 1. Review backtest results
curl http://localhost:3000/api/market/strict-setup/backtest?strategy_id=STRATEGY_ID

# 2. Check promotion requirements
curl http://localhost:3000/api/market/strict-setup/promotion-check?strategy_id=STRATEGY_ID

# Common issues:
# - Sharpe ratio < 1.0 (need higher edge)
# - Win rate < 50% (strategy not profitable enough)
# - Max drawdown > 15% (risk too high)
# - Walk-forward validation failed (no edge out-of-sample)

# Solution: Adjust strategy parameters and rebacktest
```

#### "Orders Not Executing - Rejected by Risk Guard"

```bash
# 1. Check which guard is blocking
curl http://localhost:3000/api/system/risk

# Response example:
# {
#   "kill_switch_active": false,
#   "daily_loss_exceeded": true,
#   "daily_loss_limit": -2000,
#   "daily_loss_realized": -2150,
#   "message": "Daily loss limit exceeded, no new orders"
# }

# 2. Solutions:
# - If daily loss exceeded: Wait for market close to reset, or manually reset
curl -X POST http://localhost:3000/api/system/risk/reset-daily \
  -H "Authorization: Bearer $GODSVIEW_OPERATOR_TOKEN"

# - If kill switch active: Deactivate it
# - If exposure limit exceeded: Close some positions

# 3. Check specific guard status
curl http://localhost:3000/api/system/risk | jq '.guards'
```

#### "Model Drift Status: DRIFT"

```bash
# 1. Review drift diagnostics
curl http://localhost:3000/api/system/model/diagnostics | jq '.drift'

# Expected response:
# {
#   "status": "drift",
#   "win_rate_baseline": 0.58,
#   "win_rate_recent": 0.42,
#   "degradation": -0.16,
#   "reason": "absorption_reversal setup performance declined 16%"
# }

# 2. Review affected strategy
curl http://localhost:3000/api/market/strict-setup?strategy_id=absorption_reversal_001

# 3. Options:
# - Rollback to paper trading for more validation
curl -X POST http://localhost:3000/api/market/strict-setup/rollback \
  -H "Authorization: Bearer $GODSVIEW_OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "strategy_id": "absorption_reversal_001",
    "target_state": "backtested",
    "reason": "Model drift detected"
  }'

# - Or retire the strategy and update parameters
```

### Log Locations

**Docker Compose:**
```bash
# API server logs
docker compose logs -f api-server

# Database logs
docker compose logs -f postgres

# All service logs
docker compose logs -f

# Save logs to file
docker compose logs api-server > /tmp/api-server.log
```

**Bare Metal:**
```bash
# API server logs (if running in background)
tail -f artifacts/api-server/.runtime/logs/api-server.log

# Winston structured logs
ls artifacts/api-server/.runtime/logs/

# Error logs
grep -i error artifacts/api-server/.runtime/logs/*.log
```

### Data Directory Structure

The runtime data directory (`GODSVIEW_DATA_DIR`) contains:

```
artifacts/api-server/.runtime/
├── logs/
│   ├── api-server.log          # Main application logs
│   ├── error.log               # Errors and exceptions
│   └── audit.log               # Audit trail (decisions, orders)
├── db/
│   ├── backups/                # PostgreSQL backups
│   ├── exports/                # Data exports
│   └── migrations/             # Schema migrations
├── cache/
│   ├── market-data/            # Cached OHLCV bars
│   ├── features/               # Computed feature cache
│   └── regime/                 # Regime classification cache
├── artifacts/
│   ├── backtest-results/       # Backtest equity curves, trade lists
│   ├── stress-results/         # Stress test reports
│   ├── model-coefficients/     # ML model weights
│   └── validation-proof/       # Walk-forward validation proof
├── reports/
│   ├── daily/                  # Daily HTML + Markdown reports
│   ├── weekly/                 # Weekly performance summaries
│   └── archive/                # Historical reports
├── events/
│   ├── brain-stream.jsonl      # Event log (line-delimited JSON)
│   ├── decisions.jsonl         # Strategy decisions audit trail
│   └── trades.jsonl            # Order and fill events
└── state/
    ├── runtime.json            # Current system state
    ├── strategies.json         # Strategy states and configurations
    └── risk-state.json         # Risk guard states (kill switch, limits)
```

**Backup Strategy:**
```bash
# Daily backup of PostgreSQL
docker exec postgres pg_dump -U user godsview > /backups/godsview_$(date +%Y%m%d).sql

# Backup runtime artifacts
tar czf /backups/runtime_$(date +%Y%m%d).tar.gz artifacts/api-server/.runtime/

# Keep 30 days of backups
find /backups -name "*.sql" -mtime +30 -delete
```

## Appendix: Quick Reference

### Essential API Calls

```bash
# Health
curl http://localhost:3000/api/healthz
curl http://localhost:3000/api/readyz

# Strategies
curl http://localhost:3000/api/market/strict-setup
curl -X POST http://localhost:3000/api/market/strict-setup/promote

# Risk Control
curl http://localhost:3000/api/system/risk
curl -X POST http://localhost:3000/api/system/risk/kill-switch

# Signals
curl http://localhost:3000/api/signals

# Analytics
curl http://localhost:3000/api/performance/analytics
curl http://localhost:3000/api/journal/daily-review/2026-04-05

# Diagnostics
curl http://localhost:3000/api/system/manifest
curl http://localhost:3000/api/system/diagnostics
curl http://localhost:3000/api/degradation
```

### Operator Token

The operator token (`GODSVIEW_OPERATOR_TOKEN`) is required for sensitive operations:

```bash
# Set in environment
export GODSVIEW_OPERATOR_TOKEN=your_token_here

# Use in API calls
curl -H "Authorization: Bearer $GODSVIEW_OPERATOR_TOKEN" \
  http://localhost:3000/api/system/risk/kill-switch
```

Generate a new token in system settings or environment configuration.

### Support Contacts

- **System Issues**: Check logs in `artifacts/api-server/.runtime/logs/`
- **Market Data Issues**: Verify Alpaca credentials and WebSocket connectivity
- **Strategy Questions**: Review `docs/ARCHITECTURE.md` for decision pipeline
- **Emergency**: Activate kill switch (`/api/system/risk/kill-switch`)
