# PHASES_8_TO_15.md — GodsView v2+ Blueprint

**Scope:** per-phase spec for the remaining eight phases of the v2
rebuild (calibration → promotion → agents → memory/recall → CI
hardening → replay → infra → launch). Same structure as
`PHASES_0_TO_7.md`: goal, scope, folder/file deliverables, DB DDL
deltas, API routes, UI pages, AWS resources, test strategy, exit
criteria, rollback, PR breakdown.

Companion to `PHASES_0_TO_7.md`, `BLUEPRINT.md`, and `reference/*`.

---

## Phase 8 — Calibration + promotion pipeline

**Tag at completion:** `v2.8.0`
**Branch:** `phase-8-calibration-promotion`
**Estimated PRs:** 7

### 8.1 Goal

Close the **bidirectional calibration loop**: backtest predictions
become the baseline slippage/fill model; live fills feed
`fill_divergence` which updates `calibration_snapshots`; drift gets
detected (PSI + KS) and strategies whose trust score drops below
threshold are **auto-demoted**. Promotion is state-machine-driven
with deterministic gates.

### 8.2 Scope

In:
- `services/calibration` — rebuild snapshots, compute drift, write
  `drift_events`, publish `calibration.rebuilt.v1` /
  `calibration.drift_detected.v1`
- `services/promotion` — FSM over `promotion_states`, auto-demote
  consumer, checks-suite runner, queue + approve/demote routes
- `trust_scores` rollup job
- Pages: `/strategies/[id]/trust`, `/strategies/[id]/promotion`,
  `/strategies/promotion-queue`, `/strategies/promotion-config`,
  `/execution/calibration`, `/execution/calibration/divergence`

### 8.3 Folder tree delta

```
services/calibration/
├─ app/
│  ├─ main.py
│  ├─ jobs/
│  │  ├─ rebuild.py                           # POST /v1/calibration/rebuild
│  │  ├─ drift.py                             # PSI, KS per feature
│  │  └─ scheduler.py                         # cron-like (daily + intraday)
│  ├─ math/
│  │  ├─ psi.py
│  │  ├─ ks.py
│  │  └─ slippage.py
│  └─ db/models/
│     ├─ calibration_snapshot.py
│     ├─ drift_event.py
│     └─ fill_divergence.py
├─ alembic/versions/001_calibration.py
└─ Dockerfile

services/promotion/
├─ app/
│  ├─ main.py
│  ├─ fsm.py                                  # state machine
│  ├─ checks/
│  │  ├─ registry.py                          # all deterministic checks
│  │  ├─ backtest_minimums.py
│  │  ├─ sharpe_floor.py
│  │  ├─ max_drawdown.py
│  │  ├─ calibration_slippage.py
│  │  ├─ live_shadow_alignment.py
│  │  └─ trust_floor.py
│  ├─ routes.py
│  ├─ consumers/
│  │  ├─ calibration_drift.py                 # auto-demote on drift
│  │  └─ fills_consumer.py                    # update trust on live fills
│  └─ db/models/
│     ├─ promotion_state.py
│     └─ trust_score.py
├─ alembic/versions/001_promotion.py
└─ Dockerfile

apps/web/app/
├─ strategies/
│  ├─ [id]/trust/page.tsx
│  ├─ [id]/promotion/page.tsx
│  ├─ promotion-queue/page.tsx
│  └─ promotion-config/page.tsx
└─ execution/
   ├─ calibration/page.tsx
   └─ calibration/divergence/page.tsx
```

### 8.4 DB DDL delta

- `calibration_snapshots`, `drift_events`, `fill_divergence`,
  `promotion_states`, `trust_scores`

### 8.5 API routes added

§3.5 promotion verbs (already documented), §3.10 full calibration
catalog, §3.11 promotion-specific routes.

### 8.6 Event bus topics

- `calibration.rebuilt.v1`, `calibration.drift_detected.v1`
- `promotion.state_changed.v1`

### 8.7 Bidirectional loop (the critical diagram)

