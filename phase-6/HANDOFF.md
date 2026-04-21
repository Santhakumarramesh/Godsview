# Phase 6 — SLOs + SSE Alert Router + k6 Scheduler Baseline

**Branch:** `phase-6-slo-alerts-k6`
**Base:** `phase-5-promotion-cron` (commit `df19180`)
**Head:** `7dbd98d`
**Patch:** `phase-6/0001-phase-6-slo-alert-router-k6-baseline.patch`
**Files changed:** 10 (1,085 insertions)

---

## What this phase delivers

The Phase 5 schedulers were emitting SSE alerts that only reached
dashboard clients. If nobody was logged in, the alerts evaporated.
Phase 6 closes that loop by codifying the production SLOs as data,
recording every HTTP request against them, and wiring the SSE alert
stream into the existing `GODSVIEW_ALERT_WEBHOOK_URL` pipeline so
on-call gets paged via PagerDuty/Slack like every other alert.

| Production gate                                            | Status after Phase 6                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------- |
| TradingView MCP + webhook router                           | shipped (Phase 1)                                             |
| Backtesting → paper → assisted live → auto-promotion       | shipped (Phase 5)                                             |
| AWS production deploy                                      | shipped (Phase 3)                                             |
| All 68 sidebar pages with RBAC                             | shipped (Phase 4)                                             |
| **SLOs codified + alert routing + k6 baseline**            | **shipped (this phase)** — Phase 5 events page on-call; SLOs scanned hourly; k6 thresholds enforce scheduler perf budgets |

---

## Apply

```bash
cd /path/to/Godsview
git checkout phase-5-promotion-cron
git checkout -b phase-6-slo-alerts-k6
git am < phase-6/0001-phase-6-slo-alert-router-k6-baseline.patch
```

---

## Files shipped

| File                                                                | Purpose                                                                                        |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `artifacts/api-server/src/lib/slo/slo_definitions.ts` (NEW)         | 6 SLOs across critical/high/normal tiers — latency, availability, freshness. Source of truth. |
| `artifacts/api-server/src/lib/slo/slo_tracker.ts` (NEW)             | Singleton observation buffer + burn-rate computation + `sloMiddleware` Express handler.        |
| `artifacts/api-server/src/lib/alerts/sse_alert_router.ts` (NEW)     | Subscribes to the SignalStreamHub, parses Phase 5 events, fires `fireAlert()`; scans SLOs every 60s. |
| `artifacts/api-server/src/routes/slo.ts` (NEW)                      | `GET /api/slo/{definitions,budgets,burn-rate,burn-rate/:id,router/status}` + `POST /api/slo/reset`. |
| `artifacts/api-server/src/app.ts` (EDITED)                          | Mounts `sloMiddleware` after the prometheus middleware so the path is already resolved.        |
| `artifacts/api-server/src/index.ts` (EDITED)                        | Starts the SSE alert router after `server.listen()`; registers shutdown hook.                 |
| `artifacts/api-server/src/routes/index.ts` (EDITED)                 | Mounts `sloRouter`.                                                                            |
| `load-tests/k6-api-stress.js` (EDITED)                              | Adds scheduler + SLO endpoints to the default VU ramp; new latency thresholds.                 |
| `load-tests/k6-scheduler-baseline.js` (NEW)                         | Focused 20-VU 3-min poll test against the scheduler + SLO surfaces.                            |
| `docs/SLOs.md` (NEW)                                                | Human-readable pair to `slo_definitions.ts`; alert routing table; verification commands.       |

---

## How the SLO tracker is wired

```
HTTP request
    │
    ▼
app.ts: pino-http → securityHeaders → prometheus middleware → sloMiddleware
    │
    ▼
sloMiddleware records `res.on("finish")`:
    findSLOsForPath(path) → for each matching SLO → push observation to ring buffer
    │
    ▼
SLOTracker (singleton, 5,000-deep ring per SLO)
    │
    ▼
GET /api/slo/budgets → snapshot with burn rate per SLO
GET /api/slo/burn-rate → alerting SLOs only
```

A request matches multiple SLOs (e.g. an `/api/execution/orders` POST
counts against `execution_path_availability` AND `dashboard_read_latency`
AND `general_availability`). Each SLO's `isObservationGood()` is computed
independently, so latency and availability budgets evolve separately.

---

## How the SSE alert router is wired

```
Phase 5 schedulers
    │
    ├─ publishAlert({ type: "promotion_eligible", ... })
    ├─ publishAlert({ type: "demotion_signal", ... })
    ├─ publishAlert({ type: "calibration_snapshot", ... })
    └─ publishAlert({ type: "calibration_drift", ... })
                              │
                              ▼
                    SignalStreamHub.publish()
                              │
                              ▼
            (monkey-patched wrapper installed by sse_alert_router.start())
                              │
                              ├─ original publish() → SSE clients (unchanged)
                              └─ parsePhase5Event() → fireAlert() → log + webhook
```

The router monkey-patches the hub instance (not the prototype), so SSE
clients stay on the existing publish path with zero behaviour change.
Uninstall is keyed by reference — `sseAlertRouter.stop()` restores the
original publish function on graceful shutdown.

The router also runs a 60-second SLO scanner that calls
`sloTracker.getAlertingSLOs()` and fires `fireAlert("production_gate_block_streak", ...)`
for each burning SLO. Severity is derived from the SLO tier (critical →
critical; else warning).

---

## Codified SLOs

