# GodsView v2.3.0 — Phase 3 Handoff (Order Flow + Setup Detection + Paper Execution Gate)

**Release tag:** `v2.3.0`
**Branch:** `phase-3-orderflow-setup`
**Cut from:** `main` @ the v2.2.0 baseline (Phase 2 — market structure + MCP)
**Scope:** Order-flow ingest (depth snapshots + delta bars), delta/imbalance/
absorption detectors, setup detector library (six canonical setups), confidence
calibration + recall scaffolding, `/setups` surface, and the deterministic
paper-mode execution gate (`POST /setups/{id}/approve` + `/paper-trades`).

This document is the formal handoff for Phase 3. As of this tag the repo is
production-viable for the **operator surface + market-structure pipeline +
order-flow pipeline + setup detection + paper-mode execution**. Live execution
(broker integration, real risk engine) remains behind Phase 4+ gates.

---

## 1. What Shipped — PR Inventory

Phase 3 was executed as nine atomic PRs on the `phase-3-orderflow-setup`
branch. Each PR is a single commit that typechecks and tests green in isolation.

| PR  | Commit    | Scope |
|-----|-----------|-------|
| PR1 | `ef58855` | `@gv/types` order-flow + setup foundation (`DepthSnapshot`, `DeltaBar`, `Imbalance`, `Absorption`, `LiquidityWall`, `VolumeCluster`, `Setup`, `SetupType`, `SetupStatus`) |
| PR2 | `9c29f71` | `@gv/api-client` order-flow + setup endpoints (`api.orderflow`, `api.setups`) |
| PR3 | `e20a98e` | `control_plane` `/v1/orderflow/ingest` endpoint + `depth_snapshots` + `delta_bars` tables |
| PR4 | `eb21ad9` | Delta + imbalance + absorption detectors + wired `/v1/orderflow/events` and `/v1/orderflow/state` |
| PR5 | `accac84` | Setup detector library — six canonical setups (liquidity sweep + reclaim, OB retest, breakout + retest, FVG reaction, momentum continuation, session reversal) |
| PR6 | `12e26c3` | Setup confidence calibrator + recall scaffolding (`app.recall.store`, `app.recall.calibrator`) |
| PR7 | `59d4baf` | `/v1/setups` list + detail + detect + status routes |
| PR8 | `e10bd5a` | Setup → execution gate stub (paper mode) — `PaperTrade` model, pure gate, `/setups/{id}/approve`, `/paper-trades` |
| PR9 | _this PR_ | `v2.3.0` release handoff (this doc) + operator-clone mirror + tag |

---

## 2. Wired Pages

Phase 3 is primarily a backend + type-surface release. The web-side deliverable
is a **single wired page** that consumes the new `/v1/setups` endpoints:

- `/intel/setups` — Setup list view, filtered by symbol / status / type /
  timeframe. Uses the `api.setups.list` factory from `@gv/api-client` with
  TanStack Query v5 keys scoped by filter. Rows link to the existing
  `/market/symbols/[id]` page for context drill-down.

The left-nav slots for `/orderflow`, `/execution/paper-trades`, `/recall`, and
a dedicated `/setups/[id]` drill-down **remain reserved** for Phase 4, which
will promote the setup detail + paper-trade execution surface out of the
operator-only JSON view into a full trader UI. The backend contract for those
pages is frozen as of `v2.3.0` — the Phase 4 work is pure front-end wiring.

---

## 3. Backend Surface Changes (`services/control_plane`)

### 3.1 New Routes

| Verb   | Path                                | Auth     | Notes |
|--------|-------------------------------------|----------|-------|
| POST   | `/v1/orderflow/ingest`              | Admin    | Depth-snapshot + delta-bar ingest from the operator mux |
| GET    | `/v1/orderflow/events`              | Bearer   | Imbalance / absorption / liquidity-wall event feed |
| GET    | `/v1/orderflow/state`               | Bearer   | Point-in-time delta + imbalance snapshot per symbol |
| POST   | `/v1/setups/detect`                 | Admin    | Run the detector orchestrator over a symbol + TF window |
| GET    | `/v1/setups`                        | Bearer   | Paginated list; filters `symbolId`, `status`, `setupType`, `tf`, `fromTs`, `toTs` |
| GET    | `/v1/setups/{id}`                   | Bearer   | Single setup with order-flow evidence + recall matches |
| PATCH  | `/v1/setups/{id}/status`            | Admin    | Transition `detected → approved_paper | approved_live | rejected | expired` |
| POST   | `/v1/setups/{id}/approve`           | Admin    | Execution gate + paper-trade creation (Phase 3 = paper only) |
| GET    | `/v1/paper-trades`                  | Bearer   | Paginated; filters `symbolId`, `setupId`, `status`, `fromTs`, `toTs` |
| GET    | `/v1/paper-trades/{id}`             | Bearer   | Single paper-trade detail |
| PATCH  | `/v1/paper-trades/{id}/status`      | Admin    | FSM: `pending_fill → filled → won|lost|scratched`, `pending_fill|filled → cancelled` |

