# GodsView v2.7.0 — Phase 7 Handoff (Launch + Scale)

**Release tag:** `v2.7.0`
**Branch:** `phase-7-launch-and-scale`
**Cut from:** `main` @ the `v2.6.0` baseline (Phase 6 — Portfolio + Governance + Autonomy)
**Scope:** Multi-broker adapter registry (Alpaca primary + IB stub
secondary) with per-venue health telemetry, a portfolio rebalancer cron
with governance-gated execute transitions, anomaly detector expansion
covering venue latency + broker outage streaks + calibration Brier-score
regressions, a read-only mobile operator inbox with append-only ack
audit, and three wired admin/operator web surfaces (`/admin/brokers`,
`/portfolio/rebalance`, `/ops/venues`) that expose the whole bus. The
Phase 4 live gate, Phase 5 research + memory + learning layer, and
Phase 6 governance + autonomy FSM are unchanged; Phase 7 is an
*additive* launch-scale layer that plugs into the existing live-trade +
approval + kill-switch ledgers and writes its own append-only audit
trails through the new `mobile_inbox_ack_events` table and the existing
governance approval engine.

This document is the formal handoff for Phase 7. As of this tag the
repo is production-ready for the **full structure → order-flow →
setup → paper → live → research → learning → governance → autonomy →
multi-broker launch + scale pipeline**. The Phase 6 portfolio + policy
invariants are unchanged; Phase 7 adds the launch-scale plumbing
beneath them — multi-vendor broker quorum, a rebalancer-driven
allocation-to-intent bridge, a wider anomaly detector fabric, and the
first read-only mobile surface.

---

## 1. What Shipped — PR Inventory

Phase 7 was executed as eight atomic PRs on the
`phase-7-launch-and-scale` branch. Each PR is a single commit that
typechecks clean in isolation (`apps/web tsc --noEmit → exit 0`;
backend `ast.parse()` verified on every changed Python file).

| PR   | Commit    | Scope |
|------|-----------|-------|
| PR1  | `ac53db0` | `@gv/types` launch-scale models (`BrokerAdapter`, `BrokerAdapterKind`, `BrokerAdapterRole`, `BrokerAdapterStatus`, `BrokerBinding`, `BrokerHealthSnapshot`, `BrokerRegistrySummary`, `RebalancePlan`, `RebalancePlanStatus`, `RebalanceTrigger`, `RebalanceIntent`, `RebalancePlanWarning`, `VenueKind`, `VenueLatencyReport`, `VenueOutageEvent`, `VenueRegistryRow`, `VenueRegistrySummary`, `MobileInboxItemKind`, `MobileInboxSeverity`, `MobileInboxStatus`, `MobileInboxItem`, `MobileInboxList`, `MobileInboxAckRequest`, `MobileInboxSummary`) |
| PR2  | `3832fa7` | `@gv/api-client` launch-scale endpoint factories (`api.brokers.{adapters,bindings,health}`, `api.rebalance.{plans,intents}`, `api.venue.{latency,outages,registry}`, `api.mobileInbox`) |
| PR3  | `63eafaf` | Multi-broker adapter registry + `IBAdapter` stub + Alembic `20260419_0014_phase7_brokers.py` (broker_adapters, broker_bindings, broker_health_snapshots) — admin-only `/v1/brokers/adapters` + `/v1/brokers/bindings` CRUD, `/v1/brokers/adapters/{id}/probe` ad-hoc probe, `/v1/brokers/adapters/{id}/health` history, `/v1/brokers/registry` quorum + liveRoutable summary, `/v1/brokers/health` filterable snapshot feed |
| PR4  | `f11e8fa` | Portfolio rebalancer cron + intents + Alembic `20260419_0015_phase7_rebalance.py` (portfolio_rebalance_plans, portfolio_rebalance_intents) — planner reads `/v1/portfolio/allocation` snapshots, proposes plans with symbol-level intents; `/v1/portfolio/rebalance/plans` list/detail, `/v1/portfolio/rebalance/plans/{id}/approve` *(admin + `portfolio.rebalance` governance approval)*, `/v1/portfolio/rebalance/plans/{id}/execute` *(paired `rebalance_execute` approval)*, reject/cancel; `/v1/portfolio/rebalance/intents` list + retry + cancel |
| PR5  | `df3a06b` | Anomaly detector expansion + detector runner + Alembic-free additive `governance.detectors` module — `venue_latency` (per-adapter p99 breach ≥ `latency_p99_ms_critical`), `broker_outage` (3-streak unhealthy OR error_rate ≥ 0.3 spike), `calibration_brier` (50% regression from prior window); `/v1/governance/detectors/run` admin route + 11 test cases covering threshold + no-emit + skip-probe-disabled + skip-undersized paths |
| PR6  | `ebcf43d` | Mobile operator inbox `/v1/mobile/inbox` (read-only) + Alembic `20260419_0016_phase7_mobile_ack.py` (mobile_inbox_ack_events append-only audit) — cursor-paginated aggregator over approvals + anomalies + kill-switch + broker health + venue outages, severity + kind + status filters, ack endpoint with idempotency + 409 on already-resolved item + 400 on bad cursor + 404 on unknown id; 19 async tests |
| PR7  | `73a1393` | `apps/web` launch-scale pages — `/admin/brokers` (adapter registry + quorum strip + probe), `/portfolio/rebalance` (plan feed + detail drawer + approve/reject/cancel/execute), `/ops/venues` (per-venue quorum + latency + open-outage close panel) wired to the Phase 7 brokers/rebalance/venue routes; sidebar un-stubbed for all three |
| PR8  | _this PR_ | `v2.7.0` release handoff (this doc) + operator-clone mirror + tag |

