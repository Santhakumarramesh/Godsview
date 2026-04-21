# GodsView — Implementation Blueprint

**Version:** 1.0
**Date:** 2026-04-18
**Status:** Authoritative plan for the full 15-phase trading-OS rebuild
**Owner:** Sakthi (sri2sakthi49@gmail.com)
**Repo:** https://github.com/Santhakumarramesh/Godsview

---

## What this document is

The complete implementation blueprint for taking GodsView from its
current state (~40-50% against the trading-OS vision; 100% against
the narrower v1.7.0 launch checklist) to a production-grade,
evidence-driven, multi-agent AI trading operating system on AWS.

This is **the plan you can hold the implementer to.** Every phase
has a defined exit criteria, a PR-by-PR breakdown, a rollback path,
and verification gates. No phase ships without proof.

## What this document is *not*

- A promise that GodsView will become "the best AI in the world."
  That depends on data quality, model quality, latency, risk
  control, and live results over years. What it can be is the
  strongest *realistic* AI trading OS, with deterministic safety,
  continuous bidirectional learning, and operator-grade evidence.
- A live document that auto-updates. Version-bump it when the
  architecture changes (folder layout, service boundaries, schema
  shape). Per-phase HANDOFFs in `/mnt/Godsview/phase-N/HANDOFF.md`
  capture per-phase reality.
- A replacement for `docs/OPERATOR_RUNBOOK.md` (day-2 ops) or
  `docs/AWS_DEPLOY.md` (CDK reference). Those stay authoritative
  for their narrow scopes.

---

## Mission statement

> Build the most evidence-driven AI trading operating system possible:
> deterministic safety as the floor, continuous bidirectional learning
> as the engine, real order-flow evidence as the truth, multi-agent
> reasoning as the brain, and production-grade AWS operations as the
> chassis.

Five non-negotiables:

1. **Deterministic safety wins.** No reasoning layer can bypass risk
   gates, exposure limits, or the kill switch.
2. **Bidirectional calibration is continuous.** Backtests inform
   live eligibility; live fills update calibration, slippage models,
   and trust scores. The loop never stops.
3. **Every decision is replayable.** From inbound webhook to filled
   order, every step has an audit trail and an attached evidence
   packet (signal, order flow, screenshot, regime tag, AI reasoning).
4. **Promotion is gated, demotion is automatic.** Strategies move
   forward only with evidence; they move back the moment trust
   degrades.
5. **The operator is in control.** The system runs autonomously
   *within bounds*; the operator can pause, demote, liquidate, or
   rewind at any time, with a one-click path from the UI.

---

## Architecture decisions (locked)

These five decisions gate the entire blueprint. They are locked here
so every downstream phase can build on them. Override only with a
new architecture version bump.

### AD-1. Frontend: Next.js 15 (App Router) + React 19

- **Why:** Server components for the heavy intelligence pages (lower
  initial JS), built-in routing, image optimization, edge caching,
  middleware for auth. Replaces the current React+Vite tree
  (`artifacts/godsview-dashboard`).
- **Migration:** Phase 9 absorbs the Vite tree under a `legacy/`
  prefix while the Next.js shell ships in parallel. Both run until
  the Next.js shell reaches feature parity, then the Vite tree
  retires.

### AD-2. API control plane: FastAPI (Python 3.11)

- **Why:** Type safety via Pydantic, async-first, openAPI by default,
  best-in-class for ML/quant services. Existing Python services
  (`services/`) already lean this way. Replaces the current Node/
  Express api-server (`artifacts/api-server`).
- **Migration:** Phase 1 stands up the FastAPI control plane on a
  separate path (`/v2/*`) with the same Postgres + Redis backing.
  Express api-server keeps serving v1 routes until per-route parity
  is reached. Phase 14 retires `/v1/*`.

### AD-3. Database: Postgres 16 (RDS Multi-AZ in prod)

- **Why:** ACID, JSONB for flexible event payloads, native
  partitioning for time-series tables (signals, fills, orderflow
  snapshots), strong tooling, no surprises. Already in use.
- **Schema migrations:** Alembic (Python). Migrations live in
  `services/migrations/`.

### AD-4. Event bus: Redis Streams (dev) → AWS SQS + EventBridge (prod)

- **Why:** Redis Streams gives us cheap, ordered, replayable
  pub/sub for dev and CI. SQS+EventBridge gives us managed,
  durable, fan-out semantics for prod. Same producer/consumer
  abstraction (`lib/event_bus.py`) over both.
- **Topics:** Defined in `reference/ARCHITECTURE.md` §Event Bus.