All eleven routes are registered through `app/routes/__init__.py` against
`COMMON_ERROR_RESPONSES + AUTH_ERROR_RESPONSES` so the OpenAPI spec matches the
runtime contract enforced by `contract-validation.yml`.

### 3.2 New Tables

Alembic migration added under `services/control_plane/alembic/versions/`:

- `20260419_0007_phase3_orderflow_ingest.py`

New tables:

- `depth_snapshots` — point-in-time L2 book per `(symbol_id, ts)` with
  `bids_json`, `asks_json`, `venue`. Index on `(symbol_id, ts DESC)` for
  fast state-rebuild.
- `delta_bars` — per `(symbol_id, tf, ts)` aggregates: `buy_volume`,
  `sell_volume`, `delta`, `cumulative_delta`, `vwap`, `value_area_high/low`.
  `UNIQUE (symbol_id, tf, ts)` covers re-ingestion idempotency.
- `setups` — detected setup rows: `id`, `symbol_id`, `tf`, `setup_type`,
  `direction`, `entry_ref`, `stop_loss`, `take_profit`, `confidence`,
  `status`, `expires_at`, `detected_at`, evidence JSON, recall-match JSON,
  audit columns. Indexes on `(symbol_id, status)` + `(status, detected_at DESC)`.
- `paper_trades` — PR8 execution output: `id`, `setup_id (FK)`,
  `symbol_id (FK)`, `direction`, `entry_ref`, `stop_loss`, `take_profit`,
  `size_multiplier`, `status`, `approved_at`, `approved_by_user_id`, `note`,
  `filled_at`, `closed_at`, `pnl_r`. Indexes on `setup_id`, `status`,
  `(symbol_id, status)`.

aiosqlite test harness continues to shim `JSONB → JSON` and `ARRAY(String) →
JSON`, so the same migrations run in CI without a Postgres instance.

### 3.3 New Detector / Engine Modules

| Module | Purpose |
|--------|---------|
| `app.orderflow.delta`         | Aggregate tick/quote stream → delta bars (per TF) |
| `app.orderflow.imbalance`     | Pure-function bid/ask size imbalance detector |
| `app.orderflow.absorption`    | Absorption + liquidity-wall event emitter |
| `app.orderflow.state`         | Point-in-time order-flow state reducer (cumulative delta, top-of-book skew) |
| `app.setups.types`            | Shared dataclasses (`SetupEvidence`, `ZoneRef`, `OrderflowRef`) |
| `app.setups.liquidity_sweep`  | Liquidity sweep + reclaim detector |
| `app.setups.ob_retest`        | Order-block retest detector |
| `app.setups.breakout_retest`  | Structural breakout + retest detector |
| `app.setups.fvg_reaction`     | Fair-value-gap reaction detector |
| `app.setups.momentum`         | Momentum-continuation detector |
| `app.setups.session_reversal` | Session-reversal detector (London/NY open) |
| `app.setups.orchestrator`     | Aggregates all six detectors + runs confidence calibration |
| `app.recall.store`            | Similarity-indexed setup memory (15-dim cosine fingerprint) |
| `app.recall.calibrator`       | Similarity-weighted win-rate confidence adjustment |
| `app.execution.gate`          | Pure deterministic paper-mode execution gate (10 enumerated reasons) |
| `app.routes.orderflow`        | Ingest + read routes for the order-flow surface |
| `app.routes.setups`           | Setup list / detail / detect / status routes |
| `app.routes.execution`        | `/setups/{id}/approve` + `/paper-trades` |

The execution gate is deliberately I/O-free (`GateInput` dataclass snapshot
pre-loaded by the route layer), so its 26 unit tests cover the full decision
matrix without a database. See `app/execution/gate.py` for the ordered rule
list (kill-switch → live-mode reject → setup state → duplicate trade → expiry
→ sizing → confidence → per-symbol cap → global cap).

---

## 4. Package Surface Changes

### `@gv/types` — 2 new modules

- `orderflow.ts` — `DepthSnapshot`, `DeltaBar`, `Imbalance`, `Absorption`,
  `LiquidityWall`, `VolumeCluster`, `OrderflowState`
