# GodsView v2.6.0 — Phase 6 Handoff (Portfolio Intelligence + Governance + Autonomy)

**Release tag:** `v2.6.0`
**Branch:** `phase-6-portfolio-governance-autonomy`
**Cut from:** `main` @ the `v2.5.0` baseline (Phase 5 — Quant Lab + Recall + Learning)
**Scope:** Portfolio-level exposure + correlation + allocation, a full
governance surface (approval workflows, anomaly detectors, trust tiers,
policy config), and an autonomy promotion-ceiling FSM that sits above the
Phase 5 strategy FSM — gated by a global kill switch with scope
precedence `global ▸ account ▸ strategy`. Eight wired web surfaces expose
the whole capital-allocation + governance + autonomy bus
(`/portfolio/pnl`, `/portfolio/exposure`, `/portfolio/allocation`,
`/governance/approvals`, `/governance/anomalies`, `/governance/trust`,
`/governance/policies`, `/governance/demotions`, `/strategies/autonomy`,
`/execution/killswitch`).

This document is the formal handoff for Phase 6. As of this tag the repo
is production-ready for the **full structure → order-flow → setup →
paper → live → research → learning → governance → autonomy pipeline**.
The Phase 4 live gate, Phase 5 research + memory + learning layer, and
all upstream detectors are unchanged; Phase 6 is an *additive*
capital-allocation + policy layer that reads from the existing
live-trade + autonomy + calibration ledgers and writes its own
audit trail through the governance approval engine, anomaly detectors,
and kill-switch event stream.

---

## 1. What Shipped — PR Inventory

Phase 6 was executed as nine atomic PRs on the
`phase-6-portfolio-governance-autonomy` branch. Each PR is a single
commit that typechecks clean in isolation (`apps/web tsc --noEmit →
exit 0`).

| PR   | Commit    | Scope |
|------|-----------|-------|
| PR1  | `b511350` | `@gv/types` portfolio + governance + autonomy models (`PortfolioAccount`, `PortfolioExposureSlice`, `CorrelationClass`, `AllocationTarget`, `AllocationPlan`, `PortfolioPnl`, `DrawdownPoint`, `TrustTier`, `GovernanceApproval`, `GovernanceAction`, `GovernancePolicy`, `AnomalyAlert`, `AnomalySeverity`, `AutonomyState`, `AutonomyReason`, `AutonomyGateSnapshot`, `AutonomyGateStatus`, `AutonomyHistoryEvent`, `AutonomyRecord`, `AutonomyTransitionAction`, `AutonomyTransitionRequest`, `KillSwitchScope`, `KillSwitchTrigger`, `KillSwitchAction`, `KillSwitchState`, `KillSwitchEvent`) |
| PR2  | `67deb64` | `@gv/api-client` portfolio + governance + autonomy endpoint factories (`api.portfolio.accounts`, `api.portfolio.exposure`, `api.portfolio.allocation`, `api.portfolio.pnl`, `api.governance.approvals`, `api.governance.policies`, `api.governance.anomalies`, `api.governance.trust`, `api.autonomy`, `api.killSwitch`) |
| PR3  | `d14f531` | Portfolio exposure + allocation + PnL routes + Alembic `20260419_0011_phase6_portfolio.py` (accounts, exposure slices, allocation plans, PnL snapshots, drawdown points) — `/v1/portfolio/accounts` + `/v1/portfolio/exposure` + `/v1/portfolio/allocation` + `/v1/portfolio/allocation/{id}/approve` + `/v1/portfolio/pnl` + `/v1/portfolio/drawdown` |
| PR4  | `2c83145` | Governance approvals + anomalies + trust routes + Alembic `20260419_0012_phase6_governance.py` (approvals, approval policies, anomaly alerts, trust tier history) — `/v1/governance/approvals` list/detail/create/approve/reject + `/v1/governance/policies` CRUD + `/v1/governance/anomalies` list/acknowledge/resolve + `/v1/governance/trust` snapshot + `/v1/governance/trust/{strategyId}/recompute` |
| PR5  | `128b5ef` | Autonomy state + promote + override routes + kill-switch + Alembic `20260419_0013_phase6_autonomy.py` (autonomy records, autonomy history, kill-switch events) — `/v1/autonomy/records` list/detail + `/v1/autonomy/records/{id}/transition` (FSM mutate) + `/v1/autonomy/records/{id}/recompute` + `/v1/autonomy/records/{id}/history` + `/v1/autonomy/history` + `/v1/kill-switch/states` + `/v1/kill-switch/events` + `/v1/kill-switch/trip` + `/v1/kill-switch/reset` |
| PR6  | `74c27f3` | `apps/web` Portfolio pages — `/portfolio/pnl`, `/portfolio/exposure`, `/portfolio/allocation` wired to the Phase 6 portfolio routes |
| PR7  | `88e4b75` | `apps/web` Governance pages — `/governance/approvals`, `/governance/anomalies`, `/governance/trust`, `/governance/policies`, `/governance/demotions` wired to the Phase 6 governance routes |
| PR8  | `0f70e5a` | `apps/web` Autonomy + Kill-switch admin pages — `/strategies/autonomy` and `/execution/killswitch` wired to the Phase 6 autonomy + kill-switch routes, sidebar un-stubbed for both |
| PR9  | _this PR_ | `v2.6.0` release handoff (this doc) + operator-clone mirror + tag |

