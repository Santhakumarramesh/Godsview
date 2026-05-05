# Phase 9 — Production Operations Discipline (SRE Layer)

This document sits above Phase 8 (`OPERATIONS.md`). Phase 8 defines
the daily and weekly mechanics. Phase 9 defines the **discipline**:
how to instrument, alert, respond, and detect drift such that the
system can run for 30+ days without silent degradation.

It contains no code. Every threshold below is a starting point — tune
them once you have a 7-day baseline, then **lock them**. Changing
thresholds mid-window invalidates the validation evidence.

Contents:

1. Golden signals — traffic, errors, latency, saturation
2. Alert tiers — CRITICAL / WARNING / INFO
3. Alert-fatigue control — actionability rule
4. Incident response flow
5. Failure pattern detection
6. Drift detection — config / behavior / data
7. Log discipline
8. Strict operational rules
9. The 30-day success window
10. Output appendix — copy-pasteable matrices

---

## 1. Golden signals

The four signals every production service must export. Every
operational decision below references one of these four. If a metric
isn't tied to a signal, it's noise.

### 1.1 TRAFFIC — requests per second

Source: the Phase 6 `total_requests` counter at `/api/ops/metrics`.

```bash
# Sample twice with a known gap; compute requests/sec.
A=$(curl -fsS http://localhost/api/ops/metrics | jq '.counters.total_requests')
sleep 60
B=$(curl -fsS http://localhost/api/ops/metrics | jq '.counters.total_requests')
echo "rps = $(( (B - A) / 60 ))"
```

Phase-6 baseline (paper, 1 strategy, 2 symbols, 2 background jobs):

| Source of traffic | Expected rate |
|---|---|
| Reconciler probes (`/api/proof/reconciliation/status` from cron) | once / 5 min |
| Data-health job | internal, no HTTP |
| Operator daily check | one burst of ~10 requests / day |
| External monitoring (if you wired any) | depends on your scraper |
| **Steady-state total** | **< 0.1 req/sec** |

A jump above 1 req/sec on this deployment is unusual; investigate.

### 1.2 ERRORS — failed request rate

```bash
# Cumulative ratio
curl -fsS http://localhost/api/ops/metrics | jq '.counters | {
  failed: .failed_requests,
  total:  .total_requests,
  ratio:  ( if (.total_requests // 0) == 0 then null
            else (.failed_requests / .total_requests) end )
}'
```

| Window | Expected ratio |
|---|---|
| Steady state | < 0.5 % (some 4xx from rate-limited probes) |
| Spike threshold | > 5 % over 1 hour |
| CRITICAL | > 25 % over 5 min |

To distinguish 4xx (client error) from 5xx (service error):

```bash
docker compose -f /opt/godsview/docker-compose.minimal.yml logs --no-color --since=1h api | \
  jq -r 'select(.res.statusCode != null) | .res.statusCode' | \
  awk '{ buckets[int($1/100)*100]++ } END { for (b in buckets) printf "%dxx %d\n", b/100, buckets[b] }'
```

5xx rate is the more important number — it means the service itself
failed, not the caller.

### 1.3 LATENCY — p95 response time

The repo's existing `httpRequestDuration` (in `lib/metrics.ts`) is a
Prometheus histogram. Read p95 from the existing Prometheus endpoint:

```bash
# Raw histogram — count + sum, broken down by bucket
curl -fsS http://localhost/metrics | grep -E "^http_request_duration_seconds_(bucket|count|sum)" | head -20

# Quick p95 estimate via the Prometheus quantile expression
# (requires a Prometheus or equivalent — for ad-hoc, sample with curl):
for i in $(seq 1 50); do
  /usr/bin/time -f "%e" curl -s -o /dev/null http://localhost/api/health/phase6 2>&1
done | sort -n | awk 'NR==48 {print "p95=" $1 "s"}'
```

| Endpoint | Expected p95 |
|---|---|
| `/healthz` | < 10 ms |
| `/api/health/phase6` (db + redis check) | < 100 ms |
| `/api/ready/phase6` | < 200 ms |
| `/api/proof/metrics` | < 200 ms (computed from trade rows) |
| `/api/proof/equity` | < 150 ms |
| `/api/alpaca/orders` (POST) | < 800 ms (broker round-trip) |
| `/api/proof/reconciliation/run` | up to 5 s (broker fetch + DB walk) |

Latency that doubles week-over-week without a corresponding traffic
increase is a leading indicator of saturation (Section 1.4) or DB
slowness — investigate before it becomes errors.

### 1.4 SATURATION — CPU, memory, DB connections

```bash
# Container resource saturation
docker stats --no-stream --format \
  '{{.Container}} cpu={{.CPUPerc}} mem={{.MemPerc}} mem_usage={{.MemUsage}}' \
  $(docker compose -f /opt/godsview/docker-compose.minimal.yml ps -q)

# DB connection pool saturation (uses the existing health-route detail)
curl -fsS http://localhost/db-health | jq '{
  ok, latency_ms: .latencyMs, pool_total: .poolTotal,
  pool_idle: .poolIdle, pool_waiting: .poolWaiting
}'

# OS-level saturation
uptime
free -h
df -h /data /
```