---

## 2. Wired Pages

Phase 7 delivers the operator-facing multi-broker + rebalancer + venue
health surfaces. Three pages moved from Phase 0 `ToDoBanner` stubs (or
new routes added in this phase) to fully wired React components backed
by `useQuery` / `useMutation` against the new Phase 7 routes:

### 2.1 Admin (1 page)

- `/admin/brokers` — Multi-broker adapter registry. Top strip shows the
  five-cell quorum summary (total / healthy / degraded / down /
  liveRoutable) from `/v1/brokers/registry`, followed by the eleven-
  column adapter table (name + id, kind, role, host, status, live-
  enabled, probe-enabled, p95 latency, error rate, last-probe, probe
  button). Ad-hoc probe fires `POST /v1/brokers/adapters/{id}/probe`
  and invalidates the registry + adapters + health queries so the
  refreshed snapshot flows back in. Role / liveEnabled / probeEnabled
  toggles are deliberately *not* wired here — they route through the
  dedicated governance-gated update surface (paired approval
  required). 30s poll on all three queries.

### 2.2 Portfolio (1 page)

- `/portfolio/rebalance` — Rebalance plan feed. Filterable by account,
  status, and trigger; nine-column plan table (id, trigger, status,
  intent count, total notional, created, proposed-at, latest warning
  severity, view button) sourced from `/v1/portfolio/rebalance/plans`.
  Clicking a row opens the detail drawer (`/v1/portfolio/rebalance/
  plans/{id}/detail`) with the ten-column intent table (symbol,
  direction, target weight, delta, qty, notional, venue, status,
  last-attempt, retry button), warnings panel, and the four
  state-dependent action cards — approve/reject when `proposed`,
  execute/cancel when `approved`. Approve requires a governance
  approvalId (`portfolio.rebalance` policy); execute requires a
  paired `rebalance_execute` approval id. 15s poll on the selected
  plan, 30s on the list.

### 2.3 Operations (1 page)

- `/ops/venues` — Per-venue health board. Five-cell quorum strip
  (total / healthy / degraded / down / live-routable) from
  `/v1/venue/registry/summary`. Ten-column venue table (venue,
  adapter id, status, p95 latency, error rate, outage-open flag,
  last report, probe button) with an ad-hoc probe that fires
  `POST /v1/venue/latency/{venue}/probe`. Open outage panel below
  the table with per-row reason input (min 3 chars) + admin-only
  close button wired to `POST /v1/venue/outages/{id}/close`. Cross-
  links at the bottom to `/admin/brokers` and `/execution/killswitch`.
  20s poll on the registry, 30s on outages.

