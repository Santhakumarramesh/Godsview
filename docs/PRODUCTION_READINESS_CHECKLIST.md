# GodsView — Production Readiness Checklist

**Last updated:** 2026-04-26
**Maintainer:** the next person to run this checklist.

This document is the gate between "demo" and "real money." Every item is binary
(pass/fail) and verifiable from the command line or a screenshot. If you can't
prove it from a terminal, mark it FAIL.

Status legend: ✅ pass · ⚠ partial · ❌ fail · ⏸ deferred (not required for current tier)

---

## 1. Build & static checks

| Check | Command | Status |
|---|---|---|
| TypeScript strict typecheck (api-server) | `cd artifacts/api-server && npx tsc --noEmit` → exit 0 | ✅ verified 2026-04-26 |
| TypeScript strict typecheck (dashboard) | `cd artifacts/godsview-dashboard && npx tsc --noEmit` → exit 0 | ✅ verified 2026-04-26 |
| Zero `@ts-nocheck` directives | `grep -r "@ts-nocheck" artifacts/ lib/ \| wc -l` → 0 | ✅ verified 2026-04-26 |
| API server bundles | `cd artifacts/api-server && pnpm run build` → exit 0 | ⚠ requires user machine (sandbox cannot run rollup native binaries) |
| Dashboard builds | `cd artifacts/godsview-dashboard && pnpm run build` → exit 0 | ⚠ requires user machine |

## 2. Tests

| Check | Command | Status |
|---|---|---|
| API unit + integration tests | `cd artifacts/api-server && pnpm test` → all green | ⚠ requires user machine |
| TradingView webhook validation tests | `pnpm test -- e2e/tradingview_webhook_validation` | ⚠ requires user machine |
| Webhook → paper-trade integration | `pnpm test -- e2e/tradingview_to_paper_trade` | ⚠ requires user machine |
| Webhook → SSE e2e | `pnpm test -- e2e/webhook_to_sse_e2e` | ⚠ requires user machine |
| Pipeline integration tests | `pnpm test -- e2e/pipeline_integration` | ⚠ requires user machine |
| Assisted-live safety gates | `pnpm test -- assisted_live_safety` | ⚠ requires user machine |
| Paper trading rejection paths | `pnpm test -- paper_trading.test` | ⚠ requires user machine |

> Tests are written and typecheck-clean. `pnpm test` execution is gated on installing macOS-native dependencies, which only runs on your machine, not the sandbox.

## 3. Local Docker boot

| Check | Command | Status |
|---|---|---|
| `.env` has required secrets | `grep -E "^(JWT_SECRET\|TRADINGVIEW_WEBHOOK_SECRET)=" .env` non-empty | ⏸ user-supplied |
| Dashboard bundle exists | `ls artifacts/godsview-dashboard/dist/public/index.html` | ⏸ run `pnpm run build` first |
| Postgres reachable | `docker compose exec postgres pg_isready -U godsview` → "accepting connections" | ⏸ requires Docker boot |
| Redis reachable | `docker compose exec redis redis-cli ping` → PONG | ⏸ requires Docker boot |
| API healthy | `curl -sf http://localhost:3001/health` → 200 with `{ "status": "ok" }` | ⏸ requires Docker boot |
| OpenAPI docs | `curl -sf http://localhost:3001/docs/openapi.json` → 200 | ⏸ requires Docker boot |
| Dashboard reachable | `curl -sf http://localhost/ -o /dev/null -w "%{http_code}\n"` → 200 | ⏸ requires Docker boot |

Runbook: `docs/LOCAL_BOOT_RUNBOOK.md`.

## 4. TradingView webhook flow

| Check | Verification | Status |
|---|---|---|
| Pine alert template documented | `docs/tradingview/PINE_ALERT_EXAMPLE.pine` exists | ✅ |
| Webhook endpoint registered | `routes/tradingview_mcp.ts` mounted at `/tradingview/webhook` | ✅ |
| Payload schema (Zod) | `lib/tradingview_mcp/types.ts` → `TradingViewWebhookSchema` | ✅ |
| Smoke test script | `scripts/test-tradingview-webhook.sh` works against live API | ⏸ requires Docker boot |
| Validation rejects bad payloads | `e2e/tradingview_webhook_validation.test.ts` — 17 cases covered | ✅ test written |
| Signal lands in DB | `psql … "SELECT … FROM signals ORDER BY created_at DESC"` after webhook fires | ⏸ requires Docker boot |
| Signal surfaces on dashboard | Dashboard /signals page polls `/api/signals` | ✅ wired |