Per-container expected envelope on `t3.medium` (2 vCPU, 4 GiB) with
a quiet paper workload:

| Container | CPU steady | Memory steady | Memory red line |
|---|---|---|---|
| postgres | < 5 % | 200–500 MiB | > 1.5 GiB |
| redis    | < 1 % | 30–100 MiB  | > 200 MiB   |
| api      | < 5 % | 250–500 MiB | > 1.0 GiB   |
| nginx    | < 1 % | 10–25 MiB   | > 80 MiB    |

| OS-level | Expected | Red line |
|---|---|---|
| `uptime` 1-min load | < 0.5 | > 1.5 |
| `/data` disk | < 50 % | > 80 % |
| `/` (root) disk | < 50 % | > 80 % |
| `pool_waiting` (db) | 0 | > 0 sustained |

DB connection pool waiting > 0 sustained means the api is creating
work faster than the pool can drain — investigate via
`pg_stat_activity` (Section 5.4).

---

## 2. Alert tiers

Three tiers. Every alert in every tier must have a named action below
it — no exceptions (Section 3 enforces this).

### 2.1 CRITICAL — page on-call immediately, act within minutes

| # | Symptom | Threshold | Detection | Action |
|---|---|---|---|---|
| C1 | Service unreachable | `curl /healthz` fails or returns 5xx for > 60 s | external probe or `docker compose ps` shows api not `(healthy)` | restart container; if restart-loop → check phase6 env validator log |
| C2 | DB unavailable | `/api/health/phase6` returns 503 with `db.status: "fail"` for > 60 s | poll `/api/health/phase6` once/min | check postgres container; restart if needed; verify `/data/postgres` mount |
| C3 | Execution path blocked | every `POST /api/alpaca/orders` returns the SAME `blocking_gate` for > 5 attempts in 5 min | inspect `blocking_gate` distribution (Section 5.2) | resolve the underlying gate state (kill switch off, news lockout off, data feed restored) |
| C4 | Restart loop | container `RestartCount` increases by ≥ 3 within 10 min | `docker inspect ... --format '{{.RestartCount}}'` polled twice | inspect last 50 log lines; usually phase6 fail-fast env missing or upstream dep down |
| C5 | Disk emergency | `/data` > 90 % full | `df -h /data` | rotate backups, prune docker artifacts, OR expand EBS |
| C6 | Reconciler error storm | `reconciler.last_result.error` non-null for ≥ 3 consecutive runs | `/api/proof/reconciliation/status` polled | check broker (Alpaca creds, network), check DB, restart api if both healthy |

Action contract for CRITICAL: page within 1 min, ack within 5 min,
mitigation in flight within 15 min. Postmortem within 48 hours
regardless of impact.

### 2.2 WARNING — investigate within the same business day

| # | Symptom | Threshold | Detection | Action |
|---|---|---|---|---|
| W1 | Rising error rate | 5xx ratio > 1 % over 1 hour | log filter on `res.statusCode` | grep stack-prefix in logs; identify which route; fix or escalate |
| W2 | Reconciler delayed | `last_reconciler_run` > 2 × interval (10 min default) | `/api/proof/reconciliation/status` | inspect `error`; restart api if persistent |
| W3 | Data-health delayed | `last_data_health_check` > 2 × interval (2 min default) | same | same |
| W4 | Integrity violations growing | `total_violations` non-zero AND > yesterday | `/api/proof/integrity` daily diff | inspect `.violations`; fix data or document acceptance |
| W5 | Acceptance ratio dropped | (today's accepted / today's attempts) < 0.5 × (7-day baseline) | derive from `/api/ops/metrics` daily diff | identify dominant `blocking_gate`; act per Section 5.2 |
| W6 | Memory drift | any container > 70 % MemPerc | `docker stats` | confirm not a leak (sample twice 1h apart); if growing, restart container |
| W7 | Disk warning | `/data` > 70 % | `df` | rotate backups proactively; plan EBS expansion |
| W8 | Latency drift | p95 of any endpoint doubled vs 7-day baseline | metric scrape | inspect DB activity; check container CPU/memory |
| W9 | High-priority log lines | any line with `priority: "high"` in last 24 h that's not explained | `docker logs ... | jq 'select(.priority=="high")'` | trace by `audit_id`; document cause; fix or accept |
| W10 | Untracked positions sustained | reconciler `untracked_positions` > 0 for ≥ 3 consecutive runs | `/api/proof/reconciliation/status` | confirm no manual trades; if there are manual trades, document; otherwise investigate stale state |

Action contract for WARNING: triage within 4 business hours, fix or
explicitly accept within 24 hours. If accepted, log the acceptance
in the ops log with a date and reason.

### 2.3 INFO — review weekly, no immediate action required

