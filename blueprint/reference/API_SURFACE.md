# API_SURFACE.md — GodsView v2+ Blueprint

**Status:** locked for Phase 0 scaffolding
**Scope:** every HTTP, SSE, and WebSocket route exposed by any service
in the target architecture; every event-bus topic consumed or produced
by those services; the canonical error shape; the canonical auth
contract. Concrete route handlers are implemented phase-by-phase
(see `phases/PHASE_*.md` for which phase adds which routes).

This document is the *contract catalog*. It does **not** implement
anything. It is the source of truth for:

1. OpenAPI generation (FastAPI emits from type hints; this doc is the
   cross-check).
2. The frontend `apps/web` type-safe client (generated off the OpenAPI
   schema per phase).
3. CI contract-validation gates (Phase 0 adds a schemathesis-style
   snapshot test that fails if a route drifts from this contract).
4. Per-phase scope control — a route that is not listed here cannot
   be merged without a blueprint amendment.

---

## 1. Principles

1. **One service owns each route.** No route is served by two services.
   The owner is listed in the "Svc" column of every section.
2. **REST where shape is stable; SSE where clients want push; WebSocket
   only for true bidirectional.** Most push needs are SSE. Only
   `/ws/orderflow` and `/ws/replay` are WebSocket because they need
   client → server control frames.
3. **All paths are versioned under `/v1/`.** Breaking changes go to
   `/v2/`, never in place. Non-breaking additions (new fields, new
   optional params) stay in `/v1/`.
4. **All timestamps are RFC3339 UTC with millisecond precision.**
   Example: `2026-04-18T14:22:07.812Z`.
5. **All IDs are UUIDv7** (sortable, time-prefixed). Exception:
   external-system IDs (e.g., Alpaca `client_order_id`) are stored
   separately from internal UUIDs.
6. **All monetary values are decimal strings**, never floats. Example:
   `"1234.5600000000"`. The wire format matches the DB `numeric(28,10)`
   representation.
7. **All list endpoints paginate.** Cursor-based (`cursor`, `limit`,
   `has_more`), never offset. Default `limit=50`, max `limit=500`.
8. **Every endpoint returns a `correlation_id`** in the `X-Correlation-Id`
   response header. Clients may send one in; if absent the gateway
   generates one.

---

## 2. Auth contract

### 2.1 Token shape

Access tokens are JWT. Claims:

```json
{
  "sub": "usr_01JEXAMPLEUUIDV7",
  "org": "default",
  "role": "operator",
  "scopes": ["signals:read", "orders:write"],
  "iat": 1744992000,
  "exp": 1744992900,
  "jti": "jti_01JEXAMPLEUUIDV7",
  "iss": "godsview-control-plane",
  "aud": "godsview-api"
}
```

- `role` ∈ `viewer | analyst | operator | admin`.
- `scopes` are additive and enforced at the route level (see RBAC
  column per section).
- Access TTL: 15 min. Refresh TTL: 7 days (sliding).
- Dev: HS256 with shared secret from `.env`. Prod: RS256 with keys
  from AWS Secrets Manager, rotated via JWKS endpoint.

### 2.2 Header

```
Authorization: Bearer <jwt>
```

Webhook endpoints additionally accept a shared-secret HMAC header:

```
X-Signature: sha256=<hex>
X-Timestamp: <unix_ms>
```

The body is HMAC'd with the per-source secret. A ±5-minute clock skew
window is allowed. Replay protection via `webhook_receipts` dedup key
`(source, external_id, sha256(body))`.

### 2.3 RBAC matrix (role × scope)

| Role     | Default scopes                                                                                                         |
|----------|------------------------------------------------------------------------------------------------------------------------|
| viewer   | `signals:read`, `strategies:read`, `backtests:read`, `orderflow:read`, `alerts:read`, `ops:read`                       |
| analyst  | viewer + `strategies:write`, `backtests:write`, `calibration:read`, `screenshots:read`, `memory:read`                  |
| operator | analyst + `orders:write`, `promotion:write`, `alerts:ack`, `killswitch:toggle`, `feature_flags:read`                   |
| admin    | operator + `users:write`, `feature_flags:write`, `system_config:write`, `runbooks:write`, `deployments:write`          |

A route that lists `operator+` means both `operator` and `admin`
satisfy it.

### 2.4 Error envelope

Every non-2xx response uses:

```json
{
  "error": {
    "code": "validation_error",
    "message": "symbol must be a known ticker",
    "correlation_id": "cor_01JEXAMPLEUUIDV7",
    "details": [
      { "path": "body.symbol", "issue": "not_found" }
    ],
    "hint": "See GET /v1/symbols?search=ES to find valid tickers",
    "docs": "https://docs.godsview.internal/errors/validation_error"
  }
}
```

Codes used across the API:

| Code                | HTTP | Meaning                                                              |
|---------------------|------|----------------------------------------------------------------------|
| `validation_error`  | 400  | Payload failed schema validation                                     |
| `unauthenticated`   | 401  | Missing / invalid token                                              |
| `forbidden`         | 403  | Authenticated but role/scope insufficient                            |
| `not_found`         | 404  | Resource does not exist                                              |
| `conflict`          | 409  | State conflict (e.g., duplicate external_id, promotion race)         |
| `precondition`      | 412  | Gate not met (e.g., promote without passing stress test)             |
| `rate_limited`      | 429  | Rate limit hit; `Retry-After` header present                         |
| `dependency_down`   | 502  | Downstream service unreachable                                       |
| `internal_error`    | 500  | Unhandled error; always paired with correlation_id for tracing       |
| `service_unavailable` | 503 | Kill switch engaged or service in maintenance                       |

