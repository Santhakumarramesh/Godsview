# PHASES_0_TO_7.md — GodsView v2+ Blueprint

**Scope:** full per-phase spec for the eight foundational phases of
the v2 rebuild. Each phase includes: goal, scope, folder/file
deliverables, DB DDL deltas, API routes added, UI pages added or
promoted, AWS resources touched, test strategy, exit criteria,
rollback plan, and PR breakdown.

This file is the companion to `BLUEPRINT.md` (index), `reference/*`
(contracts), and `PHASES_8_TO_15.md` (remaining eight phases).

**Delivery discipline per phase** (locked):
1. Branch `phase-<n>-<slug>`
2. One PR per deliverable section (typically 3–6 per phase)
3. Verification gate (`tsc`, `pytest`, `vitest`, `playwright`, CDK synth)
4. `HANDOFF.md` in `/phase-<n>/`
5. Patch file `0001-…patch`
6. Tag at phase completion (see BLUEPRINT §9)
7. Backlog sweep (close stale tasks, file new ones)

---

## Phase 0 — Monorepo foundation + core platform skeleton

**Tag at completion:** `v2.0.0`
**Branch:** `phase-0-monorepo-foundation`
**Estimated PRs:** 8

### 0.1 Goal

Stand up the new monorepo structure with every service reachable,
every page at least stubbed, auth working, Postgres + Redis + event
bus running locally via docker-compose, and CI gating typecheck +
unit tests + contract validation on every PR. Replace the v1
artifacts directory with the `apps/`, `services/`, `packages/` tree.

This phase replaces the legacy codebase. It is the only phase
allowed to delete v1 code wholesale.

### 0.2 Scope

In:
- New monorepo layout (`apps/web`, `services/control_plane`, …,
  `packages/*`, `infra/`, `ops/`, `docs/`, `tests/`)
- Authentication (email + password, JWT) — `POST /v1/auth/login`,
  `POST /v1/auth/refresh`, `GET /v1/auth/me`
- Feature flags + system config routes and DB tables
- Health endpoint on every service + aggregate `/v1/ops/health`
- `apps/web` Next.js 15 App Router skeleton with all 10 sidebar
  sections linked (~30 routes stubbed, 6 functional)
- Docker compose dev stack (postgres-16, redis-7, localstack, minio,
  mailhog)
- GitHub Actions CI with typecheck + unit + contract snapshot gates
- OpenAPI → TS client generator (`packages/api-client`)
- Design tokens + shadcn setup in `packages/ui`

Out (deliberate; later phases):
- Real market data
- Signals
- Strategies, backtests, execution
- Intelligence / memory / recall
- AWS infra (CDK lands in Phase 13)

### 0.3 Folder tree (Phase 0 adds)

```
.
├─ apps/
│  └─ web/                                    # Next.js 15 App Router
│     ├─ app/
│     │  ├─ (auth)/login/page.tsx
│     │  ├─ layout.tsx                        # global shell
│     │  ├─ page.tsx                          # Overview
│     │  ├─ market/symbols/page.tsx
│     │  ├─ ops/health/page.tsx
│     │  ├─ ops/flags/page.tsx
│     │  ├─ admin/system/page.tsx
│     │  └─ …                                 # all 68 routes as stubs
│     ├─ components/
│     ├─ lib/
│     │  └─ api.ts                            # generated client wrapper
│     ├─ next.config.mjs
│     ├─ package.json
│     └─ tsconfig.json
│
├─ services/
│  └─ control_plane/                          # FastAPI
│     ├─ app/
│     │  ├─ main.py                           # FastAPI app, CORS, routes
│     │  ├─ config.py                         # pydantic-settings
│     │  ├─ deps.py                           # auth, db, redis, bus
│     │  ├─ auth/
│     │  │  ├─ jwt.py
│     │  │  ├─ routes.py
│     │  │  └─ schemas.py
│     │  ├─ users/                            # CRUD (Phase 1 fills out)
│     │  ├─ flags/routes.py
│     │  ├─ system_config/routes.py
│     │  ├─ ops/
│     │  │  ├─ health.py                      # /v1/ops/health
│     │  │  └─ health_checks.py               # per-dep checks
│     │  └─ db/
│     │     ├─ session.py                     # SQLAlchemy async
│     │     └─ models/
│     │        ├─ user.py
│     │        ├─ role.py
│     │        ├─ session.py
│     │        ├─ api_key.py
│     │        ├─ audit_event.py
│     │        ├─ feature_flag.py
│     │        └─ system_config.py
│     ├─ alembic/
│     │  ├─ env.py
│     │  └─ versions/001_phase0_baseline.py
│     ├─ tests/
│     │  ├─ conftest.py                       # pytest fixtures
│     │  ├─ test_health.py
│     │  ├─ test_auth.py
│     │  └─ test_flags.py
│     ├─ Dockerfile
│     ├─ pyproject.toml
│     └─ README.md
│
├─ packages/
│  ├─ api-client/                             # generated from openapi
│  │  ├─ src/generated/                       # openapi-typescript output
│  │  ├─ src/index.ts                         # thin wrapper w/ auth
│  │  └─ package.json
│  ├─ ui/                                     # design system
│  │  ├─ src/tokens/colors.ts
│  │  ├─ src/tokens/spacing.ts
│  │  ├─ src/primitives/Button.tsx
│  │  ├─ src/primitives/KillSwitchPill.tsx
│  │  ├─ src/primitives/SseStatusDot.tsx
│  │  └─ …
│  ├─ config/                                 # shared config loaders
│  └─ types/                                  # shared TS types (events etc)
│
├─ infra/
│  └─ compose/
│     ├─ docker-compose.yml                   # pg, redis, minio, localstack
│     └─ init/
│        ├─ postgres.sql                      # extensions
│        └─ minio-buckets.sh
│
├─ ops/
│  ├─ scripts/
│  │  ├─ bootstrap_dev.sh                     # one-shot dev setup
│  │  ├─ reset_db.sh
│  │  └─ seed_admin_user.py
│  └─ envs/
│     └─ .env.example
│
├─ docs/
│  ├─ BLUEPRINT.md                            # (from blueprint/ ref)
│  ├─ ARCHITECTURE.md
│  ├─ API_SURFACE.md
│  ├─ DB_SCHEMA.md
│  ├─ SIDEBAR_MAP.md
│  ├─ AWS_RESOURCES.md
│  └─ RUNBOOK_TEMPLATE.md
│
├─ tests/
│  ├─ contract/
│  │  └─ api_surface.spec.ts                  # drift test vs API_SURFACE.md
│  └─ e2e/                                    # playwright stubs
│
├─ .github/
│  ├─ workflows/
│  │  ├─ ci.yml
│  │  ├─ contract-validation.yml
│  │  └─ pr-labeler.yml
│  └─ CODEOWNERS
│
├─ pnpm-workspace.yaml
├─ turbo.json
├─ package.json
├─ tsconfig.base.json
├─ Makefile
├─ CHANGELOG.md
└─ README.md
```

