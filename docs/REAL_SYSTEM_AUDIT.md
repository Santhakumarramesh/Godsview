# GodsView — Real System Audit

**Date:** 2026-04-26
**Purpose:** Brutally honest catalogue of what is real, what is mock-with-fallback,
what is dev-only, and what blocks paid users / real-money trading. Used as the
source of truth for the VC presentation.

> **Rule for VC mode:** every page shown to the VC must be backed by a real
> API call against a real database. Mock fallbacks are allowed only if the
> page surfaces a banner saying so.

---

## A. REAL — backed by live code paths and persisted state

| Module | Backing | Notes |
|---|---|---|
| TradingView webhook ingestion | `routes/tradingview_mcp.ts` + `lib/tradingview_mcp/signal_ingestion.ts` | Zod validation, passphrase auth, dedupe, age check. 17 unit tests cover rejection paths. |
| Signal storage | Postgres `signals` table + `lib/signal_stream.ts` | Real DB writes via Drizzle. |
| Risk engine | `lib/risk_*` + `lib/circuit_breaker.ts` | Daily loss, position cap, exposure, cooldown, session hours. Real state, persisted to disk. |
| Paper trading engine | `engines/paper_trading_engine.ts` | 8 risk gates, persistent state via `lib/persistent_store.ts`. |
| Trade journal | `lib/trade_journal.ts` + DB tables | Every trade written. |
| Audit logger | `lib/audit_logger.ts` | DB-backed with file fallback. |
| Assisted-live approval queue | `lib/execution/assisted_live.ts` + `routes/assisted_live.ts` | Lifecycle, expiry, status guard, risk re-check, slippage gate. 14 tests. |
| God Brain entities | `routes/brain.ts` GET `/brain/state` | Pulls from `brain_entities` Postgres table; safe defaults if empty. |
| God Brain hologram (UI) | `pages/brain-hologram.tsx` | Empty initial state, explicit MOCK banner if backend unreachable. |
| Backtest engine | `lib/backtester.ts` + `lib/backtest_v2/` | Multiple implementations. SMA-cross regime backtest committed at `docs/backtests/regime_proof/`. |
| OpenAPI docs | `routes/docs.ts` | Live JSON. |
| Health endpoints | `routes/health.ts`, `routes/engine_health.ts` | Real liveness probes. |
| Database migrations | `lib/db/migrations/0000-0009*.sql` | 14 SQL files, runner via `migrate.ts`. |
| Database seed | `lib/db/src/seed.ts` | 3 strategies, 10 brain entities, 1 risk policy. |
| Docker stack | `docker-compose.yml` | postgres, redis, api, nginx + 9 python services. |
| CI/CD | `.github/workflows/ci.yml` | Typecheck → test → docker build → push → deploy. |

## B. MOCK FALLBACK — real path exists, fake data shown when backend is unavailable

These all need to surface a "MOCK DATA — backend unreachable" banner. Today only
the brain-hologram page does this.

| File | What's mocked | Status | Fix in this session |
|---|---|---|---|
| `pages/brain-hologram.tsx` | `MOCK_BRAIN_STATE` | ✅ Banner added | Done |
| `pages/brain.tsx` | `MOCK_STOCKS`, `MOCK_SUPREME` | ⚠ Falls back silently | Needs banner |
| `pages/correlation-lab.tsx` | `generateMockCorrelationMatrix()` | ⚠ Falls back silently | Needs banner |
| `pages/dom-depth.tsx` | "Using placeholder data" | ⚠ Visible message | OK as-is |
| `pages/heatmap-liquidity.tsx` | "Generate placeholder orderbook data when API returns empty" | ⚠ Silent | Needs banner |
| `components/brain-floating-panel.tsx` | `Math.random()` for latency / status flicker | ❌ Decorative animation, not real metrics | Replace or remove |
| `components/bookmap-heatmap.tsx` | Synthetic OHLCV with `Math.random()` | ❌ Looks like real heatmap | Wire to real depth feed or label |
| `components/ui/sidebar.tsx` | `Math.random()` for skeleton-loading width | ✅ Cosmetic only | OK |
| `components/NotificationSystem.tsx` | `Math.random()` for IDs | ✅ Just an ID source | OK |
| `hooks/useEventSource.ts` | `Math.random()` for jitter | ✅ Reconnect backoff jitter | OK |

## C. DEV-ONLY — explicitly not for VC or production