```
    ┌─────────────┐   backtest    ┌──────────────┐
    │  backtest   │──completed──▶ │  calibration │
    │   runner    │               │   rebuild    │
    └─────────────┘               └──────┬───────┘
           ▲                             │ snapshot
           │                             ▼
    ┌──────┴──────┐  drift      ┌──────────────┐   auto-demote
    │  promotion  │◀─detected── │ drift engine │
    │   FSM       │             └──────────────┘
    └──────┬──────┘
           │ state_changed
           ▼
    ┌─────────────┐
    │ intelligence│ (Phase 10)  — adjusts decision weights
    └─────────────┘
           │
           │ live decisions
           ▼
    ┌─────────────┐
    │  execution  │ (Phase 7) — places orders
    └──────┬──────┘
           │ fills
           ▼
    ┌─────────────┐   fill_divergence
    │ calibration │◀─────────────────── updates snapshot
    └─────────────┘
```

Every arrow is an event on the bus; every arrow has a retry + DLQ.

### 8.8 Test strategy

- Unit: PSI + KS math against known distributions
- FSM: every legal transition + every illegal transition (reject)
- Gates: each promotion check positive + negative
- Integration: simulate a batch of live fills that diverge from
  calibration → observe drift event → observe auto-demote → observe
  `promotion.state_changed.v1` on bus
- Regression: strategy that passed at v2.6.0 still passes the gate
  at v2.8.0 (backwards compat of check registry)

### 8.9 Exit criteria

- [ ] Promotion checks suite runs on demand and returns per-check
       pass/fail with reasons
- [ ] Simulated drift within 1 % of historical PSI bounds does NOT
       trip auto-demote; drift > threshold DOES within 15 min
- [ ] Trust score time series visible on `/strategies/[id]/trust`
- [ ] Calibration snapshot rebuild job completes in < 10 min on 90 d
       of fill data
- [ ] `v2.8.0` tag + HANDOFF

### 8.10 Rollback

Auto-demote consumer can be disabled via `promotion.auto_demote=false`
feature flag. Reverting the phase is PR-by-PR.

---

## Phase 9 — Alerts, incidents, runbooks, notifications

**Tag at completion:** `v2.9.0`
**Branch:** `phase-9-alerts-incidents`
**Estimated PRs:** 5

### 9.1 Goal

Make operational noise actionable: every alarm has a runbook, every
incident has a timeline, every alert has an ack/resolve state, every
channel (Slack, email, PagerDuty) is explicitly mapped and tested.

### 9.2 Scope

In:
- Alerts routes (list, ack, resolve, snooze, stream)
- Incidents (declare, timeline, postmortem)
- Runbooks (list, detail, edit)
- Notification dispatcher: outbound Slack / email / PagerDuty webhook
- Channel mapping table + per-severity routing
- Pages: Alert Center, Incidents, Runbooks, Runbook editor

### 9.3 Folder tree delta

```
services/control_plane/app/alerts/
├─ routes.py, service.py, dispatcher.py
├─ channels/
│  ├─ slack.py, email.py, pagerduty.py
└─ db/models/
   ├─ alert.py, incident.py, incident_event.py, runbook.py

apps/web/app/
├─ alerts/page.tsx, incidents/page.tsx, runbooks/page.tsx
└─ admin/runbooks/page.tsx

ops/alerting/
├─ channel_map.yml
└─ severity_routing.yml
```

### 9.4 DB DDL delta

- `alerts`, `incidents`, `incident_events`, `runbooks`

### 9.5 API routes

§3.12 complete.

### 9.6 Event bus topics

- `alerts.raised.v1`, `alerts.ack.v1`

### 9.7 Test strategy

- Synthetic SLO burn → alert raised → routed to channel map → Slack
  test harness receives it → ack via UI → `alerts.ack.v1`
- Snooze TTL respected
- Runbook link appears in every alert payload

### 9.8 Exit criteria

- [ ] One channel per severity (P1→PagerDuty+Slack, P2→Slack,
       P3→email digest), all tested end-to-end
- [ ] Incident has a rendered postmortem page with timeline
- [ ] `v2.9.0` tag + HANDOFF

---

