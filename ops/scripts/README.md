# `ops/scripts` — dev & CI helper scripts

Thin wrappers around the real tools (`alembic`, `docker compose`, `pnpm`,
`python -m app.scripts.*`). The intent is that nothing in this folder
encodes business logic — it only orchestrates. Every script is
idempotent and safe to re-run.

| Script          | What it does                                                                     |
|-----------------|----------------------------------------------------------------------------------|
| `bootstrap.sh`  | First-run bring-up: installs deps, starts compose, migrates, seeds.              |
| `migrate.sh`    | `alembic upgrade head` by default; pass any alembic subcommand.                  |
| `seed.sh`       | Idempotent seed of bootstrap admin + feature flags + system config.              |
| `reset.sh`      | DESTRUCTIVE — tears down compose and removes all dev volumes. Prompts by default. |

All scripts source `ops/envs/.env.dev` when present. The example lives
at `ops/envs/.env.dev.example` and is committed; the real `.env.dev`
is gitignored.

## Running

Every script is executable from any cwd — they resolve the repo root
themselves:

```bash
ops/scripts/bootstrap.sh
ops/scripts/migrate.sh current
ops/scripts/seed.sh
RESET_FORCE=1 ops/scripts/reset.sh
```

The Makefile at the repo root wraps these with shorter targets
(`make dev-up`, `make migrate`, `make seed`, `make dev-reset`).
