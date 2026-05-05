# Operational Runbook

Day-to-day commands for running GodsView in single-EC2 paper mode.
Assumes you have followed `docs/PHASE_5/DEPLOY_SINGLE_EC2.md`.

All commands are run from `/opt/godsview` unless noted.

## Quick reference

| Action | Command |
|---|---|
| Start the stack | `docker compose -f docker-compose.minimal.yml up -d` |
| Stop the stack | `docker compose -f docker-compose.minimal.yml down` |
| Restart api only | `docker compose -f docker-compose.minimal.yml restart api` |
| Tail logs | `docker compose -f docker-compose.minimal.yml logs -f api` |
| Tail by channel | `docker compose -f docker-compose.minimal.yml logs api \| jq -r 'select(.channel=="reconciliation")'` |
| Health check | `curl http://localhost/healthz` |
| System diagnostics | `curl http://localhost/api/system/diagnostics` |
| Open shell in api | `docker compose -f docker-compose.minimal.yml exec api sh` |
| Open psql | `docker compose -f docker-compose.minimal.yml exec postgres psql -U godsview godsview` |

## Trip the kill switch

The kill switch halts ALL new orders immediately at the Phase 3 pipeline's gate 2.

```bash
# Activate
curl -X POST http://localhost/api/system/kill-switch \
  -H "x-godsview-operator: $GODSVIEW_OPERATOR_TOKEN" \
  -d '{"on":true,"reason":"manual_emergency_stop"}'

# Verify it took
curl http://localhost/api/system/diagnostics | jq '.kill_switch'

# Confirm it blocks: try to place an order
curl -X POST http://localhost/api/alpaca/orders \
  -H 'Content-Type: application/json' \
  -d '{"symbol":"BTCUSD","side":"buy","qty":0.001,"limit_price":50000,"stop_loss_price":49500,"take_profit_price":51000}'
# Expect: { "error": "kill_switch", "blocking_gate": "kill_switch", ... }

# Deactivate
curl -X POST http://localhost/api/system/kill-switch \
  -H "x-godsview-operator: $GODSVIEW_OPERATOR_TOKEN" \
  -d '{"on":false}'
```

## Run the reconciler manually

The Phase 5 reconciler runs every 5 min by default. Force a run for triage:

```bash
curl -X POST http://localhost/api/proof/reconciliation/run | jq
```

Inspect last result without triggering:

```bash
curl http://localhost/api/proof/reconciliation/status | jq
```

## Inspect data integrity

```bash
curl http://localhost/api/proof/integrity | jq '.total_violations, .by_rule'
```

If `total_violations > 0`:

1. Look at `.violations` to identify which rule fires most often.
2. `missing_audit_id` / `missing_broker_order_id`: usually means the trade was inserted before Phase 3 was deployed; safe to ignore for old rows.
3. `closed_without_pnl` or `closed_without_exit_time`: a `recordTradeClose` failed mid-flight; manually update the row from broker activity feed.
4. `open_too_long`: a position has been open > 24h with no close hook firing — most likely an orphan; run the manual reconcile.

## Inspect proof / metrics / equity

```bash
# Latest 50 trades
curl 'http://localhost/api/proof/trades?limit=50' | jq

# Live metrics
curl http://localhost/api/proof/metrics | jq '.metrics'

# Equity curve (one point per closed trade)
curl http://localhost/api/proof/equity | jq

# Rejected attempts (from Phase 3 audit log)
curl 'http://localhost/api/proof/trades?status=rejected' | jq '.count, (.trades[0])'

# Download CSV
curl -o paper_trades.csv http://localhost/api/proof/trades.csv
```

## Common failure modes + recovery

### Symptom: api healthcheck failing

```bash
docker compose -f docker-compose.minimal.yml logs api | tail -100
docker compose -f docker-compose.minimal.yml ps
```

If postgres is unhealthy: check disk (`df -h /data`). If logs show `DATABASE_URL` issues, re-check `.env`.

### Symptom: orders not placing in paper mode

In order:

1. `curl http://localhost/api/system/diagnostics | jq '.system_mode'` — must be `"paper"` or `"live_enabled"`.
2. `curl http://localhost/api/alpaca/account` — must return the paper account; if it errors, your `ALPACA_API_KEY` is wrong.
3. Place an order and read the response: `blocking_gate` tells you which Phase 3 gate is firing.

### Symptom: orphan positions accumulating

```bash
curl http://localhost/api/proof/reconciliation/status | jq '.reconciler.last_result'
```

If `error` is set, the reconciler can't reach the broker or DB. Otherwise, force a run and check for `untracked_positions` (broker has positions you didn't open via the system — manual trades).

### Symptom: high data_staleness rejections

The `data_staleness` gate trips when last tick > `GODSVIEW_MAX_DATA_AGE_MS` (default 30s). If this is firing constantly:

1. Check the WebSocket stream: `curl http://localhost/api/alpaca/stream-status`
2. If polling fallback is active, the IEX feed is degraded. Either accept the rejections (data really is stale) OR raise the threshold via `GODSVIEW_MAX_DATA_AGE_MS=60000`.

### Symptom: kill switch keeps re-tripping

Check audit log for the trigger:

```bash
docker compose -f docker-compose.minimal.yml logs api | \
  jq -r 'select(.priority=="high" or .blocking_gate=="kill_switch")'
```

The `kill_switch` is also tripped by some risk modules (e.g. circuit breaker on extreme drawdown). Resolve the underlying condition before clearing.

## Channel-based log filtering (Phase 5)

Three channels:

| Channel | What's there |
|---|---|
| `execution` | order_executor, alpaca route, risk pipeline gate decisions |
| `proof` | paper_trades store, /api/proof/* endpoints |
| `reconciliation` | Phase 5 reconciler, integrity job, background jobs |

```bash
# Just reconciliation events
docker compose -f docker-compose.minimal.yml logs api | \
  jq -r 'select(.channel=="reconciliation") | "\(.time) \(.level) \(.msg)"'

# All HIGH PRIORITY events (Phase 3 fallback closures, Phase 5 escalations)
docker compose -f docker-compose.minimal.yml logs api | \
  jq -r 'select(.priority=="high")'
```

## Database snapshots

Daily backup is configured via `/etc/cron.daily/godsview-backup` (see deploy guide). Manual snapshot:

```bash
docker compose -f docker-compose.minimal.yml exec -T postgres \
  pg_dump -U godsview godsview | gzip > /data/backups/godsview-$(date +%F-%H%M).sql.gz
```

Restore:

```bash
gunzip -c /data/backups/godsview-2026-05-05.sql.gz | \
  docker compose -f docker-compose.minimal.yml exec -T postgres psql -U godsview godsview
```

## Shutdown / maintenance window

```bash
# Trip the kill switch first
curl -X POST http://localhost/api/system/kill-switch \
  -H "x-godsview-operator: $GODSVIEW_OPERATOR_TOKEN" \
  -d '{"on":true,"reason":"maintenance"}'

# Wait for any open trades to be reconciled
curl -X POST http://localhost/api/proof/reconciliation/run | jq

# Stop the stack
docker compose -f docker-compose.minimal.yml down
```

When bringing it back:

```bash
docker compose -f docker-compose.minimal.yml up -d
# Once healthy, deactivate the kill switch
curl -X POST http://localhost/api/system/kill-switch \
  -H "x-godsview-operator: $GODSVIEW_OPERATOR_TOKEN" \
  -d '{"on":false}'
```
