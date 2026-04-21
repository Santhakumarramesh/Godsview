# 00 · Overview

> GodsView is a self-improving, multi-agent trading intelligence system
> that combines structure, flow, memory, research, and execution into a
> single adaptive quant-style market brain.

## What v2 delivers

A production-grade control plane + web app + quant lab + execution
surface that, by the end of Phase 15, can:

1. Ingest TradingView signals via MCP.
2. Fuse market structure + order flow + macro context into a scored
   decision.
3. Recall similar historical setups with their outcomes.
4. Route through an auditable multi-agent reasoning loop.
5. Execute via Alpaca under a risk engine with a deterministic safety
   floor.
6. Feed every outcome back into the Quant Lab and calibration model.

## Why v2 (vs. the v1 tree)

v1 made the product demoable. v2 makes it operable:

- Typed, versioned API with canonical error envelopes.
- Audit-first data model — every mutation records actor + correlation.
- Governance tiers wrapping autonomy (paper → assisted → autonomous).
- Real CI with contract validation against the OpenAPI schema.
- A safety floor that defaults to "kill switch on" out of the box.

## System decomposition (11 cores)

| # | Core                              | Phase owner |
|---|-----------------------------------|-------------|
| 1 | TradingView MCP layer             | Phase 2     |
| 2 | Market Structure Engine           | Phase 2     |
| 3 | Order Flow Engine                 | Phase 3     |
| 4 | Fusion Engine                     | Phase 4     |
| 5 | Setup Detection Engine            | Phase 5     |
| 6 | Quant Lab (backtests + replay)    | Phase 6     |
| 7 | Recall & Memory Engine            | Phase 7     |
| 8 | Multi-Agent Brain + Learning      | Phase 8     |
| 9 | Execution & Risk (Alpaca)         | Phase 9     |
| 10| Portfolio Intelligence            | Phase 10    |
| 11| Governance & Autonomy             | Phase 11    |

Phase 0 (this PR set) does not ship any of the 11 cores. It ships the
monorepo, the auth-and-audit spine, the sidebar map, and the deployment
surface those 11 cores will be built on top of.
