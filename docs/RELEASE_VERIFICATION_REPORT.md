# GodsView — Release Verification Report

**Release candidate:** `v1.0-controlled-paper`
**Mode:** RELEASE FREEZE — paper-trading only

> This file has two halves. The top half is the verification I ran in the
> sandbox right before handing the build to you. The bottom half is the
> verification you ran on your machine. Don't tag the release until your
> half is filled in and every command exited 0.

---

## Section A — Sandbox verification (machine: Anthropic build sandbox)

| Date/time (UTC) | 2026-04-26 |
| Environment | Linux ARM64 sandbox, Node v22.22.0, no Docker |

### What I could verify here

| Command | Status | Notes |
|---|---|---|
| `tsc --noEmit` (api-server) | ✅ exit 0, **0 errors** | strict mode, every `@ts-expect-error` has a real target |
| `tsc --noEmit` (godsview-dashboard) | ✅ exit 0, **0 errors** | |
| `tsc -b lib/db lib/common-types lib/strategy-core lib/api-zod` | ✅ exit 0 | declarations regenerated |
| `grep -r '@ts-nocheck'` | ✅ **0 hits** | every file in scope is real-typechecked |
| `bash -n` on all 8 scripts | ✅ all pass | system-proof, vc-proof, stress, failure, replay, test-tradingview, pentest, backup |
| `node --check scripts/backtest_regimes.mjs` | ✅ pass | |
| `node scripts/backtest_regimes.mjs` × 2 → diff | ✅ **deterministic** | same seed, identical metrics across runs |
| Backtest metrics committed | ✅ | `docs/backtests/regime_proof/summary.json` — trending_up Sharpe 1.42, sideways -2.39 (honest — chop kills the demo SMA-cross strategy) |

### What I could NOT verify here

| Command | Why it didn't run in sandbox | What you have to do |
|---|---|---|
| `git commit / git push` | `.git/index.lock` is owned by your macOS user; sandbox can't `rm -f` it | run on your terminal |
| `pnpm test` | rollup native binary in `node_modules` is macOS-built; this sandbox is Linux ARM64 | run on your terminal |
| `pnpm build` | same reason | run on your terminal |
| `docker compose up -d --build` | no Docker daemon in sandbox | run on your terminal |
| `bash scripts/system-proof-run.sh` | needs the live stack (Postgres + Redis + API + nginx) | run on your terminal |
| `bash scripts/stress-test-webhooks.sh 200 20` | same | run on your terminal |
| `bash scripts/failure-test.sh` | needs Docker to flip Redis/Postgres on/off | run on your terminal |
| `bash scripts/pentest.sh` | needs the live API on `:3001` | run on your terminal |
| `bash scripts/replay-session.sh` | needs the live API + audit history | run on your terminal |

### Build artefacts queued for commit

- 237 files modified or added (`git status --short`, sandbox view)
- New files this session:
  - `routes/{vc_pipeline,vc_status,vc_brain_entity,system_metrics,kill_switch,risk_policy,assisted_live}.ts`
  - `lib/{system_metrics,scrub,kill_switch,autonomy_gate}.ts` + `lib/execution/price_feed.ts`
  - `middlewares/{org_context,error_capture,webhook_guards}.ts`
  - `lib/db/schema/{webhook_idempotency,risk_policy}.ts`
  - `lib/db/migrations/{0010,0011,0012,0013}_*.sql`
  - `__tests__/{e2e/vc_pipeline,e2e/vc_pipeline_safety,e2e/audit_tamper_and_ratelimit,e2e/tradingview_webhook_validation,e2e/tradingview_to_paper_trade,assisted_live_safety,autonomy_gate}.test.ts`
  - `pages/vc-mode.tsx`, `components/ModeBadge.tsx`
  - `scripts/{system-proof-run,vc-proof-run,stress-test-webhooks,failure-test,replay-session,test-tradingview-webhook,pentest,backup-db,daily-paper-validation,backtest_regimes.mjs}`
  - 12 docs in `docs/` (audit, runbook, security addendum, AWS deploy, real-money gates, sign-off, …)

---

## Section B — Operator verification (fill in on your machine)

> Run these in this order. If any fails, fix only the issue that blocked the
> command and re-run. Do not skip steps. Do not move on with FAIL rows.

| Date/time (UTC) | _______________ |
| Operator | _______________ |
| Machine | _______________ |
| OS | _______________ |
| Node | `node --version` → _______________ |
| pnpm | `pnpm --version` → _______________ |
| Docker | `docker --version` → _______________ |

### Phase 1 — Commit

| Command | Status | Notes |
|---|---|---|
| `cd ~/Documents/"Playground 2"/Godsview/Godsview` | ☐ | |
| `rm -f .git/index.lock` | ☐ | |
| `git status` (count of files) | ☐ | _______________ files |
| `git add -A` | ☐ | |
| `git commit -m "feat(∞∞): scrubber, body-size guard, hmac, autonomy gate, risk policy, pentest, backup, sign-off"` | ☐ | commit hash: _______________ |
| `git push` | ☐ | |

### Phase 2 — Local proof

| Command | Result | Time | Failures + fix |
|---|---|---|---|
| `pnpm typecheck` | ☐ PASS / ☐ FAIL | ___ s | |
| `pnpm test` | ☐ PASS / ☐ FAIL | ___ s | |
| `pnpm build` | ☐ PASS / ☐ FAIL | ___ s | |
| `docker compose up -d --build` | ☐ PASS / ☐ FAIL | ___ s | services: postgres, redis, api, nginx |
| `bash scripts/system-proof-run.sh` | ☐ PASS / ☐ FAIL | ___ s | |
| `bash scripts/stress-test-webhooks.sh 200 20` | ☐ PASS / ☐ FAIL | ___ s | p50 ___ ms, p95 ___ ms |
| `bash scripts/failure-test.sh` | ☐ PASS / ☐ FAIL | ___ s | |
| `bash scripts/pentest.sh` | ☐ PASS / ☐ FAIL | ___ s | |
| `bash scripts/replay-session.sh` | ☐ PASS / ☐ FAIL | ___ s | |
| `node scripts/backtest_regimes.mjs` | ☐ PASS / ☐ FAIL | ___ s | summary in `docs/backtests/regime_proof/summary.json` |

### Phase 4 — Tag (only if every Phase 2 row is PASS)

| Command | Status | Notes |
|---|---|---|
| `git tag v1.0-controlled-paper` | ☐ | |
| `git push origin v1.0-controlled-paper` | ☐ | |

### Final result

| Item | Value |
|---|---|
| All proof commands pass? | ☐ YES / ☐ NO |
| Release tag pushed? | ☐ YES / ☐ NO |
| Daily soak start date | _______________ |
| Soak completion target (start + 90 days) | _______________ |
| Operator sign-off | _______________ |

---

## Readiness scores after local proof

(Fill these in once Section B is complete; expected values shown.)

| Tier | Expected after local proof | Actual |
|---|---|---|
| Local system | 100% | ___ % |
| Paper trading | 95% (rises with soak duration) | ___ % |
| Assisted-live | 90% | ___ % |
| SaaS | 55% | ___ % |
| Real-money manual | 58% | ___ % |
| Real-money autonomous | 32% | ___ % |

The first row should hit 100% the moment every Section B Phase 2 box is ticked.
The other rows are bound by calendar / legal items in
`docs/REAL_MONEY_TRADING_GATES.md`. Don't inflate them.
