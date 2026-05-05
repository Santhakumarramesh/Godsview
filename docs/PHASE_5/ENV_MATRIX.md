# Environment Variable Matrix — Phases 1–5

Every env var introduced or relied upon by the Phase 1–5 code. Format: `VAR_NAME` — default — type — purpose — conflict notes.

The intent is: one place a deploy operator can read to fully understand the production knobs without grepping the codebase.

## 1. Runtime + transport

| Var | Default | Type | Purpose |
|---|---|---|---|
| `NODE_ENV` | (unset) | `production` / `development` | gates pino transport, error verbosity |
| `PORT` | (required) | int | TCP port the API server binds |
| `HTTP_PORT` | `80` | int | Public nginx port |
| `LOG_LEVEL` | `info` | `trace`/`debug`/`info`/`warn`/`error` | pino verbosity |
| `GODSVIEW_TRUST_PROXY` | `true` | bool | trust X-Forwarded-* headers when behind nginx |
| `CORS_ORIGIN` | (required in prod) | comma-separated origins | dashboard CORS allowlist |

## 2. Database + cache

| Var | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | (required) | Postgres connection URI |
| `POSTGRES_PASSWORD` | (must change) | password used by the docker-compose Postgres |
| `DB_POOL_MAX` | `10` | max pg connections |
| `DB_EXTERNAL_PORT` | `5432` | host port mapping (set unique if running multiple stacks on one host) |
| `REDIS_URL` | (empty → in-process LRU fallback) | redis URI for distributed cache |
| `MEMORY_STORE_PATH` | `/data/memory` (prod) / `/tmp/godsview-memory` (dev) | file persistence path; mount EBS in EC2 |

## 3. Broker (Alpaca)

| Var | Default | Purpose |
|---|---|---|
| `ALPACA_API_KEY` | (required) | broker key |
| `ALPACA_SECRET_KEY` | (required) | broker secret |
| `ALPACA_BASE_URL` | `https://paper-api.alpaca.markets` | switch to `https://api.alpaca.markets` for live |

## 4. Phase 3 — system mode + execution choke point

| Var | Default | Purpose |
|---|---|---|
| `GODSVIEW_SYSTEM_MODE` | `paper` | one of `demo` / `paper` / `live_disabled` / `live_enabled`. Only `paper` and `live_enabled` allow order writes. |
| `GODSVIEW_ENABLE_LIVE_TRADING` | `false` | legacy alias; if `true` and `GODSVIEW_SYSTEM_MODE` is unset, mode resolves to `live_enabled` |
| `GODSVIEW_OPERATOR_TOKEN` | (required for live) | secret required on every order request when `GODSVIEW_SYSTEM_MODE=live_enabled` |
| `GODSVIEW_KILL_SWITCH` | `false` | persistent kill switch state at boot |

## 5. Phase 3 — risk pipeline gates

These are read by `lib/risk/risk_snapshot.ts` and consumed by every order through `executeOrder()`.

| Var | Default | Purpose |
|---|---|---|
| `GODSVIEW_MAX_DATA_AGE_MS` | `30000` | data_staleness gate: block if latest tick is older than this |
| `GODSVIEW_MAX_DAILY_LOSS_PCT` | `2` | daily_loss_limit gate: block when realized loss ≥ N% of equity |
| `GODSVIEW_MAX_CONCURRENT_POSITIONS` | `1` | max_exposure gate: max simultaneously open positions |
| `GODSVIEW_MAX_TRADES_PER_DAY` | `3` | max_exposure gate: max NEW positions opened per UTC day |

### Conflicts to be aware of

The pre-existing `.env.example` ships these legacy names which are NOT read by Phase 3 code:

