# GodsView Phase 12–16: Full Implementation Plan

**Date:** April 7, 2026
**Scope:** Execution Reality → Backtest Alignment → ML Pipeline → Observability → Proof of Edge
**Baseline:** 614+ source files, 3000+ tests passing, CI/CD operational, Alpaca integration exists

---

## Phase 12 — Real Execution Layer

**Goal:** Make execution provable. Every order gets a persistent lifecycle, every fill gets tracked, slippage becomes measurable.

**Why it matters:** Right now, orders live in memory (`_orders` dict in `execution_service/main.py`) and fills are reconciled in memory only (`fill_reconciler.ts`). If the service restarts, execution state is lost. The `trades.slippage` column exists but is never populated. Without persistent execution truth, nothing downstream (calibration, trust, promotion) can be trusted.

### 12.1 — New Database Tables

**File:** `lib/db/src/schema/execution.ts` (NEW)

Create three new tables:

**`orders` table** — Persistent order lifecycle

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid (PK) | Local order ID |
| broker_order_id | text | Alpaca order ID |
| signal_id | text (FK → signals) | Which signal triggered this |
| si_decision_id | text (FK → si_decisions) | SI approval record |
| strategy_id | text | Which strategy |
| symbol | text | Instrument |
| side | text | buy/sell |
| order_type | text | market/limit/bracket |
| quantity | real | Requested quantity |
| limit_price | real (nullable) | Limit price if applicable |
| stop_price | real | Stop loss |
| target_price | real | Take profit |
| status | text | submitted → accepted → partial_fill → filled → cancelled → rejected → expired |
| execution_mode | text | paper/live |
| submitted_at | timestamp | When order was sent to broker |
| accepted_at | timestamp (nullable) | Broker acknowledgment |
| first_fill_at | timestamp (nullable) | First fill event |
| completed_at | timestamp (nullable) | Fully filled/cancelled/rejected |
| rejection_reason | text (nullable) | Why broker rejected |
| operator_notes | text (nullable) | Human annotation |
| created_at | timestamp | Record creation |

**`fills` table** — Individual fill events

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid (PK) | Fill ID |
| order_id | uuid (FK → orders) | Which order |
| broker_fill_id | text | Alpaca fill activity ID |
| symbol | text | Instrument |
| side | text | buy/sell |
| quantity | real | Fill quantity |
| price | real | Fill price |
| commission | real | Commission charged |
| slippage | real | Fill price − limit/expected price |
| slippage_bps | real | Slippage in basis points |
| filled_at | timestamp | When fill occurred |

**`execution_metrics` table** — Per-order quality summary

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid (PK) | Metric record ID |
| order_id | uuid (FK → orders) | Which order |
| symbol | text | Instrument |
| strategy_id | text | Which strategy |
| execution_mode | text | paper/live |
| total_fills | integer | Fill count for this order |
| avg_fill_price | real | Volume-weighted average fill |
| expected_price | real | Price at signal generation |
| realized_slippage_bps | real | Actual slippage in bps |
| fill_latency_ms | integer | Time from submit to first fill |
| completion_latency_ms | integer | Time from submit to fully filled |
| market_impact_bps | real (nullable) | Estimated market impact |
| regime | text | Market regime at execution |
| created_at | timestamp | Record creation |

**Migration:** `lib/db/migrations/0002_execution_layer.sql`

### 12.2 — Order State Machine

**File:** `artifacts/api-server/src/lib/execution/order_state_machine.ts` (NEW)

Implement a deterministic state machine:

```
submitted → accepted → partial_fill → filled → [closed]
submitted → accepted → cancelled
submitted → rejected
accepted → expired
```

Each transition must:
- Validate the transition is legal
- Record timestamp
- Persist to `orders` table
- Emit an event for downstream consumers (fill reconciler, risk service, observability)

### 12.3 — Execution Service Refactor

**File:** `services/execution_service/main.py` (MODIFY)

Changes:
- Replace in-memory `_orders` dict with database persistence
- Add `POST /orders/{id}/status` endpoint for state updates
- Add `GET /orders/{id}/fills` endpoint for fill history
- Add `GET /orders/{id}/metrics` endpoint for execution quality
- On order submission: persist to `orders` table immediately, then send to Alpaca
- On Alpaca response: update `broker_order_id` and transition to `accepted` or `rejected`

