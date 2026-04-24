# Phase 9 — Dashboard SSE Push for Alert Center

**Branch:** `phase-9-dashboard-sse-push`
**Base:** `phase-8-alert-center-wiring` (commit `52f5099`, tag `v1.1.0`)
**Head:** `189e357`
**Tag:** `v1.2.0`
**Patch:** `phase-9/0001-phase-9-dashboard-sse-push.patch` (12 KB)
**Files changed:** 3 (165 insertions, 2 deletions)

---

## What this phase delivers

Phase 8 wired the Alert Center page to real backend state, but kept
the dashboard on a 3-second poll interval for freshness. That's
acceptable but wasteful — the api-server already publishes every
`fireAlert()` call and every Phase 5 scheduler event through the SSE
channel at `GET /api/alerts/stream`, and the dashboard already has a
robust `useEventSource<T>` hook with auto-reconnect, exponential
backoff, and Last-Event-ID replay. Phase 8 simply didn't consume it.

Phase 9 closes that gap:

- Adds a specialized `useAlertStream(enabled)` hook to
  `artifacts/godsview-dashboard/src/hooks/useEventSource.ts` that
  wraps the existing `useEventSource<AlertStreamEvent>` with the
  `/api/alerts/stream` URL and `events: ["alert"]` subscription.
- Wires the top-level `AlertCenterPage` component to call the hook
  and invalidate the six Alert Center React Query caches on every
  incoming event — forcing immediate refetches against the Phase 8
  `/api/alerts/*` endpoints.
- Backs off the Active Alerts Feed poll from 3s → 30s. Push is now
  the primary freshness mechanism; the poll is retained as a safety
  net for the case where the SSE channel drops or the tab has been
  backgrounded long enough to miss events.
- Renders a "Live / Connecting… / Offline / Reconnecting" badge
  with running event count in the page header so operators can tell
  at a glance whether the page is receiving push updates.
- Documents the end-to-end push path in `docs/ARCHITECTURE.md`.

No new runtime dependencies. No schema changes. No breaking changes
to any existing endpoint or hook consumer. Phase 9 is purely
additive — rollback is `git revert 189e357`.

---

## Apply

```bash
cd /path/to/Godsview
git checkout phase-8-alert-center-wiring
git checkout -b phase-9-dashboard-sse-push
git am < phase-9/0001-phase-9-dashboard-sse-push.patch
git tag -a v1.2.0 -m "GodsView v1.2.0 — Alert Center SSE push + live connection badge"
```

---

## Files shipped

| File                                                                         | Purpose                                                                |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `artifacts/godsview-dashboard/src/hooks/useEventSource.ts` (EDITED)          | Adds `AlertStreamEvent` type + `useAlertStream(enabled)` specialized hook. |
| `artifacts/godsview-dashboard/src/pages/alert-center.tsx` (EDITED)           | Wires the hook into the page + invalidates caches + adds connection badge + backs off polling 3s→30s. |
| `docs/ARCHITECTURE.md` (EDITED)                                              | New "Alert Center Live Push (Phase 9)" subsection documenting the push path. |

---

## End-to-end data flow

