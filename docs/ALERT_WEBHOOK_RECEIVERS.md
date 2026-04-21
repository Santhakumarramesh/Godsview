# Alert Webhook Receiver Examples

Companion document to `docs/ALERT_CHANNEL_MAPPING.md`. Where that doc
defines **which** tiers map to which channels, this doc spells out
**how** to actually receive GodsView webhook payloads on the three
supported destinations and turn the `type`/`severity` routing keys
into real paging behaviour.

GodsView fires a single webhook per alert through
`GODSVIEW_ALERT_WEBHOOK_URL` (or `GODSVIEW_ALERT_WEBHOOK_URLS` for
fan-out). The payload is always:

```json
{
  "type": "daily_loss_breach",
  "severity": "fatal",
  "message": "Daily drawdown -5.12% exceeded kill-switch threshold -5.00%",
  "details": {
    "pnlUsd": -5123.44,
    "equityUsd": 100000.0,
    "threshold": -0.05
  },
  "timestamp": "2026-04-18T07:42:11.004Z"
}
```

`type` and `severity` are the routing keys. Map them at the receiver.

---

## 1. Slack receiver (incoming webhook)

Use Slack's native incoming webhook for the simplest path — zero
infrastructure, one URL per channel.

### Configure Slack

1. In Slack, go to your workspace → **Apps** → **Incoming Webhooks** →
   **Add to Slack**.
2. Pick a channel (e.g. `#godsview-ops`) and click **Add Incoming
   WebHooks integration**.
3. Copy the generated URL
   (`https://hooks.slack.com/services/T000/B000/XXX`).

GodsView's raw payload isn't Slack-shaped — Slack expects `text` or
`blocks`. You'll need a tiny adapter that converts. Run this adapter
as a Lambda, a small Express service, or as a dedicated `serverless`
function. The adapter below is 40 lines.

### Adapter: `gv-to-slack.ts`

```ts
import express from "express";
import type { Request, Response } from "express";

const app = express();
app.use(express.json());

const SLACK_URL = process.env.SLACK_INCOMING_WEBHOOK_URL!;

const SEVERITY_COLOUR: Record<string, string> = {
  fatal:    "#D32F2F",
  critical: "#E53935",
  warning:  "#FB8C00",
  info:     "#1E88E5",
};

app.post("/webhook", async (req: Request, res: Response) => {
  const { type, severity = "info", message, details, timestamp } = req.body ?? {};
  const colour = SEVERITY_COLOUR[severity] ?? "#5C6BC0";

  const slackBody = {
    attachments: [
      {
        color: colour,
        title: `:rotating_light: ${type}  —  ${severity}`,
        text: message ?? "(no message)",
        fields: Object.entries(details ?? {}).map(([k, v]) => ({
          title: k,
          value: typeof v === "object" ? "```" + JSON.stringify(v) + "```" : String(v),
          short: true,
        })),
        footer: "GodsView",
        ts: Math.floor(Date.parse(timestamp ?? "") / 1000) || Math.floor(Date.now() / 1000),
      },
    ],
  };

  const r = await fetch(SLACK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(slackBody),
  });
  res.status(r.ok ? 200 : 502).end();
});

app.listen(Number(process.env.PORT) || 8787);
```

Then point GodsView at the adapter:

```bash
export GODSVIEW_ALERT_WEBHOOK_URL=http://<adapter-host>:8787/webhook
```

---

## 2. PagerDuty receiver (Events API v2)

PagerDuty Events API v2 accepts a simple JSON POST and pages
according to the service's escalation policy.

### Configure PagerDuty

1. In PagerDuty, create a service with an **Events API v2** integration.
2. Copy the **Integration Key** (a 32-char hex routing key).

The same shape-translation pattern applies. The adapter below maps
`severity → pagerduty severity`, fills `dedup_key` with `type` so
repeat firings don't re-page, and includes `details` as custom fields.

### Adapter: `gv-to-pagerduty.ts`

