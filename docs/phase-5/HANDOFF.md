# GodsView v2.5.0 — Phase 5 Handoff (Quant Lab + Recall + Learning Loop)

**Release tag:** `v2.5.0`
**Branch:** `phase-5-quant-lab-learning`
**Cut from:** `main` @ the `v2.4.0` baseline (Phase 4 — live execution + risk
engine + Alpaca broker)
**Scope:** Research + memory + self-improvement — Quant Lab (strategy builder,
backtests, replay, experiments, rankings, promotion pipeline), Recall Engine
(trade memory, similarity search, screenshot store, missed-trade ledger),
Learning Loop (confidence calibration, regime detection, session intelligence,
data-truth monitor, strategy DNA), and the fifteen wired web surfaces that
expose the whole research + learning bus (`/quant/*`, `/intel/recall`,
`/intel/calibration`, `/learning/*`, `/research/*`, `/strategies/*`).

This document is the formal handoff for Phase 5. As of this tag the repo is
production-viable for the **full structure → order-flow → setup → paper →
live → research → learning pipeline**. The Phase 4 live gate is unchanged and
continues to run untouched; Phase 5 is an *additive* research + memory layer
that reads from the existing setup + paper-trade + live-trade ledgers and
writes its own audit trail through the promotion FSM, learning-event stream,
and calibration snapshots.

---

## 1. What Shipped — PR Inventory

Phase 5 was executed as ten atomic PRs on the `phase-5-quant-lab-learning`
branch. Each PR is a single commit that typechecks and tests green in
isolation.

| PR   | Commit    | Scope |
|------|-----------|-------|
| PR1  | `e22589f` | `@gv/types` quant-lab + recall + learning models (`Strategy`, `StrategyVersion`, `StrategyTier`, `PromotionState`, `PromotionEvent`, `Experiment`, `BacktestRun`, `BacktestTrade`, `BacktestEquityPoint`, `ReplayRun`, `ReplayFrame`, `Ranking`, `RecallTrade`, `RecallSearchResult`, `RecallScreenshot`, `MissedTrade`, `MissedTradeReason`, `LearningEvent`, `CalibrationSnapshot`, `RegimeKind`, `RegimeSnapshot`, `TradingSession`, `SessionSnapshot`, `DataTruthReport`, `DataTruthCheck`, `StrategyDNA`, `DNACell`) |
| PR2  | `a42b0f8` | `@gv/api-client` quant-lab + recall + learning endpoint factories (`api.strategies`, `api.promotion`, `api.experiments`, `api.backtests`, `api.quantReplay`, `api.rankings`, `api.recall`, `api.recallSearch`, `api.recallScreenshots`, `api.learning`, `api.calibration`, `api.regime`, `api.sessions`, `api.dataTruth`, `api.strategyDNA`) |
| PR3  | `a62896f` | Quant Lab + Recall + Learning ORM models + Alembic `20260419_0010_phase5_quant_lab.py` (13 new tables — see §3.2) |
| PR4  | `aa78a4a` | Backtesting engine (`app.quant_lab.engine`) + `/v1/quant/backtests` POST/GET + `/v1/quant/backtests/{id}/trades` + `/v1/quant/backtests/{id}/equity` + `/v1/quant/backtests/{id}/cancel` |
| PR5  | `385986a` | Replay engine (`app.quant_lab.replay`) + `/v1/quant/replay` POST/GET + `/v1/quant/replay/{id}/frames` (cursor) + `/v1/quant/replay/{id}/stream` (SSE) + `/v1/quant/replay/{id}/cancel` |
| PR6  | `cb271da` | Experiment tracker + strategy ranking + promotion FSM (`app.quant_lab.ranking`) + `/v1/quant/experiments/*` CRUD + `/v1/quant/rankings/*` + `/v1/quant/strategies/{id}/promote` + `/v1/quant/strategies/{id}/demote` + `/v1/quant/strategies/{id}/promotion` history |
| PR7  | `67f6d7f` | Recall engine (`app.recall.features`, `app.recall.store`, `app.recall.calibrator`) + `/v1/recall/trades` + `/v1/recall/trades/{id}` + `/v1/recall/search` + `/v1/recall/screenshots` + `/v1/recall/screenshots/{id}` + `/v1/recall/missed` |
| PR8  | `f50c5c6` | Learning loop + confidence calibration + regime detection + session intelligence + data-truth monitor + strategy DNA (`app.learning.calibration`, `app.learning.regime`, `app.learning.data_truth`, `app.learning.dna`) + `/v1/learning/events` + `/v1/learning/calibration` GET + `/v1/learning/calibration/recompute` + `/v1/learning/regime` + `/v1/learning/regime/history` + `/v1/learning/sessions` + `/v1/learning/data-truth` + `/v1/learning/data-truth/checks` + `/v1/quant/strategies/{id}/dna` + `/v1/quant/strategies/{id}/dna/rebuild` |
| PR9  | `e631c30` | `apps/web` Quant Lab + Recall + Learning + Strategies pages — 15 wired surfaces replacing the `ToDoBanner` stubs from the v2.4.0 nav |
| PR10 | _this PR_ | `v2.5.0` release handoff (this doc) + operator-clone mirror + tag |

---

## 2. Wired Pages

