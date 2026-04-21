# 02 · Monorepo layout

Workspace manager: **pnpm v9** · orchestrator: **turbo v2** ·
tsconfig strategy: **composite with path aliases**.

```
Godsview/
├── apps/
│   └── web/                     # Next.js 15 App Router (React 19 RC)
├── packages/
│   ├── types/                   # @gv/types — wire-level Zod + TS types
│   ├── config/                  # @gv/config — env parsing, safety floor
│   ├── api-client/              # @gv/api-client — typed REST wrapper
│   └── ui/                      # @gv/ui — shared primitives + tokens
├── services/
│   └── control_plane/           # FastAPI + async SQLAlchemy + Alembic
├── infra/
│   ├── compose/                 # dev stack: postgres, redis, minio, etc.
│   └── cdk/                     # AWS IaC (lifts from v1 tree)
├── ops/
│   ├── envs/                    # .env.*.example templates
│   └── scripts/                 # bootstrap, migrate, seed, reset
├── docs/
│   └── blueprint/               # this directory — source of truth
├── .github/
│   └── workflows/               # ci.yml + contract-validation.yml
├── turbo.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── Makefile
```

## Non-goals of Phase 0

- **No broker integration.** Alpaca adapter lands Phase 9.
- **No market data feed.** Symbol page is a deterministic seed list.
- **No strategy engine.** Setup / Fusion / Agents are stubs.
- **No live execution.** Kill switch is hard-on by default.

## Legacy coexistence

The v1 tree (apps/, lib/, services/api_gateway, scripts/, etc.) stays
in place for the duration of Phase 0 so that existing deploys keep
working. Phase 0 PR5+ introduces v2 paths alongside. A later Phase 0
sub-PR — scheduled after the tag cut — removes the v1 surface once the
deployment pipeline has been pointed at v2.

## Package ownership

| Package              | Owns                                                                 |
|----------------------|----------------------------------------------------------------------|
| `@gv/types`          | Wire types, error envelope schema, API response/request shapes.      |
| `@gv/config`         | Env validators, safety-floor constants, feature-flag keys.           |
| `@gv/api-client`     | Fetch wrapper, bearer plumbing, error mapping to `ApiError` class.   |
| `@gv/ui`             | Design tokens, tables, badges, layout primitives (not page-level).   |
| `apps/web`           | Routing, auth UX, page composition. NEVER declares wire types.       |
| `services/control_plane` | FastAPI app, DB models, Alembic, auth, audit, flags, config.    |