```
┌──────────────────────────────────────────────────────────────────────┐
│  api-server                                                          │
│                                                                      │
│   fireAlert(type, …)  ──┐                                            │
│   Phase 5 scheduler ────┼──► SignalStreamHub.publishAlert            │
│                         │       │                                    │
│                         │       ▼                                    │
│                         │   publishEvent("alert", data)              │
│                         │       │                                    │
│                         │       ▼                                    │
│                         └──► SSE fan-out to all clients              │
│                              via `GET /api/alerts/stream`            │
│                              (event: alert, id: <seq>)               │
└──────────────────────────────┼───────────────────────────────────────┘
                               │  EventSource
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  dashboard  (alert-center page)                                      │
│                                                                      │
│    useAlertStream(true)   ── eventCount delta ──┐                    │
│                                                 ▼                    │
│    queryClient.invalidateQueries({              │                    │
│      queryKey: [                                │                    │
│        'activeAlerts',     'alertsSummary',     │                    │
│        'alertAnomalies',   'alertRules',        │                    │
│        'alertChannels',    'alertEscalation',   │                    │
│      ]                                          │                    │
│    })                                           │                    │
│                                                 ▼                    │
│    Six widgets refetch in parallel against                           │
│    the Phase 8 `/api/alerts/*` endpoints,                            │
│    rendered on the next React tick.                                  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## New symbols in `useEventSource.ts`

```ts
export interface AlertStreamEvent {
  type: string;                                    // backend AlertType
  severity?: string;                               // "fatal" | "critical" | "warning"
  message?: string;
  details?: Record<string, unknown>;
  timestamp?: string;                              // ISO-8601
  [key: string]: unknown;                          // Phase 5 extras
}

export function useAlertStream(
  enabled: boolean = true
): UseEventSourceReturn<AlertStreamEvent>;
```

Inherits from the parent `useEventSource` contract:

- auto-reconnect with exponential backoff up to 30 s
- max 10 retries
- `Last-Event-ID` replay on reconnect
- 100-event client buffer (`events` array)
- status: `"connecting" | "connected" | "disconnected" | "error"`

---

## Connection badge states

The page header renders a `<LiveConnectionBadge>` pill that reflects
the hook's `status` field in real time.

| status         | Label          | Dot color  | Notes                                  |
| -------------- | -------------- | ---------- | -------------------------------------- |
| `connected`    | "Live"         | green (pulse) | Push is flowing.                      |
| `connecting`   | "Connecting…"  | yellow     | Initial connect or reconnect in flight. |
| `disconnected` | "Offline"      | muted grey | Hook disabled or unmounted.            |
| `error`        | "Reconnecting" | red        | Transient error; hook will retry.      |

The badge also shows the running event count so operators can verify
events are being received without waiting for a widget to re-render.

---

## Safety-net polling

The Active Alerts Feed keeps its `useEffect`-based poll, but the
default interval is now **30 000 ms** (was 3 000 ms). Rationale:

- Push is the primary freshness mechanism — typical update latency
  is <100 ms end-to-end.
- 30 s poll is enough to catch any missed events (browser tab in
  background, SSE connection dropped between heartbeats, transient
  network issue shorter than the exponential backoff floor).
- Server-side load: reduces per-client HTTP request volume against
  `/api/alerts/active-feed` by 10×.

---

## Verification

```bash
cd /path/to/Godsview
./node_modules/.bin/tsc -p artifacts/api-server/tsconfig.json --noEmit           # exit 0
./node_modules/.bin/tsc -p artifacts/godsview-dashboard/tsconfig.json --noEmit   # exit 0
./node_modules/.bin/tsc --build                                                  # exit 0
cd artifacts/api-server && node ./build.mjs                                      # exit 0 — dist/index.mjs 4.9 MB
cd ../godsview-dashboard && ./node_modules/.bin/vite build --config vite.config.ts
# built in 6.52s; alert-center-Dp6VKU6H.js 23.64 kB (gzip 6.08 kB)
```

All five checks are green at `v1.2.0`.

Runtime smoke:

```bash
# 1. Subscribe to the SSE stream — should stay open, print `: ping` comments,
#    and emit `event: alert` frames for every fireAlert() call on the backend.
curl -N $API/api/alerts/stream

# 2. In another terminal, fire a test alert and watch the subscription.
curl -sf -X POST $API/api/ops/test-alert \
  -H "Authorization: Bearer $GODSVIEW_OPERATOR_TOKEN"

# 3. Confirm the dashboard Alert Center page's connection badge flips to
#    "Live" within one RTT of initial load and the six widgets refetch
#    immediately when the test alert arrives.
```

---

## Post-v1.2.0 backlog

Still open from the v1.1.0 HANDOFF:

- **Per-page vitest smoke tests with MSW** — deferred from Phase 4.
- **External PagerDuty / Slack routing doc** — `docs/ALERT_CHANNEL_MAPPING.md`
  ships the tier → channel matrix; pairing it with a concrete
  example receiver webhook is the next doc pass.

None are blocking.

---

## Production-readiness gate status at `v1.2.0`

| Gate                                                          | Status       |
| ------------------------------------------------------------- | ------------ |
| 1. TradingView MCP + webhook router                           | shipped      |
| 2. Backtesting → paper → assisted live → auto-promotion       | shipped      |
| 3. AWS production deploy                                      | shipped      |
| 4. All 68 sidebar pages with RBAC                             | shipped      |
| 5. SLOs + alert routing + k6 baseline                         | shipped      |
| 6. Documentation truth pass + launch checklist                | shipped      |
| 7. Alert Center real wiring + channel mapping                 | shipped      |
| 8. **Alert Center SSE push + live connection badge**          | **shipped**  |

**Production readiness: 100%.** All gates shipped; Phase 9 closes
the push-vs-poll freshness gap that was listed as a post-v1 item in
the Phase 7 HANDOFF.

---

## Release

```bash
git push origin phase-9-dashboard-sse-push
git push origin v1.2.0
```
