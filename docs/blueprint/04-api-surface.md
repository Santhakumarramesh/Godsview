# 04 · API surface (Phase 0)

All endpoints mount under `/v1/*`. Health probes are unprefixed so they
stay stable across API versions.

## Canonical error envelope

Every non-2xx response body conforms to:

```jsonc
{
  "error": {
    "code": "feature_flag.not_found",           // stable, dotted identifier
    "message": "Unknown flag key 'foo.bar'.",   // human-readable
    "correlation_id": "01H…",                   // echoed from header
    "details": { /* optional structured */ },   // validation errors, etc.
    "hint": "Check /v1/flags for the full list.", // optional remediation
    "docs": "https://docs.godsview.local/errors/feature_flag.not_found"
  }
}
```

- `code` is the primary contract. Clients switch on it; UI displays `message`.
- `correlation_id` matches the `x-correlation-id` response header.
- `details` follows RFC 7807-style nested structure for validation errors.

## Health

| Method | Path          | Auth | Description                                             |
|--------|---------------|------|---------------------------------------------------------|
| GET    | `/live`       | no   | Process alive check. Always returns `status=ok`.        |
| GET    | `/ready`      | no   | Readiness + per-dependency check (db, redis, kms).      |

## Auth

| Method | Path               | Auth        | Description                                          |
|--------|--------------------|-------------|------------------------------------------------------|
| POST   | `/v1/auth/login`   | no          | Email + password → access + refresh tokens.          |
| POST   | `/v1/auth/refresh` | refresh     | Rotates refresh token, returns new access.           |
| POST   | `/v1/auth/logout`  | access      | Revokes all refresh tokens for the user.             |
| GET    | `/v1/auth/me`      | access      | Current user + roles.                                |

## Users & roles

| Method | Path                     | Auth  | Description                              |
|--------|--------------------------|-------|------------------------------------------|
| GET    | `/v1/users`              | admin | List users.                              |
| POST   | `/v1/users`              | admin | Create user.                             |
| PATCH  | `/v1/users/{id}`         | admin | Update roles / active / mfa.             |
| DELETE | `/v1/users/{id}`         | admin | Deactivate.                              |

## Feature flags

| Method | Path                     | Auth     | Description                           |
|--------|--------------------------|----------|---------------------------------------|
| GET    | `/v1/flags`              | any auth | List all flags (read-only).           |
| PATCH  | `/v1/flags/{key}`        | admin    | Toggle / update description.          |

## System config

| Method | Path                           | Auth  | Description                        |
|--------|--------------------------------|-------|------------------------------------|
| GET    | `/v1/system/config`            | any   | List entries.                      |
| PUT    | `/v1/system/config/{key}`      | admin | Upsert typed value.                |

## Audit

| Method | Path                    | Auth  | Description                                   |
|--------|-------------------------|-------|-----------------------------------------------|
| GET    | `/v1/audit/events`      | admin | Paginated log with filters.                   |
| POST   | `/v1/audit/exports`     | admin | Kick off signed CSV/JSONL export job.         |

## Error codes (Phase 0)

| Code                              | HTTP | Meaning                                          |
|-----------------------------------|------|--------------------------------------------------|
| `auth.invalid_credentials`        | 401  | Email or password wrong.                         |
| `auth.refresh_expired`            | 401  | Refresh token past expiry.                       |
| `auth.refresh_revoked`            | 401  | Refresh already rotated or explicitly revoked.   |
| `auth.insufficient_scope`         | 403  | Token valid but role insufficient.               |
| `validation.failed`               | 422  | Pydantic body / query validation error.          |
| `feature_flag.not_found`          | 404  | Unknown flag key.                                |
| `system_config.type_mismatch`     | 422  | New value type doesn't match the key's contract. |
| `rate_limit.exceeded`             | 429  | Subject over its window budget.                  |
| `internal.unexpected`             | 500  | Wrapped exception; correlation ID surfaces in logs. |

## Versioning

- `/v1` is frozen until a deliberate deprecation plan lands; breaking
  changes ship under `/v2`.
- Additive changes (new fields, new endpoints) are allowed in `/v1`
  with `Optional` fields on responses.