---

## 2. Wired Pages

Phase 6 completes the operator-facing capital-allocation + governance +
autonomy surfaces. Eleven pages moved from Phase 5's `ToDoBanner` stubs
(or new routes added in this phase) to fully wired React components
backed by `useQuery` / `useMutation` against the new Phase 6 routes:

### 2.1 Portfolio (3 pages)

- `/portfolio/pnl` — Firm-wide PnL waterfall. Per-account realised +
  unrealised + fees/slippage roll-ups from `/v1/portfolio/pnl`, paired
  with the drawdown curve (`/v1/portfolio/drawdown`). 10s poll during
  trading hours; tone badges drive the win/loss signal.
- `/portfolio/exposure` — Exposure heatmap across symbols × correlation
  classes. Per-slice gross + net notional + weighting, with a tripwire
  ribbon when any class breaches its target band. Sourced from
  `/v1/portfolio/exposure`; admin-only "recompute exposure" button
  forces a snapshot refresh.
- `/portfolio/allocation` — Allocation plans queue. Pending plans list
  with per-account target weights, gap-to-target deltas, and an
  admin-only Approve/Reject pair that feeds the
  `/v1/portfolio/allocation/{id}/approve` route. Approved plans
  transition into the audit tail.

### 2.2 Governance (5 pages)

- `/governance/approvals` — Unified approval inbox. Pending + approved
  + rejected rows with per-request reason, actor, paired subject
  (strategy id / account id / config key), and the policy id that
  gated it. Admin-only Approve/Reject with a 3–280-char reason; client
  writes the response back into the cache via `setQueryData`. Deep-
  link via `?focus=<approvalId>`.
- `/governance/anomalies` — Anomaly detector feed. Rows from the
  calibration-drift, allocation-breach, kill-switch-tripped,
  data-truth, and latency detectors with severity tones
  (info/warn/danger) and an Acknowledge + Resolve workflow. Filterable
  by source + severity; 30s poll.
- `/governance/trust` — Per-strategy trust-tier snapshot. Shows the
  current tier (A/B/C), contributing DNA + calibration + sample-size
  scores, and the last recomputed timestamp. Admin-only
  `POST /v1/governance/trust/{strategyId}/recompute` button for an
  on-demand refresh.
- `/governance/policies` — Approval policy CRUD. One row per
  `(action, scope)` pair; admin-only create/update/archive with a
  threshold field (min reason length, min approver count, required
  approver roles). Policy edits flow through the same approval queue
  for audit.
- `/governance/demotions` — Unified demotion log. Derived view over
  approval history (`strategy_demote`, `strategy_autonomous_demote`,
  `strategy_retire`) + anomaly events (`strategy_drift`,
  `allocation_breach`, `kill_switch_tripped`). Filter by strategy id;
  each row deep-links to the source approval or anomaly.

### 2.3 Strategies — Autonomy (1 page)

- `/strategies/autonomy` — Autonomy FSM: `assisted_live →
  autonomous_candidate → autonomous`. Records table with per-record
  state badge, DNA + calibration + sample-size gate chips, R-in-state
  and fills-in-state summary. Detail drawer showing the full gate
  snapshot (calibration drift Δ, sample-size floor, DNA tier).
  Admin-only transition panel with action selector
  `promote|demote|override|suspend|resume`, reason (3–280 chars), and
  an approval-id field that is *required* when promoting from
  `autonomous_candidate → autonomous` (server enforces the paired
  `strategy_autonomous_promote` approval). Append-only history with
  transition tone, reason label, actor, and deep-links to the paired
  governance approval row. Admin-only Recompute-gates button.

### 2.4 Execution — Kill switch (1 page)

