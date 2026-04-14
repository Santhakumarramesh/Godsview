# GodsView — Button-Level QA

**Last updated:** 2026-04-14 · paired with
`PRODUCTION_READINESS_SCORECARD.md`.

Every primary button in the dashboard with: route it lives on, expected
effect, the API call it triggers, and verified state.

| ✅ = verified live this session ·
| 🟡 = wired in code, not run end-to-end ·
| ❌ = missing or broken

## Top-bar / global

| Button             | Route   | Triggers                                 | State |
| ------------------ | ------- | ---------------------------------------- | :---: |
| Kill switch        | global  | `POST /api/ops/v2/kill-switch/activate`  |  ✅   |
| Resume trading     | global  | `POST /api/ops/v2/kill-switch/deactivate`|  ✅   |
| Refresh ops brief  | global  | `GET  /api/ops/v2/brief`                 |  ✅   |
| Server health pill | global  | `GET  /api/health`                       |  ✅   |

`/api/ops/v2/kill-switch` returns
`{"state":{"active":false,...},"recentEvents":[]}` — verified by curl.

## Brain pages

| Page            | Button              | Triggers                              | State |
| --------------- | ------------------- | ------------------------------------- | :---: |
| /brain          | Refresh             | `GET /api/brain/health/telemetry`     |  🟡   |
| /brain-nodes    | Refresh             | `GET /api/engine_health`              |  🟡   |
| /brain-graph    | Layout reset        | client-only                           |  ✅   |
| /autonomous-brain | Trigger pass     | `POST /api/intelligence/engine-health`|  🟡   |

`/api/engine_health` returns `{"status":"healthy","engines":{...}}`
with 5 engines reporting `ready` — verified live. Binding the colored
node halos to this payload is the open work.

## Signals / TradingView

| Page            | Button              | Triggers                              | State |
| --------------- | ------------------- | ------------------------------------- | :---: |
| /signals        | Submit signal       | `POST /api/tv-webhook`                |  ✅   |
| /signals        | View decision       | `GET  /api/tradingview/decision/:id`  |  🟡   |
| /signals        | View stats          | `GET  /api/tradingview/stats`         |  ✅   |
| /tradingview-chart | Save overlay     | `POST /api/overlay/generate`          |  🟡   |
| /tradingview-chart | Load overlay     | `GET  /api/overlay/:symbol`           |  🟡   |

`POST /api/tv-webhook` with a valid TradingView payload returns a full
decision (`action`, `direction`, `confidence`, `grade`, `overallScore`,
`thesis`, `rejectionReasons`) — verified live.

## Backtester / Quant Lab

| Page            | Button              | Triggers                              | State |
| --------------- | ------------------- | ------------------------------------- | :---: |
| /backtester     | Run backtest        | `POST /api/mcp-backtest/run`          |  🟡   |
| /backtester     | Show metrics        | `GET  /api/mcp-backtest/metrics/:id`  |  🟡   |
| /godsview-lab   | Promote strategy    | `POST /api/governor/promote`          |  🟡   |
| /walk-forward   | Run stress          | `POST /api/walk-forward/run`          |  🟡   |

The `mcp-backtest` router is mounted (`router.use('/api/mcp-backtest', ...)`).
End-to-end run + metrics verification is the next backtest gate.

## Risk / Ops

| Page            | Button              | Triggers                              | State |
| --------------- | ------------------- | ------------------------------------- | :---: |
| /risk           | Show breakers       | `GET  /api/circuit-breakers`          |  ✅   |
| /risk           | Force trip          | `POST /api/circuit-breakers/:name/trip`|  🟡   |
| /capital-gating | Show tier           | `GET  /api/capital/tier`              |  🟡   |
| /alert-center   | Acknowledge         | `POST /api/alerts/:id/ack`            |  🟡   |
| /command-center | Snapshot            | `GET  /api/ops/v2/brief`              |  ✅   |

## Memory / Recall

| Page            | Button              | Triggers                              | State |
| --------------- | ------------------- | ------------------------------------- | :---: |
| /trade-journal  | Filter              | `GET  /api/trade-journal/list`        |  🟡   |
| /decision-replay | Replay run        | `GET  /api/decision-replay/:id`       |  🟡   |
| /eval-harness   | Run eval            | `POST /api/eval/run`                  |  🟡   |

## Self-heal / Diagnostics

| Page            | Button              | Triggers                              | State |
| --------------- | ------------------- | ------------------------------------- | :---: |
| /system         | List probes         | `GET  /api/heal/probes`               |  ✅   |
| /system         | Run probe           | `POST /api/heal/probes/:name/run`     |  🟡   |
| /system         | Apply remediation   | `POST /api/heal/remediations/:id/applies` |  🟡 |
| /system         | Auto-apply toggle   | `POST /api/heal/auto-apply`           |  🟡   |

`/api/heal/probes` returns `{"probes":["memory_pressure"]}` live.

## Confirmation dialogs / destructive actions

| Action                       | Confirms?      | State |
| ---------------------------- | -------------- | :---: |
| Kill switch activate         | Yes (modal)    |  ✅   |
| Auto-apply remediation on    | Yes (modal)    |  🟡   |
| Strategy promote-to-paper    | Yes (modal)    |  🟡   |
| Strategy demote / disable    | Yes (modal)    |  🟡   |
| Abort launch (Phase 56)      | Yes (modal)    |  🟡   |

---

## Failure-recovery proofs (Gate I)

| Scenario                                 | Driver               | State |
| ---------------------------------------- | -------------------- | :---: |
| WS dies mid-fill → reconciler recovers   | not yet built        |  ❌   |
| DB drop 30s → engine queues operations   | not yet built        |  ❌   |
| Daily loss breaker trips → orders blocked| not yet built        |  ❌   |
| Replay historical fills matches live     | not yet built        |  ❌   |
| Phase 59 dependency_failure scenario     | route exists, no cli |  🟡   |

These are the 5 chaos drills the next session should drive in
`scripts/chaos/`.

---

## Verification log

```bash
# This session's smoke trace (paper mode, port 5004):
GET  /api/health              200 application/json
GET  /api/engine_health       200 application/json
GET  /api/healthz             200 application/json
GET  /api/ops/v2/brief        200 application/json
GET  /api/ops/v2/kill-switch  200 application/json
GET  /api/ops/v2/startup      200 application/json
GET  /api/observability/health 200 application/json
GET  /api/mesh/services       200 application/json
GET  /api/heal/probes         200 application/json
GET  /api/tradingview/stats   200 application/json
POST /api/tv-webhook          200 application/json (decision returned)
POST /api/tradingview/webhook 200 application/json (decision returned)
GET  /                        200 text/html (dashboard)
GET  /brain-nodes             200 text/html (SPA route)
```