| File | Why | Action |
|---|---|---|
| `pages/bloomberg-terminal.tsx` | Demo aesthetics, no live wiring | Hide from sidebar in VC mode |
| `pages/economic-calendar.tsx` | No event API wired | Hide from sidebar in VC mode |
| `pages/candle-xray.tsx` | Synthetic candles | Hide from sidebar in VC mode |

## D. API-side `Math.random()` — needs categorization

`grep -l Math.random artifacts/api-server/src` returns ~75 files. Spot check:

- **Legitimate**: jitter for retries, ID generation, sampling for telemetry, dropout in ML models, monte-carlo in walk_forward. ~60 files.
- **Suspect**: `db_repository.ts`, `strategy_registry.ts`, `quant_lab_engine 2.ts`, `walk_forward_stress.ts` use `Math.random()` to generate sample/seed data when real history is missing. Needs labelling — every place that returns generated data should set a `synthetic: true` flag in the response so the dashboard can warn.
- **Unsafe for VC demo**: any path that fakes a fill price or P&L. None spotted in `paper_trading_engine.ts` itself; fills there come from `executeOrder()` which uses the entry price.

## E. Blockers before paid users (SaaS tier)

| Blocker | Why it matters |
|---|---|
| 1. Multi-tenant data isolation | Currently single-tenant; all tables share one `org_id` or none. |
| 2. Per-user broker credentials | Alpaca keys live in `.env`; need per-user Secrets Manager wiring. |
| 3. Rate limits per tenant | Global limiter only. |
| 4. Billing | Stripe / metering not present. |
| 5. RBAC enforced on all routes | Some routes have `requireAuth`, others don't (see `app.ts` 115-121). |
| 6. PII / GDPR posture | No data deletion endpoint, no export endpoint. |
| 7. Stripe-style webhook retry semantics | TradingView webhook is idempotent on dedupe key, but not user-scoped. |
| 8. SLA + uptime monitoring | CloudWatch agent / Datadog not wired. |
| 9. Documentation site | OpenAPI exists; no marketing site. |
| 10. T&Cs / EULA / disclaimers | None. |

## F. Blockers before real-money trading (autonomous tier)

| Blocker | Status |
|---|---|
| 1. ≥90 days of paper P&L on the production strategy | NO |
| 2. Backtest of production strategy across regimes | NO (current backtest uses SMA-cross demo) |
| 3. Broker-side position cap (Alpaca / IBKR side, not just app) | NO |
| 4. Daily loss kill-switch enforced at broker | PARTIAL (app side only) |
| 5. On-call rotation + alerting (PagerDuty) | NO |
| 6. Independent risk-engine review (human sign-off) | NO |
| 7. Disaster recovery test (DB snapshot restore) | NO |
| 8. Insurance / capital-loss policy | BUSINESS DECISION |
| 9. Broker compliance review | NO |
| 10. Legal review of autonomous-execution disclosure | NO |

## G. What changes in this session for VC mode

1. **Brain hologram** — already done: empty initial state, MOCK banner if fallback.
2. **Brain page (`brain.tsx`)** — banner added when falling back to `MOCK_STOCKS` / `MOCK_SUPREME`.
3. **`/api/system/status` endpoint** — new, returns API/DB/Redis/last-webhook/last-trade/last-rejection/brain-count/strategy-status/backtest/mode in one call.
4. **VC Mode page** — new `/vc-mode` route polling the status endpoint and showing real proof.
5. **`scripts/vc-proof-run.sh`** — boots stack, sends fake TV alert, verifies signal+trade+audit, prints PASS/FAIL.
6. **Mode badge** — the current execution mode is shown in the dashboard header so a VC always sees PAPER MODE.

## H. The honest answer to "is this real?"

- The **infrastructure is real**: Postgres tables, migrations, seed, audit logger, paper engine with 8 risk gates, webhook validator with 17 rejection cases, assisted-live with 3 safety gates.
- The **dashboard is mostly real**: most pages call real API endpoints; ~6 pages still have visible `Math.random()` decorative animations and a few have silent mock fallbacks (now flagged).
- The **end-to-end VC flow** (TradingView → signal → risk → paper trade → DB → audit → dashboard tile) wires existing real components together with no new mock.
- The **strategy logic is generic** (SMA-cross for the regime backtest). A real production strategy would be GodsView's proprietary work.

That's the line between "real prototype" and "demo theater" — and it's where this checklist puts the project today.