## Phase 10 — Multi-agent intelligence (first decisions)

**Tag at completion:** `v2.10.0`
**Branch:** `phase-10-intelligence`
**Estimated PRs:** 8

### 10.1 Goal

Stand up `services/intelligence` with the named agents from the
architecture (Structure, OrderFlow, Setup, Macro, Recall, Scoring,
Risk, Execution, Learning, Governance). Agents produce **advisory**
decisions; the deterministic safety floor (risk engine, kill switch,
promotion gates) has final say. Nothing an agent outputs can bypass
a deterministic gate.

### 10.2 Scope

In:
- `services/intelligence` with agent registry, tool calling, evidence
  tracking, run persistence
- Agents consume `signals.ingested.v1`, `orderflow.feature.v1`,
  `orderflow.snapshot.v1`; produce a proposed decision
- Control-plane `/v1/signals/:id/manual_decide` remains authoritative;
  a new `intelligence_auto_decide` feature flag (default OFF) enables
  the brain to decide on behalf of operator for specific strategy
  tiers
- `agent_runs` table stores every run with inputs, steps, tool calls,
  outputs, and linked `signal_decisions.id`
- UI: agents list, run detail, Ask (bespoke query), decision explorer

### 10.3 Folder tree delta

```
services/intelligence/
├─ app/
│  ├─ main.py
│  ├─ agents/
│  │  ├─ base.py                              # abstract: run(context) → decision
│  │  ├─ registry.py
│  │  ├─ structure.py
│  │  ├─ orderflow.py
│  │  ├─ setup.py
│  │  ├─ macro.py
│  │  ├─ recall.py                            # Phase 11 wires full recall
│  │  ├─ scoring.py
│  │  ├─ risk.py
│  │  ├─ execution_agent.py
│  │  ├─ learning.py
│  │  └─ governance.py
│  ├─ orchestrator/
│  │  ├─ run.py                               # fan-in agents → combined decision
│  │  └─ policy.py                            # when to auto-decide
│  ├─ tools/                                  # deterministic helpers agents call
│  │  ├─ get_structure.py
│  │  ├─ get_orderflow_features.py
│  │  ├─ query_recall.py                      # Phase 11 wires real thing
│  │  └─ get_calibration.py
│  └─ db/models/agent_run.py
├─ alembic/versions/001_intelligence.py
└─ Dockerfile

apps/web/app/intelligence/
├─ agents/page.tsx
├─ agents/runs/[id]/page.tsx
└─ ask/page.tsx
```

### 10.4 DB DDL delta

- `agent_runs` with `jsonb` columns for inputs/steps/outputs +
  `pgvector` embedding on step summaries for semantic search (Phase 11)

### 10.5 API routes

§3.14 (agents sub-section).

### 10.6 Event bus topics

Produces: `signals.decided.v1` (when `intelligence_auto_decide=true`)
Consumes: `signals.ingested.v1`, `orderflow.*.v1`,
`calibration.rebuilt.v1` (to refresh weights)

### 10.7 Safety rails (critical)

An agent proposal must pass all deterministic gates before an order
is placed:

1. Risk engine (exposure, daily loss, concentration, per-strategy cap)
2. Promotion state (strategy in `assisted_live` or `autonomous_active`)
3. Kill switch released
4. Calibration drift within bounds
5. Feature flag check

If any fails the proposal is persisted as `signal_decisions.decision =
rejected` with the reason; execution is never called.

### 10.8 Test strategy

- Unit: each agent has at least one "approve" and one "reject" case
- Orchestrator: weighted combination is deterministic given inputs
- End-to-end simulation: ingest N fixture signals; count proposals
  matching a ground-truth oracle within an agreed tolerance
- Bypass protection: a unit test asserts agent output alone cannot
  call execution — must go through the gate chain

### 10.9 Exit criteria

- [ ] Agents run on every ingested signal in shadow mode (decisions
       persisted but not acted on) with `intelligence_auto_decide=false`
- [ ] `/intelligence/agents/runs/:id` shows full provenance: inputs,
       each step, each tool call, final proposal, gate results
