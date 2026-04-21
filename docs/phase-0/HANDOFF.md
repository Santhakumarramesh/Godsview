# GodsView v2.0.0 — Phase 0 handoff

**Tag:** `v2.0.0`
**Branch of origin:** `phase-0-monorepo-foundation`
**Parent commit:** `5abba74` (Phase 14 — End-to-end webhook → SSE integration test)
**Ship commits:** 6 PRs, 181 files, +9 798 / −3 lines
**Blueprint:** `docs/blueprint/`

Phase 0 is the foundation layer for the v2 monorepo. It does not
replace the legacy workspace (`api-server`, `godsview-dashboard`) — both
live in the same tree and the legacy CI continues to gate the current
production build. Phase 0 adds the parallel v2 stack so every later
phase has a clean target to build into.

---

## What ships in v2.0.0

### PR1 — monorepo root (`143e326`)
`pnpm@9.15.0` workspace + `turbo@2` + composite `tsconfig.base.json` with
path aliases for `@gv/*`. Developer-facing `Makefile` with `bootstrap`,
`up`, `down`, `typecheck`, `test`, `migrate`, `seed`, `verify`,
`openapi`, `lint`, and friendly aliases (`dev-up`, `dev-down`,
`dev-reset`, `api`, `web`).

### PR2 — packages (`24c9a49`)
Four internal packages, each with `package.json`, `tsconfig.json`,
`src/index.ts`, and stub tests:

| Package         | Purpose                                                              |
|-----------------|----------------------------------------------------------------------|
| `@gv/types`     | Shared domain types (roles, trust tiers, feature flag keys).         |
| `@gv/config`    | Runtime config loader + typed env-var contracts.                     |
| `@gv/api-client`| TypeScript client stubs + hand-written auth/flags/config endpoints.  |
| `@gv/ui`        | React primitives (button, input, card) wired to Tailwind tokens.     |

### PR3 — control plane (`618d79c`) *folds PR4*
FastAPI + async SQLAlchemy + Alembic under `services/control_plane/`.
Ships:

- `/health/live`, `/health/ready` with dep probes
- `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`
- `/admin/flags` CRUD (admin-gated)
- `/admin/system/config` CRUD (admin-gated)
- `/admin/audit` read surface (admin-gated)
- Argon2id password hashing, JWT access/refresh with rotation
- Correlation-ID, access-log, and security-header middleware
- `ErrorEnvelope` canonical contract (`{error: {code, message, correlation_id, details?, hint?, docs?}}`)
- Alembic baseline migration seeded from `Base.metadata`

Tests under `services/control_plane/tests/` cover auth, flags, errors,
config, and health. Uses aiosqlite so `pytest` runs without Postgres.

### PR5 — apps/web (`867699b`)
Next.js 15 App Router + React 19 RC + TanStack Query 5 + Tailwind dark
palette. Ships 6 functional pages (overview, market symbols, ops
health, ops flags, admin system, login) and **60 stub pages** (one per
sidebar route) gated behind a reusable `ToDoBanner` component that
flags the phase each page lands in. `AuthGate` client component
enforces session presence; per-role sidebar filtering happens in
`Sidebar.tsx`.

### PR6 — dev stack + ops + docs (`648239b`)
`infra/compose/docker-compose.yml` brings up:

- `gv-postgres` (16, with `pgcrypto`, `citext`, `pg_trgm`, `btree_gin`)
- `gv-redis` (7)
- `gv-minio` + one-shot bootstrap (creates `gv-recall`, `gv-audit-exports`, `gv-artifacts`)
- `gv-localstack` (3.8, kinesis/sqs/secretsmanager/ssm/sts/iam)
- `gv-mailhog`

All services have healthchecks, named volumes, and survive restarts.
`ops/scripts/{bootstrap,migrate,seed,reset}.sh` wrap the Make targets
with env-file resolution; `reset.sh` requires `RESET_FORCE=1`.
`ops/envs/.env.dev.example` ships with Decision #4 safety-floor
defaults (`KILL_SWITCH_ON_BOOT=1`, `ALLOW_LIVE_EXECUTION=0`,
`ALLOW_AUTONOMOUS_INTELLIGENCE=0`).

The `docs/blueprint/` directory ships ten cross-linked documents
(README + 00 through 09) — single source of truth for the v2 surface.

### PR7 — CI + contract validation (`839e1aa`)
- `.github/workflows/v2-ci.yml`: path-filtered pnpm/turbo + python
  matrix (3.11, 3.12) for `services/control_plane`. Runs ruff lint,
  ruff format check, mypy strict, pytest with coverage. Aggregated via
  a `v2-gate` job that becomes the required check on branch protection.
- `.github/workflows/contract-validation.yml`: regenerates the OpenAPI
  spec via `python -m app.scripts.dump_openapi`, diffs against the
  committed `packages/api-client/openapi.json`, fails on drift, and
  independently validates the `ErrorEnvelope` shape + 401/403 coverage
  across every non-public route.
- `ErrorEnvelope` + `ErrorBody` + `ErrorDetail` Pydantic models emit
  the schema into `components/schemas`; `AUTH_ERROR_RESPONSES` +
  `COMMON_ERROR_RESPONSES` wire 401/403/422/429 into every router.