```ts
import express from "express";
import type { Request, Response } from "express";

const app = express();
app.use(express.json());

const PD_INTEGRATION_KEY = process.env.PAGERDUTY_ROUTING_KEY!;
const PD_URL = "https://events.pagerduty.com/v2/enqueue";

const SEVERITY_MAP: Record<string, "critical" | "error" | "warning" | "info"> = {
  fatal:    "critical",
  critical: "critical",
  warning:  "warning",
  info:     "info",
};

app.post("/webhook", async (req: Request, res: Response) => {
  const { type, severity = "info", message, details, timestamp } = req.body ?? {};
  const pdSeverity = SEVERITY_MAP[severity] ?? "info";

  const pdBody = {
    routing_key: PD_INTEGRATION_KEY,
    event_action: "trigger",
    // Keep repeat firings of the same alert type coalesced.
    dedup_key: `godsview:${type}`,
    payload: {
      summary: message ?? `${type} (${severity})`,
      source: "godsview",
      severity: pdSeverity,
      timestamp: timestamp ?? new Date().toISOString(),
      component: "godsview-api-server",
      group: type,
      class: severity,
      custom_details: details ?? {},
    },
  };

  const r = await fetch(PD_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(pdBody),
  });
  res.status(r.ok ? 200 : 502).end();
});

app.listen(Number(process.env.PORT) || 8788);
```

**Only page on P1 / critical severities.** The cheapest way to
enforce that is to filter at the adapter. Add near the top of the
handler:

```ts
if (severity !== "fatal" && severity !== "critical") {
  return res.status(202).end();  // accept, don't page
}
```

Or route all severities to PagerDuty and let PagerDuty's Event Rules
drop non-P1 incidents server-side. Either works.

---

## 3. Fan-out receiver (both Slack + PagerDuty)

GodsView supports a comma-separated list in
`GODSVIEW_ALERT_WEBHOOK_URLS` — every listed URL receives the same
payload. This is the recommended production setup:

```bash
export GODSVIEW_ALERT_WEBHOOK_URLS="\
http://gv-to-slack.internal/webhook,\
http://gv-to-pagerduty.internal/webhook"
```

Slack gets every alert; PagerDuty filters to P1/critical only at the
adapter. If the Slack adapter is down, PagerDuty still pages —
degradation is independent per channel.

---

## 4. Verifying a receiver from the dashboard

The operator-gated endpoint `POST /api/ops/test-alert` emits a
synthetic `warning`-severity test alert that flows through every
configured channel. Use it after any receiver config change.

```bash
# 1. Fire the test alert
curl -sf -X POST $API/api/ops/test-alert \
  -H "Authorization: Bearer $GODSVIEW_OPERATOR_TOKEN"

# 2. Confirm arrival in:
#    - Dashboard Alert Center page (within ~1s via SSE push)
#    - CloudWatch Logs (immediate)
#    - Your Slack channel (within ~2s)
#    - PagerDuty? Should NOT page if severity filter is in place.
```

Or run the scripted verifier:

```bash
corepack pnpm --filter @workspace/scripts run verify-alert-webhook -- \
  --url http://localhost:8787/webhook \
  --type daily_loss_breach \
  --severity fatal
```

See `scripts/src/verify-alert-webhook.ts` for the source. It posts
exactly the shape the api-server emits, so it doubles as a
reproducible contract test for your receiver.

---

## 5. Tier→receiver mapping (reference)

Cross-reference with `docs/ALERT_CHANNEL_MAPPING.md`:

| SLO tier | Slack channel   | PagerDuty | Notes                                       |
| -------- | --------------- | --------- | ------------------------------------------- |
| critical | #godsview-ops   | **yes**   | Page on `fatal` + `critical` severities.    |
| high     | #godsview-ops   | no        | File a ticket via Slack automation.         |
| normal   | #godsview-info  | no        | Quiet; only for post-hoc review.            |

---

## 6. Security

- Webhook URLs are **bearer-equivalent secrets**. Store in your
  secret manager, never in git.
- Slack incoming webhook URLs should be rotated if leaked. Anyone
  with the URL can post to that channel.
- PagerDuty routing keys should be rotated if leaked. Anyone with
  the key can create incidents.
- If your adapter is public-facing, authenticate inbound requests
  with a shared secret (header check in the express handler). The
  api-server can add an `Authorization` header to the webhook via
  `GODSVIEW_ALERT_WEBHOOK_AUTH` if the Phase 2+ webhook-auth feature
  is enabled.