---

## 3. Route catalog

Legend for every table:

- **Svc** — owning service (short code, see ARCHITECTURE.md §3)
- **RBAC** — minimum role or scope
- **Phase** — first phase that ships the route
- All paths are relative to the public gateway (`/v1/...`); per-service
  internal bases are described in ARCHITECTURE.md §3.2.

---

### 3.1 Auth & identity (control_plane — `cp`)

| Method | Path                        | Purpose                                                   | RBAC        | Phase |
|--------|-----------------------------|-----------------------------------------------------------|-------------|-------|
| POST   | `/v1/auth/login`            | Email + password; returns access + refresh tokens         | public      | 0     |
| POST   | `/v1/auth/refresh`          | Rotate refresh token; returns new access + refresh        | public      | 0     |
| POST   | `/v1/auth/logout`           | Revoke current session                                    | any         | 0     |
| POST   | `/v1/auth/mfa/enroll`       | Begin TOTP enrollment                                     | any         | 1     |
| POST   | `/v1/auth/mfa/verify`       | Confirm TOTP code, activate MFA on user                   | any         | 1     |
| GET    | `/v1/auth/me`               | Current user + role + scopes                              | any         | 0     |
| GET    | `/v1/users`                 | List users                                                | admin       | 1     |
| POST   | `/v1/users`                 | Create user                                               | admin       | 1     |
| GET    | `/v1/users/:id`             | Fetch user                                                | admin       | 1     |
| PATCH  | `/v1/users/:id`             | Update user (role, status)                                | admin       | 1     |
| DELETE | `/v1/users/:id`             | Soft-delete user                                          | admin       | 1     |
| GET    | `/v1/api_keys`              | List API keys for current user                            | any         | 1     |
| POST   | `/v1/api_keys`              | Mint API key (shown once)                                 | operator+   | 1     |
| DELETE | `/v1/api_keys/:id`          | Revoke API key                                            | any (owner) | 1     |

**`POST /v1/auth/login`**

```json
// Request
{ "email": "sakthi@example.com", "password": "<pwd>", "mfa_code": "123456" }

// Response 200
{
  "access_token": "<jwt>",
  "refresh_token": "<jwt>",
  "expires_in": 900,
  "user": { "id": "usr_…", "email": "…", "role": "operator" }
}
```

`mfa_code` is optional on login and required only if MFA is enrolled.

**`GET /v1/auth/me`**

```json
{
  "user": { "id": "…", "email": "…", "role": "operator", "status": "active",
             "created_at": "…", "last_login_at": "…" },
  "scopes": ["signals:read", "orders:write", …],
  "feature_flags": { "replay_v2": true, "execution_enabled": false }
}
```

---

### 3.2 Market universe (control_plane — `cp`)

| Method | Path                                | Purpose                                                | RBAC     | Phase |
|--------|-------------------------------------|--------------------------------------------------------|----------|-------|
| GET    | `/v1/symbols`                       | Search / list tickers (`?search=`, `?asset_class=`)    | viewer+  | 0     |
| GET    | `/v1/symbols/:symbol`               | Symbol metadata + sessions + tick size                 | viewer+  | 0     |
| GET    | `/v1/watchlists`                    | Current user's watchlists                              | viewer+  | 2     |
| POST   | `/v1/watchlists`                    | Create watchlist                                       | analyst+ | 2     |
| PATCH  | `/v1/watchlists/:id`                | Rename / reorder                                       | analyst+ | 2     |
| DELETE | `/v1/watchlists/:id`                | Delete watchlist                                       | analyst+ | 2     |
| POST   | `/v1/watchlists/:id/symbols`        | Add symbol                                             | analyst+ | 2     |
| DELETE | `/v1/watchlists/:id/symbols/:sym`   | Remove symbol                                          | analyst+ | 2     |

**`GET /v1/symbols?search=ES&asset_class=future&limit=20`**

```json
{
  "items": [
    {
      "symbol": "ESM6",
      "asset_class": "future",
      "exchange": "CME",
      "description": "E-mini S&P 500 Jun 2026",
      "tick_size": "0.25",
      "contract_size": "50",
      "currency": "USD",
      "session": { "tz": "America/New_York", "rth": "09:30-16:00" }
    }
  ],
  "cursor": null,
  "has_more": false
}
```

---

### 3.3 Webhook ingestion (ingestion — `ing`)

| Method | Path                                     | Purpose                                     | RBAC            | Phase |
|--------|------------------------------------------|---------------------------------------------|-----------------|-------|
| POST   | `/v1/webhooks/tradingview`               | TradingView alert JSON → `signal_stream`    | HMAC signature  | 2     |
| POST   | `/v1/webhooks/generic`                   | Generic JSON webhook (per-source schema)    | HMAC signature  | 2     |
| POST   | `/v1/webhooks/orderflow`                 | Bookmap / L2 feed packets                   | HMAC signature  | 3     |
| GET    | `/v1/webhooks/receipts`                  | List recent webhook receipts (debugging)    | operator+       | 2     |
| GET    | `/v1/webhooks/receipts/:id`              | Full receipt incl. raw body + dedup key     | operator+       | 2     |

**`POST /v1/webhooks/tradingview`**

Expected body (TradingView alert message template):

