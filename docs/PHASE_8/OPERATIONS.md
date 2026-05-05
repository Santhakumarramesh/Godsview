# Phase 8 — System Operation & Validation

This document is for operating a system that is **already deployed**.
It defines the ongoing daily and weekly discipline needed to keep the
paper-trading deployment running continuously and to detect failures
before they accumulate.

It contains no code. All commands assume:
- the operator is SSH'd into the EC2 host as `ubuntu`,
- the repo lives at `/opt/godsview`,
- `docker-compose.minimal.yml` is the active stack file,
- `${TOK}` is the operator token (`grep ^GODSVIEW_OPERATOR_TOKEN /opt/godsview/.env | cut -d= -f2`).

If the system is NOT yet deployed, see `docs/PHASE_7/DEPLOYMENT.md`.
For day-2 troubleshooting and recovery procedures, see
`docs/PHASE_5/RUNBOOK.md`.

Contents:

1. Continuous monitoring commands
2. Daily validation checklist
3. Trade validation (creation, closure, reconciliation)
4. Failure detection rules + thresholds
5. Log analysis recipes
6. Weekly checks
7. Success criteria
8. What NOT to do

---

## 1. Continuous monitoring commands

These are intended to be run on demand, or piped into `watch`/`tail`
for live observation. None of them write or mutate.

### 1.1 Container health (live view)

```bash
watch -n 5 'docker compose -f /opt/godsview/docker-compose.minimal.yml ps'
```

Expected steady state:

```
NAME                  IMAGE                        STATUS
godsview-postgres-1   postgres:16-alpine           Up (healthy)
godsview-redis-1      redis:7-alpine               Up (healthy)
godsview-api-1        godsview-api:latest          Up (healthy)
godsview-nginx-1      nginx:1.27-alpine            Up
```

Anything other than `(healthy)` for postgres/redis/api means
investigate before doing anything else.

### 1.2 Restart loop detector

```bash
docker compose -f /opt/godsview/docker-compose.minimal.yml ps --format json | \
  jq -r '. | "\(.Name) restarts=\(.RestartCount // 0) status=\(.Status)"'
```

A `RestartCount` that grows between successive runs of this command =
restart loop. Most likely cause: failing fail-fast env validator.
Check `Section 5.3` for the log filter.

### 1.3 Log tails by channel

```bash
# All channels, live
docker compose -f /opt/godsview/docker-compose.minimal.yml logs -f --tail=50 api

# Execution channel only (orders, risk pipeline gate decisions, audit log)
docker compose -f /opt/godsview/docker-compose.minimal.yml logs -f --tail=50 --no-color api | \
  jq --unbuffered -r 'select(.channel=="execution") | "\(.time) \(.level) \(.msg)"'

# Proof channel (paper_trades store + /api/proof endpoints)
docker compose -f /opt/godsview/docker-compose.minimal.yml logs -f --tail=50 --no-color api | \
  jq --unbuffered -r 'select(.channel=="proof") | "\(.time) \(.level) \(.msg)"'

# Reconciliation channel (Phase 5 jobs + integrity)
docker compose -f /opt/godsview/docker-compose.minimal.yml logs -f --tail=50 --no-color api | \
  jq --unbuffered -r 'select(.channel=="reconciliation") | "\(.time) \(.level) \(.msg)"'

# Anything HIGH PRIORITY (fallback closures, kill switch trips, escalations)
docker compose -f /opt/godsview/docker-compose.minimal.yml logs -f --tail=50 --no-color api | \
  jq --unbuffered -r 'select(.priority=="high")'
```

### 1.4 Memory and CPU usage

```bash
# Live per-container resource usage
docker stats --no-stream \
  $(docker compose -f /opt/godsview/docker-compose.minimal.yml ps -q)

# Or live-streaming
docker stats $(docker compose -f /opt/godsview/docker-compose.minimal.yml ps -q)
```

Expected on `t3.medium` (2 vCPU / 4 GiB) with a quiet paper workload:

| Container | Memory (steady) | CPU (steady) |
|---|---|---|
| postgres | 200–500 MiB | < 5 % |
| redis | 30–100 MiB | < 1 % |
| api | 250–500 MiB | < 5 % (baseline) — short bursts when scanner runs |
| nginx | 10–25 MiB | < 1 % |
| **Total** | **< 1.2 GiB** | **< 20 %** |

If any container's memory exceeds the threshold table in
**Section 4.5**, treat as a potential leak.

### 1.5 Disk usage on the data volume

```bash
df -h /data
du -sh /data/* | sort -h
```

Expected steady state:

```
/data/postgres     ~ 50–200 MB after first weeks
/data/memory       ~ 10–100 MB
/data/backups      grows by ~20 MB / day with daily pg_dump
/data/logs         depends on log volume; size-rotate via logrotate if you wish
```

Alert if `/data` is > 70 % full (`df -h /data | awk 'NR==2 {print $5}'`).

### 1.6 EBS root volume

```bash
df -h /
```

Should be < 50 %. Docker images, build cache, and Docker journals live
here. If it climbs:

```bash
docker system df
docker builder prune -af   # frees buildx layer cache
```

---

## 2. Daily validation checklist

Run this every morning. Each row has a single command and a single
pass criterion. The check passes when the command returns the expected
value with HTTP 200; it fails on any 4xx/5xx, any value outside the
expected range, or any thrown error.

| # | Check | Command | Pass criterion |
|---|---|---|---|
| 1 | Containers running | `docker compose -f /opt/godsview/docker-compose.minimal.yml ps --format '{{.Name}} {{.Status}}'` | every line ends with `(healthy)` (except nginx, which has no healthcheck) |
| 2 | Phase 6 health | `curl -fsS http://localhost/api/health/phase6 \| jq .service.status` | `"ok"` |
| 3 | Phase 6 readiness | `curl -fsS http://localhost/api/ready/phase6 \| jq -r .ready` | `true` |
| 4 | Counters increased | `curl -fsS http://localhost/api/ops/metrics \| jq .counters.total_requests` | strictly greater than yesterday's value (see Section 4.4) |
| 5 | Reconciler ran in last 10 min | `curl -fsS http://localhost/api/proof/reconciliation/status \| jq -r .reconciler.last_result.ran_at` | non-null AND within `2 × interval_ms` of `date -u +%FT%TZ` |
| 6 | Data health ran in last 2 min | `curl -fsS http://localhost/api/proof/reconciliation/status \| jq -r .data_health.last_result.ran_at` | non-null AND within `2 × interval_ms` |
| 7 | Reconciler last error | `curl -fsS http://localhost/api/proof/reconciliation/status \| jq -r .reconciler.last_result.error` | `null` |
| 8 | Data health last error | `curl -fsS http://localhost/api/proof/reconciliation/status \| jq -r .data_health.last_result.error` | `null` |
| 9 | Integrity violations | `curl -fsS http://localhost/api/proof/integrity \| jq .total_violations` | `0` (or matches yesterday — should not grow) |
| 10 | Trade count | `curl -fsS http://localhost/api/proof/trades \| jq '{open:.open_count, closed:.closed_count}'` | `closed_count` ≥ yesterday; `open_count` should not grow unboundedly (see Section 3) |
| 11 | Equity curve length | `curl -fsS http://localhost/api/proof/equity \| jq '.points \| length'` | matches `closed_count` from row 10 |
| 12 | Last trade timestamp | `curl -fsS http://localhost/api/proof/metrics \| jq -r .metrics.last_trade_at` | ≤ 7 days old; `null` is acceptable only in the first 7 days after deploy |
| 13 | Memory headroom | `docker stats --no-stream --format '{{.Container}} {{.MemPerc}}' $(docker compose -f /opt/godsview/docker-compose.minimal.yml ps -q)` | every container < 50 % MemPerc |
| 14 | Disk headroom | `df -h /data \| awk 'NR==2{print $5}'` | < 70 % |
| 15 | High-priority log lines (last 24h) | `docker compose -f /opt/godsview/docker-compose.minimal.yml logs --no-color --since=24h api \| jq -r 'select(.priority=="high")' \| wc -l` | `0`. If non-zero, inspect — high priority means fallback closure or kill-switch trip |