### 2.4 Sidebar changes

- `Admin › Brokers` added (new) — after `MCP servers`, admin-only.
- `Portfolio › Rebalance` added (new) — after `Drawdown`, all roles.
- `Operations › Venues` added (new) — after `Latency`, all roles.

No prior sidebar entries were stubbed, removed, or re-ordered.

---

## 3. New API Surface

### 3.1 Routes (27 new endpoints)

All live under `/v1/` and are served by
`services/control_plane/app/routes/brokers.py`,
`services/control_plane/app/routes/rebalance.py`,
`services/control_plane/app/routes/mobile.py`, and the
per-detector additions to
`services/control_plane/app/routes/governance.py`.

**Brokers**

- `GET    /v1/brokers/adapters`
- `POST   /v1/brokers/adapters`                     *(admin)*
- `GET    /v1/brokers/adapters/{id}`
- `PATCH  /v1/brokers/adapters/{id}`                *(admin)*
- `POST   /v1/brokers/adapters/{id}/probe`          *(admin)*
- `GET    /v1/brokers/adapters/{id}/health`
- `GET    /v1/brokers/bindings`
- `POST   /v1/brokers/bindings`                     *(admin)*
- `GET    /v1/brokers/bindings/{id}`
- `PATCH  /v1/brokers/bindings/{id}`                *(admin)*
- `DELETE /v1/brokers/bindings/{id}`                *(admin)*
- `GET    /v1/brokers/registry`
- `GET    /v1/brokers/health`

**Portfolio rebalance**

- `GET    /v1/portfolio/rebalance/plans`
- `GET    /v1/portfolio/rebalance/plans/{id}`
- `GET    /v1/portfolio/rebalance/plans/{id}/detail`
- `POST   /v1/portfolio/rebalance/plans`            *(admin)*
- `POST   /v1/portfolio/rebalance/plans/{id}/approve`  *(admin + approvalId)*
- `POST   /v1/portfolio/rebalance/plans/{id}/reject`   *(admin)*
- `POST   /v1/portfolio/rebalance/plans/{id}/cancel`   *(admin)*
- `POST   /v1/portfolio/rebalance/plans/{id}/execute`  *(admin + `rebalance_execute` approvalId)*
- `GET    /v1/portfolio/rebalance/intents`
- `GET    /v1/portfolio/rebalance/intents/{id}`
- `POST   /v1/portfolio/rebalance/intents/{id}/retry`  *(admin)*
- `POST   /v1/portfolio/rebalance/intents/{id}/cancel` *(admin)*

**Mobile inbox**

- `GET    /v1/mobile/inbox`
- `GET    /v1/mobile/inbox/summary`
- `POST   /v1/mobile/inbox/{id}/ack`

**Governance detectors**

- `POST   /v1/governance/detectors/run`             *(admin)*

### 3.2 Schema (3 new Alembic revisions)

- `20260419_0014_phase7_brokers.py` — 3 tables:
  `broker_adapters`, `broker_bindings`, `broker_health_snapshots`.
  FK from `broker_bindings.adapter_id` → `broker_adapters.id`; FK from
  `broker_health_snapshots.adapter_id` → `broker_adapters.id`. Unique
  constraint on `(adapter_id, observed_at)` on the health table so
  identical-instant probes coalesce.
- `20260419_0015_phase7_rebalance.py` — 2 tables:
  `portfolio_rebalance_plans`, `portfolio_rebalance_intents`. FK
  from `portfolio_rebalance_intents.plan_id` →
  `portfolio_rebalance_plans.id`. Append-only `rebalance_plan_audit`
  view is emulated via `governance_approvals` rows with
  `action=rebalance_execute`.