```json
{
  "strategy": "liquidity-sweep-reclaim",
  "strategy_version": "v3",
  "symbol": "ESM6",
  "timeframe": "15m",
  "action": "long",
  "price": "5345.25",
  "stop": "5339.00",
  "targets": ["5355.50", "5362.00"],
  "confidence": 0.72,
  "context": {
    "regime": "trending_up",
    "session": "ny_rth",
    "notes": "BOS + reclaim on 15m after liquidity sweep"
  },
  "external_id": "tv_01JEXAMPLE",
  "ts": "2026-04-18T14:22:07.812Z"
}
```

Response:

```json
// 202 Accepted (idempotent: same external_id + body hash returns same receipt)
{
  "receipt_id": "rcp_01J…",
  "signal_id": "sig_01J…",     // null if duplicate
  "dedup": "accepted|duplicate",
  "correlation_id": "cor_01J…"
}
```

Side effects:
1. Row inserted in `webhook_receipts` with dedup key `(tradingview,
   external_id, sha256(body))`.
2. If not a duplicate, a `Signal` is published on bus topic
   `signals.ingested.v1` and inserted into `signals`.

**`POST /v1/webhooks/orderflow`**

Accepts a batched packet of L2 updates (10–100 updates per HTTP call):

```json
{
  "source": "bookmap",
  "symbol": "ESM6",
  "updates": [
    {
      "ts": "2026-04-18T14:22:07.812Z",
      "bid": [["5345.00", "47"], ["5344.75", "122"]],
      "ask": [["5345.25", "33"], ["5345.50", "88"]],
      "last": { "price": "5345.25", "size": "4", "side": "buy" },
      "delta_1s": "142",
      "cvd": "3812"
    }
  ]
}
```

Response: `{ "ingested": 47, "skipped_dup": 0, "correlation_id": "…" }`.

---

### 3.4 Signals (control_plane — `cp`)

| Method | Path                                 | Purpose                                            | RBAC       | Phase |
|--------|--------------------------------------|----------------------------------------------------|------------|-------|
| GET    | `/v1/signals`                        | List signals (`?symbol=&strategy=&from=&to=&status=`) | viewer+ | 2     |
| GET    | `/v1/signals/:id`                    | Full signal incl. decisions + linked orders        | viewer+    | 2     |
| POST   | `/v1/signals/:id/manual_decide`      | Operator override: approve / reject / size-adjust  | operator+  | 5     |
| GET    | `/v1/signals/:id/timeline`           | Full decision + execution timeline                 | viewer+    | 5     |
| GET    | `/v1/signals/stream`                 | **SSE** — new signals + decisions (filtered)       | viewer+    | 2     |

**`GET /v1/signals/stream`**

SSE event types:

```
event: signal.ingested
data: {"id":"sig_…","symbol":"ESM6","strategy":"…","action":"long",…}

event: signal.decided
data: {"signal_id":"sig_…","decision":"approved","size":"2","reasons":[…]}

event: signal.rejected
data: {"signal_id":"sig_…","reason":"exposure_cap","details":{…}}

event: heartbeat
data: {"ts":"…"}
```

Query params: `symbol`, `strategy`, `min_confidence`, `include` (csv
of event types). Clients should include `Last-Event-ID` on reconnect
for ring-buffer replay (64 events, 60 s).

**`POST /v1/signals/:id/manual_decide`**

```json
// Request
{ "decision": "approved", "size_override": "1", "reason": "operator_confidence" }
// Response 200: full updated signal_decisions row + new order if created
```

---

### 3.5 Strategies (control_plane — `cp`)

| Method | Path                                      | Purpose                                            | RBAC       | Phase |
|--------|-------------------------------------------|----------------------------------------------------|------------|-------|
| GET    | `/v1/strategies`                          | List all strategies                                | viewer+    | 4     |
| POST   | `/v1/strategies`                          | Create a strategy (Pine source + metadata)         | analyst+   | 4     |
| GET    | `/v1/strategies/:id`                      | Strategy + current version + trust score           | viewer+    | 4     |
| PATCH  | `/v1/strategies/:id`                      | Rename / update description / tags                 | analyst+   | 4     |
| DELETE | `/v1/strategies/:id`                      | Archive (soft delete)                              | admin      | 4     |
| GET    | `/v1/strategies/:id/versions`             | List all versions                                  | viewer+    | 4     |
| POST   | `/v1/strategies/:id/versions`             | Submit new version (new Pine source)               | analyst+   | 4     |
| GET    | `/v1/strategies/:id/versions/:vid`        | Full version with parsed AST + constraints         | viewer+    | 4     |
| POST   | `/v1/strategies/:id/versions/:vid/parse`  | Re-parse Pine → canonical JSON                     | analyst+   | 4     |
| GET    | `/v1/strategies/:id/trust`                | Time-series of trust score + components            | viewer+    | 8     |
| GET    | `/v1/strategies/:id/promotion`            | Current promotion state + history                  | viewer+    | 8     |
| POST   | `/v1/strategies/:id/promotion/request`    | Request promotion to next stage                    | operator+  | 8     |
| POST   | `/v1/strategies/:id/promotion/approve`    | Approve pending promotion                          | operator+  | 8     |
| POST   | `/v1/strategies/:id/promotion/demote`     | Force demote (with reason)                         | operator+  | 8     |

**`POST /v1/strategies/:id/versions`**

```json
// Request
{
  "source_language": "pinescript",
  "source": "//@version=5\nstrategy('liq-sweep-reclaim', …)\n…",
  "notes": "Reduced SL to 0.8R; added session filter for RTH"
}
// Response 201
{
  "version_id": "sv_01J…",
  "parsed": { /* canonical JSON AST */ },
  "lints": [
    { "level": "warn", "code": "no_cooldown", "message": "…" }
  ]
}
```

**`POST /v1/strategies/:id/promotion/request`**