### 2.1 One-shot daily check script (operator-controlled)

The Phase 7 `daily-check.sh` covers rows 2, 3, 4, 9, 10, 12 in compact
form. Extend it locally if you want everything 1–15 in a single run.
Example (untested — use at your own risk):

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /opt/godsview
TOK=$(grep ^GODSVIEW_OPERATOR_TOKEN .env | cut -d= -f2)
NOW=$(date -u +%FT%TZ)
echo "===== ${NOW} daily validation ====="
docker compose -f docker-compose.minimal.yml ps --format '{{.Name}} {{.Status}}'
echo "--- /api/health/phase6 ---";  curl -fsS http://localhost/api/health/phase6  | jq -c .
echo "--- /api/ready/phase6 ---";   curl -fsS http://localhost/api/ready/phase6   | jq -c '{ready, reasons}'
echo "--- /api/ops/metrics ---";    curl -fsS http://localhost/api/ops/metrics    | jq -c '.counters'
echo "--- /api/proof/integrity ---"; curl -fsS http://localhost/api/proof/integrity | jq -c '{total_violations, by_rule}'
echo "--- /api/proof/reconciliation/status ---"
                                     curl -fsS http://localhost/api/proof/reconciliation/status | \
                                       jq -c '{recon: .reconciler.last_result, dh: .data_health.last_result}'
echo "--- /api/proof/metrics ---";  curl -fsS http://localhost/api/proof/metrics  | jq -c '.metrics | {total_executed, total_closed, win_rate, total_pnl, max_drawdown_pct, last_trade_at}'
echo "--- containers stats ---"
                                     docker stats --no-stream --format '{{.Container}} mem={{.MemPerc}} cpu={{.CPUPerc}}' \
                                       $(docker compose -f docker-compose.minimal.yml ps -q)
echo "--- /data disk ---";          df -h /data | awk 'NR==2'
echo "--- HIGH PRIORITY (24h) ---"
                                     docker compose -f docker-compose.minimal.yml logs --no-color --since=24h api | \
                                       jq -r 'select(.priority=="high")' | wc -l
```

This is **not committed** as a script in the repo (Phase 8 forbids new
features); run it manually or wire it via cron locally.

---

## 3. Trade validation

Three properties must hold continuously. Test them every day.

### 3.1 Trades are being created

```bash
# Cumulative count of accepted orders since the api booted
curl -fsS http://localhost/api/ops/metrics | jq '.counters.order_executions'

# Cumulative attempts (accepted + gate-rejected)
curl -fsS http://localhost/api/ops/metrics | jq '.counters.order_attempts'

# Today's NEW trades (UTC day)
curl -fsS http://localhost/api/proof/trades?limit=5000 | \
  jq --arg today "$(date -u +%F)" \
  '[.trades[] | select(.entry_time | startswith($today))] | length'
```

**Expected (paper, 1H OB Retest Long, 2 symbols):** between 0 and 3
new trades on a typical day. Strategy emits a setup only when:
displacement ≥ 1.5 × ATR, retest within 24 bars, all filters pass.
Many days will produce 0 setups and that's correct behavior.

### 3.2 Trades are being closed

```bash
# Open vs closed counts
curl -fsS http://localhost/api/proof/trades | jq '{open:.open_count, closed:.closed_count}'

# Mean time-to-close for trades closed in the last 7 days
curl -fsS "http://localhost/api/proof/trades?limit=500" | \
  jq -r --arg since "$(date -u -d '7 days ago' +%FT%TZ)" '
    [.trades[]
      | select(.status=="closed" and .exit_time != null and .entry_time >= $since)
      | (((.exit_time | fromdateiso8601) - (.entry_time | fromdateiso8601)) / 60)]
    | if length == 0 then "no_closed_trades_last_7d"
      else "mean_minutes=\(add/length | round) median_minutes=\(sort | .[length/2 | floor] | round) closed=\(length)" end'