- `20260419_0016_phase7_mobile_ack.py` — 1 table:
  `mobile_inbox_ack_events`. Append-only — no updates or deletes.
  Indexed on `(actor_user_id, acknowledged_at)` for the inbox
  summary roll-up.

All Pydantic v2 payloads populate_by_name so the wire stays camelCase
while the Python side stays snake_case. Every new `INSERT` path funnels
through `app.audit.log_event` with appropriate `resource_type` tags
(`broker.adapter`, `broker.binding`, `broker.health`,
`portfolio.rebalance.plan`, `portfolio.rebalance.intent`,
`mobile.inbox.ack`).

---

## 4. Authority + Server-Enforced Invariants

Operator-facing client code ships *UX-level* FSM maps only. The server
is the authority on every state transition, paired-approval gate, and
quorum rule:

- **Broker role/kind compatibility** — `paper` kinds carry `role=paper`;
  `live` kinds carry `role=primary|secondary`. Paper kinds can never
  flip `liveEnabled=true`; role flips from `paper→primary` are rejected
  with 409. `/v1/brokers/bindings` enforces at most one binding per
  `(account_id, symbol_class)` pair with `role=primary` — secondary +
  paper bindings are unconstrained in count.
- **Broker live-routable quorum** — `/v1/brokers/registry.liveRoutable`
  is `true` iff at least one `role=primary` adapter is `healthy` AND
  `liveEnabled=true`. Execution gate short-circuits on `liveRoutable=
  false` before hitting the risk engine.
- **Rebalance plan FSM** — `proposed → approved → executing → complete`,
  plus `rejected / cancelled / failed`. Each transition is server-
  validated — `/v1/portfolio/rebalance/plans/{id}/approve` rejects with
  409 if the plan is not in `proposed`, and rejects with 409 if the
  supplied `approvalId` is not an `approved` `governance_approvals`
  row with `action=portfolio_rebalance` and `subjectKey=<planId>`.
  Execute additionally requires a paired
  `action=rebalance_execute` approval; the execute endpoint rejects
  with 409 if the plan is not in `approved` or the approval id is
  missing / non-approved.
- **Rebalance plan warnings are advisory** — `correlated_exposure_
  breach`, `single_symbol_concentration`, `liquidity_warning`,
  `venue_latency_degraded`, `broker_quorum_insufficient`,
  `kill_switch_active` are reported on the plan but do not block
  approval. Execute, however, is short-circuited at the live gate by
  `broker_quorum_insufficient=critical` OR `kill_switch_active=
  critical`.
- **Mobile ack is additive + idempotent** — `POST /v1/mobile/inbox/
  {id}/ack` writes a row into `mobile_inbox_ack_events` but never
  mutates the source approval/anomaly/kill-switch row. Ack of an
  already-resolved item returns 409; ack of an unknown id returns
  404; repeated ack by the same actor is idempotent (no duplicate
  audit row). The actor_user_id comes from the bearer token; spoofing
  an ack on behalf of another user is not possible.
- **Detector runs are admin-only + audited** — `POST /v1/governance/
  detectors/run` writes zero, one, or many rows into
  `governance_anomalies` with `automated=true`; each write funnels
  through `app.audit.log_event` with `resource_type=governance.
  anomaly`. Thresholds live in `app/governance/detectors/thresholds.
  py` and are config-frozen at service boot (no per-request override).
- **Kill-switch overrides everything (unchanged from Phase 6)** — A
  tripped scope still vetoes every outbound broker intent that
  matches. The rebalancer respects the kill-switch at execute time:
  intents queued against a tripped scope are short-circuited into
  `failed` with reason `kill_switch_active`.

---

## 5. Build + Test

- `pnpm --filter @gv/types run build` — PASS.
- `pnpm --filter @gv/api-client run build` — PASS.
- `pnpm --filter @gv/ui run build` — PASS.
- `apps/web: ./node_modules/.bin/tsc --noEmit` — **PASS** (exit 0,
  no diagnostics). Verified at the PR7 commit (`73a1393`) that closes
  the web-surface work for this phase.