```json
// Request
{ "target_state": "assisted_live", "evidence": ["br_01J…", "br_01J…"] }
// Response 200
{
  "state": "assisted_live_pending",
  "checks": [
    { "name": "min_50_backtests", "passed": true },
    { "name": "sharpe_gte_1.2",   "passed": true },
    { "name": "mdd_lt_15pct",     "passed": true },
    { "name": "cal_slippage_ok",  "passed": false,
      "reason": "avg_slippage_bps=4.1 exceeds 3.0 bps budget" }
  ],
  "blocked": true
}
```

Checks are deterministic gates (see ARCHITECTURE.md §5); agents can
only *request* promotion, they cannot override a failed check.

---

### 3.6 Backtests (backtest_runner — `bt`)

| Method | Path                               | Purpose                                           | RBAC       | Phase |
|--------|------------------------------------|---------------------------------------------------|------------|-------|
| POST   | `/v1/backtests`                    | Kick a backtest (async job)                       | analyst+   | 6     |
| GET    | `/v1/backtests`                    | List runs (`?strategy_id=&from=&to=&status=`)     | viewer+    | 6     |
| GET    | `/v1/backtests/:id`                | Run detail + metrics + equity curve               | viewer+    | 6     |
| GET    | `/v1/backtests/:id/trades`         | Per-trade breakdown (paginated)                   | viewer+    | 6     |
| GET    | `/v1/backtests/:id/metrics`        | Computed metrics bundle                           | viewer+    | 6     |
| GET    | `/v1/backtests/:id/equity`         | Equity / drawdown time series (csv or json)       | viewer+    | 6     |
| GET    | `/v1/backtests/:id/logs`           | Engine logs (tail 10k lines)                      | viewer+    | 6     |
| POST   | `/v1/backtests/:id/cancel`         | Cancel a running job                              | analyst+   | 6     |
| POST   | `/v1/backtests/stress`             | Kick a stress suite (monte-carlo, slippage sweep) | analyst+   | 6     |
| GET    | `/v1/backtests/stream`             | **SSE** — job lifecycle events                    | viewer+    | 6     |

**`POST /v1/backtests`**

```json
// Request
{
  "strategy_id": "str_01J…",
  "strategy_version_id": "sv_01J…",
  "symbols": ["ESM6", "NQM6"],
  "from": "2024-01-01T00:00:00Z",
  "to": "2026-03-31T23:59:59Z",
  "timeframe": "15m",
  "capital": "100000",
  "slippage_model": "calibrated_v3",
  "commission_model": "per_contract_2.50",
  "fill_model": "l2_replay",
  "seed": 42
}
// Response 202
{
  "backtest_id": "bt_01J…",
  "status": "queued",
  "estimated_duration_seconds": 180,
  "correlation_id": "cor_…"
}
```

**`GET /v1/backtests/:id/metrics`**

```json
{
  "backtest_id": "bt_01J…",
  "metrics": {
    "n_trades": 184,
    "win_rate": 0.58,
    "profit_factor": 1.83,
    "expectancy_r": 0.42,
    "sharpe": 1.37,
    "sortino": 1.91,
    "max_drawdown_pct": 0.081,
    "cagr": 0.196,
    "avg_mae_r": -0.62,
    "avg_mfe_r": 1.14,
    "avg_hold_min": 47.2,
    "slippage_bps_p50": 1.8,
    "slippage_bps_p95": 4.7,
    "commission_total": "920.00"
  },
  "exit_attribution": {
    "target_1": 84, "target_2": 23, "stop": 58, "time_exit": 19
  }
}
```

---

### 3.7 Orders & fills (execution — `ex`)

| Method | Path                           | Purpose                                              | RBAC        | Phase |
|--------|--------------------------------|------------------------------------------------------|-------------|-------|
| GET    | `/v1/orders`                   | List orders (`?status=&symbol=&from=&to=`)           | viewer+     | 7     |
| GET    | `/v1/orders/:id`               | Order + fills                                        | viewer+     | 7     |
| POST   | `/v1/orders`                   | Create order (manual, bracketed)                     | operator+   | 7     |
| POST   | `/v1/orders/:id/cancel`        | Cancel order                                         | operator+   | 7     |
| POST   | `/v1/orders/:id/modify`        | Modify SL/TP                                         | operator+   | 7     |
| GET    | `/v1/positions`                | Open positions                                       | viewer+     | 7     |
| GET    | `/v1/positions/:symbol`        | Position detail                                      | viewer+     | 7     |
| POST   | `/v1/positions/:symbol/flatten`| Market-close all contracts for symbol                | operator+   | 7     |
| GET    | `/v1/fills`                    | List fills                                           | viewer+     | 7     |
| GET    | `/v1/fills/:id`                | Fill detail                                          | viewer+     | 7     |
| GET    | `/v1/risk/exposure`            | Current exposure: notional, delta, concentration     | viewer+     | 7     |
| GET    | `/v1/risk/budgets`             | Daily loss cap, position count, exposure limits      | viewer+     | 7     |
| POST   | `/v1/risk/budgets`             | Update risk budgets                                  | admin       | 7     |
| POST   | `/v1/risk/killswitch`          | Engage kill switch (halts all execution)             | operator+   | 7     |
| DELETE | `/v1/risk/killswitch`          | Release kill switch (requires confirmation)         | operator+   | 7     |
| GET    | `/v1/orders/stream`            | **SSE** — order + fill updates                       | viewer+     | 7     |

**`POST /v1/orders`**