### 0.4 DB DDL delta (Phase 0)

Alembic migration `001_phase0_baseline.py` creates only the tables
needed for auth + config + audit (seven tables from DB_SCHEMA.md):

- `users`
- `roles`
- `sessions`
- `api_keys`
- `audit_events` (partition-by-month starts empty)
- `feature_flags`
- `system_config`

Also: enable extensions `pgcrypto`, `pg_trgm`, `btree_gist`.

Seed data:
- Role rows: viewer, analyst, operator, admin
- Default admin user via `ops/scripts/seed_admin_user.py` using an
  env-supplied bcrypt password hash
- Feature flags: `execution_enabled=false`, `replay_v2=false`,
  `recall_v2=false` (default off; phases flip them on)

### 0.5 API routes added (from API_SURFACE.md §3.1, §3.13)

- `POST /v1/auth/login`
- `POST /v1/auth/refresh`
- `POST /v1/auth/logout`
- `GET /v1/auth/me`
- `GET /v1/ops/health`
- `GET /v1/ops/health/:service` (stubs for later services)
- `GET /v1/ops/metrics` (prometheus proxy)
- `GET /v1/feature_flags`, `PATCH /v1/feature_flags/:key`
- `GET /v1/system_config`, `PATCH /v1/system_config/:key`
- `GET /v1/symbols` (static seed list; Phase 2 replaces with lookup)

### 0.6 UI pages added

6 functional + stubs for the rest of the 68. Functional:
- `/` (Overview — minimal live tiles)
- `/market/symbols` (static search against seeded symbols)
- `/ops/health`
- `/ops/flags`
- `/admin/system`
- `(auth)/login`

Stubs (placeholder with "Phase X adds this"): all other 62 routes.

### 0.7 AWS resources

None. This phase does **not** provision AWS. Local dev only.

### 0.8 Test strategy

- Unit (pytest): auth happy + failure paths, JWT expiry, RBAC gate
  helper, feature flag toggle, config patch audit log row created
- Unit (vitest): API client wrapper (with MSW), UI primitive snapshot
- Contract: `tests/contract/api_surface.spec.ts` parses API_SURFACE.md
  §3 and asserts every documented route appears in the merged
  FastAPI OpenAPI with matching method/path/auth
- Smoke: `playwright` login → land on `/` → see Overview tiles
- Lint: `ruff`, `mypy`, `eslint`, `tsc --noEmit`, `prettier --check`

### 0.9 CI gates (lands in `.github/workflows/ci.yml`)

- `typecheck`: `tsc --noEmit` all packages + `mypy services/*`
- `test:unit`: `pytest services/control_plane` + `vitest run`
- `test:contract`: node the api_surface spec
- `test:smoke`: playwright `pnpm --filter @gv/web smoke`
- `build`: `pnpm --filter @gv/web build` + `docker build services/control_plane`

Each gate required to merge. No `continue-on-error`.

### 0.10 Exit criteria

- [ ] `docker compose up` brings the full dev stack to healthy in < 60s
- [ ] `ops/scripts/bootstrap_dev.sh` succeeds on a fresh clone
- [ ] Default admin can log in, land on `/`, toggle a feature flag,
       edit a system config key
- [ ] `GET /v1/ops/health` returns `ok` with control_plane, postgres,
       redis, minio, localstack all green (other services omitted)
