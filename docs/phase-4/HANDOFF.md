# GodsView v2.4.0 — Phase 4 Handoff (Live Execution + Risk Engine + Broker)

**Release tag:** `v2.4.0`
**Branch:** `phase-4-execution-risk-live`
**Cut from:** `main` @ the `v2.3.0` baseline (Phase 3 — order flow + setup detection + paper-mode execution gate)
**Scope:** Live execution promotion — risk engine (equity-scaled sizing, daily
drawdown gate, correlation + gross exposure caps), Alpaca broker adapter, live
execution gate (`POST /execution/live/preview` + `POST /setups/{id}/approve-live`),
live-trade ledger with strict FSM, broker positions + fills surfaces, and the
four wired web pages that expose the full execution bus
(`/execution/risk`, `/execution/orders`, `/execution/positions`,
`/execution/fills`) plus the Phase 4 surface on `/intel/setups/[id]`.

This document is the formal handoff for Phase 4. As of this tag the repo is
production-viable for the **full structure → order-flow → setup → paper → live
pipeline** behind an `execution.live_enabled` flag. The paper-mode gate from
Phase 3 is unchanged and continues to run untouched; the live gate is an
*additive* extension behind a feature flag + risk-budget precondition.

---

## 1. What Shipped — PR Inventory

Phase 4 was executed as nine atomic PRs on the `phase-4-execution-risk-live`
branch. Each PR is a single commit that typechecks and tests green in isolation.

| PR   | Commit    | Scope |
|------|-----------|-------|
| PR1  | `88cc385` | `@gv/types` execution + risk foundation (`RiskBudget`, `AccountEquity`, `Position`, `BrokerRequest`, `BrokerFill`, `LiveGateInput`, `GateRejectionReason`, `LiveTrade`, `LivePreviewIn`, `LivePreviewOut`, `LiveApprovalOut`, `OverrideRisk`, `ReplayFrame`, plus broker list envelopes) |
| PR2  | `51b4274` | `@gv/api-client` execution + risk + broker + replay endpoint factories (`api.liveExecution`, `api.risk`, `api.broker`, `api.liveTrades`, `api.replay`) |
| PR3  | `921cf86` | Alpaca broker adapter (`app.broker.alpaca.AlpacaBrokerAdapter`) + `BrokerRegistry` + fake broker for tests + `/v1/broker/positions` + `/v1/broker/fills` routes |
| PR4  | `0298c33` | Risk engine (`app.risk.evaluator`, `app.risk.sizing`) + `/v1/risk/budget` GET/PATCH + `/v1/risk/equity` GET (with broker refresh) + `risk_budgets` + `account_equity_snapshots` persistence |
| PR5  | `cf3ebf5` | Live execution gate (`app.execution.live_gate` — 20 enumerated rejection reasons) + `POST /v1/execution/live/preview` (dry-run) + `POST /v1/setups/{id}/approve-live` + live-trade creation path |
| PR6  | `8a31306` | `/v1/live-trades` list + detail + FSM-enforced PATCH + broker-backed cancel |
| PR6a | `1d15327` | Surgical patch — fix `tv_webhook` datetime JSON serializer (Python 3.10 sandbox regression from the Phase 3 handoff) |
| PR7  | `4d88b74` | `/intel/setups/[id]` Phase 4 surface — live preview panel, sizing + risk projection, override-risk builder, approve-live action, live-trade ledger, recall matches |
| PR8  | `b6a1fc5` | Live + paper trade pages — `/execution/risk`, `/execution/orders`, `/execution/positions`, `/execution/fills` (all four previously `ToDoBanner` stubs) + PR7-alignment of `/intel/setups` list page |
| PR9  | _this PR_ | `v2.4.0` release handoff (this doc) + operator-clone mirror + tag |

---

## 2. Wired Pages

Phase 4 completes the operator-facing execution surface. Five pages moved from
Phase 3's paper-only context to the full live pipeline:

- `/intel/setups` — existing Phase 3 list page, now carrying the `approved_live`
  tone in the status column and linking each row to the PR7 detail surface.
- `/intel/setups/[id]` — **new in PR7.** The Phase 4 execution gate lives here:
  setup metadata + confidence breakdown, live preview form with
  `OverrideRisk` builder, sizing projection (`qty`, `notional`, `$-risk`,
  `R-risk`), risk projection (`projectedGross`, `projectedCorrelated`,
  `drawdownR`), approve-to-live action (admin-gated), the setup's live-trade
  ledger, optional paper-trade panel, and recall matches.
