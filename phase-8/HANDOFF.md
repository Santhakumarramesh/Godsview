# Phase 8 — Real Alert Center Wiring + Per-SLO Rules + Channel Mapping Doc

**Branch:** `phase-8-alert-center-wiring`
**Base:** `phase-7-doc-truth-launch-v1` (commit `586ab4d`, tag `v1.0.0`)
**Head:** `52f5099`
**Tag:** `v1.1.0`
**Patch:** `phase-8/0001-phase-8-alert-center-wiring.patch` (56 KB)
**Files changed:** 5 (877 insertions, 178 deletions)

---

## What this phase delivers

`v1.0.0` shipped the Alert Center page but left it pointed at mock data —
the `routes/alert_center.ts` file in the api-server was never mounted in
`routes/index.ts`, and the dashboard's five `/api/alerts/*` endpoints
(`summary`, `rules`, `channels`, `anomalies`, `escalation`) returned 404.

Phase 8 closes that gap:

- Deletes the never-mounted mock route.
- Adds a single canonical `lib/alerts/alert_center_view.ts` bridging
  module that translates the internal `Alert` ring buffer + SLO burn-rate
  state + SSE router stats into the dashboard's Alert Center shape.
- Extends the already-mounted `routes/alerts.ts` with nine new
  endpoints serving the dashboard.
- Wires the `alert-center.tsx` page to the real endpoints with a small
  ISO → relative-time adapter so nothing renders differently.
- Documents the tier → channel matrix in `docs/ALERT_CHANNEL_MAPPING.md`.

No new external dependencies. No schema changes. Phase 8 is
additive — rollback is `git revert 52f5099`.

---

## Apply

```bash
cd /path/to/Godsview
git checkout phase-7-doc-truth-launch-v1
git checkout -b phase-8-alert-center-wiring
git am < phase-8/0001-phase-8-alert-center-wiring.patch
git tag -a v1.1.0 -m "GodsView v1.1.0 — Alert Center real wiring"
```

---

## Files shipped

| File                                                              | Purpose                                                                        |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `artifacts/api-server/src/lib/alerts/alert_center_view.ts` (NEW)  | Bridging module — maps internal state to dashboard shape.                      |
| `artifacts/api-server/src/routes/alerts.ts` (EDITED)              | Adds 9 Alert Center endpoints; keeps internal-shape routes untouched.          |
| `artifacts/api-server/src/routes/alert_center.ts` (DELETED)       | Mock-only file that was never mounted. Replaced by the view module.            |
| `artifacts/godsview-dashboard/src/pages/alert-center.tsx` (EDITED) | Points at `/alerts/active-feed`; adds `toRelTime` adapter for ISO timestamps. |
| `docs/ALERT_CHANNEL_MAPPING.md` (NEW)                             | Tier → channel matrix, SLO→tier mapping, verification curls.                   |

---

## New endpoints on `routes/alerts.ts`

All new endpoints live under `/api/alerts/*` alongside the existing
internal-shape ones.

| Method / Path                     | Response shape                                           |
| --------------------------------- | -------------------------------------------------------- |
| `GET  /api/alerts/summary`        | `{totalActive, p1Critical, p2High, acknowledged, escalated, healthScore, full}` |
| `GET  /api/alerts/active-feed`    | `CenterAlert[]` — real alerts merged with burning SLOs   |
| `GET  /api/alerts/rules`          | `CenterRule[]` — one per `AlertType` + one per SLO       |
| `GET  /api/alerts/channels`       | `Channel[]` — Dashboard / Log / Webhook / SSE            |
| `GET  /api/alerts/anomalies`      | `{metrics[], recent[], systemHealth, monitoredCount, anomalousCount}` |
| `GET  /api/alerts/escalation`     | `EscalationLevel[]` — 3 tiers derived from env           |
| `GET  /api/alerts/health`         | `{status, subsystems, uptime}`                           |
| `POST /api/alerts/acknowledge`    | Body: `{timestamp}` → `{acknowledged, timestamp}`        |
| `POST /api/alerts/resolve`        | Body: `{timestamp}` → `{resolved, timestamp, resolvedAt}` |