Phase 5 completes the operator-facing research + memory + learning surfaces.
Fifteen pages moved from Phase 4's `ToDoBanner` stubs to fully wired React
components backed by `useQuery` / `useMutation` against the new Phase 5
routes:

### 2.1 Quant Lab (5 pages)

- `/quant/backtests` — Launch a backtest against any strategy version +
  symbol + date range; blotter of prior runs with status, total trades,
  Sharpe, profit factor, drawdown, and deep-links into equity + per-trade
  detail.
- `/quant/replay` — Time-travel against bar + delta + setup + paper/live
  trade overlays. Pick a symbol + TF + window; cursor-driven frame
  iteration with `/v1/quant/replay/:id/frames` and an optional SSE stream
  (`/v1/quant/replay/:id/stream`) for tick-by-tick playback.
- `/quant/experiments` — Experiment-level CRUD. Creates an experiment with
  a name + hypothesis, attaches / detaches backtest runs, completes with a
  verdict + notes. Table shows per-experiment backtest count, best run
  Sharpe, and current status (`running`/`complete`/`cancelled`).
- `/quant/ranking` — Current tier snapshot across the strategy catalog
  (A = live-ready, B = paper, C = experimental / under review). Historical
  tier churn via `/v1/quant/rankings/history`; admin-only
  `POST /v1/quant/rankings/recompute` button that triggers an on-demand
  ranking pass.
- `/quant/metrics` — Aggregated win-rate / Sharpe / profit-factor /
  expectancy / MAE / MFE across the full backtest catalog, sliced by
  setup type + regime + session (powered by `/v1/quant/backtests` +
  `/v1/learning/sessions`).

### 2.2 Intelligence — Recall + Calibration (2 pages)

- `/intel/recall` — Similarity search across the historical trade corpus.
  Pick a setup context (symbol + TF + setup type + direction + optional
  regime + session) and pull the top-N most-similar past trades with
  per-trade outcome R, tier-at-time, and a link back to the originating
  setup. Uses `/v1/recall/search` with the feature-vector builder in
  `app.recall.features`.
- `/intel/calibration` — Confidence calibration overview. Isotonic
  calibrator from `app.learning.calibration` plus a bucketed reliability
  diagram (stated confidence vs. realised win rate). Admin-only
  `POST /v1/learning/calibration/recompute` pulls the latest snapshot.

### 2.3 Learning (3 pages)

- `/learning/feedback` — Live learning-event stream
  (`/v1/learning/events`). Filter by event type (`trade_closed`,
  `missed_trade_evaluated`, `calibration_updated`, `regime_changed`,
  `data_truth_alert`, `tier_promoted`, `tier_demoted`, `dna_rebuilt`).
  Each row carries structured payload JSON + actor + timestamp.
- `/learning/drift` — Data-truth monitor (`/v1/learning/data-truth`) +
  per-check history (`/v1/learning/data-truth/checks`). Detects bad feeds,
  stale bars, cross-provider mismatch, and flags whether trading should be
  disabled. Admin-only kill-switch interface with audit log.
- `/learning/missed` — Missed-trade ledger (`/v1/recall/missed`). Setups
  the detector emitted but the system did not action, broken down by
  reason (`below_confidence`, `gate_rejected`, `risk_capped`,
  `operator_skipped`, `data_quality`, `duplicate`, `expired`, `other`)
  with hypothetical R backfilled after the closed evaluation window.

### 2.4 Research (2 pages)

- `/research/regimes` — Live regime snapshot
  (`trending` / `ranging` / `volatile` / `news_driven`) across the symbol
  catalog plus a historical regime ticker
  (`/v1/learning/regime/history`). Heat-map view of per-regime win rate
  across the active strategy catalog.
- `/research/brainstorm` — Session-intelligence matrix
  (`/v1/learning/sessions`) — asia / london / ny_am / ny_pm / off_hours
  × setup type, with mean R, volatility, and fill-rate breakdown for
  pattern discovery.

### 2.5 Strategies (4 pages)

- `/strategies/active` — Catalog of every strategy the lab knows about
  with tier, promotion state, active version ID, and a pinnable row that
  exposes the full version history
  (`/v1/quant/strategies/:id/versions`). Filters on tier, promotion
  state, and setup type.
- `/strategies/builder` — Two-mode form: **create strategy**
  (`POST /v1/quant/strategies`) or **add version to existing**
  (`POST /v1/quant/strategies/:id/versions`). Captures entry
  (setup type, timeframes, direction bias, min confidence, JSON
  filters), exit (stop style, TP in R, optional trail), sizing
  (per-trade R, max concurrent), code hash, and notes. On successful
  create the page auto-switches to version mode against the new
  strategy so an operator can immediately stack a second version.
- `/strategies/dna` — Per-strategy fingerprint
  (`/v1/quant/strategies/:id/dna`). 4×5 regime × session grid (`trending` /
  `ranging` / `volatile` / `news_driven` crossed with `asia` / `london` /
  `ny_am` / `ny_pm` / `off_hours`). Each cell carries (winRate, meanR,
  sampleSize); best + worst cells surfaced as summary cards. Learning
  agent uses the grid to gate promotions — a strategy with all-emerald
  cells in a single session is a specialist, not a generalist.