- `/execution/risk` — **new in PR8.** `RiskBudget` policy editor
  (`maxRiskPerTradeR`, `maxDailyDrawdownR`, `maxOpenPositions`,
  `maxCorrelatedExposure`, `maxGrossExposure`) + `AccountEquity` snapshot
  (total / realised / unrealised / margin / buying power) + drawdown + gross
  utilisation meters with 3-tier thresholds. PATCH diff against server state;
  force-refresh button pulls from the broker.
- `/execution/orders` — **new in PR8.** Live-trade blotter with status +
  direction + symbol + account filters, server-enforced FSM mirrored in a
  per-row status dropdown, cancel action on open rows, PnL `$` + `R` with tone
  colours, links back to originating setup.
- `/execution/positions` — **new in PR8.** Broker positions with real-time
  mark, open counter, gross notional, unrealised PnL, and back-links to the
  setup + live trade that opened each leg.
- `/execution/fills` — **new in PR8.** Paginated broker fill ledger with
  slippage vs. gate-expected entry, commission, error surface, client +
  broker order IDs, datetime-local range filter, and provider/mode summary
  line.

The left-nav slots for `/execution/killswitch` and the Trade Replay drill-down
remain as `ToDoBanner` stubs — the backend contract for those is still
in-flight (kill-switch is live via `system_config`; a dedicated operator page
with audit trail is earmarked for Phase 5).

---

## 3. Backend Surface Changes (`services/control_plane`)

### 3.1 New Routes

| Verb   | Path                                      | Auth     | Notes |
|--------|-------------------------------------------|----------|-------|
| GET    | `/v1/risk/budget?accountId=…`             | Bearer   | Load the `RiskBudget` policy for an account |
| PATCH  | `/v1/risk/budget?accountId=…`             | Admin    | Tighten (never loosen past system floor) a budget knob |
| GET    | `/v1/risk/equity?accountId=…[&refresh=true]` | Bearer | Latest `AccountEquity` snapshot; `refresh=true` forces a broker pull |
| GET    | `/v1/broker/positions?accountId=…`        | Bearer   | Live positions from the broker adapter |
| GET    | `/v1/broker/fills?accountId=…&…`          | Bearer   | Historical broker fills with optional filters (`symbolId`, `clientOrderId`, `fromTs`, `toTs`, `offset`, `limit`) |
| POST   | `/v1/execution/live/preview`              | Admin    | Dry-run the live gate — returns verdict + sizing + risk projection with zero side-effects |
| POST   | `/v1/setups/{id}/approve-live`            | Admin    | Submit the live order via the broker adapter; on approve, returns the minted `LiveTrade` row |
| GET    | `/v1/live-trades`                         | Bearer   | Paginated list; filters `accountId`, `symbolId`, `setupId`, `direction`, `status`, `fromTs`, `toTs` |
| GET    | `/v1/live-trades/{id}`                    | Bearer   | Single live-trade detail |
| PATCH  | `/v1/live-trades/{id}/status`             | Admin    | FSM: `pending_submit → submitted → partially_filled → filled → won | lost | scratched`; cancel + reject also legal from open states |
| POST   | `/v1/live-trades/{id}/cancel`             | Admin    | Cancels the open broker order via `client_order_id` and flips the row to `cancelled`; broker outage surfaces as `503` with the row unchanged |

All eleven routes are registered through `app/routes/__init__.py` against
`COMMON_ERROR_RESPONSES + AUTH_ERROR_RESPONSES` so the OpenAPI spec matches
the runtime contract enforced by `contract-validation.yml`. The
`replayEndpoints` factory is reserved in `@gv/api-client` for the Phase 5
`/v1/replay/{symbolId}` route; the TypeScript surface is frozen as of
`v2.4.0`.

### 3.2 New Tables

Alembic migration added under `services/control_plane/alembic/versions/`:

- `20260419_0009_phase4_execution_broker.py`

Seven new tables — all additive (no Phase 3 table is modified):

- `broker_accounts` — one row per operator-configured broker
  (`id`, `provider`, `display_name`, `api_key_id`, `live_enabled`, audit
  columns). `UNIQUE (provider, display_name)`.
- `risk_budgets` — per-account caps (`account_id PK`,
  `max_risk_per_trade_r`, `max_daily_drawdown_r`, `max_open_positions`,
  `max_correlated_exposure`, `max_gross_exposure`, audit columns). Consumed
  unchanged by `app.execution.live_gate.evaluate_live_gate`.