- [ ] Flipping `intelligence_auto_decide=true` under a specific
       strategy tier produces live decisions routed through all gates
- [ ] `v2.10.0` tag + HANDOFF

### 10.10 Rollback

`intelligence_auto_decide=false` disables live decisions; shadow runs
continue but do nothing. Service can be scaled to zero without losing
data.

---

## Phase 11 — Memory + recall + God Brain

**Tag at completion:** `v2.11.0`
**Branch:** `phase-11-memory-recall`
**Estimated PRs:** 6

### 11.1 Goal

Give the system a long-term memory and similarity recall: every
closed trade, every notable setup, every significant chart gets an
embedded `memory_entries` row; agents can query "similar past
situations" to inform proposals; operators get a recall panel per
signal. Also ship the **God Brain** view — a node graph of the
universe colored by regime and sized by opportunity strength.

### 11.2 Scope

In:
- `memory_entries` table with `pgvector` + cohort-stat helpers
- Embedding pipeline: every closed position + every pinned screenshot
  writes a memory entry with embedding + summary
- Recall routes (search, similar, missed)
- Regime detector (regime labels per symbol/session) persisted as
  memory metadata
- Pages: Memory browser, Memory search, Recall viewer, Regime
  monitor, God Brain, Universe heatmap, Sessions

### 11.3 Folder tree delta

```
services/intelligence/app/
├─ memory/
│  ├─ writer.py                               # consumes positions.updated + screenshots
│  ├─ routes.py
│  └─ schemas.py
├─ recall/
│  ├─ routes.py
│  └─ cohort.py                               # similarity + stats
├─ regime/
│  ├─ detector.py
│  └─ routes.py
└─ db/models/memory_entry.py

apps/web/app/
├─ intelligence/
│  ├─ memory/page.tsx, memory/search/page.tsx
│  ├─ recall/[signal_id]/page.tsx
│  └─ regime/page.tsx
├─ brain/page.tsx                             # God Brain
└─ market/
   ├─ heatmap/page.tsx
   └─ sessions/page.tsx
```

### 11.4 DB DDL delta

- `memory_entries` (with `vector(1536)` embedding; index:
  `hnsw (embedding vector_cosine_ops)`)

### 11.5 API routes

§3.14 memory + recall.

### 11.6 Test strategy

- Embedding determinism: same text + same model id → same vector
  (freeze model id as config)
- Cohort: query a known cluster; assert top-k returns expected peers
- Recall vs agent run: an agent invocation includes at least one
  recall hit when configured

### 11.7 Exit criteria

- [ ] 10k historical closed trades embedded in < 30 min
- [ ] `/intelligence/recall/:signal_id` returns top-K in < 200 ms p95
- [ ] God Brain renders 200-ticker universe at 60 fps on a modern
       laptop
- [ ] `v2.11.0` tag + HANDOFF

---

## Phase 12 — CI hardening + deploy observability

**Tag at completion:** `v2.12.0`
**Branch:** `phase-12-ci-hardening`
**Estimated PRs:** 5

### 12.1 Goal

Lock in CI discipline across the polyglot monorepo: every service
typechecks, every service has ≥ 80 % unit test line coverage, every
PR runs the full integration suite on a compose environment, every
merge to `main` produces a deployable artifact with a cryptographic
signature and a rollback button.

### 12.2 Scope

In:
- GitHub Actions matrices per service (py 3.11, node 20)
- Coverage thresholds enforced in CI
- Compose-based integration job (spins up full stack, runs pytest
  integration marker)
- Contract snapshot job expanded to cover all services' OpenAPI
- Image signing (cosign) + attestation (SLSA provenance)
- Deployments page + rollback endpoint
- Per-service SBOM (syft) uploaded as CI artifact

### 12.3 Folder tree delta

```
.github/workflows/
├─ ci.yml                                     # expanded
├─ integration.yml                            # compose-based
├─ contract-validation.yml
├─ release.yml                                # tag → ECR push + sign
└─ sbom.yml

services/*/pyproject.toml                     # coverage threshold
apps/web/vitest.config.ts                     # coverage threshold

tests/integration/
├─ conftest.py                                # compose orchestration
├─ test_signal_to_execution.py                # full path
├─ test_killswitch.py
└─ test_calibration_loop.py

apps/web/app/ops/
└─ deployments/page.tsx

services/control_plane/app/ops/
└─ deployments.py                             # /v1/deployments/*
```