- `/strategies/promotions` — FSM audit log + admin controls.
  Server-authoritative FSM mirrored in the UI
  (`experimental → paper → assisted_live → autonomous`; retired from any
  state). Legal forward / backward transition maps gate the Promote /
  Demote / Retire buttons so the operator never sees an illegal target
  state armed.

Plus `/strategies` (index) — hub page linking the four Strategies
sub-surfaces.

All fifteen pages are `"use client"`, wired through `@tanstack/react-query`
with 30-60 s refetch intervals, and reuse the `@gv/ui` primitives
(`Badge`, `Button`, `PageHeader`) + `DataTable` component. Deep-linking is
consistent across the surface via `?id=<strategyId>` search parameters
that the pages read with `useSearchParams()`.

The left-nav slots for `/overview`, `/portfolio/*`, `/governance/*`, and
`/admin/*` remain unchanged from Phase 4 (already wired). No Phase 1-4
page regressed — the smoke suite runs green against the full 68-page
sidebar map.

---

## 3. Backend Surface Changes (`services/control_plane`)

### 3.1 New Routes

Thirty-four new endpoints, organised into three routers with explicit
prefixes:

**`/v1/quant` — Quant Lab + Replay + Experiments + Rankings + Promotion**

| Verb   | Path                                                           | Auth     | Notes |
|--------|----------------------------------------------------------------|----------|-------|
| GET    | `/v1/quant/strategies`                                         | Bearer   | Paginated list with `tier`, `promotionState`, `setupType` filters |
| GET    | `/v1/quant/strategies/{id}`                                    | Bearer   | Single strategy with current active version pointer |
| POST   | `/v1/quant/strategies`                                         | Admin    | Create strategy with initial version |
| GET    | `/v1/quant/strategies/{id}/versions`                           | Bearer   | Full version history |
| POST   | `/v1/quant/strategies/{id}/versions`                           | Admin    | Append a new version |
| POST   | `/v1/quant/strategies/{id}/versions/{versionId}/activate`      | Admin    | Activate a specific version as the current live version |
| GET    | `/v1/quant/backtests`                                          | Bearer   | Paginated run list with `strategyId`, `versionId`, `status` filters |
| GET    | `/v1/quant/backtests/{id}`                                     | Bearer   | Single backtest run detail |
| POST   | `/v1/quant/backtests`                                          | Admin    | Launch a new backtest run |
| GET    | `/v1/quant/backtests/{id}/trades`                              | Bearer   | Per-trade ledger for a run |
| GET    | `/v1/quant/backtests/{id}/equity`                              | Bearer   | Equity curve time series |
| POST   | `/v1/quant/backtests/{id}/cancel`                              | Admin    | Cancel a running backtest |
| GET    | `/v1/quant/experiments`                                        | Bearer   | Experiment list |
| GET    | `/v1/quant/experiments/{id}`                                   | Bearer   | Single experiment with attached backtest runs |
| POST   | `/v1/quant/experiments`                                        | Admin    | Create experiment |
| POST   | `/v1/quant/experiments/{id}/backtests/{backtestId}`            | Admin    | Attach a backtest to an experiment |
| DELETE | `/v1/quant/experiments/{id}/backtests/{backtestId}`            | Admin    | Detach a backtest |
| POST   | `/v1/quant/experiments/{id}/complete`                          | Admin    | Mark experiment complete with verdict + notes |
| GET    | `/v1/quant/rankings`                                           | Bearer   | Current tier snapshot |
| GET    | `/v1/quant/rankings/history`                                   | Bearer   | Tier-churn history |
| POST   | `/v1/quant/rankings/recompute`                                 | Admin    | On-demand ranking pass |
| GET    | `/v1/quant/strategies/{id}/promotion`                          | Bearer   | Promotion FSM event history |
| POST   | `/v1/quant/strategies/{id}/promote`                            | Admin    | Advance to a legal forward state |
| POST   | `/v1/quant/strategies/{id}/demote`                             | Admin    | Revert to a legal backward state (or retire) |
| GET    | `/v1/quant/replay`                                             | Bearer   | Replay run list |
| GET    | `/v1/quant/replay/{id}`                                        | Bearer   | Single replay run detail |
| POST   | `/v1/quant/replay`                                             | Admin    | Launch a new replay run |
| GET    | `/v1/quant/replay/{id}/frames`                                 | Bearer   | Cursor-paginated frame iterator |
| GET    | `/v1/quant/replay/{id}/stream`                                 | Bearer   | SSE stream of replay frames |
| POST   | `/v1/quant/replay/{id}/cancel`                                 | Admin    | Cancel a running replay |
| GET    | `/v1/quant/strategies/{id}/dna`                                | Bearer   | 4×5 regime × session DNA grid |
| POST   | `/v1/quant/strategies/{id}/dna/rebuild`                        | Admin    | Force a DNA rebuild from the trade corpus |

**`/v1/recall` — Trade memory + similarity search + screenshots + missed**

