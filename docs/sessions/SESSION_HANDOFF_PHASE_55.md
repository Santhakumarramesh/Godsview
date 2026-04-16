# GodsView Session Handoff — Complete Through Phase 55

## Purpose
Use this document to brief the next Claude session on the complete state of GodsView implementation. Copy-paste this entire document as context for the new chat.

---

## 1. Primary Request and Intent
The user (Sakthi) is building GodsView, an AI-native trading operating system, directing implementation as principal engineer. The project follows the master blueprint defined in the project instructions (CLAUDE.md). Each session implements batches of 5 phases, tests them, then pushes to GitHub.

**The user's consistent workflow:**
- Say "next phase" → Claude designs and implements the next 5 phases
- Parallel agent execution for speed
- All tests must pass before push
- Save locally AND push to GitHub repo
- The user expects to continue with "next phase" (Phase 56+)

---

## 2. Repository Information
- **GitHub**: https://github.com/Santhakumarramesh/Godsview
- **PAT**: [REDACTED — configured in .git/config remote; rotate via github.com → Settings → Developer settings → Tokens]
- **Git config**: user.email "sri2sakthi49@gmail.com", user.name "Santhakumarramesh"
- **Latest commit**: `bf0c4af` on `main`
- **Tech stack**: pnpm monorepo, Express.js v5 + TypeScript API server, Vitest testing, React dashboard

---

## 3. Git Push Workflow (CRITICAL)
The local workspace at `/sessions/magical-modest-clarke/mnt/Godsview--Godsview` has permission issues with `.git` (mounted folder, can't modify .git internals). The established workflow:

1. Create files locally in the workspace
2. Clone fresh to `/tmp/godsview-push`: `git clone https://x-access-token:<PAT>@github.com/Santhakumarramesh/Godsview.git /tmp/godsview-push`
3. Copy new files to the clone
4. Wire routes into `routes/index.ts`
5. Set git config (email + name)
6. Stage, commit, push
7. Clean up: `rm -rf /tmp/godsview-push`

---

## 4. Code Patterns (MUST follow these exactly)

### File Structure per Phase
Each phase creates 4 files:
- `api-server/src/lib/<module_name>/<service_file>.ts` — Core logic
- `api-server/src/lib/<module_name>/index.ts` — Barrel export
- `api-server/src/routes/<module_name>.ts` — Express REST endpoints
- `api-server/src/__tests__/<module_name>.test.ts` — Vitest tests

### ID Generation
```typescript
import { randomUUID } from "crypto";
const id = `prefix_${randomUUID()}`;
```
Each module uses a unique semantic prefix (e.g., `dsl_`, `evt_`, `sub_`, `reg_`, `bt_`).

### Return Pattern
All API responses: `{ success: boolean; data?: T; error?: string }`

### Singleton Pattern
```typescript
class MyService {
  private store: Map<string, Thing> = new Map();
  // methods...
  _clearMyService() { this.store.clear(); }
}
const myService = new MyService();
export { myService };
export function doThing(...) { return myService.doThing(...); }
```

### Test Pattern
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('pino', () => ({ default: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) }));
vi.mock('pino-pretty', () => ({ default: vi.fn() }));

