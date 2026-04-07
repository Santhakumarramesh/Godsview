# GodsView — Continuation Brief

> Paste this document into a new Claude session to resume exactly where we left off.
> Last updated: Phase 121 (April 2026)

---

## What Is GodsView

GodsView is an AI-native trading operating system. It manages the complete strategy lifecycle from idea validation through autonomous execution with multi-layer intelligence, explicit safety gates, and full audit trails.

**Tech stack:** React 19 + Vite 7 (dashboard), Express 5 + TypeScript (API), PostgreSQL 16 (persistence), FastAPI (Python v2 microservices), Docker Compose (deployment), GitHub Actions (CI/CD).

**Repo:** `https://github.com/Santhakumarramesh/Godsview`

---

## Current State (Post Phase 121)

### Phase History

| Phase | What | Key Files |
|-------|------|-----------|
| 77-85 | Quant Super-Intelligence (9 subsystems) | `lib/super_intelligence*.ts`, `lib/ml_model.ts` |
| 86-88 | Decision Loop + Evaluation Layer | `lib/proof_engine.ts`, `lib/eval_*.ts` |
| 89 | Decision Intelligence Dashboard | 4 new dashboard pages |
| 90 | Integration & Unit Test Suite | 130+ tests in 6 files |
| 91 | System Integration + Ops Layer | `lib/ops/`, `lib/brain_orchestrator.ts` |
| 92 | Build Verification | Typecheck + 3,109 tests passing |
| 97-114 | Wire routes, dashboard pages, nav, API hooks | Route registration, page scaffolds |
| 115-117 | Ops Security, Paper Trading, Capital Gating | `lib/ops/capital_gating.ts`, `routes/ops_security.ts` |
| 118 | Production Hardening — scripts + docs | `scripts/clean-repo.sh`, `scripts/verify-phase.sh`, `docs/PERSISTENCE_BOUNDARIES.md` |
| 119 | Structured Logging | Replaced 90 `console.log` → pino `logger.info` across 14 files |
| 120 | Integration Tightening | Grouped sidebar nav (10 sections), Python v2 bridge (`routes/py_bridge.ts`), Docker profile |
| 121 | API Hardening | ZodError → 400 response, CSP + X-XSS-Protection headers |

### Codebase Metrics

| Metric | Value |
|--------|-------|
| TypeScript/TSX files | ~1,200 |
| Lines of code | ~382K |
| API route files | 68+ |
| Dashboard pages | 61 |
| Python microservices | 9 |
| Test files | 182 |
| Vitest tests | 3,109 |

### Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                        Nginx :80                        │
│           (reverse proxy + static dashboard)            │
├──────────────────────┬──────────────────────────────────┤
│   Dashboard (React)  │        API Server :3001          │
│   Vite SPA build     │   Express 5 + esbuild bundle    │
│   61 pages           │   68 route files                │
│   wouter router      │   pino structured logging       │
├──────────────────────┴──────────────────────────────────┤
│                    PostgreSQL :5432                      │
│              Drizzle ORM + migrations                   │
├─────────────────────────────────────────────────────────┤
│         Python v2 Microservices (--profile v2)          │
│   Gateway :8000 → Market Data :8001, Feature :8002,    │
│   Backtest :8003, ML :8004, Execution :8005,            │
│   Risk :8006, Memory :8007, Scheduler :8008             │
│   Redis (cache) + MLflow (experiment tracking)          │
└─────────────────────────────────────────────────────────┘
```

### Key Systems

1. **Intelligence Layers** — SMC, Order Flow, Regime Classifier, ML Ensemble, Sentiment, Microstructure
2. **Safety Guard Stack** — Kill Switch → Daily Loss Limit → Exposure Limit → Session Rules → Circuit Breaker
3. **Capital Gating** — 6-tier progression: Paper → Micro → Small → Standard → Full → Autonomous
4. **Paper Trading Program** — 4-phase 30-day certification before live trading
5. **Decision Loop** — Signal → Confluence → Risk Check → AI Veto → Execute → Audit

---

## Non-Negotiable Gates

Before any phase commit ships, it must pass `./scripts/verify-phase.sh`:

1. No secrets in tracked files
2. `.env` not tracked by git
3. `.gitignore` covers essentials
4. No merge conflict markers
5. `console.log` count < 20 (JSDoc examples exempt)
6. TODO/FIXME count < 50
7. `package.json` + `pnpm-lock.yaml` present
8. Critical files exist (Dockerfile, ci.yml, ARCHITECTURE.md, etc.)
9. TypeScript typecheck passes (skippable with `--quick`)
10. Test suite passes (skippable with `--quick`)

---

## File Boundaries (Source / State / Build)

See `docs/PERSISTENCE_BOUNDARIES.md` for the full decision tree. Quick reference:

- **SOURCE** (committed): `api-server/src/`, `artifacts/*/src/`, `lib/*/src/`, `services/`, `docs/`, `scripts/`
- **STATE** (gitignored): `.env`, `*_guard_state*.json`, PostgreSQL volume, ML models, logs
- **BUILD** (gitignored): `node_modules/`, `__pycache__/`, `*.tsbuildinfo`, Docker images
- **Exception**: `artifacts/*/dist/` is committed (pre-built deploy model)

---

## Docker Commands

```bash
# Node.js only (default)
docker compose up -d

# With Python v2 microservices
PY_SERVICES_ENABLED=true docker compose --profile v2 up -d

# Verify release readiness
pnpm verify:release

# Paper trading validation
pnpm verify:market:paper
```

---

## Dashboard Navigation (10 Sections)

Command · Intelligence · Signals & Data · Execution · Backtesting · Risk & Safety · Analytics · Operations · Governance · System

All 61 routes are registered in `App.tsx` and all have sidebar nav entries in `Shell.tsx`.

---

## What's Next (Phase 122+)

Remaining production hardening and Bloomberg-parity work:

1. **Test coverage for Phase 115-121 code** — New subsystems (capital gating, ops security, paper program, py_bridge) have no tests yet
2. **OpenAPI/Swagger documentation** — Auto-generate from Zod schemas in `lib/api-zod/`
3. **WebSocket consolidation** — Multiple SSE/WS patterns exist; unify into single real-time layer
4. **Python ↔ Node.js data contract** — Define shared types between the two stacks
5. **Database migrations** — Drizzle migration files need audit; some schema changes may be unapplied
6. **Monitoring dashboards** — Grafana JSON configs for the Prometheus metrics already being collected
7. **Load testing** — k6 or artillery scripts for API endpoints
8. **CI pipeline hardening** — Add Python v2 typecheck (mypy/pyright) to GitHub Actions

---

## Workflow Preferences

- **Phase numbering**: Sequential integers (Phase N, Phase N+1)
- **Commit style**: `Phase N: Title — short description\n\nBody with details.`
- **Verification**: Run `verify-phase.sh --quick` before every commit
- **Logging**: Use pino `logger` from `lib/logger.ts` — never `console.log`
- **New routes**: Register in `routes/index.ts` with phase comment
- **New pages**: Add to both `App.tsx` (lazy import + RoutedPage) and `Shell.tsx` (navSections)
- **Env vars**: Document in `.env.example` with section headers
- **Python services**: Use `--profile v2` in Docker; proxy via `/api/v2/*`

---

## Critical Files Quick Reference

| File | Purpose |
|------|---------|
| `api-server/src/app.ts` | Express app setup, middleware, error handler |
| `api-server/src/index.ts` | Server startup, subsystem boot, graceful shutdown |
| `api-server/src/routes/index.ts` | All route registration |
| `api-server/src/lib/logger.ts` | Pino logger (structured JSON) |
| `api-server/src/lib/runtime_config.ts` | Environment variable parsing + validation |
| `api-server/src/lib/request_guards.ts` | Rate limiter + security headers |
| `api-server/src/lib/shutdown.ts` | Graceful shutdown handler |
| `artifacts/godsview-dashboard/src/App.tsx` | React router (61 lazy-loaded pages) |
| `artifacts/godsview-dashboard/src/components/layout/Shell.tsx` | Sidebar nav (10 grouped sections) |
| `docker-compose.yml` | Production stack (Node.js default + Python v2 profile) |
| `scripts/verify-phase.sh` | 10-check commit gate |
| `scripts/clean-repo.sh` | Automated repo cleanup |
| `docs/PERSISTENCE_BOUNDARIES.md` | Source vs State vs Build decision tree |
| `docs/ARCHITECTURE.md` | Full module map and API contract |
| `docs/OPERATOR_RUNBOOK.md` | Operations procedures |
| `.env.example` | All environment variables documented |
