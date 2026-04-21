# GodsView Service Level Objectives

Defined in code at `artifacts/api-server/src/lib/slo/slo_definitions.ts`.
This document is the human-readable pair to that module — when they
diverge, the code is the source of truth. Alerts are scanned once per
minute by the SSE alert router (`lib/alerts/sse_alert_router.ts`) and
fired via the existing `GODSVIEW_ALERT_WEBHOOK_URL` pipeline.

---

## Tiers and escalation

| Tier     | Page target                 | Who responds        |
| -------- | --------------------------- | ------------------- |
| critical | Immediately (PagerDuty P1)  | on-call + tech lead |
| high     | Within one hour             | on-call             |
| normal   | Ticket + next business hour | ops rotation        |

Burn rate is "the rate at which the error budget is being consumed" —
per the Google SRE workbook. A burn rate of 1 means the budget is
spent at the pace the SLO permits. A burn rate of 14.4 over a rolling
1-hour window consumes 100% of a 30-day 99.9% budget.

---

## Critical SLOs

### `trading_signals_latency`

- **Target:** p95 of `/api/signals*` + `/api/trades*` ≤ 500ms
- **Objective:** 99% over a rolling 1 hour
- **Alert burn rate:** 6× (fires when burn ≥ 6)
- **Why:** the dashboard polls these endpoints during live sessions; a
  slow response surfaces as UI stalls that mask live pricing.

### `execution_path_availability`

- **Target:** 2xx rate on `/api/execution*` + `/api/alpaca*` ≥ 99.9%
- **Objective:** 99.9% over a rolling 24 hours
- **Alert burn rate:** 14.4×
- **Why:** a 5xx on the execution path can silently drop an order. This
  is the single hardest SLO in the system.

### `scheduler_freshness`

- **Target:** Elapsed time since last governance or calibration cycle
  ≤ 2× the configured interval
- **Objective:** 99.5% over a rolling 1 hour
- **Alert burn rate:** 4×
- **Why:** if the cron stops ticking, promotion gating and calibration
  drift detection go dark without any error being thrown.

---

## High SLOs

### `dashboard_read_latency`

- **Target:** p95 of all `/api/*` GETs ≤ 1.5s
- **Objective:** 95% over a rolling 1 hour
- **Alert burn rate:** 3×
- **Why:** long tail of portfolio, observability, performance pages;
  dashboard stays usable as long as this is green.

### `general_availability`

- **Target:** non-5xx rate on `/api/*` ≥ 99.5%
- **Objective:** 99.5% over a rolling 24 hours
- **Alert burn rate:** 6×
- **Why:** catches systemic regressions that don't fall into a specific
  route prefix (auth guard, rate limiter, upstream auth services).

---

## Normal SLOs

### `ops_endpoint_latency`

- **Target:** p99 of `/api/ops*` + `/api/observability*` ≤ 3s
- **Objective:** 95% over a rolling 1 hour
- **Alert burn rate:** 2×
- **Why:** ops surfaces are internal-only and tolerate more variance,
  but should still not block a runbook step.

---

## Alert routing

The SSE alert router subscribes to the four Phase 5 SSE event types and
forwards them through the existing `fireAlert()` pipeline:

| SSE event              | AlertType fired                 | Severity mapping        |
| ---------------------- | ------------------------------- | ----------------------- |
| `promotion_eligible`   | log + webhook only              | warning                 |
| `demotion_signal`      | `production_gate_block_streak`  | high/critical → critical; else warning |
| `calibration_snapshot` | log + webhook only              | warning                 |
| `calibration_drift`    | `ensemble_drift`                | critical / warning      |

Burn-rate alerts fire as `production_gate_block_streak` with severity
derived from the SLO tier (critical → critical; else warning).

---

## Verification

1. The SLO tracker observes every HTTP request via the middleware in
   `lib/slo/slo_tracker.ts`; ring buffer is capped at
   `SLO_OBSERVATION_MAX=5000` per SLO.
2. `/api/slo/budgets` returns the full snapshot including the computed
   burn rate, error budget remaining, and window sample count.
3. `/api/slo/burn-rate` filters to alerting SLOs only.
4. `GET /api/slo/router/status` reports the SSE alert router's run
   state and forwarded-event counts.
5. `POST /api/slo/reset` (operator-gated) clears observation buffers —
   only for post-incident clean-up; don't use it to paper over a
   breach.

---

## Load testing baseline

`load-tests/k6-api-stress.js` now exercises the scheduler status
endpoints and the SLO surface in its default VU ramp. A tighter
scheduler-only test lives at `load-tests/k6-scheduler-baseline.js` and
should be run before every release.

```bash
k6 run load-tests/k6-scheduler-baseline.js
k6 run load-tests/k6-api-stress.js
```

Both tests pass thresholds against a locally-running api-server with the
Phase 5 schedulers active. Breakpoints:

- `/api/governance/scheduler/*` p95 ≤ 500ms, p99 ≤ 1500ms
- `/api/calibration/scheduler/*` p95 ≤ 500ms, p99 ≤ 1500ms
- `/api/slo/*` p95 ≤ 750ms, p99 ≤ 2000ms

If any of these budgets regress, investigate before shipping — the
scheduler endpoints are pure in-memory reads and should stay under a
few hundred ms even under 100 concurrent VUs.