- [ ] Contract snapshot gate green
- [ ] All 68 routes in `apps/web` resolve (200 or auth redirect) — no 404s
- [ ] `v2.0.0` tag on `main`
- [ ] `phase-0/HANDOFF.md` documents delta vs v1.7.0 legacy repo

### 0.11 Rollback

Revert tag; `main` stays on `v1.7.0` legacy branch in a `legacy/` git
worktree. Because Phase 0 replaces the legacy code in-place, rollback
means checking out the `v1.7.0` tag in `legacy/` — no production is
running v2 yet, so zero customer impact.

### 0.12 PR breakdown

1. Monorepo scaffolding (pnpm workspace, turbo, tsconfig, base pkgs)
2. `packages/ui` + `packages/api-client` skeletons
3. `services/control_plane` skeleton + health endpoint + compose file
4. Alembic baseline migration + seed scripts + auth routes
5. `apps/web` shell + login + Overview + 62 stubs
6. Feature flags + system config routes + pages
7. OpenAPI generator + contract snapshot test
8. CI workflows + CODEOWNERS + HANDOFF

---

## Phase 1 — Identity hardening + audit + admin surface

**Tag at completion:** `v2.1.0`
**Branch:** `phase-1-identity-hardening`
**Estimated PRs:** 5

### 1.1 Goal

Turn Phase 0's minimal auth into production-grade identity: full user
CRUD, role changes, API keys, MFA enrollment, and an append-only,
queryable audit log that captures every state-changing admin action.

### 1.2 Scope

In:
- Full user CRUD + soft delete
- MFA enrollment (TOTP via `pyotp`) and verify flow
- API keys: mint (hash at rest), revoke, list
- Audit log write on every privileged action
- `/admin/users` + `/admin/api-keys` + `/ops/audit` pages
- Rate-limit middleware (token-bucket, per-token)
- RS256 JWT in prod path; JWKS endpoint for rotation
- Password reset via magic-link email (mailhog in dev)

Out:
- SAML / OIDC SSO (future phase if needed)
- Passkeys (WebAuthn) — future

### 1.3 Folder tree delta

```
services/control_plane/app/
├─ auth/
│  ├─ mfa.py                                  # TOTP enroll + verify
│  ├─ password_reset.py                       # magic link
│  └─ api_keys.py
├─ users/
│  ├─ routes.py                               # full CRUD
│  └─ schemas.py
├─ audit/
│  ├─ logger.py                               # single source of audit writes
│  └─ routes.py                               # /v1/audit
├─ ratelimit/
│  ├─ middleware.py                           # token-bucket w/ redis
│  └─ buckets.py                              # per-endpoint quotas

services/control_plane/alembic/versions/
└─ 002_phase1_identity.py                     # if any delta; mostly indexes

apps/web/app/admin/
├─ users/page.tsx
├─ users/[id]/page.tsx
├─ api-keys/page.tsx

apps/web/app/ops/
└─ audit/page.tsx

packages/ui/src/primitives/
├─ AuditTable.tsx
└─ MfaEnrollDialog.tsx
```

### 1.4 DB DDL delta

No new tables (Phase 0 already created all identity tables). Adds
indexes:

```sql
CREATE INDEX audit_events_actor_ts_idx ON audit_events(actor_id, ts DESC);
CREATE INDEX audit_events_kind_ts_idx  ON audit_events(kind, ts DESC);
CREATE INDEX api_keys_user_active_idx  ON api_keys(user_id) WHERE revoked_at IS NULL;
```

Adds partial unique index on `users(email)` where `deleted_at IS NULL`
(prevent reuse of active email; allow after soft-delete).

### 1.5 API routes added

From API_SURFACE.md §3.1 and §3.13:

- `POST /v1/auth/mfa/enroll`, `POST /v1/auth/mfa/verify`
- `GET /v1/users`, `POST /v1/users`, `GET /v1/users/:id`,
  `PATCH /v1/users/:id`, `DELETE /v1/users/:id`
- `GET /v1/api_keys`, `POST /v1/api_keys`, `DELETE /v1/api_keys/:id`
- `GET /v1/audit`
- `POST /v1/auth/password/reset_request`, `POST /v1/auth/password/reset_confirm`

### 1.6 UI pages added

- `/admin/users` (list, filter, invite)
- `/admin/users/:id` (detail, role change, deactivate)
- `/admin/api-keys` (per-user list, mint modal that shows secret once)
- `/ops/audit` (searchable table of audit events)

### 1.7 Test strategy

- Happy: login → enroll MFA → verify → refresh triggers MFA
- Permission: viewer can't call `/v1/users`; admin can
- Audit: every role change emits an `audit_events` row with correct
  actor, subject, before/after, correlation_id
- Rate limit: repeated POST /v1/auth/login returns 429 after quota;
  `Retry-After` present
- Security: attempted JWT tamper returns 401; expired token triggers
  refresh flow

### 1.8 Exit criteria

- [ ] All routes documented in §3.1 / §3.13 return correct RBAC
- [ ] MFA reaches ≥ admin users (enforced via feature flag)
- [ ] Audit log shows every state change from Phase 0 admin routes
      retroactively (via migration backfill for `feature_flags`,
      `system_config` history where available)