### AD-5. Object store: S3 (prod) / MinIO (dev)

- **Why:** All artifacts (backtest reports, screenshots, replay
  bundles, model snapshots) need a versioned, lifecycle-managed
  store. S3 is the natural choice; MinIO is the dev-equivalent
  with the same SDK.

### Deferred decisions (revisit at Phase 8)

- **Vector store** for memory/recall. Likely pgvector (in the same
  Postgres) for v1; revisit Pinecone/Weaviate at Phase 8 if recall
  latency or scale forces it.
- **LLM provider mix.** Anthropic Claude for reasoning agents;
  smaller open-source for fast local pre-filters. Lock at Phase 8.

---

## Reference index

Long-form reference docs live under `reference/`. Read these once;
phase docs reference them by section.

| Doc | Purpose |
|-----|---------|
| [`reference/ARCHITECTURE.md`](reference/ARCHITECTURE.md) | Folder layout, service map, event bus, request tracing, RBAC |
| [`reference/DB_SCHEMA.md`](reference/DB_SCHEMA.md) | All ~30 Postgres tables with DDL, indexes, partitioning |
| [`reference/API_SURFACE.md`](reference/API_SURFACE.md) | All REST + SSE + WebSocket routes with schemas |
| [`reference/SIDEBAR_MAP.md`](reference/SIDEBAR_MAP.md) | All 68 dashboard pages with route, owner, RBAC |
| [`reference/AWS_RESOURCES.md`](reference/AWS_RESOURCES.md) | Full AWS resource map, dev vs prod deltas, costs |

---

## Phase index + dependency graph

15 phases, ~6-12 weeks of focused work each (depending on team size).
Phases 0-3 are sequential. From Phase 4 forward some can parallelize.

```
                            ┌──────────────────┐
                            │ Phase 0          │
                            │ Truth lock       │
                            └────────┬─────────┘
                                     │
                            ┌────────▼─────────┐
                            │ Phase 1          │
                            │ Platform spine   │
                            └────────┬─────────┘
                                     │
                  ┌──────────────────┼──────────────────┐
                  │                  │                  │
        ┌─────────▼────────┐ ┌──────▼──────────┐ ┌────▼─────────┐
        │ Phase 2          │ │ Phase 3         │ │ Phase 9      │
        │ Market data      │ │ MCP + webhooks  │ │ God Brain UI │
        └─────────┬────────┘ └──────┬──────────┘ │ (parallel)   │
                  │                  │            └──────┬───────┘
                  │                  │                   │
        ┌─────────▼──────────────────▼───────┐           │
        │ Phase 4                            │           │
        │ Order flow + screenshots           │           │
        └─────────┬──────────────────────────┘           │
                  │                                       │
        ┌─────────▼──────────┐                           │
        │ Phase 5            │                           │
        │ Continuous backtest│                           │
        └─────────┬──────────┘                           │
                  │                                       │
        ┌─────────▼──────────┐                           │
        │ Phase 6            │                           │
        │ Bidirectional cal  │                           │
        └─────────┬──────────┘                           │
                  │                                       │
        ┌─────────▼──────────┐    ┌────────────────┐    │
        │ Phase 7            │───▶│ Phase 8        │◀───┘
        │ Promotion pipeline │    │ Super-intel    │
        └─────────┬──────────┘    └────────┬───────┘
                  │                         │
                  └────────────┬────────────┘
                               │
                  ┌────────────▼─────────────┐
                  │ Phase 10                 │
                  │ AWS dev                  │
                  └────────────┬─────────────┘
                               │
                  ┌────────────▼─────────────┐
                  │ Phase 11                 │
                  │ AWS prod                 │
                  └────────────┬─────────────┘
                               │
                  ┌────────────▼─────────────┐
                  │ Phase 12                 │
                  │ Railway → AWS cutover    │
                  └────────────┬─────────────┘
                               │
                  ┌────────────▼─────────────┐
                  │ Phase 13                 │
                  │ Day-2 ops + drills       │
                  └────────────┬─────────────┘
                               │
                  ┌────────────▼─────────────┐
                  │ Phase 14                 │
                  │ Hardening                │
                  └────────────┬─────────────┘
                               │
                  ┌────────────▼─────────────┐
                  │ Phase 15                 │
                  │ First live cycle         │
                  └──────────────────────────┘
```

