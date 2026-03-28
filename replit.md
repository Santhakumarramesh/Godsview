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

## API Endpoints

- `GET /api/signals` — list signals (params: limit, setup_type, instrument, status)
- `POST /api/signals` — create signal (auto-computes final_quality)
- `GET /api/signals/:id` — single signal
- `GET /api/trades` — list trades (params: limit, instrument, setup_type)
- `POST /api/trades` — record a trade
- `PUT /api/trades/:id` — update trade outcome/P&L
- `GET /api/performance` — analytics (win rate, profit factor, expectancy, equity curve, by-setup/session/regime)
- `GET /api/system/status` — live status of all 6 pipeline layers

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
