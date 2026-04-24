# GodsView — AI-Driven Trading Intelligence Platform

An autonomous market intelligence and execution system that watches live markets, detects trading setups with ML ensemble models, validates them through a 5-layer risk engine, and executes trades with full audit trails. Built in TypeScript, deployed on AWS, running real market data.

**Live on AWS** · [Architecture Diagram](docs/architecture-diagram.html) · [Portfolio Package](docs/PORTFOLIO_PACKAGE.md)

---

### Key Metrics

| Metric | Value |
|--------|-------|
| Lines of Code | 115,000+ TypeScript/TSX |
| Git Commits | 500+ |
| Backend Modules | 387 files, 72 API routes, 136 lib modules |
| Frontend Pages | 85 React pages across 10 sidebar sections (zero placeholders) |
| Sidebar Architecture | 68 production pages organized into 10 sections |
| Automated Tests | 1,420 |
| Data Sources | Alpaca (live crypto), Yahoo Finance (14 equity symbols) |
| Deployment | AWS CDK (ECS Fargate + RDS + ElastiCache + S3/CloudFront) |
| Database | PostgreSQL 16 with 21 schemas, full audit trails |

---

## What It Does

GodsView runs a continuous loop: **ingest → analyze → decide → execute → learn**.

1. **Ingest** — Live market data streams from Alpaca (BTC, ETH) and Yahoo Finance (AAPL, TSLA, GOOGL, AMZN, META, MSFT, NVDA, SPY, QQQ, GLD, TLT, etc.)
2. **Analyze** — 9 intelligence engines score each setup: market structure (SMC), order flow, regime detection, macro sentiment, ML ensemble
3. **Decide** — Signals pass through a 5-layer risk gate: kill switch → daily loss limit → exposure caps → session rules → circuit breaker
4. **Execute** — Order state machine with idempotency, retry with exponential backoff, and broker integration (Alpaca)
5. **Learn** — Post-trade feedback loop stores outcomes, retrains models every 4 hours, detects drift, auto-demotes degraded strategies

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  PRESENTATION — React 19 + Three.js                                  │
│  85 pages · 3D Brain Hologram · Real-time SSE · Nginx (port 80)      │
├──────────────────────────────────────────────────────────────────────┤
│  API SERVER — Express 5 + TypeScript                                 │
│  72 route files · 136 lib modules · OpenAPI · RBAC · Rate limiting   │
├──────────────────────────────────────────────────────────────────────┤
│  INTELLIGENCE ENGINES                                                │
│  Market Structure · Order Flow · ML Pipeline · Backtesting           │
│  Memory/Recall · Regime Detection · Autonomous Brain                 │
├──────────────────────────────────────────────────────────────────────┤
│  EXECUTION & RISK                                                    │
│  Order State Machine · 5-Layer Safety Stack · Alpaca Broker          │
│  Paper → Assisted → Semi-Auto → Autonomous modes                     │
├──────────────────────────────────────────────────────────────────────┤
│  DATA — PostgreSQL · Redis · S3                                      │
├──────────────────────────────────────────────────────────────────────┤
│  INFRA — AWS EC2 · Docker Compose · CloudWatch · GitHub CI           │
└──────────────────────────────────────────────────────────────────────┘
```

For the full interactive diagram: [docs/architecture-diagram.html](docs/architecture-diagram.html)

---

## Core Systems

### Intelligence Engines
Nine specialized engines analyze every setup before it reaches execution. Market structure detection identifies order blocks, BOS/CHOCH, liquidity sweeps, and premium/discount zones. Order flow analysis reads heatmaps, DOM depth, footprint/delta, and absorption patterns. Regime detection classifies current conditions as trending, choppy, volatile, or news-driven. The ML ensemble runs an L2-logistic regression on 18 features with drift detection and auto-retraining.

### Execution Safety
Every trade passes through a 5-layer risk gate. Layer 1 is a global kill switch that halts all trading instantly. Layer 2 enforces daily loss limits. Layer 3 caps exposure per symbol and sector. Layer 4 applies session rules (trading hours, max orders per minute). Layer 5 is a circuit breaker that auto-liquidates on extreme volatility. The order state machine handles idempotency, retry with exponential backoff, and orphan position reconciliation.

### 3D Brain Hologram
A Three.js neural visualization renders the platform's decision state in real time. Ticker nodes orbit a central brain mesh, strategy nodes pulse with confidence scores, and signal flow paths glow based on ML output. Server-Sent Events push live updates. Click any node to drill into the relevant analysis page.

### Strategy Lifecycle
Strategies move through a governed promotion pipeline: draft → backtested → paper → assisted → autonomous. Walk-forward backtesting with regime-aware validation prevents overfitting. The strategy leaderboard ranks by composite score (Sharpe, Sortino, profit factor, win rate, expectancy). Degraded strategies auto-demote.

### Memory & Recall
The recall engine stores every trade setup with context: chart state, flow conditions, ML scores, and outcome. Similarity search finds historical analogs for current setups. A post-trade journal logs reasoning and mistakes. The learning loop feeds outcomes back into model retraining.

---

## Quick Start

```bash
# Clone and install
git clone https://github.com/Santhakumarramesh/Godsview.git
cd Godsview
pnpm install

