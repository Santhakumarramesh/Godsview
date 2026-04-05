# GodsView Architecture

## Product Definition

**GodsView** is an **AI-native trading operating system** for futures and crypto intelligence, research, and execution. It is not a dashboard, charting tool, or simple bot—it is a comprehensive strategy lifecycle platform that manages the complete journey from idea inception through autonomous execution, replay, and continuous learning.

GodsView enables traders to:
- Define trading strategies in natural language
- Validate edge through backtesting and walk-forward analysis
- Promote proven strategies through safety gates
- Execute autonomously with multi-layer risk protection
- Review and replay every trade decision with full audit trail
- Learn from outcomes to improve future signal detection

## System Boundary

### What GodsView IS

- **Strategy Lab**: Prompt-to-backtest strategy compilation with real-time feedback
- **Validation Pipeline**: Backtesting → stress testing → paper trading → autonomous approval
- **Multi-Timeframe Intelligence**: Structural analysis (SMC), order blocks, pattern detection, regime classification
- **Ensemble Learning**: Super Intelligence combining ML probability, Kelly sizing, and regime adaptation
- **Execution Stack**: Order execution with 5-layer guard stack and circuit breaker safety
- **Live Replay**: Decision trace from raw market data → signal → execution → outcome
- **Learning Loop**: Daily review, performance attribution, strategy degradation detection
- **TradingView Integration**: Chart intelligence with structure, order blocks, and pattern overlays

### What GodsView is NOT

- A generic charting dashboard (provides advanced intelligence overlays, not standard charts)
- A simple trading bot (enforces strict promotion gates, not autonomous-by-default)
- A one-stop execution engine (risk gates prevent unvetted strategy execution)
- An uncontrolled algorithmic system (requires explicit approval at every lifecycle stage)

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────────┐
│  PRESENTATION LAYER                                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Dashboard (React + TanStack Query)                     │   │
│  │  • 15 pages: Mission Control, Brain, Live Intelligence  │   │
│  │  • Real-time WebSocket + Server-Sent Events            │   │
│  │  • TradingView Chart Integration with Overlays          │   │
│  └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│  API GATEWAY LAYER                                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Express.js API Server (port 3000)                      │   │
│  │  • Rate limiting, authentication, request routing       │   │
│  │  • Prometheus metrics, structured logging               │   │
│  │  • Health checks (/healthz, /readyz)                    │   │
│  │  • System state manifest and manifest versioning        │   │
│  └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│  INTELLIGENCE LAYER                                             │
│  ┌──────────────┬──────────────┬──────────────┬─────────────┐  │
│  │ Strategy     │ Super        │ Context      │ Adaptive    │  │
│  │ Engine       │ Intelligence │ Fusion       │ Learning    │  │
│  │              │              │              │             │  │
│  │ Setup        │ Ensemble ML  │ Regime       │ Daily       │  │
│  │ Detection    │ + Kelly      │ Classification│ Review      │  │
│  │ (5 families) │ Sizing       │ + Risk Rules │ Journal     │  │
│  └──────────────┴──────────────┴──────────────┴─────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│  MARKET DATA LAYER                                              │
│  ┌──────────────┬──────────────┬──────────────┬─────────────┐  │
│  │ SMC Engine   │ Order Flow   │ Regime       │ Macro       │  │
│  │              │ Analysis     │ Engine       │ Engine      │  │
│  │ • Structural │ • OB/FVG     │ • Trend/Rev  │ • Market    │  │
│  │   Analysis   │ • CVD        │ • Breakout   │   Sentiment │  │
│  │ • Supply/    │ • DOM        │ • Chop/News  │ • Risk-Off  │  │
│  │   Demand     │ • Tape       │ • Regime ML  │   Regimes   │  │
│  └──────────────┴──────────────┴──────────────┴─────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│  EXECUTION & SAFETY LAYER                                       │
│  ┌──────────────┬──────────────┬──────────────┬─────────────┐  │
│  │ Order        │ Position     │ Risk         │ Circuit     │  │
│  │ Executor     │ Monitor      │ Engine       │ Breaker     │  │
│  │              │              │              │             │  │
│  │ • Alpaca API │ • P&L track  │ • 5-layer    │ • Drawdown  │  │
│  │ • Fill recon │ • Exposure   │   guards     │   Protection│  │
│  │ • Order mgmt │ • Duration   │ • Kill switch│ • Auto-stop │  │
│  └──────────────┴──────────────┴──────────────┴─────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│  PERSISTENCE LAYER                                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  PostgreSQL (primary) + File Store (artifacts)          │   │
│  │  • Strategy state, backtests, validation results        │   │
│  │  • Trade journal, audit trail, performance metrics      │   │
│  │  • Model coefficients, drift diagnostics                │   │
│  │  • Session management, replay data                      │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Module Map