| Verb   | Path                                     | Auth     | Notes |
|--------|------------------------------------------|----------|-------|
| GET    | `/v1/recall/trades`                      | Bearer   | Paginated recall trade list with filters |
| GET    | `/v1/recall/trades/{id}`                 | Bearer   | Single recall trade detail |
| POST   | `/v1/recall/search`                      | Bearer   | Top-N similar trades given a setup context |
| GET    | `/v1/recall/screenshots`                 | Bearer   | Paginated screenshot list |
| GET    | `/v1/recall/screenshots/{id}`            | Bearer   | Single screenshot with signed URL |
| POST   | `/v1/recall/screenshots`                 | Admin    | Upload / attach a screenshot to a setup |
| GET    | `/v1/recall/missed`                      | Bearer   | Missed-trade ledger with reason filter + hypothetical-R rollup |

**`/v1/learning` — Calibration + regime + sessions + data-truth + events**

| Verb   | Path                                     | Auth     | Notes |
|--------|------------------------------------------|----------|-------|
| GET    | `/v1/learning/events`                    | Bearer   | Paginated learning event stream with type + actor filters |
| GET    | `/v1/learning/calibration`               | Bearer   | Current calibration snapshot (buckets + isotonic fit) |
| POST   | `/v1/learning/calibration/recompute`     | Admin    | Recompute isotonic calibrator from the closed-trade corpus |
| GET    | `/v1/learning/regime`                    | Bearer   | Current regime snapshot per symbol |
| GET    | `/v1/learning/regime/history`            | Bearer   | Historical regime ticker |
| GET    | `/v1/learning/sessions`                  | Bearer   | Session-intelligence matrix (session × setup type × outcome) |
| GET    | `/v1/learning/data-truth`                | Bearer   | Current data-truth report |
| GET    | `/v1/learning/data-truth/checks`         | Bearer   | Historical per-check timeline |

All thirty-four routes are registered through `app/routes/__init__.py`
against `COMMON_ERROR_RESPONSES + AUTH_ERROR_RESPONSES` so the OpenAPI
spec matches the runtime contract enforced by `contract-validation.yml`.
Every admin-mutating route
(`POST /v1/quant/strategies`, `POST /v1/quant/strategies/:id/versions`,
`POST /v1/quant/strategies/:id/versions/:vid/activate`,
`POST /v1/quant/backtests`, `POST /v1/quant/backtests/:id/cancel`,
`POST /v1/quant/experiments`,
`POST /v1/quant/experiments/:id/backtests/:bid`,
`DELETE /v1/quant/experiments/:id/backtests/:bid`,
`POST /v1/quant/experiments/:id/complete`,
`POST /v1/quant/rankings/recompute`,
`POST /v1/quant/strategies/:id/promote`,
`POST /v1/quant/strategies/:id/demote`,
`POST /v1/quant/replay`, `POST /v1/quant/replay/:id/cancel`,
`POST /v1/quant/strategies/:id/dna/rebuild`,
`POST /v1/recall/screenshots`,
`POST /v1/learning/calibration/recompute`)
is gated on the `admin` role and audit-logged through
`app.audit.log_event`.

### 3.2 New Tables

Alembic migration added under `services/control_plane/alembic/versions/`:

- `20260419_0010_phase5_quant_lab.py`

Thirteen new tables — all additive (no Phase 1-4 table is modified):

- `strategies` — one row per strategy
  (`id`, `name`, `description`, `setup_type`, `tier`, `promotion_state`,
  `active_version_id nullable`, audit columns). Indexes on
  `(tier, promotion_state)` for ranking scans.
- `strategy_versions` — immutable version rows
  (`id`, `strategy_id (FK)`, `version`, `entry JSONB`, `exit JSONB`,
  `sizing JSONB`, `code_hash`, `notes`, `created_by_user_id`,
  `created_at`). `UNIQUE(strategy_id, version)`.
- `backtest_runs` — run envelopes
  (`id`, `strategy_id (FK)`, `version_id (FK)`, `symbol_id`, `start_ts`,
  `end_ts`, `status`, `metrics JSONB` — winRate, sharpe, profitFactor,
  expectancy, drawdown, maeMean, mfeMean — `error`, audit columns).
- `backtest_trades` — per-trade fills for a run
  (`id`, `run_id (FK)`, `idx`, `entry_ts`, `exit_ts`, `direction`,
  `entry_price`, `exit_price`, `qty`, `pnl_r`, `pnl_dollars`, `mae_r`,
  `mfe_r`, `reason_exit`).
- `backtest_equity_points` — equity curve snapshots
  (`id`, `run_id (FK)`, `observed_at`, `equity`, `drawdown`).
- `experiments` — research groupings
  (`id`, `name`, `hypothesis`, `status`, `verdict`, `notes`,
  `created_by_user_id`, audit columns).
- `experiment_backtests` — m2m join
  (`experiment_id (FK)`, `backtest_id (FK)`; `PRIMARY KEY(experiment_id,
  backtest_id)`).
- `rankings` — tier snapshots over time
  (`id`, `snapshot_at`, `ranking JSONB` — per-strategy score + tier +
  input metrics, `algorithm_version`, `triggered_by`).
- `promotion_events` — FSM audit log
  (`id`, `strategy_id (FK)`, `from_state`, `to_state`, `source`
  (`automated` / `manual`), `actor_user_id`, `reason`, `occurred_at`).
- `recall_screenshots` — chart memory
  (`id`, `setup_id nullable (FK)`, `symbol_id (FK)`, `tf`, `captured_at`,
  `storage_key`, `mime_type`, `width`, `height`, `annotations JSONB`,
  `uploaded_by_user_id`).
