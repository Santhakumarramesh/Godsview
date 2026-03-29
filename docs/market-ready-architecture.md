# Godsview Market-Ready Architecture

This document converts the combined Godsview vision into a production-oriented architecture with concrete modules, APIs, and build phases.

## 1) Product Definition

Godsview is an **AI-assisted order-flow trading terminal for discretionary traders** that uses strict gates to reduce low-quality trades.

Primary outcome:
- higher signal quality
- lower fake-entry rate
- safer execution behavior
- explainable decisions with audit trail

## 2) End-to-End Decision Pipeline

1. Ingest market data (`bars`, `trade ticks`, `order book`).
2. Apply hard safety gates (session/news/degraded/liquidity/risk).
3. Build structure and order-flow features.
4. Classify market regime.
5. Detect setup candidates.
6. Score with C4 (Structure + Order Flow + Context + Confirmation).
7. Run meta-label decision (take / reduce / skip).
8. Apply ML probability and drift-aware confidence.
9. Run LLM veto/reasoning layer.
10. Final decision + size policy + execution rails.
11. Persist signal, trade, and audit events.
12. Feed outcomes into recall/performance diagnostics.

## 3) Module Layout (Repo-Mapped)

### Shared Strategy Core
- Path: `lib/strategy-core/src`
- Modules:
  - `types.ts`
  - `setupCatalog.ts`
  - `skEngine.ts`
  - `orderFlowEngine.ts`
  - `recallEngine.ts`
  - `scoring.ts`
  - `riskRules.ts`
  - `c4.ts`
  - `regimeEngine.ts`
  - `metaLabel.ts`

### API Server
- Path: `artifacts/api-server/src`
- Strategy/execution routes:
  - `routes/alpaca.ts`
  - `routes/strict_setup.ts`
  - `routes/system.ts`
  - `routes/orderbook.ts`
  - `routes/signals.ts`
- Model and safety libs:
  - `lib/ml_model.ts`
  - `lib/risk_engine.ts`
  - `lib/claude.ts`
  - `lib/strict_setup_engine.ts`

### Dashboard
- Path: `artifacts/godsview-dashboard/src`
- Main pages:
  - `pages/alpaca.tsx` (Live Intelligence)
  - `pages/system.tsx` (System Core / controls)
  - plus analytics/journal/signal pages

## 4) Strategy Families

Use one shared catalog with strict thresholds and allowed regimes.

Current implemented families:
- `absorption_reversal`
- `sweep_reclaim`
- `continuation_pullback`
- `cvd_divergence`
- `breakout_failure`

Target expansion families:
- VWAP/value setups
- opening-range breakout setups
- post-news continuation/fade setups

## 5) C4 and Meta Labeling

### C4 Gate
- Inputs:
  - structure score
  - order-flow score
  - context score
  - confirmation score
- Hard blocks:
  - SK/bias violations
  - regime mismatch
  - session/news/degraded data blocks

### Meta Label
- Inputs:
  - C4 decision
  - regime class
  - final quality
  - ML probability
  - fake-entry risk
- Outputs:
  - `TAKE` / `REDUCE` / `SKIP`
  - size multiplier (`1.0` / `0.5` / `0.0`)

## 6) Regime Engine

Regime classes:
- `trend_day`
- `mean_reversion_day`
- `breakout_expansion`
- `chop_low_edge`
- `news_distorted`

Policy:
- allow only compatible setup categories per regime
- block trading in `chop_low_edge` and `news_distorted` unless explicitly overridden

## 7) ML Layer and Validation

### Model
- L2-regularized logistic regression
- features from structure/order flow/recall/setup/regime

### Validation
- purged + embargo cross-validation metrics recorded in model metadata

### Drift Monitor
- compares recent vs baseline:
  - win-rate delta
  - quality delta
  - per-setup degradation
- statuses:
  - `stable`
  - `watch`
  - `drift`

## 8) API Contract (Current + Required)

### Implemented Core
- `POST /api/alpaca/analyze`
- `POST /api/alpaca/backtest`
- `POST /api/alpaca/backtest-batch`
- `GET /api/market/strict-setup`
- `GET /api/market/strict-setup/backtest`
- `GET /api/market/strict-setup/report`
- `GET /api/market/strict-setup/promotion-check`
- `GET /api/market/strict-setup/matrix`
- `GET /api/system/status`
- `POST /api/system/retrain`
- `GET /api/system/model/diagnostics`
- `GET /api/system/risk`
- `PUT /api/system/risk`
- `POST /api/system/risk/reset`
- `POST /api/system/kill-switch`
- `GET /api/system/audit`
- `GET /api/system/audit/summary`

### Next Additions (Planned)
- `GET /api/system/proof/by-setup`
- `GET /api/system/proof/by-regime`
- `GET /api/system/proof/oos-vs-is`
- `GET /api/system/drift/stream` (or polling endpoint with recent trend window)

## 9) Persistence and Audit Requirements

Every actionable decision should persist:
- timestamp
- symbol/instrument
- setup type
- regime class
- C4 decision + score
- meta-label decision + size multiplier
- ML probability
- Claude verdict
- final decision state
- rejection/block reasons
- order IDs when executed

## 10) Production Gates

Do not permit live writes when any of the below is true:
- kill switch active
- system mode is read-only
- degraded data block active
- max daily loss exceeded
- open exposure limit exceeded
- max concurrent positions reached
- session disallowed
- news lockout active

## 11) Phased Build Plan

### Phase A (Implemented baseline)
- shared strategy core + C4
- risk rails + kill switch
- audit trail and summaries

### Phase B (Implemented in current repo)
- regime engine
- meta-label gate
- purged/embargo CV metrics
- model drift diagnostics endpoint

### Phase C (Next)
- proof dashboard endpoints (setup/regime/oos)
- dashboard integration for drift/proof widgets
- execution mode visibility in all signal cards

### Phase D
- VWAP/value setup family
- opening-range breakout family
- post-news setup family

### Phase E
- setup-specific model instances
- dynamic weighting per regime
- automatic fallback under drift

## 12) Definition of Market-Ready for Godsview

For this repo, market-ready means:
- one deterministic decision path
- strict gates before every trade
- measurable edge by setup/regime
- replayable and auditable decisions
- controlled execution with clear fail-safe behavior

