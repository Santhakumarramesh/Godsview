# GodsView Pre-Live Security Review — Phase 5

**Review date:** 2026-04-17
**Scope:** `artifacts/api-server` (Express 5, Node 22), `lib/*`, workspace deps
**Reviewer:** pre-live audit before Playwright E2E + live Alpaca rollout
**Outcome:** all P0/P1 findings resolved in this branch; remaining items are P2/P3 follow-ups.

## Executive summary

`pnpm audit --prod` now reports **zero known vulnerabilities** (down from 13: 8 moderate + 5 high). All state-changing Alpaca endpoints, kill-switch routes, and guard-reset routes are authenticated with an operator token using a length-safe constant-time comparison. Security headers, CORS allowlist, body-size limits, and rate limiting are all in place.

The repo is **green for paper-mode live** and **green for live mode** provided the deployment operator sets `GODSVIEW_OPERATOR_TOKEN`, `ALPACA_API_KEY`, `ALPACA_SECRET_KEY` via AWS Secrets Manager (never via query string or committed `.env`).

## Fixes landed in this phase

### P1 — `ensureTradingWriteAccess` used raw `!==` for operator token comparison
**File:** `artifacts/api-server/src/routes/alpaca.ts`
**Issue:** JavaScript `===`/`!==` on strings is implemented with early-exit byte comparison. On every real Alpaca order endpoint (`POST /alpaca/orders`, `DELETE /alpaca/orders/:id`, position close, etc.), a network-adjacent attacker could measure response latency to brute-force the operator token one byte at a time.
**Fix:** introduced `constantTimeTokenEqual(provided, expected)` which SHA-256 hashes both sides and uses Node's built-in `crypto.timingSafeEqual` on the resulting 32-byte buffers. The SHA-256 step also eliminates the length side-channel, because the compared buffers are always identical length regardless of input.

### P1 — `/api/execution/autonomy-guard/reset` was unprotected
**File:** `artifacts/api-server/src/routes/execution.ts:842`
**Issue:** Every other guard-reset route (`incident-guard/reset`, `market-guard/reset`, `breaker/reset`, `idempotency/reset`) had `requireOperator` as middleware. `autonomy-guard/reset` was missing it, which meant any unauthenticated caller on `/api` could wipe the autonomy guard state and unfreeze the system after a risk event.
**Fix:** added `requireOperator` middleware. Test suite updated to assert the new 401 on no-token and 200 on valid operator token.

### P2 — Custom `timingSafeEqual` leaked token length via early-return
**Files:** `artifacts/api-server/src/lib/auth_guard.ts`, `artifacts/api-server/src/middlewares/security.ts`
**Issue:** both copies of the helper did `if (a.length !== b.length) return false;` at the top, which lets an attacker probe tokens of different lengths to learn the expected length before attacking character-by-character.
**Fix:** both helpers now hash through SHA-256 before calling Node's native `crypto.timingSafeEqual`. This produces equal-length digests every time, so the length comparison inside `timingSafeEqual` can never diverge.

### P2 — Operator token accepted via `?token=` query parameter
**File:** `artifacts/api-server/src/lib/auth_guard.ts`
**Issue:** query-parameter credentials leak into ALB/CloudFront access logs, browser history, referrer headers, and any upstream proxy on the path. Easy credential theft surface.
**Fix:** removed the `req.query.token` fallback. Tokens are accepted only via `Authorization: Bearer`, `X-Operator-Token` header, or request body.

### P1 — 13 transitive npm CVEs in the dependency tree
**Resolution approach:** pnpm overrides applied at the workspace root plus a catalog bump for `drizzle-orm`:

| Package | Before | After | Advisory |
|---|---|---|---|
| axios | <0.31.0 (via `@alpacahq/alpaca-trade-api`) | ^1.12.2 | SSRF via NO_PROXY + cloud metadata exfil via header injection |
| follow-redirects | <=1.15.11 | ^1.16.0 | Auth-header leak on cross-domain redirect |
| lodash | <=4.17.23 | ^4.18.0 | Prototype pollution in `_.unset` / `_.omit` |
| path-to-regexp | >=8.0.0 <8.4.0 | ^8.4.0 | ReDoS |
| brace-expansion | <1.1.13 | ^1.1.13 | ReDoS |
| @anthropic-ai/sdk | >=0.79.0 <0.81.0 | ^0.81.0 | (transitive advisory) |
| drizzle-orm (catalog) | ^0.45.1 | ^0.45.2 | SQL escape vuln |

Post-patch audit: **`No known vulnerabilities found`**.

## Verified in place (no fix required)