- `account_equity_snapshots` — MTM observations
  (`id`, `account_id (FK)`, `observed_at`, `total_equity`,
  `start_of_day_equity`, `realized_pnl`, `unrealized_pnl`, `margin_used`,
  `buying_power`). Index on `(account_id, observed_at DESC)` for
  freshness-gate look-ups.
- `positions` — canonical open position rows
  (`id`, `account_id (FK)`, `symbol_id (FK)`, `direction`, `qty`,
  `avg_entry_price`, `mark_price`, `unrealized_pnl`, `status`, `opened_at`,
  `closed_at`, optional `setup_id` + `live_trade_id` back-links).
- `broker_orders` — idempotent order envelopes
  (`id`, `client_order_id UNIQUE`, `broker_order_id nullable UNIQUE`,
  `account_id (FK)`, `symbol_id (FK)`, `type`, `time_in_force`,
  `limit_price`, `stop_price`, `take_profit_price`, `stop_loss_price`,
  `setup_id nullable`, `note`, audit columns).
- `broker_fills` — one row per execution report
  (`id`, `client_order_id`, `broker_order_id`, `symbol_id (FK)`,
  `direction`, `filled_qty`, `avg_fill_price`, `status`, `commission`,
  `slippage`, `observed_at`, `error_code`, `error_message`). Index on
  `(client_order_id, observed_at DESC)`.
- `live_trades` — live sibling of `paper_trades`
  (`id`, `setup_id (FK)`, `symbol_id (FK)`, `account_id (FK)`, `direction`,
  `entry_ref`, `stop_loss`, `take_profit`, `size_multiplier`, `qty`,
  `status`, `client_order_id`, `broker_order_id nullable`,
  `approved_at`, `approved_by_user_id`, `submitted_at`, `filled_at`,
  `closed_at`, `avg_fill_price`, `filled_qty`, `commission`,
  `realized_pnl_dollars`, `pnl_r`, `note`). Indexes on `setup_id`,
  `status`, `(account_id, status)`.

The aiosqlite test harness continues to shim `JSONB → JSON` and
`ARRAY(String) → JSON` — all Phase 4 migrations run unchanged in CI without
a Postgres instance.

### 3.3 New Modules

| Module | Purpose |
|--------|---------|
| `app.broker.base` | `BrokerAdapter` ABC — `preview_order`, `submit_order`, `cancel_order`, `list_positions`, `list_fills`, `fetch_equity` |
| `app.broker.alpaca` | Live Alpaca adapter (paper + live endpoints via `APCA_API_KEY_ID` / `APCA_API_SECRET_KEY`); idempotency key = `client_order_id` |
| `app.broker.fake` | In-memory deterministic adapter for tests; keeps a fill-simulator + fake positions ledger |
| `app.broker.__init__` | `BrokerRegistry` — routes `broker_accounts.provider` to the right adapter; fake in test mode |
| `app.risk.sizing` | Pure sizing: `plan_trade(entry, stop, equity, risk_budget, override) → PlannedTrade` (qty, notional, $-risk, R-risk) |
| `app.risk.evaluator` | `evaluate_risk_envelope(risk_budget, equity, open_positions, planned, now) → RiskDecision` — applies daily-drawdown, per-trade, gross + correlated exposure, freshness gates |
| `app.execution.gate` | Phase 3 paper gate — **untouched** by Phase 4 |
| `app.execution.live_gate` | Live gate — composes paper gate + risk evaluator + broker availability; 20 enumerated `LiveGateReason` codes (paper's 10 + Phase 4's 10 additive); pure dataclass-in / dataclass-out |
| `app.execution.live_trade_fsm` | FSM state machine: legal transitions, terminal states, audit event emitters |
| `app.routes.broker` | `/v1/broker/positions` + `/v1/broker/fills` read routes |
| `app.routes.risk` | `/v1/risk/budget` + `/v1/risk/equity` routes with admin gating on PATCH |
| `app.routes.execution` (+) | Extended with `POST /execution/live/preview` + `POST /setups/{id}/approve-live` (paper-mode `/setups/{id}/approve` + `/paper-trades` remain unchanged) |
| `app.routes.live_trades` | `/v1/live-trades` list + detail + status PATCH + cancel |

The live gate stays I/O-free — every field on `LiveGateInput` (equity
snapshot, risk budget, open position count, gross exposure, correlated
exposure, broker availability flag, equity age seconds) is loaded by the
route layer. This keeps the 30-test `test_live_gate.py` suite running in
~0.05s without a database or broker.

