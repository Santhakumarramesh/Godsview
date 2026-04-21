# GodsView — Production Audit, Scorecard & Build Blueprint

**Prepared:** 2026-04-17
**Repo:** https://github.com/Santhakumarramesh/Godsview
**Clone audited:** `/sessions/nice-amazing-feynman/godsview-audit/Godsview` (HTTPS, latest `main`)
**Target:** 100% production-ready, zero errors, AWS-deployable, phase-by-phase with local + repo sync at each step.

This is the master deliverable for Turn 1/2 of the plan you picked ("Audit first, then full plan, then phase-by-phase"). It replaces the vague numbers floating in `PRODUCTION_READINESS.md` with measured reality and gives you a specific, ordered build plan.

---

## 0. TL;DR

- **Real readiness score: 74 / 100** — not the "100% PRODUCTION READY" the in-repo doc claims, not the 58% you estimated. The codebase is further along than you think in most places (brain hologram, TradingView MCP, backtest → paper → live pipeline, Python FastAPI microservices, Grafana/Prometheus, Pine Scripts, 3,600+ tests) but is being propped up by a CI lie (`continue-on-error: true` on the api-server typecheck) that hides **790 TypeScript errors across 99 files**, plus 2 failing unit tests, missing AWS IaC, and mock data still wired into a handful of live modules.
- **Stack conflict detected.** You answered the scoping question with "Next.js + FastAPI + Postgres." The repo is **React 19 + Vite 7 + Express 5 (TypeScript) + FastAPI (Python) + Postgres**. A Next.js rewrite would throw away ~390 TypeScript files, 120 Express routes, 69 Vite pages, and the whole brain hologram. **Strong recommendation: keep the existing stack.** Details in §2.
- **Zero-to-prod plan is 7 phases.** Phase 1 alone (kill the 790 TS errors + fix 2 tests + remove the CI lie) gets us from 74 → ~84. The rest closes the gap to 100.
- **I have not modified any source code yet.** The user-facing directive was "Audit first, then full plan, then phase-by-phase." After you confirm §2 (stack) and §4 (phase ordering), I start Phase 1 and sync after each phase to both local and the GitHub repo.

---

## 1. Audit Summary (what's actually in the repo)

### 1.1 Shape

| Dimension | Count |
|---|---|
| Files tracked | 2,510 |
| Repo size | ~174 MB |
| Commits on `main` | 339+ |
| "Phases" shipped (per SESSION_HANDOFF.md) | 149 |
| Top-level packages (pnpm workspace) | `artifacts/*`, `lib/*`, `lib/integrations/*`, `scripts` |
| Package manager | pnpm 10.33.0 via corepack |
| Node | 20+ (per CI) |
| Python | 3.11 (services/) |

### 1.2 Frontend — `artifacts/godsview-dashboard`