```

**Expected:** OB Retest Long uses TP=2R or invalidation/expiry. Typical
closure window is 1–24 hours. If `open_count` keeps growing without a
matching `closed_count`, see Section 4.

### 3.3 Rejected trades are logged

```bash
# Cumulative rejected count (from persisted execution_audit)
curl -fsS http://localhost/api/ops/metrics | jq '.counters.rejected_trades'

# Today's rejection breakdown by gate
curl -fsS "http://localhost/api/proof/trades?status=rejected&limit=5000" | \
  jq --arg today "$(date -u +%F)" '
    [.trades[] | select(.timestamp | startswith($today))]
    | group_by(.blocking_gate) | map({gate: .[0].blocking_gate, count: length}) | sort_by(-.count)'
```

**Expected:** rejections are HEALTHY — they prove gates are firing.
If you see ONLY rejections and zero acceptances over a long window,
something is misconfigured (see Section 4.4).

### 3.4 Reconciliation is working (no orphan buildup)

```bash
curl -fsS http://localhost/api/proof/reconciliation/status | \
  jq '{
    last_run_age_sec: ((now - (.reconciler.last_result.ran_at | fromdateiso8601)) | floor),
    open_rows_total:   .reconciler.last_result.open_rows_total,
    orphans_found:     .reconciler.last_result.orphans_found,
    orphans_closed:    .reconciler.last_result.orphans_closed,
    untracked:         .reconciler.last_result.untracked_positions,
    error:             .reconciler.last_result.error
  }'
```

**Expected:**
- `last_run_age_sec` < `2 × GODSVIEW_RECONCILER_INTERVAL_MS / 1000` (default 600).
- `orphans_found == orphans_closed` (everything found gets closed).
- `error == null`.
- `untracked == 0` for a system that's the only one trading on this account.

---

## 4. Failure detection rules + thresholds

Each rule below names a measurable symptom, the threshold, the command
to evaluate it, and what to do when it fires.

### 4.1 System stuck (no trades for too long)

| Threshold | Action |
|---|---|
| Last accepted trade older than 7 days | inspect `last_trade_at`, then look at rejection patterns (Section 3.3) and check `data_staleness` rejections in particular |
| `order_attempts` counter has not increased in 24h | the strategy isn't even attempting orders — check scanner_scheduler is running and emitting signals |

```bash
# Days since the last accepted trade
curl -fsS http://localhost/api/proof/metrics | \
  jq -r '
    if .metrics.last_trade_at == null then "no_trades_yet"
    else "days_since=\((now - (.metrics.last_trade_at | fromdateiso8601)) / 86400 | round)"
    end'

# Order attempts in the last 24h (compare against current snapshot)
curl -fsS http://localhost/api/ops/metrics | jq '.counters.order_attempts'
# Run again 24h later and diff.
```

### 4.2 Reconciliation not running

| Threshold | Action |
|---|---|
| `last_reconciler_run` older than `2 × interval` (default 10 min) | inspect `reconciler.last_result.error`; restart api if persistent |
| `last_data_health_check` older than `2 × interval` (default 2 min) | same |
| Reconciler `error` field is non-null on consecutive runs | check broker connectivity (`/api/alpaca/account`) and DB (`/api/health/phase6`) |

```bash
curl -fsS http://localhost/api/proof/reconciliation/status | \
  jq '{
    recon_age_sec: ((now - (.reconciler.last_result.ran_at | fromdateiso8601)) | floor),
    dh_age_sec:    ((now - (.data_health.last_result.ran_at  | fromdateiso8601)) | floor),
    recon_error:   .reconciler.last_result.error,
    dh_error:      .data_health.last_result.error
  }'