```json
// Request
{
  "symbol": "ESM6",
  "side": "buy",
  "qty": "2",
  "type": "limit",
  "price": "5345.00",
  "tif": "day",
  "bracket": {
    "stop_loss":   { "type": "stop", "price": "5339.00" },
    "take_profit": { "type": "limit", "price": "5355.50" }
  },
  "signal_id": "sig_01J…",     // optional: links order to signal
  "idempotency_key": "op_01J…"
}
// Response 201
{
  "order_id": "ord_01J…",
  "status": "pending_submit",
  "child_orders": { "stop": "ord_…", "target": "ord_…" },
  "correlation_id": "cor_…"
}
```

**`POST /v1/risk/killswitch`**

```json
// Request
{ "reason": "data_feed_degraded", "ttl_seconds": 900 }
// Response 200
{ "engaged": true, "engaged_at": "…", "engaged_by": "usr_…", "releases_at": "…" }
```

Side effects: publishes `system.killswitch.engaged.v1`, causing
execution to refuse all new orders; open orders stay; existing
positions are not auto-flattened (operator decides).

---

### 3.8 Order flow (orderflow — `of`)

| Method | Path                                 | Purpose                                              | RBAC     | Phase |
|--------|--------------------------------------|------------------------------------------------------|----------|-------|
| GET    | `/v1/orderflow/:symbol/snapshot`     | Latest L2 snapshot                                   | viewer+  | 3     |
| GET    | `/v1/orderflow/:symbol/delta`        | Delta time-series (`?from=&to=&bucket=1s`)           | viewer+  | 3     |
| GET    | `/v1/orderflow/:symbol/imbalance`    | Imbalance over window                                | viewer+  | 3     |
| GET    | `/v1/orderflow/:symbol/absorption`   | Detected absorption events                           | viewer+  | 3     |
| GET    | `/v1/orderflow/:symbol/fvgs`         | Fair-value gaps (open + filled)                      | viewer+  | 3     |
| GET    | `/v1/orderflow/:symbol/obs`          | Order-block candidates (active + invalidated)        | viewer+  | 3     |
| GET    | `/v1/orderflow/:symbol/liquidity`    | Liquidity pools + sweep events                       | viewer+  | 3     |
| WS     | `/v1/ws/orderflow/:symbol`           | Live L2 + features (bidir: client filters)           | viewer+  | 3     |

**WebSocket `/v1/ws/orderflow/:symbol`**

Client → server frames (JSON, one per line):

```json
{ "op": "subscribe", "features": ["delta", "imbalance", "fvg"] }
{ "op": "set_aggregation", "bucket_ms": 500 }
{ "op": "unsubscribe" }
```

Server → client:

```json
{ "ts":"…","type":"l2","bids":[…],"asks":[…] }
{ "ts":"…","type":"delta","value":"142","cvd":"3812" }
{ "ts":"…","type":"fvg","side":"bull","from":"5344.00","to":"5344.75","created_at":"…" }
{ "ts":"…","type":"ob_candidate","side":"demand","range":["5340.50","5341.25"] }
```

Back-pressure: server drops `l2` frames first if client lag >500 ms,
never drops `delta`, `imbalance`, `fvg`, `ob` events.

---

### 3.9 Screenshots (screenshot_renderer — `sr`)

| Method | Path                             | Purpose                                                  | RBAC     | Phase |
|--------|----------------------------------|----------------------------------------------------------|----------|-------|
| POST   | `/v1/screenshots/render`         | Render a chart at `(symbol, ts, timeframe)`              | analyst+ | 3     |
| GET    | `/v1/screenshots`                | List recent renders (`?symbol=&signal_id=`)              | viewer+  | 3     |
| GET    | `/v1/screenshots/:id`            | Metadata                                                 | viewer+  | 3     |
| GET    | `/v1/screenshots/:id/image`      | PNG stream                                               | viewer+  | 3     |
| GET    | `/v1/screenshots/:id/annotations`| Overlay structures (OBs, FVGs, liquidity)                | viewer+  | 3     |
| POST   | `/v1/screenshots/:id/pin`        | Pin to a signal / decision / incident                    | analyst+ | 3     |

**`POST /v1/screenshots/render`**

```json
// Request
{
  "symbol": "ESM6",
  "timeframe": "15m",
  "ts": "2026-04-18T14:22:07.812Z",
  "window_bars": 200,
  "overlays": ["structure", "orderflow"],
  "pin_to": { "kind": "signal", "id": "sig_01J…" }
}
// Response 201
{
  "screenshot_id": "ss_01J…",
  "s3_key": "screenshots/2026/04/18/ss_01J…",
  "cdn_url": "https://cdn.godsview…/ss_01J…",
  "sha256": "a1b2…",
  "annotations_key": "…/ss_01J…/annotations.json"
}
```

Renders are deterministic: same inputs + same strategy version ⇒
same image SHA256 (guards against evidence tampering).

---

### 3.10 Calibration (calibration — `cal`)

| Method | Path                                  | Purpose                                                    | RBAC        | Phase |
|--------|---------------------------------------|------------------------------------------------------------|-------------|-------|
| GET    | `/v1/calibration/snapshots`           | List calibration snapshots                                 | analyst+    | 8     |
| GET    | `/v1/calibration/snapshots/:id`       | Full snapshot (slippage dist, fill prob curves, etc.)      | analyst+    | 8     |
| POST   | `/v1/calibration/rebuild`             | Rebuild calibration from `fill_divergence` window          | operator+   | 8     |
| GET    | `/v1/calibration/drift`               | Current drift: PSI + KS per feature                        | analyst+    | 8     |
| GET    | `/v1/calibration/drift/events`        | History of drift-triggered events                          | analyst+    | 8     |
| GET    | `/v1/calibration/slippage/:symbol`    | Empirical slippage curve                                   | analyst+    | 8     |
| GET    | `/v1/calibration/fill_divergence`     | Recent divergence between predicted vs actual fills        | analyst+    | 8     |