| # | Phase | Spec | Dependencies | Indicative effort |
|---|-------|------|--------------|-------------------|
| 0 | Truth lock + repo normalization | [`phases/PHASE_00_truth_lock.md`](phases/PHASE_00_truth_lock.md) | — | 1 week |
| 1 | Platform spine | [`phases/PHASE_01_platform_spine.md`](phases/PHASE_01_platform_spine.md) | 0 | 2-3 weeks |
| 2 | Market data + event ingestion | [`phases/PHASE_02_market_data.md`](phases/PHASE_02_market_data.md) | 1 | 2-3 weeks |
| 3 | TradingView MCP + webhook router | [`phases/PHASE_03_mcp_webhook.md`](phases/PHASE_03_mcp_webhook.md) | 1 | 1-2 weeks |
| 4 | Order flow + plotting + screenshots | [`phases/PHASE_04_orderflow.md`](phases/PHASE_04_orderflow.md) | 2, 3 | 4-6 weeks |
| 5 | Continuous backtesting engine | [`phases/PHASE_05_backtesting.md`](phases/PHASE_05_backtesting.md) | 4 | 4-6 weeks |
| 6 | Bidirectional live-vs-backtest calibration | [`phases/PHASE_06_calibration.md`](phases/PHASE_06_calibration.md) | 5 | 2-3 weeks |
| 7 | Promotion pipeline | [`phases/PHASE_07_promotion.md`](phases/PHASE_07_promotion.md) | 6 | 1-2 weeks |
| 8 | Super-intelligence layer | [`phases/PHASE_08_super_intel.md`](phases/PHASE_08_super_intel.md) | 7, 9 | 4-8 weeks |
| 9 | God Brain UI + 68 pages | [`phases/PHASE_09_god_brain_ui.md`](phases/PHASE_09_god_brain_ui.md) | 1 | 6-10 weeks (parallel from Phase 1) |
| 10 | AWS dev environment | [`phases/PHASE_10_aws_dev.md`](phases/PHASE_10_aws_dev.md) | 8 | 2 weeks |
| 11 | AWS prod environment | [`phases/PHASE_11_aws_prod.md`](phases/PHASE_11_aws_prod.md) | 10 | 1-2 weeks |
| 12 | Railway → AWS cutover | [`phases/PHASE_12_cutover.md`](phases/PHASE_12_cutover.md) | 11 | 1 week (mostly soak time) |
| 13 | Day-2 ops + runbook automation | [`phases/PHASE_13_day2_ops.md`](phases/PHASE_13_day2_ops.md) | 12 | 2 weeks |
| 14 | Hardening | [`phases/PHASE_14_hardening.md`](phases/PHASE_14_hardening.md) | 13 | 2-3 weeks |
| 15 | First live operator cycle | [`phases/PHASE_15_first_live.md`](phases/PHASE_15_first_live.md) | 14 | 4-8 weeks (operator-driven) |

**Total realistic timeline:** 9-15 months end-to-end with a focused
team. Compressible by parallelizing Phase 9 (UI) from Phase 1 onward.

---

## What "100% production-ready against the vision" means

The system is production-ready against the vision when **all of
these are simultaneously true** (not "shipped" — true in operating
reality):

- [ ] Real signals enter through TradingView/webhooks; idempotency
      proven; replay possible
- [ ] Live order book + trade tape ingested for the active symbol set;
      replay reconstructs any time window byte-identically
- [ ] Order flow features (delta, imbalance, absorption, FVG, OB)
      computed and persisted alongside raw events
- [ ] Every signal has an attached evidence packet (chart screenshot,
      order flow snapshot, regime tag, AI reasoning, prior similar cases)
- [ ] Strategies continuously backtest on a rolling window; results
      land in S3 + Postgres; promotion eligibility recomputed on
      every new run
- [ ] Live fills are reconciled against backtest expectations; trust
      score updates per fill; demotion fires when drift > threshold
- [ ] Promotion pipeline: draft → backtested → paper → assisted live
      → autonomous, each gate evidence-backed and audit-logged
- [ ] Multi-agent reasoning produces ranked actions, confidence
      scores, explanations, and veto reasons; never bypasses
      deterministic safety
- [ ] God Brain UI: critical pages (16) fully functional; remaining
      52 routed and integration-ready
- [ ] AWS prod: multi-AZ, autoscaled, monitored, alerted, rollback-tested
- [ ] Day-2 drills run quarterly; runbooks proven not just written
- [ ] One real strategy has completed the full lifecycle in live;
      operator confidence is evidence-based

Until every box is checked, the right number is not "100%" — it's
the percentage of boxes checked, weighted by risk. Phase HANDOFFs
report against this checklist explicitly.

---

## How phases are delivered