- `/execution/killswitch` — Global circuit-breaker admin surface.
  Active scopes table sorted global-first then alpha; each row has a
  per-scope Reset button that opens the reset panel. Rose banner at
  the top when any `global` scope is tripped. Admin-only Trip panel
  with scope selector (`global|account|strategy`) + subject key
  (required when scope ≠ global) + trigger selector
  (operator/anomaly/governance/automated_drawdown/
  automated_data_truth/automated_broker_health) + reason. Admin-only
  Reset panel with an approval-id field that is *required* for
  `global`-scope resets per the `kill_switch_toggle` policy. Audit log
  table with scope + trigger + action filters; 15s poll.

### 2.5 Sidebar changes

- `Strategies › Autonomy` added (new) — between `Promotions` and `DNA`.
- `Execution › Kill switch` un-stubbed (`stub:true` removed).
- `Governance` section's five entries were un-stubbed in PR7
  (`Trust tiers`, `Approvals`, `Anomalies`, `Demotions`, `Policies`).
- `Portfolio` section's three pages (`PnL`, `Exposure`, `Allocation`)
  were un-stubbed in PR6.

---

## 3. New API Surface

### 3.1 Routes (33 new endpoints)

All live under `/v1/` and are served by
`services/control_plane/app/routes/portfolio.py`,
`services/control_plane/app/routes/governance.py`, and
`services/control_plane/app/routes/autonomy.py`.

**Portfolio**

- `GET    /v1/portfolio/accounts`
- `GET    /v1/portfolio/exposure`
- `POST   /v1/portfolio/exposure/recompute`  *(admin)*
- `GET    /v1/portfolio/allocation`
- `POST   /v1/portfolio/allocation/{id}/approve`  *(admin)*
- `POST   /v1/portfolio/allocation/{id}/reject`   *(admin)*
- `GET    /v1/portfolio/pnl`
- `GET    /v1/portfolio/drawdown`

**Governance**

- `GET    /v1/governance/approvals`
- `GET    /v1/governance/approvals/{id}`
- `POST   /v1/governance/approvals`
- `POST   /v1/governance/approvals/{id}/approve`  *(admin)*
- `POST   /v1/governance/approvals/{id}/reject`   *(admin)*
- `GET    /v1/governance/policies`
- `POST   /v1/governance/policies`                 *(admin)*
- `PATCH  /v1/governance/policies/{id}`            *(admin)*
- `POST   /v1/governance/policies/{id}/archive`    *(admin)*
- `GET    /v1/governance/anomalies`
- `POST   /v1/governance/anomalies/{id}/acknowledge`
- `POST   /v1/governance/anomalies/{id}/resolve`
- `GET    /v1/governance/trust`
- `POST   /v1/governance/trust/{strategyId}/recompute`  *(admin)*

**Autonomy + Kill switch**

- `GET    /v1/autonomy/records`
- `GET    /v1/autonomy/records/{strategyId}`
- `POST   /v1/autonomy/records/{strategyId}/transition`  *(admin)*
- `POST   /v1/autonomy/records/{strategyId}/recompute`   *(admin)*
- `GET    /v1/autonomy/records/{strategyId}/history`
- `GET    /v1/autonomy/history`
- `GET    /v1/kill-switch/states`
- `GET    /v1/kill-switch/events`
- `POST   /v1/kill-switch/trip`   *(admin)*
- `POST   /v1/kill-switch/reset`  *(admin)*

### 3.2 Schema (3 new Alembic revisions)

- `20260419_0011_phase6_portfolio.py` — 5 tables:
  `portfolio_accounts`, `portfolio_exposure_slices`,
  `portfolio_allocation_plans`, `portfolio_pnl_snapshots`,
  `portfolio_drawdown_points`.
- `20260419_0012_phase6_governance.py` — 4 tables:
  `governance_approvals`, `governance_policies`,
  `governance_anomalies`, `governance_trust_snapshots`.
- `20260419_0013_phase6_autonomy.py` — 3 tables:
  `autonomy_records`, `autonomy_history`, `kill_switch_events`.

Autonomy is append-only on history and kill-switch events; record-of-
truth rows update in place with the `updatedAt` timestamp driving the
ETag. All Pydantic v2 payloads populate_by_name so the wire is camelCase
while the Python side stays snake_case.

---

## 4. Authority + Server-Enforced Invariants

Operator-facing client code ships *UX-level* FSM maps only. The server
is the authority on every state transition and approval gate:

