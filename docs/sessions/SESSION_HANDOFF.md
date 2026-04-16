# Godsview AI Trading OS — Session Handoff (April 7, 2026)

## Repository
- **GitHub**: https://github.com/Santhakumarramesh/Godsview
- **Local path**: `/Users/santhakumar/Documents/Playground 2/Godsview`
- **Total commits**: 339 | **Latest**: `985bed4`
- **All tests passing**: 159 test files, 3,188 tests GREEN

## Architecture
- **Monorepo**: pnpm workspace with corepack
- **Dashboard**: `artifacts/godsview-dashboard/` — React 19 + Vite 7 (159 TSX/TS files)
- **API Server**: `artifacts/api-server/` — Express 5 + TypeScript (390 TS files, 161 test files)
- **MCP Servers**: `mcp-servers/tradingview/`, `mcp-servers/bloomberg/`, `mcp-servers/news-monitor/` (3 servers, JSON-RPC stdio)
- **Python v2**: `artifacts/python-v2/` — FastAPI microservices
- **Database**: PostgreSQL 16 + Drizzle ORM
- **Test runner**: Vitest v4.1.2
- **Test command**: `GODSVIEW_DATA_DIR=artifacts/api-server/.runtime corepack pnpm --filter @workspace/api-server run test`

## Critical Dev Notes
- **Desktop Commander MCP** required for reliable filesystem writes (Edit tool via mount path doesn't reliably sync)
- **Desktop Commander read_file** often returns empty — use `start_process` with `cat`/`sed` or Read tool via mount path
- **Chunked writes**: Desktop Commander requires 25-30 line chunks (rewrite + append)
- **Dashboard registration**: lazy import in App.tsx + RoutedPage route + Shell.tsx nav entry
- **Route registration**: import in `artifacts/api-server/src/routes/index.ts`

## Completed Phases (1-149)

### Latest Commit: `985bed4` — Phase 145-149

| Phase | What | Key Files |
|-------|------|-----------|
| 145 | **Quant Lab Rewrite** — 46 stocks, search/filter/sort, top 15 per page + pagination, strategy testing panel with NLP prompts, multi-TF backtest | `pages/quant-lab.tsx` |
| 146 | **Bookmap Heatmap** — Canvas-rendered order book heatmap (bid/ask liquidity, trade dots, absorption, delta bars) + ONE-CLICK toggle in TradingView chart | `components/bookmap-heatmap.tsx`, `pages/tradingview-chart.tsx` |
| 147 | **Autonomous Symbol Brain Engine** — Per-symbol human-like brain nodes with 9 analysis dimensions (fundamental, technical, SMC, ICT, order flow, price action, liquidity, heatmap, indicators), Kelly sizing, reasoning chains | `lib/autonomous_symbol_brain.ts` (678 lines), `routes/autonomous_brain.ts` |
| 148 | **Autonomous Brain Dashboard** — Radar charts, multi-TF decision matrix, score bars, reasoning chain viz, live SSE | `pages/autonomous-brain.tsx` (491 lines) |
| 149 | **Strategy Prompt Engine** — NLP parser → multi-TF backtest with Sharpe/PF/WR/DD metrics, 8 strategy templates | `lib/strategy_prompt_engine.ts` (334 lines), `routes/strategy_prompt.ts` |

### Previous Major Phases
| Phase | What |
|-------|------|
| 138-144 | MCP servers (TradingView, Bloomberg, News Monitor), Brain Floating Panel, Bloomberg data routes, News feed SSE, Brain nodes WebSocket, Production readiness doc |
| 135-137 | Multi-broker abstraction (Alpaca adapter), Economic Calendar, Production readiness verification |
| 130-134 | Grafana dashboards, k6 load tests, CI/CD hardening, DB migration audit |
| 125-129 | TradingView Advanced Chart, Bloomberg Terminal, News Monitor, Brain Nodes page, Advanced Risk page |
| 115-124 | Ops Security, Paper Trading Program, Capital Gating, Python v2 bridge, OpenAPI docs |
| 100-114 | Regime Intelligence, Correlation Lab, Execution Control, Sentiment, Performance Analytics, Alert Center, Microstructure, System Audit, Data Integrity, Backtest Credibility, Exec Reliability, Risk v2, Model Governance, Decision Explainability |
| 77-99 | Quant Super-Intelligence subsystems (Strategy Lab, Backtest Enhanced, Quant Reasoning, Memory, Market Data, Governance, UX, Explainability, Autonomous Ops), Decision Loop, Eval/Trust, System Bridge, TradingView MCP Integration, Pipeline Orchestrator |
| 1-76 | Core trading engine, signal pipeline, brain system v1/v2, risk engine, execution, portfolio, alerts, journal, watchlist, analytics, ops |

## Key API Endpoints (Latest Additions)

```
# Phase 147 — Autonomous Brain
GET  /api/autonomous/brains              — All brain node summaries
GET  /api/autonomous/brain/:symbol       — Full brain state for symbol
GET  /api/autonomous/brain/:symbol/:tf   — Decision for specific timeframe
POST /api/autonomous/activate            — Activate new symbol brain
POST /api/autonomous/deactivate          — Deactivate symbol brain
GET  /api/autonomous/opportunities       — Top ranked opportunities
GET  /api/autonomous/stream              — SSE live brain updates

# Phase 149 — Strategy Prompt Engine
POST /api/strategy-prompt/backtest       — NLP prompt → multi-TF backtest
POST /api/strategy-prompt/parse          — NLP prompt → parsed strategy
GET  /api/strategy-prompt/templates      — Pre-built strategy templates

# Phase 138-142 — MCP & Market Data
GET  /api/market/snapshot                — Market overview
GET  /api/market/sectors                 — Sector heatmap
GET  /api/news/monitor                   — News feed
GET  /api/news/stream                    — News SSE stream
GET  /api/brain/nodes                    — Brain subsystem snapshot
GET  /api/brain/nodes/stream             — Brain SSE stream
```

## Dashboard Pages (73+ pages)
All registered in `App.tsx` with lazy imports + `Shell.tsx` nav entries:
- `/tradingview-chart` — Candlestick chart + Bookmap heatmap (one-click toggle)
- `/quant-lab` — Stock search, sort, paginate, strategy testing
- `/autonomous-brain` — Per-symbol brain nodes with radar charts
- `/bloomberg-terminal`, `/news-monitor`, `/brain-nodes`
- `/super-intelligence`, `/economic-calendar`, `/advanced-risk`
- `/brain-graph`, `/regime-intelligence`, `/correlation-lab`
- `/execution-control`, `/sentiment-intel`, `/performance-analytics`
- `/alert-center`, `/microstructure`, `/capital-gating`
- Plus 50+ more pages (see App.tsx for full list)

## What Remains — Next Phases (150+)

### Priority 1: Production Hardening

- [ ] **Phase 150: Live Data Integration** — Replace mock data generators with real market data APIs (Alpaca, Polygon, Alpha Vantage). Wire TradingView chart to live WebSocket candle feed. Connect news monitor to real RSS/API feeds.
- [ ] **Phase 151: Authentication & Authorization** — JWT auth, API keys, role-based access control, session management
- [ ] **Phase 152: Database Production Schema** — Run Drizzle migrations on production PostgreSQL, seed reference data, connection pooling
- [ ] **Phase 153: WebSocket Production Layer** — Reliable WS reconnection, heartbeat, backpressure, message queuing
- [ ] **Phase 154: Docker & Deployment** — Dockerfile for API + dashboard, docker-compose with PostgreSQL + Redis, health checks, graceful shutdown

### Priority 2: Intelligence Enhancement
- [ ] **Phase 155: Real Order Book Integration** — Connect bookmap heatmap to live Level 2 data (Alpaca/IEX)
- [ ] **Phase 156: Real Autonomous Brain Signals** — Replace seeded random with actual indicator calculations (ta-lib, technicalindicators)
- [ ] **Phase 157: AI/ML Model Integration** — TensorFlow.js or ONNX runtime for trained models, feature engineering pipeline
- [ ] **Phase 158: Strategy Backtester v3** — Event-driven backtester with real historical data, slippage, commission modeling
- [ ] **Phase 159: Alert & Notification Engine** — Push notifications, email alerts, Slack/Discord integration for brain signals

### Priority 3: Scale & Polish
- [ ] **Phase 160: Performance Optimization** — React.memo, virtualized lists, Web Workers for heavy computation, bundle splitting
- [ ] **Phase 161: Mobile Responsive** — Responsive layouts for all 73+ pages, touch-optimized charts
- [ ] **Phase 162: End-to-End Testing** — Playwright E2E tests for critical user flows
- [ ] **Phase 163: Monitoring & Observability** — OpenTelemetry tracing, structured logging, error tracking (Sentry)
- [ ] **Phase 164: Documentation & Onboarding** — API docs, user guide, architecture diagrams, video walkthroughs

## Copy-Paste Prompt for Next Chat

```
Continue building the Godsview AI Trading OS from Phase 150.

Repository: https://github.com/Santhakumarramesh/Godsview
Local path: /Users/santhakumar/Documents/Playground 2/Godsview

Current state: 339 commits, latest 985bed4, 159 test files (3,188 tests all GREEN).
Architecture: pnpm monorepo — React 19 + Vite 7 dashboard (159 files), Express 5 + TypeScript API (390 files), 3 MCP servers, PostgreSQL + Drizzle ORM, Vitest v4.1.2.

Phases 1-149 COMPLETE. Read SESSION_HANDOFF.md in the repo root for full details.

CRITICAL DEV NOTES:
- Use Desktop Commander MCP for all filesystem writes (mount Edit tool doesn't reliably sync)
- Desktop Commander read_file returns empty — use start_process with cat/sed instead
- Chunked writes: 25-30 lines per write_file call (rewrite then append)
- Dashboard registration: lazy import in App.tsx + RoutedPage route + Shell.tsx nav entry
- Test command: GODSVIEW_DATA_DIR=artifacts/api-server/.runtime corepack pnpm --filter @workspace/api-server run test

NEXT: Phase 150+ — Live data integration, authentication, database production schema, WebSocket reliability, Docker deployment, real order book for bookmap, real indicator calculations for autonomous brain, AI/ML model integration, strategy backtester v3 with real historical data. Make it market production ready. Don't stop, don't miss anything.
```
