# Alert Channel Mapping

This document spells out which of GodsView's alert channels each SLO tier
and `AlertType` should reach. It is the operator's reference for wiring
`GODSVIEW_ALERT_WEBHOOK_URL` to the right destination and configuring the
upstream PagerDuty / Slack escalation policies.

The Phase 6 SSE Alert Router and Phase 7 SLO scanner already fan out to
every configured channel — **this document doesn't add code**, it
defines the on-call contract that operators must reflect in their
external paging tooling.

---

## Channels shipped out of the box

| Channel              | Source                              | Default state | Notes                                                                    |
| -------------------- | ----------------------------------- | ------------- | ------------------------------------------------------------------------ |
| Dashboard            | `GET /api/alerts/active-feed`       | always on     | Polled every 3s by the Alert Center page; SSE for the live event stream. |
| Structured Log       | `lib/logger` pino stream            | always on     | Goes to CloudWatch Logs in production; grep target for incident review.  |
| Webhook              | `GODSVIEW_ALERT_WEBHOOK_URL`        | env-gated     | Configure to Slack incoming webhook OR PagerDuty Events API v2 endpoint. |
| SSE Alert Router     | `lib/alerts/sse_alert_router.ts`    | autostart     | Bridges Phase 5 events + scans SLOs every 60s for burn-rate breaches.    |

Disable autostart with `SSE_ALERT_ROUTER_AUTOSTART=false` if you need to
quiet the router during a maintenance window.

---

## Tier → channel matrix

The matrix below is what operators should target when configuring
external escalation policies. The api-server fires every event through
every active channel; PagerDuty / Slack route via priority on the
receiving side.

| SLO tier  | AlertType examples                                     | Dashboard | Log | Webhook              | External paging                 |
| --------- | ------------------------------------------------------ | --------- | --- | -------------------- | ------------------------------- |
| critical  | `kill_switch_fired`, `daily_loss_breach`               | yes       | yes | yes (P1 channel)     | PagerDuty — page immediately    |
| critical  | `production_gate_block_streak`, `connection_lost`      | yes       | yes | yes (P1 channel)     | PagerDuty — page within 5m      |
| high      | `consecutive_losses`, `si_rejection_streak`            | yes       | yes | yes (ops channel)    | Slack #godsview-ops within 1h   |
| high      | SLO `dashboard_read_latency`, `general_availability`   | yes       | yes | yes (ops channel)    | Slack #godsview-ops within 1h   |
| normal    | `memory_pressure`, `ensemble_drift`                    | yes       | yes | yes (info channel)   | Slack #godsview-info — file ticket |
| normal    | SLO `ops_endpoint_latency`                             | yes       | yes | yes (info channel)   | Slack #godsview-info — file ticket |

**The webhook URL is generic.** Slack / PagerDuty routing happens in the
external system. Configure your webhook receiver to inspect the payload
shape:

```json
{
  "type": "kill_switch_fired",
  "severity": "fatal",
  "message": "...",
  "details": { ... },
  "timestamp": "2026-04-17T...Z"
}
```

`type` and `severity` are the routing keys. Map them at the receiver.

---

## SLO → on-call tier

Pulled from `slo_definitions.ts`. Burn rate is computed every 60s by the
SSE alert router; when a breach is observed, the router fires through
`fireAlert("production_gate_block_streak", …)` so the same paging
pipeline is reused.

| SLO id                          | Title                                          | Tier     | Default escalation         |
| ------------------------------- | ---------------------------------------------- | -------- | -------------------------- |
| `trading_signals_latency`       | Trading signals API latency (p95 < 500ms)      | critical | PagerDuty immediate        |
| `execution_path_availability`   | Execution path availability (99.9% over 1d)    | critical | PagerDuty immediate        |
| `scheduler_freshness`           | Governance / calibration scheduler freshness   | critical | PagerDuty within 5m        |
| `dashboard_read_latency`        | Dashboard read API latency (p95 < 1.5s)        | high     | Slack #godsview-ops, 1h    |
| `general_availability`          | API general availability (99.5% over 1d)       | high     | Slack #godsview-ops, 1h    |
| `ops_endpoint_latency`          | Ops endpoint latency (p99 < 3s)                | normal   | Slack #godsview-info, ticket |

---

## Escalation tier listing (returned by `GET /api/alerts/escalation`)

The Alert Center page renders three escalation tiers built from in-process
state by `lib/alerts/alert_center_view.buildEscalation()`:

| Level | Channels                                   | Delay   | Active when                                          |
| ----- | ------------------------------------------ | ------- | ---------------------------------------------------- |
| 1     | Dashboard, Structured Log, SSE Router      | 0       | always (in-process)                                  |
| 2     | Webhook (Slack / PagerDuty)                | 0       | `GODSVIEW_ALERT_WEBHOOK_URL` is set                  |
| 3     | On-call rotation (external)                | 5m      | external escalation policy configured (manual setup) |

Level 3 is **inactive in the dashboard view** until the operator confirms
the external escalation policy is in place. Toggle it on by editing
`buildEscalation()` once your PagerDuty service is wired up — there is
no in-process check we can do for that.

---

## Verification

```bash
# Confirm channels reflect real config
curl -sf $API/api/alerts/channels | jq '.[] | {name, type, status, enabled}'

# Confirm escalation tiers are listed
curl -sf $API/api/alerts/escalation | jq

# Confirm SSE router has forwarded at least one event
curl -sf $API/api/slo/router/status | jq '.router | {running, forwardedCount, lastForwardTs}'

# Fire a test alert
curl -sf -X POST $API/api/ops/test-alert \
  -H "Authorization: Bearer $GODSVIEW_OPERATOR_TOKEN"
```

A test alert should appear in:

1. The dashboard Alert Center page (within one 3s poll cycle)
2. CloudWatch Logs (immediate)
3. The configured webhook receiver (immediate)

If any of the three is missing, consult the rollback plan in
`docs/LAUNCH_CHECKLIST.md` — "Alert router flooding" / "Bad deploy"
scenarios.