### 12.4 — Fill Reconciler Persistence

**File:** `artifacts/api-server/src/lib/execution/fill_reconciler.ts` (NEW or MODIFY existing)

Changes:
- On each reconciliation tick (every 10s): poll Alpaca fills, deduplicate against `fills` table
- For each new fill: insert into `fills` table, compute slippage, update `orders` status
- After all fills processed: compute and upsert `execution_metrics` for affected orders
- Populate `trades.slippage`, `trades.mfe`, `trades.mae` (currently empty columns)

### 12.5 — Slippage Computation

**File:** `artifacts/api-server/src/lib/execution/slippage_tracker.ts` (NEW)

Computation: `slippage_bps = ((fill_price - expected_price) / expected_price) * 10000`

For sells: flip the sign (negative slippage = favorable).

Aggregate slippage by: symbol, strategy, regime, execution_mode, time-of-day.

Expose via `GET /api/execution/slippage-report` with filters.

### 12.6 — End-of-Day Reconciliation

**File:** `artifacts/api-server/src/engines/eod_reconciler.ts` (NEW)

Daily job that:
- Compares local `orders` table against Alpaca account state
- Detects orphaned orders (local order with no broker match)
- Detects unknown positions (broker position with no local order)
- Validates position quantities match
- Logs discrepancies to `audit_events`
- Alerts via observability engine if discrepancies exceed threshold

### 12.7 — Tests

**New test files:**
- `src/__tests__/order_state_machine.test.ts` — All valid/invalid transitions
- `src/__tests__/fill_reconciler.test.ts` — Deduplication, slippage computation, persistence
- `src/__tests__/eod_reconciler.test.ts` — Orphan detection, quantity mismatch
- `src/__tests__/execution_metrics.test.ts` — Metric aggregation correctness

**Expected:** 50+ new tests, covering every state transition and edge case.

### 12.8 — Safety Implications

- Orders table means execution state survives restarts
- Fill reconciler persistence means slippage data is never lost
- EOD reconciliation catches position drift before it compounds
- Execution metrics feed into Phase 13 (backtest alignment) and Phase 16 (proof of edge)

### 12.9 — Verification Checklist

- [ ] Fresh migration runs cleanly on empty DB
- [ ] Order placed → persisted immediately (before Alpaca response)
- [ ] Order state transitions are atomic (no partial writes)
- [ ] Fill reconciler deduplicates correctly (same fill never inserted twice)
- [ ] Slippage computed correctly for both buys and sells
- [ ] EOD reconciler detects intentionally created orphan order
- [ ] Service restart preserves all order and fill state
- [ ] trades.slippage populated for every closed trade
- [ ] 3000+ test gate still passes

---

## Phase 13 — Backtest ↔ Live Alignment Engine

**Goal:** Prove that a strategy behaves the same in backtest and live execution (within tolerance). Detect drift before it causes losses.

**Why it matters:** The backtest engine (in `services/backtest_service/`) uses `commission_pct=0.0005` and `slippage_pct=0.0002` as assumptions. Live execution has real slippage (measured in Phase 12). If these diverge significantly, the backtest is lying.

### 13.1 — Alignment Comparison Engine

**File:** `artifacts/api-server/src/engines/alignment_engine.ts` (NEW)

Core function: `computeAlignmentReport(strategy_id, window_days)` → `AlignmentReport`

**AlignmentReport structure:**
- `backtest_metrics`: Sharpe, win rate, avg slippage assumption, avg trade PnL
- `live_metrics`: Same fields from actual `execution_metrics` + `trades` tables
- `deltas`: Field-by-field comparison with absolute and percentage difference
- `divergence_score`: 0 (identical) to 1 (completely different), weighted:
  - Win rate delta: 30% weight
  - PnL delta: 25% weight
  - Slippage delta: 20% weight
  - Sharpe delta: 15% weight
  - Signal overlap: 10% weight
- `verdict`: ALIGNED / DRIFTING / DIVERGED (thresholds: 0.15, 0.35)
- `recommendations`: Array of action items (e.g., "increase backtest slippage assumption to 4bps to match live")

### 13.2 — Data Consistency Validator