```

### 4.3 Data integrity violations increasing

| Threshold | Action |
|---|---|
| `total_violations` > 0 and was 0 yesterday | inspect `.violations`; for each, identify the trade row and decide whether to fix or accept |
| `closed_without_pnl` or `closed_without_exit_time` > 0 | a `recordTradeClose` failed mid-flight; manual UPDATE may be needed |
| `open_too_long` > 0 (> 24 h open) | reconciler should be closing these as orphans; if it isn't, see Section 4.2 |

```bash
curl -fsS http://localhost/api/proof/integrity | jq '{total_violations, by_rule}'
```

### 4.4 High rejection rate

Rejection IS healthy — gates fire when conditions don't permit a trade.
But a sudden spike or a sustained 100% rejection rate on a market
that's open suggests a misconfiguration.

```bash
# 24-hour acceptance ratio
curl -fsS http://localhost/api/ops/metrics | \
  jq '.counters | {
    acceptance_ratio: (
      if (.order_attempts // 0) == 0 then null
      else (.order_executions / .order_attempts) end
    ),
    attempts: .order_attempts,
    accepted: .order_executions,
    rejected: .rejected_trades
  }'

# Today's rejection breakdown by gate (most common blocker first)
curl -fsS "http://localhost/api/proof/trades?status=rejected&limit=5000" | \
  jq --arg today "$(date -u +%F)" '
    [.trades[] | select(.timestamp | startswith($today))]
    | group_by(.blocking_gate) | map({gate: .[0].blocking_gate, count: length})
    | sort_by(-.count)'
```

| Threshold | Action |
|---|---|
| `acceptance_ratio` < 5 % over 7 days WITH `attempts` > 50 | something is misconfigured; identify dominant blocking_gate and act |
| `data_staleness` is the dominant blocker for > 1 hour | check WebSocket stream: `curl /api/alpaca/stream-status`; consider raising `GODSVIEW_MAX_DATA_AGE_MS` if the IEX feed is genuinely slow |
| `kill_switch` is the dominant blocker | someone tripped the kill switch; clear it: `curl -X POST .../api/system/kill-switch -H "X-Operator-Token: ..." -d '{"on":false}'` |
| `daily_loss_limit` recurring | the cap is being hit repeatedly — review trades, decide whether to widen the cap or stop the strategy |

### 4.5 Resource exhaustion (memory / CPU / disk)

| Resource | Container | Threshold | Action |
|---|---|---|---|
| Memory | postgres | > 1.5 GiB | check connection count, run `VACUUM ANALYZE` |
| Memory | api | > 1.0 GiB | likely a leak; restart api with `docker compose -f ... up -d --no-deps --force-recreate api` and file an issue |
| CPU | any | > 80 % sustained for > 10 min | check `docker stats`, check `pg_stat_activity` for long-running queries |
| Disk | `/data` | > 70 % | rotate backups (`find /data/backups -mtime +14 -delete`), or expand the EBS volume |
| Disk | `/` (root) | > 70 % | `docker builder prune -af`, `docker system prune -af` |

### 4.6 Restart loop

```bash
# Compare RestartCount across two invocations (10s apart)
docker compose -f /opt/godsview/docker-compose.minimal.yml ps --format json | jq -r '.RestartCount, .Name'
sleep 10
docker compose -f /opt/godsview/docker-compose.minimal.yml ps --format json | jq -r '.RestartCount, .Name'
```

If `RestartCount` grew, the container is in a loop. Most likely cause:

```bash
# Phase 6 fail-fast hit
docker compose -f /opt/godsview/docker-compose.minimal.yml logs --tail=50 --no-color api | \
  grep -i "phase6"