- `setups.ts` — `Setup`, `SetupType` (`liquidity_sweep_reversal`, `ob_retest`,
  `breakout_retest`, `fvg_reaction`, `momentum_continuation`,
  `session_reversal`), `SetupStatus` (`detected`, `approved_paper`,
  `approved_live`, `filled`, `closed`, `expired`, `rejected`),
  `SetupEvidence`, `RecallMatch`, `PaperTrade`, `PaperTradeStatus`,
  `GateRejectionReason`

### `@gv/api-client` — 3 new endpoint factories

Exposed on the workspace singleton `api`:

- `api.orderflow` — ingest (admin), events, state
- `api.setups` — list, detail, detect, status PATCH, approve
- `api.paperTrades` — list, detail, status PATCH

All three factories reuse the existing bearer-token interceptor + Zod parse of
`@gv/types` models. camelCase wire payloads continue to match the backend
Pydantic v2 `populate_by_name=True` aliases.

### `@gv/ui`

- New `<SetupBadge>`, `<SetupTypePill>`, and `<GateRejectionTag>` primitives
  consumed by `/intel/setups` and earmarked for the Phase 4 setup detail page.

No `apps/web` breaking changes — all Phase 2 pages continue to render against
the unchanged `api.market` + `api.structure` factories.

---

## 5. Verification Matrix

Run from repo root unless noted.

| Check | Command | Status |
|-------|---------|--------|
| Workspace install | `corepack pnpm install --ignore-scripts` | PASS |
| `@gv/types` typecheck | `node node_modules/typescript/bin/tsc -p packages/types/tsconfig.json` | PASS |
| `@gv/api-client` typecheck | `node node_modules/typescript/bin/tsc -p packages/api-client/tsconfig.json` | PASS |
| `@gv/ui` typecheck | `node node_modules/typescript/bin/tsc -p packages/ui/tsconfig.json` | PASS |
| `@gv/web` typecheck | `cd apps/web && node ../../node_modules/typescript/bin/tsc --noEmit` | PASS |
| API server tests | `GODSVIEW_DATA_DIR=artifacts/api-server/.runtime corepack pnpm --filter @workspace/api-server run test` | PASS |
| control_plane order-flow suite | `cd services/control_plane && python -m pytest tests/test_orderflow.py tests/test_orderflow_detectors.py` | PASS |
| control_plane setup suite | `python -m pytest tests/test_setup_detectors.py tests/test_setups_api.py tests/test_recall.py` | PASS |
| control_plane execution suite | `python -m pytest tests/test_execution_gate.py tests/test_execution_api.py` | PASS — 46/46 |
| control_plane full suite (ex. tv_webhook) | `python -m pytest --ignore=tests/test_tv_webhook.py` | PASS — 322/322 |
| OpenAPI contract validation | `.github/workflows/contract-validation.yml` | GREEN on `phase-3-orderflow-setup` HEAD |

> `tests/test_tv_webhook.py` remains sandbox-excluded — the same aiosqlite
> `JSON not serializable for datetime` quirk documented in the Phase 2 handoff
> still reproduces on the Python 3.10 sandbox. The suite runs green in the
> GitHub Actions 3.11 / 3.12 matrix.

---

## 6. Fixes Landed Alongside Phase 3

Three surgical alignments were folded into the per-PR commits because they
were blocking the per-PR gate:

1. **PR4 — `delta_bars` `(symbol_id, tf, ts)` uniqueness.** Early PR4 drafts
   indexed on `(symbol_id, ts)` only, which let a 1m + 5m bar for the same
   timestamp collide. Migration was updated before merge.
2. **PR6 — Recall fingerprint numerical stability.** The 15-dim feature
   vector used raw ratios that could hit NaN on zero-volume bars; switched to
   `math.log1p(...)` normalisation with a fixed epsilon.
3. **PR8 — OpenAPI spec regeneration.** The contract test
   `test_committed_spec_matches_generated` failed after PR8 added
   `/setups/{id}/approve` + `/paper-trades`. Regenerated via
   `python -m app.scripts.dump_openapi` (with `DATABASE_URL` +
   `JWT_SIGNING_KEY` env set) and committed the refreshed
   `packages/api-client/openapi.json` in the same PR.

All three are pure alignment — no behavior change or schema break for
already-shipped data.

---

## 7. Known Quirks & Sandbox Notes

- **Python 3.10 sandbox vs 3.11+ production.** Same constraint as Phase 2.
  `app.setups.*` + `app.execution.*` routes import `app.models` which uses
  `from datetime import UTC`. Pure-function detectors + the execution gate
  itself run on 3.10 (the 26-test `test_execution_gate.py` suite completes in
  0.02s). Route-layer tests use the `gv_shim` sitecustomize hack to patch
  `datetime.UTC` in when needed.
