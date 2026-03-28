# Godsview Trading Dashboard

## Overview

A professional trading bot dashboard for the Godsview hybrid AI trading pipeline. Built as a pnpm monorepo with a React + Vite frontend and Express API backend backed by PostgreSQL.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui
- **Charts**: Recharts (equity curve, performance breakdowns)
- **Build**: esbuild (API server bundle)

## Architecture — 6-Layer Pipeline + SK + CVD

The dashboard monitors a 6-layer hybrid AI trading system with SK structure pre-filter and CVD order flow:

| Layer | Tool | Weight | Role |
|-------|------|--------|------|
| 0 | SK Structure Engine | pre-filter | HTF bias, swing zones, sequence detection, corrective completion |
| 1 | TradingView Structure | 30% | Order blocks, S/R, VWAP, session highs/lows |
| 2 | CVD Order Flow | 25% | Absorption, delta, sweeps, CVD divergence, buy/sell ratio |
| 3 | Recall Engine | 20% | 1m/5m/15m/1h multi-timeframe memory |
| 4 | ML Model | 15% | XGBoost per-setup probability |
| 5 | Claude Reasoning | 10% | Context-aware final filter |
| 6 | Risk Engine | gate | Position sizing, news lockout, daily loss limits |

**Final Quality Formula:** `0.30*structure + 0.25*orderflow + 0.20*recall + 0.15*ml + 0.10*claude`

## Setup Types

**Original setups:**
- `absorption_reversal` — Price reaches S/R, aggressor absorbed, reclaim confirmed. SK zone alignment adds up to +0.20 to structure score.
- `sweep_reclaim` — Liquidity sweep fails, opposite-side aggression appears. Most powerful when sweeping an SK structural zone.
- `continuation_pullback` — Trend established, liquidity thins, delta aligned. Requires SK sequence completion for highest scores.

**SK-powered new setups:**
- `cvd_divergence` — Price and CVD moving in opposite directions (hidden buying/selling pressure). Requires confirmed CVD divergence flag.
- `breakout_failure` — False break beyond SK swing high/low with immediate snap-back. Requires price to be in_zone. The core SK setup: tight stop, high R:R.

**SK Structure Engine (`computeSKFeatures`):**
- HTF bias from pivot HH/HL vs LH/LL pattern detection on 5m bars
- Sequence detection: impulse → correction → completion stages
- SK zones: areas within 15% of structure range from swing high/low
- R:R quality scored against structural targets
- Pre-filters: `sk_zone_miss` (blocks if zone_distance_pct > 0.35) and `sk_bias_conflict`

**CVD Engine (`computeCVDFeatures`):**
- Estimates buy vs sell volume per bar from close position within range
- CVD divergence: price slope vs CVD slope conflict detection
- Buy/sell ratio, delta momentum, large delta bar detection
- Pre-filter: `cvd_not_ready` (blocks cvd_divergence setup if no divergence)

**Chart Overlay Events (`buildChartOverlay`):**
- Each detection produces a normalized `ChartOverlayEvent` payload
- Contains: ts, setup_type, direction, decision_type (TRADE/REJECTED/PASS), all scores, entry/SL/TP, labels, regime, sk_bias
- Ready for WebSocket emission to a live chart renderer

## Instruments

- MES, MNQ (futures)
- BTCUSDT, ETHUSDT (crypto)

## Sessions

- NY (13:00–22:00 UTC), London (07:00–13:00 UTC), Asian (00:00–07:00 UTC), Overnight

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/               # Express 5 API server
│   │   └── src/routes/
│   │       ├── signals.ts        # GET/POST /api/signals
│   │       ├── trades.ts         # GET/POST/PUT /api/trades
│   │       ├── performance.ts    # GET /api/performance
│   │       └── system.ts         # GET /api/system/status
│   └── godsview-dashboard/       # React + Vite frontend (previewPath: /)
│       └── src/pages/
│           ├── dashboard.tsx     # Mission Control — live pipeline status
│           ├── signals.tsx       # Signals feed with filters
│           ├── trades.tsx        # Trade journal
│           ├── performance.tsx   # Analytics: equity curve, win rate, PF, expectancy
│           └── system.tsx        # System health for all 6 layers
├── lib/
│   ├── api-spec/openapi.yaml     # OpenAPI 3.1 spec — single source of truth
│   ├── api-client-react/         # Generated React Query hooks
│   ├── api-zod/                  # Generated Zod schemas
│   └── db/src/schema/
│       ├── signals.ts            # signals table
│       └── trades.ts             # trades table
└── scripts/src/seed.ts           # Demo data seeder (60 signals, ~22 trades)
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. Run `pnpm run typecheck` from the root.

## Root Scripts

