# GodsView v2.0 — AI-Native Trading Operating System

A production-grade market intelligence, execution, and governance platform that combines chart structure analysis, order flow intelligence, multi-agent reasoning, backtesting, memory/recall, and live execution into a unified operating system with 68 functional pages.

GodsView is built for discretionary traders who want deterministic decision rules, full audit trails, and measurable edge proof before autonomous trading.

## Architecture

GodsView runs as a unified full-stack platform:

```
┌───────────────────────────────────────────────────────────────────┐
│  PRESENTATION LAYER — Next.js 15 + React 19 + Three.js           │
│  68-page dashboard with 3D Brain Hologram command center          │
│  Port 3000 — proxies API calls to backend                        │
├───────────────────────────────────────────────────────────────────┤
│  NODE API SERVER — Express 5 + TypeScript                        │
│  123 routes: trading, backtesting, memory, risk, execution       │
│  Port 3001 — Alpaca broker, ML pipeline, TradingView webhooks    │
├───────────────────────────────────────────────────────────────────┤
│  PYTHON MICROSERVICES — FastAPI                                  │
│  9 services: control_plane, backtest, execution, memory,         │
│  orderflow, market_data, risk, features, tradingview_bridge      │
│  Ports 8000-8010 — orchestrated via Docker Compose               │
├───────────────────────────────────────────────────────────────────┤
│  DATA LAYER                                                      │
│  PostgreSQL + Redis + LanceDB (vector) + S3 (artifacts)          │
├───────────────────────────────────────────────────────────────────┤
│  INFRASTRUCTURE                                                  │
│  AWS CDK (4 stacks) + Docker Compose (12 services)               │
│  CloudFront + ALB + ECS Fargate + Aurora + ElastiCache            │
└───────────────────────────────────────────────────────────────────┘
```

## Key Capabilities

**Strategy Lifecycle: Prompt → Backtest → Promote → Execute → Learn**
- Define strategies in natural language, compile to deterministic rules
- Walk-forward backtesting with regime-aware validation
- Promotion pipeline: draft → backtested → paper → assisted → autonomous
- Post-trade learning loop with memory/recall

**Market Intelligence (9 Engines)**
- SMC structure: order blocks, BOS/CHOCH, liquidity sweeps, premium/discount
- Order flow: heatmaps, DOM depth, footprint/delta, absorption, imbalance
- Regime detection: trending, choppy, volatile, news-driven
- Multi-timeframe alignment across HTF/MTF/LTF

**Super Intelligence: ML Ensemble**
- L2-logistic regression on 18-dimensional feature set
- 136k+ labeled records, drift detection, Kelly criterion sizing
- TradingView webhook → ML pipeline → risk gate → execution

**Execution Safety: 5-Layer Guard Stack**
- Kill switch, daily loss limit, exposure caps, session rules, circuit breaker
- Pre-trade risk gate validates every order against portfolio/risk policies
- Paper → assisted → semi-auto → autonomous modes

**3D Brain Hologram Command Center**
- Three.js neural visualization with orbiting ticker/strategy/agent nodes
- Live signal flow paths, confidence glow, click-through navigation
- Canvas 2D fallback for non-WebGL environments

**Memory & Recall**
- Store winning/losing setups with chart screenshots
- Similarity search finds historical analogs
- Post-trade feedback loop for continuous improvement

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/Santhakumarramesh/Godsview.git
cd Godsview
pnpm install

# 2. Configure environment
cp .env.example .env
# Set: ALPACA_API_KEY, ALPACA_SECRET_KEY, DATABASE_URL

# 3. Start development (unified frontend + API server)
pnpm dev
# Frontend: http://localhost:3000
# API: http://localhost:3001/api

# 4. Start Python microservices (optional, for full stack)
docker compose --profile v2 up -d
```

## Production Deployment

```bash
# Docker Compose (all services)
docker compose --profile v2 up -d

# AWS CDK deployment
cd infra
pnpm deploy:dev    # Development environment
pnpm deploy:prod   # Production environment

# Verification
pnpm verify:prod              # Typecheck + tests + build
pnpm verify:release           # Full release validation
pnpm verify:market:paper      # Paper trading readiness
pnpm verify:market:live:strict # Live trading readiness
```

## 68-Page Sidebar

| Section | Pages | Description |
|---------|-------|-------------|
| God Brain / Command | 8 | Home, Hologram, Health, Mission Control, Alerts, Briefing, Session, Radar |
| Market Discovery | 8 | Scanner, Watchlist, Queue, Regime, Liquidity, News, Heat Board, Cross-Asset |
| Chart / Structure | 8 | TradingView, Multi-TF, Order Blocks, BOS/CHOCH, Sweeps, Premium/Discount, Entry Planner, Annotations |
| TradingView MCP | 6 | MCP Control, Pine Registry, Webhook Router, Strategy Sync, Action Bridge, Replay |
| Order Flow | 8 | Dashboard, Heatmap, DOM, Footprint, Absorption, Imbalance, Pressure, Confluence |
| Quant Lab | 8 | Home, Backtesting, Strategy Builder, Walk-Forward, Analytics, Regime Matrix, Experiments, Promotion |
| Memory / Recall | 6 | Recall Engine, Case Library, Screenshots, Similarity, Journal, Learning Loop |
| Portfolio / Risk | 8 | Portfolio, Positions, Allocation, Correlation, Drawdown, Risk Policy, Pre-Trade Gate, Capital |
| Execution | 8 | Center, Paper Trading, Assisted, Semi-Auto, Autonomous, Broker, Fill Quality, Kill Switch |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15 + React 19 + TypeScript + Tailwind CSS |
| 3D Visualization | Three.js + @react-three/fiber + drei |
| State | Zustand + TanStack Query |
| API Server | Express 5 + TypeScript + Drizzle ORM |
| Microservices | FastAPI + Python 3.10 |
| Database | PostgreSQL / Aurora + SQLite (dev) |
| Cache | Redis / ElastiCache |
| Vector Store | LanceDB |
| ML | scikit-learn + XGBoost |
| Broker | Alpaca API v2 (paper + live) |
| Charts | TradingView Lightweight Charts |
| Infrastructure | AWS CDK + Docker Compose |
| Monitoring | CloudWatch + Pino structured logging |
| Testing | Vitest + pytest (320+ tests) |

## Test Suite

```bash
# TypeScript tests (180 tests)
pnpm --filter @workspace/api-server test

# Python tests (160 tests)
python -m pytest services/tests/

# Full verification
pnpm verify:prod
```

## Environment Variables

See `.env.example` for complete list.

```bash
# Required
ALPACA_API_KEY=your_paper_key
ALPACA_SECRET_KEY=your_paper_secret
DATABASE_URL=postgresql://...

# Optional
ANTHROPIC_API_KEY=your_claude_key
GODSVIEW_OPERATOR_TOKEN=your_operator_token
REDIS_URL=redis://localhost:6379
```

## Project Structure

```
Godsview/
├── apps/web/              # Next.js 15 frontend (68 pages)
├── artifacts/api-server/  # Node.js API server (123 routes)
├── packages/              # Shared packages (@gv/api-client, types, config, ui)
├── lib/                   # Core libraries (strategy-core, db, api-zod)
├── services/              # Python microservices (9 services)
├── infra/                 # AWS CDK (4 stacks)
├── scripts/               # Operational scripts
├── blueprint/             # Architecture documentation
└── docker-compose.yml     # Service orchestration (12 services)
```

## License

MIT
