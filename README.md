# GodsView — AI-Native Trading Operating System

An intelligent trading operating system that manages the complete strategy lifecycle: from idea to validation to autonomous execution. Built for traders who want deterministic decision rules, full audit trails, and measurable edge proof before autonomous trading.

## Key Capabilities

- **Strategy Lab**: Define strategies in natural language, compile to execution rules, backtest against historical data, and validate edge before live trading
- **Multi-Timeframe Intelligence**: SMC structural analysis, order flow (FVG/CVD), pattern detection (AB=CD, supply/demand), regime classification (trend/reversion/breakout/chop)
- **Machine Learning**: L2-logistic regression on 18-dimensional feature set trained on 136k+ labeled trades, with drift detection and regime-adaptive position sizing
- **Execution Safety**: 5-layer guard stack (kill switch, daily loss limit, exposure limit, session rules, circuit breaker) plus automatic drawdown protection
- **Decision Replay**: Reconstruct any trade from raw market data → signal → execution → outcome with full audit trail and approval logs
- **Real-Time Intelligence Monitor**: Live event stream of signals, fills, regime shifts, and degradation alerts with position tracking
- **Paper Trading**: Full backtesting and walk-forward validation before autonomous approval
- **Multi-Strategy Portfolio**: Unified portfolio intelligence with correlation analysis, rebalancing, and allocation optimization
- **Adaptive Learning**: Continuous model retraining on new market regimes with automatic drift detection and performance monitoring

## Architecture Overview

GodsView is built on a 16-system architecture:

**Core Market Intelligence (4 systems)**
- **SMC Engine**: Structural market analysis detecting support/resistance, order blocks, fair value gaps
- **Order Flow Engine**: CVD calculation, FVG detection, volume delta analysis
- **Regime Engine**: Market regime classification (trend day, mean reversion, breakout, chop, news-distorted)
- **Macro Engine**: Macro bias, economic calendar integration, news sentiment

**Strategy & Intelligence (4 systems)**
- **Strategy Engine**: Strategy parsing, lifecycle management (draft → parsed → backtested → stress tested → approved → autonomous)
- **Super Intelligence**: Ensemble ML model with C4 scoring (Structure + OrderFlow + Context + Confirmation)
- **Context Fusion**: Multi-timeframe signal fusion, confluence scoring, setup validation
- **Adaptive Learning**: Model drift detection, continuous retraining, regime adaptation

**Execution & Safety (4 systems)**
- **Execution Engine**: Order placement, fill tracking, P&L monitoring with broker abstraction (Alpaca)
- **Risk Engine**: VaR/CVaR calculation, portfolio risk, exposure limits, stress testing
- **Circuit Breaker**: Automatic position closes on max drawdown, daily loss limits, kill switch
- **Safety Supervisor**: 5-layer guard validation before execution

**Intelligence & Governance (4 systems)**
- **Brain**: Real-time subsystem health monitoring, decision pipeline visualization
- **Governance**: Strategy promotion gates, operator approval workflows, policy enforcement
- **Portfolio Intelligence**: Multi-strategy allocation, correlation analysis, rebalancing
- **Recall Engine**: LanceDB-backed vector store for strategy memory and retrieval

## System Components

| Service | Language | Port | Purpose |
|---------|----------|------|---------|
| API Server | TypeScript/Node.js | 3001 | Express.js API gateway, dashboard backend, core intelligence |
| Python Gateway | Python 3.10+ | 8000 | FastAPI gateway for Python v2 microservices |
| Market Data Service | Python 3.10+ | 8001 | Alpaca WebSocket, OHLCV bar processing |
| Feature Service | Python 3.10+ | 8002 | Feature engineering (candles, volatility, ATR) |
| Backtest Service | Python 3.10+ | 8003 | Walk-forward backtesting, replay engine |
| ML Service | Python 3.10+ | 8004 | Model training, prediction, drift detection |
| Execution Service | Python 3.10+ | 8005 | Order execution, slippage tracking, fill analysis |
| Risk Service | Python 3.10+ | 8006 | VaR/CVaR, stress testing, portfolio risk |
| Memory Service | Python 3.10+ | 8007 | LanceDB vector store, strategy recall |
| Scheduler | Python 3.10+ | 8008 | Automated scanning, model retraining, maintenance |
| PostgreSQL | SQL | 5432 | Persistent data: orders, positions, trades, audit logs |
| Redis | Cache | 6379 | Live signal stream, position cache, ML model state |
| Nginx | HTTP | 80/443 | Reverse proxy, dashboard serving, rate limiting |
| MLflow | Tracking | 5000 | ML experiment tracking (optional, profile v2) |

