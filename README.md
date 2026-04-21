# GodsView v2.0 — AI-Native Trading Operating System

A production-grade market intelligence, execution, and governance platform that combines chart structure analysis, order flow intelligence, multi-agent reasoning, backtesting, memory/recall, and live execution into a unified operating system with 140+ functional pages featuring complete API integration.

GodsView is built for discretionary traders who want deterministic decision rules, full audit trails, measurable edge proof before autonomous trading, and enterprise-grade security with role-based access control.

## Architecture

GodsView v2 runs as a unified full-stack platform with no v1 legacy code:

```
┌───────────────────────────────────────────────────────────────────┐
│  PRESENTATION LAYER — Next.js 15 + React 19 + Three.js           │
│  140+ functional pages (100% API-integrated, zero placeholders)   │
│  3D Brain Hologram neural visualization (orbiting nodes + glow)   │
│  Real-time SSE live updates for signals and execution flows       │
│  Port 3000 — proxies API calls to backend                        │
├───────────────────────────────────────────────────────────────────┤
│  NODE API SERVER — Express 5 + TypeScript                        │
│  123 routes: trading, backtesting, memory, risk, execution       │
│  OpenAPI spec (full schema coverage)                             │
│  Port 3001 — Alpaca broker, ML pipeline, TradingView webhooks    │
├───────────────────────────────────────────────────────────────────┤
│  PYTHON MICROSERVICES — FastAPI                                  │
│  12+ services: control_plane, backtest, execution, memory,       │
│  orderflow, market_data, risk, features, tradingview_bridge      │
│  Ports 8000-8010 — orchestrated via Docker Compose               │
├───────────────────────────────────────────────────────────────────┤
│  DATA LAYER                                                      │
│  PostgreSQL + Redis + LanceDB (vector) + S3 (artifacts)          │
│  Audit trail logging on all protected actions                    │
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

**3D God Brain Hologram Command Center**
- Three.js neural visualization with orbiting ticker/strategy/agent nodes
- Live signal flow paths with confidence glow effects
- Server-Sent Events (SSE) for real-time neural updates
- Click-through navigation to deep strategy analysis
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

## 140+ Functional Pages (All API-Integrated)

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
| **Total** | **68+** | **All pages feature live API integration and real-time state management** |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15 + React 19 + TypeScript + Tailwind CSS |
| 3D Visualization | Three.js + @react-three/fiber + drei (SSE live updates) |
| State | Zustand + TanStack Query |
| API Server | Express 5 + TypeScript + Drizzle ORM |
| API Schema | OpenAPI 3.1 spec (full coverage) |
| Microservices | FastAPI + Python 3.10 |
| Database | PostgreSQL / Aurora + SQLite (dev) |
| Cache | Redis / ElastiCache |
| Vector Store | LanceDB |
| ML | scikit-learn + XGBoost |
| Broker | Alpaca API v2 (paper + live) |
| Charts | TradingView Lightweight Charts |
| Infrastructure | AWS CDK + Docker Compose |
| Monitoring | CloudWatch + Pino structured logging |
| Testing | Vitest (TypeScript) + pytest (Python) — 3,836+ tests total |
| Security | RBAC (4 roles) + Kill switch + Audit trail + Risk gates |

## Test Suite (3,836+ Tests)

**Complete test coverage across TypeScript and Python with E2E lifecycle validation:**

```bash
# TypeScript tests (3,676 tests across 180 test files)
pnpm --filter @workspace/api-server test

# Python tests (160 tests with pytest)
python -m pytest services/tests/

# E2E tests (22/22 verification checks)
# Lifecycle golden path + failure path validation
# Risk gate enforcement, order lifecycle, audit trails
pnpm test:e2e

# Full verification (typecheck + tests + build)
pnpm verify:prod
```

**Test Categories:**
- Unit: Risk gates, RBAC, auth, ML models, data validation
- Integration: Broker APIs, database operations, service orchestration
- E2E: Complete trading lifecycle (signal → backtest → approval → execution → PnL)
- Lifecycle: Golden path (happy path) + failure path (risk gate blocks)

## Security

GodsView implements enterprise-grade access control and risk enforcement:

**Role-Based Access Control (RBAC) — 4 Roles**
- **admin**: Full system access, all permissions, system configuration
- **operator**: Manage execution, kill switch, risk config, trade approvals
- **trader**: Submit signals, request approvals, view positions, dashboard access
- **viewer**: Read-only dashboard and report access, no trading capability

**Kill Switch (Two-Layer Enforcement)**
- Layer 1: Global `kill_switch_override` flag prevents all mutations (except health checks)
- Layer 2: Per-permission enforcement on sensitive actions (approve, execute, liquidate)
- Returns 403 Forbidden when active; immediate effect across all endpoints
- Audit trail records all kill switch toggles with actor and timestamp

**Audit Trail**
- All protected actions logged: permissions checked, roles enforced, outcomes recorded
- Immutable audit records: timestamp, actor (user/system), role, permission, status
- Risk gate decisions logged with full context (order, risk checks, approvals)
- Export audit logs for compliance and forensic analysis

**Pre-Trade Risk Gate (5-Layer Guard Stack)**
- Kill switch enforcement (blocks all trades when active)
- Daily loss limit (prevents excessive portfolio erosion)
- Exposure caps (position size limits per symbol/sector)
- Session rules (trading hours, max orders per minute)
- Circuit breaker (auto-liquidate on margin calls or extreme volatility)
- Every order validated against all 5 layers before execution

**Additional Security Features**
- API key rotation and secure storage (environment variables only)
- OpenAPI schema validation (request/response type safety)
- TLS encryption in transit (HTTPS on all endpoints)
- Operator token authentication (broker execution authorization)

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
├── godsview-dashboard/    # Next.js 15 frontend (140+ pages, fully integrated)
├── artifacts/api-server/  # Node.js API server (123 routes, OpenAPI spec)
├── packages/              # Shared packages (@gv/api-client, types, config, ui)
├── lib/                   # Core libraries (strategy-core, db, api-zod)
├── services/              # Python microservices (12+ FastAPI services)
├── infra/                 # AWS CDK infrastructure (4 stacks)
├── scripts/               # Operational and deployment scripts
├── blueprint/             # Architecture and design documentation
├── __tests__/             # Test suites (E2E, integration, unit)
└── docker-compose.yml     # Service orchestration (12 services)
```

**Key Subdirectories:**
- `artifacts/api-server/src/routes/` — 123 API route handlers
- `artifacts/api-server/src/__tests__/` — TypeScript tests (3,676 total)
- `artifacts/api-server/src/middleware/` — RBAC, auth, logging
- `services/` — Python FastAPI microservices with pytest coverage
- `godsview-dashboard/src/pages/` — Next.js page components

## License

MIT
