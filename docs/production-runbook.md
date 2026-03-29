# Godsview Production Runbook

## 1) Pre-deploy checklist

- `corepack pnpm install`
- `corepack pnpm run typecheck`
- `corepack pnpm run build`
- Confirm `.env` includes all required production values:
  - `NODE_ENV=production`
  - `PORT`
  - `DATABASE_URL`
  - `CORS_ORIGIN`
  - `GODSVIEW_SYSTEM_MODE`
  - `GODSVIEW_OPERATOR_TOKEN` (required for `live_enabled`)
  - `ALPACA_API_KEY` + `ALPACA_SECRET_KEY` (required for `live_enabled`)

## 2) Runtime health checks

- Liveness: `GET /api/healthz`
- Readiness: `GET /api/readyz`

Expected readiness status:
- `200` when DB is reachable and mode requirements are satisfied.
- `503` when system is not ready to serve production traffic.

## 3) Startup behavior

- Server validates runtime config at startup and fails fast on invalid values.
- ML bootstrap starts in background and readiness reports state.
- Startup logs include sanitized runtime config (no secrets).

## 4) Request safety defaults

- Security headers enabled by default.
- JSON body size limited by `GODSVIEW_REQUEST_BODY_LIMIT`.
- In-memory API rate limiter controlled by:
  - `GODSVIEW_RATE_LIMIT_WINDOW_MS`
  - `GODSVIEW_RATE_LIMIT_MAX`
- Per-request ID propagated through `x-request-id`.

## 5) Graceful shutdown

Signals handled:
- `SIGTERM`
- `SIGINT`

Shutdown sequence:
1. Stop accepting new connections.
2. Wait for in-flight requests.
3. Close DB pool.
4. Exit cleanly.

Timeout control:
- `GODSVIEW_SHUTDOWN_TIMEOUT_MS`

## 6) Incident response quick actions

- Force no-trade mode:
  - set `GODSVIEW_SYSTEM_MODE=live_disabled`
  - set `GODSVIEW_KILL_SWITCH=true`
- Investigate readiness:
  - check `/api/readyz` response payload for failing checks.
- Rollback:
  - deploy previous known-good commit and re-run readiness checks.