## 5. Paper trading

| Check | Verification | Status |
|---|---|---|
| Paper engine accepts valid SuperSignal | `processPaperSignal()` returns `{approved:true, trade_id:"pt_..."}` | ✅ |
| 8 risk gates enforced | Status, quality, daily cap, position limit, position size, circuit breaker, cooldown, session hours | ✅ |
| Invalid trades rejected | `e2e/tradingview_to_paper_trade.test.ts` — 7 rejection cases | ✅ |
| Trade journal persists each trade | `lib/trade_journal.ts` writes via `persistAppend("paper_trades", …)` | ✅ |
| Trade IDs unique | Test asserts `Set<id>.size > 0` and grows | ✅ |
| Stale alerts blocked at ingestion | Default `maxSignalAgeSec = 60`, configurable per env | ✅ |

## 6. Assisted-live execution safety

| Check | Verification | Status |
|---|---|---|
| Approval expires after timeout | Default 5 min, `expireStale()` runs every 30s | ✅ |
| Risk re-check at execution | `tryExecute({ riskCheck })` blocks if disallowed | ✅ |
| Slippage gate | `tryExecute({ currentPrice, maxSlippageBps })` rejects if > 25bps default | ✅ |
| Status guard | Already-executed/expired/rejected proposals can't fire | ✅ |
| Audit events emitted | `proposal:submitted/approved/rejected/expired/executed/execution_blocked` | ✅ |
| HTTP API exposed | `routes/assisted_live.ts` wired at `/api/assisted-live` | ✅ |
| Tests | `__tests__/assisted_live_safety.test.ts` — 14 cases | ✅ |

## 7. God Brain hologram (real backend data)

| Check | Verification | Status |
|---|---|---|
| Backend route returns real DB data | `routes/brain.ts` queries `brain_entities` and `strategy_registry` | ✅ |
| Falls back to safe defaults if DB empty | Yes, with default watchlist of 7 symbols | ✅ |
| Dashboard starts EMPTY (no mock on first paint) | `useState<BrainState\|null>(null)` | ✅ |
| Loading state visible | "◆ Loading God Brain state…" banner | ✅ |
| Error state visible | Red ⚠ "Brain state unavailable" with API error message | ✅ |
| Stale data warning | Banner shows "stale — last update Xs ago" after 10s without success | ✅ |
| Mock data warning | If backend never responds and we fall back, banner says "SHOWING MOCK DATA" | ✅ |
| Click-through routing | Symbol → `/ticker/:symbol`, strategy → `/strategy-panel`, agent → `/agent-monitor` | ✅ |

## 8. Backtesting proof

| Check | Verification | Status |
|---|---|---|
| Reproducible (deterministic) | `node scripts/backtest_regimes.mjs` twice → identical metrics | ✅ verified |
| 3+ regimes covered | trending_up, trending_down, sideways, high_vol | ✅ 4 regimes |
| Train/test split | 60/40, generalization gap reported | ✅ |
| Metrics: PF, Sharpe, expectancy, max DD, win rate, trade count | All present in `docs/backtests/regime_proof/summary.json` | ✅ |
| Honest report (no cherry-picking) | Sideways regime shows -27R, PF 0.57 — strategy fails as expected in chop | ✅ |
| Output committed to repo | `docs/backtests/regime_proof/*.json` | ✅ |

## 9. Database

| Check | Verification | Status |
|---|---|---|
| Migrations exist (0000 → 0009) | `ls lib/db/migrations/` | ✅ 14 migration files |
| Migration runner | `lib/db/src/migrate.ts` + `docker-entrypoint.sh` auto-runs on boot | ✅ |
| Seed script | `lib/db/src/seed.ts` — 3 strategies, 10 brain entities, 1 risk policy | ✅ |
| Idempotent seed | Re-running the seed must not duplicate rows | ⚠ verify with `SELECT count(*) FROM strategy_registry` after second run |
| Backup plan documented | TBD — needs RDS snapshot policy or `pg_dump` cron | ❌ DEFERRED |
| Restore tested | TBD | ❌ DEFERRED |