**File:** `artifacts/api-server/src/lib/data/consistency_validator.ts` (NEW)

Validates that backtest and live data sources agree:
- Fetch same symbol/timeframe/date from both `market_data_service` cache and Alpaca live API
- Compare: close price within 0.01%, OHLC ordering matches, volume within 5%
- Flag divergences and persist to `audit_events`
- Expose: `GET /api/data/consistency-check?symbol=SPY&timeframe=15min`

### 13.3 — Side-by-Side Backtester Upgrade

**File:** `artifacts/api-server/src/engines/side_by_side_backtest.ts` (MODIFY)

Current state: In-memory snapshot with naive signal overlap.

Changes:
- Persist comparison snapshots to new `alignment_snapshots` table
- Replace naive signal overlap with actual trade-by-trade matching:
  - Match by: symbol + direction + entry time within ±2 bars
  - Compare: entry price, exit price, PnL, slippage
- Compute per-trade alignment score
- Feed results into `alignment_engine.ts`

### 13.4 — Backtest Slippage Calibration

**File:** `services/backtest_service/engine.py` (MODIFY)

Add calibration mode:
- Pull actual slippage distribution from `execution_metrics` table (Phase 12 data)
- Replace fixed `slippage_pct=0.0002` with empirical distribution sampling
- Compare calibrated backtest results vs uncalibrated
- Persist calibration delta to alignment report

### 13.5 — Drift Detection

**File:** `artifacts/api-server/src/lib/data/drift_detector.ts` (NEW)

Continuous monitoring:
- Run alignment check on rolling 7-day window for each active strategy
- If divergence_score crosses DRIFTING threshold: log warning, notify operator
- If divergence_score crosses DIVERGED threshold: recommend strategy pause
- Track drift trend over time (is it getting worse or recovering?)

### 13.6 — New Database Tables

**File:** Add to `lib/db/src/schema/execution.ts` or new `alignment.ts`

**`alignment_snapshots` table:**

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid (PK) | Snapshot ID |
| strategy_id | text | Which strategy |
| window_start | timestamp | Comparison window start |
| window_end | timestamp | Comparison window end |
| backtest_sharpe | real | Backtest Sharpe for window |
| live_sharpe | real | Live Sharpe for window |
| backtest_win_rate | real | Backtest win rate |
| live_win_rate | real | Live win rate |
| backtest_avg_slippage_bps | real | Assumed slippage |
| live_avg_slippage_bps | real | Measured slippage |
| divergence_score | real | 0–1 composite |
| verdict | text | ALIGNED / DRIFTING / DIVERGED |
| recommendations | jsonb | Action items |
| created_at | timestamp | Record creation |

### 13.7 — Tests

- `src/__tests__/alignment_engine.test.ts` — Divergence score computation, threshold behavior
- `src/__tests__/consistency_validator.test.ts` — Price divergence detection
- `src/__tests__/drift_detector.test.ts` — Rolling window, threshold crossing, trend detection
- `services/tests/test_backtest_calibration.py` — Calibrated vs uncalibrated slippage

### 13.8 — Verification Checklist

- [ ] Alignment report correctly identifies identical backtest and live data as ALIGNED (score ~0)
- [ ] Intentionally different data produces DIVERGED verdict
- [ ] Data consistency validator catches 1% price discrepancy
- [ ] Drift detector fires warning at correct threshold
- [ ] Calibrated backtest slippage reflects actual live slippage distribution
- [ ] Side-by-side comparison persists to database

---

## Phase 14 — Real ML Pipeline

**Goal:** Make the ML layer operationally mature — versioned models, automated retraining, feature store, production monitoring.

**Why it matters:** The XGBoost training pipeline (`trainer.py`, 11K lines) is real. MLflow is integrated. But models are versioned only by filename, retraining is manual, the approval threshold is hardcoded at 0.60, and there's no feedback loop from live outcomes back to training.

### 14.1 — Feature Store

**File:** `services/feature_service/store.py` (NEW)

Purpose: Cache computed features so they're computed once and used consistently across training, inference, and backtesting.