| Legacy var | Status |
|---|---|
| `GODSVIEW_MAX_DAILY_LOSS_USD` | **NOT READ** by Phase 3 pipeline. Use `GODSVIEW_MAX_DAILY_LOSS_PCT` instead. |
| `GODSVIEW_MAX_RISK_PER_TRADE_PCT` | NOT a Phase 3 gate; the strategy module does not enforce it (per-trade risk lives in the position sizer). |
| `GODSVIEW_MAX_OPEN_EXPOSURE_PCT` | NOT a Phase 3 gate. Phase 3 uses absolute counts only. |
| `GODSVIEW_MAX_TRADES_PER_SESSION` | NOT a Phase 3 gate. Use `GODSVIEW_MAX_TRADES_PER_DAY`. |
| `GODSVIEW_COOLDOWN_AFTER_LOSSES` / `GODSVIEW_COOLDOWN_MINUTES` | enforced elsewhere in `risk_engine.ts`; Phase 3 pipeline does not see them. They're additive — they can still kick in via the existing `risk_engine` snapshot. |
| `GODSVIEW_BLOCK_ON_DEGRADED_DATA` | read by `risk_engine`; Phase 3's data_staleness gate is the canonical replacement, but both can coexist. |
| `GODSVIEW_ALLOW_SESSION_*` | read by `risk_engine`; Phase 3's session gate consumes `risk_engine.isSessionAllowed()`, so these still apply. |
| `GODSVIEW_NEWS_LOCKOUT_ACTIVE` | read by `risk_engine`; consumed by Phase 3's news_lockout gate. |

**Recommendation:** keep both sets in `.env`. The Phase 3 names are authoritative for the pipeline gates; the legacy names retain meaning for the older `risk_engine` paths and downstream consumers.

## 6. Phase 4 — paper-trade proof system

| Var | Default | Purpose |
|---|---|---|
| `GODSVIEW_PAPER_STARTING_EQUITY` | `10000` | baseline equity for the equity-curve endpoint |

## 7. Phase 5 — reconciliation + data health

| Var | Default | Purpose |
|---|---|---|
| `GODSVIEW_RUN_RECONCILER` | `false` | opt-in to start the orphan reconciler background job |
| `GODSVIEW_RECONCILER_INTERVAL_MS` | `300000` (5 min) | tick interval for the reconciler |
| `GODSVIEW_RUN_DATA_HEALTH` | `false` | opt-in to start the data integrity background job |
| `GODSVIEW_DATA_HEALTH_INTERVAL_MS` | `60000` (1 min) | tick interval for the integrity job |

## 8. Other operational

| Var | Default | Purpose |
|---|---|---|
| `GODSVIEW_RATE_LIMIT_WINDOW_MS` | `60000` | API rate limit window |
| `GODSVIEW_RATE_LIMIT_MAX` | `300` | max requests per window per IP |
| `GODSVIEW_REQUEST_TIMEOUT_MS` | `45000` | per-request timeout |
| `GODSVIEW_KEEPALIVE_TIMEOUT_MS` | `65000` | keepalive timeout |
| `GODSVIEW_SHUTDOWN_TIMEOUT_MS` | `20000` | graceful shutdown grace |
| `GODSVIEW_REQUEST_BODY_LIMIT` | `1mb` | max JSON body |

## 9. Recommended production `.env` for single EC2 + paper mode

```bash
NODE_ENV=production
PORT=3001
HTTP_PORT=80
LOG_LEVEL=info
CORS_ORIGIN=https://yourdomain.com
GODSVIEW_TRUST_PROXY=true

DATABASE_URL=postgresql://godsview:CHANGE_ME@postgres:5432/godsview
POSTGRES_PASSWORD=CHANGE_ME
DB_POOL_MAX=10

REDIS_URL=redis://redis:6379
MEMORY_STORE_PATH=/data/memory

ALPACA_API_KEY=PK...
ALPACA_SECRET_KEY=...
ALPACA_BASE_URL=https://paper-api.alpaca.markets

GODSVIEW_SYSTEM_MODE=paper
GODSVIEW_OPERATOR_TOKEN=$(openssl rand -hex 32)

# Phase 3 risk gates (paper-mode defaults match user spec)
GODSVIEW_MAX_DATA_AGE_MS=30000
GODSVIEW_MAX_DAILY_LOSS_PCT=2
GODSVIEW_MAX_CONCURRENT_POSITIONS=1
GODSVIEW_MAX_TRADES_PER_DAY=3

# Phase 4 proof system
GODSVIEW_PAPER_STARTING_EQUITY=10000

# Phase 5 background jobs (enable in production)
GODSVIEW_RUN_RECONCILER=true
GODSVIEW_RECONCILER_INTERVAL_MS=300000
GODSVIEW_RUN_DATA_HEALTH=true
GODSVIEW_DATA_HEALTH_INTERVAL_MS=60000
```
