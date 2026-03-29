# Godsview

Godsview is an AI-assisted order-flow trading terminal for discretionary traders.  
It filters trade opportunities with structure-first gating, order-flow confirmation, historical pattern recall, probabilistic scoring, and hard risk controls.

## Product Scope (V1)

Primary user: discretionary intraday trader (crypto/futures style workflow).  
Primary promise: better trade selection, stricter trade blocking, and explainable execution decisions.

## Core Workflow

1. Connect market data and broker keys.
2. Choose watchlist/symbols.
3. Configure risk rails (loss limits, exposure, session allowlist, news lockout).
4. Run scan (`/api/alpaca/analyze`).
5. Review approved/rejected setups with reasons.
6. Execute (paper/live mode policy controlled).
7. Review audit + performance and iterate.

## Decision Stack

- `SK Structure`: location and bias context.
- `Order Flow`: CVD/divergence/absorption style confirmation.
- `Recall`: historical pattern similarity and regime context.
- `ML`: probability estimation from historical outcomes.
- `Claude`: reasoning veto/adjustment layer.
- `Risk Engine`: hard blockers before execution.

Final quality score:

`0.30 * structure + 0.25 * orderFlow + 0.20 * recall + 0.15 * ml + 0.10 * claude`

## Hard Risk Rails (Implemented)

- Kill switch blocks all trading writes.
- Max daily realized loss.
- Max open exposure.
- Max concurrent positions.
- Max trades per session.
- Cooldown after loss streak.
- Degraded-data block policy.
- Session allowlist (`Asian/London/NY`).
- Runtime news lockout gate.

Decision states are standardized across logs/routes/UI:

- `TRADE`
- `PASS`
- `REJECTED`
- `BLOCKED_BY_RISK`
- `DEGRADED_DATA`

## System Modes

`GODSVIEW_SYSTEM_MODE`:

- `demo`
- `paper`
- `live_disabled`
- `live_enabled`

Writes are only allowed when mode policy permits and kill switch is off.

## Repo Layout

- `artifacts/api-server`: Express API + strategy/risk/execution routes.
- `artifacts/godsview-dashboard`: React/Vite dashboard.
- `lib/strategy-core`: shared setup catalog, scoring, mode/risk rule helpers.
- `lib/db`: Drizzle schema + DB layer.
- `scripts`: seeds and support scripts.

## Local Setup

```bash
corepack pnpm install
corepack pnpm run setup
corepack pnpm run dev
```

Build and run:

```bash
corepack pnpm run build
corepack pnpm run start
```

## Environment

Copy `.env.example` to `.env` and set keys.

Key runtime controls:

- `GODSVIEW_SYSTEM_MODE`
- `GODSVIEW_KILL_SWITCH`
- `GODSVIEW_MAX_DAILY_LOSS_USD`
- `GODSVIEW_MAX_OPEN_EXPOSURE_PCT`
- `GODSVIEW_MAX_TRADES_PER_SESSION`
- `GODSVIEW_COOLDOWN_AFTER_LOSSES`
- `GODSVIEW_COOLDOWN_MINUTES`
- `GODSVIEW_BLOCK_ON_DEGRADED_DATA`
- `GODSVIEW_ALLOW_SESSION_ASIAN`
- `GODSVIEW_ALLOW_SESSION_LONDON`
- `GODSVIEW_ALLOW_SESSION_NY`
- `GODSVIEW_NEWS_LOCKOUT_ACTIVE`

## Production Readiness Focus

Current implementation prioritizes:

- deterministic trade gating,
- observable audit trails,
- measurable performance outputs,
- strict mode/risk controls,
- fail-fast runtime config validation,
- graceful shutdown and startup bootstrapping,
- request safety (security headers, body limits, API rate limits),
- dedicated liveness/readiness probes.

Operational endpoints:

- `/api/healthz` (liveness)
- `/api/readyz` (readiness with DB + mode/dependency checks)

Next recommended milestones:

1. Expand proof dashboard with stronger out-of-sample reporting.
2. Add replay UI for orderbook and decision attribution.
3. Add operator runbooks for incident response and rollback.
4. Add onboarding defaults and tighter product packaging.

## Disclaimer

This software is for research and trading-assistance workflows. It does not guarantee profitability. Always use paper mode before any live execution.

## Architecture Doc

Detailed production architecture and phase plan:

- [docs/market-ready-architecture.md](./docs/market-ready-architecture.md)
- [docs/production-runbook.md](./docs/production-runbook.md)
- [docs/brain-schema.md](./docs/brain-schema.md)

## OpenBB Research Integration

A Python-side OpenBB research and paper-execution scaffold is included at:

- [godsview-openbb/README.md](./godsview-openbb/README.md)

It provides a separate workflow for:

- OpenBB-first historical data ingestion
- feature engineering + ML training
- inference + filter + risk checks
- optional Alpaca paper order submission
- multi-agent orchestration with persistent brain memory

Bridge endpoint in API:

- `GET /api/research/openbb/latest` (reads generated artifacts from `godsview-openbb/data/processed`)

Brain memory endpoints:

- `POST /api/brain/entities`
- `POST /api/brain/relations`
- `POST /api/brain/memories`
- `GET /api/brain/:symbol/context`
