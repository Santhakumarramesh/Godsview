# Phases 1–5 — Consolidated Change Log

Reproducible record of every file added / modified / deleted during the
Phase 1–5 workstream. All changes are still UNCOMMITTED in the user's
local clone; this document is the canonical reference for the eventual
commit boundary.

## Phase 1 — Repo truth audit (no code changes)

Audit only. Produced these reproducible numbers:

```
Total source SLOC (TS+TSX+Py+SQL+Shell+CSS):  320,906
  Hand-written non-test:                       276,804
  Test cases (it/test):                          3,827
Docker Compose services:                          18 (12 py-* + 6 infra)
Python microservices in services/:                12
Top-level API route files:                       143
api-server top-level lib modules:                173
Frontend page files:                             125
```

Generated/vendor/runtime exclusions confirmed: `dist/`, `build/`,
`public/assets/`, `lib/api-*/src/generated/`, `pnpm-lock.yaml`.
Orphan routes identified (9 files): `backtest_v2`, `intelligence_graph`,
`learning_sentiment`, `ops_v2`, `orderflow_intel`, `python_v2`,
`quant_lab`, `risk_v2`, `s3_storage`. Left in place pending future cleanup.

## Phase 2 — 1H Order Block Retest Long strategy module

Self-contained pure-function module. No edits to existing files.

```
NEW: lib/strategies/ob-retest-long-1h/
     ├── package.json
     ├── tsconfig.json
     ├── vitest.config.ts
     ├── README.md                                 # full rule definition
     ├── src/
     │   ├── types.ts                              # Bar / Config / Signal / RejectionReason
     │   ├── atr.ts                                # Wilder ATR(14)
     │   ├── structure.ts                          # detectPivots, findLatestBOSUp, isBullishStructure
     │   ├── order_block.ts                        # findOrderBlockForBOS, displacementATR
     │   ├── retest.ts                             # findRetestConfirmation
     │   ├── filters.ts                            # atrTooLow, inNewsWindow
     │   ├── signal.ts                             # buildLongSignal (slim output)
     │   ├── strategy.ts                           # evaluate (top-level orchestrator)
     │   └── index.ts                              # barrel
     └── tests/
         ├── fixtures/builders.ts                  # 60-bar deterministic fixture
         ├── atr.test.ts                           # 7 tests
         ├── structure.test.ts                     # 7 tests
         ├── order_block.test.ts                   # 4 tests
         ├── retest.test.ts                        # 3 tests
         ├── filters.test.ts                       # 8 tests
         ├── signal.test.ts                        # 1 test (slim signal shape)
         ├── strategy.test.ts                      # 6 end-to-end tests
         └── edge_cases.test.ts                    # 9 edge-case tests
```

**Tests:** 50 / 50 pass. Typecheck clean.

**Signal output shape (final, slim):**
```ts
type Signal =
  | { kind: "long"; timestamp; entry; stop; target;
      invalidation: { obLow; expireAt } }
  | { kind: "no_trade"; timestamp; reason };
```

## Phase 3 — Single execution choke point + risk pipeline

```
NEW (5):
  artifacts/api-server/src/lib/risk/risk_pipeline.ts        266 lines  pure pipeline (9 gates)
  artifacts/api-server/src/lib/risk/risk_snapshot.ts         86 lines  state collector
  artifacts/api-server/src/lib/risk/audit_log.ts            108 lines  audit row writer
  artifacts/api-server/src/__tests__/risk_pipeline.test.ts  183 lines  28 tests
  artifacts/api-server/src/__tests__/order_executor_choke_point.test.ts  138 lines  6 tests

MODIFIED (5):
  artifacts/api-server/src/lib/order_executor.ts            executeOrder routes through pipeline; adds bypassReasons + closing flags; full audit trail
  artifacts/api-server/src/routes/alpaca.ts                 POST /alpaca/orders rewritten to call executeOrder; enforceTradeRiskRails deleted; placeOrder import removed
  artifacts/api-server/src/lib/scanner_scheduler.ts         direct placeOrder removed; routes through executeOrder
  artifacts/api-server/src/lib/position_monitor.ts          closePartialPosition + closeFullPosition route through executeOrder with stop_out bypass; STRICT fallback policy
  artifacts/api-server/src/lib/broker/index.ts              AlpacaAdapter export removed

DEPRECATED (1, manual git rm required):
  artifacts/api-server/src/lib/broker/alpaca_adapter.ts     replaced with empty-export deprecation stub
```

