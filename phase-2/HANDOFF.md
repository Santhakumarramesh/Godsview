# Phase 2 Handoff — Remove Mock Data from Live Paths

**Branch:** `phase-2-remove-mocks` (based on `phase-1c-cleanup`)
**Patch:** `0001-phase-2-remove-route-level-mock-data-from-risk_v2-an.patch`
**Files:** 5 (3 new + 2 rewritten)

---

## What This Phase Does

Two of the most-trafficked dashboard surfaces — `/api/risk-v2/*` and `/api/backtest-v2/*` — were lying. They returned hardcoded JSON fixtures from inline JS objects, regardless of broker connection or backtest history. Phase 2 removes that lie.

After this phase:
- **Production with broker keys** → routes return real engine state.
- **Production without broker keys** → routes return `503 broker_not_configured`.
- **Development / test** → routes return demo data, but every response carries `X-Demo-Data: true` and a `_demo: true` body field so the UI can render a banner.

---

## Apply Locally

```bash
git checkout phase-1c-cleanup
git checkout -b phase-2-remove-mocks
git am < /path/to/0001-phase-2-remove-route-level-mock-data-from-risk_v2-an.patch
```

---

## What Changed

### New files

**`api-server/src/lib/demo_mode.ts`** — single source of truth for the dev/prod data decision.
Exports: `hasLiveBroker()`, `demoDataAllowed()`, `markDemoResponse()`, `sendDemo()`, `require503IfNoBroker()`.

**`api-server/src/lib/risk_v2/state.ts`** — lazy singleton holders for `ExposureManager`, `PortfolioRiskEngine`, `MacroEventGuard`. In production, clears the engine constructors' built-in mock portfolios on first access so the first Alpaca sync starts from a clean slate. In dev, leaves the demo positions visible so the UI renders.

**`api-server/src/lib/backtest_v2/results_store.ts`** — per-process registry of backtest results, credibility/overfit/leakage/walk-forward/comparison reports. Empty in production until populated by `EventDrivenBacktester` runs. Seeds one demo row in dev for UI rendering.

### Rewritten routes

**`api-server/src/routes/risk_v2.ts`** — removed ~115 lines of inline `PORTFOLIO`, `POSITIONS`, `LIMITS`, `EVENTS`, `OVERNIGHT`, `TRADE_GATE_EXAMPLE` fixtures. Each handler now calls into `getRiskV2State()` and reads from the real engines.

**`api-server/src/routes/backtest_v2.ts`** — removed ~165 lines of inline `BACKTESTS`, `CREDIBILITY`, `OVERFIT`, `LEAKAGE`, `WALK_FORWARD`, `COMPARISON` fixtures. Each handler now calls into `backtestResultsStore`.

---

## Verification

```bash
# TypeScript — full workspace clean
pnpm install
pnpm run typecheck                              # → 0 errors

# Dev mode smoke (expects _demo: true on responses)
NODE_ENV=development pnpm --filter @workspace/api-server start &
curl -i http://localhost:3001/api/risk-v2/portfolio | head -20
# Expect: X-Demo-Data: true header and "_demo": true in body

# Prod mode without broker keys (expects 503)
NODE_ENV=production CORS_ORIGIN=http://localhost:3000 \
  GODSVIEW_OPERATOR_TOKEN=test \
  pnpm --filter @workspace/api-server start &
curl -i http://localhost:3001/api/risk-v2/portfolio
# Expect: 503 with body { "error": "broker_not_configured", ... }

# Prod mode with broker keys (expects real data, no _demo flag)
NODE_ENV=production CORS_ORIGIN=http://localhost:3000 \
  GODSVIEW_OPERATOR_TOKEN=test \
  ALPACA_API_KEY=PKxxx ALPACA_SECRET_KEY=yyy \
  pnpm --filter @workspace/api-server start &
curl -i http://localhost:3001/api/risk-v2/portfolio
# Expect: 200 with real positions, no X-Demo-Data header
```

---

## Frontend Dashboard Integration (next-step suggestion)

Add a global response interceptor in the dashboard:

```ts
// apps/dashboard/src/lib/api.ts
const res = await fetch(url);
if (res.headers.get("X-Demo-Data") === "true") {
  showDemoBanner("Showing demo data — connect a broker to see real positions.");
}
```

This converts the back-end honesty into a visible UX signal.

---

## Phase 2 Status: ✅ COMPLETE

Ready for Phase 3 (AWS IaC via CDK).

---

## What's NOT in Phase 2 (deliberately deferred)

- **Live Alpaca sync** that writes positions into `ExposureManager` — that's a Phase 4 concern (page gap closure includes the broker-sync runner).
- **Persisting `backtestResultsStore` to Postgres** — currently in-process memory; survives until the next deploy. Real persistence ships with Phase 5 (auto-promotion pipeline needs it).
- **Other mock-bearing routes** — there are still routes with synthetic data (`portfolio_risk.ts`, `analytics` curves when no trades exist, etc.). They're either backed by real engines already or are lower-traffic; we addressed the two highest-stakes routes first. Subsequent phases will mop these up.