| # | Symptom | Threshold | Detection | Action |
|---|---|---|---|---|
| I1 | Trade volume drift | weekly trade count outside ±50 % of 4-week mean | derive from `/api/proof/trades` time series | record in weekly ops log; investigate if persists 2 weeks |
| I2 | Memory drift | api memory at end of week > beginning by > 50 MiB | weekly `docker stats` snapshot | restart api on the next planned maintenance window |
| I3 | DB growth | weekly DB size delta > 5 % | `pg_database_size` weekly | acceptable until > 10 GB total |
| I4 | Rejection-gate distribution shift | dominant rejection gate changed week-over-week | derive from `/api/proof/trades?status=rejected` | record in ops log |
| I5 | Backup time drift | weekly `pg_dump` taking > 2 × baseline | observe `time` of cron job | acceptable until > 5 minutes |

INFO items live in the weekly ops log. They never page anyone; they
inform the weekly review (Section 6 of `PHASE_8/OPERATIONS.md`).

---

## 3. Alert fatigue control

The single rule: **no alert without an action**. If the on-call
operator's response to an alert is "ignore it" or "ack and move on,"
the alert is broken. Either:

- raise the threshold so it stops firing on noise,
- delete the alert entirely,
- OR write the action that should be taken.

Operationalize this with a quarterly alert audit:

```bash
# How often did each alert fire over the last 7 days?
# Pseudo-output — assumes an external alerting system that records alert names.
# Replace with your alert pipeline's API.
echo "alert_name fires_7d ack_action_taken delete_or_keep"
```

For the alerts in Section 2, the actions are explicit. If you wire
them into an external alerting system (PagerDuty, Opsgenie, simple
SMTP), copy the **Action** column verbatim into the alert description
field. The operator should never need to think — just execute.

### 3.1 What gets pruned

These metrics are **noise** in this deployment and should NOT be
alerted on:

- gross `total_requests` rate changes (the system is intentionally
  low-traffic; small absolute changes look large in percent),
- `404` responses to scanners (bots probing common paths),
- `auth_failures` from rate-limited bots,
- DB latency spikes < 100 ms (irrelevant on this workload),
- container restart count if it's still 0 since the last deploy,
- Phase 6 counter resets after a `docker compose restart api` (this is
  expected; reset the day-over-day baseline manually).

### 3.2 What MUST be alertable

- `/healthz` returning anything other than 200 for > 60 s
- DB connection failures
- Restart loop (RestartCount climbing without operator action)
- `priority: "high"` log lines (fallback closures, kill switch trips)
- Disk > 90 %

---

## 4. Incident response flow

A linear, repeatable seven-step flow. Every incident — CRITICAL or
WARNING — follows the same shape. The DETECT step happens automatically
via Section 2; everything else is manual until it isn't.

```
┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌──────┐  ┌─────┐  ┌─────────┐
│ Detect  │→│  Triage │→│ Isolate │→│  Trace  │→│Confirm│→│ Fix │→│  Log   │
└─────────┘  └─────────┘  └─────────┘  └─────────┘  └──────┘  └─────┘  └─────────┘
   alert      tier +        which        audit_id     impact   if      ops log
   fired     subsystem      module         /         scope     allowed  + postmortem
                                       request_id              by §8
```

### 4.1 DETECT

The alert fired (Section 2) or the daily check (Section 2 of
`PHASE_8/OPERATIONS.md`) flagged a row as failed. Capture:

- the alert name + tier
- the timestamp
- the metric value that triggered

### 4.2 TRIAGE

Decide which tier this is and which subsystem owns it. Use this
mapping:

| Symptom | Subsystem |
|---|---|
| `/healthz` 5xx, container unhealthy | infrastructure (Docker, EC2) |
| DB unavailable, slow queries | data layer (postgres, lib/db) |
| Orders rejected by `data_staleness` | data feed (alpaca_stream) |
| Orders rejected by `kill_switch` | risk pipeline (Phase 3) |
| Orders rejected by `daily_loss_limit` or `max_exposure` | risk pipeline (Phase 3) |
| Orders rejected by other gates | risk pipeline (Phase 3) |
| Trades not appearing | strategy + scanner_scheduler |
| Open trades not closing | position_monitor + reconciler |
| `total_violations` > 0 | paper_trades store (Phase 4) + integrity (Phase 5) |
| `untracked_positions` > 0 | reconciler (Phase 5) |
| `priority: "high"` audit lines | execution + position close path |

### 4.3 ISOLATE

Identify the smallest unit (one container, one route, one trade row,
one job) that is misbehaving. Avoid the temptation to "look at
everything." Three targeted commands beat one vague grep.

### 4.4 TRACE

Follow the data. Log lines carry both `request_id` (every HTTP request)
and `audit_id` (every order attempt). Use them.

