# GodsView — AI-Native Trading Operating System

An intelligent trading operating system that manages the complete strategy lifecycle: from idea to validation to autonomous execution. Every trade passes through multiple intelligence layers and explicit safety gates before execution.

GodsView is built for discretionary traders who want deterministic decision rules, full audit trails, and measurable edge proof before autonomous trading.

## Key Capabilities

**Strategy Lab: Prompt → Compile → Backtest → Promote**
- Define strategies in natural language
- Compile to deterministic execution rules
- Run full backtest with equity curves
- Validate edge before live trading

**Multi-Timeframe Intelligence**
- SMC Engine: Structural market analysis (support/resistance/order blocks)
- Order Flow Analysis: FVG, CVD, cumulative volume delta
- Pattern Detection: AB=CD, supply/demand, setup catalog (5 families)
- Regime Classification: Trend day, mean reversion, breakout, chop, news-distorted

**Super Intelligence: Ensemble ML + Regime-Adaptive Sizing**
- L2-logistic regression on 18-dimensional feature set
- Trained on 136k+ labeled win/loss records
- Drift detection (stable/watch/drift status)
- Kelly criterion position sizing with regime adjustment

**Execution Safety: 5-Layer Guard Stack + Circuit Breaker**
- Kill switch: Stop all execution immediately
- Daily loss limit: Max drawdown per day
- Exposure limit: Max concurrent open positions
- Session rules: Market hours, news lockout
- Circuit breaker: Automatic position close on max drawdown

**Live Intelligence Monitor**
- Real-time event stream: signals, fills, regime shifts
- Degradation alerts: Data quality, service health
- Position tracking: Live P&L, duration, unrealized loss

**TradingView Chart Overlay**
- Render support/resistance levels from SMC
- Visualize order blocks and fair value gaps
- Pattern detection overlays
- Real-time structure updates

**Walk-Forward Validation**
- 3-month out-of-sample test window
- Stress test across regime shifts
- Shock scenario validation
- Proof of edge before autonomous approval

**Side-by-Side Backtesting**
- Historical backtest vs live execution comparison
- Slippage tracking, fill quality analysis
- Performance attribution by setup type
- Win rate, profit factor, Sharpe ratio

**Daily Review Journal**
- HTML + Markdown reports generated automatically
- Trade-by-trade analysis: entry reason, exit trigger, outcome
- Setup performance breakdown
- P&L attribution and risk metrics

**Decision Replay**
- Trace any trade from raw market data → signal → execution → outcome
- Reconstruct C4 scores (Structure + OrderFlow + Context + Confirmation)
- View ML probability and regime at decision time
- Audit trail: who approved, when, why

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  PRESENTATION LAYER                                             │
│  Dashboard (React + TanStack Query)                             │
├─────────────────────────────────────────────────────────────────┤
│  API GATEWAY LAYER                                              │
│  Express.js API Server (port 3000)                              │
├─────────────────────────────────────────────────────────────────┤
│  INTELLIGENCE LAYER                                             │
│  ┌──────────────┬──────────────┬──────────────┬─────────────┐  │
│  │ Strategy     │ Super        │ Context      │ Adaptive    │  │
│  │ Engine       │ Intelligence │ Fusion       │ Learning    │  │
│  └──────────────┴──────────────┴──────────────┴─────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│  MARKET DATA LAYER                                              │
│  ┌──────────────┬──────────────┬──────────────┬─────────────┐  │
│  │ SMC Engine   │ Order Flow   │ Regime       │ Macro       │  │
│  │              │ Engine       │ Engine       │ Engine      │  │
│  └──────────────┴──────────────┴──────────────┴─────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│  EXECUTION & SAFETY LAYER                                       │
│  ┌──────────────┬──────────────┬──────────────┬─────────────┐  │
│  │ Order        │ Position     │ Risk         │ Circuit     │  │
│  │ Executor     │ Monitor      │ Engine       │ Breaker     │  │
│  └──────────────┴──────────────┴──────────────┴─────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│  PERSISTENCE LAYER                                              │
│  PostgreSQL + File Store                                        │
└─────────────────────────────────────────────────────────────────┘
```

See `docs/ARCHITECTURE.md` for detailed module map, API contract, and design rationale.

## Strategy Lifecycle

Every strategy must pass through explicit gates before autonomous execution:

```
draft → parsed → backtested → stress_tested → paper_approved
  → live_assisted_approved → autonomous_approved → (retired)
```

Each transition requires:
- **Parsed**: Syntax check, setup family validation
- **Backtested**: Full historical backtest, equity curve generation
- **Stress Tested**: Walk-forward validation, regime stress, shock scenarios
- **Paper Approved**: Operator manual review of backtest report
- **Live Assisted**: Min 20 paper trades, operator monitors fills vs backtest
- **Autonomous**: Operator approves live P&L trajectory, edge validated
- **Retired**: Model drift detected or operator retirement

## Quick Start

### Development

```bash
# 1. Clone and install
git clone https://github.com/Santhakumarramesh/Godsview.git
cd Godsview
pnpm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your Alpaca API keys and database URL