### 12.4 DB DDL delta

- `deployments` (already in DB_SCHEMA §10; populated here)

### 12.5 API routes

§3.13 deployments + rollback.

### 12.6 Test strategy

- Every service job: unit + type + lint green
- Integration job: full webhook → SSE + signal → manual decide →
  simulated order → position
- Release job: sign image, attest, push to ECR, tag updated

### 12.7 Exit criteria

- [ ] 80 % line coverage per service (not merged if below)
- [ ] Integration job green on PRs; runtime < 15 min
- [ ] Signed images + attestations verifiable via `cosign verify`
- [ ] Rollback from `/ops/deployments` reverts an ECS service in
       staging end-to-end
- [ ] `v2.12.0` tag + HANDOFF

---

## Phase 13 — AWS CDK + staging + prod parity

**Tag at completion:** `v2.13.0`
**Branch:** `phase-13-aws-cdk`
**Estimated PRs:** 10

### 13.1 Goal

Provision AWS per `reference/AWS_RESOURCES.md`. Deliver three
environments (`dev-aws`, `staging`, `prod`) as CDK stacks with
env-specific sizing. Staging is a byte-for-byte functional replica
of prod at smaller scale. CI deploys to staging on every `main`
commit; prod deploys via tag + manual approval.

### 13.2 Scope

In:
- `infra/cdk/` full stack suite (NetworkStack, EdgeStack, …
  WebAppStack, CicdStack) as enumerated in AWS_RESOURCES §14
- Per-environment config (`infra/cdk/config/{dev,staging,prod}.ts`)
- GitHub OIDC → AWS role assumption for CI
- Secrets population from `ops/envs/` with SOPS encryption
- Cost Explorer tags per environment
- DR drill runbook

### 13.3 Folder tree delta

```
infra/cdk/
├─ bin/godsview.ts
├─ lib/
│  ├─ network_stack.ts
│  ├─ edge_stack.ts
│  ├─ database_stack.ts
│  ├─ cache_stack.ts
│  ├─ eventbus_stack.ts
│  ├─ storage_stack.ts
│  ├─ ecr_stack.ts
│  ├─ secrets_stack.ts
│  ├─ obs_stack.ts
│  ├─ control_plane_stack.ts
│  ├─ ingestion_stack.ts
│  ├─ orderflow_stack.ts
│  ├─ backtest_stack.ts
│  ├─ calibration_stack.ts
│  ├─ promotion_stack.ts
│  ├─ intelligence_stack.ts
│  ├─ execution_stack.ts
│  ├─ screenshot_stack.ts
│  ├─ replay_stack.ts
│  ├─ webapp_stack.ts
│  └─ cicd_stack.ts
├─ config/{dev,staging,prod}.ts
├─ cdk.json
└─ package.json

.github/workflows/
├─ cdk-diff.yml                               # per PR
└─ cdk-deploy.yml                             # on main (staging), on tag (prod)

ops/runbooks/
├─ dr_drill.md
└─ killswitch_engaged.md
```

### 13.4 DB DDL delta

None (schema unchanged; provisioning only).

### 13.5 AWS resources (full)

All of AWS_RESOURCES.md §1–§11 lands here.

### 13.6 Test strategy

- `cdk synth` diffs clean in CI
- `cdk deploy` to staging account succeeds end-to-end
- Smoke suite against staging URL passes (auth, webhook, feed SSE)
- DR drill: restore an RDS snapshot into us-east-2, bring minimal
  services up, `/v1/ops/health` green within 30 min

### 13.7 Exit criteria

- [ ] Staging + prod accounts have all stacks deployed
- [ ] Every ECS service healthy on ALB target groups
- [ ] RDS Multi-AZ failover test < 60 s write outage
- [ ] Cost tagged by environment; per-env spend visible
- [ ] `v2.13.0` tag + HANDOFF