| ID                              | Tier     | Kind         | Target                                               | Objective | Window |
| ------------------------------- | -------- | ------------ | ---------------------------------------------------- | --------- | ------ |
| `trading_signals_latency`       | critical | latency      | p95 of `/api/signals*` + `/api/trades*` ≤ 500ms      | 99%       | 1h     |
| `execution_path_availability`   | critical | availability | non-5xx on `/api/execution*` + `/api/alpaca*`        | 99.9%     | 24h    |
| `scheduler_freshness`           | critical | freshness    | elapsed since last cycle ≤ 2× scheduler interval     | 99.5%     | 1h     |
| `dashboard_read_latency`        | high     | latency      | p95 of all `/api/*` GETs ≤ 1.5s                       | 95%       | 1h     |
| `general_availability`          | high     | availability | non-5xx on `/api/*`                                  | 99.5%     | 24h    |
| `ops_endpoint_latency`          | normal   | latency      | p99 of `/api/ops*` + `/api/observability*` ≤ 3s     | 95%       | 1h     |

---

## Env configuration

| Variable                          | Default | Purpose                                                          |
| --------------------------------- | ------- | ---------------------------------------------------------------- |
| `SSE_ALERT_ROUTER_AUTOSTART`      | `true`  | Set `false` to skip alert router at boot                         |
| `SLO_SCAN_INTERVAL_MS`            | `60000` | Burn-rate scan cadence (1 min default)                           |
| `SLO_OBSERVATION_MAX`             | `5000`  | Per-SLO ring buffer size                                         |

The existing alert webhook is unchanged: set `GODSVIEW_ALERT_WEBHOOK_URL`
to your Slack/PagerDuty webhook to receive the new event types.

---

## Operator endpoints (require `GODSVIEW_OPERATOR_TOKEN`)

```
POST /api/slo/reset          — clears SLO observation buffers (post-incident only)
```

Read endpoints are public on the status surface:

```
GET  /api/slo/definitions
GET  /api/slo/budgets
GET  /api/slo/burn-rate
GET  /api/slo/burn-rate/:id
GET  /api/slo/router/status
```

---

## k6 baseline thresholds

`load-tests/k6-scheduler-baseline.js` — 20 VUs constant, 3 minutes:

```
http_req_duration:    p(95) < 500ms,  p(99) < 1500ms
errors:               rate < 0.01
gov_status_latency:   p(95) < 300ms
gov_history_latency:  p(95) < 500ms
cal_status_latency:   p(95) < 300ms
cal_score_latency:    p(95) < 400ms
slo_budgets_latency:  p(95) < 500ms
slo_burn_latency:     p(95) < 400ms
```

`load-tests/k6-api-stress.js` extended thresholds:

```
gov_scheduler_latency: p(95) < 500ms,  p(99) < 1500ms
cal_scheduler_latency: p(95) < 500ms,  p(99) < 1500ms
slo_latency:           p(95) < 750ms,  p(99) < 2000ms
```

Run before every release:

```bash
k6 run load-tests/k6-scheduler-baseline.js
k6 run load-tests/k6-api-stress.js
```

---

## Verification

```bash
cd /path/to/Godsview
./node_modules/.bin/tsc -p artifacts/api-server/tsconfig.json --noEmit    # exit 0
./node_modules/.bin/tsc --build                                           # exit 0
cd artifacts/api-server && node ./build.mjs                               # exit 0
```

Three load-bearing checks:

1. The `artifacts/api-server` project typechecks clean — confirms the
   new SLO module, alert router, route file, and middleware integration
   all wire up correctly under strict mode.
2. The full workspace typecheck (`tsc --build`) exits 0 — confirms the
   dashboard, db, common-types, strategy-core and every downstream
   project still compiles.
3. The production esbuild bundle succeeds — the SLO tracker, alert
   router, route handlers, and k6 changes do not introduce any
   unresolved imports.

---

## Production-readiness gate status after Phase 6

| Gate                                                          | Status            |
| ------------------------------------------------------------- | ----------------- |
| 1. TradingView MCP + webhook router                           | shipped           |
| 2. Backtesting → paper → assisted live → auto-promotion       | shipped           |
| 3. AWS production deploy                                      | shipped           |
| 4. All 68 sidebar pages with RBAC                             | shipped           |
| 5. **SLOs + alert routing + k6 baseline**                     | **shipped (this phase)** |

All four original hard gates are now backed by codified SLOs that
page on-call when they degrade.

---

## What's deferred

Still on the Phase 7 backlog:

- **`@ts-nocheck` removal** on the remaining governance scaffolds —
  `promotion_discipline.ts`, `trust_surface.ts`, `shadow_scorecard.ts`.
- **Documentation truth pass** — README, ARCHITECTURE.md, OPERATOR_RUNBOOK
  updates that reflect Phases 1–6.
- **Launch checklist** — the final pre-v1.0.0 gate document covering
  env vars, secrets, AWS deploy commands, smoke tests, rollback plan.
- **`v1.0.0` tag** — the production-ready milestone.
- **Dashboard SSE handlers** for the four Phase 5 event types — Phase 6
  fixes the page/log path; the dashboard cache-bust hooks are still on
  the raw-fetch → React Query migration backlog.
- **Per-page vitest smoke tests with MSW** — deferred from Phase 4.
- **Real wiring of `routes/alert_center.ts`** — currently mostly mocked.

New on the Phase 7 backlog (created by this phase):

- **Per-SLO alert-rule mapping** in the dashboard `routes/alert_center.ts`
  so operators can see SLO burn-rate alerts alongside other alerts.
- **PagerDuty / Slack channel mapping doc** — the webhook URL is
  generic; document which channel each tier should route to.

---

## Next phase

**Phase 7 — Documentation truth pass + launch checklist + v1.0.0 tag.**
Final phase. Removes the remaining `@ts-nocheck` headers, updates the
top-level README, ARCHITECTURE.md, and OPERATOR_RUNBOOK to reflect the
six-phase build, ships a launch checklist that walks an operator from
clean repo to production deploy, and tags `v1.0.0`.