- **`aiosqlite` JSON/JSONB/ARRAY shim.** Unchanged from Phase 2. All Phase 3
  migrations use `JSONB` + `ARRAY(String)` columns; the test harness rewrites
  them to `JSON` before running `upgrade head`.
- **Recall store process-local.** `app.recall.store` is in-memory per-process
  — a multi-pod rollout in Phase 4+ will need either a shared Redis backend
  or pgvector. The `RecallStore` interface is deliberately narrow
  (`upsert`, `top_k`, `record_outcome`) so the swap is route-layer-invisible.
- **Paper-trade FSM is strict.** Invalid transitions raise `409` with
  `code=invalid_transition`. Terminal states (`won`, `lost`, `scratched`,
  `cancelled`) cannot be re-opened — a human must create a new setup.
  Cancelled trades are still recorded to recall as a `scratched` outcome so
  the similarity-weighted calibrator still learns from them.
- **Kill-switch flag.** `execution.kill_switch` is a `system_config` row
  (Phase 1 PR4 surface). Flipping it on rejects **every** `/setups/{id}/approve`
  with `gate_kill_switch_active`; already-open paper trades can still be
  closed via PATCH.
- **`alembic upgrade head` gate.** Phase 3's single migration
  (`20260419_0007_phase3_orderflow_ingest`) is additive only — a Phase 2
  production database can run `alembic upgrade head` in-place without backfill.

---

## 8. What Phase 4 Inherits

- A green typecheck across all four workspaces.
- Nine new persisted tables, four of them net-new in Phase 3
  (`depth_snapshots`, `delta_bars`, `setups`, `paper_trades`).
- A full order-flow detector pipeline (`delta` → `imbalance` → `absorption`
  + `state`) feeding setup evidence.
- A six-strategy setup detector library with a unified orchestrator.
- A recall store + confidence calibrator that write outcomes back from
  terminal paper-trade closes.
- A deterministic paper-mode execution gate with 10 enumerated rejection
  reasons — ready to be promoted to a live-mode gate behind a Phase 4
  feature flag + risk engine.
- An `/intel/setups` page that lists live detector output, plus reserved
  slots for `/setups/[id]` + `/execution/paper-trades` awaiting Phase 4.
- A release branch + tag (`v2.3.0`) to diff against.

---

## 9. Phase 4 Entry Criteria

Per `docs/blueprint/09-phase-roadmap.md`:

> **Phase 4 — Execution + Risk Engine (Live).** Promote paper-mode to live
> via an Alpaca broker adapter, a real risk engine (position sizing, max
> daily drawdown, correlation limits, exposure caps), the Setup Detail page,
> the Paper-Trade Execution page, and the Trade Replay surface.

The Phase 4 PR series will follow the same nine-PR atomic pattern, starting
with:

- PR1 — `@gv/types` execution + risk models (`RiskBudget`, `Position`,
  `BrokerFill`, `LiveGateInput`, `AccountEquity`)
- PR2 — `@gv/api-client` execution + risk + broker endpoints
- PR3 — Alpaca broker adapter + paper-to-live mode flip
- PR4 — Risk engine (equity-scaled sizing, daily drawdown gate, correlation
  exposure cap)
- PR5 — Live execution gate (extends the paper gate with broker + risk
  preconditions behind `execution.live_enabled` flag)
- PR6 — `/setups/[id]` detail page (all Phase 3 evidence + recall matches +
  approve-to-paper + approve-to-live actions)
- PR7 — `/execution/paper-trades` + `/execution/live-trades` pages
- PR8 — Trade-replay surface wired to `bars` + `delta_bars` + `setups`
- PR9 — Phase 4 handoff + `v2.4.0` tag

---

## 10. Sign-Off

- **Build:** PASS — four workspaces clean `tsc --noEmit`; control_plane
  order-flow + setup + execution suites green (46/46 on execution alone,
  322/322 overall excluding the sandbox-only tv_webhook quirk).
- **Tests:** PASS — api-server suite unchanged; control_plane detector +
  API integration suites green in CI 3.11/3.12 matrix.
- **Readiness:** DEGRADED (expected — `SYSTEM_MODE=paper`; order-flow +
  setup detection + paper execution are now live, but live broker
  integration + the full risk engine remain behind Phase 4 gates).
- **Security:** `/v1/orderflow/ingest`, `POST /v1/setups/detect`, PATCH on
  setup and paper-trade status, and `POST /setups/{id}/approve` are all
  admin-only. `execution.kill_switch` can veto every approval. The pure
  execution gate rejects `mode="live"` unconditionally under
  `gate_live_disallowed` — Phase 4 must flip `execution.live_enabled` and
  extend the gate before any real capital is at risk.

Signed,
GodsView Phase 3 build train.