### 13.8 Rollback

`cdk destroy` per stack in reverse dependency order. Data stacks
(DB, S3) retained by default; manual confirmation to destroy.

---

## Phase 14 — Replay engine + time travel

**Tag at completion:** `v2.14.0`
**Branch:** `phase-14-replay`
**Estimated PRs:** 5

### 14.1 Goal

Let an analyst rewind any day of market data, scrub frame by frame,
and watch the system "make decisions" as if it were live. Replay
uses the same agent stack as live (Phase 10) but against stored bars +
L2 snapshots + orderflow features from the date requested.

### 14.2 Scope

In:
- `services/replay` (scale-to-zero in idle)
- Session CRUD + seek + play + pause
- WebSocket `/v1/ws/replay/:session_id` — heterogeneous frames
- UI: Replay sessions + workspace + timeline
- Snapshotter job that nightly writes day-bundle S3 artifacts
  (bars + L2 + features + signals + decisions) for fast seek

### 14.3 Folder tree delta

```
services/replay/
├─ app/
│  ├─ main.py
│  ├─ sessions/routes.py, service.py
│  ├─ ws/stream.py
│  ├─ snapshot/
│  │  ├─ writer.py                            # nightly S3 bundle
│  │  └─ reader.py
│  └─ db/models/replay_session.py
├─ alembic/versions/001_replay.py
└─ Dockerfile

apps/web/app/replay/
├─ page.tsx, [session_id]/page.tsx, [session_id]/timeline/page.tsx
```

### 14.4 DB DDL delta

- `replay_sessions` (session id, owner, range, cursor, state,
  bookmarks jsonb)

### 14.5 API routes

§3.15.

### 14.6 Test strategy

- Determinism: replay a day twice with same agent version → identical
  decision sequence
- Seek latency: < 2 s to any timestamp within a loaded bundle
- Fairness: replay can't issue real orders (execution endpoint
  enforces origin check)

### 14.7 Exit criteria

- [ ] Analyst can open a session for a past trading day, play at 10×
       speed, pause, scrub, see agents produce the same decisions that
       were captured live
- [ ] Replay never places live orders (enforced at execution by
       `origin != replay` check)
- [ ] `v2.14.0` tag + HANDOFF

---

## Phase 15 — Launch: end-to-end integration tests + governance

**Tag at completion:** `v3.0.0` (first v3 tag; "production-ready v3")
**Branch:** `phase-15-launch`
**Estimated PRs:** 6

### 15.1 Goal

Ship the v3.0.0 **launch**: full E2E test suite that runs against a
dedicated staging stack every PR, governance artifacts (policies,
approval workflows, demote history review), a complete operator
runbook, and the launch checklist signed off. This phase is
load-bearing for the "100% against the v2+ vision" claim.

### 15.2 Scope

In:
- `tests/e2e/playwright/` — full user journeys across every section
  of the sidebar, keyed off MSW in PR builds and real staging in
  nightly builds
- Governance module: approval workflows for promotion config
  changes, kill-switch release, broker key rotation, prod schema
  migrations
- Trust-tier enforcement: signal decisions from a specific strategy
  tier require an operator approver by feature flag
- `docs/LAUNCH_CHECKLIST_V3.md` — signed off
- `docs/OPERATOR_HANDBOOK.md` — every page, every runbook, every
  on-call scenario
- Final performance budget enforcement (k6 scenarios from Phase 6 +
  new "live trade path" scenario)

### 15.3 Folder tree delta

```
tests/e2e/playwright/
├─ auth.spec.ts
├─ signals_feed.spec.ts
├─ strategy_authoring.spec.ts
├─ backtest_flow.spec.ts
├─ execution_flow.spec.ts
├─ calibration_loop.spec.ts
├─ promotion_flow.spec.ts
├─ alerts_ack.spec.ts
├─ intelligence_agents.spec.ts
├─ memory_recall.spec.ts
└─ replay.spec.ts

services/control_plane/app/governance/
├─ approvals/
│  ├─ routes.py                               # list + act
│  └─ policies.py                             # per-action policies
└─ db/models/approval.py

docs/
├─ LAUNCH_CHECKLIST_V3.md
├─ OPERATOR_HANDBOOK.md
└─ POST_LAUNCH_REVIEW_TEMPLATE.md
```

