# 07 · Security

## Auth

- Passwords: Argon2id, memory ≥ 64 MiB, time ≥ 3, parallelism 1. Stored
  as encoded hashes (`argon2$v=19$m=65536$t=3$p=1$…`).
- Access tokens: JWT, 15-minute TTL. HS256 in dev (shared secret),
  RS256 in staging+ (KMS-backed private key, public JWKS endpoint).
- Refresh tokens: opaque random 256-bit tokens, SHA-256 stored,
  7-day TTL, rotated on every refresh with the predecessor recorded in
  `replaced_by` and `revoked_at` set.
- Logout revokes every refresh token for the user.

## Rate limits

Two-layer design: Redis handles the short-window hot path, Postgres
handles long-window accounting so bans survive redis flushes.

| Window   | Subject  | Default  | Override knob                |
|----------|----------|----------|------------------------------|
| 1s burst | ip       | 20       | `rate_limit.ip.burst`        |
| 1m       | user     | 600      | `rate_limit.user.per_minute` |
| 1h       | api_key  | 10 000   | `rate_limit.api_key.per_hour`|
| 24h      | ip       | 50 000   | `rate_limit.ip.per_day`      |

Exceeding a window returns `rate_limit.exceeded` (429) with a
`Retry-After` header.

## Headers

The control plane sets these on every response:

- `strict-transport-security: max-age=63072000; includeSubDomains; preload`
- `content-security-policy: default-src 'self'; ...` (app-specific)
- `x-content-type-options: nosniff`
- `x-frame-options: DENY`
- `referrer-policy: strict-origin-when-cross-origin`
- `permissions-policy: accelerometer=(), camera=(), geolocation=(), microphone=()`
- `x-correlation-id: <echoed or generated>`

## Audit

Every authenticated mutation writes an `audit_log` row in the same
transaction as the mutation. Write is enforced by the SQLAlchemy session
hook — if the audit row fails to insert, the whole transaction rolls
back.

Exports are admin-only, signed with the KMS-backed key, and produce a
zipped JSONL bundle uploaded to `gv-audit-exports`. The resulting URL
is pre-signed and expires in 15 minutes.

## Secrets

- Dev: plain env vars via `ops/envs/.env.dev`.
- Staging+: AWS Secrets Manager, rotated via the CDK stack. The control
  plane resolves them once at boot via IAM role; no secrets are logged.
- JWT signing keys rotate quarterly. Old JWKS keys stay published for a
  2-week overlap window.

## Data handling

- `users.password_hash`, `api_keys.hash`, and `refresh_tokens.token_hash`
  are the only places raw secret-equivalent material is stored. Each is
  a one-way transform — the raw value is never logged, echoed, or
  persisted elsewhere.
- PII scope: email + full name + last-login IP. All other user data
  (roles, flags) is operational metadata.
