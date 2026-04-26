# GodsView — Real-Money Trading Gates

**Last updated:** 2026-04-26
**Audience:** the next person about to flip `EXECUTION_MODE=live_enabled`.

> **None of these gates are coding problems. They are operational, financial,
> and legal problems that take calendar time. Do not bypass any of them.**

The system has three execution tiers:

```
PAPER MODE  (today)    — no broker connection used, all trades simulated
ASSISTED   MODE        — broker connection wired, every trade requires manual approval
LIVE       MODE        — broker connection wired, autonomous candidates allowed
```

This document is the gate from PAPER → ASSISTED, and the much harder gate from
ASSISTED → LIVE. Each gate has named owners and verifiable artifacts.

---

## Tier transition checklists

### Tier 1 → Tier 2 — PAPER → ASSISTED

| Gate | Verification | Owner |
|---|---|---|
| 1. `bash scripts/system-proof-run.sh` exits 0 on production stack | screenshot of summary | platform |
| 2. `bash scripts/stress-test-webhooks.sh 200 20` shows 0 5xx, p95 < 500 ms | output | platform |
| 3. `bash scripts/failure-test.sh` exits 0 (Redis-down + DB-down + malformed all pass) | output | platform |
| 4. ≥ 14 days uninterrupted PAPER mode with no manual ops intervention | runtime metrics | platform |
| 5. Audit-log integrity check (every accepted trade has matching signal + audit row) | SQL audit | platform |
| 6. Broker-side sandbox tested (Alpaca paper account end-to-end) | broker statement | trading |
| 7. `requireOperator` middleware on `/api/assisted-live/proposals/:id/execute` | code diff | security |
| 8. Slippage gate uses real-time price feed, not caller-supplied | code diff | trading |
| 9. Approval expiry alarm wired to PagerDuty | CloudWatch alarm screenshot | platform |
| 10. Human approval UI tested by 3 operators | sign-off | trading |

### Tier 2 → Tier 3 — ASSISTED → LIVE / autonomous

These are the ones that really matter. Every item is non-negotiable.

| # | Gate | Verification | Owner |
|---|---|---|---|
| 1 | ≥ 90 calendar days of PAPER P&L on the production strategy | dashboard P&L curve, not just a backtest | trading |
| 2 | Backtest of the production strategy across ≥ 4 regimes, each Sharpe > 0, total PF > 1.2 | `docs/backtests/<strategy>/*.json` | quant |
| 3 | Walk-forward validation with held-out data | quant report | quant |
| 4 | Regime-detection test — strategy is auto-paused in regimes it underperforms in | code + test | quant |
| 5 | Broker-side daily loss kill switch (Alpaca rule, not just app rule) | broker-side config screenshot | trading |
| 6 | Broker-side position cap (per symbol and total exposure) | broker-side config screenshot | trading |
| 7 | App-side daily loss circuit breaker tripping in test | unit test | platform |
| 8 | App-side max-position cap tripping in test | unit test | platform |
| 9 | Audit log uses tamper-evident chain (HMAC over previous row) | DB column + code | security |
| 10 | DR test: restore RDS from weekly snapshot in staging, verify integrity | written report | platform |
| 11 | On-call rotation set up in PagerDuty | rota link | platform |
| 12 | Runbooks for the 5 most likely incidents (DB down, Redis down, broker rate limit, runaway strategy, bad data feed) | `docs/runbooks/*.md` | platform |
| 13 | Independent risk-engine review by a non-author engineer | sign-off doc | risk |
| 14 | Compliance — broker / region disclosure, KYC if required | legal sign-off | legal |
| 15 | Insurance / capital-loss policy in writing | policy document | legal |
| 16 | Customer disclosure of autonomous-execution risks (if applicable) | disclosure doc | legal |
| 17 | Production secrets rotated and read-only IAM separated from write-IAM | screenshots | security |
| 18 | Penetration test report on the public surface (auth, webhook, /api routes) | report | security |
| 19 | Game-day exercise — simulated runaway strategy is killed within 30 s by automation | report | platform |
| 20 | Monthly ops review meeting cadence in calendar | calendar invite | platform |

## How to use this doc

1. Open this file and the latest `system-proof-run.sh` output side by side.
2. For each row, paste a link to the verification artifact in the Verification column.
3. When all rows in a tier are green, file a "Tier promotion" PR that includes:
   - This doc with all rows green
   - The artifacts
   - A CHANGELOG entry
   - Sign-offs from each owner
4. The PR is the only mechanism that flips `EXECUTION_MODE` in production.
5. Reverting is the fastest knob — `EXECUTION_MODE=paper` rollout takes 2 min.

## What's true today (paper-only)

- Tier 1 → 2: items 1, 2, 3, 7, 8 — code/script artifacts exist; runs are user-machine pending.
- Tier 1 → 2: items 4, 5, 6, 9, 10 — not yet started (calendar gates).
- Tier 2 → 3: nothing started. By design — paper soak first.

The honest answer to "are we close to real money?" is **no**, and that's the
correct answer. The goal of paper mode is to find the bugs, drift, and edge
cases without losing capital. Skipping paper soak is the most expensive
mistake a trading platform can make.