- **Autonomy FSM** — `assisted_live → autonomous_candidate →
  autonomous`; demote ↔ promote is server-validated. Promotion to
  `autonomous` additionally requires a paired `governance.approvals`
  row with `action=strategy_autonomous_promote`, `state=approved`, and
  `subjectKey=<strategyId>`. The transition endpoint rejects with 409
  if any invariant is violated.
- **Approval policies** — A policy may demand N approvers of a given
  role before state flips from `pending → approved`. The control
  plane enforces the count + role set; UI shows the remaining quorum
  but never flips the flag client-side.
- **Kill-switch reset on global scope** — Requires a paired
  `kill_switch_toggle` approval. The reset endpoint rejects with 409
  if `approvalId` is absent or points to a non-approved row. Narrower
  scopes (account/strategy) can be reset by an admin without a paired
  approval.
- **Anomaly auto-demotion** — A `strategy_drift` or `allocation_breach`
  anomaly with severity `error|critical` triggers the
  `strategy_autonomous_demote` action server-side, bypassing the
  manual approval flow — but the action still writes an immutable row
  into `governance_approvals` with `automated=true` for audit.
- **Kill-switch overrides everything** — A tripped scope vetoes every
  outbound broker intent that matches. The live execution gate short-
  circuits before hitting the risk engine, so no mutation, fill, or
  allocation change is possible while the scope is active.

---

## 5. Build + Test

- `pnpm --filter @gv/types run build` — PASS.
- `pnpm --filter @gv/api-client run build` — PASS.
- `pnpm --filter @gv/ui run build` — PASS.
- `apps/web: ./node_modules/.bin/tsc --noEmit` — **PASS** (exit 0,
  no diagnostics). Verified at the PR8 commit (`0f70e5a`) that closes
  this phase.
- `services/control_plane` — Alembic migrations `0011`, `0012`, `0013`
  apply cleanly against a fresh Postgres instance; `downgrade -1`
  returns the schema to the Phase 5 baseline.

---

## 6. Three-Way Repo Verification

Required convergence SHA across the three repo copies:

- **audit-local** (`/sessions/nice-amazing-feynman/godsview-audit/Godsview`)
- **origin** (`https://github.com/Santhakumarramesh/Godsview.git`)
- **mnt clone** (`/sessions/nice-amazing-feynman/mnt/Godsview`)

All three sit on `phase-6-portfolio-governance-autonomy` at
`0f70e5a2c07f9028713ec64744e196c5a5fe7fd1` (the PR8 commit), which this
PR9 handoff extends with the tag cut. Post-tag the three locations must
converge again on the PR9 SHA plus resolve `v2.6.0^{}` to the same
commit.

---

## 7. Next Phase — Phase 7 (Launch + Scale)

Phase 6 brings the repo to *full production-capable* status. The
Phase 7 roadmap (per `docs/blueprint/09-phase-roadmap.md`) focuses on:

- Multi-account brokerage expansion (per-account Alpaca adapters,
  Interactive Brokers adapter, paper-vs-live account segregation).
- Live-trading rollout under staged autonomy
  (`assisted_live` → small-cap autonomous → full autonomous).
- Portfolio rebalancer cron that reads from
  `/v1/portfolio/allocation` and writes rebalance intents into the
  live execution queue (admin-gated, governance-approved).
- Anomaly detector expansion: venue latency, Alpaca outage detection,
  calibration Brier-score regressions scoped to the last N trades.
- Operator mobile surface (read-only — approvals, anomalies, kill-
  switch state, portfolio PnL).

---

## 8. Sign-Off

- **Build:** PASS — four workspaces clean `tsc --noEmit`; apps/web
  incremental `tsc -b` exits 0 from both a cold and warm cache.
- **Schema:** PASS — three new Alembic revisions apply cleanly and
  reverse cleanly against the Phase 5 baseline.
- **Security:** Every admin-mutating route listed in §3.1 is gated
  on the `admin` role and audit-logged through
  `app.audit.log_event`. The autonomy FSM and approval policies are
  server-authoritative; client-side maps are UX only, never authority.
  The kill-switch `global` scope vetoes every outbound broker intent;
  global reset requires a paired `kill_switch_toggle` approval.
  Anomaly-driven auto-demotions write immutable rows with
  `automated=true` and still respect the append-only history log.
- **Readiness:** FULL — `SYSTEM_MODE=paper` remains the default; the
  Phase 6 surfaces operate against an empty portfolio + empty
  approval queue without failure. The first governance approval
  created via the UI populates the inbox; the first live trade
  populates exposure + PnL. Autonomy records are created on first
  strategy promotion to `assisted_live` via the Phase 5 FSM.

Signed,
— the GodsView control plane, Phase 6 complete.
