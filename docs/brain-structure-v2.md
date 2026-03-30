# GodsView Brain Structure v2

This document defines the canonical hierarchical brain model and node model for GodsView.
It is implementation-focused and aligns with current repo naming.

## 1) Top-Level Brain Hierarchy

```text
Supreme Brain
├── Market Universe Brain
│   ├── Symbol Brain: SPY
│   ├── Symbol Brain: QQQ
│   ├── Symbol Brain: NVDA
│   ├── Symbol Brain: TSLA
│   └── Symbol Brain: AAPL
├── Global Context Brain
│   ├── Macro Brain
│   ├── News Brain
│   ├── Market Regime Brain
│   ├── Sector Rotation Brain
│   └── Session Brain
├── Memory Brain
│   ├── Setup Memory
│   ├── Symbol Personality Memory
│   ├── Trade Outcome Memory
│   └── Similarity Retrieval Brain
├── Reasoning Brain
│   ├── Claude Auditor Node
│   ├── Contradiction Detector Node
│   ├── Scenario Ranking Node
│   └── Thesis Synthesis Node
├── Risk Brain
│   ├── Exposure Node
│   ├── Position Sizing Node
│   ├── Drawdown Guard Node
│   ├── Slippage Guard Node
│   └── Kill Switch Node
├── Execution Brain
│   ├── Order Intent Node
│   ├── Broker Routing Node
│   ├── Fill Tracking Node
│   ├── Exit Manager Node
│   └── Reconciliation Node
└── Evolution Brain
    ├── Performance Review Node
    ├── Calibration Node
    ├── Rule Tuning Node
    ├── Weight Optimizer Node
    └── Setup Pruning Node
```

## 2) Symbol Brain Internal Layers

```text
Symbol Brain
├── Perception Layer
│   ├── Tick Node
│   ├── Quote Node
│   ├── Candle Node
│   └── Volume Node
├── Timeframe Layer
│   ├── 1m Node
│   ├── 5m Node
│   ├── 15m Node
│   ├── 1h Node
│   └── Daily Node
├── Interpretation Layer
│   ├── Structure Node
│   ├── Order Flow Node
│   ├── Liquidity Node
│   ├── Volatility Node
│   └── Context Link Node
├── Memory Layer
│   ├── Setup Match Node
│   ├── Symbol Personality Node
│   ├── Outcome History Node
│   └── Similarity Node
├── Reasoning Layer
│   ├── Local Thesis Node
│   ├── Contradiction Node
│   └── Trigger/Invalidation Node
├── Risk Layer
│   ├── Trade Permission Node
│   ├── Sizing Node
│   ├── Stop/Target Node
│   └── Slippage Guard Node
└── Decision Layer
    ├── Attention Score Node
    ├── Readiness Score Node
    ├── Final Signal Node
    └── Execution Intent Node
```

## 3) Standard Node Contract

Each node should expose the same shape:

```text
Node
├── Metadata
├── Inputs
├── Internal Features
├── State
├── Scoring Output
├── Decision Output
└── Audit / Explanation
```

Required behavior:
- deterministic compute for the same input
- typed output contract
- explicit explanation trail
- block/allow rationale when applicable

## 4) Canonical Naming

Use these names consistently across code, telemetry, and UI.

Global:
- `SupremeBrain`
- `GlobalContextBrain`
- `MemoryBrain`
- `ReasoningBrain`
- `RiskBrain`
- `ExecutionBrain`
- `EvolutionBrain`

Symbol:
- `SymbolBrain`
- `TickNode`
- `QuoteNode`
- `CandleNode`
- `VolumeNode`
- `TimeframeNode`
- `StructureNode`
- `OrderflowNode`
- `LiquidityNode`
- `VolatilityNode`
- `ContextLinkNode`
- `SetupMatchNode`
- `SymbolPersonalityNode`
- `OutcomeHistoryNode`
- `SimilarityNode`
- `LocalThesisNode`
- `ContradictionNode`
- `TriggerInvalidationNode`
- `TradePermissionNode`
- `SizingNode`
- `StopTargetNode`
- `SlippageGuardNode`
- `AttentionScoreNode`
- `ReadinessScoreNode`
- `FinalSignalNode`
- `ExecutionIntentNode`

## 5) Minimum Production Brain (v1)

```text
SupremeBrain
├── GlobalContextBrain
├── SymbolBrain
│   ├── TickNode
│   ├── 1m TimeframeNode
│   ├── 5m TimeframeNode
│   ├── 15m TimeframeNode
│   ├── StructureNode
│   ├── OrderflowNode
│   ├── MemoryNode
│   ├── ReasoningNode
│   ├── RiskNode
│   └── FinalSignalNode
├── ExecutionBrain
└── EvolutionBrain
```

## 6) Execution Sequence

```text
Raw Market Data
→ Perception Nodes
→ Timeframe Nodes
→ Interpretation Nodes
→ Memory Nodes
→ Reasoning Nodes
→ Risk Nodes
→ Decision Nodes
→ Execution Intent
```

## 7) Current Repo Mapping

- Python node pipeline: `godsview-openbb/app/nodes/*`
- Orchestrator and stage trace: `godsview-openbb/app/agents/orchestrator.py`
- Consciousness board artifact: `godsview-openbb/data/processed/latest_consciousness_board.json`
- API normalization and board endpoint: `artifacts/api-server/src/routes/system.ts`
- Brain update/evolve APIs: `artifacts/api-server/src/routes/brain.ts`
- UI operator panel: `artifacts/godsview-dashboard/src/pages/system.tsx`

