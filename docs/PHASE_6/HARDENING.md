# Phase 6 — Production Hardening

Pure operational hardening. No strategy changes, no execution changes,
no risk-pipeline changes, no proof or reconciliation logic changes. Only
adds: health/ready/metrics endpoints with the requested shape, per-route
rate limits on sensitive paths, fail-fast env validation, observability
counters, a timeout+retry helper, and an operator-token guard on the
reconciliation trigger.

## Files added (5)

```
artifacts/api-server/src/lib/ops/counters.ts                      pure in-process counters
artifacts/api-server/src/lib/ops/counter_middleware.ts            response-observer middleware
artifacts/api-server/src/lib/ops/with_retry.ts                    pure timeout+retry helper
artifacts/api-server/src/lib/ops/phase6_env.ts                    fail-fast env validator
artifacts/api-server/src/routes/phase6.ts                         /api/health/phase6, /api/ready/phase6, /api/ops/metrics
```

## Files modified (3)

```
artifacts/api-server/src/index.ts                                 + assertPhase6EnvOrExit() before app.listen
artifacts/api-server/src/routes/index.ts                          + counterMiddleware, per-route rate limits,
                                                                    requireOperator on reconciliation/run,
                                                                    incReconciliationRun hook, mount phase6Router
docker-compose.minimal.yml                                        restart policy: unless-stopped → always
```

## What is NOT changed

- `lib/strategies/ob-retest-long-1h/` — strategy module untouched
- `lib/order_executor.ts` — execution choke point untouched
- `lib/risk/risk_pipeline.ts` — risk pipeline untouched
- `lib/paper_trades/{store,reconciler,integrity,jobs}.ts` — proof + reconciliation logic untouched
- `routes/paper_proof.ts` — endpoint bodies unchanged (the operator gate is wired at routes/index.ts mount level, not inside the route file)
- The existing `/healthz`, `/readyz`, `/metrics` endpoints in `app.ts` and `routes/health.ts` are untouched. The Phase 6 versions live alongside at `/api/health/phase6`, `/api/ready/phase6`, `/api/ops/metrics`. Aliasing them to root paths is a deploy-time nginx decision.

## Endpoint shapes

### `GET /api/health/phase6`

```json
{
  "service": { "status": "ok", "uptime_sec": 1234 },
  "db": { "status": "ok", "latency_ms": 4 },
  "redis": { "status": "ok", "latency_ms": 1 },
  "last_reconciler_run": "2026-05-05T11:55:00.000Z",
  "last_data_health_check": "2026-05-05T11:59:30.000Z",
  "checked_at": "2026-05-05T12:00:00.000Z"
}
```

Returns HTTP 200 if `db.status === "ok"` and `redis.status !== "fail"`; otherwise 503.

### `GET /api/ready/phase6`

```json
{
  "ready": true,
  "reasons": [],
  "db": { "status": "ok", "latency_ms": 4 },
  "redis": { "status": "ok", "latency_ms": 1 },
  "env_missing": [],
  "checked_at": "2026-05-05T12:00:00.000Z"
}
```

When NOT ready (HTTP 503):

```json
{
  "ready": false,
  "reasons": ["db_fail", "env_missing:GODSVIEW_OPERATOR_TOKEN"],
  "db": { "status": "fail", "detail": "connection refused" },
  "redis": { "status": "skipped", "detail": "REDIS_URL not configured" },
  "env_missing": ["GODSVIEW_OPERATOR_TOKEN"],
  "checked_at": "2026-05-05T12:00:00.000Z"
}
```

### `GET /api/ops/metrics`

```json
{
  "counters": {
    "total_requests": 18432,
    "failed_requests": 41,
    "order_attempts": 27,
    "order_executions": 22,
    "rejected_trades": 88,
    "reconciliation_runs": 14,
    "uptime_sec": 86400,
    "started_at": "2026-05-04T12:00:00.000Z",
    "snapshot_at": "2026-05-05T12:00:00.000Z",
    "last_reconciler_run": "2026-05-05T11:55:00.000Z",
    "last_data_health_check": "2026-05-05T11:59:30.000Z"
  },
  "checked_at": "2026-05-05T12:00:00.000Z"
}
```