```

If that's the cause, restore the missing env var (Section 6.2 of
PHASE_7/DEPLOYMENT.md).

---

## 5. Log analysis recipes

Every Phase 3 audit row carries an `audit_id`. Every Phase 4-5 trade
row carries it too. Every HTTP request gets a `request_id` (from
`pinoHttp`, also returned in the `X-Request-ID` response header).

### 5.1 Trace one trade end-to-end by audit_id

```bash
# Step 1 — find a recent audit_id
AUDIT_ID=$(curl -fsS http://localhost/api/proof/trades?limit=1 | jq -r '.trades[0].audit_id')
echo "AUDIT_ID=${AUDIT_ID}"

# Step 2 — every log line that mentions it
docker compose -f /opt/godsview/docker-compose.minimal.yml logs --no-color --since=72h api | \
  jq -r --arg id "$AUDIT_ID" 'select(.audit_id == $id) |
    "\(.time) \(.level)/\(.channel // "-") \(.msg)"'

# Step 3 — find the corresponding trade row
curl -fsS "http://localhost/api/proof/trades?limit=5000" | \
  jq --arg id "$AUDIT_ID" '.trades[] | select(.audit_id == $id)'

# Step 4 — find the corresponding rejected attempt (if it was rejected)
curl -fsS "http://localhost/api/proof/trades?status=rejected&limit=5000" | \
  jq --arg id "$AUDIT_ID" '.trades[] | select(.audit_id == $id)'
```

### 5.2 Identify failed trades

A "failed trade" can mean three different things:

| Definition | Where it lives | Find with |
|---|---|---|
| Order rejected by a Phase 3 risk gate | `execution_audit` (persisted JSON) | `curl '.../api/proof/trades?status=rejected'` |
| Order accepted by gates, broker submission failed | `execution_audit` outcome=`broker_error` | filter execution_audit log: `outcome=="broker_error"` |
| Trade opened, position closed at a loss | `trades` table, outcome=`loss` | `curl '.../api/proof/trades' \| jq '.trades[] \| select(.outcome=="loss")'` |

```bash
# Loss-outcome trades (closed positions only)
curl -fsS http://localhost/api/proof/trades?limit=5000 | \
  jq '[.trades[] | select(.outcome=="loss")] | {count: length, total_pnl: (map(.pnl // 0) | add)}'

# Broker-error executions (audit log)
docker compose -f /opt/godsview/docker-compose.minimal.yml logs --no-color --since=7d api | \
  jq -r 'select(.outcome=="broker_error") | "\(.time) \(.symbol) \(.broker_error // .blocking_reason)"'
```

### 5.3 Identify fallback usage

A `fallback_close_position` outcome means `closeFullPosition` had to
bypass the choke point and call `closePosition` directly because the
gated path was blocked. Every fallback writes a HIGH PRIORITY audit row
with `original_blocking_gate` set.

```bash
# All fallback events in the last 7 days
docker compose -f /opt/godsview/docker-compose.minimal.yml logs --no-color --since=7d api | \
  jq -r 'select(.outcome=="fallback_close_position" or .priority=="high") |
    "\(.time) \(.symbol) original_gate=\(.original_blocking_gate // "-")"'

# Count by original blocking gate
docker compose -f /opt/godsview/docker-compose.minimal.yml logs --no-color --since=30d api | \
  jq -r 'select(.outcome=="fallback_close_position") | .original_blocking_gate' | \
  sort | uniq -c | sort -rn
```

A non-zero fallback count is not necessarily an error — stop-out exits
that race against `data_staleness` will legitimately fall back. But
**a sustained fallback rate is a signal** that `data_staleness`,
`session`, or `news_lockout` is too aggressive for stop-out semantics
in your environment.

### 5.4 Trace a single HTTP request by request_id

```bash
# Pick a recent request from the response headers of any call
RID=$(curl -fsSI http://localhost/api/health/phase6 | grep -i '^x-request-id' | awk '{print $2}' | tr -d '\r')
echo "REQUEST_ID=${RID}"

# Find every log line for that request
docker compose -f /opt/godsview/docker-compose.minimal.yml logs --no-color api | \
  jq -r --arg id "$RID" 'select(.req.id == $id or .reqId == $id)'
```

---

## 6. Weekly checks

Run these once a week (Sunday or Monday morning).

### 6.1 Database growth

```bash
# Database size
docker compose -f /opt/godsview/docker-compose.minimal.yml exec postgres \
  psql -U godsview -d godsview -t -c \
    "SELECT pg_size_pretty(pg_database_size('godsview'));"

# Top tables by size
docker compose -f /opt/godsview/docker-compose.minimal.yml exec postgres \
  psql -U godsview -d godsview -c "
    SELECT relname, pg_size_pretty(pg_total_relation_size(c.oid)) AS size
    FROM pg_class c LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 10;"
```

**Expected growth rate:**
- `trades`: ~1 KB / row × ~3 trades/day → ~1 MB/year
- `audit_events`: bursty; ~50 KB/day typical
- `signals`: ~100 KB/day if scanner runs every 2 min on 2 symbols

Total DB should be < 200 MB after the first 6 months on a 2-symbol
paper deployment.

### 6.2 Backup verification

```bash
# Newest backup
ls -lh /data/backups | tail -3

# Open the newest backup and confirm it parses
NEWEST=$(ls -1t /data/backups/godsview-*.sql.gz | head -1)
gunzip -c "$NEWEST" | head -5
gunzip -c "$NEWEST" | grep -c "^COPY public" || true   # rough sanity: should be > 0

# Restore-rehearsal (in an isolated container; does NOT touch production data)
docker run --rm -e POSTGRES_PASSWORD=test -d --name pg-restore-test postgres:16-alpine
sleep 5
gunzip -c "$NEWEST" | docker exec -i pg-restore-test psql -U postgres
docker exec pg-restore-test psql -U postgres -c "SELECT count(*) FROM trades;"
docker stop pg-restore-test
```

If the rehearsal fails, the backup is corrupt — fix the cron job
immediately. The system continues to run, but you have no recovery
point.

### 6.3 Error-log review

```bash
# Errors only, last 7 days
docker compose -f /opt/godsview/docker-compose.minimal.yml logs --no-color --since=168h api | \
  jq -r 'select(.level == "error" or .level == "fatal" or .level == 50 or .level == 60) |
    "\(.time) \(.channel // "-") \(.msg) — \(.err.message // .error // "")"' | \
  sort | uniq -c | sort -rn | head -20
```

Triage rule: any error message that appears more than 3 times in a
week deserves investigation. Recurring errors are operating capacity
that you don't have.

### 6.4 System uptime + restart history

```bash
# Container uptime
docker compose -f /opt/godsview/docker-compose.minimal.yml ps --format \
  '{{.Name}}\t{{.RunningFor}}\t{{.Status}}'

# Restart count per container (cumulative)
for c in $(docker compose -f /opt/godsview/docker-compose.minimal.yml ps -q); do
  docker inspect "$c" --format '{{.Name}} restarts={{.RestartCount}}'
done

# Host uptime
uptime
```

**Expected steady state:** `RunningFor` for the api container should be
> 7 days between intentional restarts. RestartCount should grow only
when you intentionally redeploy. Unintentional restarts after the
initial deploy → root-cause via Section 5.3.

### 6.5 docker-compose drift check

```bash
cd /opt/godsview
git status
git log --oneline -5
```

The deployed compose file should match the committed compose file. Any
local edits to `.env` are expected (and should NOT be committed); any
edits to `docker-compose.minimal.yml` should be deliberate.

---

## 7. Success criteria

The paper-validation period is considered **successful** when ALL of
the following are true simultaneously, sustained for the full window:

| # | Criterion | Measurement | Target |
|---|---|---|---|
| 1 | Closed trades | `curl /api/proof/metrics \| jq .metrics.total_closed` | ≥ 100 |
| 2 | Time elapsed | wallclock from first trade to now | ≥ 30 calendar days (Phase 1 spec) |
| 3 | Equity curve coherent | `curl /api/proof/equity \| jq '.points \| length'` matches `total_closed` | exact match |
| 4 | Equity curve sign | `ending_equity - starting_equity` | NOT a hard target — paper P&L doesn't gate go-live; **stability of the curve and the gate behavior is what counts** |
| 5 | Integrity clean | `curl /api/proof/integrity \| jq .total_violations` | `0` (or all violations explained and accepted) |
| 6 | Reconciler healthy | `last_reconciler_run` always within 2× interval, `error` always null | sustained for 30+ days |
| 7 | Data health healthy | `last_data_health_check` always within 2× interval, `error` always null | sustained for 30+ days |
| 8 | Zero unexpected high-priority events | `docker compose logs --since=30d api \| jq 'select(.priority=="high")'` | 0 lines, or every line explained |
| 9 | Zero unintentional restarts | container `RestartCount` after deploy | unchanged unless you redeployed |
| 10 | Backup integrity | weekly restore-rehearsal (Section 6.2) | passes every week |
| 11 | Audit completeness | every closed trade row has `audit_id` AND `broker_order_id` | 100 % |
| 12 | Rate limiter NEVER firing on the reconciler | `429` count on `/api/proof/reconciliation/run` over 30 days | 0 (you never need more than 6/min legitimately) |

When all twelve hold, the system has earned the right to be considered
for live-mode escalation. Live mode is OUT OF SCOPE for Phase 8 and
requires its own checklist (broker safety, pre-flight cutover,
rollback rehearsal).

### 7.1 Daily success scoring

Out of the daily checklist (Section 2), record pass/fail. Convert to
a percentage. Target: **15/15 every day for 30 consecutive days**.
A single failed day is not catastrophic — root-cause it, fix it,
restart the 30-day window if the failure was operationally
significant (a crash, a data-loss event, an unhandled bypass).

---

## 8. What NOT to do during the validation window

These rules apply for the full duration of the paper-validation phase.
They exist to make the data trustworthy.

- **Do not change the strategy.** Any rule tweak invalidates the trade
  history before the change.
- **Do not modify risk gates.** `MAX_DATA_AGE_MS`, `MAX_DAILY_LOSS_PCT`,
  `MAX_CONCURRENT_POSITIONS`, `MAX_TRADES_PER_DAY` — leave them alone.
  If you must tighten them for safety, document the change and reset
  the 30-day clock.
- **Do not redeploy the api container** unless the deploy is the
  subject under test. `docker compose restart api` resets the
  in-process counters (total_requests, failed_requests, order_attempts,
  order_executions, reconciliation_runs) and breaks day-over-day diffs.
  `rejected_trades` survives via `execution_audit`.
- **Do not delete trade rows.** Even mistakes are part of the audit
  trail. If a row is wrong, add a correcting row; don't rewrite history.
- **Do not edit `execution_audit` log files** in `/data/memory/` or
  whichever path `MEMORY_STORE_PATH` points at. Same reason.
- **Do not enable live mode.** Out of scope. See the Phase 1 escalation
  criteria.
- **Do not add features, optimize the strategy, or "improve" any of
  the protected subsystems.** Phase 6's "no refactoring" rule extends
  to Phase 8.
- **Do not run two instances against the same broker account.** The
  reconciler will see another instance's positions as `untrackedPositions`
  and the reconciliation guarantees collapse.

If any rule above must be broken (e.g. a real safety bug), document
the break, the cause, the fix, and the date. **Reset the 30-day window
on any change to strategy, gate constants, or the executor path.**

---

## 9. The end of the documented lifecycle

This is the last document in the Phase 1–8 sequence:

| Phase | Document | What it covers |
|---|---|---|
| 1 | (audit only) | repo truth |
| 2 | `lib/strategies/ob-retest-long-1h/README.md` | strategy definition |
| 3 | (in-code) | execution choke point, risk pipeline |
| 4 | (in-code) | proof system endpoints |
| 5 | `docs/PHASE_5/{ENV_MATRIX,DEPLOY_SINGLE_EC2,RUNBOOK,PROOF_EXPOSURE,CHANGELOG}.md` | reconciliation, integrity, packaging |
| 6 | `docs/PHASE_6/HARDENING.md` | health, ready, metrics, env validation, rate limits |
| 7 | `docs/PHASE_7/DEPLOYMENT.md` | how to deploy from scratch |
| 8 | `docs/PHASE_8/OPERATIONS.md` (this) | how to keep it running and prove it works |

The system does what it does. The only remaining task is to **let it
run**, observe it honestly, and accumulate the evidence that the
twelve success criteria above can be sustained.