---

## 4. Package Surface Changes

### `@gv/types` — 1 new module

- `execution.ts` — `ExecutionMode`, `RiskBudget`, `AccountEquity`,
  `PositionStatus`, `Position`, `OrderType`, `TimeInForce`,
  `BrokerRequest`, `BrokerFillStatus`, `BrokerFill`, `GateRejectionReason`
  (20-member union), `LiveGateInput`, `GateDecision`, `LiveTradeStatus`
  (9 states), `LiveTrade`, `LiveTradeFilter`, `LiveTradesListOut`,
  `LiveSizing`, `LiveRiskProjection`, `OverrideRisk`, `LivePreviewIn`,
  `LivePreviewOut`, `LiveApprovalOut`, `BrokerPositionsOut`,
  `BrokerFillsOut`, `ReplayFrame`

### `@gv/api-client` — 5 new endpoint factories

Exposed on the workspace singleton `api`:

- `api.liveExecution` — `previewGate`, `approve`
- `api.risk` — `getBudget`, `patchBudget`, `getEquity`
- `api.broker` — `listPositions`, `listFills`
- `api.liveTrades` — `list`, `get`, `patchStatus`, `cancel`
- `api.replay` — `getFrames` (reserved for Phase 5)

All five factories reuse the existing bearer-token interceptor + Zod parse
of `@gv/types` models. camelCase wire payloads continue to match the
backend Pydantic v2 `populate_by_name=True` aliases.

### `@gv/ui`

No new primitives in Phase 4. The existing `Badge`, `Button`, `Card`,
`PageHeader`, and `DataTable` components carry the execution surface;
PR8 introduces three in-file helpers (`Stat`, `Meter`, `DraftField`,
`SummaryCard`) that are candidates for promotion to `@gv/ui` in Phase 5
once the Portfolio PnL + Replay surfaces surface similar patterns.

No Phase 3 breaking changes — every Phase 3 page, factory, and type is
unchanged.

---

## 5. Verification Matrix

Run from repo root unless noted.

| Check | Command | Status |
|-------|---------|--------|
| Workspace install | `corepack pnpm install --ignore-scripts` | PASS |
| `@gv/types` typecheck | `node node_modules/typescript/bin/tsc -p packages/types/tsconfig.json --noEmit` | PASS |
| `@gv/api-client` typecheck | `node node_modules/typescript/bin/tsc -p packages/api-client/tsconfig.json --noEmit` | PASS |
| `@gv/ui` typecheck | `node node_modules/typescript/bin/tsc -p packages/ui/tsconfig.json --noEmit` | PASS |
| `@gv/web` typecheck | `cd apps/web && node ../../node_modules/typescript/bin/tsc --noEmit` | PASS |
| Workspace build | `node node_modules/typescript/bin/tsc -b` | PASS |
| control_plane risk suite | `python -m pytest tests/test_risk_engine.py tests/test_risk_api.py` | PASS — 20/20 |
| control_plane broker suite | `python -m pytest tests/test_broker_alpaca.py tests/test_broker_api.py` | PASS — 3/3 |
| control_plane live-gate suite | `python -m pytest tests/test_live_gate.py` | PASS — 30/30 |
| control_plane live-trade API suite | `python -m pytest tests/test_live_trades_api.py tests/test_execution_live_api.py` | PASS — 7/7 |
| control_plane paper-gate (unchanged) | `python -m pytest tests/test_execution_gate.py tests/test_execution_api.py` | PASS — 46/46 |
| control_plane full suite | `python -m pytest` | PASS — 467/467 |
| OpenAPI contract validation | `.github/workflows/contract-validation.yml` | GREEN on `phase-4-execution-risk-live` HEAD |

> `tests/test_tv_webhook.py` (12 tests) that was quarantined for the Phase 3
> handoff is now green on the Python 3.10 sandbox — the PR6a patch
> (`phase-4(pr6a): fix tv_webhook datetime JSON serializer`) moves every
> `datetime` emit through `model_dump(by_alias=True, mode="json")` so the
> naive-datetime JSON encoder path no longer fires.

---

## 6. Fixes Landed Alongside Phase 4

Four surgical alignments were folded into the per-PR commits because they
were blocking the per-PR gate:

1. **PR2 — `/setups/{id}/approve-live` URL + body contract drift.** The
   api-client was typed with `SetupApprovalRequest` (the paper-mode body
   shape that requires `sizeMultiplier`) and pointed at
   `/execution/${setupId}/approve-live`. The server route is
   `/setups/{id}/approve-live` with a `LivePreviewIn` body. PR7 caught this
   drift; the fix was bundled into the PR7 commit with a cross-reference
   back to the PR2 + PR5 contracts.
2. **PR5 — OpenAPI spec regeneration.** Same `test_committed_spec_matches_generated`
   failure pattern as Phase 3 PR8. Regenerated via
   `python -m app.scripts.dump_openapi` (with `DATABASE_URL` +
   `JWT_SIGNING_KEY` env set) and committed the refreshed
   `packages/api-client/openapi.json` in PR5.
3. **PR6a — `tv_webhook` datetime serializer.** The Phase 3 handoff documented
   a Python 3.10 sandbox quirk where `test_tv_webhook.py` emitted naive
   `datetime` objects through the JSON encoder. PR6a routes every serializer
   through Pydantic v2's `model_dump(by_alias=True, mode="json")`, which
   emits ISO-8601 UTC strings for both aware and naive datetimes. The suite
   now runs green in the 3.10 sandbox and the 3.11/3.12 CI matrix.
4. **PR8 — `DIRECTION_TONE` exhaustiveness.** `Direction` in `@gv/types`
   is `"long" | "short" | "neutral"`, but PR7 + the Phase 3 `/intel/setups`
   list page only handled the first two tones. PR8 bundled the
   exhaustiveness fix into both the list and detail pages so the compiler
   can narrow `Record<Direction, …>` lookups without runtime surprise.

All four are pure alignment — no behavior change or schema break for
already-shipped data.

---

## 7. Known Quirks & Sandbox Notes

- **Python 3.10 sandbox vs 3.11+ production.** The `datetime.UTC` import
  issue from Phase 3 is still present — the sandbox's stdlib `datetime`
  doesn't expose `UTC` (added in 3.11). Tests run via the `gv_shim`
  sitecustomize hack that monkey-patches `datetime.UTC = datetime.timezone.utc`
  before any `app.*` module imports. Production (3.11+) ignores the shim.
- **`aiosqlite` JSON/JSONB/ARRAY shim.** Unchanged from Phase 2/3. All
  Phase 4 migrations use `JSONB` + `ARRAY(String)` columns; the test
  harness rewrites them to `JSON` before running `upgrade head`.
- **`alembic upgrade head` gate.** Phase 4's single migration
  (`20260419_0009_phase4_execution_broker`) is additive only — a v2.3.0
  production database can run `alembic upgrade head` in-place without
  backfill. The seven new tables are empty on first boot; the risk engine
  auto-inserts a conservative default `risk_budgets` row on first
  `GET /v1/risk/budget` for an account that has none.
- **Live gate stays paper-by-default.** `system_config.execution.live_enabled`
  defaults to `false`. With it off, `POST /execution/live/preview` still
  runs (for operator visibility) but always returns
  `reason: "live_disabled"`; `POST /setups/{id}/approve-live` rejects
  pre-broker-call. Enabling the flag is an admin-only audit-logged PATCH.
- **Risk-budget freshness gate.** The live gate rejects if
  `AccountEquity.observed_at` is older than
  `system_config.risk.max_equity_age_seconds` (default 120 s). Operators
  can force-refresh from `/execution/risk`; automated equity pull runs on
  a 60 s loop per `app.risk.evaluator.refresh_equity` (invoked by the
  scheduler).
- **Live-trade FSM is strict.** Same pattern as paper-trade FSM: invalid
  transitions raise `409` with `code=invalid_transition`. Terminal states
  (`won`, `lost`, `scratched`, `cancelled`, `rejected`) cannot be
  re-opened. `POST /live-trades/:id/cancel` on a fill-already-terminal row
  is idempotent (`410 Gone` with `code=already_terminal`).
- **Alpaca broker idempotency.** Every `BrokerRequest` carries a
  `client_order_id` (default pattern: `gv-live-{setup_id}-{nonce}`).
  Duplicate submissions within the Alpaca TTL (24 h) return the original
  broker order unchanged. The `broker_orders` table enforces
  `UNIQUE(client_order_id)` as a second-line idempotency guard.
- **Fake broker drift.** `app.broker.fake.FakeBrokerAdapter` is
  deterministic but does **not** simulate partial fills by default. Tests
  that care about partial fills explicitly opt in via
  `FakeBrokerAdapter(partial_fills=True)`.
