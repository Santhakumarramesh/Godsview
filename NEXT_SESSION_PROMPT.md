# GodsView — Drive to 100% Production-Ready & Live

Paste this entire file as the first message of a new chat.

---

## Mission

Continue work on **GodsView** (https://github.com/Santhakumarramesh/Godsview) until the system is **production-ready and live**, with:

1. The **Brain Float UI** rendering and interactive in the dashboard
2. The **engine** booting clean and running end-to-end (signal → fit gate → setup → execution → fill → PnL on screen)
3. The **backtest** flow at 100% (prompt input → backtest run → results displayed)
4. The **Chrome extension** installed and capturing TradingView signals into the system
5. **All MCPs working** (TradingView MCP, market data, broker, etc.) with health green
6. **Every button** in the dashboard wired and proven to do what it claims

The previous session shipped 30 platform phases (56-90), but an honest review put real production-readiness at **82%, not 96%**. The gap is verified end-to-end behavior, not more code primitives.

## Current State (HEAD: `12ddf21`, branch `main`)

- Local: `/sessions/serene-sleepy-babbage/mnt/Godsview/`
- Staging: `/tmp/gv-work` (rsync target for typecheck)
- Stack: pnpm monorepo, TypeScript 5.9.3, Express 5, drizzle-orm, pino logger
- Workspaces (10): api-server, godsview-dashboard, mockup-sandbox, scripts, etc.
- Typecheck: `pnpm -r run typecheck` is green across all 10 workspaces.
- Pushed 30 commits this session covering: Observability, Multi-Tenant, Marketplace, Chaos, Launch Readiness, SLO, Audit, Feature Flags, Lineage, Capacity, DR, Cost, Incident, Release, DevPlatform, Notifications, Privacy, Risk, ML, Workflow, Mesh, EventSourcing, Search, PubSub, Jobs, Cache, KB+RAG, Bandit, Reporting, Anomaly, Portfolio Optimizer, Tax, OrderBook L2, News, Self-Heal.

## What "Production Ready & Live" Means — Acceptance Criteria

These are the gates. The session is not done until every one is checked off.

### A. Build & Boot
- [ ] `pnpm install` clean from a fresh `node_modules`
- [ ] `pnpm -r run build` clean across all workspaces
- [ ] `pnpm -r run typecheck` clean
- [ ] `pnpm -r run test` clean (or vitest equivalent)
- [ ] `pnpm --filter api-server run dev` boots, all routes register, no crashes for 10 min idle
- [ ] `pnpm --filter godsview-dashboard run dev` serves the dashboard, no console errors

### B. Engine Startup
- [ ] api-server starts persistent fill reconciler
- [ ] Drawdown breaker is armed and reports state via `/api/ops/v2`
- [ ] Circuit breakers initialized and reachable
- [ ] Production observability heartbeat firing
- [ ] All Phase 56-90 routers respond to a smoke `curl` per route family
- [ ] Health endpoints return green: `/api/health`, `/api/engine_health`, `/api/observability/health`

### C. Brain Float UI
- [ ] Dashboard route for "Brain Float" loads without errors
- [ ] Nodes render — one per watchlist symbol — with live size/color/glow
- [ ] Click a node → drill-down panel opens with structure, order flow, AI reasoning, recall matches
- [ ] Replay control reachable
- [ ] Portfolio/risk heatmap reachable

### D. Engine End-to-End Flow (paper, no real money)
- [ ] Submit a TradingView-style signal via `/tv-webhook` or MCP
- [ ] Signal hits structure engine → order flow engine → fusion engine → setup detection
- [ ] AI reasoning produces decision with confidence
- [ ] Risk engine gates approve (or block, with reason)
- [ ] Order placed via Alpaca paper account
- [ ] Fill arrives → persistent reconciler matches → PnL updates → dashboard tile updates
- [ ] Audit trail records the full chain (verifyChain returns valid)
- [ ] Trade journal reflects the trade

### E. Backtest Flow at 100%
- [ ] User enters a backtest prompt in the UI (strategy + symbol + window)
- [ ] api-server runs the backtest (Python v2 microservice or in-process)
- [ ] Results return: equity curve, drawdown, Sharpe, win rate, profit factor, MAE/MFE
- [ ] Walk-forward stress test runs and surfaces overfit detection (Phase 51-55 modules)
- [ ] Side-by-side comparison vs prior runs renders in UI
- [ ] Promote-to-paper button is wired (governor / promotion pipeline)

### F. Chrome Extension
- [ ] Built in `chrome-extension/` (create if missing)
- [ ] Manifest v3 with TradingView host permissions
- [ ] Content script reads chart context (symbol, timeframe, drawn levels)
- [ ] Background service worker posts to GodsView MCP webhook (`/tv-webhook`)
- [ ] Popup shows: server connection status, last signal sent, GodsView decision
- [ ] Bidirectional sync: GodsView annotations render back onto TradingView
- [ ] Signed and packaged as a `.crx` in `dist/` so the user can sideload it
- [ ] README in `chrome-extension/` with install instructions

### G. MCP Servers
- [ ] TradingView MCP server runs and accepts webhooks
- [ ] Market data MCP (or Alpaca direct) connected
- [ ] Broker MCP connected, paper trading mode
- [ ] Optional: news MCP, calendar MCP
- [ ] All MCPs report green via `/api/mesh/services` (Phase 76 service mesh)
- [ ] An MCP outage triggers the right circuit breaker + alert (verified)

### H. Button-Level QA
For every primary button in the dashboard:
- [ ] Renders enabled when it should
- [ ] Disables when it shouldn't fire (auth, state, risk-blocked)
- [ ] Click triggers the right API call
- [ ] Loading + success + error states all render
- [ ] Confirmation dialogs on destructive actions (kill switch, abort launch)
- [ ] Maintain a `BUTTON_QA.md` with a row per button: route, expected effect, verified ✅/❌

### I. Failure & Recovery Proof
- [ ] Kill the WebSocket mid-fill → reconciler recovers, no orphan orders
- [ ] Drop the database connection for 30s → engine survives, queues operations
- [ ] Trip the daily loss breaker → all new orders blocked, kill switch reachable
- [ ] Replay a known historical fill stream → backtest matches live within tolerance
- [ ] Chaos drill: run Phase 59 dependency_failure scenario and confirm graceful degradation

## Working Rules (carry over from last session)

- **Save locally AND in repo. Sync each phase.** Local edits go to `/sessions/.../mnt/Godsview/`, then `rsync` to `/tmp/gv-work` for typecheck, then `git add` + `commit` + `push` per phase.
- **Commit per phase** with email `santhar1500@gmail.com`, name `santhakumarramesh`. One `git push origin main` per phase.
- **Run `pnpm --filter api-server run typecheck` after every change.** Don't move on with errors.
- **Don't claim production-ready until each acceptance criterion in this file is verifiably ✅.** Inspectable evidence > commit messages.
- **Continue autonomously.** Don't wait for the advisor between phases. Work in 2-4 hour bursts.
- **Maintain `PRODUCTION_READINESS_SCORECARD.md`** at the repo root with the 8 categories (Execution, Risk, Observability, Governance, UI, ML, Memory, Broker Integration) and update it after every meaningful change.

## Suggested First-Hour Plan

1. Pull origin/main, confirm HEAD is `12ddf21` or newer
2. `pnpm install` from clean and verify `pnpm -r run typecheck` is still green
3. Try to `pnpm --filter api-server run dev` → fix anything that prevents boot
4. Try to `pnpm --filter godsview-dashboard run dev` → fix anything that prevents render
5. Open the dashboard in a browser, click every primary button, log what works and what doesn't into `BUTTON_QA.md`
6. Generate `PRODUCTION_READINESS_SCORECARD.md` with current state per category
7. Pick the lowest-scoring category and start closing the gap

Target order (lowest-trust gaps first): Broker Integration → Engine E2E → Brain Float UI → Backtest Flow → Chrome Extension → MCP Connectivity → Button QA → Chaos Drill.

## Don't

- Don't ship more isolated lib modules that aren't wired into a verified flow
- Don't claim a higher production-readiness number than the scorecard supports
- Don't skip the chaos / failure proofs — those are the trust gap

## Do

- Do prove things end-to-end with a screenshot, a curl trace, or a passing test
- Do update `PRODUCTION_READINESS_SCORECARD.md` after every phase
- Do keep commits small and atomic — one verifiable thing per commit
- Do call out the moment a category hits 100% with evidence

---

**Start by reading this file, then `git pull`, then run the first-hour plan.**