**`POST /v1/calibration/rebuild`**

```json
// Request
{ "window_days": 30, "strategy_ids": null /* null = all */ }
// Response 202
{ "job_id": "cal_01J…", "queued_at": "…" }
```

Side effect: on completion publishes `calibration.rebuilt.v1` with
the new snapshot id and PSI deltas per strategy. The promotion
service subscribes and may auto-demote strategies whose trust score
drops below threshold.

---

### 3.11 Promotion (promotion — `pr`)

Most promotion verbs live under `/v1/strategies/:id/promotion/*`
(§3.5). Additional routes owned by the promotion service:

| Method | Path                              | Purpose                                                | RBAC     | Phase |
|--------|-----------------------------------|--------------------------------------------------------|----------|-------|
| GET    | `/v1/promotion/queue`             | Pending + approved promotions                          | operator+| 8     |
| GET    | `/v1/promotion/history`           | Full promotion event log                               | viewer+  | 8     |
| GET    | `/v1/promotion/checks/:strategy_id`| Run the check suite without committing                 | operator+| 8     |
| GET    | `/v1/promotion/stream`            | **SSE** — promotion state changes                      | viewer+  | 8     |
| GET    | `/v1/promotion/config`            | Current thresholds (per stage transition)              | operator+| 8     |
| PATCH  | `/v1/promotion/config`            | Update thresholds (goes through approval workflow)     | admin    | 8     |

---

### 3.12 Alerts & incidents (control_plane — `cp`)

| Method | Path                                | Purpose                                               | RBAC        | Phase |
|--------|-------------------------------------|-------------------------------------------------------|-------------|-------|
| GET    | `/v1/alerts`                        | List alerts (`?status=&severity=&from=`)              | viewer+     | 9     |
| GET    | `/v1/alerts/:id`                    | Alert detail + linked evidence                        | viewer+     | 9     |
| POST   | `/v1/alerts/:id/ack`                | Acknowledge alert                                     | operator+   | 9     |
| POST   | `/v1/alerts/:id/resolve`            | Resolve alert                                         | operator+   | 9     |
| POST   | `/v1/alerts/:id/snooze`             | Snooze until `?until=`                                | operator+   | 9     |
| GET    | `/v1/alerts/stream`                 | **SSE** — new / state-changed alerts                  | viewer+     | 9     |
| GET    | `/v1/incidents`                     | List incidents                                        | viewer+     | 9     |
| POST   | `/v1/incidents`                     | Declare incident                                      | operator+   | 9     |
| GET    | `/v1/incidents/:id`                 | Incident detail                                       | viewer+     | 9     |
| PATCH  | `/v1/incidents/:id`                 | Update severity / status                              | operator+   | 9     |
| POST   | `/v1/incidents/:id/timeline`        | Append event to incident timeline                     | operator+   | 9     |
| GET    | `/v1/incidents/:id/postmortem`      | Render postmortem (markdown + json)                   | viewer+     | 9     |
| GET    | `/v1/runbooks`                      | List runbooks                                         | viewer+     | 9     |
| GET    | `/v1/runbooks/:id`                  | Runbook markdown                                      | viewer+     | 9     |
| POST   | `/v1/runbooks`                      | Create / edit runbook                                 | admin       | 9     |

---

### 3.13 SLOs & ops (control_plane — `cp`)

| Method | Path                                      | Purpose                                                | RBAC       | Phase |
|--------|-------------------------------------------|--------------------------------------------------------|------------|-------|
| GET    | `/v1/ops/health`                          | Aggregate health (all services + queues + db)          | public     | 0     |
| GET    | `/v1/ops/health/:service`                 | Per-service health                                     | public     | 0     |
| GET    | `/v1/ops/metrics`                         | Prometheus metrics proxy                               | operator+  | 0     |
| GET    | `/v1/ops/slo`                             | All SLOs + burn rates                                  | viewer+    | 6     |
| GET    | `/v1/ops/slo/:id`                         | SLO detail                                             | viewer+    | 6     |
| GET    | `/v1/ops/slo/:id/burn`                    | Burn-rate time series                                  | viewer+    | 6     |
| GET    | `/v1/ops/latency/:service`                | p50/p95/p99 latency over window                        | viewer+    | 6     |
| GET    | `/v1/ops/queue/:topic`                    | Queue depth + lag                                      | operator+  | 2     |
| GET    | `/v1/ops/events/stream`                   | **SSE** — system ops events (deploys, SLO breaches)    | operator+  | 6     |
| GET    | `/v1/deployments`                         | Deploy history                                         | viewer+    | 12    |
| GET    | `/v1/deployments/:id`                     | Deploy detail                                          | viewer+    | 12    |
| POST   | `/v1/deployments/rollback/:id`            | Trigger rollback                                       | admin      | 12    |
| GET    | `/v1/feature_flags`                       | Current flags                                          | operator+  | 0     |
| PATCH  | `/v1/feature_flags/:key`                  | Toggle flag                                            | admin      | 0     |
| GET    | `/v1/system_config`                       | Current config KVs                                     | operator+  | 0     |
| PATCH  | `/v1/system_config/:key`                  | Update config (audit-logged)                           | admin      | 0     |
| GET    | `/v1/audit`                               | Audit log (`?actor=&from=&kind=`)                      | admin      | 1     |