# 3. Run development
pnpm dev
# Dashboard: http://localhost:5173
# API: http://localhost:3000/api
```

### Production (Docker)

```bash
# 1. Configure environment
cp .env.example .env
# Edit .env with your credentials

# 2. Start services
docker compose up -d

# 3. Verify health
curl http://localhost:3000/api/healthz
curl http://localhost:3000/api/readyz

# 4. Access dashboard
# http://localhost:3000
```

### Paper Trading (Recommended First)

GodsView defaults to Alpaca paper trading mode. To enable:

```bash
# In .env
ALPACA_API_KEY=your_paper_key
ALPACA_API_SECRET=your_paper_secret
ALPACA_PAPER=true  # Default
LIVE_TRADING_ENABLED=false
```

Paper trading allows you to validate strategies without financial risk.

### Live Trading (After Validation)

Only after passing walk-forward validation and operator approval:

```bash
# 1. Get live credentials from Alpaca
# 2. Update .env
ALPACA_API_KEY=your_live_key
ALPACA_API_SECRET=your_live_secret
ALPACA_PAPER=false
LIVE_TRADING_ENABLED=true

# 3. Operator token validation required at startup
# System will prompt for GODSVIEW_OPERATOR_TOKEN
```

**Warning**: Live trading is irreversible. Ensure strategies have been validated through the full lifecycle.

## API Endpoints (Key)

### Strategy Management
- `GET /api/market/strict-setup` — List all strategy templates
- `POST /api/alpaca/analyze` — Parse and analyze strategy prompt
- `POST /api/alpaca/backtest` — Run backtest on strategy
- `GET /api/market/strict-setup/promotion-check` — Check promotion readiness
- `POST /api/market/strict-setup/promote` — Promote to next lifecycle stage

### Real-Time Intelligence
- `GET /api/signals` — Live signal feed
- `GET /api/market/regime` — Current market regime
- `GET /api/market/smc/{symbol}` — SMC structural analysis
- `GET /api/market/orderflow/{symbol}` — Order flow scores

### Execution
- `POST /api/alpaca/orders` — Place order (validates 5-layer guards)
- `GET /api/alpaca/orders` — Order history
- `GET /api/execution/pnl` — Real-time P&L

### Safety Control
- `POST /api/system/risk/kill-switch` — Activate emergency kill switch
- `GET /api/system/manifest` — Engine inventory and versions
- `GET /api/system/diagnostics` — Full system diagnostics

### Analytics & Review
- `GET /api/performance/analytics` — Win rate, profit factor, Sharpe
- `GET /api/performance/by-setup` — Performance by strategy type
- `GET /api/journal/daily-review` — Daily HTML report
- `GET /api/system/audit` — Audit trail summary
- `GET /api/system/audit/replay` — Replay decision by ID

### Promotion & Calibration Schedulers (Phase 5)
- `GET  /api/governance/scheduler/status` — Promotion cron run state + last run timestamp
- `GET  /api/governance/scheduler/history` — Recent promotion-eligible / demotion events
- `POST /api/governance/scheduler/trigger` — Operator-gated manual run
- `GET  /api/calibration/scheduler/status` — Calibration cron run state
- `GET  /api/calibration/scheduler/score` — Latest ensemble calibration snapshot
- `POST /api/calibration/scheduler/trigger` — Operator-gated manual calibration

### SLOs & Alert Routing (Phase 6)
- `GET  /api/slo/definitions` — Codified SLO source of truth (6 SLOs across critical / high / normal tiers)
- `GET  /api/slo/budgets` — Full snapshot incl. burn rate per SLO
- `GET  /api/slo/burn-rate` — Currently alerting SLOs only
- `GET  /api/slo/burn-rate/:id` — Burn-rate detail for a single SLO
- `GET  /api/slo/router/status` — SSE alert router run state + forwarded-event counts
- `POST /api/slo/reset` — Operator-gated buffer wipe (post-incident only)

See `docs/ARCHITECTURE.md` for the complete API reference and `docs/SLOs.md`
for the human-readable pair to `slo_definitions.ts`.

## Dashboard Pages

| Page | Route | Purpose |
|------|-------|---------|
| Mission Control | `/` | Real-time P&L, win rate, engine health, live chart |
| Brain | `/brain` | Intelligence state visualization, entity tracking |
| Live Intelligence | `/alpaca` | Real-time Alpaca analysis with chart overlays |
| Infinity Screen | `/infinity` | Multi-chart grid for simultaneous monitoring |
| Strategy Lab | `/lab` | Prompt-to-backtest strategy creation |
| Setup Matrix | `/setup-explorer` | Strategy performance matrix by type/regime |
| Signal Feed | `/signals` | Real-time signals with quality scores |
| Trade Journal | `/trades` | Execution log with entry/exit analysis |
| Daily Review | `/reports` | HTML + Markdown daily reports |
| Risk Control | `/risk` | Kill switch, guards, drawdown tracking |
| Analytics | `/performance` | Equity curves, win rates, by-setup breakdown |
| System Core | `/system` | Diagnostics, audit trail, engine health |
| Settings | `/settings` | API credentials, risk parameters |

## Monitoring & Observability

### Health Checks
```bash
# Liveness (service running)
curl http://localhost:3000/api/healthz