`rejected_trades` is sourced from the persisted `execution_audit` log (Phase 3) so the count survives process restarts. The other counters are in-process and reset on restart.

## Rate limits

Stacked on top of the existing `/api` app-wide limiter (300/min). Tighter buckets per path:

| Route | Limit | Env override | Reason |
|---|---|---|---|
| `POST /api/alpaca/orders` | 30 / min | `GODSVIEW_PHASE6_ORDERS_RATE_LIMIT_PER_MIN` | prevents accidental order loops + abusive retries |
| `/api/proof/*` | 120 / min | `GODSVIEW_PHASE6_PROOF_RATE_LIMIT_PER_MIN` | proof read endpoints; conservative ceiling |
| `POST /api/proof/reconciliation/run` | 6 / min | `GODSVIEW_PHASE6_RECONCILE_RATE_LIMIT_PER_MIN` | reconciler is heavy; manual triggers should be rare |

All limits are per-IP, per-method, in-memory (token bucket from
`createRateLimiter`). Headers returned: `X-RateLimit-Limit`,
`X-RateLimit-Remaining`, `X-RateLimit-Reset`.

## Operator-token gate

`POST /api/proof/reconciliation/run` is now gated by `requireOperator`.
Callers must send the operator token in one of:

- `Authorization: Bearer <token>`
- `X-Operator-Token: <token>`
- request body field `operator_token`

Failure modes:
- token not configured → 403, `operator_token_required`
- token missing on request → 401, `unauthorized`
- token present but wrong → 403, `forbidden`
- token correct → request proceeds + `incReconciliationRun()` fires

## Fail-fast env validator

Called from `index.ts` after `validateEnv()`, before `app.listen()`.
On missing variables it logs each with a `[phase6] required env missing`
line and calls `process.exit(1)`. The variables checked:

| Variable | Demo mode allows missing? |
|---|---|
| `DATABASE_URL` | no |
| `GODSVIEW_OPERATOR_TOKEN` | no |
| `ALPACA_API_KEY` | yes |
| `ALPACA_SECRET_KEY` | yes |
| `REDIS_URL` | yes |

`GODSVIEW_SYSTEM_MODE === "demo"` is the only mode that permits the
broker keys + redis URL to be empty. Paper and live both require all
five.

## Timeout + retry helper

`lib/ops/with_retry.ts` exposes a pure `withRetry(fn, opts)` helper.

```ts
import { withRetry } from "./lib/ops/with_retry";

const account = await withRetry(() => alpaca.getAccount(), {
  timeoutMs: 5_000,    // per attempt
  maxRetries: 2,       // → 3 attempts total
  backoffMs: 250,      // 250ms, 500ms, then give up
  shouldRetry: (err) => !(err as any).fatal,  // optional classifier
});
```

The Phase 6 `/api/health/phase6` endpoint already uses this for its DB
check. Other call sites are intentionally not refactored in this phase
— the helper is available infrastructure for future broker-call
hardening without touching the existing `placeOrder` path (which would
violate the no-refactor rule).

## Counter middleware

Mounted as the FIRST middleware in `routes/index.ts`. For every
response it observes:

```
incTotalRequests()
if status >= 400  → incFailedRequests()
if POST /api/alpaca/orders → incOrderAttempt()
if POST /api/alpaca/orders && status 2xx → incOrderExecution()
```

It does NOT modify the request or response. It does NOT touch the
order-executor or risk pipeline.

`incReconciliationRun()` is fired by a separate one-line middleware
mounted at `/api/proof/reconciliation/run` (also in `routes/index.ts`).

## Structured logging

Every log line emitted by Phase 1–6 code includes:

| Field | Source |
|---|---|
| `time` | pino default (ISO 8601) |
| `level` | pino default |
| `channel` | `execLog` / `proofLog` / `reconLog` (Phase 5 child loggers) |
| `request_id` | pinoHttp `x-request-id` middleware in `app.ts` |
| `audit_id` | included on every Phase 3 audit log line and on Phase 4/5 trade lifecycle lines |

To verify in production:

```bash
docker compose logs api | jq -r 'select(.channel and .request_id)' | head
docker compose logs api | jq -r 'select(.audit_id) | .audit_id' | sort -u | head
```

## Deployment safety

```yaml
# docker-compose.minimal.yml — Phase 6 update
services:
  postgres: { restart: always, healthcheck: ... }
  redis:    { restart: always, healthcheck: ... }
  api:      { restart: always, healthcheck: ..., depends_on: condition: service_healthy }
  nginx:    { restart: always }
```

The api healthcheck (`wget -qO- http://localhost:3001/healthz`) hits
the existing liveness endpoint. Combined with `restart: always` and
`depends_on.condition: service_healthy`, the container will not start
serving traffic until postgres and redis are healthy, and will be
restarted by the Docker daemon on any exit.

The Phase 6 fail-fast env validator (`assertPhase6EnvOrExit()`) runs
BEFORE `app.listen()`, so an misconfigured container will exit
immediately and the Docker restart loop will surface the failure
visibly in `docker compose ps`.

## Failure scenarios tested

| Scenario | Behavior verified by test |
|---|---|
| `withRetry` happy path | `phase6_with_retry.test.ts` — single attempt success |
| `withRetry` retries on transient errors | retries up to maxRetries; succeeds when transient resolves |
| `withRetry` exhausts retries | throws `RetryFailure` with `attempts === maxRetries+1` |
| `withRetry` `shouldRetry` short-circuit | reports actual attempts (= 1), does not over-count |
| `withRetry` exponential backoff | sleep durations are `[base, base*2, base*4]` |
| `withRetry` per-attempt timeout | rejects within timeoutMs even when wrapped fn is slow |
| `withRetry` retries timeouts when maxRetries > 0 | succeeds when later attempt is fast |
| Counters: zero state | snapshot returns zeros without fabrication |
| Counters: independent additivity | each counter increments only itself |
| Counters: snapshot stable + uptime monotonic | timestamps are valid; uptime never decreases |
| Phase 6 env: all required present → ok=true | |
| Phase 6 env: missing var → ok=false, name reported | |
| Phase 6 env: demo mode allows broker/redis empty | |
| Phase 6 env: demo mode still requires DATABASE_URL | |
| Phase 6 env: assertPhase6EnvOrExit({exit:false}) throws | |

## How to verify locally

```bash
# 1. Typecheck
corepack pnpm --filter @workspace/api-server typecheck

# 2. Run all Phase 6 tests in isolation (no DB needed)
corepack pnpm --filter @workspace/api-server vitest run \
  phase6_with_retry phase6_counters phase6_env

# 3. Bring up the minimal stack
docker compose -f docker-compose.minimal.yml up -d --build

# 4. Hit the new endpoints
curl -s http://localhost/api/health/phase6 | jq
curl -s http://localhost/api/ready/phase6  | jq
curl -s http://localhost/api/ops/metrics   | jq

# 5. Verify rate limit on /api/alpaca/orders
for i in $(seq 1 35); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost/api/alpaca/orders \
    -H 'Content-Type: application/json' -d '{"symbol":"BTCUSD"}'
done | sort | uniq -c
# Expect: ~30 of 200/4xx then ~5 of 429.

# 6. Verify operator gate on reconciler
curl -s -X POST http://localhost/api/proof/reconciliation/run | jq
# Expect: 401 unauthorized

curl -s -X POST http://localhost/api/proof/reconciliation/run \
  -H "X-Operator-Token: $GODSVIEW_OPERATOR_TOKEN" | jq
# Expect: 200 with reconcile result

# 7. Verify env fail-fast (in a throwaway container so you don't crash your prod):
docker run --rm -e DATABASE_URL=  -e ALPACA_API_KEY= godsview node dist/index.mjs
# Expect: exit code 1 with [phase6] required env missing log lines.
```

## Tests

```
RUN  v2.1.9 /tmp/phase6-iso

✓ tests/phase6_with_retry.test.ts (7 tests)
✓ tests/phase6_counters.test.ts (3 tests)
✓ tests/phase6_env.test.ts (5 tests)

Test Files  3 passed (3)
Tests       15 passed (15)
```