### Intelligence Layer Modules

| Module | Path | Responsibility | Dependencies | Persistence |
|--------|------|-----------------|--------------|-------------|
| **Strategy Engine** | `lib/strategy-core/src/setupCatalog.ts` | Catalog of 5 setup families with thresholds | Market data layers | DB (strategy_registry) |
| **SMC Engine** | `api-server/src/lib/smc_engine.ts` | Structural market analysis (support/resistance) | Price data, MTF scores | Inline (stateless) |
| **Order Flow Engine** | `lib/strategy-core/src/orderFlowEngine.ts` | Order block, FVG, CVD analysis | Tick data, DOM snapshots | Inline (stateless) |
| **Regime Engine** | `lib/strategy-core/src/regimeEngine.ts` | Market regime classification (5 classes) | MTF scores, volatility, trends | DB (regime_cache) |
| **C4 Gate** | `lib/strategy-core/src/c4.ts` | Structure + Order Flow + Context + Confirmation | All market data layers | Audit trail (DB) |
| **Meta Label** | `lib/strategy-core/src/metaLabel.ts` | TAKE / REDUCE / SKIP decision + sizing | C4 score, ML prob, risk rules | Audit trail (DB) |
| **Super Intelligence** | `api-server/src/lib/super_intelligence_v2.ts` | Ensemble ML + Kelly sizing | ML model, regime, setup quality | Model persistence (DB) |
| **ML Model** | `api-server/src/lib/ml_model.ts` | L2-logistic regression on 18 features | 136k+ labeled records (is/oos) | Model coefficients (DB/file) |
| **Risk Engine** | `api-server/src/lib/risk_engine.ts` | 5-layer guard stack + drawdown tracking | Position state, P&L | DB (risk_state) |
| **Circuit Breaker** | `api-server/src/lib/drawdown_breaker.ts` | Automatic position close on max drawdown | Equity, open positions | DB (breaker_state) |

### Execution Layer Modules

| Module | Path | Responsibility | Dependencies | Persistence |
|--------|------|-----------------|--------------|-------------|
| **Order Executor** | `api-server/src/lib/brain_execution_bridge.ts` | Route orders to Alpaca, manage fills | Risk engine, position monitor | DB (order_log) |
| **Position Monitor** | `api-server/src/lib/portfolio_engine.ts` | Track open positions, P&L, exposure | Alpaca account stream | DB (position_snapshot) |
| **Proof Engine** | `api-server/src/lib/proof_engine.ts` | Validation proof (backtest vs live) | Backtest results, trade outcomes | DB (proof_records) |
| **Session Manager** | `api-server/src/lib/session_manager.ts` | Session state (market hours, news lockout) | Market calendars, news feed | DB (session_state) |
| **Stress Engine** | `api-server/src/lib/stress_engine.ts` | Stress test validation before promotion | Historical data, shock scenarios | DB (stress_results) |

### Data & Learning Modules

| Module | Path | Responsibility | Dependencies | Persistence |
|--------|------|-----------------|--------------|-------------|
| **Brain Orchestrator** | `api-server/src/lib/brain_orchestrator.ts` | Coordinate all intelligence engines | All modules | Event bus (file) |
| **Brain Event Bus** | `api-server/src/lib/brain_event_bus.ts` | Signal event stream for replay | All decision points | File (event log) |
| **Daily Review Journal** | `routes/journal.ts` | Generate daily HTML + Markdown reports | Trade journal, metrics | File (reports/) |
| **Market DNA** | `api-server/src/lib/market_dna.ts` | Multi-timeframe scoring cache | SMC, order flow, regime | Redis (cache) |
| **Macro Engine** | `api-server/src/lib/macro_engine.ts` | Macro environment risk factors | Economic calendar, sentiment | API feeds |
| **Degradation Monitor** | `api-server/src/lib/degradation.ts` | System health and data quality | All metrics | DB (degradation_log) |