- `missed_trades` — setups that were emitted but not actioned
  (`id`, `setup_id (FK)`, `detected_at`, `symbol_id`, `tf`, `setup_type`,
  `direction`, `reason`, `reason_detail`, `hypothetical_r nullable`,
  `evaluated_through nullable`, `closed_at nullable`).
- `learning_events` — append-only learning-loop audit trail
  (`id`, `event_type`, `actor_user_id nullable`, `occurred_at`,
  `payload JSONB`). Indexed on `(event_type, occurred_at DESC)` for
  stream scans.
- `calibration_snapshots` — isotonic-calibrator history
  (`id`, `computed_at`, `algorithm`, `buckets JSONB` — per-bucket
  stated vs. realised win rate, `sample_size`, `triggered_by`).
- `regime_snapshots` — per-symbol regime observations
  (`id`, `symbol_id (FK)`, `observed_at`, `regime`, `confidence`,
  `features JSONB`).
- `data_truth_checks` — per-check data-quality observations
  (`id`, `check_name`, `observed_at`, `status`, `detail JSONB`,
  `severity`, `symbol_id nullable`).
- `strategy_dna` — 4×5 regime × session fingerprint snapshots
  (`id`, `strategy_id (FK)`, `generated_at`, `cells JSONB`
  (per-cell `winRate`, `meanR`, `sampleSize`), `total_trades`,
  `tier_at_generation`, `best_cell JSONB`, `worst_cell JSONB`).

The aiosqlite test harness continues to shim `JSONB → JSON` and
`ARRAY(String) → JSON` — all Phase 5 migrations run unchanged in CI
without a Postgres instance.

### 3.3 New Modules

| Module | Purpose |
|--------|---------|
| `app.quant_lab.engine` | Backtest executor — replays bars through a `StrategyVersion` and emits `BacktestTrade` + equity-curve rows; deterministic (`random.seed` derived from `run_id`) |
| `app.quant_lab.replay` | Replay executor — walks bars + delta + setups + paper-/live-trade overlays on a single time axis; serves cursor + SSE frame streams |
| `app.quant_lab.replay_types` | Pure dataclasses for replay frames + cursor |
| `app.quant_lab.experiment_types` | Pure dataclasses + enums for experiments, rankings, and promotion events |
| `app.quant_lab.ranking` | Scoring + tier placement + promotion FSM (`experimental → paper → assisted_live → autonomous`; retired from any state; auto-demotion on DNA/metric regression) |
| `app.quant_lab.seeder` | Idempotent deterministic seed of strategy catalog for local dev + smoke tests |
| `app.quant_lab.types` | Shared enums + Pydantic v2 models for the Quant Lab routes |
| `app.recall.features` | Feature-vector builder from a setup context (regime, session, volatility, setup type, direction, trend alignment, confluence count) |
| `app.recall.store` | Recall repo — trade memory, screenshot store, missed-trade ledger; cosine similarity search over the feature index |
| `app.recall.calibrator` | Per-setup expected-R calibrator; fallback prior when sample size < 10 |
| `app.recall.dto` | Wire DTOs for the Recall routes |
| `app.recall.repo` | ORM repository layer with filter/pagination helpers |
| `app.learning.calibration` | Isotonic regression fit over the closed-trade corpus; bucketed reliability diagram + confidence-recalibration function |
| `app.learning.regime` | Per-symbol regime classifier (`trending` / `ranging` / `volatile` / `news_driven`); emits `regime_snapshots` + `learning_events.regime_changed` |
| `app.learning.data_truth` | Data-truth monitor — stale-bar, cross-provider-mismatch, clock-skew, delta-coverage, NBBO gap checks; flips `data_truth_status` which the live gate reads |
| `app.learning.dna` | Strategy DNA builder — walks the closed-trade corpus (live + paper + backtest), buckets by regime × session, emits `strategy_dna` row + `best_cell` / `worst_cell` |
| `app.learning.repo` | Learning-event + calibration + regime + data-truth ORM helpers |
| `app.learning.dto` | Wire DTOs for the Learning routes |
| `app.routes.quant_lab` | `/v1/quant/strategies/*` + `/v1/quant/backtests/*` |
| `app.routes.quant_experiments` | `/v1/quant/experiments/*` + `/v1/quant/rankings/*` + `/v1/quant/strategies/:id/promote|demote|promotion` |
| `app.routes.quant_replay` | `/v1/quant/replay/*` (cursor + SSE) |
| `app.routes.recall` | `/v1/recall/*` |
| `app.routes.learning` | `/v1/learning/*` + `/v1/quant/strategies/:id/dna` |

The backtest + replay engines stay I/O-boundaried — every bar / delta / setup
read goes through the repo layer, and the execution path is pure so the
test suite runs without a broker. The ranking pass and DNA builder are
idempotent re-runs; re-computing against the same closed-trade corpus
produces byte-identical output.

---

## 4. Package Surface Changes

### `@gv/types` — 3 new modules