## Getting Started

### Prerequisites

- Node.js 18+ (API server)
- Python 3.10+ (microservices)
- Docker & Docker Compose (recommended)
- PostgreSQL 16+ (or use Docker)
- Redis 7+ (optional, for advanced features)
- Alpaca API credentials (paper or live)

### Quick Start (Docker Compose)

```bash
# 1. Clone repository
git clone https://github.com/Santhakumarramesh/Godsview.git
cd Godsview

# 2. Configure environment
cp .env.example .env
# Edit .env with your Alpaca API keys and database settings

# 3. Start Node.js stack (API + dashboard)
docker compose up -d api postgres nginx

# 4. Verify health
curl http://localhost/api/healthz
curl http://localhost/api/readyz

# 5. Access dashboard
# Open http://localhost in your browser
```

### Local Development

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env
# ALPACA_API_KEY=your_paper_key
# ALPACA_SECRET_KEY=your_paper_secret
# DATABASE_URL=postgresql://user:pass@localhost:5432/godsview

# 3. Run development servers
pnpm dev

# Dashboard: http://localhost:5173
# API: http://localhost:3001/api
```

### Adding Python Services (Advanced)

```bash
# Start with Python v2 microservices
docker compose --profile v2 up -d

# Or run individually during development
cd services
pip install -r requirements.txt
./services/start.sh gateway  # or: market-data, feature, backtest, ml, execution, risk, memory, scheduler
```

## Environment Variables

**Required for any deployment:**
```
ALPACA_API_KEY             Paper or live API key
ALPACA_SECRET_KEY          API secret
ALPACA_BASE_URL            https://paper-api.alpaca.markets (default)
DATABASE_URL               postgresql://user:pass@host:5432/godsview
```

**Safety controls (defaults are conservative):**
```
GODSVIEW_ENABLE_LIVE_TRADING=false    Explicitly enable live trading
GODSVIEW_SYSTEM_MODE=paper            paper or live
GODSVIEW_KILL_SWITCH=false            Emergency halt toggle
GODSVIEW_MAX_DAILY_LOSS_USD=250       Max daily loss in USD
GODSVIEW_MAX_OPEN_EXPOSURE_PCT=0.6    Max concurrent exposure
GODSVIEW_MAX_TRADES_PER_SESSION=10    Max trades per session
GODSVIEW_OPERATOR_TOKEN=change-me     Required for live trading
```

**Optional integrations:**
```
ANTHROPIC_API_KEY          For Claude reasoning layer
CLAUDE_VETO_MODEL=claude-sonnet-4-5-20241022  Veto model override
PY_SERVICES_ENABLED=false  Enable Python v2 microservices
PY_GATEWAY_URL             http://py-gateway:8000
REDIS_URL                  redis://localhost:6379
ECON_CALENDAR_URL          Economic calendar feed
```

See `.env.example` for the complete list.

## API Reference (Key Endpoints)

### Market Intelligence
- `GET /api/market/smc/{symbol}` — SMC structural levels
- `GET /api/market/orderflow/{symbol}` — Order flow scores
- `GET /api/market/regime` — Current market regime
- `GET /api/macro` — Macro bias and economic data
- `GET /api/signals` — Live signal stream

### Strategy Management
- `GET /api/strict-setup` — Strategy templates
- `POST /api/alpaca/analyze` — Parse strategy prompt
- `POST /api/alpaca/backtest` — Run backtest
- `GET /api/market/strict-setup/promotion-check` — Check promotion readiness
- `POST /api/market/strict-setup/promote` — Promote to next lifecycle stage

### Execution & Monitoring
- `POST /api/alpaca/orders` — Place order (validates 5-layer guards)
- `GET /api/alpaca/orders` — Order history
- `GET /api/execution/pnl` — Real-time P&L
- `POST /api/system/risk/kill-switch` — Emergency kill switch

### Intelligence & Analysis
- `GET /api/brain` — Subsystem health and state
- `GET /api/super-intelligence` — ML scores and regime adaptation
- `GET /api/portfolio` — Portfolio view and allocation
- `GET /api/performance/analytics` — Win rate, profit factor, Sharpe
- `GET /api/journal/daily-review` — Daily HTML report

### System & Operations
- `GET /api/system/manifest` — Engine inventory and versions
- `GET /api/system/diagnostics` — Full system diagnostics
- `GET /api/system/audit` — Audit trail summary
- `GET /api/system/audit/replay/:id` — Replay decision by ID
- `GET /api/healthz` — Liveness probe
- `GET /api/readyz` — Readiness probe

## Dashboard Pages

The system includes 70+ dashboard pages across these domains:

**Core Trading**: Dashboard, Trades, Signals, Performance, Execution
**Intelligence**: Brain, Super Intelligence, Institutional Intelligence, Regime Intelligence
**Risk & Safety**: Risk Control, Advanced Risk, Circuit Breaker, Capital Gating
**Data & Signals**: Market Structure, Microstructure, Economic Calendar, MCP Signals
**Operations**: System, Audit Trail, Production Watchdog, Ops Security
**Analytics**: Performance Analytics, Trade Journal, Side-by-Side Backtest, Reports

## Monitoring & Observability

### Health Checks
```bash
# Liveness (service running)
curl http://localhost:3001/api/healthz