beforeEach(() => { _clearMyService(); });
```

### Route Wiring in `routes/index.ts`
```typescript
// ── Phase NN: Description ──────────────────────────────────────────
import myRouter from "./my_module";
router.use("/api/my-module", myRouter);  // Phase NN — Brief description
```

---

## 5. Complete Phase History (Phases 21-55)

### Commit `30e8769` — Phase 21-26: Assisted Live, Autonomy, Portfolio, Enterprise, God Brain, Terminal

### Commit `5ffcb3e` — Phase 27: Production Validation Backbone
- `api-server/src/lib/production_validation/` — Validation sessions, comparison, readiness scoring
- Route: `/api/validation`

### Commit `e4f4d73` — Phase 28-36: Production Hardening
| Phase | Module | Route | Description |
|-------|--------|-------|-------------|
| 28 | execution_ledger | /api/execution-ledger | Order lifecycle, reconciliation, mismatches |
| 29 | data_truth | /api/data-truth | Timestamp chains, quality checks, truth scores |
| 30 | shadow_canary | /api/shadow-canary | Shadow sessions, canary deployments |
| 31 | security_admin | /api/security | Secrets, operator auth, env validation |
| 32 | strategy_compiler | /api/strategy-compiler | NL to DSL compilation |
| 33 | macro_intelligence | /api/macro-intelligence | Economic events, lockouts, risk scoring |
| 34 | capital_control | /api/capital-control | Capital buckets, guardrails, allocation |
| 35 | recovery | /api/recovery | Recovery plans, incident drills, readiness |
| 36 | certification_gate | /api/certification-gate | Pre-production certification audit |

### Commit `92fc094` — Phase 37-45: Operational Intelligence
| Phase | Module | Route | ID Prefix | Tests |
|-------|--------|-------|-----------|-------|
| 37 | evidence_packet | /api/evidence-packets | ep_ | 33 |
| 38 | operator_dashboard | /api/operator | oa_, db_ | 30 |
| 39 | system_manifest | /api/manifest | — | 30 |
| 40 | deploy_pipeline | /api/deploy | rel_ | 35 |
| 41 | broker_adapter | /api/brokers | brk_ | 35 |
| 42 | exec_quality | /api/exec-quality | exec_ | 29 |
| 43 | news_pipeline | /api/news | news_, sig_ | 26 |
| 44 | portfolio_risk | /api/portfolio-risk | ra_, hdg_ | 34 |
| 45 | audit_trail | /api/audit | aud_, cr_, cv_ | 46 |

### Commit `ec673b4` — Phase 46-50: Reality Layer
| Phase | Module | Route | ID Prefix | Tests |
|-------|--------|-------|-----------|-------|
| 46 | exec_reconciliation | /api/reconciliation | recon_, rr_ | 38 |
| 47 | data_validator | /api/data-validator | feed_, tv_, xf_, dta_ | 46 |
| 48 | shadow_trading | /api/shadow-trading | ss_, st_, sc_ | 37 |
| 49 | failure_recovery | /api/failure-recovery | state_, rp_, drill_ | 42 |
| 50 | certification_v2 | /api/certification-v2 | cert_, cpol_ | 42 |

### Commit `bf0c4af` — Phase 51-55: Intelligence & Analysis Layer
| Phase | Module | Route | ID Prefix | Tests |
|-------|--------|-------|-----------|-------|
| 51 | strategy_dsl | /api/strategy-dsl | dsl_, tmpl_ | 52 |
| 52 | event_bus | /api/events | evt_, sub_, rule_, rpl_ | 57 |
| 53 | mtf_analysis | /api/mtf | mtf_, conf_, div_, tfcor_, scan_ | 47 |
| 54 | regime_detection | /api/regime | reg_, rtrans_, adapt_, ralert_, rmod_ | 46 |
| 55 | backtest_v2_engine | /api/backtest-v2-engine | bt_, wf_, mc_, stress_, stresst_ | 52 |

---

## 6. Detailed Phase 51-55 File Inventory

### Phase 51 — Strategy DSL Interpreter (52 tests)
- `lib/strategy_dsl/dsl_interpreter.ts` (653 lines) — ConditionOperator, LogicOperator, StrategyCondition, ConditionGroup, StrategyAction, RiskRule, StrategyFilter, StrategyDSL, ParsedStrategy. DslInterpreter class: parseStrategy, validateStrategy, evaluateCondition, evaluateConditionGroup, templates, cloning, SHA256 hashing.
- `lib/strategy_dsl/index.ts` (35 lines) — Barrel export
- `routes/strategy_dsl.ts` (446 lines) — 13 endpoints: POST /parse, POST /validate, GET /, GET /:id, PATCH /:id, DELETE /:id, POST /:id/clone, POST /templates, GET /templates, GET /templates/:name, POST /templates/:name/instantiate, POST /evaluate, POST /:id/indicators
- `__tests__/strategy_dsl.test.ts` (860 lines) — 52 tests

### Phase 52 — Real-Time Event Bus (57 tests)
- `lib/event_bus/event_bus_service.ts` (521 lines) — 12 EventChannels, EventPriority, EventStatus, SystemEvent, Subscription, EventRule, EventReplay, EventStats. EventBusService: publishEvent, dispatchEvent, subscribe, unsubscribe, rules, replay, stats, purge. Insertion-order based sorting.
- `lib/event_bus/index.ts` (1 line) — Barrel export
- `routes/event_bus.ts` (407 lines) — 18 endpoints
- `__tests__/event_bus.test.ts` (577 lines) — 57 tests

### Phase 53 — Multi-Timeframe Analysis Engine (47 tests)
- `lib/mtf_analysis/mtf_engine.ts` (644 lines) — 7 Timeframes (1m-1w), TrendDirection, SignalStrength. TimeframeAnalysis, ConfluenceSignal, MTFDivergence, TimeframeCorrelation, MTFScanResult. Trend: >0.5% bullish/bearish. Strength: >1% strong, >0.5% moderate, else weak.
- `lib/mtf_analysis/index.ts` (39 lines)
- `routes/mtf_analysis.ts` (593 lines) — 17 endpoints
- `__tests__/mtf_analysis.test.ts` (1146 lines) — 47 tests

### Phase 54 — Regime Detection Engine (46 tests)
- `lib/regime_detection/regime_engine.ts` (631 lines) — 8 RegimeTypes: trending_up/down, ranging, volatile, low_volatility, crisis, recovery, unknown. Detection logic: atr/avg_atr > 2.0 → crisis, > 1.5 → volatile, < 0.5 → low_volatility, price/SMA alignment → trending, near SMA → ranging. Auto-transition detection. Strategy adaptation recommendations. Alert system with acknowledgment. Model registry.
- `lib/regime_detection/index.ts` (39 lines)
- `routes/regime_detection.ts` (547 lines) — 20 endpoints
- `__tests__/regime_detection.test.ts` (825 lines) — 46 tests

### Phase 55 — Strategy Backtest Engine v2 (52 tests)
- `lib/backtest_v2_engine/backtest_engine.ts` (845 lines) — BacktestConfig, BacktestTrade, BacktestMetrics (15 metrics: Sharpe, Sortino, Calmar, max DD, win rate, profit factor, expectancy, recovery factor...). WalkForwardWindow + WalkForwardResult (verdict: robust/marginal/overfit). MonteCarloRun + MonteCarloResult (ruin probability, percentiles p5-p95, verdict: robust/acceptable/fragile). StressScenario + StressTestResult (impact_score, survival).
- `lib/backtest_v2_engine/index.ts` (34 lines)
- `routes/backtest_v2_engine.ts` (505 lines) — 16 endpoints
- `__tests__/backtest_v2_engine.test.ts` (1059 lines) — 52 tests

---

## 7. Bug Fixes Applied During This Session

### Regime Detection (Phase 54)
- **Bug**: `getLatestForSymbol()` was called AFTER the new snapshot was added to history, so it always returned the snapshot just added, preventing transition detection.
- **Fix**: Moved `getLatestForSymbol()` call BEFORE adding new snapshot to history array.
- **Bug**: Volatile regime confidence formula `(ratio - 1.0) / 1.5` gave scores too low for the "high" threshold.
- **Fix**: Changed to `(ratio - 1.0) / 0.7` for proper scaling.

### Backtest Engine v2 (Phase 55)
- **Bug**: Walk-forward efficiency_ratio could be negative when IS and OOS returns have opposite signs.
- **Fix**: Used `Math.abs()` and clamped to [0, 2].
- **Bug**: Stats test expected pending > 0 but all backtests were run/cancelled.
- **Fix**: Changed test to check total_backtests = 3.

### MTF Analysis (Phase 53)
- **Bug**: Test candles had 2-4% price changes, classified as "strong" but tests expected "moderate".
- **Fix**: Adjusted test candle values to 0.5-1% range for moderate classification.

### Event Bus (Phase 52)
- **Bug**: Events created in same millisecond had identical timestamps, breaking sort stability.
- **Fix**: Changed sort to use insertion-order index instead of timestamp comparison.

---

## 8. Running Totals

| Metric | Value |
|--------|-------|
| Phases implemented (this track) | 21-55 (35 phases) |
| Total files (Phases 37-55) | ~80 files |
| Total lines (Phases 37-55) | ~30,000+ lines |
| Tests passing (Phases 37-55) | ~764 tests |
| REST endpoints (Phases 37-55) | ~260+ endpoints |
| Latest commit | `bf0c4af` |

---

## 9. What Comes Next (Phase 56+)

The next logical phases should continue building out the Intelligence & Analysis layer or move into the Network/Collaboration layer. Possible directions:

**Option A: Advanced Strategy Pipeline (Phases 56-60)**
- Phase 56 — Parameter Optimization Engine (grid search, Bayesian, genetic)
- Phase 57 — Strategy Correlation & Portfolio Optimizer
- Phase 58 — Live Signal Generation Pipeline
- Phase 59 — Order Management System (OMS) v2
- Phase 60 — Execution Simulator & Slippage Model

**Option B: Operator Experience Layer (Phases 56-60)**
- Phase 56 — WebSocket Real-Time Dashboard Streaming
- Phase 57 — Notification & Alert Delivery System
- Phase 58 — Operator Command Center API
- Phase 59 — Strategy Comparison & A/B Testing
- Phase 60 — System Health Dashboard API

**Option C: Network & Collaboration (Phases 56-60)**
- Phase 56 — Trader Profile & Identity System
- Phase 57 — Strategy Sharing & Marketplace
- Phase 58 — Collaborative Research Workspace
- Phase 59 — Signal Subscription System
- Phase 60 — Reputation & Verification Engine

The user typically says "next phase" and lets Claude decide the direction based on what builds the most value on top of existing infrastructure.

---

## 10. Key Technical Notes

- **Vitest** with `vite:oxc` transform — fast, but test files must mock `pino` and `pino-pretty`
- **Express v5** — use `Router()` from express, typed params
- **In-memory Map stores** with `_clear()` functions — no database, all state in-memory for now
- **Timestamps**: `new Date().toISOString()` everywhere
- **SHA256**: `createHash('sha256').update(data).digest('hex')` for content hashing
- **No database dependency** — all phases use in-memory Maps for runtime state
- **Route mounting**: `router.use("/api/<path>", importedRouter)` pattern in `routes/index.ts`

---

## 11. Important Reminders
- The PAT is configured in the git remote (see .git/config) — NEVER commit tokens to tracked files
- Local `.git` has permission issues — always use /tmp clone for push
- User expects both local save AND GitHub push after each batch
- User says "next phase" to continue — no need to ask, just implement the next 5
- Tests MUST pass before pushing
- Follow the exact code patterns (singleton, _clear, vi.mock, ID prefixes)