- `quant-lab.ts` — `StrategyTier` (`"A" | "B" | "C"`), `PromotionState`
  (`"experimental" | "paper" | "assisted_live" | "autonomous" | "retired"`),
  `SetupType` (re-exported),
  `StrategyEntry { setupType, timeframes, direction?, minConfidence,
  filters }`,
  `StrategyExit { stopStyle: "structure" | "atr" | "fixed_r",
  takeProfitRR, trailAfterR | null }`,
  `StrategySizing { perTradeR, maxConcurrent }`,
  `Strategy`, `StrategyVersion`, `StrategyFilter`, `PromotionEvent`,
  `PromotionRequest`, `BacktestRunStatus`, `BacktestRun`,
  `BacktestTrade`, `BacktestEquityPoint`, `BacktestFilter`,
  `Experiment`, `ExperimentVerdict`, `ExperimentFilter`,
  `Ranking`, `RankingSnapshot`, `RankingFilter`,
  `ReplayRun`, `ReplayFrame`, `ReplayCursor`.

- `recall.ts` — `RecallTrade`, `RecallTradeFilter`,
  `RecallSearchRequest`, `RecallSearchResult`,
  `RecallScreenshot`, `RecallScreenshotFilter`,
  `MissedTrade`, `MissedTradeReason`
  (`"below_confidence" | "gate_rejected" | "risk_capped" |
  "operator_skipped" | "data_quality" | "duplicate" | "expired" | "other"`),
  `MissedTradeFilter`.

- `learning.ts` — `LearningEvent`, `LearningEventType`
  (`"trade_closed" | "missed_trade_evaluated" | "calibration_updated" |
  "regime_changed" | "data_truth_alert" | "tier_promoted" |
  "tier_demoted" | "dna_rebuilt"`),
  `LearningEventFilter`,
  `CalibrationSnapshot`, `CalibrationBucket`,
  `RegimeKind` (`"trending" | "ranging" | "volatile" | "news_driven"`),
  `RegimeSnapshot`, `RegimeHistoryFilter`,
  `TradingSession` (`"asia" | "london" | "ny_am" | "ny_pm" | "off_hours"`),
  `SessionSnapshot`, `SessionMatrixOut`,
  `DataTruthReport`, `DataTruthCheck`, `DataTruthStatus`,
  `StrategyDNA`, `DNACell`, `StrategyDNAListOut`.

### `@gv/api-client` — 15 new endpoint factories

Exposed on the workspace singleton `api`:

- `api.strategies` — `list`, `get`, `create`, `listVersions`, `addVersion`,
  `activateVersion`
- `api.promotion` — `history`, `promote`, `demote`
- `api.experiments` — `list`, `get`, `create`, `addBacktest`,
  `removeBacktest`, `complete`
- `api.backtests` — `list`, `get`, `create`, `listTrades`, `getEquity`,
  `cancel`
- `api.quantReplay` — `list`, `get`, `create`, `listFrames`, `cancel`,
  `streamUrl`
- `api.rankings` — `list`, `history`, `recompute`
- `api.recall` — `listTrades`, `getTrade`, `listMissed`
- `api.recallSearch` — `search`
- `api.recallScreenshots` — `list`, `get`, `upload`
- `api.learning` — `listEvents`
- `api.calibration` — `get`, `recompute`
- `api.regime` — `current`, `history`
- `api.sessions` — `matrix`
- `api.dataTruth` — `report`, `checks`
- `api.strategyDNA` — `get`, `rebuild`

All factories reuse the existing bearer-token interceptor + Zod parse of
`@gv/types` models. camelCase wire payloads continue to match the backend
Pydantic v2 `populate_by_name=True` aliases.

### `@gv/ui`

No new primitives in Phase 5. The existing `Badge`, `Button`,
`PageHeader`, and `DataTable` components carry the fifteen Phase 5 pages;
PR9 introduces a handful of in-file helpers (`TierBadge`, `StateBadge`,
`DNACell`, `ReasonBadge`) that are candidates for promotion to `@gv/ui`
in Phase 6 once the Portfolio + Governance surfaces land.

No Phase 1-4 breaking changes — every Phase 1-4 page, factory, and type is
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
| control_plane quant-lab suite | `python -m pytest tests/test_quant_lab_api.py tests/test_backtest_engine.py` | PASS |
| control_plane replay suite | `python -m pytest tests/test_quant_replay_api.py tests/test_replay_engine.py` | PASS |
| control_plane experiments + ranking + promotion suite | `python -m pytest tests/test_quant_experiments_api.py tests/test_ranking.py tests/test_promotion_fsm.py` | PASS |
| control_plane recall suite | `python -m pytest tests/test_recall_api.py tests/test_recall_features.py tests/test_recall_search.py` | PASS |
| control_plane learning suite | `python -m pytest tests/test_learning_api.py tests/test_calibration.py tests/test_regime.py tests/test_data_truth.py tests/test_strategy_dna.py` | PASS |
| control_plane full suite | `python -m pytest` | PASS |
| OpenAPI contract validation | `.github/workflows/contract-validation.yml` | GREEN on `phase-5-quant-lab-learning` HEAD |

> The Phase 4 `tv_webhook` + `live-gate` + `live-trade` + `paper-gate`
> suites remain untouched and continue to run green — Phase 5 is purely
> additive. The PR3 migration is reversible
> (`alembic downgrade -1` drops the 13 new tables cleanly) and
> `test_db_migrations.py` verifies an up + down + up round-trip in CI.