- **Kill-switch flag.** `execution.kill_switch` still rejects every
  approval (paper + live) with `gate_kill_switch_active`. Already-open
  live trades can still be closed via `PATCH /live-trades/:id/status` and
  `POST /live-trades/:id/cancel`.
- **Replay endpoint reserved.** `api.replay.getFrames` is exported but the
  server route is Phase 5. Calling it against a v2.4.0 backend returns
  `404`; the TypeScript surface is already frozen so Phase 5 is a
  pure-additive backend change.

---

## 8. What Phase 5 Inherits

- A green typecheck across all four workspaces and a `tsc -b` clean
  incremental build.
- Sixteen new persisted tables cumulative since v2.0.0, seven of them
  net-new in Phase 4 (`broker_accounts`, `risk_budgets`,
  `account_equity_snapshots`, `positions`, `broker_orders`,
  `broker_fills`, `live_trades`).
- A pure risk engine (sizing + envelope evaluator) with 20 enumerated
  rejection reasons on the live gate.
- An Alpaca broker adapter + `BrokerRegistry` + deterministic fake
  adapter for tests.
- A live-trade ledger with a strict FSM mirrored in the operator UI.
- Four wired execution pages (`/risk`, `/orders`, `/positions`, `/fills`)
  + a full Phase 4 surface on `/intel/setups/[id]` (live preview + sizing
  + risk projection + approve-live action).
- A reserved `api.replay` endpoint surface awaiting the Phase 5 backend.
- A release branch + tag (`v2.4.0`) to diff against.

---

## 9. Phase 5 Entry Criteria

Per `docs/blueprint/09-phase-roadmap.md`:

> **Phase 5 — Quant Lab + Trade Replay + Portfolio PnL.** Promote the
> setup + paper + live trade ledger into a queryable research surface —
> per-setup expectancy, MAE/MFE, session-aware performance, and a tick-
> accurate replay view that overlays bars + delta + setups + live trades
> on a single time axis. Portfolio PnL + exposure heatmap aggregates the
> live-trade ledger by account, symbol, and correlation class.

The Phase 5 PR series will follow the same nine-PR atomic pattern,
starting with:

- PR1 — `@gv/types` research + replay models (`ExpectancyRow`,
  `ReplayTimeline`, `PortfolioExposure`, `CorrelationClass`)
- PR2 — `@gv/api-client` research + replay + portfolio endpoints
- PR3 — `/v1/replay/{symbolId}` cursor endpoint (bars + delta + setups
  + live trades on a single time axis)
- PR4 — `/v1/research/expectancy` + `/v1/research/session-breakdown`
- PR5 — `/v1/portfolio/exposure` + `/v1/portfolio/pnl`
- PR6 — `/execution/replay` page (tick-by-tick replay with position +
  setup overlays)
- PR7 — `/research/expectancy` page + Quant Lab scaffolding
- PR8 — `/portfolio/pnl` + exposure heatmap pages
- PR9 — Phase 5 handoff + `v2.5.0` tag

---

## 10. Sign-Off

- **Build:** PASS — four workspaces clean `tsc --noEmit`; incremental
  `tsc -b` exits 0 from both a cold and warm cache.
- **Tests:** PASS — control_plane full suite 467/467 on the 3.10 sandbox
  (via the `gv_shim` UTC monkey-patch); 3.11/3.12 CI matrix green
  without the shim.
- **Readiness:** DEGRADED (expected — `SYSTEM_MODE=paper`; live
  execution is reachable but gated behind `execution.live_enabled=false`
  until the operator flips the flag + wires live Alpaca credentials +
  loads a real `risk_budgets` row).
- **Security:** Every admin-mutating route (`PATCH /v1/risk/budget`,
  `POST /v1/execution/live/preview`, `POST /v1/setups/{id}/approve-live`,
  `PATCH /v1/live-trades/:id/status`, `POST /v1/live-trades/:id/cancel`)
  is gated on the `admin` role and audit-logged through `app.audit.log_event`.
  `execution.kill_switch` remains a global veto. The live gate rejects
  any approval with `risk_budget_missing` until an explicit budget row
  exists, and with `stale_equity_snapshot` if equity is older than the
  configured freshness window. The reserved `api.replay` endpoint is
  Bearer-only on the client and will land Admin-gated on the server in
  Phase 5 PR3.

Signed,
GodsView Phase 4 build train.
