# Phase 103 — Market-Ready Completion Suite

The Phase 103 layer closes the final gap from "97% production-ready" to a
true market-ready GodsView. It is purely additive: every module is
self-contained, has zero impact on existing routes, and integrates only
through well-defined imports.

## Modules

| Module | Path | Purpose |
| --- | --- | --- |
| Broker Reality | `broker_reality/` | Order → Pending → Accepted → Partial/Filled/Cancelled/Rejected/Expired FSM, WS ingestor, reconciliation service, slippage stats |
| Recall Engine | `recall_engine/` | Deterministic 128-dim hashed embeddings, similarity search over historical setups, recall-based confidence multiplier, JSON persistence |
| Multi-Agent System | `agents/` | Explicit Signal / Validation / Risk / Governance / Execution / Learning agents communicating over an in-process AgentBus with full per-decision traces |
| Quant Lab Unified | `quant_lab_unified/` | One façade over strategy registration, backtest tracking, ranking, tier-based promotion (experimental → paper → live) |
| Fusion + Explain | `fusion_explain/` | Per-trade rationale: signals used vs rejected, confidence breakdown, governance vetoes |
| Order Flow L2 | `orderflow_l2/` | L2 book ingestion, liquidity walls, absorption detection, imbalance, cumulative delta, continuation probability |
| E2E Pipeline | `e2e_pipeline/` | Single `runE2E()` entry tying signal → fusion → agents → execution → orderflow context |
| Production Gates | `production_gates/` | `runSoak()` harness with latency p50/p95/p99 + error budget, `validateAlpacaPaperRoundTrip()` for live or simulated parity check |

## REST API

All Phase 103 endpoints are mounted at `/api/phase103`:

```
POST /api/phase103/broker/orders         submit a new order
GET  /api/phase103/broker/orders         list lifecycle records
GET  /api/phase103/broker/orders/:cid    fetch a single record
POST /api/phase103/broker/orders/:cid/cancel
GET  /api/phase103/broker/slippage       aggregate slippage stats
POST /api/phase103/broker/reconcile      reconcile against broker snapshot

POST /api/phase103/recall/setups         persist a setup + outcome
POST /api/phase103/recall/similar        top-K similar matches
POST /api/phase103/recall/summary        win-rate + failure modes
GET  /api/phase103/recall/size

GET  /api/phase103/agents/trace/:decision_id
GET  /api/phase103/agents/recent

POST /api/phase103/lab/strategy          register a strategy
GET  /api/phase103/lab/strategy
POST /api/phase103/lab/backtest          record a backtest result
GET  /api/phase103/lab/rank              ranked best score per strategy
POST /api/phase103/lab/promote/:id       evaluate + apply tier promotion

POST /api/phase103/explain/fuse          build explainability record
GET  /api/phase103/explain/decision/:id
GET  /api/phase103/explain/recent

POST /api/phase103/orderflow/book        ingest L2 snapshot
POST /api/phase103/orderflow/trade       ingest trade print
GET  /api/phase103/orderflow/state/:symbol

POST /api/phase103/e2e/run               run a single decision end-to-end

POST /api/phase103/gates/soak            time-bounded soak (≤5m via API)
POST /api/phase103/gates/paper-validate  paper round-trip parity test

GET  /api/phase103/health
```

## How to run

```
# typecheck
corepack pnpm --filter @workspace/api-server typecheck

# unit tests (vitest, includes phase103 suite)
corepack pnpm --filter @workspace/api-server test

# soak from CLI (in-process)
node --import tsx -e "import('./api-server/src/lib/phase103/production_gates/index.js').then(m=>m.runSoak({duration_ms:60000,rate_per_sec:50,dry_run:true})).then(r=>console.log(r))"

# Alpaca paper validation (provide alpaca submit/poll callbacks)
# see lib/phase103/production_gates/index.ts validateAlpacaPaperRoundTrip
```

## Production gate criteria (the 100% bar)

A release is **market ready** only when:

1. `runSoak({ duration_ms: 48*3600*1000, rate_per_sec: ≥10, dry_run: false })`
   reports `passed: true` with `error_pct ≤ 0.5%`, `latency_ms_p99 ≤ 500ms`,
   and zero illegal lifecycle transitions.
2. `validateAlpacaPaperRoundTrip()` against the live Alpaca paper endpoint
   reports `passed: true` with `slippage_bps` within historical norms.
3. Reconciliation drift reports zero `critical` entries over the last
   24 hours of paper trading.
4. All Phase 103 vitest cases green alongside the existing test matrix.

Once all four hold, the system is cleared for assisted-live deployment.