**`GET /v1/ops/health`**

```json
{
  "status": "ok",           // ok | degraded | down
  "services": {
    "control_plane":    { "status": "ok", "latency_ms_p95": 48, "version": "v2.3.0" },
    "ingestion":        { "status": "ok", "latency_ms_p95": 12, "version": "v2.3.0" },
    "orderflow":        { "status": "degraded", "reason": "ws_lag>500ms", "version": "v2.3.0" },
    "backtest_runner":  { "status": "ok", "queue_depth": 3 },
    "calibration":      { "status": "ok" },
    "promotion":        { "status": "ok" },
    "intelligence":     { "status": "ok" },
    "execution":        { "status": "ok", "broker": "alpaca", "killswitch": false },
    "screenshot_renderer": { "status": "ok" },
    "replay":           { "status": "ok" }
  },
  "dependencies": {
    "postgres":    { "status": "ok", "p95_ms": 3 },
    "redis":       { "status": "ok", "memory_mb": 412 },
    "s3":          { "status": "ok" },
    "event_bus":   { "status": "ok", "topic_count": 17, "max_lag_s": 1 }
  }
}
```

---

### 3.14 Intelligence — agents, memory, recall (intelligence — `int`)

| Method | Path                                | Purpose                                                   | RBAC       | Phase |
|--------|-------------------------------------|-----------------------------------------------------------|------------|-------|
| GET    | `/v1/agents/runs`                   | Recent agent runs                                         | analyst+   | 10    |
| GET    | `/v1/agents/runs/:id`               | Full run: inputs, steps, outputs, tool calls              | analyst+   | 10    |
| POST   | `/v1/agents/runs`                   | Kick a bespoke agent run (research query)                 | analyst+   | 10    |
| GET    | `/v1/agents/runs/stream`            | **SSE** — live agent progress                             | analyst+   | 10    |
| POST   | `/v1/agents/:agent_name/invoke`     | Invoke named agent directly                               | operator+  | 10    |
| GET    | `/v1/memory/entries`                | Browse memory (`?kind=&symbol=&from=`)                    | analyst+   | 11    |
| POST   | `/v1/memory/entries`                | Add memory entry                                          | analyst+   | 11    |
| POST   | `/v1/memory/search`                 | Semantic + filter search                                  | analyst+   | 11    |
| DELETE | `/v1/memory/entries/:id`            | Remove memory entry                                       | analyst+   | 11    |
| POST   | `/v1/recall/similar`                | Given a signal/context, return similar past situations    | viewer+    | 11    |
| GET    | `/v1/recall/missed`                 | Opportunities model flagged but system didn't trade       | viewer+    | 11    |

**`POST /v1/memory/search`**

```json
// Request
{
  "query": "liquidity sweep below overnight low followed by reclaim on ES RTH",
  "filters": { "symbols": ["ES","MES"], "kind": ["trade","setup"], "from": "2024-01-01" },
  "top_k": 20
}
// Response 200
{
  "hits": [
    {
      "id": "mem_01J…",
      "score": 0.87,
      "kind": "trade",
      "symbol": "ESH5",
      "summary": "Liquidity sweep at 5123.25, reclaim on 15m, +1.8R target",
      "screenshot_id": "ss_01J…",
      "outcome": "win",
      "outcome_r": "1.82"
    }
  ]
}
```

**`POST /v1/recall/similar`**

```json
// Request
{ "signal_id": "sig_01J…", "top_k": 10 }
// Response 200
{
  "query_signal": "sig_01J…",
  "cohort_size": 10,
  "cohort_stats": { "win_rate": 0.62, "avg_r": 0.71, "mdd_r": -1.1 },
  "matches": [ /* same shape as /v1/memory/search hits */ ]
}
```

---

### 3.15 Replay (replay — `rp`)

| Method | Path                                | Purpose                                                  | RBAC       | Phase |
|--------|-------------------------------------|----------------------------------------------------------|------------|-------|
| POST   | `/v1/replay/sessions`               | Create replay session bound to a time range + symbols    | analyst+   | 14    |
| GET    | `/v1/replay/sessions`               | List own sessions                                        | analyst+   | 14    |
| GET    | `/v1/replay/sessions/:id`           | Session state                                            | analyst+   | 14    |
| DELETE | `/v1/replay/sessions/:id`           | Delete session                                           | analyst+   | 14    |
| POST   | `/v1/replay/sessions/:id/seek`      | Seek to timestamp                                        | analyst+   | 14    |
| POST   | `/v1/replay/sessions/:id/play`      | Start playback (speed 1x…1000x)                          | analyst+   | 14    |
| POST   | `/v1/replay/sessions/:id/pause`     | Pause playback                                           | analyst+   | 14    |
| WS     | `/v1/ws/replay/:session_id`         | Live replay frames                                       | analyst+   | 14    |

**WebSocket `/v1/ws/replay/:session_id`**

Client → server:

```json
{ "op": "play", "speed": 10 }
{ "op": "pause" }
{ "op": "seek", "ts": "2026-04-18T14:22:07.812Z" }
{ "op": "subscribe", "channels": ["bars","l2","signals","decisions","orders"] }
```

Server → client: heterogeneous frames matching §3.8 schemas, all
tagged with `replay_ts` so the client can correlate.

---

## 4. Event bus topics (canonical catalog)

Every topic is JSON-serialized with the standard envelope:

```json
{
  "id":           "evt_01J…",                // uuidv7
  "topic":        "signals.ingested.v1",
  "ts":           "2026-04-18T14:22:07.812Z",
  "producer":     "ingestion",
  "correlation_id":"cor_01J…",
  "causation_id": "evt_01J…",                // optional
  "schema_version":1,
  "payload":      { /* per-topic */ }
}
```

Topics are grouped by domain. FIFO means strict per-key ordering is
required (SQS FIFO in prod). Retention is the S3 archive retention;
in-flight retention in SQS is 14 days by default.

| Topic                              | FIFO | Partition key     | Producers                   | Consumers                             | Retention | Phase |
|------------------------------------|------|-------------------|------------------------------|----------------------------------------|-----------|-------|
| `signals.ingested.v1`              | yes  | symbol            | ingestion                    | intelligence, execution, cp            | 90d       | 2     |
| `signals.decided.v1`               | yes  | signal_id         | intelligence, cp             | execution, cp (UI)                     | 90d       | 5     |
| `signals.rejected.v1`              | no   | signal_id         | intelligence, cp             | cp (UI), analytics                     | 90d       | 5     |
| `orderflow.snapshot.v1`            | yes  | symbol            | orderflow                    | intelligence, screenshot_renderer      | 7d        | 3     |
| `orderflow.feature.v1`             | yes  | symbol            | orderflow                    | intelligence, cp                       | 30d       | 3     |
| `orders.created.v1`                | yes  | order_id          | execution                    | cp (UI), analytics                     | 365d      | 7     |
| `orders.filled.v1`                 | yes  | order_id          | execution                    | cp, calibration, analytics             | 365d      | 7     |
| `orders.canceled.v1`               | yes  | order_id          | execution                    | cp, analytics                          | 365d      | 7     |
| `orders.modified.v1`               | yes  | order_id          | execution                    | cp                                     | 365d      | 7     |
| `positions.updated.v1`             | yes  | symbol            | execution                    | cp, intelligence                       | 365d      | 7     |
| `backtests.completed.v1`           | no   | backtest_id       | backtest_runner              | cp, promotion                          | 365d      | 6     |
| `calibration.rebuilt.v1`           | no   | none              | calibration                  | promotion, intelligence                | 365d      | 8     |
| `calibration.drift_detected.v1`    | no   | strategy_id       | calibration                  | promotion, alerts                      | 365d      | 8     |
| `promotion.state_changed.v1`       | yes  | strategy_id       | promotion                    | cp, intelligence, alerts               | 365d      | 8     |
| `alerts.raised.v1`                 | no   | alert_id          | any service                  | cp, notifier                           | 365d      | 9     |
| `alerts.ack.v1`                    | no   | alert_id          | cp                           | notifier                               | 365d      | 9     |
| `system.killswitch.engaged.v1`     | no   | none              | cp                           | execution, ingestion                   | 365d      | 7     |
| `system.killswitch.released.v1`    | no   | none              | cp                           | execution, ingestion                   | 365d      | 7     |
| `screenshots.rendered.v1`          | no   | signal_id         | screenshot_renderer          | cp, intelligence                       | 90d       | 3     |

**Schema evolution:** fields may be added to `payload` in place;
removals or type changes bump `schema_version` AND the topic suffix
(`.v1` → `.v2`). Consumers must accept unknown fields.

---

## 5. Rate limits

Default per-token quotas (enforced at the gateway):

| Bucket                      | Limit                                    | Window |
|-----------------------------|------------------------------------------|--------|
| read (GET)                  | 600 req                                  | 60 s   |
| write (POST/PATCH/DELETE)   | 120 req                                  | 60 s   |
| backtest kick (`POST /v1/backtests`) | 30 req per user                  | 60 s   |
| order creation              | 60 req per user                          | 60 s   |
| webhook ingestion (per source HMAC) | 1200 req                         | 60 s   |
| SSE streams                 | 10 concurrent per user                   | —      |
| WS connections              | 5 concurrent per user                    | —      |

Burst: 2× for 5 s via token-bucket. Exceeded buckets return 429 with
`Retry-After` in seconds.

---

## 6. Versioning & deprecation

1. Additive changes (new optional fields, new list items, new
   response keys) are **non-breaking** and ship in the same version.
2. Breaking changes require a new major version (`/v2/`). Old version
   stays live for at least one release cycle (30 days) plus one
   additional cycle after deprecation announcement.
3. Deprecated routes emit `Deprecation: true` and `Sunset: <RFC3339>`
   headers.
4. No route returning live trading state (orders, positions,
   killswitch) may be sunset without an explicit migration path and
   operator sign-off.

---

## 7. What's not in v1 (and why)

- **GraphQL.** Deliberate no. The UI's access patterns are stable,
  and SSE + cursor-paginated REST is simpler to secure, audit, and
  rate-limit. Revisit if ad-hoc drill-down load becomes a problem.
- **gRPC service mesh.** Internal service-to-service calls are
  JSON-over-HTTPS with mTLS in prod. The throughput ceiling is not
  close to being a bottleneck; complexity cost > benefit today.
- **Public API key tier.** v1 tokens are only for our UI and our ops.
  External integrations (if any) route through webhooks.

---

## 8. CI contract snapshot

Phase 0 lands a `tests/contract/api_surface.spec.ts` that:

1. Parses this document's route tables into a canonical JSON shape.
2. Fetches each service's `/openapi.json` (FastAPI) and merges.
3. Asserts every documented route exists in OpenAPI with matching
   method, path, and auth requirement.
4. Asserts every OpenAPI route is documented here.
5. Fails CI on drift in either direction.

This is what makes this file load-bearing, not aspirational.

---

**End of API_SURFACE.md**