# Readiness (ready to serve traffic)
curl http://localhost:3001/api/readyz

# Full manifest with subsystems
curl http://localhost:3001/api/system/manifest
```

### Key Metrics
- Signal detection rate (signals/min)
- Execution rate (orders/min)
- Guard rejection rate (% rejected)
- ML approval rate (% approved)
- Circuit breaker trips (emergency closes)
- Model drift status (stable/watch/drift)

### Prometheus Integration (Optional)
```yaml
# prometheus.yml
scrape_configs:
  - job_name: godsview
    static_configs:
      - targets: ['localhost:3001']  # Node.js API
      - targets: ['localhost:8000']  # Python Gateway
      - targets: ['localhost:8001']  # Market Data
      # ... additional Python services
```

## Strategy Lifecycle

Every strategy passes through explicit gates:

```
draft → parsed → backtested → stress_tested → paper_approved 
  → live_assisted_approved → autonomous_approved → retired
```

Each transition requires:
- **Parsed**: Syntax validation, setup family confirmation
- **Backtested**: Historical backtest with equity curve and metrics
- **Stress Tested**: Walk-forward validation, regime stress, shock scenarios
- **Paper Approved**: Operator manual review of backtest report
- **Live Assisted**: Min 20 paper trades, operator monitors fills vs backtest
- **Autonomous**: Operator approves live P&L, edge validated
- **Retired**: Model drift detected or operator retirement

## Testing

```bash
# Full test suite (Node.js)
pnpm test

# Watch mode
pnpm test:watch

# Python tests
cd services && python -m pytest tests/ -q

# With coverage
python -m pytest services/tests/ --cov=services --cov-report=html

# Pre-release verification
pnpm verify:release

# Market deployment profiles
pnpm verify:market:paper
pnpm verify:market:live
pnpm verify:market:live:strict
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite 7 + TailwindCSS + TanStack Query |
| API Server | Express 5 + TypeScript + Vitest |
| Database | PostgreSQL 16 + Drizzle ORM |
| Cache | Redis 7 (signal stream, model state) |
| Market Data | Alpaca API + WebSocket |
| Charting | TradingView Lightweight Charts |
| ML | L2-Logistic Regression, LanceDB vector store |
| Python Services | FastAPI + Pydantic v2 |
| Monitoring | Prometheus + Grafana + Structured logging |
| Testing | Vitest + Jest + pytest + k6 load tests |
| Container | Docker + Docker Compose + GHCR |

## Production Deployment

See `PRODUCTION.md` for detailed production deployment guide:
- Docker Compose setup for all services
- Kubernetes deployment configuration
- CI/CD pipeline (GitHub Actions, 7 jobs)
- Prometheus + Grafana monitoring
- Database backup and disaster recovery
- Security hardening and compliance

## Troubleshooting

**Dashboard not connecting to API**
```bash
curl http://localhost:3001/api/healthz
# Should return 200 OK with health status
```

**Backtest failing**
- Verify Alpaca credentials are correct
- Check market data availability for requested symbols/dates
- Ensure PostgreSQL is accessible

**Strategy won't promote**
- Backtest must meet minimum thresholds (Sharpe > 1.0, win rate > 50%)
- Stress test must pass (walk-forward validation)
- Operator must manually approve in dashboard

**Orders not executing**
- Check market hours (9:30-16:00 EST)
- Verify kill switch is not active
- Check daily loss limit not exceeded
- Verify max position exposure not exceeded

## Documentation

- **Architecture**: `ARCHITECTURE.md` — Detailed system design, data flow, component reference
- **Production Guide**: `PRODUCTION.md` — Deployment, operations, monitoring, scaling
- **Governance**: `GOVERNANCE_ARCHITECTURE.md` — Trust tiers, approval workflows, policy engine

## Support

- Issues: GitHub Issues
- Documentation: `/docs` directory
- Email: support@godsview.dev

## License

MIT