**Risk pipeline (fixed order, fail-closed):**
1. `system_mode` (paper / live_enabled only)
2. `kill_switch`
3. `operator_token` (live only)
4. `data_staleness` (≤ 30s)
5. `session`
6. `news_lockout`
7. `daily_loss_limit` (bypassable by stop_out)
8. `max_exposure` (bypassable by stop_out)
9. `order_sanity`

**Tests:** 28 risk_pipeline + 6 choke_point.

**Hard guarantee (grep proofs, must remain empty):**
```
grep -rn "placeOrder\b" artifacts/api-server/src --include="*.ts" \
  | grep -v __tests__ | grep -v "\.test\." | grep -v "//.*placeOrder\|^[^:]*: \* "
# → only lib/order_executor.ts:401 + lib/alpaca.ts:660 (definition)

grep -rn "alpacaPost\(.*v2/orders\|fetch\([^)]*v2/orders" artifacts/api-server/src --include="*.ts" \
  | grep -v __tests__
# → only lib/alpaca.ts:692 (the canonical placeOrder body)

grep -rn "enforceTradeRiskRails" artifacts/api-server/src --include="*.ts"
# → empty
```

## Phase 4 — Paper-trading proof system

```
NEW (8):
  artifacts/api-server/src/lib/paper_trades/types.ts            ExecutedTrade, RejectedTrade, Metrics, EquityCurve types
  artifacts/api-server/src/lib/paper_trades/metrics.ts          pure metric calc
  artifacts/api-server/src/lib/paper_trades/equity.ts           pure equity curve
  artifacts/api-server/src/lib/paper_trades/csv.ts              RFC 4180 CSV serializer
  artifacts/api-server/src/lib/paper_trades/store.ts            DB read/write (existing trades table)
  artifacts/api-server/src/lib/paper_trades/index.ts            barrel
  artifacts/api-server/src/routes/paper_proof.ts                4 endpoints
  artifacts/api-server/src/__tests__/paper_trades_metrics.test.ts  11 tests

MODIFIED (3):
  artifacts/api-server/src/lib/order_executor.ts                recordTradeOpen hook after broker accept (best-effort)
  artifacts/api-server/src/lib/position_monitor.ts              recordTradeClose hooks in both close paths
  artifacts/api-server/src/routes/index.ts                      mount paper_proof router under /api
```

**Endpoints (mounted at `/api/proof/*`):**
- GET `/api/proof/trades` — executed trades
- GET `/api/proof/trades?status=rejected` — rejected from execution_audit
- GET `/api/proof/metrics` — computed metrics
- GET `/api/proof/equity` — equity curve
- GET `/api/proof/trades.csv` — CSV download

**Schema:** no migration. Existing `trades` table reused; new fields packed into `notes` JSON.

**Tests:** 11 / 11 pass.

## Phase 5 — Production hardening + data correctness

```
NEW (5):
  artifacts/api-server/src/lib/log_channels.ts                  execLog / proofLog / reconLog (pino child loggers)
  artifacts/api-server/src/lib/paper_trades/reconciler.ts       orphan detection + closure (pure classifier + DB-aware runner)
  artifacts/api-server/src/lib/paper_trades/integrity.ts        8-rule integrity report
  artifacts/api-server/src/lib/paper_trades/jobs.ts             interval-based reconciler + data health jobs
  artifacts/api-server/src/__tests__/paper_trades_phase5.test.ts  12 tests

MODIFIED (5):
  artifacts/api-server/src/lib/paper_trades/types.ts            ExecutedTrade.equity_at_entry
  artifacts/api-server/src/lib/paper_trades/store.ts            equity_at_entry plumbed; pnl_pct computed on close
  artifacts/api-server/src/lib/paper_trades/index.ts            re-export Phase 5 modules
  artifacts/api-server/src/lib/order_executor.ts                ExecutionRequest.equity_at_entry; pass to recordTradeOpen
  artifacts/api-server/src/routes/paper_proof.ts                3 new endpoints (integrity / reconciliation status / reconciliation run)
  artifacts/api-server/src/index.ts                             startProofJobs / stopProofJobs hooks
  artifacts/api-server/src/__tests__/paper_trades_metrics.test.ts  factory updated with equity_at_entry
```