# Readiness (ready to serve traffic)
curl http://localhost:3000/api/readyz

# System manifest (engine versions + capability inventory)
curl http://localhost:3000/api/system/manifest
```

### Key Metrics
- `signal_detection_rate` — Signals per minute
- `execution_rate` — Orders placed per minute
- `guard_rejection_rate` — Trades rejected by safety guards
- `ml_approval_rate` — ML model approval percentage
- `circuit_breaker_trips` — Automatic position closes
- `model_drift_status` — stable / watch / drift

### Logs & Audit Trail
- All decisions logged with full context (timestamp, symbol, regime, C4 score, ML probability, order ID, fill)
- Immutable event log in PostgreSQL
- Full replay capability for any trade

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript |
| API Server | Express.js + TypeScript |
| Database | PostgreSQL |
| Cache | Redis |
| Market Data | Alpaca API + WebSocket |
| Charting | TradingView Lightweight Charts |
| ML | L2-Logistic Regression |
| Monitoring | Prometheus + Grafana |
| Logging | Winston + Structured JSON |
| Testing | Vitest + Jest |

## Environment Variables

See `.env.example` for complete list.

### Required for Paper Trading
```
ALPACA_API_KEY=your_paper_key
ALPACA_API_SECRET=your_paper_secret
ALPACA_PAPER=true
DATABASE_URL=postgresql://...
```

### Optional
```
ANTHROPIC_API_KEY=your_claude_key  # For LLM reasoning layer
QUALITY_THRESHOLD=0.75             # Min composite quality for execution
```

## Production Deployment

See `PRODUCTION.md` for detailed deployment guide:
- Docker Compose setup
- Kubernetes deployment
- CI/CD pipeline (GitHub Actions)
- Prometheus + Grafana monitoring
- Database backup strategy

## Troubleshooting

**Dashboard not connecting to API**
```bash
# Check API server is running
curl http://localhost:3000/api/healthz

# Check CORS headers
curl -i http://localhost:3000/api/signals
```

**Backtest failing**
- Ensure Alpaca credentials are correct
- Check that market data is available for requested symbol/date range
- Verify PostgreSQL is accessible

**Strategy won't promote**
- Check backtest results meet minimum threshold (Sharpe > 1.0, win rate > 50%)
- Verify stress test passed (walk-forward validation)
- Operator must manually approve in dashboard

**Orders not executing**
- Verify market is open (9:30-16:00 EST)
- Check kill switch is not active (`/api/system/risk`)
- Verify daily loss limit not exceeded
- Ensure max position exposure not exceeded

## Production-Readiness Build Phases

GodsView shipped to production over a seven-phase patch-based build. Each
phase lives on its own `phase-N-*` branch with a `git format-patch`
artifact under `phase-N/` so any operator can rebase the whole history
from clean upstream.

| Phase | Branch                          | Outcome |
| ----- | ------------------------------- | ------- |
| 1     | `phase-1-type-safety`           | Killed hidden TypeScript errors and failing tests; removed `continue-on-error` from CI. |
| 2     | `phase-2-live-paths-no-mock`    | Removed mock data from live intelligence and execution paths. |
| 3     | `phase-3-aws-cdk`               | AWS production deploy via CDK (TypeScript) with ECS / RDS / ALB / WAF. |
| 4     | `phase-4-page-gaps`             | Closed dashboard page gaps (68/68) with hooks, RBAC, and route-level tests. |
| 5     | `phase-5-promotion-cron`        | Auto-promotion pipeline (paper → assisted live → autonomous) and calibration cron. |
| 6     | `phase-6-slo-alerts-k6`         | Codified SLOs, SSE alert router to the existing webhook, and k6 scheduler baseline. |
| 7     | `phase-7-doc-truth-launch-v1`   | Documentation truth pass, launch checklist, and `v1.0.0` tag. |

### Production gates

| Gate                                                          | Status         |
| ------------------------------------------------------------- | -------------- |
| 1. TradingView MCP + webhook router                           | **shipped**    |
| 2. Backtesting → paper → assisted live → auto-promotion       | **shipped**    |
| 3. AWS production deploy                                      | **shipped**    |
| 4. All 68 sidebar pages with RBAC                             | **shipped**    |
| 5. SLOs + alert routing + k6 baseline                         | **shipped**    |

All five gates ship in `v1.0.0`. See `docs/LAUNCH_CHECKLIST.md` for the
end-to-end cut-over procedure.

## Support

- Documentation: `docs/` directory
- Architecture: `docs/ARCHITECTURE.md`
- Production Runbook: `docs/OPERATOR_RUNBOOK.md`
- Launch Checklist: `docs/LAUNCH_CHECKLIST.md`
- SLOs: `docs/SLOs.md`
- Issues: GitHub Issues
- Email: support@godsview.dev

## License

MIT