- [ ] Rate limit in front of auth routes proven by synthetic load
- [ ] `v2.1.0` tag + HANDOFF

### 1.9 Rollback

Revert PR by PR. No schema destructive changes; migrations are
index-only and reversible.

---

## Phase 2 — Signals ingestion + live feed (TradingView webhook)

**Tag at completion:** `v2.2.0`
**Branch:** `phase-2-signals-ingestion`
**Estimated PRs:** 6

### 2.1 Goal

Stand up the **ingestion** service, persist every webhook we receive,
publish `signals.ingested.v1` on the event bus, and render new
signals on the dashboard live via SSE. End-to-end round-trip:
TradingView alert → webhook → DB → bus → SSE → UI, with HMAC signature
verification, idempotent dedup, and the full signal timeline view.

This is the first phase that puts the **event bus** to work.

### 2.2 Scope

In:
- `services/ingestion` (FastAPI, port 8010)
- HMAC signature verification middleware
- Webhook receipt persistence (`webhook_receipts`)
- Idempotent dedup on `(source, external_id, sha256(body))`
- Signal persistence (`signals`)
- Publish `signals.ingested.v1` via EventBridge (prod) / redis stream (dev)
- Control-plane routes: `/v1/signals`, `/v1/signals/:id`,
  `/v1/signals/stream`, `/v1/signals/:id/timeline` (stub — Phase 5 fills)
- Watchlists CRUD on control_plane (`/v1/watchlists/*`)
- UI: `/feed`, `/signals`, `/signals/[id]`, `/market/watchlists/*`,
  `/signals/receipts`, fuller `/market/symbols/[symbol]`
- Queue depth page `/ops/queues`

### 2.3 Folder tree delta

```
services/
└─ ingestion/
   ├─ app/
   │  ├─ main.py
   │  ├─ config.py
   │  ├─ deps.py
   │  ├─ webhooks/
   │  │  ├─ tradingview.py                    # POST /v1/webhooks/tradingview
   │  │  ├─ generic.py                        # POST /v1/webhooks/generic
   │  │  ├─ hmac_verify.py
   │  │  └─ dedup.py
   │  ├─ signals/
   │  │  ├─ model.py                          # parse TV body → Signal
   │  │  └─ publisher.py                      # bus publish
   │  ├─ bus/
   │  │  ├─ redis_stream.py                   # dev
   │  │  ├─ eventbridge.py                    # prod
   │  │  └─ envelope.py
   │  └─ db/
   │     └─ models/
   │        ├─ webhook_receipt.py
   │        └─ signal.py
   ├─ alembic/versions/001_ingestion.py       # creates webhook_receipts, signals
   ├─ tests/
   │  ├─ test_tradingview.py
   │  ├─ test_hmac.py
   │  └─ test_dedup.py
   ├─ Dockerfile
   └─ pyproject.toml

services/control_plane/app/
├─ signals/
│  ├─ routes.py                               # GET /v1/signals, /v1/signals/:id
│  ├─ stream.py                               # SSE /v1/signals/stream
│  └─ schemas.py
├─ watchlists/
│  └─ routes.py
└─ ops/
   └─ queues.py                               # /v1/ops/queue/:topic

apps/web/app/
├─ signals/
│  ├─ page.tsx
│  ├─ [id]/page.tsx
│  └─ receipts/page.tsx
├─ feed/page.tsx
├─ market/
│  ├─ symbols/[symbol]/page.tsx               # fuller: recent signals
│  └─ watchlists/
│     ├─ page.tsx
│     └─ [id]/page.tsx
└─ ops/queues/page.tsx
```

### 2.4 DB DDL delta

Alembic migration `001_ingestion.py` (in the ingestion service) adds:

- `webhook_receipts` (with dedup unique index)
- `signals` (with indexes on `symbol`, `created_at`, `strategy_id`)

Control-plane migration `003_phase2_watchlists.py` adds:

- `watchlists`
- `watchlist_symbols`
- Refined `symbols` columns (exchange, tick_size, contract_size) +
  seed script that loads symbols from CME / NYSE metadata fixtures

### 2.5 API routes added

From API_SURFACE.md §3.2, §3.3, §3.4, §3.13:

- `POST /v1/webhooks/tradingview`
- `POST /v1/webhooks/generic`
- `GET /v1/webhooks/receipts`, `GET /v1/webhooks/receipts/:id`
- `GET /v1/signals`, `GET /v1/signals/:id`
- `GET /v1/signals/stream` (SSE)
- `GET /v1/signals/:id/timeline` (stub, Phase 5 expands)
- `GET/POST /v1/watchlists`, `PATCH/DELETE /v1/watchlists/:id`,
  `POST/DELETE /v1/watchlists/:id/symbols`
- `GET /v1/ops/queue/:topic`

### 2.6 UI pages added

- `/feed` (live SSE)
- `/signals`, `/signals/[id]`, `/signals/receipts`
- `/market/watchlists`, `/market/watchlists/[id]`
- `/market/symbols/[symbol]` (promoted from stub)
- `/ops/queues`

### 2.7 Event bus topics published

- `signals.ingested.v1` (FIFO, partition key = symbol)

### 2.8 Test strategy