Implementation:
- SQLite table: `feature_cache(symbol, timeframe, timestamp, feature_version, features_json)`
- `feature_version` = hash of `FEATURE_NAMES` list (detect when features change)
- `get_or_compute(symbol, timeframe, bars)`: Check cache → hit = return, miss = compute + persist
- TTL: 24 hours for intraday features, 7 days for daily
- Expose: `GET /features/{symbol}?timeframe=15min&start=...&end=...`

### 14.2 — Model Versioning

**File:** `services/ml_service/models/registry.py` (MODIFY)

Changes:
- Add `feature_version` to `ModelEntry` — which feature set was used
- Add `champion` / `challenger` / `retired` status (replace simple `is_active` bool)
- Add `promoted_at`, `retired_at` timestamps
- Add `performance_live` dict — actual live prediction accuracy (filled by feedback loop)
- Validation on load: if model's `feature_version` != current `FEATURE_NAMES` hash, refuse to serve and log error

### 14.3 — Automated Retraining Scheduler

**File:** `services/scheduler_service/retrain_scheduler.py` (NEW or MODIFY existing)

Triggers:
1. **Time-based:** Every 7 days, retrain on latest 90 days of data
2. **Volume-based:** After 500 new labeled trades since last training
3. **Performance-based:** If live accuracy drops below train accuracy by >10%

Flow:
- Trigger fires → fetch bars from `market_data_service` → compute features via `feature_service` → train XGBoost → register as `challenger` in registry → do NOT auto-promote

### 14.4 — Champion/Challenger Promotion

**File:** `services/ml_service/promotion.py` (NEW)

Promotion criteria (all must pass):
- Challenger `test_accuracy` >= champion `test_accuracy`
- Challenger `roc_auc` >= champion `roc_auc` − 0.02 (small regression allowed)
- Challenger trained on ≥ 80% of champion's data volume
- Challenger `feature_version` matches current FEATURE_NAMES
- Manual operator approval OR auto-promote if all metrics are strictly better

Flow:
- Challenger meets criteria → promote to `champion`, demote old champion to `retired`
- Persist promotion event to `audit_events` with full evidence

### 14.5 — Live Outcome Feedback Loop

**File:** `services/ml_service/feedback.py` (NEW)

Purpose: Label live trades with actual outcomes and feed back to training.

Flow:
- When a trade closes (outcome = WIN/LOSS from `trade_outcomes` table):
  - Look up the `si_decisions` record that approved this trade
  - Record: `(signal_features, predicted_win_probability, actual_outcome)`
  - Persist to new `ml_feedback` table
- This table becomes training data for next retrain cycle

**New table: `ml_feedback`**

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid (PK) | Record ID |
| signal_id | text | Original signal |
| model_version | text | Which model made the prediction |
| predicted_probability | real | Model's P(win) |
| actual_outcome | text | WIN / LOSS / BREAKEVEN |
| features_json | jsonb | Feature vector at prediction time |
| created_at | timestamp | When outcome was recorded |

### 14.6 — Approval Threshold Tuning

**File:** `services/ml_service/threshold_tuner.py` (NEW)

Replace hardcoded 0.60 with evidence-based threshold:
- Using `ml_feedback` data, compute precision-recall curve
- Find threshold that maximizes: `precision * recall` (F1-optimal) OR `precision` at minimum recall of 0.3 (conservative)
- Store optimal threshold in model registry entry
- Inference uses model-specific threshold instead of global 0.60

### 14.7 — Model Monitoring Dashboard

**Endpoints (add to `services/ml_service/main.py`):**
- `GET /models/monitoring` — Live vs backtest accuracy comparison
- `GET /models/drift` — Feature distribution drift (KL divergence)
- `GET /models/feedback-summary` — Predicted vs actual outcome rates

### 14.8 — Tests

- `services/tests/test_feature_store.py` — Cache hit/miss, version mismatch detection
- `services/tests/test_model_promotion.py` — Champion/challenger criteria, edge cases
- `services/tests/test_feedback_loop.py` — Outcome labeling correctness
- `services/tests/test_threshold_tuner.py` — F1-optimal threshold computation
- `services/tests/test_retrain_scheduler.py` — Trigger conditions

### 14.9 — Verification Checklist