```bash
# By audit_id (trade-level — recipe from Section 5.1 of OPERATIONS.md)
AUDIT_ID=audit_1714960800000_42
docker compose -f /opt/godsview/docker-compose.minimal.yml logs --no-color --since=24h api | \
  jq -r --arg id "$AUDIT_ID" 'select(.audit_id == $id) |
    "\(.time) \(.level)/\(.channel // "-") \(.msg)"'

# By request_id (HTTP-level — recipe from Section 5.4 of OPERATIONS.md)
RID=$(curl -fsSI http://localhost/api/health/phase6 | grep -i '^x-request-id' | awk '{print $2}' | tr -d '\r')
docker compose -f /opt/godsview/docker-compose.minimal.yml logs --no-color api | \
  jq -r --arg id "$RID" 'select(.req.id == $id or .reqId == $id)'
```

### 4.5 CONFIRM IMPACT

Three questions:

1. **Are orders being placed correctly?** Run `/api/proof/metrics` and
   compare `total_executed` to the value before the incident.
2. **Are trades being closed correctly?** Confirm `total_closed` and
   `equity_curve` length match.
3. **Is the audit trail intact?** Run `/api/proof/integrity` —
   `total_violations` should be unchanged from before the incident.

If any of three are dirty, the incident is data-affecting. Tag the
postmortem accordingly.

### 4.6 FIX (only if allowed by Section 8)

Mitigations that are ALWAYS allowed during the validation window:

- Restart a container (api, postgres, redis, nginx).
- Toggle the kill switch.
- Run the reconciler manually.
- Adjust an `_INTERVAL_MS` env var (changing tick speed, not behavior).

Mitigations that are NOT allowed without resetting the validation window:

- Changing `GODSVIEW_MAX_*` risk thresholds.
- Editing strategy code or parameters.
- Modifying the execution choke point.
- Changing `GODSVIEW_SYSTEM_MODE`.
- Editing risk pipeline gate order.

If you hit a real bug that requires a forbidden change, reset the
30-day window and document the reset in the ops log with date, cause,
and the change made.

### 4.7 LOG INCIDENT

Append a row to the ops log (a plain text or markdown file in your
operator workspace, NOT in the repo). Format:

```
DATE: 2026-05-15
TIME: 14:32 UTC
TIER: WARNING
ALERT: W2 (reconciler delayed)
ROOT CAUSE: Alpaca paper API returned 503 for 4 minutes; reconciler
            retried each tick and recovered when broker recovered.
ACTION: None — system self-recovered. Logged here for trend tracking.
DATA-AFFECTING: No.
WINDOW RESET: No.
```

The log is searched at the weekly review. Recurring causes get
escalated; one-off events get noted and filed.

---

## 5. Failure pattern detection

Early-warning patterns that don't trip an alert but precede one.
Run these weekly during the weekly review.

### 5.1 Increasing retry count

The Phase 6 `withRetry` helper logs each attempt internally but does
not export an explicit retry counter. Detect retry pressure
indirectly:

```bash
# Lines mentioning "withRetry: timeout" or "withRetry: failed"
docker compose -f /opt/godsview/docker-compose.minimal.yml logs --no-color --since=7d api | \
  grep -cE "withRetry: (timeout|failed)"
```

If this number grows week-over-week, the wrapped operation is
becoming slower or flakier. Most likely candidate today: the
`/api/health/phase6` DB check.

### 5.2 Repeated rejection by the same risk gate

```bash
docker compose -f /opt/godsview/docker-compose.minimal.yml logs --no-color --since=24h api | \
  jq -r 'select(.outcome == "rejected_by_gate") | .blocking_gate' | \
  sort | uniq -c | sort -rn | head
```

If one gate dominates rejections (> 70 % of all rejections in 24 h):

| Dominant gate | Likely cause | Action |
|---|---|---|
| `data_staleness` | Alpaca WebSocket in polling fallback | check `/api/alpaca/stream-status`; restart if stuck |
| `kill_switch` | someone tripped it and forgot | clear via operator-token POST |
| `news_lockout` | news lockout left active | clear via the risk_engine endpoint |
| `daily_loss_limit` | hit the cap repeatedly | strategy is taking too many losses; STOP and review |
| `max_exposure` | concurrent caps reached repeatedly | evaluate if the cap is too tight for current trade frequency |
| `order_sanity` | bad input from a caller (scanner or bridge) | trace `audit_id` → identify caller |

### 5.3 Latency spikes without errors

Errors-OK + latency degraded = saturation building.

```bash
# Look for slow request log lines (assuming pino-http records duration)
docker compose -f /opt/godsview/docker-compose.minimal.yml logs --no-color --since=1h api | \
  jq -r 'select(.responseTime != null and (.responseTime | tonumber) > 500) |
    "\(.time) path=\(.req.url) ms=\(.responseTime) status=\(.res.statusCode)"'
```

If the same path appears in this list ≥ 5 times in an hour, that path
is slowing down. Check DB pool waiting (Section 1.4) and container
CPU (Section 1.4).

### 5.4 DB query saturation

```bash
# Long-running queries on Postgres
docker compose -f /opt/godsview/docker-compose.minimal.yml exec postgres \
  psql -U godsview -d godsview -c "
    SELECT pid, now() - query_start AS duration, state, substr(query,1,100) AS q
    FROM pg_stat_activity
    WHERE state != 'idle' AND now() - query_start > interval '1 second'
    ORDER BY duration DESC LIMIT 10;"

# Idle-in-transaction connections (a leak signal)
docker compose -f /opt/godsview/docker-compose.minimal.yml exec postgres \
  psql -U godsview -d godsview -c "
    SELECT count(*) FROM pg_stat_activity WHERE state = 'idle in transaction';"
```

