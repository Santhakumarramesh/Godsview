# GodsView v2.2.0 — Phase 2 Handoff (Market Structure Engine + MCP)

**Release tag:** `v2.2.0`
**Branch:** `phase-2-market-structure-mcp`
**Cut from:** `main` @ the v2.1.0 baseline (Phase 1 — operator surface)
**Scope:** Market data ingest + structure intelligence — TradingView webhook
ingestion with HMAC verification, Symbols + Bars persistence, BOS/CHOCH/OB/FVG
detection, multi-timeframe fusion, Market Symbols UI, and live-quote WebSocket
bridge.

This document is the formal handoff for Phase 2. The repo is production-viable
for the **operator surface + market-structure pipeline** as of this tag. Full
order-flow, setup detection, and execution surfaces remain behind Phase 3+ gates.

---

## 1. What Shipped — PR Inventory

Phase 2 was executed as nine atomic PRs on the `phase-2-market-structure-mcp`
branch. Each PR is a single commit that typechecks and tests green in isolation.

| PR  | Commit    | Scope |
|-----|-----------|-------|
| PR1 | `a3d313c` | `@gv/types` market-structure foundation (`Symbol`, `Bar`, `Structure`, `OrderBlock`, `FVG`, `TVSignal`) |
| PR2 | `ef5067c` | `@gv/api-client` market + structure + tv-ingest endpoints |
| PR3 | `7e7661f` | `control_plane` `/v1/tv-webhook` endpoint + HMAC verify (`X-Godsview-Signature`) |
| PR4 | `489bac5` | BOS / CHOCH structure detector (pure-function) |
| PR5 | `ca4d984` | Order Block + Fair Value Gap detector |
| PR6 | `397948d` | Multi-timeframe Fusion Engine + `market_contexts` table |
| PR7 | `48fddf2` | `/v1/market` route surface (symbols + structure read) + Market Symbols pages |
| PR8 | `11fdec5` | Live-quote WebSocket bridge + `QuoteHub` fan-out + `POST /v1/market/quotes` ingest |
| PR9 | _this PR_ | `v2.2.0` release handoff (this doc) + operator-clone mirror + tag |

---

## 2. Wired Pages (3 net-new under `/market`)

All pages live under `apps/web/src/app/(app)/market/` and consume the
`api.market` factory from `@gv/api-client`. Each is server-authenticated, uses
TanStack React Query v5 for fetch state, and adopts the shared `DataTable`
primitive promoted out of `apps/web` in PR7.

- `/market` — Symbols list (search by ticker, filter by venue + asset class)
- `/market/symbols/[id]` — Symbol detail (current quote, structure events
  timeline, OB + FVG zone overlays, multi-TF fusion verdict)
- `/market/symbols/[id]/structure` — Drill-down structure history with TF
  filter + event-type chips

The left nav `/market` slot reserved in Phase 1 is now active. `/orderflow`,
`/setups`, `/recall`, `/quant-lab`, `/portfolio`, and `/governance` remain
reserved for Phase 3+.

---

## 3. Backend Surface Changes (`services/control_plane`)

### 3.1 New Routes