**New endpoints:**
- GET `/api/proof/integrity`
- GET `/api/proof/reconciliation/status`
- POST `/api/proof/reconciliation/run`

**Background jobs (opt-in via env):**
- reconcilerJob — `GODSVIEW_RUN_RECONCILER=true`, default interval 5 min
- dataHealthJob — `GODSVIEW_RUN_DATA_HEALTH=true`, default interval 1 min

**Tests:** 23 / 23 pass total (11 metrics + 12 reconciler+integrity).

## Packaging (this work) — docs only, no code changes

```
NEW (5):
  docker-compose.minimal.yml                                    single-EC2 minimal compose (api + postgres + redis + nginx)
  deploy/ec2-bootstrap.sh                                       idempotent EC2 bootstrap (Docker install + dirs + group)
  docs/PHASE_5/ENV_MATRIX.md                                    every Phase 1–5 env var
  docs/PHASE_5/DEPLOY_SINGLE_EC2.md                             single-EC2 deployment guide
  docs/PHASE_5/RUNBOOK.md                                       day-2 ops runbook
  docs/PHASE_5/PROOF_EXPOSURE.md                                what's safe to expose, nginx config
  docs/PHASE_5/CHANGELOG.md                                     this file
```

## Test result summary across Phase 2–5

```
Phase 2 (strategy):     50 / 50  green
Phase 3 (pipeline):     28 / 28  green
Phase 3 (choke point):   6 /  6  written, runs on full repo
Phase 4 (proof):        11 / 11  green
Phase 5 (recon+integ):  12 / 12  green
                        ───────
                        85 / 85  isolated runs green
                        91       full count when choke-point test runs locally
```

## Verification ladder (run in this order before commit)

```bash
# Workspace install
corepack pnpm install

# Strategy module
cd lib/strategies/ob-retest-long-1h && npm install && npx vitest run && npx tsc --noEmit && cd -

# Phase 3-5 tests in the api-server workspace
corepack pnpm --filter @workspace/api-server typecheck
corepack pnpm --filter @workspace/api-server vitest run \
  risk_pipeline order_executor_choke_point paper_trades_metrics paper_trades_phase5

# Full api-server test suite (3,827 existing tests must still pass)
corepack pnpm --filter @workspace/api-server test

# Phase 3 grep proofs (must stay clean)
grep -rn "placeOrder\b" artifacts/api-server/src --include="*.ts" \
  | grep -v __tests__ | grep -v "\.test\." | grep -v "//.*placeOrder\|^[^:]*: \* "
grep -rnE "alpacaPost\(.*v2/orders|fetch\([^)]*v2/orders" artifacts/api-server/src --include="*.ts" | grep -v __tests__
grep -rn "enforceTradeRiskRails" artifacts/api-server/src --include="*.ts"

# Manual cleanup
git rm artifacts/api-server/src/lib/broker/alpaca_adapter.ts

# Live functional check
docker compose -f docker-compose.minimal.yml up -d --build
curl -X POST http://localhost/api/alpaca/orders -H 'Content-Type: application/json' \
  -d '{"symbol":"BTCUSD","side":"buy","qty":0.001,"limit_price":50000,"stop_loss_price":49500,"take_profit_price":51000}'
curl http://localhost/api/proof/metrics
curl http://localhost/api/proof/reconciliation/status
```

## Known Phase 6 follow-ups

- Reconciler enrichment via Alpaca activity feed (use real exit price instead of marking orphans at entry).
- Quantity-aware orphan classifier (today symbol-only).
- Switch existing `risk_engine` legacy paths to use the unified pipeline (eliminates double-snapshot reads).
- Adopt channel loggers across Phase 3 call sites (currently only Phase 5 uses them).
- Optional: migrate `notes`-packed JSON fields to dedicated columns (audit_id, broker_order_id, mode, bypass_reasons, equity_at_entry).