- Unit: HMAC verify (happy + bad signature + clock skew), dedup
  (same body returns same receipt), bus publish idempotency
- Integration (compose): POST webhook → observe
  `signals.ingested.v1` → SSE client receives event
- Load: 100 RPS webhooks with varied bodies; p95 ingestion latency
  < 50 ms; zero lost events; DLQ empty
- Regression: dashboard MSW test for `/feed` + `/signals`

### 2.9 Exit criteria

- [ ] `curl` a TradingView-style webhook to the gateway; see it
       appear on `/feed` in the browser within 1 s
- [ ] Duplicate webhooks (same external_id + body) return the same
       receipt_id, don't create duplicate signals
- [ ] Bad HMAC returns 401 and does not persist the body
- [ ] `/v1/ops/queue/signals.ingested.v1` reports lag < 1 s under
       100 RPS
- [ ] `v2.2.0` tag + HANDOFF

### 2.10 Rollback

Revert the ingestion service entirely (disable ALB target → tear down
task → drop alembic migration). Control-plane signals routes become
no-ops but remain.

### 2.11 PR breakdown

1. Ingestion service skeleton + health + compose entry
2. HMAC verify middleware + alembic + webhook_receipts
3. TradingView parser + dedup + publish to bus
4. Control-plane signals routes + SSE stream
5. Watchlists CRUD + UI pages
6. `/feed` + `/signals/*` + `/ops/queues` UI + HANDOFF

---

## Phase 3 — Order flow + screenshots

**Tag at completion:** `v2.3.0`
**Branch:** `phase-3-orderflow-screenshots`
**Estimated PRs:** 7

### 3.1 Goal

Ingest L2 book data from a provider (Bookmap-compatible feed), derive
orderflow features (delta, CVD, imbalance, absorption, FVG,
order-block candidates, liquidity pools) in real time, expose them
via REST + WebSocket, and stand up a screenshot renderer service
that produces deterministic, annotated chart PNGs pinned to signals.

### 3.2 Scope

In:
- `services/orderflow` (port 8020) — feature computation, L2 snapshot
  persistence, WebSocket fan-out
- `services/screenshot_renderer` (port 8080) — headless chromium (via
  playwright) → deterministic PNG; annotations JSON
- Webhook endpoint for orderflow packets: `/v1/webhooks/orderflow`
- REST reads (snapshot, delta, imbalance, absorption, fvg, obs,
  liquidity) + `/v1/ws/orderflow/:symbol`
- Screenshot routes (`render`, list, image, annotations, pin)
- UI: `/market/orderflow/[symbol]`, `/market/structure/[symbol]`,
  `/intelligence/screenshots`

### 3.3 Folder tree delta

```
services/
├─ orderflow/
│  ├─ app/
│  │  ├─ main.py
│  │  ├─ ingest/webhook.py                    # POST /v1/webhooks/orderflow
│  │  ├─ features/
│  │  │  ├─ delta.py
│  │  │  ├─ cvd.py
│  │  │  ├─ imbalance.py
│  │  │  ├─ absorption.py
│  │  │  ├─ fvg.py
│  │  │  ├─ order_block.py
│  │  │  └─ liquidity.py
│  │  ├─ ws/
│  │  │  └─ stream.py                         # per-symbol fan-out
│  │  └─ db/models/orderflow_snapshot.py
│  ├─ alembic/versions/001_orderflow.py
│  └─ tests/...
└─ screenshot_renderer/
   ├─ app/
   │  ├─ main.py
   │  ├─ render/
   │  │  ├─ chart.py                          # playwright chromium
   │  │  └─ annotations.py
   │  └─ db/models/screenshot.py
   ├─ alembic/versions/001_screenshots.py
   ├─ tests/test_render_determinism.py        # same input → same sha256
   └─ Dockerfile                              # FROM mcr/playwright

apps/web/app/
├─ market/
│  ├─ orderflow/[symbol]/page.tsx
│  └─ structure/[symbol]/page.tsx
└─ intelligence/screenshots/page.tsx

packages/ui/src/primitives/
├─ L2Ladder.tsx
├─ DeltaTape.tsx
├─ FvgOverlay.tsx
└─ OrderBlockHighlight.tsx
```

### 3.4 DB DDL delta

- `orderflow_snapshots` (partition-by-day via pg_partman; retention 7d hot, then cold)
- `screenshots`

### 3.5 API routes added

See API_SURFACE.md §3.3, §3.8, §3.9:

- `POST /v1/webhooks/orderflow`
- `GET /v1/orderflow/:symbol/*`
- `WS /v1/ws/orderflow/:symbol`
- `POST /v1/screenshots/render`, list, image, annotations, pin

### 3.6 Event bus topics added

- `orderflow.snapshot.v1`, `orderflow.feature.v1`
- `screenshots.rendered.v1`

### 3.7 UI pages added

- `/market/orderflow/[symbol]` (live L2 + features)
- `/market/structure/[symbol]` (MTF structure view)
- `/intelligence/screenshots` (grid)

### 3.8 Test strategy

- Unit: feature math (delta, CVD, FVG detection) against fixtures
- Determinism: same render inputs → same PNG SHA256 (Playwright
  viewport + font fixture pinned)