`idle in transaction` > 0 sustained means a transaction was opened
without a corresponding commit/rollback — a leak in the application
code. Restart the api as a mitigation; root-cause via traced
`audit_id` for the transactions in flight.

### 5.5 Queue buildup (open trades)

```bash
# Open vs closed counts; a divergence indicates closure-path failure
curl -fsS http://localhost/api/proof/trades | jq '{open:.open_count, closed:.closed_count}'
```

If `open_count` grows day-over-day without a corresponding `closed_count`
growth, either:
- positions are being held longer than expected (verify against
  strategy invalidation rules), OR
- the position_monitor close path is failing silently (check
  `priority: "high"` log lines and the reconciler's `untracked_positions`).

---

## 6. Drift detection

Drift is silent change. The system runs, the alerts don't fire, but
the thing the system does today is not the thing it did 30 days ago.
Three flavors:

### 6.1 CONFIG drift

The `.env` file, the docker-compose file, and the deployed image are
the system's configuration surface. They should not change during the
validation window.

```bash
# .env hash — record on day 0; check weekly
md5sum /opt/godsview/.env

# docker-compose hash
md5sum /opt/godsview/docker-compose.minimal.yml

# Image SHA — what's actually running, not what's tagged
docker inspect $(docker compose -f /opt/godsview/docker-compose.minimal.yml ps -q api) \
  --format '{{ .Image }}'

# Git commit currently checked out
git -C /opt/godsview rev-parse HEAD
```

Action: if any of these four values change week-over-week without a
documented intentional deploy → reset the validation window and
document why.

### 6.2 BEHAVIOR drift

Behavior drift = the same input produces a different output. For this
system, that means: same market, same gates, but different acceptance
ratio or different rejection-gate mix.

```bash
# 7-day rolling acceptance ratio (run weekly)
curl -fsS "http://localhost/api/proof/trades?status=rejected&limit=5000" | \
  jq --arg since "$(date -u -d '7 days ago' +%FT%TZ)" '
    [.trades[] | select(.timestamp >= $since)] | length' > /tmp/rejected_7d.txt

REJ=$(cat /tmp/rejected_7d.txt)
ATT=$(curl -fsS http://localhost/api/ops/metrics | jq '.counters.order_attempts')
echo "rolling_7d: rejected=${REJ} attempts=${ATT} acceptance≈$(awk -v r=$REJ -v a=$ATT 'BEGIN{ if (a==0) print "n/a"; else printf "%.3f\n", (a-r)/a }')"

# 7-day rejection-gate distribution
curl -fsS "http://localhost/api/proof/trades?status=rejected&limit=5000" | \
  jq -r --arg since "$(date -u -d '7 days ago' +%FT%TZ)" '
    [.trades[] | select(.timestamp >= $since) | .blocking_gate] | group_by(.) |
    map({gate: .[0], count: length}) | sort_by(-.count)'
```

Record both numbers each Sunday. **Acceptance ratio shifting > 50 %
week-over-week, OR the dominant rejection gate changing** = behavior
drift. Causes: market regime change (legitimate; not actionable),
data feed change (legitimate; investigate), config drift (Section 6.1),
or — most worrying — silent code drift (verify image SHA).

### 6.3 DATA drift

Data drift = the trade rows look different from prior weeks even
though strategy and config didn't change.

```bash
# Symbols traded in the last 7 days vs prior 7 days
curl -fsS "http://localhost/api/proof/trades?limit=5000" | \
  jq -r --arg since "$(date -u -d '7 days ago' +%FT%TZ)" \
        --arg before "$(date -u -d '14 days ago' +%FT%TZ)" '
    .trades | reduce .[] as $t (
      {now: [], prior: []};
      if $t.entry_time >= $since then .now += [$t.symbol]
      elif $t.entry_time >= $before then .prior += [$t.symbol]
      else . end
    ) | { now: (.now | unique), prior: (.prior | unique) }'

# Quantity range for each symbol — should be stable
curl -fsS "http://localhost/api/proof/trades?limit=5000" | \
  jq -r '.trades | group_by(.symbol) | map({
    symbol: .[0].symbol,
    n: length,
    min_qty: (map(.quantity) | min),
    max_qty: (map(.quantity) | max),
    avg_pnl: (map(.pnl // 0) | add / length)
  })'

# Strategy IDs in use — should be exactly one ("ob_retest_long_1h")
curl -fsS "http://localhost/api/proof/trades?limit=5000" | \
  jq -r '[.trades[] | .strategy_id] | unique'
```

| Drift signal | What it suggests |
|---|---|
| New symbol appears | watchlist or strategy config changed silently |
| Quantity outside historical range | position-sizer change; investigate |
| New `strategy_id` value | strategy code or config changed |
| `mode` other than `"paper"` | system mode flipped — most concerning |
| Ratio of `closing: true` rows changed | position monitor behavior changed |

### 6.4 Drift dashboard (one-shot weekly)

```bash
echo "===== drift snapshot $(date -u +%FT%TZ) ====="
echo ".env md5: $(md5sum /opt/godsview/.env | awk '{print $1}')"
echo "compose md5: $(md5sum /opt/godsview/docker-compose.minimal.yml | awk '{print $1}')"
echo "image: $(docker inspect $(docker compose -f /opt/godsview/docker-compose.minimal.yml ps -q api) --format '{{ .Image }}')"
echo "git HEAD: $(git -C /opt/godsview rev-parse HEAD)"
echo "system mode: $(curl -fsS http://localhost/api/system/diagnostics | jq -r .system_mode)"
echo "strategies: $(curl -fsS 'http://localhost/api/proof/trades?limit=5000' | jq -c '[.trades[] | .strategy_id] | unique')"
echo "symbols: $(curl -fsS 'http://localhost/api/proof/trades?limit=5000' | jq -c '[.trades[] | .symbol] | unique')"
```

Compare the output week-over-week. Any line that changed without a
recorded change → investigate.

---

## 7. Log discipline

The system already produces structured logs (Phase 5 channel loggers
+ pino + pino-http request id + Phase 3 audit ids). Phase 9 enforces
that the discipline holds.

### 7.1 Required fields per log line

| Field | When required | Source |
|---|---|---|
| `time` | always | pino default (ISO 8601) |
| `level` | always | pino default |
| `msg` | always | pino default |
| `channel` | when from `execLog`/`proofLog`/`reconLog` | Phase 5 child loggers |
| `req.id` | every HTTP request log | pino-http genReqId |
| `audit_id` | every Phase 3/4/5 trade-related line | recordExecutionAudit |
| `priority` | every fallback closure or kill-switch trip | Phase 5 audit_log + position_monitor |

Verify discipline weekly:

```bash
# Sample 100 random log lines from the last hour; every one should be valid JSON
docker compose -f /opt/godsview/docker-compose.minimal.yml logs --no-color --since=1h api | \
  shuf -n 100 | while read -r line; do
    echo "$line" | jq -e . > /dev/null || echo "INVALID JSON: $line"
  done

# Lines from the audit_log helper (every order attempt) MUST have an audit_id
docker compose -f /opt/godsview/docker-compose.minimal.yml logs --no-color --since=24h api | \
  jq -r 'select(.msg | contains("[execution_audit]")) | select(.audit_id == null) |
    "MISSING audit_id: \(.time) \(.msg)"'
# Expect: empty.

# Lines from a known channel MUST carry the channel field
docker compose -f /opt/godsview/docker-compose.minimal.yml logs --no-color --since=24h api | \
  jq -r 'select(.msg | startswith("[reconciler]")) | select(.channel == null) |
    "MISSING channel: \(.time) \(.msg)"'
# Expect: empty.
```

### 7.2 Searchability

Every operator should be able to answer these in < 60 seconds:

| Question | Command pattern |
|---|---|
| "What did this audit_id do?" | `jq -r --arg id <ID> 'select(.audit_id == $id)'` |
| "What did this request_id do?" | `jq -r --arg id <ID> 'select(.req.id == $id)'` |
| "What happened in the reconciler this hour?" | `jq -r 'select(.channel == "reconciliation")'` |
| "What rejected my last trade?" | `curl '.../api/proof/trades?status=rejected&limit=1' \| jq` |
| "What was the last fallback closure?" | `jq -r 'select(.outcome == "fallback_close_position")' \| tail -1` |

If any of these takes longer than 60 seconds, log discipline has
slipped — usually because a new caller emitted unstructured strings.

### 7.3 Log volume — no spam

```bash
# Lines/minute over the last 10 minutes
docker compose -f /opt/godsview/docker-compose.minimal.yml logs --no-color --since=10m api | wc -l

# Top 10 most frequent message strings in the last hour
docker compose -f /opt/godsview/docker-compose.minimal.yml logs --no-color --since=1h api | \
  jq -r '.msg' | sort | uniq -c | sort -rn | head -10
```

Steady-state expected on this deployment: < 50 lines/min, dominated
by request access logs and reconciler/data-health tick lines.

If a single message is firing > 100 times/hour and isn't an HTTP
access log, it's noise. Find its source and either reduce verbosity
or aggregate.

---

## 8. Strict operational rules

These are not guidelines. Breaking any of them either invalidates the
validation evidence or risks data integrity. The validation window
clock resets on any rule break.

### 8.1 Do NOT redeploy during the validation window

The `restart: always` policy keeps the api container running across
crashes. A `docker compose up -d --build` resets the in-process
counters (Phase 6) and breaks the day-over-day diff. Acceptable
exceptions:

- emergency security patch (document the deploy in the ops log)
- a CRITICAL-tier bug fix that you'll revert if it doesn't help

Anything else: defer to the next planned maintenance window AFTER
the 30-day clock completes.

### 8.2 Do NOT change strategy

The strategy module (`lib/strategies/ob-retest-long-1h/`) is locked.
No threshold changes, no rule additions, no parameter tuning. If you
believe a rule is wrong, stop the system and document the change as a
new strategy version. Don't edit in place.

### 8.3 Do NOT change risk logic

The Phase 3 pipeline is locked. No gate additions, no gate reordering,
no new bypass flags. The `GODSVIEW_MAX_*` env vars are configurable
but changes mid-window invalidate the data — same as strategy changes.

### 8.4 Do NOT modify env variables mid-run

Two classes of env vars:

| Class | Examples | Mid-run change OK? |
|---|---|---|
| Behavioral (changes what the system DOES) | `GODSVIEW_MAX_*`, `GODSVIEW_SYSTEM_MODE`, `ALPACA_BASE_URL`, `GODSVIEW_OPERATOR_TOKEN` | NO — reset window |
| Operational (changes how OFTEN the system does something) | `GODSVIEW_RECONCILER_INTERVAL_MS`, `GODSVIEW_DATA_HEALTH_INTERVAL_MS`, `LOG_LEVEL` | YES — document in ops log |
| Capacity (changes resource limits, not logic) | `DB_POOL_MAX`, `GODSVIEW_RATE_LIMIT_*` | YES — document in ops log |

When in doubt, treat the variable as behavioral (= window reset).

### 8.5 Do NOT delete trade rows

Even mistakes are part of the audit trail. Wrong rows get a correcting
row appended; they don't get deleted. The reconciler is the only
process allowed to write trade rows automatically; everything else is
read-only via the proof endpoints.

### 8.6 Do NOT bypass the operator-token gate

Phase 6 wired `requireOperator` on `POST /api/proof/reconciliation/run`
and the existing kill-switch endpoint. Sharing the token, embedding
it in scripts, or putting it in shell history is the equivalent of
sharing a root password. Generate a new token if it leaks.

### 8.7 Do NOT run two instances against the same broker account

The reconciler classifies broker positions with no matching DB row as
`untrackedPositions`. Two api instances on the same Alpaca account
will see each other's positions as untracked, log warnings every
tick, and eventually one will close the other's positions during a
stop-out fallback. **Never.**

### 8.8 If you must break a rule

Document the break in the ops log:

```
DATE / TIME / RULE BROKEN / REASON / WINDOW RESET (yes/no)
```

If `WINDOW RESET = yes`, the 30-day clock starts over from this
date. The validation window's value is in its uninterrupted nature;
preserve that even at the cost of accumulated time.

---

## 9. The 30-day success window

The window is a continuous 30-day period in which:

- the deployment ran 24/7 (intentional reboots count if RestartCount
  reflects only the intentional restarts),
- ≥ 100 trades closed,
- zero CRITICAL alerts triggered (or every CRITICAL had a documented
  resolution and was followed by ≥ 7 days of no recurrence),
- WARNING alerts were resolved within 24 hours,
- INFO items were logged but not acted on,
- no rule from Section 8 was broken,
- behavior + drift snapshots from Section 6 stayed within tolerance.

When all of the above hold for 30 consecutive days:

1. Generate the final evidence package:
   - `curl http://localhost/api/proof/metrics > /data/evidence/metrics_$(date +%F).json`
   - `curl http://localhost/api/proof/equity  > /data/evidence/equity_$(date +%F).json`
   - `curl 'http://localhost/api/proof/trades.csv?limit=10000' > /data/evidence/trades_$(date +%F).csv`
   - `curl http://localhost/api/proof/integrity > /data/evidence/integrity_$(date +%F).json`
   - copy `/data/backups/` to a separate offsite (S3, etc.)
   - take a final `md5sum` snapshot of `.env`, `docker-compose.minimal.yml`, the api image SHA, and `git rev-parse HEAD`
2. Mark the window CLOSED in the ops log with the start date, end
   date, and the four checksums above.
3. Decision point: **only now** is the system in a position to be
   considered for live-mode escalation. Live mode is OUT OF SCOPE for
   Phase 9 and requires its own checklist (broker safety, pre-flight
   cutover, rollback rehearsal).

If any single criterion fails before day 30, restart the clock from
the date of the failure. Restarting the clock is normal and expected;
it is the price of evidence quality.

---

## 10. Output appendix

Five copy-pasteable matrices. Use these directly in your alerting
config, on-call runbook, or weekly review template.

### 10.1 Monitoring command matrix

| Signal | Command |
|---|---|
| Containers | `docker compose -f /opt/godsview/docker-compose.minimal.yml ps` |
| Liveness | `curl -fsS http://localhost/healthz` |
| Phase 6 health | `curl -fsS http://localhost/api/health/phase6 \| jq` |
| Phase 6 readiness | `curl -fsS http://localhost/api/ready/phase6 \| jq` |
| Counters | `curl -fsS http://localhost/api/ops/metrics \| jq .counters` |
| Reconciler status | `curl -fsS http://localhost/api/proof/reconciliation/status \| jq` |
| Integrity | `curl -fsS http://localhost/api/proof/integrity \| jq '{total_violations, by_rule}'` |
| Resource use | `docker stats --no-stream` |
| DB pool | `curl -fsS http://localhost/db-health \| jq` |
| Disk | `df -h /data /` |
| Logs (live) | `docker compose -f /opt/godsview/docker-compose.minimal.yml logs -f api` |
| Logs (channel) | `docker compose ... logs --no-color api \| jq 'select(.channel == "reconciliation")'` |

### 10.2 Alert threshold table

| ID | Tier | Symptom | Threshold | Action |
|---|---|---|---|---|
| C1 | CRIT | service unreachable | `/healthz` 5xx > 60s | restart container |
| C2 | CRIT | DB unavailable | `db.status: "fail"` > 60s | restart postgres |
| C3 | CRIT | execution path blocked | same `blocking_gate` ≥ 5× in 5 min | resolve gate state |
| C4 | CRIT | restart loop | RestartCount +3 in 10 min | check phase6 env |
| C5 | CRIT | disk emergency | `/data` > 90 % | rotate / expand |
| C6 | CRIT | reconciler error storm | `error` non-null × 3 runs | check broker / DB |
| W1 | WARN | rising error rate | 5xx > 1 % over 1h | grep stack-prefix |
| W2 | WARN | reconciler delayed | last_run > 2× interval | check `error` |
| W3 | WARN | data-health delayed | last_run > 2× interval | same |
| W4 | WARN | integrity violations growing | > 0 today, was 0 yesterday | inspect `.violations` |
| W5 | WARN | acceptance ratio drop | < 0.5× 7-day baseline | identify dominant blocker |
| W6 | WARN | memory drift | container > 70 % | confirm leak vs spike |
| W7 | WARN | disk warning | `/data` > 70 % | rotate proactively |
| W8 | WARN | latency drift | p95 doubled vs baseline | DB activity check |
| W9 | WARN | high-priority log lines | unexplained `priority: "high"` | trace via audit_id |
| W10 | WARN | untracked positions | > 0 for ≥ 3 runs | verify no manual trades |
| I1 | INFO | trade volume drift | weekly count outside ±50 % of 4-week mean | record only |
| I2 | INFO | memory drift weekly | api memory grew > 50 MiB | restart on next window |
| I3 | INFO | DB growth | weekly delta > 5 % | accept until > 10 GB |
| I4 | INFO | rejection-gate shift | dominant gate changed week-over-week | record only |
| I5 | INFO | backup time drift | > 2× baseline | accept until > 5 min |

### 10.3 Incident response flow (one-page)

```
┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌──────┐  ┌─────┐  ┌─────────┐
│ 1.Detect│→│2.Triage │→│3.Isolate│→│ 4.Trace │→│5.Cnfm│→│6.Fix│→│ 7.Log   │
└─────────┘  └─────────┘  └─────────┘  └─────────┘  └──────┘  └─────┘  └─────────┘
  alert       tier +       which        audit_id     impact   if      ops log
  fired      subsystem     module         /         scope     allowed  + post-
                                       request_id              by §8   mortem

  CRIT: page 1m / ack 5m / mitigate 15m / postmortem 48h
  WARN: triage 4h business / fix-or-accept 24h
  INFO: weekly review only, never page
```

### 10.4 Failure pattern detection rules

| Pattern | Detection command | Action |
|---|---|---|
| Increasing retry count | `grep -cE "withRetry: (timeout\|failed)"` weekly | wrapped op slowing — investigate |
| Same gate dominating rejections | `jq '.blocking_gate' \| sort \| uniq -c \| sort -rn` daily | act per Section 5.2 mapping |
| Latency without errors | `jq 'select(.responseTime > 500)'` hourly | DB pool / CPU check |
| `idle in transaction` > 0 sustained | `pg_stat_activity` query | restart api; root-cause via audit_id |
| `open_count` growing without `closed_count` | `/api/proof/trades` daily | check position_monitor + reconciler |

### 10.5 Drift detection rules

| Type | Detection command | Action |
|---|---|---|
| CONFIG | `md5sum .env`, `md5sum docker-compose.minimal.yml`, image SHA, git HEAD weekly | reset window if any changed without record |
| BEHAVIOR | 7-day acceptance ratio + rejection-gate distribution weekly | reset window if shift > 50 % |
| DATA | symbols / quantity range / strategy_id / mode weekly | investigate; reset window if data integrity affected |

---

## 11. Closing

The strategy is locked. The execution path is locked. The risk
pipeline is locked. The proof system is locked. The reconciler is
locked. There is nothing left to build.

What remains is the discipline to **run the system as it is** for
30 days, observe it honestly via the matrices above, document every
deviation, and accumulate the evidence that the twelve success
criteria from `PHASE_8/OPERATIONS.md` and the constraints in this
document can be sustained simultaneously.

Production-grade operation is not a state — it is a daily practice.
This document is the practice.