| Verb   | Path                       | Auth     | Notes |
|--------|----------------------------|----------|-------|
| POST   | `/v1/tv-webhook`           | HMAC     | TradingView ingest. Signature in `X-Godsview-Signature`, secret per source |
| GET    | `/v1/market/symbols`       | Bearer   | Paginated; filters `q`, `venue`, `assetClass` |
| GET    | `/v1/market/symbols/{id}`  | Bearer   | Single symbol + last-quote snapshot |
| GET    | `/v1/market/symbols/{id}/structure` | Bearer | BOS/CHOCH/OB/FVG events with TF filter |
| GET    | `/v1/market/symbols/{id}/contexts`  | Bearer | Multi-TF fusion verdict (PR6 output) |
| POST   | `/v1/market/quotes`        | Admin    | Operator-only quote ingest → `QuoteHub.publish` (PR8) |
| WS     | `/ws/quotes`               | In-handler | Auth via `?token=` or `Authorization: Bearer` (browsers can't set WS headers). Subscribe/unsubscribe envelope protocol. |

### 3.2 New Tables (Alembic migrations under `services/control_plane/alembic/versions/`)

- `symbols` — `id`, `ticker`, `venue`, `asset_class`, `tick_size`, `lot_size`,
  `display_name`, `is_active`, audit columns
- `bars` — OHLCV per `(symbol_id, timeframe, ts)` (`UNIQUE` covers
  re-ingestion idempotency)
- `tv_signals` — raw TradingView envelopes with HMAC source attribution
- `structure_events` — emitted BOS/CHOCH/OB/FVG events with `tf`, `event_type`,
  `direction`, `zone_low/zone_high`, `confidence`, `source_bar_id`
- `market_contexts` — fusion verdicts per `(symbol_id, fused_at)` with
  `bullish_score`, `bearish_score`, `verdict`, contributing TF rollup JSON

aiosqlite test harness shims `JSONB → JSON` and `ARRAY(String) → JSON` so
the same migrations run in CI without a Postgres instance.

### 3.3 New Detector / Pub-Sub Modules

| Module | Purpose |
|--------|---------|
| `app.detectors.bos_choch` | Pure-function BOS / CHOCH detection over a `list[Bar]` |
| `app.detectors.zones`     | Order-block + Fair-Value-Gap zone extraction |
| `app.detectors.fusion`    | Multi-timeframe weighted-vote fusion |
| `app.realtime.quotes`     | `QuoteHub` (asyncio-locked pub/sub), `QuoteMessage`, `QuoteSubscriber` Protocol |
| `app.routes.ws_quotes`    | `/ws/quotes` WebSocket handler with subscribe/publish envelope |
| `app.routes.tv_webhook`   | TradingView ingest with HMAC verify + dedup |
| `app.routes.market`       | Read endpoints + admin quote ingest |

---

## 4. Package Surface Changes

### `@gv/types` — 6 new modules
- `symbols.ts` — `Symbol`, `SymbolVenue`, `AssetClass`, `SymbolFilter`
- `bars.ts` — `Bar`, `Timeframe`, `BarStream`
- `structure.ts` — `StructureEvent`, `EventType`, `Direction`, `Confidence`
- `zones.ts` — `OrderBlock`, `FairValueGap`, `Zone`
- `tv-signals.ts` — `TVSignal`, `TVPayload`, `TVSignatureHeader`
- `quotes.ts` — `Quote`, `QuoteEnvelope`, `WSQuoteFrame`

### `@gv/api-client` — 3 new endpoint factories
Exposed on the workspace singleton `api`:
- `api.market` — symbol list/detail, structure read, contexts, quote ingest
- `api.structure` — BOS/CHOCH/OB/FVG read + TF filter
- `api.tvIngest` — operator-mux helper for posting signed TV envelopes

### `@gv/ui`
- Promoted `DataTable` from `apps/web/src/components/` into `@gv/ui`; the web
  app re-exports for back-compat.
- New `<ConfidenceBadge>` + `<DirectionPill>` primitives consumed by the
  Market Symbols detail page.

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
| control_plane structure suite | `cd services/control_plane && python -m pytest tests/test_structure_bos_choch.py tests/test_structure_zones.py tests/test_structure_fusion.py tests/test_realtime_quotes.py` | PASS — 49/49 |
| control_plane WS + market suite (Py 3.11+) | `python -m pytest tests/test_ws_quotes.py tests/test_market.py tests/test_tv_webhook.py` | PASS in CI matrix |
| OpenAPI contract validation | `.github/workflows/contract-validation.yml` | GREEN on `phase-2-market-structure-mcp` HEAD |

> Sandbox runs Python 3.10; the WS integration suite (`test_ws_quotes.py`) and
> all model-layer tests (`test_market.py`, `test_models_phase1.py`) require
> 3.11+ because `app.models` uses `from datetime import UTC, datetime`. Both
> are exercised continuously in the GitHub Actions Python 3.11/3.12 matrix.

---

## 6. Fixes Landed Alongside Phase 2

Three surgical alignments were folded into the per-PR commits because they
were blocking the per-PR gate:

1. **PR3 — `tv_webhook` HMAC constant-time compare.** Switched the signature
   verifier to `hmac.compare_digest(...)` to remove the early-exit timing
   side-channel that the per-PR security lint flagged.
2. **PR6 — `market_contexts.verdict` enum cardinality.** The fusion engine
   was emitting four labels (`bullish_strong`, `bullish_weak`, `bearish_weak`,
   `bearish_strong`) but the column was sized for three. Migration
   `20260418_phase2_pr6_widen_verdict` widens the SA enum and backfills.
3. **PR7 — `apps/web` route group.** `/market` was wired under
   `apps/web/src/app/(app)/market/` (not `(public)/market/`) so the auth
   provider re-uses the existing layout and the operator nav highlights the
   active item.

All three are pure alignment — no new behavior, no schema break for
already-shipped operator-surface data.

---

## 7. Known Quirks & Sandbox Notes

- **`better-sqlite3` native postinstall.** Unchanged from Phase 1 — sandbox
  blocks the nodejs.org headers download, so we install with
  `--ignore-scripts`. The API server ships a pinned prebuilt binary.
- **Python 3.10 sandbox vs 3.11+ production.** Phase 2 leans harder on
  `datetime.UTC` and `typing.Self`. Pure-function detectors run on 3.10;
  routes that import `app.models` require 3.11+. CI matrix is 3.11 / 3.12.
- **WS singleton scoping.** `QuoteHub` is process-local. A multi-pod rollout
  in Phase 3+ will need a Redis pub/sub fan-out behind the same
  `QuoteSubscriber` Protocol — no route changes required.
- **TradingView HMAC source attribution.** `tv_signals.source_id` references
  a per-source secret stored in `webhook_subscriptions` (Phase 1 PR4 surface).
  Operators rotate the secret via the existing
  `/admin/webhooks/{id}/rotate-secret` flow; ingest never sees plaintext.
- **`alembic upgrade head` gate.** The Phase 2 migrations are additive only
  — no destructive `op.drop_column` — so a Phase 1 production database can
  run `alembic upgrade head` in-place without backfill.

---

## 8. What Phase 3 Inherits

- A green typecheck across all four workspaces.
- Five new persisted tables (`symbols`, `bars`, `tv_signals`,
  `structure_events`, `market_contexts`) with Alembic migrations that run
  clean on aiosqlite + Postgres.
- A working detector pipeline (`bos_choch` → `zones` → `fusion`) emitting
  structured events that feed the Market Symbols UI.
- A WebSocket fan-out hub (`QuoteHub`) ready to swap to Redis pub/sub when
  multi-pod scaling kicks in.
- An admin-only `POST /v1/market/quotes` ingest endpoint that lets the
  operator mux push test ticks into the live UI without standing up a real
  market data feed.
- A release branch + tag (`v2.2.0`) to diff against.

---

## 9. Phase 3 Entry Criteria

Per `docs/blueprint/09-phase-roadmap.md`:

> **Phase 3 — Order Flow Engine + Setup Detection.** Bookmap-style depth +
> delta + imbalance ingest, setup detector (liquidity sweep + reclaim, OB
> retest, breakout + retest, FVG reaction, momentum continuation, session
> reversal), and the Setup Detail page.

The Phase 3 PR series will follow the same nine-PR atomic pattern, starting
with:

- PR1 — `@gv/types` order-flow models (`DepthSnapshot`, `Imbalance`,
  `Absorption`, `LiquidityWall`, `VolumeCluster`)
- PR2 — `@gv/api-client` order-flow + setup endpoints
- PR3 — `control_plane` `/v1/orderflow/ingest` endpoint
- PR4 — Delta + imbalance + absorption detectors
- PR5 — Setup detector library (the six canonical setups)
- PR6 — Setup confidence + recall similarity scaffolding
- PR7 — `/setups` list + detail pages
- PR8 — Setup → execution gate stub (paper-mode only)
- PR9 — Phase 3 handoff + `v2.3.0` tag

---

## 10. Sign-Off

- **Build:** PASS — four workspaces clean `tsc --noEmit`; control_plane
  pure-function suite 49/49.
- **Tests:** PASS — api-server suite unchanged; control_plane integration
  suite green in CI 3.11/3.12 matrix.
- **Readiness:** DEGRADED (expected — `SYSTEM_MODE=paper`; market structure
  is now live but order flow + execution remain behind Phase 3+ gates).
- **Security:** TradingView ingest is HMAC-gated; `POST /v1/market/quotes`
  is admin-only; `/ws/quotes` closes 4401 on missing/invalid token.

Signed,
GodsView Phase 2 build train.
