# 03 · DB schema (Phase 0)

Postgres 16. Every table is created by the baseline Alembic migration
`20260419_0001_phase0_baseline`. Later phases add tables; Phase 0 tables
are never dropped.

## Tables

### `users`

| Column           | Type                   | Notes                                         |
|------------------|------------------------|-----------------------------------------------|
| `id`             | `uuid` PK              | `gen_random_uuid()` default.                  |
| `email`          | `citext` unique        | Login identity. Case-insensitive.             |
| `password_hash`  | `text`                 | Argon2id encoded hash.                        |
| `full_name`      | `text`                 | Display name.                                 |
| `roles`          | `text[]` / `varchar[]` | e.g. `{analyst,operator}`.                    |
| `is_active`      | `boolean` default true | Deactivation instead of delete.               |
| `mfa_enabled`    | `boolean` default false| Enforced per env by `auth.mfa.required`.      |
| `created_at`     | `timestamptz`          | Insert default `now()`.                       |
| `updated_at`     | `timestamptz`          | Touched on every update.                      |
| `last_login_at`  | `timestamptz` nullable |                                               |

Indexes: `ix_users_email` (unique).

### `refresh_tokens`

| Column          | Type          | Notes                                                      |
|-----------------|---------------|------------------------------------------------------------|
| `id`            | `uuid` PK     |                                                            |
| `user_id`       | `uuid` FK → users (cascade) |                                              |
| `token_hash`    | `text` unique | SHA-256 of the opaque token.                               |
| `issued_at`     | `timestamptz` |                                                            |
| `expires_at`    | `timestamptz` | `issued_at + REFRESH_TOKEN_TTL_SECONDS`.                   |
| `revoked_at`    | `timestamptz` | Null until logout / rotation.                              |
| `replaced_by`   | `uuid`        | Points at the successor token when rotated.                |
| `user_agent`    | `text`        | Captured at issue.                                         |
| `ip`            | `inet`        | Captured at issue.                                         |

Indexes: `ix_refresh_tokens_user_id`.

### `feature_flags`

| Column       | Type          | Notes                                                    |
|--------------|---------------|----------------------------------------------------------|
| `key`        | `text` PK     | Dotted path, e.g. `execution.kill_switch`.               |
| `enabled`    | `boolean`     |                                                          |
| `scope`      | `text`        | `global` / `role` / `user`.                              |
| `scope_ref`  | `text`        | Null for `global`; role name or user id otherwise.       |
| `description`| `text`        |                                                          |
| `updated_at` | `timestamptz` |                                                          |
| `updated_by` | `uuid` FK → users |                                                      |

### `system_config`

| Column        | Type        | Notes                                                     |
|---------------|-------------|-----------------------------------------------------------|
| `key`         | `text` PK   |                                                           |
| `value`       | `jsonb`     | Typed value — validated per-key by the control plane.     |
| `description` | `text`      |                                                           |
| `updated_at`  | `timestamptz` |                                                         |
| `updated_by`  | `uuid` FK → users |                                                     |

### `audit_log`

Append-only. Every mutation anywhere in the system writes one row.

| Column            | Type          | Notes                                              |
|-------------------|---------------|----------------------------------------------------|
| `id`              | `uuid` PK     |                                                    |
| `occurred_at`     | `timestamptz` |                                                    |
| `actor_id`        | `uuid` FK → users nullable | Null for system actions.            |
| `actor_label`     | `text`        | `admin@godsview.local` / `system:seed`.            |
| `action`          | `text`        | e.g. `feature_flag.update`.                        |
| `resource_type`   | `text`        | e.g. `feature_flag`.                               |
| `resource_id`     | `text`        | Natural key — token, flag key, user id.            |
| `correlation_id`  | `text`        | Echoed from request header.                        |
| `before`          | `jsonb`       | Prior state, when applicable.                      |
| `after`           | `jsonb`       |                                                    |
| `metadata`        | `jsonb`       | IP, user agent, HTTP status, etc.                  |

Indexes: `ix_audit_log_occurred_at`, `ix_audit_log_actor`, `ix_audit_log_resource`, `ix_audit_log_correlation`, `ix_audit_log_action`.

### `api_keys`

| Column       | Type         | Notes                                                      |
|--------------|--------------|------------------------------------------------------------|
| `id`         | `uuid` PK    |                                                            |
| `owner_id`   | `uuid` FK → users cascade |                                                |
| `name`       | `text`       | Human label.                                               |
| `prefix`     | `text` unique| First 8 chars of the token, displayed in UI.               |
| `hash`       | `text`       | Argon2id hash of the full token.                           |
| `scopes`     | `text[]`     | Dotted scope strings.                                      |
| `created_at` | `timestamptz`|                                                            |
| `last_used_at` | `timestamptz` nullable |                                                  |
| `expires_at` | `timestamptz` nullable |                                                  |
| `revoked_at` | `timestamptz` nullable |                                                  |

Indexes: `ix_api_keys_owner`. Unique on `prefix` and `(owner_id, name)`.

### `rate_limit_bucket`

Single source of truth for long-window rate limiting; Redis handles
short-window hot path.

| Column          | Type          | Notes                                          |
|-----------------|---------------|------------------------------------------------|
| `id`            | `uuid` PK     |                                                |
| `subject_type`  | `text`        | `user` / `api_key` / `ip`.                     |
| `subject_ref`   | `text`        |                                                |
| `window_key`    | `text`        | `daily-2026-04-19` etc.                        |
| `count`         | `bigint`      |                                                |
| `limit`         | `bigint`      |                                                |
| `updated_at`    | `timestamptz` |                                                |

## Invariants

1. Every write to `feature_flags`, `system_config`, `api_keys`, or
   `users.roles` must emit a matching `audit_log` row in the same
   transaction.
2. `refresh_tokens.token_hash` is SHA-256 (fast, not sensitive); the
   raw token is never persisted.
3. `users.password_hash` is Argon2id with `memory_cost≥64MiB` and
   `time_cost≥3`.
4. All timestamps are UTC. The DB enforces `timezone('UTC', ...)` defaults.