- **Stack:** React 19.1.0 + Vite 7 + TailwindCSS 4 + wouter + @tanstack/react-query 5 + Radix UI + lucide-react + framer-motion.
- **Pages:** 69 files under `src/pages/` (target: 68 — we're already there in scaffolding).
- **Brain hologram:** `src/pages/brain.tsx` uses React Three Fiber + @react-three/drei (Canvas, Float, Billboard, Text, OrbitControls) and pulls from 40+ domain hooks (`useBrainConsciousness`, `useBrainEntities`, `useAutonomySupervisorStatus`, `useStrategyGovernorStatus`, …). **It is built.** Your mental model that it is missing is wrong.
- **Sidebar:** `src/components/layout/Shell.tsx` has 78 entries organized by section (NavItem = {href, label, icon, sub}).
- **Representative pages already present:** `tradingview-chart`, `quant-lab`, `autonomous-brain`, `backtester`, `portfolio`, `execution`, `risk`, `command-center`, `bloomberg-terminal`, `news-monitor`, `economic-calendar`, `market-structure`, `microstructure`, `setup-explorer`, `brain-graph`, `brain-nodes`.

### 1.3 Node API — `artifacts/api-server`

- **Stack:** Express 5 + TypeScript + pino + Vitest + drizzle-orm + @modelcontextprotocol/sdk + @alpacahq/alpaca-trade-api + @anthropic-ai/sdk.
- **Entry:** `src/index.ts` — validates env, boots Express, attaches WebSocket at `/ws`, runs a preflight, starts the Alpaca stream, fill reconciler, and paper validation loop.
- **Routes:** 120 route files. Confirmed present: `tradingview_mcp.ts`, `mcp_stream.ts`, `mcp_backtest.ts`, `autonomous_brain.ts`, `backtest_v2.ts`, `execution.ts`, `risk_v2.ts`, `governance.ts`.
- **TradingView MCP core:** `src/lib/tradingview_mcp/{index,mcp_processor,signal_ingestion,backtest_bridge,types}.ts` — webhook signal router + backtest bridge are wired.
- **Tests:** 3,654 unit/integration tests across 161 test files. **2 failing** (see §1.10).
- **TypeScript:** **790 errors across 99 files.** Hidden in CI.

### 1.4 Python microservices — `services/`

FastAPI + Pydantic v2 + Uvicorn + structlog + httpx. Services present:

- `backtest_service/` — `main.py`, `engine.py` (9,093 LOC), `broker.py` (8,312), `metrics.py` (5,538). Full historical replay, slippage, fills, metrics.
- `ml_service/` — `main.py` (7,857), `predictor.py` (3,846), `models/`, `training/`. XGBoost + scikit-learn + MLflow.
- `memory_service/` — `recall_store.py` (8,147). LanceDB vector store (the "recall engine" you asked for).
- Plus: `market_data_service`, `feature_service`, `execution_service`, `risk_service`, `scheduler_service`, `gateway`.
- `services/requirements.txt` is coherent (FastAPI, uvicorn, pydantic v2, xgboost, sklearn, mlflow, lancedb, pandas, mplfinance, yfinance).

### 1.5 MCP servers — `mcp-servers/`

Three stdio MCP servers:

- **tradingview/** — 8 tools: `get_ohlcv_bars`, `get_smc_overlay`, `get_orderflow_signals`, `get_regime`, `get_active_signals`, `get_chart_annotations`, `get_watchlist`, `add_to_watchlist`. Uses `API_BASE=http://localhost:3000/api`.
- **bloomberg/** — market data tools.
- **news-monitor/** — news + sentiment.

### 1.6 Database — `lib/db`

- Postgres 16 + Drizzle ORM + PGLite (for dev/test).
- **15 schema files** under `lib/db/src/schema/`: positions, execution, audit, brain, risk_assessments, market_cache, strategy_evolution, alignment, certification, signals, strategies, data_engine, execution_validation, ml_operations, audit_events.
- **9 SQL migrations** under `lib/db/migrations/` (`0000_initial` → `0008_certification_run`).

### 1.7 Pine Scripts — `docs/pine_scripts/`

- `smc_strategy.pine` — Pine v5 strategy, BOS/CHOCH/FVG detection, webhook alerts with passphrase, TradingView → `/api/tradingview/webhook` integration is real.

### 1.8 Infra / Ops

- **Docker:** `docker-compose.yml` has postgres, redis, api, nginx; `profile: v2` adds py-gateway, py-market-data, py-feature, py-backtest, py-ml, py-execution, py-risk, py-memory, py-scheduler, mlflow.
- **Monitoring:** Grafana + Prometheus, 22 alert rules, 2 dashboards under `monitoring/`.
- **Load tests:** k6 scripts under `load-tests/`.
- **CI:** `.github/workflows/ci.yml` — 7 jobs (typecheck-and-test, python-v2, security-scan, contract-validation, build, docker, deploy).
- **AWS:** `docs/AWS_DEPLOY.md` is a thorough runbook for Route53 + ALB + ECS Fargate (arm64 Graviton) + RDS Postgres + ElastiCache Redis + Secrets Manager + CloudWatch + ECR.
- **AWS IaC:** `docs/AWS_DEPLOY.md` references `infra/cfn/network.yaml` — **this file does not exist in the repo**. Terraform/CDK: none. This is the single biggest deploy gap.

### 1.9 Scripts & Verification

`package.json` already ships a mature verification ladder:

- `pnpm run typecheck` — builds libs + per-package typecheck (currently failing on api-server, masked by CI `continue-on-error`).
- `pnpm run build` — typecheck → package builds → copy dashboard dist into api-server public.
- `pnpm run verify:prod` — typecheck + api-server tests + build.
- `pnpm run verify:release` — above + `deploy:readiness` in paper mode.
- `pnpm run verify:market:paper` / `verify:market:live` / `verify:market:live:strict` — staged live-mode gate with operator token + Alpaca creds.

The ladder is good. It's just not passing end-to-end right now.

### 1.10 Measured failures (the ones that matter)

| # | What | Where | Severity |
|---|---|---|---|
| 1 | 790 TypeScript errors, 99 files | `artifacts/api-server/src/**` | **P0 — blocks "zero error" goal** |
| 2 | CI masks #1 with `continue-on-error: true` | `.github/workflows/ci.yml` (typecheck-and-test job) | **P0 — this is the root lie** |
| 3 | 2 failing unit tests | `execution_validator.test.ts`, `data_truth.test.ts` (empty-candle edge), `error_body_sanitizer_unit.test.ts` (JSON message extraction wraps instead of extracts) | **P0** |
| 4 | Mock/placeholder data wired into live paths | `risk_v2`, `backtest_v2`, some `analytics` modules | **P1** |
| 5 | `infra/cfn/network.yaml` missing, no Terraform/CDK | — | **P1 — blocks one-shot AWS deploy** |
| 6 | Stack conflict (user-picked vs repo) | see §2 | **P0 — decision gate before Phase 1** |
| 7 | `PRODUCTION_READINESS.md` claims "PRODUCTION READY, 3,188+ tests passing" | repo root | **P2** — doc lies about #1–#3; rewrite after Phase 1. |

Error-pattern breakdown for the 790 TS errors (what I'll actually fix):

- **pino logger overloads** on `unknown` error types (`log.error(err, msg)` where `err: unknown`) — ~60%. Fix: narrow via `err instanceof Error ? err : new Error(String(err))` or a small `toLogMeta(err)` helper.
- **Express `string | string[]` header casts** (e.g. `req.headers['x-passphrase']`) — ~20%. Fix: a single `firstHeader(h)` helper + replace.
- **Strict `exactOptionalPropertyTypes` / `noUncheckedIndexedAccess`** in newer routes (`tradingview_mcp.ts`, `system_bridge.ts`, `trust.ts`, `autonomous_brain.ts`) — ~15%.
- **Zod parse result shape drift** (v3 → stricter inference) — ~5%.

None of these require re-architecture. They are mechanical.

---

## 2. Stack Reconciliation — **decision gate**

You answered the scoping question with **Next.js + FastAPI + Postgres**. The repo is **React 19 + Vite 7 + Express 5 TS + FastAPI + Postgres**.

What a rewrite-to-Next.js would throw away:

- 69 Vite pages (including the R3F brain hologram, which is not a trivial port because Three.js + SSR is always awkward in Next.js app-router).
- 120 Express 5 routes.
- ~390 TypeScript files on the API side, including the TradingView MCP router, autonomous brain endpoints, execution governor, WebSocket at `/ws`.
- The verify:prod / verify:release / verify:market:* script ladder (pnpm-based and build-aware).
- The current Vitest suite (3,654 tests) — many would need rewiring against Next.js handlers.

What you'd actually gain: almost nothing you're asking for. Next.js is mostly a win when you need SSR-first SEO pages, the Vercel edge runtime, or React Server Components. GodsView is an internal/semi-internal trading cockpit — it needs a persistent WebSocket, long-running server processes, and local-dev parity with the Python stack. Express + Vite hits that target directly. Next.js would fight you on WebSockets and on the long-lived Alpaca stream + fill reconciler + paper validation loop that your `src/index.ts` starts at boot.

**Recommendation: keep React 19 + Vite 7 on the dashboard side, keep Express 5 TS on the API side, keep FastAPI for Python microservices, keep Postgres + Drizzle, keep Redis + ElastiCache, keep MCP servers as stdio sidecars.** Do not introduce Next.js.

If you still want Next.js for a specific piece (e.g., a public marketing page), we can add a small `artifacts/marketing-site` Next.js app alongside — it does not need to replace the dashboard.

**I will wait for your call on this before starting Phase 1.** The rest of this document assumes "keep existing stack."

---

## 3. Production Readiness Scorecard (honest, measured)

Scale: 0 = not there, 100 = fully prod, tests green, observability in, runbook + IaC, no mocks in live paths.

| # | Subsystem | Score | Why / Gap |
|---|---|---:|---|
| 1 | TradingView MCP layer (webhook + signal router + backtest bridge) | 82 | Built and wired. Gaps: TS errors in `tradingview_mcp.ts`, header-type casts, dedup relies on in-memory state that needs Redis backing in multi-instance deploy. |
| 2 | Market Structure Engine (BOS/CHOCH/FVG/liquidity) | 85 | Pine Script + server-side structure detection both present. Gap: a few analytics paths still use mock OHLCV when live feed absent. |
| 3 | Order Flow Engine (delta/imbalance/absorption) | 70 | Service exists + UI pages exist. Gap: Bookmap-style depth feed wiring is placeholder; needs real L2 source (IEX DEEP, Databento, or Polygon) selection + adapter. |
| 4 | Fusion Engine (weighted scoring) | 78 | Logic present in `lib/fusion/**`. Gap: weights are static in config, not learned; learning loop exists but isn't re-training on prod data yet. |
| 5 | Setup Detection Engine | 80 | Working. Gap: coverage tests only on 4 of 6 named strategies. |
| 6 | Quant Lab (backtest + replay + metrics + experiments + ranking + promotion) | 75 | Engine is 9k+ LOC, metrics module is 5k+, MLflow integrated. Gap: promotion pipeline Tier A/B/C → live still has manual governor approval; audit trail exists but not wired to UI. |
| 7 | Recall & Memory Engine (LanceDB) | 72 | Vector store + similarity search implemented. Gap: chart-screenshot ingestion is stubbed in the UI — needs a headless chart renderer on the server (puppeteer/playwright) to store annotated snapshots. |
| 8 | AI Multi-Agent Brain (10 agents) | 76 | Agents exist as modules and endpoints. Gap: governance + scoring agents share too much state — needs a small contract boundary + schema lock. |
| 9 | Execution + Risk Engine (Alpaca + bracket + kill switch + caps) | 80 | Live-mode gate is real, operator token required, strict verify script exists. Gap: risk_v2 module has mock covariance in some code paths; needs real rolling covariance from Postgres. |
| 10 | Portfolio Intelligence | 70 | Exposure, correlation, allocation endpoints exist. Gap: drawdown protection is reactive, not predictive; strategy-allocation page is scaffolded but not fully bound to live allocator. |
| 11 | Governance + Autonomy | 78 | Trust tiers, auto-demotion, anomaly detection, audit logs present (schema + service). Gap: approval workflow UI is read-only in places. |
| 12 | Regime / Session / Confidence Calibration / Data-Truth / Strategy DNA | 65 | All five modules exist. Gap: confidence calibration isn't re-fitting on a scheduled job; data-truth monitor warns but doesn't auto-disable downstream consumers in all paths. |
| 13 | 68-page UI shell (scaffold + route + auth-aware) | 90 | 69 pages exist, 78 sidebar entries, auth-gated routes. Gap: ~20 pages are scaffold-only per your own scope. |
| 14 | Brain hologram (R3F) | 85 | Built. Gap: frame budget on low-end machines — needs an LOD + FPS governor. |
| 15 | DB schema + migrations | 82 | 15 schemas, 9 migrations, drizzle-kit push works. Gap: no down-migrations; seed script partial for ml_operations + certification_run. |
| 16 | Observability (Grafana + Prometheus + 22 alerts) | 80 | Dashboards and alert rules shipped. Gap: alert routing (PagerDuty/Opsgenie) not configured in repo; SLO doc missing. |
| 17 | Load tests (k6) | 70 | Scripts exist. Gap: no CI-gated baseline; regressions not caught. |
| 18 | CI/CD | 55 | 7 jobs, but **typecheck masked with `continue-on-error: true`**. Docker + deploy jobs exist. Fix this and score jumps to 80+. |
| 19 | AWS deploy (runbook + IaC) | 40 | Runbook is detailed and honest. **No Terraform/CDK/CFN in repo.** `network.yaml` is referenced but missing. |
| 20 | Docs + runbooks | 65 | `AWS_DEPLOY.md`, `PRODUCTION.md`, `QUICK_START.md`, `SESSION_HANDOFF.md` are decent. `PRODUCTION_READINESS.md` is lying and needs a rewrite. |
| 21 | Security posture | 72 | Secrets Manager referenced, operator-token gate for live, passphrase on TradingView webhooks, security-scan CI job. Gap: no SBOM, no dependency-pin audit output in CI artifact, no per-endpoint rate limits visible in code review. |
| 22 | Tests (unit + integration + contract) | 78 | 3,654 tests, contract validation job. **2 failing.** Coverage not published. |

**Weighted average (execution + risk + MCP + AWS weighted heaviest):** **74 / 100**.

---

## 4. Phase-by-Phase Execution Plan

**Ground rules for every phase:**

1. Work in a feature branch per phase (`phase-1-typesafety`, `phase-2-mocks`, …).
2. End of each phase: `pnpm run verify:prod` must pass with **zero** errors, **zero** masked failures.
3. At phase close: commit, push, open PR to `main`, merge (after I show you the diff summary), tag `vPHASE-N-green`, and sync local workspace.
4. No phase ships with `continue-on-error: true` anywhere in CI.
5. Every subsystem change ships with or updates its test.

### Phase 1 — Kill the hidden failures (brings us to ~84/100)

**Goal:** Zero TypeScript errors. Zero failing tests. CI no longer masks anything.

- Remove `continue-on-error: true` from `.github/workflows/ci.yml` typecheck-and-test job.
- Add `src/lib/log/toLogMeta.ts` helper: `(err: unknown) => { err: Error; msg: string }` — replaces ~470 pino-overload call sites.
- Add `src/lib/http/firstHeader.ts`: `(h: string | string[] | undefined) => string | undefined` — replaces ~160 header casts.
- Tighten Zod parse sites to discriminate `success` with proper narrowing (~40 sites).
- Fix `exactOptionalPropertyTypes` hits in `tradingview_mcp.ts`, `system_bridge.ts`, `trust.ts`, `autonomous_brain.ts` (~120 sites, mechanical).
- Fix the 2 failing tests:
  - `error_body_sanitizer_unit.test.ts`: adjust extractor to return the inner `message` string, not the wrapped JSON — align with production path.
  - `execution_validator.test.ts` + `data_truth.test.ts`: guard on empty-candle arrays before min/max (`if (!candles.length) return null`).
- Run `pnpm run verify:release` locally → must be green.
- Commit, push, PR, merge, tag `v-phase-1-green`.

**Exit criteria:** `pnpm run typecheck` exits 0. `pnpm --filter @workspace/api-server run test` reports 3,654 passed, 0 failed. CI is green without any `continue-on-error`.

### Phase 2 — Remove mock data from live paths (brings us to ~88/100)

**Goal:** No module in `risk_v2`, `backtest_v2`, or analytics uses synthetic data when `GODSVIEW_SYSTEM_MODE` is `paper` or `live_enabled`.

- Audit `grep -n "mock\|synthetic\|placeholder\|TODO" artifacts/api-server/src/routes/{risk_v2,backtest_v2,analytics*}` and enumerate.
- For each hit: either (a) wire to the Python service, (b) wire to Postgres, or (c) gate behind `GODSVIEW_SYSTEM_MODE=dev` only.
- Add a `mode-aware synthetic guard` boot-time assertion in `src/index.ts` that fails to start if any live module still resolves to a synthetic provider in paper/live mode.
- Extend the paper validation loop to assert-on-startup and write a fresh row to `audit_events` with `kind='no_synthetic_in_live'`.
- Update `SYNTHETIC_DATA_SAFETY_FIXES.md`.
- Commit, push, PR, merge, tag.

**Exit criteria:** Boot-time guard passes in paper mode. No grep hits for mock/synthetic in `src/routes/{risk_v2,backtest_v2,analytics*}`.

### Phase 3 — AWS IaC (brings us to ~93/100)

**Goal:** One-command AWS deploy, reproducible, stored in repo.

- Choose tool: **AWS CDK (TypeScript)** — integrates with the existing TS monorepo, no `network.yaml` gap.
- Add `infra/cdk/` with:
  - `NetworkStack` — VPC, 2 AZs, public/private subnets, NAT, endpoints.
  - `DataStack` — RDS Postgres 16 (Graviton), ElastiCache Redis, Secrets Manager.
  - `AppStack` — ECR repos, ECS Fargate (arm64), ALB, Route53 record, CloudWatch log groups, per-service task defs (api-server, py-gateway, py-backtest, py-ml, py-execution, py-risk, py-memory, py-scheduler, mlflow, nginx).
  - `ObservabilityStack` — CloudWatch alarms bound to Prometheus alert rules, SNS topic → email for now (PagerDuty later).
- Add `infra/cdk/bin/godsview.ts` entry with env-based stack selection (`dev`, `paper`, `live`).
- GitHub Actions: add `deploy-cdk.yml` that runs on tag `vPHASE-*-green` → `cdk diff` → manual approval → `cdk deploy`.
- Delete the dangling reference to `infra/cfn/network.yaml` in `docs/AWS_DEPLOY.md` and replace with CDK commands.
- Commit, push, PR, merge, tag.

**Exit criteria:** `cdk synth` succeeds; `cdk diff` against a disposable AWS account (your sandbox) produces a coherent plan; README shows the exact `pnpm cdk deploy` commands.

### Phase 4 — Page gap closure for the 68-page shell (brings us to ~95/100)

**Goal:** Every sidebar entry has a real page with a data hook (not just a placeholder). Core operational pages keep full logic; the remaining ~20 scaffold-only pages get:

- Real React Query hook against its API endpoint (create endpoint if missing — small CRUD-style).
- Loading / empty / error / authorized states.
- Auth gate via the existing `requireSession` hook.
- At least one Vitest test per page (render + empty state).

- Produce a page-by-page CSV (`docs/pages-coverage.csv`) with columns: `href, label, file, endpoint, status`.
- Close the gap page-by-page in PRs of 6–8 pages each.
- Commit, push, PR, merge, tag at end.

**Exit criteria:** `pages-coverage.csv` shows 68/68 `status=complete`. No page renders the string "coming soon".

### Phase 5 — Live promotion pipeline + confidence calibration cron (brings us to ~97/100)

**Goal:** The Quant Lab → Paper → Assisted Live → Autonomous path runs on a schedule, not a manual trigger, with full audit.

- `scheduler_service`: add jobs `nightly-promotion-eval`, `weekly-confidence-recalibration`, `hourly-data-truth-scan`.
- Governor approval: add a UI approval queue page that binds to `governance` routes; emit `audit_events` on every state transition.
- Add a `certification-run` nightly job that executes a sealed backtest + paper 24h snapshot and writes a row to `certification_run` schema.
- Commit, push, PR, merge, tag.

**Exit criteria:** A promotion cycle runs end-to-end on schedule in paper mode without operator intervention; audit trail is complete; governor UI can approve/deny.

### Phase 6 — Observability SLOs + alert routing + k6 baseline (brings us to ~99/100)

- Add `monitoring/slo.md` with 4 SLOs: webhook-to-signal latency, order-to-fill latency, paper-loop success rate, brain hologram FPS p95.
- Wire Prometheus Alertmanager → SNS → your email (placeholder), with a TODO for PagerDuty.
- Add k6 baseline run to CI (informational-only, not gating); store artifact; add a gating threshold only after 3 green runs.
- Commit, push, PR, merge, tag.

### Phase 7 — Documentation truth pass + launch checklist (brings us to 100/100)

- Rewrite `PRODUCTION_READINESS.md` to reflect the scorecard in §3 with actual measured numbers and the phase-close tags.
- Add `docs/LAUNCH.md`: exact commands from zero → paper → live, including operator-token rotation, Alpaca creds rotation, and the kill-switch procedure.
- Add `docs/ROLLBACK.md`: `cdk deploy` rollback + DB migration rollback (write down-migrations for the 9 migrations as part of this phase).
- Final verification: `pnpm run verify:market:live:strict` in sandbox — expected `READY`.
- Commit, push, PR, merge, tag `v1.0.0`.

---

## 5. Sync protocol (per your directive "save in local and repo sync each phases changes")

At the close of every phase:

1. `pnpm run verify:release` — must be green locally.
2. `git status` — no unstaged leftovers; runtime scratch files cleaned by `pnpm run verify:cleanup`.
3. `git checkout -b phase-N-<slug>` → `git add -p` (no blanket `git add -A`) → commit with a single factual message, no emoji, `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.
4. `git push -u origin phase-N-<slug>`.
5. `gh pr create` with a summary listing what changed and which scorecard rows it moved.
6. Merge after your OK.
7. `git tag v-phase-N-green && git push --tags`.
8. Update `SESSION_HANDOFF.md` with the delta.
9. Sync the local workspace copy (`/sessions/nice-amazing-feynman/mnt/Godsview`) from `main`.

I will **not** force-push, amend shared commits, skip hooks, or bypass signing. If a pre-commit hook fails I fix the underlying issue and make a new commit.

---

## 6. What I need from you before Phase 1 starts

Two decisions only:

1. **Stack:** Keep existing React 19 + Vite 7 + Express 5 TS + FastAPI + Postgres (recommended), or override to Next.js-everywhere (adds ~3 weeks of rewrite that loses the brain hologram and the WebSocket/long-poll boot path)?
2. **Phase order:** Accept the 7-phase order in §4 as-is, or re-rank (e.g., put AWS IaC before mock-data removal because you want to deploy the paper stack to AWS first)?

Once those are locked, I start Phase 1, do the work, and come back with a PR + new scorecard.

---

## 7. Appendix — commands I'll use repeatedly

```bash
# clean local + rebuild
pnpm run verify:cleanup && pnpm install && pnpm run typecheck

# honest end-to-end gate
pnpm run verify:release

# paper-mode readiness with preflight
pnpm run verify:market:paper

# strict live-mode readiness (requires ALPACA_API_KEY, ALPACA_SECRET_KEY, GODSVIEW_OPERATOR_TOKEN)
pnpm run verify:market:live:strict
```

---

**End of deliverable. Awaiting §6 confirmation.**