# Configure environment
cp .env.example .env
# Set: ALPACA_API_KEY, ALPACA_SECRET_KEY, DATABASE_URL

# Start development
pnpm dev
# Frontend: http://localhost:3000
# API: http://localhost:3001/api
```

## Production Deployment

```bash
# Docker Compose (full stack)
docker compose up -d --build

# Verify
curl http://localhost:80/healthz        # API health
curl http://localhost:80/api/signals     # Trading signals
curl http://localhost:80/api/alpaca/ticker  # Live prices
```

### AWS CDK Deployment

```bash
cd infra
npx cdk deploy --all --context env=prod
```

AWS infrastructure (4 CDK stacks): VPC with 2 AZs, ECS Fargate (auto-scaling 2-10 tasks), RDS PostgreSQL 16 (Multi-AZ, 14-day backups, encryption at rest), ElastiCache Redis 7.1 (replicated with failover), S3 + CloudFront for dashboard CDN, Secrets Manager for credentials, CloudWatch alarms (CPU, memory, storage, 5xx, latency) with SNS notifications, Container Insights enabled.

---

## 68 Core Dashboard Pages (85 Total)

All 68 planned sidebar pages are implemented with real API connections. An additional 17 supplementary pages (Signals, Trades, Analytics, War Room, Proof, Checklist, Reports, Super Intelligence, Institutional Intelligence, Intelligence Center, Decision Replay, Candle X-Ray, Stitch Lab, Settings, etc.) bring the total to 85.

| Section | Pages | What It Covers |
|---------|-------|----------------|
| God Brain / Command | 8 | Home, 3D Hologram, System Health, Mission Control, Alerts, Daily Briefing, Session Control, Strategy Radar |
| Market Discovery | 8 | Scanner, Watchlist, Opportunity Queue, Regime Detection, Liquidity Environment, News/Sentiment, Heat Board, Cross-Asset |
| Chart / Structure | 8 | TradingView Chart, Multi-Timeframe, Order Blocks, BOS/CHOCH, Sweep Mapper, Premium/Discount, Entry Planner, Annotations |
| TradingView MCP | 6 | MCP Control, Pine Script Registry, Webhook Router, Strategy Sync, Chart Action Bridge, Replay Connector |
| Order Flow | 8 | Dashboard, Heatmap, DOM/Depth, Footprint/Delta, Absorption, Imbalance, Execution Pressure, Flow+Structure Confluence |
| Quant Lab | 8 | Lab Home, Backtesting Engine, Strategy Builder, Walk-Forward, Performance Analytics, Regime Matrix, Experiment Tracker, Promotion Pipeline |
| Memory / Recall | 6 | Recall Engine, Case Library, Screenshot Vault, Similarity Search, Trade Journal, Learning Loop |
| Portfolio / Risk | 8 | Portfolio Command, Position Monitor, Allocation Engine, Correlation Risk, Drawdown Protection, Risk Policy, Pre-Trade Gate, Capital Efficiency |
| Execution | 8 | Execution Center, Paper Trading, Assisted Live, Semi-Auto, Autonomous Mode, Broker Connector, Fill Quality, Kill Switch |
| Governance | 6 | Audit Trail, Ops Monitor, Decision Replay, Intelligence Hub, War Room, Settings |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript + Tailwind CSS |
| 3D Visualization | Three.js + @react-three/fiber |
| API Server | Express 5 + TypeScript + Drizzle ORM |
| Database | PostgreSQL 16 |
| Cache | Redis |
| ML | scikit-learn + XGBoost |
| Broker | Alpaca API v2 (paper + live) |
| Charts | TradingView Lightweight Charts |
| Infrastructure | AWS CDK (ECS Fargate + RDS + ElastiCache + S3/CloudFront) |
| Monitoring | CloudWatch Alarms + Container Insights + Prometheus + Grafana |
| Testing | Vitest (1,420 tests) |
| Security | RBAC (4 roles) + Kill switch + Audit trail |

---

## Security

Role-Based Access Control with 4 roles (admin, operator, trader, viewer). A two-layer kill switch halts all mutations instantly. Full audit trail records every protected action with actor, role, permission, and outcome. Pre-trade risk gate validates every order against all 5 safety layers before execution. API key rotation via environment variables only — no secrets in code.

---

## Project Structure

```
Godsview/
├── api-server/              # Express API (72 routes, 136 lib modules)
│   ├── src/routes/          # API endpoints
│   ├── src/lib/             # Intelligence engines, ML, risk, execution
│   ├── src/engines/         # Autonomous brain, governance, paper trading
│   └── src/__tests__/       # 1,420 automated tests
├── godsview-dashboard/       # React frontend (85 pages, 10-section sidebar)
├── lib/                     # Shared libraries (db, types, validation)
├── infra/                   # AWS CDK infrastructure
├── deploy/                  # Deployment scripts
├── docs/                    # Architecture diagram, portfolio package, runbooks
└── docker-compose.yml       # Container orchestration
```

---

## License

MIT

---

Built by [Santhakumar](https://github.com/Santhakumarramesh) · 115,000+ lines · 500+ commits · Live on AWS
