# GodsView — Tier Promotion Sign-Off

This is the single artifact a CTO / risk lead uses to flip the system to the
next tier. Each promotion has its own checklist below. Initial each row when
done; do not promote until every row is initialled.

> Reverting is the fastest knob. `EXECUTION_MODE=paper` rollout is two minutes.

---

## Promotion: PAPER → ASSISTED-LIVE

| # | Gate | Verification artifact | Owner | Initialled |
|---|---|---|---|---|
| 1 | `bash scripts/system-proof-run.sh` exits 0 against the prod stack | `docs/promotion/proof-<DATE>.txt` | platform | ☐ |
| 2 | `bash scripts/stress-test-webhooks.sh 200 20` shows 0 5xx, p95 < 500ms | output | platform | ☐ |
| 3 | `bash scripts/failure-test.sh` exits 0 (Redis down + DB down + malformed all rejected safely) | output | platform | ☐ |
| 4 | `bash scripts/pentest.sh` exits 0 (8 adversarial categories handled) | output | security | ☐ |
| 5 | ≥ 14 days uninterrupted PAPER mode with no manual intervention | grafana / metrics export | platform | ☐ |
| 6 | Audit chain integrity: `GET /api/webhooks/audit/verify` returns `brokenCount=0` | output | security | ☐ |
| 7 | `requireOperator` middleware verified on every state-changing route (manual `curl` audit) | curl output | security | ☐ |
| 8 | Real-time price feed wired into slippage gate (test with broker sandbox) | screenshot | trading | ☐ |
| 9 | Approval expiry → audit-event tested end-to-end | log excerpt | trading | ☐ |
| 10 | Risk policy persisted in `risk_policy` table with active row | `SELECT * FROM risk_policy WHERE active` | risk | ☐ |
| 11 | Operator runbook updated with kill-switch usage | `docs/OPERATOR_RUNBOOK.md` | platform | ☐ |
| 12 | Sentry DSN configured in production secret store | secret check | platform | ☐ |
| 13 | DB backup script ran successfully and uploaded to S3 in last 24h | S3 listing | platform | ☐ |
| 14 | Three operators tested the approval UI manually | sign-off | trading | ☐ |
| 15 | TRADINGVIEW_REQUIRE_HMAC=on works (sender + receiver agreed) | curl + 401 + 200 | security | ☐ |

**Promotion command:**
```bash
# Set in production secret store, NOT in .env
EXECUTION_MODE=assisted
# Force-redeploy ECS service to pick up the env var
aws ecs update-service --cluster godsview --service godsview-api --force-new-deployment
```

**Rollback:**
```bash
EXECUTION_MODE=paper && force-new-deployment
```

---

## Promotion: ASSISTED-LIVE → LIVE / autonomous

> **The 20 gates in `docs/REAL_MONEY_TRADING_GATES.md` Tier 2→3 are NON-NEGOTIABLE.**
> Do not initial below until every row in that file has its verification
> artifact attached.

Summary blockers (full list in REAL_MONEY_TRADING_GATES.md):

- [ ] 90+ days of paper P&L on the **production strategy** (not the demo)
- [ ] Backtest of the production strategy across ≥4 regimes, each Sharpe > 0
- [ ] Walk-forward validation, train vs holdout gap < 30%
- [ ] Broker-side daily loss kill switch (Alpaca / IBKR rule, not app rule)
- [ ] Broker-side position cap per symbol AND total exposure
- [ ] DR test: RDS snapshot restored in staging, integrity verified
- [ ] On-call rotation set up in PagerDuty with verified alert routing
- [ ] Runbooks for the 5 most likely incidents (DB down, Redis down, broker rate limit, runaway strategy, bad data feed)
- [ ] Independent risk-engine review by a non-author engineer
- [ ] Compliance review (broker / region disclosure, KYC if required)
- [ ] Insurance / capital-loss policy in writing
- [ ] Customer disclosure of autonomous-execution risks
- [ ] Production secrets rotated; read-only IAM separated from write IAM
- [ ] Penetration test report on the public surface
- [ ] Game-day exercise: simulated runaway strategy is killed within 30s by automation
- [ ] Monthly ops review meeting cadence in calendar
- [ ] Code change-review process documented and followed
- [ ] Build provenance attestation in CI (SLSA-style)
- [ ] Audit-chain HMAC key rotated and re-verification baseline taken
- [ ] Autonomy gate code path requires NODE_ENV=production + EXECUTION_MODE=live_enabled + STRATEGY_AUTONOMY_ALLOW=on + PAPER_PROOF_DAYS≥90 (already enforced)

---

## Quick reference — every coding gate that exists today

| Subsystem | File | Gate |
|---|---|---|
| Webhook | `routes/vc_pipeline.ts` | body-size guard (16KB) |
| Webhook | `routes/vc_pipeline.ts` | per-IP rate limit (60/min) |
| Webhook | `routes/vc_pipeline.ts` | optional HMAC signature (`TRADINGVIEW_REQUIRE_HMAC=on`) |
| Webhook | `routes/vc_pipeline.ts` | passphrase compare via `crypto.timingSafeEqual` |
| Webhook | `routes/vc_pipeline.ts` | production boot guard for empty webhook secret |
| Webhook | `routes/vc_pipeline.ts` | kill-switch first-gate (423) |
| Webhook | `routes/vc_pipeline.ts` | idempotency-key replay (409) |
| Webhook | `routes/vc_pipeline.ts` | risk gates (5 distinct rejection paths) |
| Audit | `routes/vc_pipeline.ts` | tamper-evident HMAC chain (prev_hash + row_hash) |
| Audit | `routes/vc_pipeline.ts` | `/audit/verify` endpoint |
| Auth | `routes/assisted_live.ts` | `requireOperator` on submit/approve/reject/execute |
| Execution | `routes/assisted_live.ts` | live broker price feed for slippage gate |
| Autonomy | `lib/autonomy_gate.ts` | 4-condition hard ceiling on autonomous mode |
| Multi-tenant | `middlewares/org_context.ts` | X-Org-Id propagation, defaulted to `org_default` |
| Observability | `routes/system_metrics.ts` | metrics, prometheus, deep-health, recent-logs, recent-errors (operator auth on all) |
| Observability | `lib/scrub.ts` | secret/PII scrubber on log ring + error capture |
| Risk | `routes/risk_policy.ts` | DB-persisted, audit-trailed, operator-only edit |
| Backup | `scripts/backup-db.sh` | nightly pg_dump → S3 with rotation |
| Reliability | `scripts/{system-proof-run,stress-test-webhooks,failure-test,pentest,replay-session}.sh` | full proof suite |

If anyone asks "what would it take to make GodsView ready for real money?",
the answer is: every box above must already be ✅, and every box in
`REAL_MONEY_TRADING_GATES.md` Tier 2→3 must also be initialled. Both at the
same time. By design, no shortcuts.