- WS: back-pressure test — slow client drops L2 frames first, keeps
  feature frames
- Integration: a signal referencing a symbol can render a pinned
  screenshot end-to-end

### 3.9 Exit criteria

- [ ] Order flow page shows live ladder + delta tape at < 300 ms lag
       on 1k updates/s synthetic feed
- [ ] Screenshot renderer produces reproducible PNGs; CI snapshot
       diff passes
- [ ] Screenshots pinned to signals appear in the signal detail page
- [ ] `v2.3.0` tag + HANDOFF

### 3.10 Rollback

Per-service disable + scale-to-zero. Control-plane reads fail soft
(UI shows "orderflow unavailable" banner).

---

## Phase 4 — Strategies authoring (Pine parse + versioning)

**Tag at completion:** `v2.4.0`
**Branch:** `phase-4-strategies`
**Estimated PRs:** 5

### 4.1 Goal

Let an analyst paste a Pine script (or equivalent DSL), parse it into
a canonical JSON AST with constraints (entry, exit, SL, TP, filters,
timeframes), version it, and lint it. This is the **input side** of
the strategy lifecycle. Backtests (Phase 6) and promotion (Phase 8)
consume this.

### 4.2 Scope

In:
- Pine parser (v5 subset sufficient for our templates) → canonical
  JSON
- Lints (no-cooldown, unbounded-risk, ambiguous-exit, timeframe-mismatch)
- Strategy CRUD + version submission + parse preview
- `/strategies/*` pages
- Seed library of 5 template strategies that ship with the repo

Out:
- Arbitrary Pine v5 (no full language support) — we define a subset
  and reject unsupported constructs
- Dynamic evaluation (strategies are data, not code in this phase;
  backtest engine in Phase 6 consumes the parsed JSON)

### 4.3 Folder tree delta

```
services/control_plane/app/strategies/
├─ routes.py
├─ schemas.py
├─ parser/
│  ├─ pinescript.py                           # parse subset
│  ├─ ast.py                                  # canonical node types
│  ├─ lints.py
│  └─ templates/                              # 5 seed strategies
│     ├─ liquidity_sweep_reclaim.pine
│     ├─ ob_retest.pine
│     ├─ breakout_retest.pine
│     ├─ fvg_reaction.pine
│     └─ momentum_continuation.pine
└─ db/models/
   ├─ strategy.py
   └─ strategy_version.py

apps/web/app/strategies/
├─ page.tsx
├─ [id]/
│  ├─ page.tsx
│  ├─ versions/
│  │  ├─ page.tsx
│  │  ├─ new/page.tsx
│  │  └─ [vid]/page.tsx
```

### 4.4 DB DDL delta

- `strategies`
- `strategy_versions` (with `parsed jsonb`, `lints jsonb`, `sha256`)

### 4.5 API routes added

From §3.5:

- `GET/POST /v1/strategies`, `GET/PATCH/DELETE /v1/strategies/:id`
- `GET/POST /v1/strategies/:id/versions`
- `GET /v1/strategies/:id/versions/:vid`
- `POST /v1/strategies/:id/versions/:vid/parse`

### 4.6 UI pages added

- `/strategies`, `/strategies/[id]`, versions list, versions/new,
  version detail (with AST + lints rendered)

### 4.7 Test strategy

- Parser: 30 fixture files covering accepted + rejected constructs
- Lint: per-rule positive + negative cases
- Idempotency: same source → same AST SHA256
- UI: MSW smoke on paste → parse → preview flow

### 4.8 Exit criteria

- [ ] All 5 template strategies parse clean with zero lints
- [ ] One deliberately bad sample triggers every lint category at
       least once
- [ ] `v2.4.0` tag + HANDOFF

### 4.9 Rollback

Drop migrations; remove routes; UI pages degrade to stubs.

---

## Phase 5 — Manual decisions + signal timelines

**Tag at completion:** `v2.5.0`
**Branch:** `phase-5-manual-decisions`
**Estimated PRs:** 4

### 5.1 Goal

Let operators approve, reject, or size-adjust a signal **manually**.
Persist every decision (`signal_decisions`) and expose a full
decision + execution timeline per signal. This is the "human in the
loop" baseline before the AI brain ships in Phase 10.

### 5.2 Scope

In:
- `signal_decisions` table + routes
- `POST /v1/signals/:id/manual_decide`
- Full `/v1/signals/:id/timeline` implementation
- UI: decision pane in `/signals/[id]`; manual approve / reject
  buttons with reason capture
- Event bus: publish `signals.decided.v1` / `signals.rejected.v1`
- Stub page: `/signals/missed`

### 5.3 Folder tree delta

```
services/control_plane/app/signals/
├─ decisions.py                               # CRUD + publish
└─ timeline.py                                # aggregates receipt, signal,
                                              #   decision, orders, fills

services/control_plane/app/db/models/
└─ signal_decision.py

apps/web/app/signals/[id]/
├─ page.tsx                                   # decision pane added
└─ timeline/page.tsx                          # optional deep-link view
```

### 5.4 DB DDL delta

- `signal_decisions` + indexes on `signal_id` and `decided_by, decided_at`

### 5.5 API routes added