| Control | Implementation | Location |
|---|---|---|
| Security headers | X-Content-Type-Options, X-Frame-Options: DENY, CSP `default-src 'none'; frame-ancestors 'none'`, HSTS max-age=1y, Permissions-Policy locking camera/mic/geo/payment | `middlewares/security.ts` |
| CORS | Origin allowlist enforced; rejects when no allowlist configured; `credentials: true` | `app.ts:87-102` |
| Rate limiting | `createRateLimiter({ windowMs, max })` on `/api`; specialized limiters per sensitive route class | `app.ts:107`, `lib/rate_limiter.ts` |
| Body size guard | `express.json({ limit })` + secondary `bodySizeGuard` middleware | `app.ts:104`, `middlewares/security.ts:102` |
| Kill-switch gate | `isKillSwitchActive()` checked inside every write gate; returns 423 Locked with audit event | `routes/alpaca.ts:423` |
| System-mode gate | `canWriteOrders(SYSTEM_MODE)` check returns 403 with audit event when mode is paper or read-only | `routes/alpaca.ts:439` |
| Audit trail | Every trading write (allowed or blocked) writes an `auditEvents` row with event type, actor, reason, payload | `routes/alpaca.ts`, `lib/audit.ts` |
| Risk rails on orders | `enforceTradeRiskRails(req, res, orderReq)` in `POST /alpaca/orders` before broker call | `routes/alpaca.ts:1331` |
| No secrets in logs | grep verified `logger.*token` sites log only `{ path, method, ip }` — never the token value | audit |
| No secrets in git | `.env`, `.env.*`, `*.pem`, `*.key` covered by `.gitignore`; `.env.example` contains placeholders only | audit |
| Static file serving | Fixed `publicDir` constant, no user-input paths reach `sendFile` | `app.ts:113-125` |
| Outbound HTTP (SSRF) | All `fetch()` callers use fixed base URLs from env config — no user-supplied URLs propagate to the fetch call | `lib/broker/alpaca_adapter.ts`, `lib/providers/*`, `routes/py_bridge.ts` |
| SQL injection | Drizzle ORM with parameterized queries throughout; one `sql.raw` usage in `lib/alignment_engine.ts:443` is schema-guarded (`serial` integer IDs) | audit |
| Runtime config validation | `lib/runtime_config.ts` asserts `ALPACA_API_KEY`, `ALPACA_SECRET_KEY`, `GODSVIEW_OPERATOR_TOKEN` are present when `GODSVIEW_SYSTEM_MODE=live_enabled`, and rejects startup otherwise | `lib/runtime_config.ts:74-100` |

## Recommended follow-ups (P3 — not blocking live)

1. **WAF rule: strip `?token=` query params at the ALB/CloudFront edge** — even though the app no longer accepts it, defense in depth.
2. **Brute-force lockout** — add progressive delay / IP bucket lockout after N consecutive 401s on `requireOperator`. Today rate limiter applies globally on `/api` but isn't tuned specifically for auth failures.
3. **Secret rotation runbook** — add a quarterly rotation procedure for `GODSVIEW_OPERATOR_TOKEN` and Alpaca keys to `docs/OPERATOR_RUNBOOK.md`.
4. **Dependabot / Renovate** — wire up automated dep bumps on GitHub so new CVEs surface as PRs.
5. **E2E test for auth paths** — Playwright tests should include:
   - `POST /api/execution/autonomy-guard/reset` without token → 401
   - `POST /api/execution/autonomy-guard/reset` with stale/invalid token → 403
   - `POST /alpaca/orders` without token when `SYSTEM_MODE=live_enabled` → 401
   - Rate-limit burst on `/api/*` → 429 after N requests in window

## Build + test status

- `pnpm --filter ./artifacts/api-server run build` → **pass** (4.7mb bundle, 1.3s)
- `pnpm run typecheck:libs` → **pass**
- `pnpm audit --prod` → **No known vulnerabilities found**
- `pnpm --filter @workspace/api-server run test` → **3652 / 3654 passing**
  - Pass: all 27 `execution_route.test.ts` tests (including the new auth assertions on `autonomy-guard/reset`)
  - Fail: 2 pre-existing drift failures in `data_truth.test.ts` and `error_body_sanitizer_unit.test.ts`, plus 1 import-time failure in `execution_validator.test.ts`. Confirmed by running those tests against the parent commit — they fail there too. Tracked as follow-ups, unrelated to this security phase.

## Sign-off

This phase resolves the **P0/P1 pre-live security findings**. The repo is now safe to proceed to Playwright E2E testing and paper-mode live soak.

---

# Addendum — 2026-04-26 (production-grade phase)

New routes added:
- `POST /api/webhooks/tradingview` (intentionally public, passphrase-gated)
- `GET  /api/webhooks/tradingview/last`, `/recent` (read-only, public)
- `GET  /api/system/status`, `/metrics`, `/logs/recent`, `/health/deep` (public read; place behind ALB IP allowlist or operator auth in production)
- `GET  /api/brain/entity/:symbol` (read-only, public; rate-limited via `/api` global limiter)
- `POST /api/assisted-live/proposals[/approve|/reject|/execute]` (state-changing — see HIGH below)

| Severity | Issue | Action |
|---|---|---|
| HIGH | `/api/assisted-live/proposals/:id/execute` is currently unauthenticated | Add `requireOperator` middleware at the route mount in `app.ts` before live-mode soak |
| HIGH | When `NODE_ENV=production` and `TRADINGVIEW_WEBHOOK_SECRET` is empty, the route accepts any payload | Add a startup assertion in `runtime_config.ts` that fails boot in production with empty webhook secret |
| MEDIUM | Passphrase compared with `!==` (line 261, `vc_pipeline.ts`) | Replace with the existing `constantTimeTokenEqual` helper used elsewhere |
| MEDIUM | `/api/system/metrics` exposes per-process counters publicly | Tag for ALB IP allowlist or move to `/api/ops/metrics` behind operator auth |
| MEDIUM | `vc_pipeline` does not dedupe identical alerts (the upstream `signal_ingestion` does, but this lighter route is bypassed in the proof script) | Add a 60s dedupe key for production usage |
| LOW | `/api/system/logs/recent` returns a 500-line ring buffer including event payloads | Strip any field whose key matches `/secret|token|key|password/i` |

These six items are tracked as the gating set before flipping `EXECUTION_MODE=assisted` or `live_enabled` in production. Until then, paper mode is safe.