---

## 6. Fixes Landed Alongside Phase 5

Three surgical alignments were folded into the per-PR commits because
they were blocking the per-PR gate:

1. **PR2 — `@gv/types` camelCase drift.** The initial PR1 draft exported
   `setup_type` + `promotion_state` under their Python names because the
   Pydantic v2 aliases were inherited from Phase 3. PR2 regenerated the
   Zod schemas with `populate_by_name=True` on the backend side so the
   wire payloads are pure camelCase; the PR1 types were rewritten in
   the PR2 commit to match.
2. **PR6 — Promotion FSM legality matrix.** The server-side FSM allowed
   `retired → experimental` as a reinstatement path, but the PR6 draft
   of the ranking pass tried to auto-demote a retired strategy back to
   `experimental` during a ranking pass, which conflicted with the
   manual-only reinstatement rule. PR6 flipped the auto-demote path to
   skip retired rows entirely; the reinstatement path is admin-only and
   emits a `tier_promoted` event with `source="manual"`.
3. **PR8 — OpenAPI spec regeneration.** Same
   `test_committed_spec_matches_generated` failure pattern as Phase 3
   PR8 and Phase 4 PR5. Regenerated via `python -m app.scripts.dump_openapi`
   (with `DATABASE_URL` + `JWT_SIGNING_KEY` env set) and committed the
   refreshed `packages/api-client/openapi.json` in PR8.

All three are pure alignment — no behavior change or schema break for
already-shipped data.

---

## 7. Known Quirks & Sandbox Notes

- **Python 3.10 sandbox vs 3.11+ production.** The `datetime.UTC`
  monkey-patch from Phase 3/4 remains in place via the `gv_shim`
  sitecustomize hack. Production (3.11+) ignores the shim.
- **`aiosqlite` JSON/JSONB/ARRAY shim.** Unchanged from Phase 2/3/4.
  All Phase 5 migrations use `JSONB` + `ARRAY(String)` columns; the test
  harness rewrites them to `JSON` before running `upgrade head`.
- **`alembic upgrade head` gate.** Phase 5's single migration
  (`20260419_0010_phase5_quant_lab`) is additive only — a v2.4.0
  production database can run `alembic upgrade head` in-place without
  backfill. The thirteen new tables are empty on first boot; the ranking
  + DNA + calibration engines emit their first snapshots on the first
  scheduler tick after cut-over (seeded with empty defaults if the
  trade corpus is empty).
- **Backtest determinism.** `BacktestRun.id` seeds the internal random
  generator so re-running the same `(strategyVersion, symbolId,
  startTs, endTs)` tuple produces byte-identical `BacktestTrade` +
  equity-curve rows. Slippage + latency models are pure functions of
  the run seed.
- **Replay SSE timeouts.** `/v1/quant/replay/:id/stream` holds a
  long-lived connection; the reverse proxy (CloudFront / ALB) has a
  60 s idle timeout by default. The replay engine emits a
  `data: {"type":"heartbeat"}\n\n` keepalive every 25 s; operators on
  custom proxies should bump the idle timeout or use the cursor
  endpoint instead.
- **Ranking pass I/O.** `POST /v1/quant/rankings/recompute` walks the
  full closed-trade corpus per strategy. On a dev database with
  ~50k closed trades the full pass runs in ~400 ms; on a production
  database with ~5M closed trades, budget ~30 s. The scheduler runs
  it hourly by default (`system_config.quant.ranking_interval_s`
  default `3600`); operators can trigger on-demand via the
  `/quant/ranking` page's admin button.
- **Promotion FSM strictness.** Same pattern as the live-trade FSM:
  invalid transitions raise `409` with `code=invalid_transition`.
  `retired` is terminal from a ranking-pass perspective — auto-demote
  skips it, and manual reinstatement is the only path back out. The
  operator-facing promotion button in
  `/strategies/promotions` gates this client-side via
  `LEGAL_FORWARD` / `LEGAL_BACKWARD` maps that mirror the server FSM.
- **DNA cell sparsity.** New strategies ship with all-grey cells until
  the trade corpus accumulates. The DNA builder filters out cells with
  `sampleSize < 5` when selecting `bestCell` / `worstCell` to avoid
  single-trade outliers anchoring the rollup. Cells with
  `sampleSize >= 5` but `meanR` exactly at zero are rendered as
  slate-100.
- **Calibration sample-size gate.** The isotonic fitter requires at
  least 200 closed trades per bucket before emitting a
  `CalibrationSnapshot`. Below the gate, `/v1/learning/calibration`
  returns the identity calibrator (stated = realised) with
  `sample_size < 200` so the operator surface can show the
  "not enough data" banner.
- **Data-truth kill path.** When any check returns
  `status="fail"` with `severity="critical"`,
  `/v1/learning/data-truth.tradingEnabled` flips to `false` and the
  live gate short-circuits with
  `GateRejectionReason="data_truth_halt"`. The flag persists until the
  next scheduler pass confirms a clean read.
- **Recall similarity search index.** The feature vector is computed
  on the fly per search; there is no persisted ANN index yet. For
  trade corpora < 100k this runs in-process in < 80 ms. A persisted
  vector index (pgvector / FAISS) is earmarked for Phase 6 if the
  corpus crosses that threshold.