- `POST /v1/signals/:id/manual_decide`
- `GET /v1/signals/:id/timeline` (full)

### 5.6 Event bus topics

- `signals.decided.v1`, `signals.rejected.v1`

### 5.7 Test strategy

- RBAC: viewer cannot decide; operator can
- Idempotency: duplicate decision with same `idempotency_key` is a
  no-op
- Timeline: decisions + stubbed orders render in causation order;
  correlation_id consistent across hops

### 5.8 Exit criteria

- [ ] Operator can approve a signal from `/signals/:id`; decision
       persists; timeline shows the event
- [ ] Downstream SSE clients see `signal.decided` with correct payload
- [ ] `v2.5.0` tag + HANDOFF

---

## Phase 6 — Backtest runner + SLOs

**Tag at completion:** `v2.6.0`
**Branch:** `phase-6-backtests-slos`
**Estimated PRs:** 7

### 6.1 Goal

Ship `services/backtest_runner` that consumes a parsed strategy +
historical bar data + L2 replay (where available), runs it with a
realistic fill/slippage model, and emits metrics. In parallel, lock
in the full SLO + burn-rate dashboard and a k6 load baseline against
the full ingestion → SSE path.

### 6.2 Scope

In:
- Backtest runner: queue-based worker; one run per worker; artifact
  upload to S3/minio; metrics + equity + trade CSVs
- Slippage models: flat, spread-based, `calibrated_v3` (pluggable;
  real calibration lands in Phase 8)
- Fill models: `close_of_bar`, `open_next_bar`, `l2_replay`
- Monte-carlo stress suite
- Run compare view
- SLOs: define every SLO in YAML; burn-rate alarms; `/ops/slo` pages
- k6 baseline scenario under `tests/load/`

### 6.3 Folder tree delta

```
services/backtest_runner/
├─ app/
│  ├─ main.py
│  ├─ worker.py                               # SQS consumer
│  ├─ engine/
│  │  ├─ runner.py
│  │  ├─ bars.py
│  │  ├─ fills.py
│  │  ├─ slippage.py
│  │  └─ metrics.py
│  ├─ stress/
│  │  └─ monte_carlo.py
│  └─ db/models/
│     ├─ backtest_run.py
│     └─ backtest_metric.py
├─ alembic/versions/001_backtests.py
└─ Dockerfile

services/control_plane/app/ops/
├─ slo.py                                     # /v1/ops/slo/*
└─ latency.py                                 # /v1/ops/latency/*

ops/slo/
├─ slo-catalog.yml                            # every SLO defined here
└─ burn-alerts.yml

tests/load/
├─ k6-webhook-sse.js
└─ README.md

apps/web/app/
├─ backtests/
│  ├─ page.tsx, new/page.tsx, [id]/page.tsx, [id]/trades/page.tsx,
│  ├─ [id]/logs/page.tsx, stress/page.tsx, compare/page.tsx
└─ ops/
   ├─ slo/page.tsx
   ├─ latency/page.tsx
   └─ events/page.tsx
```

### 6.4 DB DDL delta

- `backtest_runs`, `backtest_metrics`

### 6.5 API routes added

§3.6 complete (`/v1/backtests/*`) + §3.13 SLO / latency / events stream

### 6.6 Event bus topics

- `backtests.completed.v1`

### 6.7 Test strategy

- Engine: deterministic run against a fixture strategy + fixture bars
  → exact expected metrics
- Stress: monte-carlo with seeded RNG produces reproducible distributions
- SLO: burn-rate computation validated against synthetic error windows
- k6: baseline numbers captured, committed as the perf floor

### 6.8 SLOs defined (initial catalog)

| SLO                                              | Target   | Window |
|--------------------------------------------------|----------|--------|
| Webhook → SSE latency p95                         | < 500 ms | 28 d   |
| Webhook ingestion availability                    | 99.9 %   | 28 d   |
| Backtest kick → start worker                      | < 10 s   | 28 d   |
| Control plane API p95                             | < 250 ms | 28 d   |
| Event bus end-to-end lag p95                      | < 1 s    | 28 d   |
| Order submit → broker ACK p95 (Phase 7 onward)    | < 300 ms | 28 d   |

### 6.9 Exit criteria

- [ ] A run against `liquidity_sweep_reclaim` over 2-year ES data
       completes in < 3 min with metrics + equity + trades persisted
- [ ] `/ops/slo` shows all 6 SLOs with fresh burn rate
- [ ] k6 baseline committed; CI comparison gate fails on > 20 %
       regression
- [ ] `v2.6.0` tag + HANDOFF

### 6.10 Rollback

Drop backtest_runner service; SLO pages go to stub. Alerts stay
disabled until re-enabled.

---

## Phase 7 — Execution + risk + broker integration

**Tag at completion:** `v2.7.0`
**Branch:** `phase-7-execution`
**Estimated PRs:** 8

### 7.1 Goal

Ship `services/execution` that converts approved decisions into
broker orders, tracks fills, maintains positions, enforces risk
budgets, and honors the kill switch. **This is the first phase that
can move real money.** `execution_enabled` feature flag ships OFF;
a subsequent ops-only change flips it on after stress-testing.

### 7.2 Scope