### Routes & API

| Route | Path | Responsibility |
|-------|------|-----------------|
| **Strategy Lab** | `routes/strict_setup.ts` | Prompt compilation, validation, promotion |
| **Execution** | `routes/execution.ts` | Order placement, fill management, position tracking |
| **Signals** | `routes/signals.ts` | Real-time signal detection, C4 scoring |
| **System** | `routes/system.ts` | Health, manifest, diagnostics, control |
| **Backtest** | `routes/backtest.ts` | Historical validation, walk-forward analysis |
| **Brain** | `routes/brain.ts` | Intelligence state, event stream, decision replay |
| **Analytics** | `routes/analytics.ts` | Performance attribution, equity curves, setup stats |
| **Journal** | `routes/journal.ts` | Daily reviews, session reports |

## Strategy Lifecycle

GodsView enforces a strict promotion pipeline. Each stage has explicit gates and requires manual approval before proceeding.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   DRAFT → PARSED → BACKTESTED → STRESS_TESTED → PAPER_APPROVED │
│     │         │          │            │               │        │
│     └─────────┴──────────┴────────────┴───────────────┘        │
│                      (Rejected: recycle)                        │
│                                                                 │
│   LIVE_ASSISTED_APPROVED → AUTONOMOUS_APPROVED → RETIRED       │
│            │                       │                    │       │
│            └───────────────────────┴────────────────────┘       │
│         (Operator review required)  (Degradation path)          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

GATES AT EACH TRANSITION:

draft → parsed
  • Parse natural language prompt
  • Validate setup family exists
  • Check syntax + type safety

parsed → backtested
  • Compile strategy to execution rules
  • Run full backtest on historical data
  • Compute Sharpe, win rate, max drawdown
  • Generate equity curve + trade list

backtested → stress_tested
  • Forward walk 3-month window (out-of-sample)
  • Run shock scenario tests
  • Verify edge persists across regimes
  • Check correlation degradation

stress_tested → paper_approved
  • Operator reviews backtest report
  • Operator confirms stress test passing
  • Manual gate: "Ready for paper trading"
  • Deploy to paper trading environment

paper_approved → live_assisted_approved
  • Run paper trading for min 20 signals
  • Operator monitors live fills vs backtest
  • Manual gate: "Fills align with backtest"
  • Deploy to live with operator oversight

live_assisted_approved → autonomous_approved
  • Operator reviews live P&L trajectory
  • Operator confirms edge validation
  • Manual gate: "Autonomous execution approved"
  • No more operator oversight required

autonomous_approved → retired
  • Model drift detected OR
  • Manual retirement OR
  • Max drawdown exceeded threshold
  • Archive strategy, retain audit trail
```

## Data Flow

```
MARKET DATA INPUT
    │
    ├─→ [SMC Engine] → Structural scores, S/R levels
    │
    ├─→ [Order Flow] → OB, FVG, CVD scores
    │
    ├─→ [Regime Engine] → Market regime classification
    │
    ├─→ [Macro Engine] → Economic/sentiment context
    │
    ▼
[C4 GATE] (Structure + OrderFlow + Context + Confirmation)
    │
    ├─ Hard block? (session/news/degraded/regime mismatch)
    │     └─→ REJECT
    │
    ▼
[META LABEL] (TAKE / REDUCE / SKIP + sizing)
    │
    ▼
[SUPER INTELLIGENCE] (ML ensemble + Kelly)
    │
    ├─ ML probability < threshold?
    │     └─→ REDUCE or SKIP
    │
    ▼