### 15.4 DB DDL delta

- `approvals` (id, action, subject, requester, reviewers[], state,
  decision, notes, correlation_id)

### 15.5 API routes

- `GET /v1/governance/approvals`, `POST /v1/governance/approvals/:id/decide`

### 15.6 Launch checklist (reproduced here for phase exit)

Every box ships **checked**:

- [ ] All 15 phases tagged (`v2.0.0` → `v2.14.0`)
- [ ] CI green on main; all service coverage ≥ 80 %
- [ ] Contract validation green; no drift vs API_SURFACE.md
- [ ] Staging stack fully deployed; synthetic live simulation for
       7 days without ops intervention
- [ ] k6 scenarios meet all SLO budgets
- [ ] DR drill completed in the quarter
- [ ] All runbooks present for all alerts
- [ ] Operator MFA enforced; admin MFA required
- [ ] Kill switch tested in staging within the past week
- [ ] Prod broker credentials rotated within the past month; next
       rotation scheduled
- [ ] Security review: image signing + SBOMs + IAM least-privilege
       validated
- [ ] Backups + PITR validated by restore test
- [ ] Cost dashboard reviewed; spend within budget
- [ ] 3 synthetic live trades per strategy tier in staging, each
       replayable
- [ ] Postmortem template published; first real incident within 24 h
       of launch produces a valid postmortem
- [ ] Governance approvals required for: prod schema migrations,
       kill-switch release, broker key rotation, promotion-config
       threshold changes

### 15.7 Exit criteria

- [ ] Every checklist box above is checked and signed
- [ ] `v3.0.0` tag on main
- [ ] Public (internal) announcement with link to checklist
- [ ] `phase-15/HANDOFF.md` documents the state of every subsystem
       as of launch

### 15.8 Rollback

At launch, rollback is the existing per-phase mechanism plus:
`feature_flags.execution_enabled=false` + kill switch engaged.
Reverting v3.0.0 tag pins main to v2.14.0; no schema changes are
destructive.

---

## Phase 8–15 roll-up

| Phase | Tag     | Pages added (full or new)                  | New services                          | Tables added |
|-------|---------|---------------------------------------------|---------------------------------------|--------------|
| 8     | v2.8.0  | 6 (trust, promotion, queue, config, cal×2)  | + calibration + promotion             | 5            |
| 9     | v2.9.0  | 4 (alerts, incidents, runbooks, editor)     | +                                     | 4            |
| 10    | v2.10.0 | 3 (agents, run detail, ask)                 | + intelligence                        | 1            |
| 11    | v2.11.0 | 7 (memory×2, recall, regime, brain, heatmap, sessions) | +                         | 1            |
| 12    | v2.12.0 | 1 (deployments)                             | +                                     | 1            |
| 13    | v2.13.0 | 0 (infra only)                              | + (same services, now on AWS)         | 0            |
| 14    | v2.14.0 | 3 (replay×3)                                | + replay                              | 1            |
| 15    | v3.0.0  | 0 (governance surfacing reuses existing)    | +                                     | 1            |

By `v3.0.0`, the full 10-service backend runs on AWS across 3 AZs in
us-east-1 with a warm DR in us-east-2, every route from
API_SURFACE.md is live, every page from SIDEBAR_MAP.md renders real
data, every SLO from Phase 6 has 28 days of observed burn, and the
bidirectional calibration loop is closed with auto-demotion wired.

---

## What changes after v3.0.0 (deliberately out of scope)

- Multi-broker execution fan-out
- Active/active multi-region
- Customer-facing / external API
- Mobile-first UI
- WebAuthn / passkeys for auth
- User-authored dashboards
- EKS migration

Any of these can ship as a "v3.x" phase under the same patch + HANDOFF
+ tag discipline.

---

**End of PHASES_8_TO_15.md**
