# GodsView Massive Brain v1 Spec

This spec converts the symbol-native, multi-agent brain concept into a production implementation plan for the current GodsView repo.

## 1) Product Thesis

GodsView v1 should not be "another multi-agent trading bot."  
It should be an **execution-aware symbol memory system**:

- one persistent brain per symbol
- global context shared across symbols
- strict risk-first decisioning
- execution quality memory as a first-class signal
- evolutionary updates based on realized outcomes

## 2) System Topology

```text
MassiveBrain
├── BrainScheduler
├── BrainPoolManager
├── GlobalWorldBrain
├── SymbolBrainWorkers[N]
├── CandidateRanker
├── ClaudeReasoner
├── RiskController
├── ExecutionController
├── EvolutionController
└── MemoryGraph
```

### Component responsibilities

- `BrainScheduler`: cadence control, symbol refresh intervals, workload budgets.
- `BrainPoolManager`: worker lifecycle, concurrency, health, restarts.
- `GlobalWorldBrain`: macro/news/session/regime state.
- `SymbolBrainWorkers`: symbol-local perception, structure, flow, context-link, memory-link.
- `CandidateRanker`: attention allocation and top-k selection.
- `ClaudeReasoner`: structured thesis/contradiction pass for high-value candidates only.
- `RiskController`: hard gate authority (`allow/watch/block`).
- `ExecutionController`: intent → broker routing → fills → reconciliation.
- `EvolutionController`: updates DNA, setup decay, confidence calibration.
- `MemoryGraph`: persistent symbol/setup/execution identity.

## 3) Symbol Brain Contract

Each symbol worker should produce a strict state object:

- `symbol`
- `ts`
- `timeframes` (1m/5m/15m/1h/1d)
- `structure`
- `orderflow`
- `context`
- `memory`
- `reasoning` (nullable before reasoner pass)
- `risk`
- `finalDecision` (nullable until gated)

Reference schemas already exist in:
- `lib/common-types/src/nodes.ts`

## 4) Attention Allocation (Compute Budgeting)

All symbols should not receive equal compute.

### Score

```
attention =
  0.30 * structure +
  0.22 * orderflow +
  0.12 * context +
  0.16 * memory +
  0.10 * reasoning +
  0.10 * risk
```

### Runtime policy

- Tier 0 (`all symbols`): lightweight update cycle.
- Tier 1 (`top 20`): deep node refresh.
- Tier 2 (`top 5`): full reasoning + risk + execution intent.

## 5) Message Flow (Canonical)

```text
market.tick.received
market.candle.closed
→ feature.tick.computed
→ feature.timeframe.computed
→ structure.updated
→ orderflow.updated
→ context.updated
→ memory.updated
→ reasoning.requested
→ reasoning.completed
→ risk.evaluated
→ signal.generated
→ trade.intent.created
→ order.submitted
→ fill.received
→ position.updated
→ trade.closed
→ feedback.recorded
→ evolution.recalculated
```

Topic constants currently live in:
- `godsview-openbb/app/bus/topics.py`

## 6) Memory Graph Design (v1)

Identity memory should be explicit and queryable.

### Memory dimensions

- `symbol_identity`: trendiness, fakeout tendency, news sensitivity, session behavior.
- `setup_identity`: expectancy, decay trend, regime-specific reliability.
- `execution_identity`: slippage, fill quality, spread expansion at trigger/exit.

### Existing baseline tables

- `brain_entities`
- `brain_relations`
- `brain_memories`
- `brain_cycles`
- `brain_consciousness_snapshots`
- `brain_evolution_reviews`

Source:
- `godsview-openbb/migrations/001_brain_tables.sql`

### Next migration target (required)

Add durable tables for:

- `trade_intents`
- `orders`
- `fills`
- `positions`
- `signal_layer_scores`
- `llm_reasoning_logs`

## 7) Claude Reasoning Contract

Claude should consume structured summaries only (not raw tick noise).

### Required outputs

- `verdict`
- `confidence`
- `thesis`
- `contradictions`
- `triggerConditions`
- `blockConditions`
- `recommendedDirection`
- `recommendedEntryType`
- `reasoningScore`

### Guardrails

- strict JSON schema validation
- retry-on-invalid with bounded attempts
- deterministic fallback when unavailable
- never bypass risk controller

Prompt templates currently exist in:
- `godsview-openbb/app/prompts/reasoning_v1.md`
- `godsview-openbb/app/prompts/post_trade_review_v1.md`

## 8) Execution-Aware Intelligence (Differentiator)

Before final approval, compute `executionRealismScore`:

- expected slippage by symbol/session
- spread stability
- fill probability by order style
- exit difficulty estimate

If poor execution realism, downgrade or block even when setup quality is high.

## 9) Runtime States

Use compact, auditable decision states:

- `allow`
- `watch`
- `block`

Surface reason codes for every block.

## 10) Scaling Plan (100+ symbols)

### Stage A (5 symbols)

- SPY, QQQ, NVDA, TSLA, AAPL
- 1m/5m/15m
- paper mode only

### Stage B (20 symbols)

- attention-tier scheduler enabled
- top-k reasoner routing

### Stage C (100 symbols)

- worker pool autoscaling
- queue backpressure controls
- stale-state invalidation

## 11) Failure Policy

On any of the following, force `watch/block`:

- stale market bars
- missing orderflow
- invalid reasoning schema
- risk state unavailable
- execution route degraded

## 12) Current Repo Mapping

- API orchestration and governance:
  - `artifacts/api-server/src/routes/system.ts`
  - `artifacts/api-server/src/routes/brain.ts`
- Symbol-node pipeline:
  - `godsview-openbb/app/nodes/*`
  - `godsview-openbb/brain_loop.py`
- Bridge:
  - `artifacts/api-server/src/lib/brain_bridge.ts`
- Operator UI:
  - `artifacts/godsview-dashboard/src/pages/system.tsx`

## 13) Definition of Done (Massive Brain v1)

Massive Brain v1 is done when:

1. Symbol workers run in parallel with deterministic outputs.
2. Attention allocator routes top-k symbols to reasoning.
3. Reasoning uses strict schema validation and bounded retry.
4. Risk gate remains final authority.
5. Execution identity influences approval decisions.
6. Every signal has a trace from symbol state to order/fill outcomes.
7. Evolution updates symbol/setup/execution identity from outcomes.