- `pnpm run build` — typecheck then build all packages
- `pnpm run typecheck` — full TypeScript check
- `pnpm --filter @workspace/api-spec run codegen` — regenerate React Query hooks + Zod schemas
- `pnpm --filter @workspace/db run push` — push DB schema changes
- `pnpm --filter @workspace/scripts run seed` — seed demo data

## Live Execution Stack

The execution stack enables real order placement, live position monitoring, and one-click signal-to-trade execution.

**Backend (`artifacts/api-server/src/lib/alpaca.ts`):**
- `placeOrder()` — submit market/limit bracket orders to Alpaca (paper or live)
- `getOrders()` — list open/closed orders
- `cancelOrder()`, `cancelAllOrders()` — cancel individual or all orders
- `closePosition()` — close an open position by symbol
- `getTypedPositions()` — typed positions with full P&L data
- `calcPositionSize()` — ATR-based risk calculator (equity × risk% / riskPerUnit)

**Execution API Routes:**
- `POST /api/alpaca/orders` — place a new order (market/limit, bracket, notional or qty)
- `GET /api/alpaca/orders` — list orders (status: open/closed/all)
- `DELETE /api/alpaca/orders/:id` — cancel an order
- `DELETE /api/alpaca/orders` — cancel all open orders
- `GET /api/alpaca/positions/live` — typed positions with live P&L
- `DELETE /api/alpaca/positions/:symbol` — close a position
- `GET /api/alpaca/size` — position size calculator endpoint

**Execution security controls (server env):**
- `GODSVIEW_ENABLE_LIVE_TRADING=true` is required for order/position write routes.
- `GODSVIEW_OPERATOR_TOKEN=<secret>` is required for write routes when trading is enabled.
- Provide token via `x-godsview-token` header (or `Authorization: Bearer <token>`).
- Dashboard write actions read token from browser localStorage key `godsview_operator_token`.
- `CORS_ORIGIN=https://your-frontend.example.com` (comma-separated list supported) restricts browser cross-origin access.

**ExecutionPanel (`artifacts/godsview-dashboard/src/components/ExecutionPanel.tsx`):**
- Account equity, buying power, cash stats (live from Alpaca)
- Signal context display (entry/SL/TP pre-filled from pipeline output)
- ATR-based position sizer with risk % slider
- Long/Short execution buttons → OrderTicket modal
- Two-step confirmation (Review → Confirm)
- Auto-records trade in journal on successful order submission
- Paper/live key detection with clear error messaging

**Execution Center (`trades.tsx` — 3-tab upgrade):**
- **Trade Journal tab** — full history with Record/Update flow
- **Live Positions tab** — polls every 5s, unrealized P&L, Close button
- **Orders tab** — open/closed/all filter, cancel individual or all orders

**Signal → Execute Flow:**
1. Run Scan Now on Live Intelligence page
2. Setup card appears with "Execute This Signal" button
3. Click → ExecutionPanel expands inline (pre-filled with entry/SL/TP)
4. Adjust risk % → position size auto-calculated
5. Click Long/Short → OrderTicket modal → Review → Confirm → order placed
6. Trade auto-recorded in journal, ExecutionPanel collapses

## API Endpoints

- `GET /api/signals` — list signals (params: limit, setup_type, instrument, status)
- `POST /api/signals` — create signal (auto-computes final_quality)
- `GET /api/signals/:id` — single signal
- `GET /api/trades` — list trades (params: limit, instrument, setup_type)
- `POST /api/trades` — record a trade
- `PUT /api/trades/:id` — update trade outcome/P&L
- `GET /api/performance` — analytics (win rate, profit factor, expectancy, equity curve, by-setup/session/regime)
- `GET /api/system/status` — live status of all 6 pipeline layers
- `POST /api/alpaca/orders` — place order
- `GET /api/alpaca/orders` — list orders
- `DELETE /api/alpaca/orders/:id` — cancel order
- `GET /api/alpaca/positions/live` — live positions with P&L
- `DELETE /api/alpaca/positions/:symbol` — close position
- `POST /api/alpaca/backtest-batch` — multi-symbol + multi-setup full-history matrix backtest

### Phase 3 — Order Book & Microstructure (real Alpaca data)
- `GET /api/orderbook/snapshot?symbol=BTCUSD&depth=25` — full order book snapshot (asks + bids, sorted)
- `GET /api/orderbook/stream?symbol=BTCUSD` — SSE stream of live order book updates (polls every 5s)
- `GET /api/market/microstructure?symbol=BTCUSD` — top-of-book metrics: spread, spreadBps, imbalance, absorption flags
- `GET /api/market/liquidity-zones?symbol=BTCUSD&bucket_pct=0.1&top_n=20` — clustered zones with strength 0–1

## Roadmap Implementation Status