- [ ] Feature store returns same features for same input (deterministic)
- [ ] Model with wrong feature_version is refused at inference
- [ ] Retraining triggered automatically after 7 days (mock time)
- [ ] Challenger model does NOT auto-serve until promoted
- [ ] Live trade outcomes flow into ml_feedback table
- [ ] Threshold tuner produces different threshold than hardcoded 0.60
- [ ] Feature drift detection fires when distribution shifts > 2 std devs

---

## Phase 15 — Observability (Production Level)

**Goal:** Wire the existing observability infrastructure (which is surprisingly complete) to actual runtime instrumentation. Make alerts actionable.

**Why it matters:** You have 41 Prometheus alert rules, a 13-panel Grafana dashboard, and an observability engine with metrics aggregation. But none of it is wired to real `prom-client` counters. It's like having a fire alarm system with no sensors.

### 15.1 — Wire Prometheus Client

**File:** `artifacts/api-server/src/lib/metrics/prometheus.ts` (NEW)

Install `prom-client` and create actual metric objects matching the alert rules:

**Trading metrics (matching `godsview_trading` alerts):**
- `godsview_kill_switch_active` (Gauge)
- `godsview_breaker_level` (Gauge)
- `godsview_daily_realized_pnl` (Gauge)
- `godsview_daily_realized_pnl_pct` (Gauge)
- `godsview_consecutive_losses` (Gauge)
- `godsview_unmatched_fills` (Gauge)
- `godsview_open_positions` (Gauge)
- `godsview_fills_today` (Counter)

**Execution metrics (matching `godsview_execution` alerts):**
- `godsview_slippage_bps` (Histogram, buckets: 0.5, 1, 2, 5, 10, 20)
- `godsview_order_rejections_total` (Counter, labels: reason)
- `godsview_gross_exposure_pct` (Gauge)
- `godsview_margin_usage_pct` (Gauge)
- `godsview_execution_latency_ms` (Histogram)

**Brain/SI metrics (matching `godsview_brain` alerts):**
- `godsview_brain_health` (Gauge per subsystem)
- `godsview_brain_cycle_duration_ms` (Histogram)
- `godsview_signal_engine_last_signal_age_seconds` (Gauge)
- `godsview_brain_errors_total` (Counter)

**Infrastructure metrics (matching `godsview_infrastructure` alerts):**
- `godsview_websocket_connected` (Gauge)
- `godsview_db_pool_active` (Gauge)
- `godsview_db_pool_max` (Gauge)
- `godsview_python_service_up` (Gauge, labels: service_name)

**Expose:** `GET /metrics` endpoint using `prom-client` registry.

### 15.2 — Instrument Existing Code

**Files to modify (add metric updates):**
- `src/engines/paper_trading_engine.ts` — Increment trade counters, update PnL gauges
- `src/engines/live_launch_engine.ts` — Update kill switch, breaker level gauges
- `src/engines/autonomous_mode_engine.ts` — Brain cycle duration, error counters
- `src/lib/execution/fill_reconciler.ts` — Fill counters, slippage histogram, unmatched fills
- `src/lib/execution/order_state_machine.ts` — Rejection counters, execution latency
- `src/middlewares/metrics_middleware.ts` — Replace placeholder with real prom-client usage

### 15.3 — Structured Logging with Correlation IDs

**File:** `artifacts/api-server/src/middlewares/correlation.ts` (NEW)

- Generate `X-Correlation-ID` header on each request (or use incoming)
- Attach to all log entries via AsyncLocalStorage
- Pass to Python services via header (they already have structlog)
- Add `correlation_id` to `orders`, `fills`, `audit_events` tables

**File:** `services/shared/logging.py` (MODIFY)
- Read `X-Correlation-ID` from incoming request headers
- Bind to structlog context for all downstream logs

### 15.4 — Alertmanager Configuration

**File:** `monitoring/alertmanager.yml` (NEW)

Route alerts to appropriate channels:
- **Critical** (kill switch, daily loss breach, instance down): immediate notification
- **Warning** (slippage elevated, consecutive losses, brain latency): batched every 5 minutes
- **Info** (model retrained, strategy promoted): daily digest

For now, use webhook receiver (configurable endpoint). Production will use Slack/PagerDuty.

### 15.5 — Health Dashboard Additions

**File:** `monitoring/grafana-dashboard.json` (MODIFY)

