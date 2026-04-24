# GodsView — Claude Design Master Spec

**Project:** GodsView
**Claude Design URL:** https://claude.ai/design/p/e730b54e-9cb4-4cc5-b0f2-a543bba49505
**Mode:** Hi-fi design, Interactive prototype
**Generated:** 2026-04-20
**Owner:** sri2sakthi49@gmail.com (Sakthi)

---

## Purpose

This is the canonical Claude Design brief that drives the GodsView visual + interaction prototype. It is the single source of truth for:

- The 68-page sidebar architecture
- The visual language (dark command-center theme)
- The Brain Hologram hero experience
- TradingView MCP / backtesting / recall / execution module structure
- AWS deployment surface

The prototype in Claude Design complements the production code in this repo — code owns the live system, Claude Design owns the UX/visual truth.

---

## Visual Language

- Background: `#0A0B0F` obsidian
- Accents: `#00E5FF` electric cyan, `#8B5CF6` neon violet, `#F5B700` plasma gold
- States: `#FF3B5C` alert red, `#00FFA3` success green
- Typography: Inter (UI), JetBrains Mono (numbers/tickers)
- Surfaces: glassmorphism cards with subtle glow, pulsing halos on live data

## Global Layout

- **Left sidebar:** 68 pages across 9 sections, collapsible
- **Top bar:** global symbol search, session state (pre/open/post), capital state, autonomy tier badge, emergency kill switch
- **Right rail:** AI copilot chat + live alerts stream

---

## Sidebar — 68 Pages, 9 Sections

### Section 1 — God Brain / Command Layer
1. God Brain Home
2. Brain Hologram View
3. Global System Health
4. Mission Control
5. Alerts Command Hub
6. Daily Briefing
7. Session Control
8. Strategy Radar

### Section 2 — Market Discovery / Scanning
9. Market Scanner
10. Watchlist Manager
11. Opportunity Queue
12. Regime Detection
13. Liquidity Environment
14. News & Sentiment Radar
15. Heat Candidate Board
16. Cross-Asset Pulse

### Section 3 — Chart / Structure Intelligence
17. TradingView Live Chart
18. Multi-Timeframe Structure
19. Order Block Engine
20. BOS / CHOCH Engine
21. Liquidity Sweep Mapper
22. Premium / Discount Map
23. Entry / Stop / Target Planner
24. Chart Annotation Studio

### Section 4 — TradingView MCP / Action Bridge
25. TradingView MCP Control
26. Pine Script Signal Registry
27. Webhook Event Router
28. TV Strategy Sync
29. Chart Action Bridge
30. TV Replay Connector

### Section 5 — Order Flow / Microstructure
31. Order Flow Dashboard
32. Heatmap Liquidity View
33. DOM / Depth Monitor
34. Footprint / Delta View
35. Absorption Detector
36. Imbalance Engine
37. Execution Pressure Map
38. Flow + Structure Confluence

### Section 6 — Quant Lab / Backtesting
39. Quant Lab Home
40. Backtesting Engine
41. Strategy Builder
42. Walk-Forward Validation
43. Performance Analytics
44. Regime Performance Matrix
45. Experiment Tracker
46. Promotion Pipeline

### Section 7 — Memory / Recall / Learning
47. Recall Engine
48. Case Library
49. Screenshot Memory Vault
50. Setup Similarity Search
51. Trade Journal AI
52. Learning Loop Dashboard

### Section 8 — Portfolio / Risk / Capital
53. Portfolio Command
54. Position Monitor
55. Allocation Engine
56. Correlation Risk
57. Drawdown Protection
58. Risk Policy Center
59. Pre-Trade Risk Gate
60. Capital Efficiency View

### Section 9 — Execution / Live Trading
61. Execution Center
62. Paper Trading Arena
63. Assisted Live Trading
64. Semi-Autonomous Mode
65. Autonomous Candidate Mode
66. Broker / Exchange Connector
67. Slippage & Fill Quality
68. Emergency Controls / Kill Switch

---

## Hero — Brain Hologram

- Floating 3D translucent brain mesh at center, slow rotation
- Ticker symbols as orbital nodes (AAPL, TSLA, NVDA, ES, BTC, …)
- Strategy sub-nodes branch from symbol nodes
- Agent signal paths as flowing particle streams
- Active symbols pulse with confidence-scaled glow
- Red/orange alert flashes in local zones
- Click routing: symbol → Chart / Flow, strategy → Quant Lab, trade → Execution Center, incident → Governance

## Key Differentiators (must not be weak)

- Brain hologram feels alive, not decorative
- TradingView MCP Control shows real tool registry + webhook router
- Backtesting Engine shows link to promotion pipeline
- Recall Engine shows similar-setup retrieval with visual analogs
- Execution pages show autonomy tier gating, not just buttons
- Mission Control includes AWS architecture view (ECS, Aurora, Redis, S3, Secrets Manager, CloudWatch, EventBridge)

---

## Cross-Module Flow

- **Discovery loop:** Market Scanner → Opportunity Queue → TV Chart → MTF Structure → Order Flow → Flow+Structure Confluence
- **Validation loop:** Confluence → Pre-Trade Risk Gate → Portfolio Command → Risk Policy Center → Allocation Engine
- **Execution loop:** Execution Center → Assisted/Semi/Auto → Broker Connector → Slippage → Emergency Controls
- **Learning loop:** Executed Trade → Trade Journal AI → Screenshot Vault → Case Library → Similarity Search → Quant Lab → Promotion Pipeline
- **Oversight loop:** Global System Health → Alerts Command Hub → Mission Control → Governance

---

## AWS Target Architecture

| Layer | Service |
| --- | --- |
| Frontend | S3 + CloudFront |
| Routing | ALB |
| Services | ECS Fargate microservices (godbrain, scanner, structure, tradingview-mcp, webhook-router, orderflow, quantlab, backtest, memory, portfolio, risk, execution, governance, notification) |
| Database | PostgreSQL / Aurora PostgreSQL |
| Cache | Redis / ElastiCache |
| Object storage | S3 |
| Secrets | AWS Secrets Manager |
| Monitoring | CloudWatch |
| Async/events | SQS / EventBridge |
| Streaming (future) | Kinesis or MSK |

---

## Phase Plan

1. Foundation shell, sidebar routing, God Brain Home, Market Scanner, TV Chart, AWS base
2. Scanner engine, watchlist, opportunity queue, MTF structure, OB, BOS/CHOCH, sweep, planner
3. TradingView MCP layer (embed, Pine registry, webhook router, sync, action bridge, replay)
4. Order flow (dashboard, heatmap, DOM, footprint, absorption, imbalance, pressure, confluence)
5. Quant Lab + Backtesting (backtest engine, strategy builder, walk-forward, analytics, regime matrix, experiment tracker, promotion)
6. Memory + Learning (recall, vault, case library, similarity, journal AI, learning loop)
7. Portfolio + Risk (command, position monitor, allocation, correlation, drawdown, policy, gate, efficiency)
8. Execution Modes (center, paper, assisted, semi-auto, autonomous, broker, slippage, kill switch)
9. Brain Hologram UX (3D brain, nodes, signal graph, alert glow, click-through)
10. Governance + Production Hardening (RBAC, audit, trust tiers, demotion, drift, alarms, replay, backup, autoscaling, deploy pipelines)

---

## Transition from Cowork → Claude Design

- All future visual iteration happens in Claude Design project `GodsView`
- Implementation continues in this repo
- Each Claude Design generation cycle saves a snapshot here under `docs/claude-design/` (follow-up phase)