[RISK ENGINE] (5-layer guards)
    │
    ├─ Kill switch active?
    │ ├─ Max daily loss exceeded?
    │ ├─ Exposure limit exceeded?
    │ ├─ Drawdown > threshold?
    │     └─→ REJECT
    │
    ▼
[ORDER EXECUTOR] → Alpaca API
    │
    ▼
[POSITION MONITOR] → Fill tracking, P&L
    │
    ▼
[DECISION REPLAY] → Event bus → Audit trail
    │
    ▼
[DAILY REVIEW] → HTML report, performance journal
```

## Service Responsibility Chart

| Service | Responsibility | Owner | Status |
|---------|------------------|-------|--------|
| **Strategy Engine** | Setup detection (5 setups), catalog management, threshold enforcement | Core | Production |
| **Super Intelligence** | Ensemble ML, Kelly position sizing, regime-adaptive scaling | Core | Production |
| **Risk Engine** | 5-layer guard stack (kill switch, daily loss, exposure, drawdown, session) | Core | Production |
| **SMC Engine** | Pure functional structural analysis, no external dependencies | Core | Production |
| **Order Flow Engine** | Order block, FVG, CVD scoring from tick data | Core | Production |
| **Regime Engine** | Market regime classification (5 classes), regime-specific rules | Core | Production |
| **C4 Gate** | Structured scoring, hard blocks, rejection audit trail | Core | Production |
| **Meta Label** | Size multiplier decision (1.0 / 0.5 / 0.0) from C4 + risk | Core | Production |
| **ML Model** | L2-logistic regression, cross-validation, drift detection | Core | Production |
| **Circuit Breaker** | Automatic position close on max drawdown, safety override | Core | Production |
| **Order Executor** | Alpaca order placement, fill reconciliation, slippage tracking | Core | Production |
| **Position Monitor** | Real-time P&L, exposure tracking, duration monitoring | Core | Production |
| **Session Manager** | Market hours, news lockout, holiday calendar, session state | Core | Production |
| **Stress Engine** | Walk-forward validation, shock scenarios, regime stress | Core | Production |
| **Proof Engine** | Backtest vs live comparison, signal quality proof | Core | Production |
| **Brain Orchestrator** | Coordinate all intelligence engines, manage decision flow | Core | Production |
| **Daily Review Journal** | HTML + Markdown reports, performance attribution, setup stats | Core | Production |
| **Macro Engine** | Macro risk factors, economic sentiment, regime context | Core | Experimental |
| **Brain Event Bus** | Event capture, replay log, audit trail persistence | Core | Production |
| **Degradation Monitor** | System health, data quality, service degradation tracking | Monitoring | Production |

## Production vs Experimental Status

| Module | Status | Notes |
|--------|--------|-------|
| **SMC Engine** | Production | Pure functional analysis, fully tested, no external deps |
| **Order Flow Engine** | Production | Stateless tick analysis, deterministic scoring |
| **Strategy Catalog** | Production | DB-backed, promotion gate-enforced, 5 families implemented |
| **C4 Gate** | Production | Hard blocks working, full audit trail |
| **Meta Label** | Production | Size decision logic complete, tested |
| **Regime Engine** | Production | 5 regimes implemented, training data available |
| **Risk Engine** | Production | 5 guards operational, kill switch tested |
| **Circuit Breaker** | Production | Drawdown protection active, failsafe verified |
| **Order Executor** | Production | Alpaca integration complete, fill reconciliation working |
| **ML Model** | Production | 136k+ labeled samples, drift detection operational |
| **Super Intelligence** | Production | Ensemble working, Kelly sizing implemented |
| **Session Manager** | Production | Market hours, news lockout enforcement |
| **Stress Engine** | Production | Walk-forward validation implemented |
| **Proof Engine** | Production | Backtest vs live comparison working |
| **Brain Orchestrator** | Production | Signal coordination operational |
| **Daily Review Journal** | Production | HTML + Markdown generation complete |
| **Brain Event Bus** | Production | Event capture and replay working |
| **Macro Engine** | Experimental | Initial sentiment feeds, regime context needs more data |
| **Degradation Monitor** | Production | Service health tracking active |
| **Strategy Lab (Natural Language)** | Experimental | Parser works for basic setups, DSL limited for complex logic |

## API Endpoint Summary

### Strategy Lifecycle

- `GET /api/market/strict-setup` — List all strategy templates
- `POST /api/alpaca/analyze` — Parse and analyze strategy prompt
- `POST /api/alpaca/backtest` — Run backtest on strategy
- `GET /api/market/strict-setup/backtest` — Get backtest results
- `GET /api/market/strict-setup/promotion-check` — Check promotion readiness
- `POST /api/market/strict-setup/promote` — Promote strategy to next stage
- `GET /api/market/strict-setup/matrix` — Strategy performance matrix

### Execution

- `POST /api/alpaca/orders` — Place order (validates guards)
- `GET /api/alpaca/orders` — Order history
- `POST /api/execution/position` — Current position snapshot
- `GET /api/execution/pnl` — Realtime P&L
- `POST /api/system/risk/kill-switch` — Activate kill switch

### Intelligence

- `GET /api/signals` — Real-time signal feed
- `POST /api/signals/validate` — Validate signal quality
- `GET /api/market/regime` — Current regime classification
- `GET /api/market/smc/{symbol}` — SMC structural analysis
- `GET /api/market/orderflow/{symbol}` — Order flow scores
- `POST /api/super-intelligence/score` — Ensemble ML score

### Monitoring & Diagnostics

- `GET /api/healthz` — Liveness probe
- `GET /api/readyz` — Readiness probe
- `GET /api/system/manifest` — Engine inventory and versions
- `GET /api/degradation` — Service degradation status
- `GET /api/system/diagnostics` — Full system diagnostics
- `GET /api/system/audit` — Audit trail summary
- `GET /api/system/audit/replay` — Decision replay by ID

### Analytics & Review

- `GET /api/performance/analytics` — Win rate, profit factor, equity curve
- `GET /api/performance/by-setup` — Performance breakdown by setup type
- `GET /api/journal/daily-review` — Daily HTML + Markdown report
- `GET /api/journal/trades` — Trade journal with entry/exit analysis
- `GET /api/analytics/drift` — ML model drift diagnostics

## Security & Compliance

### Authentication
- API server validates `Authorization` header for all `/api/` routes (JWT or API key)
- Alpaca credentials managed via environment variables, never in request bodies
- All sensitive operations require explicit operator token confirmation

### Audit Trail
- Every decision logged: timestamp, symbol, setup, regime, C4 score, meta-label, ML probability, order ID, fill details
- Immutable event log stored in PostgreSQL with hash chain verification
- Full replay capability: input market data + decision → outcome reconstruction

### Rate Limiting
- API gateway enforces 1000 requests/minute per client
- Order execution rate-limited to prevent flash crashes
- Signal generation capped at 100/second to prevent runaway scanning

## Deployment Model

### Development
- Single Node.js API server + PostgreSQL (docker-compose)
- Hot reload on code changes
- Paper trading mode by default

### Production
- Multi-instance API servers behind load balancer (stateless design)
- PostgreSQL with read replicas for analytics queries
- Redis cache layer for market data
- Prometheus + Grafana for monitoring
- Separate paper vs live trading environments

### Safety Guarantees
- No autonomous execution without explicit operator approval
- Kill switch always operational (hardcoded failsafe)
- Circuit breaker on drawdown (automatic position close)
- Session lockout during news events
- Daily report generation before market open (accountability)

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | React 18 + TypeScript | Dashboard UI |
| **API Server** | Express.js + TypeScript | REST API gateway |
| **Database** | PostgreSQL | Persistence, audit trail |
| **Cache** | Redis | Market data, session state |
| **Market Data** | Alpaca API + WebSocket | Live price, account, orders |
| **Charting** | TradingView Lightweight Charts | Chart overlays, structure viz |
| **ML** | L2-Logistic Regression (SciKit) | Probability scoring |
| **Monitoring** | Prometheus + Grafana | Metrics, dashboards |
| **Logging** | Winston + Structured JSON | Audit trail |
| **Testing** | Vitest + Jest | Unit + integration tests |
| **Build** | esbuild + TypeScript | Fast compilation |