Each phase ships under the same discipline we used for v1.0.0-v1.7.0:

1. **Branch:** `phase-N-<short-name>` from latest `main` tag.
2. **PRs:** Each phase decomposes into 3-12 PRs (see per-phase spec).
   Each PR is independently reviewable and revert-able.
3. **Verification gate:** Every PR must pass workspace tsc, mypy,
   pytest, vitest, build, lint. CI enforces.
4. **HANDOFF:** Per-phase HANDOFF.md at `/mnt/Godsview/phase-N/`
   with: what shipped, file manifest, verification results, apply
   instructions, rollback, next phase prerequisites.
5. **Patch artifact:** `git format-patch` of the squashed phase
   commit at `/mnt/Godsview/phase-N/0001-phase-N-<name>.patch`.
6. **Tag:** `vM.N.0` on phase-merge to main. Tag schedule:
   - v2.0.0 = Phase 0 complete (truth-lock; major version bump
     because it touches every doc)
   - v2.1.0 = Phase 1, ..., v2.7.0 = Phase 7
   - v3.0.0 = Phase 8 complete (super-intelligence; major bump)
   - v3.1.0 = Phase 9 (UI), v3.2.0 = Phase 10, ...
   - v4.0.0 = Phase 15 complete (first live cycle survived)
7. **Update this blueprint.** Each phase's HANDOFF appends a
   "deviations from blueprint" section if reality diverged from plan.

---

## What's intentionally NOT in this blueprint

- **A specific strategy.** GodsView is the OS, not a strategy. The
  first strategy lands in Phase 15 as part of the live cycle.
- **Specific brokers beyond Alpaca.** Alpaca is the v1 broker.
  IBKR/Tradovate/Binance adapters are post-Phase-15 backlog.
- **Frontend pixel-perfect designs.** Phase 9 ships the structural
  UI; visual polish is post-v4.0.0 backlog.
- **Multi-tenant SaaS.** GodsView is single-operator (you, Sakthi)
  for v4.0.0. Multi-tenant is a v5+ conversation.
- **Compliance/regulatory framework.** Personal/prop trading scope
  only. Becoming a registered investment advisor or fund manager
  is out of scope for this blueprint.

---

## Open risks tracked at the blueprint level

| Risk | Mitigation | Owner |
|------|------------|-------|
| Order book vendor cost (L2) outpaces budget | Phase 4 evaluates 3 vendors before lock | Operator |
| FastAPI ↔ Express dual-stack lifetime exceeds 1 quarter | Hard sunset gate at Phase 14 | Implementer |
| Multi-agent latency makes live trading unviable | Phase 8 measures p95 against 250ms budget; falls back to deterministic-only if breached | Implementer |
| AWS spend spikes during initial deploys | Phase 10/11 use t4g instances + small RDS; cost alarms set at 1.5× expected | Operator |
| Operator over-trusts AI before evidence accumulates | Phase 15 enforces 30-day assisted-live minimum before any autonomous mode | Implementer |

---

## Document map (quick navigation)

```
/mnt/Godsview/blueprint/
├── BLUEPRINT.md                          ← you are here
├── reference/
│   ├── ARCHITECTURE.md
│   ├── DB_SCHEMA.md
│   ├── API_SURFACE.md
│   ├── SIDEBAR_MAP.md
│   └── AWS_RESOURCES.md
└── phases/
    ├── PHASE_00_truth_lock.md
    ├── PHASE_01_platform_spine.md
    ├── PHASE_02_market_data.md
    ├── PHASE_03_mcp_webhook.md
    ├── PHASE_04_orderflow.md
    ├── PHASE_05_backtesting.md
    ├── PHASE_06_calibration.md
    ├── PHASE_07_promotion.md
    ├── PHASE_08_super_intel.md
    ├── PHASE_09_god_brain_ui.md
    ├── PHASE_10_aws_dev.md
    ├── PHASE_11_aws_prod.md
    ├── PHASE_12_cutover.md
    ├── PHASE_13_day2_ops.md
    ├── PHASE_14_hardening.md
    └── PHASE_15_first_live.md
```

---

## Sign-off

This blueprint is the contract between operator (Sakthi) and
implementer (Claude). Deviations require an explicit blueprint
version bump and a rationale entry in the affected phase's HANDOFF.

**v1.0** — initial publish, 2026-04-18, against repo state at tag
`v1.7.0` (Phase 14 complete in old phasing; "End-to-end webhook → SSE
integration test"). The 15-phase plan supersedes the
old phase numbering — old "Phase 14" maps to a subset of new
Phase 14 (Hardening).