- `services/control_plane` — Alembic migrations `0014`, `0015`, `0016`
  apply cleanly against a fresh Postgres instance; `downgrade -1`
  returns the schema to the Phase 6 baseline.
- `pytest services/control_plane/tests/test_anomaly_detectors.py` —
  11/11 PASS (PR5).
- `pytest services/control_plane/tests/test_mobile_inbox.py` — 19/19
  PASS (PR6).

---

## 6. Three-Way Repo Verification

Required convergence SHA across the three repo copies:

- **audit-local** (`/sessions/nice-amazing-feynman/godsview-audit/Godsview`)
- **origin** (`https://github.com/Santhakumarramesh/Godsview.git`)
- **mnt clone** (`/sessions/nice-amazing-feynman/mnt/Godsview`)

All three sit on `phase-7-launch-and-scale` at
`73a139364ffc7ea912bd91c2c58c41ce19e19a57` (the PR7 commit), which this
PR8 handoff extends with the tag cut. Post-tag the three locations must
converge again on the PR8 SHA plus resolve `v2.7.0^{}` to the same
commit.

---

## 7. Next Phase — Phase 8 (Production Hardening)

Phase 7 brings the repo to *full launch-scale-capable* status. The
Phase 8 roadmap (per `docs/blueprint/09-phase-roadmap.md`) focuses on:

- IB adapter wire-through: replace the `BrokerUnavailable` stub with
  the real ib-insync gateway; add a paper-vs-live IB account
  segregation flag so the registry can hold both in quorum without
  cross-contaminating the live gate.
- Chaos + failover drills: synthetic broker outage injection, venue
  latency spike injection, and a documented runbook for `primary →
  secondary` flip under sustained `liveRoutable=false`.
- Rebalancer cron hardening: backpressure on `executing` plans when
  the `portfolio.rebalance.intents` queue exceeds a configured depth;
  per-account concurrency caps to prevent over-rotation.
- Mobile inbox push delivery: out-of-band channel (APNs / FCM) for
  `critical` severity items with operator-paired device registration.
- Detector fabric expansion: correlation-shift detector, liquidity-
  shock detector, and a calibration-drift detector scoped to the
  last-N-live-trades window instead of the current rolling-Brier
  window.

---

## 8. Sign-Off

- **Build:** PASS — four workspaces clean `tsc --noEmit`; apps/web
  incremental `tsc -b` exits 0 from both a cold and warm cache.
- **Schema:** PASS — three new Alembic revisions apply cleanly and
  reverse cleanly against the Phase 6 baseline. `mobile_inbox_ack_
  events` is append-only; `portfolio_rebalance_*` and `broker_*`
  tables are mutable with full audit-log coverage.
- **Security:** Every admin-mutating route listed in §3.1 is gated
  on the `admin` role and audit-logged through
  `app.audit.log_event`. The broker role/kind invariants, rebalance
  plan FSM, and mobile-ack idempotency are server-authoritative;
  client-side maps are UX only, never authority. The
  `portfolio.rebalance` and `rebalance_execute` governance policies
  enforce paired-approval on plan approve + execute. The kill-switch
  `global` scope continues to veto every outbound broker intent,
  including Phase 7 rebalance intents. Detector runs are admin-only
  and write immutable `automated=true` rows into
  `governance_anomalies`.
- **Readiness:** FULL — `SYSTEM_MODE=paper` remains the default; the
  Phase 7 surfaces operate against an empty broker registry, empty
  rebalance queue, and empty mobile inbox without failure. The first
  Alpaca adapter registered via `/v1/brokers/adapters` populates the
  registry; the first allocation plan approved on `/portfolio/
  allocation` (Phase 6) can be rebalanced via `/portfolio/rebalance`;
  the first anomaly emitted by `/v1/governance/detectors/run` shows
  up on both `/governance/anomalies` (Phase 6) and the mobile inbox
  (Phase 7).

Signed,
— the GodsView control plane, Phase 7 complete.