| Phase | Title | Status |
|-------|-------|--------|
| 1 | Harden live price & candle updates | ✅ Done |
| 2 | Timeframe countdown timers | ✅ Done |
| 3 | Backend order book & microstructure | ✅ Done |
| 4 | TradingView embed + SK/CVD overlay + historical caching | ✅ Done |
| 5 | Reversal cloud | Pending |
| 6 | Per-candle bookmap metadata | Pending |
| 7 | Replay mode | Pending |
| 8 | Polish & production | Pending |

## Phase 9 — Historical Intelligence Upgrade (Completed)

- Backtest now fetches paginated full-history bars via `getBarsHistorical` (1m + 5m), not just a 1000-bar snapshot.
- Added `backtest_trace` payload in `POST /api/alpaca/backtest` with:
  - full bar trace (`bars`)
  - detected order blocks (`order_blocks`)
  - position trace (`positions`)
  - fake entry subset (`fake_entries`)
  - Claude historical reviews (`claude_reviews`)
- Added fake-entry labeling and fake-entry rate metrics (`fake_entry_rate`, `fake_entry_loss_rate`) to improve training feedback quality.
- Added optional Claude backtest review controls (`include_claude_history`, `claude_history_max`) and response metrics (`claude_reviewed_signals`, `claude_win_rate`).

## Phase 10 — Dashboard Core Robustness (Completed)

- Dashboard now reads `/api/system/diagnostics` continuously and computes a Core Robustness score.
- Added degraded/fallback UX on partial data failures (`Partial Data Mode` + live fallback polling).
- Added robust System Core summary panel (live/degraded/offline layer counts + top remediation action).
- Upgraded `/api/system/status` layer statuses from static-all-active to dynamic health states with key/Claude checks.

## Phase 11 — Multi-Symbol Matrix + All Charts (Completed)

- Added `POST /api/alpaca/backtest-batch` for full-history matrix backtesting across many symbols and setups in one run.
- Batch response now includes per-symbol best setup ranking, fake-entry rates, expectancy, P&L, and optional Claude sampled review stats.
- Live Intelligence page now supports an "All Charts Watchlist" TradingView grid driven by a shared symbol list.
- Added a new "Batch Matrix" tab to run and inspect matrix-learning results directly in the dashboard.

## Phase 1 & 2 Frontend Modules

- `artifacts/godsview-dashboard/src/lib/market/clock.ts` — candle boundary math (UTC, zero drift)
- `artifacts/godsview-dashboard/src/hooks/useCandleCountdown.ts` — React hook: `{ countdown, remaining, bucketStart, bucketEnd }`
- `artifacts/godsview-dashboard/src/components/LiveCandleChart.tsx` — Phase 1 hardened + Phase 2 countdown badge

### Phase 1 Hardening Summary
- SSE reconnect always calls latest `connectStream` via ref (no stale symbol/timeframe)
- `loadHistory` always clears spinner via `finally` block
- Supplement poll detects candle bucket roll-overs → opens new bar (not stale mutation)
- Per-session guard ID prevents messages from superseded ES connections

### Phase 2 Countdown Timer
- Placed at `right:68px, bottom:28px` — identical position to TradingView
- Colour-matched to live candle direction (green/red)
- Flashes when ≤ 10 s remain
- Driven by `useCandleCountdown` hook — pure wall-clock math, no drift

## Phase 3 Backend Modules

- `artifacts/api-server/src/lib/market/types.ts` — shared typed contracts (PriceLevel, OrderBookSnapshot, LiquidityZone, MicrostructureSnapshot)
- `artifacts/api-server/src/lib/market/orderbook.ts` — `OrderBookManager` singleton: REST polling + SSE broadcast
- `artifacts/api-server/src/lib/market/liquidityMap.ts` — `computeLiquidityZones`, `computeMicrostructure`, `computeDepthCurve`
- `artifacts/api-server/src/routes/orderbook.ts` — all four Phase 3 endpoints

## Packages

### `artifacts/api-server` (`@workspace/api-server`)
Express 5 API server. Routes in `src/routes/`. Uses `@workspace/api-zod` for validation and `@workspace/db` for persistence.

### `artifacts/godsview-dashboard` (`@workspace/godsview-dashboard`)
React + Vite frontend. Dark professional trading terminal theme. Uses `@workspace/api-client-react` React Query hooks for all data.

### `lib/db` (`@workspace/db`)
Drizzle ORM + PostgreSQL. Schema: `signals` and `trades` tables.

### `lib/api-spec` (`@workspace/api-spec`)
OpenAPI 3.1 spec + Orval codegen config.

### `scripts` (`@workspace/scripts`)
Utility scripts. `seed.ts` populates 60 demo signals and ~22 trades.