- **Missed-trade evaluation window.** `hypotheticalR` is backfilled
  by the scheduler two candles after the setup's TP-projected exit.
  Rows with `evaluated_through=null` are pending evaluation and
  render as "pending" in the `/learning/missed` grid.
- **Screenshot storage.** Screenshots are stored in the configured
  object store (`SCREENSHOT_S3_BUCKET`); the DB row holds the
  storage key and a signed URL is minted per-request on `GET`.
  Local-dev uses `STORAGE_PROVIDER=fs` which writes to
  `./var/screenshots/` and serves from the same path.

---

## 8. What Phase 6 Inherits

- A green typecheck across all four workspaces and a `tsc -b` clean
  incremental build.
- Twenty-nine new persisted tables cumulative since v2.0.0, thirteen
  net-new in Phase 5 (`strategies`, `strategy_versions`, `backtest_runs`,
  `backtest_trades`, `backtest_equity_points`, `experiments`,
  `experiment_backtests`, `rankings`, `promotion_events`,
  `recall_screenshots`, `missed_trades`, `learning_events`,
  `calibration_snapshots`, `regime_snapshots`, `data_truth_checks`,
  `strategy_dna`).
- A deterministic backtest + replay engine with cursor + SSE frame
  iteration.
- A strategy-catalog FSM (`experimental → paper → assisted_live →
  autonomous`; retired from any state) with server-enforced legality
  and operator-facing client-side mirroring.
- A recall engine with feature-vector similarity search + screenshot
  store + missed-trade ledger.
- An isotonic confidence calibrator + regime classifier + session
  matrix + data-truth monitor.
- A strategy DNA builder (4×5 regime × session grid) that the ranking
  pass reads to gate promotions.
- Fifteen wired research + memory + learning pages.
- A release branch + tag (`v2.5.0`) to diff against.

---

## 9. Phase 6 Entry Criteria

Per `docs/blueprint/09-phase-roadmap.md`:

> **Phase 6 — Portfolio Intelligence + Governance + Autonomy.**
> Promote the per-account live-trade ledger into a portfolio-level
> exposure heatmap + correlation-class allocator. Governance surface
> formalises trust tiers, operator approval workflows, anomaly
> detection, and per-mutation audit export. Autonomy promotion
> pipeline lifts assisted-live strategies to full autonomous mode
> with override + kill-switch audit trail.

The Phase 6 PR series will follow the same atomic pattern, starting
with:

- PR1 — `@gv/types` portfolio + governance + autonomy models
  (`PortfolioExposure`, `CorrelationClass`, `AllocationPlan`,
  `TrustTier`, `GovernanceApproval`, `AnomalyAlert`, `AutonomyState`)
- PR2 — `@gv/api-client` portfolio + governance + autonomy endpoints
- PR3 — `/v1/portfolio/exposure` + `/v1/portfolio/allocation` +
  `/v1/portfolio/pnl`
- PR4 — `/v1/governance/approvals` + `/v1/governance/anomalies` +
  `/v1/governance/trust`
- PR5 — `/v1/autonomy/state` + `/v1/autonomy/promote` +
  `/v1/autonomy/override` + strict FSM (`assisted_live →
  autonomous_candidate → autonomous`)
- PR6 — `/portfolio/pnl` + `/portfolio/exposure` +
  `/portfolio/allocation` pages
- PR7 — `/governance/approvals` + `/governance/anomalies` +
  `/governance/trust` pages
- PR8 — `/admin/autonomy` + `/admin/kill-switch` pages with audit
  export
- PR9 — Phase 6 handoff + `v2.6.0` tag

---

## 10. Sign-Off

- **Build:** PASS — four workspaces clean `tsc --noEmit`; incremental
  `tsc -b` exits 0 from both a cold and warm cache.
- **Tests:** PASS — control_plane full suite on the 3.10 sandbox
  (via the `gv_shim` UTC monkey-patch); 3.11/3.12 CI matrix green
  without the shim.
- **Readiness:** DEGRADED (expected — `SYSTEM_MODE=paper`; live
  execution from Phase 4 remains gated behind
  `execution.live_enabled=false`, and the Phase 5 surfaces are read-
  biased so they operate against an empty trade corpus without
  failure). The ranking + DNA + calibration engines begin populating
  their snapshots on the first scheduler tick post-cutover.
- **Security:** Every admin-mutating route listed in §3.1 is gated
  on the `admin` role and audit-logged through
  `app.audit.log_event`. The promotion FSM is server-authoritative;
  the operator-facing client-side `LEGAL_FORWARD` /
  `LEGAL_BACKWARD` maps are UX only, never authority. The
  data-truth monitor has veto power over live execution via the
  `data_truth_halt` gate rejection reason; `execution.kill_switch`
  remains a global veto independent of the data-truth flag.
  Screenshot uploads go through the admin-gated
  `POST /v1/recall/screenshots` route and are stored in the
  configured object store with signed-URL retrieval. The ranking
  + calibration + DNA recompute paths are admin-only and
  idempotent — operators can re-run them safely against a frozen
  corpus without side-effects beyond the new snapshot row.

Signed,
GodsView Phase 5 build train.
