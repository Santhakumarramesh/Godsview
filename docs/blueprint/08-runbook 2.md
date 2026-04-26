# 08 · Operator runbook (Phase 0)

Short runbook that covers the day-2 surfaces shipped in Phase 0.
Later phases extend this with per-engine playbooks.

## Deployment (dev)

```bash
make dev-up         # compose stack up
make migrate        # alembic upgrade head
make seed           # bootstrap admin + flags + config
make api            # control plane on :8000
make web            # next.js on :3000
```

Smoke: curl `http://localhost:8000/ready`. Every dep should read `ok`.

## Deployment (staging+)

Handled by the CDK stack under `infra/cdk`. The relevant targets are
documented in `docs/AWS_DEPLOY.md` and wired through
`.github/workflows/ci.yml` (legacy) and `.github/workflows/v2-ci.yml`
(v2 monorepo).

Never deploy a PR whose CI has `contract-validation.yml` in a non-green
state — the failing job gates every deploy workflow. Regenerate the spec
locally with `make openapi` and commit the diff; a breaking change that
the OpenAPI diff surfaces requires a contract RFC before merge.

## CI surface (Phase 0+)

| Workflow                            | Purpose                                           |
|-------------------------------------|---------------------------------------------------|
| `.github/workflows/ci.yml`          | Legacy workspace (artifacts/api-server, dashboard). |
| `.github/workflows/v2-ci.yml`       | v2 monorepo: pnpm/turbo + control plane pytest.   |
| `.github/workflows/contract-validation.yml` | OpenAPI spec parity + ErrorEnvelope + auth-gate enforcement. |

The `v2-ci.yml` workflow has a terminal `v2-gate` job that aggregates the
matrix legs; treat it as the required check on the branch protection rule
once the repo migrates fully to v2. `contract-validation.yml` is a
separate required check so a missing codegen commit blocks merge even
when the rest of CI passes.

## Incident: `/ready` returns `degraded`

1. Inspect the `checks` field: a single failing dep determines the fix.
2. If `db`: check `gv-postgres` logs (`docker logs gv-postgres`) in dev
   or RDS CloudWatch in prod.
3. If `redis`: rate limiting degrades but auth keeps working. Flip
   `rate_limit.fallback_allow` to true temporarily via `/ops/flags`
   (admin + dual-control in prod).
4. If `kms`: auth still works on cached JWKS for ≤15 minutes. Escalate
   before cache expiry.

## Incident: bootstrap admin can't log in

1. Confirm `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` in the
   active env file match what you're submitting.
2. Re-run `make seed` — it's idempotent and updates the password on
   every run.
3. If still failing, inspect the `audit_log` for a `user.login.failed`
   entry; the `metadata.reason` tells you which check tripped.

## Kill-switch procedure

To halt every execution path immediately, set
`execution.kill_switch = true` on `/ops/flags`. The flag is read on
every order submission and on control plane boot. Re-enabling requires
dual-control approval per the Governance docs.

## Bringing a new operator online

1. Existing admin creates the user via `/v1/users` with role `analyst`.
2. New operator resets password via `/v1/auth/me → PATCH` once logged in.
3. Admin promotes to `operator` once the operator has read the
   blueprint + this runbook.
4. Admin enables MFA via the same `PATCH` endpoint. (Phase 1 adds UI.)