- `services/control_plane/tests/test_openapi_contract.py` runs the
  same contract checks in-process so developers catch drift before
  CI does.
- Committed `packages/api-client/openapi.json` is the source of truth
  for the Phase 0 API surface: 11 paths, 15 schemas.

---

## Repo layout after Phase 0

```
.
├── .github/workflows/
│   ├── ci.yml                    # legacy workspace (unchanged)
│   ├── v2-ci.yml                 # NEW — v2 monorepo
│   └── contract-validation.yml   # NEW — OpenAPI parity gate
├── apps/
│   └── web/                      # NEW — Next.js 15 app (66 routes)
├── packages/
│   ├── api-client/               # NEW — + openapi.json source of truth
│   ├── config/                   # NEW
│   ├── types/                    # NEW
│   └── ui/                       # NEW
├── services/
│   └── control_plane/            # NEW — FastAPI + SQLAlchemy
├── infra/
│   └── compose/                  # NEW — dev stack + postgres init
├── ops/
│   ├── envs/                     # NEW — .env.*.example files
│   └── scripts/                  # NEW — bootstrap/migrate/seed/reset
├── docs/
│   ├── blueprint/                # NEW — 10 reference docs
│   └── phase-0/                  # THIS HANDOFF + patch files
├── Makefile                      # extended with v2 targets
├── pnpm-workspace.yaml           # extended with apps/*, packages/*
├── turbo.json                    # extended with v2 pipeline
└── tsconfig.base.json            # extended with @gv/* path aliases
```

The legacy workspace (`api-server`, `artifacts/api-server`,
`godsview-dashboard`) is unchanged and continues to ship production.

---

## How to verify Phase 0 locally

```bash
git checkout v2.0.0

make bootstrap                     # installs pnpm + python deps
make dev-up                        # compose stack
make migrate                       # alembic upgrade head
make seed                          # admin + flags + config
make api &                         # control plane :8000
make web &                         # Next.js :3000

curl -sS http://localhost:8000/health/ready | jq
# Expect: {"status":"ok","checks":{"db":"ok","redis":"ok","config":"ok"}}

curl -sS http://localhost:8000/openapi.json | jq '.paths | keys | length'
# Expect: 11

open http://localhost:3000/overview
```

Contract parity:

```bash
make openapi
git diff --exit-code -- packages/api-client/openapi.json
# Expect: no output (spec committed matches live app).
```

Lint gate:

```bash
make lint
# Expect: ruff all green + turbo typecheck:v2 clean.
```

Test gate:

```bash
cd services/control_plane && pytest -q
pnpm -w run test:v2
```

---

## What is deliberately NOT in v2.0.0

Phase 0 ships the *scaffold* — it does not ship any of the engines.
The blueprint phase roadmap (`docs/blueprint/09-phase-roadmap.md`)
details what each subsequent phase adds. A non-exhaustive list of
things that remain stubs after v2.0.0:

- Every sidebar route outside the 6 Phase 0 ones returns a
  `ToDoBanner` with its target phase label.
- No TradingView webhook ingestion yet — Phase 2 owns the MCP layer.
- No Alpaca adapter in the v2 path — Phase 9 owns execution.
- No Recall, no Quant Lab, no Fusion — those land in 7, 6, and 4.
- Live trading is **force-disabled** by the safety floor
  (Decision #4). Flipping it requires an admin commit to
  `system_config` plus dual-control approval, neither of which has a
  UI until Phase 11.

The legacy workspace continues to serve production while v2 fills in.

---

## Risk + rollback

- `v2-ci.yml` is path-filtered — a PR that touches only legacy code
  won't trigger the v2 matrix, and vice versa. Branch protection
  should require **both** `v2-gate` and the legacy `TypeCheck + Test`
  job on PRs that cross the seam.
- `contract-validation.yml` is a hard fail on spec drift. When a
  contract change is *intended* (Phase 1+ will add endpoints), commit
  the regenerated `openapi.json` in the same PR.
- To roll back, `git revert v2.0.0^..v2.0.0` produces a clean undo —
  the new code lives entirely under `apps/web`, `packages/*`,
  `services/control_plane`, `infra/compose`, `ops/{envs,scripts}`,
  `docs/blueprint`, `docs/phase-0`, and the two new workflow files.
  No existing files other than `.gitignore`, `Makefile`, `README.md`,
  `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json`, and
  `turbo.json` were modified.

---

## Patch files

Full range diff: `docs/phase-0/phase-0-full.patch`

Per-PR split: `docs/phase-0/patches/000{1..6}-*.patch` — apply with
`git am docs/phase-0/patches/*.patch` onto the parent commit.

---

## Sign-off checklist (Phase 0 exit)

- [x] PR1 monorepo root builds green
- [x] PR2 packages compile and version-pin
- [x] PR3 control plane boots, `/ready` green against compose postgres
- [x] PR5 web app renders all 66 routes (6 functional + 60 stubs)
- [x] PR6 `make dev-up` stands up the full dev stack
- [x] PR7 CI + contract validation wired and green
- [x] HANDOFF.md + patch files committed
- [ ] `git tag v2.0.0` applied (final step)

Phase 1 opens once the tag is pushed and branch protection is flipped
to require `v2-gate` + `contract-validation` on `main`.