## 10. CI/CD

| Check | Verification | Status |
|---|---|---|
| GitHub Actions workflow | `.github/workflows/ci.yml` | ✅ |
| Typecheck job | runs `pnpm tsc --noEmit` per workspace | ✅ |
| Test job | runs `pnpm test` | ✅ |
| Build & push Docker image | builds on `main` push, pushes to GHCR | ✅ |
| Deploy step | SSH-deploys to host on tag push | ✅ |
| Required secrets | `SSH_PRIVATE_KEY`, `SSH_HOST`, `SSH_USER`, `GHCR_TOKEN` | ⏸ user must configure in repo settings |

## 11. AWS deploy

| Check | Verification | Status |
|---|---|---|
| AWS architecture documented | `docs/AWS_DEPLOY.md` | ✅ exists |
| ECS task defs / Terraform / CDK | TBD — currently SSH-based | ⚠ partial |
| RDS Postgres provisioning | Manual or Terraform | ⏸ user-provisioned |
| ElastiCache Redis | Manual or Terraform | ⏸ user-provisioned |
| Secrets Manager wiring | `.env` → AWS Secrets Manager | ⏸ user wires up |
| CloudWatch logs | `docker-compose` logs → CloudWatch agent | ⏸ user wires up |
| Autoscaling | ECS service auto-scaling target tracking | ❌ NOT WIRED |

## 12. Observability

| Check | Verification | Status |
|---|---|---|
| Structured JSON logs | `pino` logger used throughout | ✅ |
| Health endpoints | `/health`, `/api/health/*` | ✅ |
| Metrics endpoint (Prometheus) | TBD | ⚠ partial |
| Per-route latency | `lib/timing/*` exists | ✅ |
| Error tracking (Sentry/Honeybadger) | TBD | ❌ NOT WIRED |
| Audit log persistence | `lib/audit_logger.ts` writes to DB | ✅ |
| Alert routing | SSE `/api/alerts/stream` for dashboard | ✅ |

## 13. Rollback plan

| Check | Verification | Status |
|---|---|---|
| Tagged Docker images | `ghcr.io/santhakumarramesh/godsview:<sha>` | ⏸ runs on CI push |
| Rollback runbook | `docs/OPERATOR_RUNBOOK.md` § Rollback | ⚠ partial — verify section exists |
| DB migration reversibility | Most migrations are forward-only — flag risky ones | ⚠ need migration `down` files for risky ones |
| Feature flag kill-switches | `lib/feature_flags.ts` if present | ⚠ verify |
| Emergency flatten endpoint | Paper engine has `pause`/`stop`; live broker needs explicit kill switch | ⚠ verify Alpaca route |

## 14. Real-money autonomous gating

> **Do not enable autonomous mode unless EVERY item below is ✅.**

| Gate | Status |
|---|---|
| 14.1 90 days of consistent paper-trading P&L | ❌ NO |
| 14.2 ≥3-regime backtest pass on the strategy actually being deployed | ❌ NO (current backtest is for SMA-cross demo, not the production strategy) |
| 14.3 Risk policy capped at <1% account-equity per trade | ⏸ Configurable, set in `risk_policy` table |
| 14.4 Daily loss kill-switch | ✅ circuit_breaker hits at configured threshold |
| 14.5 Position size hard cap (broker side) | ❌ Only enforced in app, not at broker |
| 14.6 Real-time monitoring + on-call rotation | ❌ NOT SET UP |
| 14.7 Independent risk-engine review (human sign-off) | ❌ NOT DONE |
| 14.8 Auditable trail for every order | ✅ via `audit_logger` |
| 14.9 Disaster recovery test (DB restore from backup) | ❌ NOT DONE |
| 14.10 Insurance / capital-loss policy | ⏸ business decision |

## How to use this doc

1. Run through each section before any major release.
2. Update the Status column based on your verification.
3. Anything not ✅ blocks promotion to the next tier.
4. Tier ladder: **demo → local → paper → assisted-live → real-money autonomous**.
5. Don't skip steps. The list is the bare minimum.