The existing internal-shape endpoints (`GET /api/alerts`,
`GET /api/alerts/active`, `POST /api/alerts/:ts/ack`) are kept exactly
as they were — any consumer that depends on the wrapped `{alerts: [...]}`
shape continues to work.

---

## Shape-translation rules

The view module is the single place where internal alert state meets
the dashboard's expectations. Key rules:

| Internal field                            | CenterAlert field       | Dashboard-rendered value                                            |
| ----------------------------------------- | ----------------------- | ------------------------------------------------------------------- |
| `Alert.severity === "fatal" \| "critical"` | `priority = "P1"`       | Red pill                                                            |
| `Alert.severity === "warning"`             | `priority = "P2"`       | Orange pill                                                         |
| `Alert.type = "daily_loss_breach"`         | `category = "drawdown"` | "drawdown"                                                          |
| `Alert.type = "production_gate_block_streak"` | `category = "promotion"` | "promotion"                                                      |
| `Alert.type = "ensemble_drift"`            | `category = "calibration"` | "calibration"                                                     |
| `Alert.acknowledged = true`                | `status = "acknowledged"` | Yellow "In Review" pill (after dashboard mapping)                 |
| (burning SLO)                              | `category = "slo"`      | "slo"; priority derived from the SLO's `tier`                       |

The dashboard's existing renderer was built against relative-time
strings (`"2m ago"`) and capitalized status labels (`"New"`, `"In
Review"`, `"Resolved"`). Rather than force the backend to emit
presentation strings, the new `toRelTime(isoOrMs)` helper in the
dashboard does the conversion client-side — so the server keeps emitting
ISO timestamps and lowercase canonical statuses.

---

## Verification

```bash
cd /path/to/Godsview
./node_modules/.bin/tsc -p artifacts/api-server/tsconfig.json --noEmit    # exit 0
./node_modules/.bin/tsc --build                                           # exit 0
cd artifacts/api-server && node ./build.mjs                               # exit 0
```

All three checks are green at `v1.1.0`.

Runtime smoke:

```bash
curl -sf $API/api/alerts/summary      | jq '.totalActive, .healthScore'
curl -sf $API/api/alerts/active-feed  | jq 'length, .[0].priority, .[0].category'
curl -sf $API/api/alerts/rules        | jq 'length, .[0].source'
curl -sf $API/api/alerts/channels     | jq '.[] | {name, status}'
curl -sf $API/api/alerts/anomalies    | jq '.metrics | length, .recent | length'
curl -sf $API/api/alerts/escalation   | jq '.[] | {level, active}'
curl -sf $API/api/alerts/health       | jq '.status, .subsystems.sseRouter.running'
```

---

## Post-v1.1.0 backlog

Still open from the v1.0.0 HANDOFF (all day-2 improvements):

- **Dashboard SSE handlers** for the four Phase 5 event types — the
  active-feed endpoint polls on 3s; a push handler would cut lag.
- **Per-page vitest smoke tests with MSW** — deferred from Phase 4.
- **External PagerDuty / Slack routing doc** — Phase 8 ships the
  tier → channel matrix in `docs/ALERT_CHANNEL_MAPPING.md`; pairing
  it with a concrete example receiver webhook is the next doc pass.

None are blocking.

---

## Production-readiness gate status at `v1.1.0`

| Gate                                                          | Status       |
| ------------------------------------------------------------- | ------------ |
| 1. TradingView MCP + webhook router                           | shipped      |
| 2. Backtesting → paper → assisted live → auto-promotion       | shipped      |
| 3. AWS production deploy                                      | shipped      |
| 4. All 68 sidebar pages with RBAC                             | shipped      |
| 5. SLOs + alert routing + k6 baseline                         | shipped      |
| 6. Documentation truth pass + launch checklist                | shipped      |
| 7. **Alert Center real wiring + channel mapping**             | **shipped**  |

**Production readiness: 100%.** All gates shipped; Phase 8 closes the
Alert Center → real-backend gap that was listed as a post-v1 item in
the Phase 7 HANDOFF.

---

## Release

```bash
git push origin phase-8-alert-center-wiring
git push origin v1.1.0
```