Add panels for:
- Strategy evolution cycle status
- SI model Brier score trend
- Execution slippage distribution (from Phase 12)
- Alignment divergence scores (from Phase 13)
- Model champion vs challenger accuracy (from Phase 14)

### 15.6 — Python Service Health Probes

**Files:** All services in `services/*/main.py` (MODIFY)

Add to each service's `/health` endpoint:
- Uptime seconds
- Last successful operation timestamp
- Dependency connectivity (DB, Alpaca, other services)
- Memory usage

Expose as Prometheus metrics via `/metrics` endpoint per service.

### 15.7 — Tests

- `src/__tests__/prometheus_metrics.test.ts` — All metrics registered, correct types
- `src/__tests__/correlation_id.test.ts` — ID generated, propagated, logged
- `src/__tests__/health_probes.test.ts` — Service health endpoint contracts

### 15.8 — Verification Checklist

- [ ] `GET /metrics` returns valid Prometheus text format
- [ ] All 41 alert rules have corresponding metric sources
- [ ] Grafana dashboard loads with real data (not all zeros)
- [ ] Correlation ID appears in both TS and Python logs for same request
- [ ] Kill switch activation triggers critical alert within 30 seconds
- [ ] Python services expose `/metrics` with uptime and dependency health

---

## Phase 16 — Proof of Edge

**Goal:** Run one strategy through paper trading for 30 days and produce a verifiable evidence packet proving (or disproving) edge.

**Why it matters:** Everything built in Phases 12–15 is infrastructure. Phase 16 is where it all gets tested against market reality. Without this, GodsView remains "designed" but not "proven."

### 16.1 — Paper Trading Certification Program

**File:** `artifacts/api-server/src/engines/paper_certification.ts` (NEW)

Four-phase certification, each with pass/fail criteria:

**Phase A — Signal Quality (Days 1–7)**
- Run strategy in signal-only mode (no execution)
- Record all generated signals
- Criteria: ≥20 signals generated, ≥60% pass SI quality filter, signal rate consistent (no clustering)

**Phase B — Execution Simulation (Days 8–14)**
- Enable paper execution
- Criteria: ≥10 paper trades executed, all orders fill within expected parameters, no system errors

**Phase C — Performance Validation (Days 15–25)**
- Continue paper trading, accumulate results
- Criteria: Win rate ≥ 48%, Sharpe ≥ 0.5, max drawdown ≤ 15%, profit factor ≥ 1.0

**Phase D — Alignment Verification (Days 26–30)**
- Run backtest on same 30-day window
- Compare paper results to backtest using alignment engine (Phase 13)
- Criteria: Divergence score < 0.35, slippage within 2x of backtest assumption

### 16.2 — Evidence Packet Generator

**File:** `artifacts/api-server/src/engines/evidence_packet.ts` (NEW)

Generates a structured evidence packet for strategy promotion decisions:

```typescript
interface EvidencePacket {
  strategy_id: string;
  certification_period: { start: Date; end: Date };

  // Phase A
  signal_quality: {
    total_signals: number;
    si_pass_rate: number;
    signal_distribution: Record<string, number>; // by hour, by regime
  };

  // Phase B
  execution_quality: {
    total_trades: number;
    avg_slippage_bps: number;
    fill_rate: number;
    avg_fill_latency_ms: number;
  };

  // Phase C
  performance: {
    win_rate: number;
    sharpe_ratio: number;
    sortino_ratio: number;
    profit_factor: number;
    max_drawdown_pct: number;
    total_pnl_pct: number;
    calmar_ratio: number;
    expectancy: number;
    trade_count: number;
  };

  // Phase D
  alignment: {
    backtest_sharpe: number;
    paper_sharpe: number;
    divergence_score: number;
    slippage_ratio: number; // actual / assumed
    verdict: 'ALIGNED' | 'DRIFTING' | 'DIVERGED';
  };

  // Overall
  certification_result: 'PASSED' | 'FAILED' | 'CONDITIONAL';
  failure_reasons: string[];
  operator_notes: string;
  generated_at: Date;
}
```

### 16.3 — Persistence