In:
- Broker adapter (Alpaca first; interface allows IBKR/Tradier later)
- Order, fill, position persistence
- Bracket orders (entry + SL + TP) as one logical unit
- Idempotency on `idempotency_key`
- Risk engine: exposure, concentration, daily loss cap, per-strategy
  caps, kill switch
- Execution consumes `signals.decided.v1` only when
  `execution_enabled=true` **and** kill switch is released
- Full `/execution/*` UI pages
- `system.killswitch.engaged.v1` / `released.v1` bus topics

Out:
- Multi-broker fan-out (one broker per env for now)
- Partial-fill advanced slicing (adds in later phase if needed)

### 7.3 Folder tree delta

```
services/execution/
├─ app/
│  ├─ main.py
│  ├─ broker/
│  │  ├─ base.py                              # abstract
│  │  ├─ alpaca.py                            # concrete
│  │  └─ simulated.py                         # for paper / dev
│  ├─ orders/
│  │  ├─ routes.py, service.py, schemas.py
│  │  └─ bracket.py
│  ├─ fills/
│  │  └─ reconcile.py                         # broker fill events → DB
│  ├─ positions/
│  │  └─ service.py
│  ├─ risk/
│  │  ├─ budgets.py
│  │  ├─ engine.py                            # deterministic gates
│  │  └─ killswitch.py
│  └─ db/models/
│     ├─ order.py, fill.py, position.py
├─ alembic/versions/001_execution.py
└─ Dockerfile

apps/web/app/execution/
├─ orders/page.tsx, [id]/page.tsx
├─ fills/page.tsx
├─ positions/page.tsx, [symbol]/page.tsx
├─ risk/page.tsx, budgets/page.tsx
└─ killswitch/page.tsx
```

### 7.4 DB DDL delta

- `orders`, `fills`, `positions` + appropriate indexes

### 7.5 API routes added

§3.7 complete.

### 7.6 Event bus topics

- `orders.created.v1`, `orders.filled.v1`, `orders.canceled.v1`,
  `orders.modified.v1`, `positions.updated.v1`
- `system.killswitch.engaged.v1`, `system.killswitch.released.v1`

### 7.7 Test strategy

- Unit: risk engine gates (exposure, daily loss, concentration,
  per-strategy cap, kill switch) each tested with positive + negative
- Simulated broker: end-to-end bracket place → fill → position update
- Idempotency: same `idempotency_key` returns same order; second call
  is a no-op
- Kill switch: engaged → new order request returns 503 with
  `service_unavailable`; existing orders unaffected; position is not
  auto-flattened
- Reconciliation: broker-side partial fills applied within 500 ms

### 7.8 AWS notes (prod path, lands in Phase 13)

- Execution service pinned to Multi-AZ with `desired_count >= 2`
- Broker credentials in Secrets Manager
- `killswitch` state in Redis with TTL

### 7.9 Exit criteria

- [ ] Paper trading loop: a simulated decision places a bracket,
       gets filled, updates position — all visible in UI within 1 s
- [ ] Kill switch engagement blocks new orders within 100 ms
- [ ] Risk budgets enforced: synthetic over-cap order returns
       `precondition` with clear reason
- [ ] `execution_enabled=false` by default; flipping it on triggers
       an audit log row and a `system.killswitch.released.v1`-adjacent
       operator alert
- [ ] `v2.7.0` tag + HANDOFF

### 7.10 Rollback

Set `execution_enabled=false`; scale execution service to zero.
Existing positions can be manually flattened via broker UI if needed.
Migrations are non-destructive.

### 7.11 PR breakdown

1. Execution skeleton + broker abstract + simulated broker
2. Alpaca adapter + credentials wiring
3. Orders CRUD + bracket logic + idempotency
4. Fills reconciliation + positions service
5. Risk engine + kill switch
6. Execution UI pages (orders, fills, positions, risk)
7. Kill switch + risk budgets pages + event wiring
8. k6 scenario for order path + HANDOFF

---

## Phase 0–7 roll-up

| Phase | Tag     | Pages added | Services live                     | Tables added |
|-------|---------|-------------|-----------------------------------|--------------|
| 0     | v2.0.0  | 6 + 62 stubs| control_plane, web               | 7            |
| 1     | v2.1.0  | 4           | +                                | 0            |
| 2     | v2.2.0  | 7           | + ingestion                      | 4            |
| 3     | v2.3.0  | 3           | + orderflow + screenshot_renderer| 2            |
| 4     | v2.4.0  | 5           | +                                | 2            |
| 5     | v2.5.0  | 2           | +                                | 1            |
| 6     | v2.6.0  | 8           | + backtest_runner                | 2            |
| 7     | v2.7.0  | 10          | + execution                      | 3            |

By `v2.7.0` the system can ingest a webhook, expose it to an operator
who can manually approve it, place a bracketed order to a broker,
track fills and positions, and enforce deterministic risk gates —
while a backtest runner lets analysts validate strategies against
historical data.

Phase 8 onward (next document) adds calibration, promotion,
intelligence agents, memory/recall, replay, infrastructure hardening,
and CI/integration-test finalization to reach the full v3+ vision.

**End of PHASES_0_TO_7.md**
