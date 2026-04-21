# `infra/compose` — local dev stack

One-command bring-up for every dependency the GodsView control plane and
web app talk to in development. Matches the production topology so that
Alembic migrations, S3 paths, rate-limit keys, and SMTP flows behave the
same on a laptop as they do in AWS.

## Services

| Service     | Image                                     | Ports       | Purpose                                          |
|-------------|-------------------------------------------|-------------|--------------------------------------------------|
| postgres    | `postgres:16-alpine`                      | `5432`      | Primary OLTP (asyncpg driver)                    |
| redis       | `redis:7-alpine`                          | `6379`      | Rate limits, session hot path, pub/sub           |
| minio       | `minio/minio`                             | `9000/9001` | S3-compatible object store                       |
| localstack  | `localstack/localstack:3.8`               | `4566`      | Kinesis / SQS / Secrets Manager emulator         |
| mailhog     | `mailhog/mailhog:v1.0.1`                  | `1025/8025` | SMTP sink + web UI for email flow tests          |

A one-shot `minio-bootstrap` container provisions the expected buckets on
first run: `gv-recall`, `gv-audit-exports`, `gv-artifacts`.

## Bring-up

```bash
make dev-up          # runs docker compose up -d
make dev-down        # stops containers (keeps volumes)
make dev-reset       # stops + removes volumes (full wipe)
make dev-logs        # tail all service logs
```

Raw compose is also fine:

```bash
docker compose -f infra/compose/docker-compose.yml up -d
docker compose -f infra/compose/docker-compose.yml ps
docker compose -f infra/compose/docker-compose.yml logs -f
```

## First-run checklist

After `make dev-up`:

1. Postgres is reachable at `postgres+asyncpg://godsview:godsview@localhost:5432/godsview`.
2. Run `make migrate` to apply Alembic baseline.
3. Run `make seed` to insert the bootstrap admin + default feature flags +
   system config. Bootstrap credentials come from `BOOTSTRAP_ADMIN_EMAIL`
   and `BOOTSTRAP_ADMIN_PASSWORD` (see `ops/envs/.env.dev`).
4. Hit `http://localhost:8000/ready` — should return `ok` with all deps
   green.
5. Hit `http://localhost:3000` — the web app redirects to `/login`.

## Safety defaults

The compose stack passes no secrets through to real services. All
credentials are development-only and scoped to the local network. The
control plane refuses to boot against this stack if `APP_ENV=production`
— see `Settings.model_validator` in `services/control_plane/app/config.py`.