**New table: `certification_runs`**

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid (PK) | Run ID |
| strategy_id | text | Which strategy |
| current_phase | text | A / B / C / D / COMPLETE / FAILED |
| phase_a_result | jsonb | Signal quality metrics |
| phase_b_result | jsonb | Execution quality metrics |
| phase_c_result | jsonb | Performance metrics |
| phase_d_result | jsonb | Alignment metrics |
| certification_result | text | PASSED / FAILED / CONDITIONAL |
| evidence_packet | jsonb | Full evidence packet |
| started_at | timestamp | When certification began |
| completed_at | timestamp (nullable) | When certification completed |

### 16.4 — Daily Certification Dashboard

**Endpoint:** `GET /api/certification/status`

Returns:
- Current certification phase
- Days elapsed / remaining
- Running metrics for current phase
- Pass/fail status for completed phases
- Projected certification outcome

### 16.5 — Strategy Promotion Gate

**File:** `artifacts/api-server/src/engines/strategy_registry.ts` (MODIFY)

Add promotion gate:
- Transition from `paper_approved` → `live_assisted_approved` requires:
  - Certification result = PASSED
  - Evidence packet attached
  - Operator acknowledgment (or auto-approve if all metrics are strictly above threshold)
- Persist promotion decision with evidence packet reference

### 16.6 — The Actual 30-Day Run

This is not code — it's an operational procedure:

1. **Select strategy:** Choose the most promising strategy from the `PROVEN` tier
2. **Configure:** Set up paper trading with real Alpaca paper account
3. **Start certification:** `POST /api/certification/start { strategy_id, target_days: 30 }`
4. **Monitor daily:** Check certification dashboard, review daily reports
5. **At day 30:** System generates evidence packet automatically
6. **Review:** Operator reviews evidence packet
7. **Decision:** Promote, re-run, or retire

### 16.7 — Tests

- `src/__tests__/paper_certification.test.ts` — Phase transition logic, pass/fail criteria
- `src/__tests__/evidence_packet.test.ts` — Packet generation, completeness validation
- `src/__tests__/promotion_gate.test.ts` — Promotion requires evidence, rejects without it

### 16.8 — Verification Checklist

- [ ] Certification run persists across server restarts
- [ ] Phase transitions are sequential (can't skip Phase B)
- [ ] Failed phase stops certification with clear reason
- [ ] Evidence packet contains all required fields
- [ ] Promotion to live_assisted is blocked without PASSED certification
- [ ] Daily dashboard shows real-time certification progress

---

## Cross-Phase Dependencies

```
Phase 12 (Execution Layer)
    ↓ provides: orders, fills, execution_metrics tables
Phase 13 (Alignment Engine)
    ↓ provides: divergence_score, alignment_snapshots
Phase 14 (ML Pipeline)
    ↓ provides: champion model, feedback loop, threshold tuning
Phase 15 (Observability)
    ↓ provides: real-time monitoring, alerts
Phase 16 (Proof of Edge)
    ← consumes ALL of the above
```

Phase 12 is the foundation — nothing else works without persistent execution data. Phases 13 and 14 can be built in parallel after Phase 12. Phase 15 should be wired incrementally as each phase adds new metrics. Phase 16 is the integration test for everything.

## Estimated Scope

| Phase | New Files | Modified Files | New Tests | New DB Tables |
|-------|-----------|----------------|-----------|---------------|
| 12 | 5 | 3 | 50+ | 3 |
| 13 | 4 | 2 | 30+ | 1 |
| 14 | 5 | 2 | 40+ | 1 |
| 15 | 3 | 8 | 20+ | 0 |
| 16 | 3 | 1 | 20+ | 1 |
| **Total** | **20** | **16** | **160+** | **6** |

## Recommended Execution Order

1. **Phase 12** — 1-2 weeks (foundation, must be first)
2. **Phase 14.1–14.2** — 3-4 days (feature store + model versioning, no dependency on 12)
3. **Phase 13** — 1 week (needs Phase 12 execution_metrics data)
4. **Phase 14.3–14.7** — 1 week (needs feature store from 14.1)
5. **Phase 15** — Continuous (wire metrics as each phase completes)
6. **Phase 16** — 30 calendar days (but code setup is 2-3 days)

**Total code effort:** ~5-6 weeks
**Total calendar time including Phase 16 paper run:** ~8-9 weeks
