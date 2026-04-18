# GodsView Launch Checklist — v1.0.0

The final pre-launch gate. Walk from a clean checkout of `main` at tag
`v1.0.0` to a running production deploy on AWS. Every step here is
idempotent and has a rollback path.

> **Scope.** This document describes the minimum steps to ship `v1.0.0`.
> It does not replace `docs/OPERATOR_RUNBOOK.md` (day-2 ops) or
> `docs/AWS_DEPLOY.md` (AWS-specific CDK parameters).

---

## 0. Pre-flight

- [ ] You are at tag `v1.0.0` on a clean working tree.
      ```bash
      git fetch --tags
      git checkout v1.0.0
      git status          # expect: working tree clean
      ```
- [ ] `pnpm --version` ≥ 9 and `node --version` ≥ 20.
- [ ] AWS CLI is authenticated to the correct account (`aws sts get-caller-identity`).
- [ ] `k6` is installed (`k6 version`).
- [ ] You have secrets for: Alpaca (live + paper), Anthropic, PostgreSQL,
      `GODSVIEW_OPERATOR_TOKEN`, `GODSVIEW_ALERT_WEBHOOK_URL`.

## 1. Install + typecheck + build

```bash
pnpm install --frozen-lockfile
./node_modules/.bin/tsc -p artifacts/api-server/tsconfig.json --noEmit
./node_modules/.bin/tsc --build
cd artifacts/api-server && node ./build.mjs && cd -
```

Expected: all three commands exit 0. If any fail, **do not ship** —
open an issue against the phase whose module regressed.

## 2. Unit + integration tests

```bash
pnpm -r test                                  # all workspaces
pnpm -F api-server test                       # api-server focus (3654 tests)
pnpm -F @workspace/godsview-dashboard test    # dashboard smoke tests (Phase 11)
```

Expected: all suites green. No `@ts-nocheck` headers remain on the
Phase 5 governance scaffolds (`promotion_discipline.ts`,
`trust_surface.ts`, `shadow_scorecard.ts`) — confirmed by Phase 7.

Phase 11 adds jsdom/MSW-backed smoke tests under
`artifacts/godsview-dashboard/src/pages/__tests__/`. They verify the
dashboard render tree stays healthy under the Phase 8 API shapes and
the Phase 9 SSE push hook. Scaffolding is in `src/test/` — add one
`__tests__/<page>.test.tsx` per page as coverage grows.

Phase 12 wires the dashboard suite into `.github/workflows/ci.yml` so
every PR runs the jsdom tests in the `typecheck-and-test` job and the
`build` job enforces a regression floor (≥ 10 passing dashboard tests).
Phase 12 also adds a `FakeWebSocket` shim to `src/test/setup.ts`, which
unblocks smoke tests for any page that subscribes to a WebSocket feed.
Current dashboard suite at `v1.5.0`: 13 tests across 6 files covering
`not-found`, `alert-center`, `alerts`, `checklist`, `proof`, and
`news-monitor`.

## 3. k6 performance baseline

Run both k6 scripts against a locally-running api-server (paper mode):

```bash
# in one terminal
cd artifacts/api-server && pnpm dev

# in another terminal
k6 run load-tests/k6-scheduler-baseline.js
k6 run load-tests/k6-api-stress.js
```

Thresholds from Phase 6:

```
http_req_duration:   p(95) < 500ms,  p(99) < 1500ms
errors:              rate < 0.01
gov_scheduler p95:   < 500ms      cal_scheduler p95: < 500ms
slo_latency   p95:   < 750ms      slo_burn p95:      < 400ms
```

If any threshold regresses, investigate before tagging.

## 4. Environment configuration

In a secrets manager (AWS Secrets Manager / SSM), set the following.
All are consumed by the `artifacts/api-server` process.

### Required (all environments)

| Variable                       | Purpose                                                 |
| ------------------------------ | ------------------------------------------------------- |
| `NODE_ENV`                     | `production`                                            |
| `PORT`                         | `3000`                                                  |
| `DATABASE_URL`                 | `postgres://…` — RDS endpoint                           |
| `GODSVIEW_DATA_DIR`            | Path for ring buffers + runtime artifacts               |
| `GODSVIEW_OPERATOR_TOKEN`      | Required for operator-gated routes                      |
| `GODSVIEW_ALERT_WEBHOOK_URL`   | Slack / PagerDuty webhook                               |
| `ALPACA_API_KEY`               | Alpaca credential                                       |
| `ALPACA_API_SECRET`            | Alpaca credential                                       |
| `ALPACA_PAPER`                 | `true` for paper, `false` for live                      |

### Paper → Live cut-over

| Variable               | Paper cut-over | Live cut-over |
| ---------------------- | -------------- | ------------- |
| `ALPACA_PAPER`         | `true`         | `false`       |
| `LIVE_TRADING_ENABLED` | `false`        | `true`        |

Never flip both to live simultaneously with an un-validated strategy —
the promotion cron (Phase 5) enforces paper → assisted live → autonomous
on its own schedule; operators only need to approve the last gate.

### Phase 5 / 6 defaults (override if needed)

| Variable                            | Default | Notes                                  |
| ----------------------------------- | ------- | -------------------------------------- |
| `PROMOTION_SCHEDULER_INTERVAL_MS`   | 3600000 | 1 h                                    |
| `CALIBRATION_SCHEDULER_INTERVAL_MS` | 1800000 | 30 min                                 |
| `SSE_ALERT_ROUTER_AUTOSTART`        | `true`  | Set `false` to disable router at boot  |
| `SLO_SCAN_INTERVAL_MS`              | 60000   | Burn-rate scan cadence                 |
| `SLO_OBSERVATION_MAX`               | 5000    | Per-SLO ring buffer size               |

## 5. AWS deploy (CDK)

Phase 13 ships turnkey wrappers around the CDK stacks. Run the
read-only preflight first, then the deploy:

```bash
GV_ENV=dev bash scripts/aws-preflight.sh      # read-only validator
GV_ENV=dev bash scripts/aws-deploy.sh         # full turnkey deploy
```

`scripts/aws-deploy.sh` runs preflight → CDK bootstrap (if needed) →
install → typecheck → tests → dashboard bundle → ECR image push →
`cdk deploy --all -c env=dev` → ALB health probe. Swap `GV_ENV=prod`
for a production deploy (the script prompts for `yes` confirmation
before touching prod).

Low-level CDK equivalents (still supported):

```bash
cd infra
pnpm install
npx cdk diff    --context env=dev
npx cdk deploy --all --context env=dev
```

Expected: new task definitions land, ALB target group flips to healthy,
CloudWatch Logs start streaming api-server output.

For migrating off Railway, follow `docs/RAILWAY_TO_AWS_CUTOVER.md` —
it describes the dev-first, bake-then-cut-over playbook and the gated
Railway teardown (`scripts/railway-teardown.sh`).

## 6. Smoke tests (production)

Once the ALB reports healthy, run against the public URL:

```bash
export API=https://api.godsview.example.com

# Liveness / readiness
curl -sf $API/api/healthz   | jq '.status'
curl -sf $API/api/readyz    | jq '.status'

# Schedulers are ticking
curl -sf $API/api/governance/scheduler/status  | jq '.status, .lastRunAt'
curl -sf $API/api/calibration/scheduler/status | jq '.status, .lastRunAt'

# SLOs have been observed (at least one request per tracked prefix)
curl -sf $API/api/slo/budgets      | jq '.snapshot | map({id, sampleCount})'
curl -sf $API/api/slo/router/status | jq '.router.running, .router.forwardedCount'
```

Expected:

- `status` is `ok` on both health probes.
- `lastRunAt` is within the last scheduler interval.
- `sampleCount` is > 0 for at least the `general_availability` SLO.
- `router.running` is `true`.

## 7. Alert loop test

Fire a known-good test alert to verify the webhook pipeline:

```bash
curl -sf -X POST $API/api/ops/test-alert \
  -H "Authorization: Bearer $GODSVIEW_OPERATOR_TOKEN"
```

Expected: a message arrives in the configured Slack / PagerDuty channel
within 10 seconds.

If the receiver is misconfigured, smoke-test it directly (bypasses the
api-server) with the shape the router emits:

```bash
corepack pnpm --filter @workspace/scripts run verify-alert-webhook -- \
  --url "$GODSVIEW_ALERT_WEBHOOK_URL" \
  --type daily_loss_breach \
  --severity fatal
```

Adapter examples for Slack and PagerDuty receivers are in
`docs/ALERT_WEBHOOK_RECEIVERS.md`.

## 8. First strategy promotion

- [ ] Confirm one strategy is in `paper_approved`.
- [ ] Let the promotion cron tick at least once (`/api/governance/scheduler/status`
      `.lastRunAt` advances).
- [ ] Review `/api/governance/scheduler/history` — the strategy should
      appear as `promotion_eligible` once its shadow cohort clears the
      Phase 5 gates.
- [ ] Approve in the dashboard (Risk Control → Promotion Queue).

## 9. Rollback plan

Every phase has a pure `git` undo — `git revert <phase-head>` or a
re-deploy of the previous task definition.

| Scenario                                     | Action                                             |
| -------------------------------------------- | -------------------------------------------------- |
| Bad deploy, health checks fail               | `aws ecs update-service --force-new-deployment --task-definition <prev>` |
| Promotion cron misfiring                     | `PROMOTION_SCHEDULER_INTERVAL_MS=9999999999` and restart |
| Alert router flooding                        | `SSE_ALERT_ROUTER_AUTOSTART=false` and restart     |
| SLO ring buffers corrupted post-incident     | `POST /api/slo/reset` with operator token          |
| Catastrophic — need previous release         | Re-deploy tag `v0.x.y`                             |

## 10. Tag + release notes

Only after steps 1–9 are green:

```bash
git tag -a v1.0.0 -m "GodsView v1.0.0 — production-ready"
git push origin v1.0.0
```

Cut release notes from the phase HANDOFFs:

- `phase-1/HANDOFF.md` — type safety + CI truth
- `phase-2/HANDOFF.md` — no mock data in live paths
- `phase-3/HANDOFF.md` — AWS CDK deploy
- `phase-4/HANDOFF.md` — 68/68 pages with RBAC
- `phase-5/HANDOFF.md` — promotion + calibration cron
- `phase-6/HANDOFF.md` — SLOs + alert routing + k6 baseline
- `phase-7/HANDOFF.md` — documentation truth pass + v1.0.0 tag
- `phase-8/HANDOFF.md` — Alert Center real wiring + channel mapping
- `phase-9/HANDOFF.md` — Dashboard SSE push for Alert Center
- `phase-10/HANDOFF.md` — Test-suite hardening + webhook receiver examples
- `phase-11/HANDOFF.md` — Dashboard MSW smoke tests
- `phase-12/HANDOFF.md` — CI enforcement for dashboard tests + WebSocket shim
- `phase-13/HANDOFF.md` — Turnkey AWS deploy + Railway teardown scripts

---

## Production-readiness status

| Gate                                                                             | Status       |
| -------------------------------------------------------------------------------- | ------------ |
| 1. TradingView MCP + webhook router                                              | shipped      |
| 2. Backtesting → paper → assisted live → auto-promotion                          | shipped      |
| 3. AWS production deploy                                                         | shipped      |
| 4. All 68 sidebar pages with RBAC                                                | shipped      |
| 5. SLOs + alert routing + k6 baseline                                            | shipped      |
| 6. Documentation truth pass + launch checklist                                   | shipped (this doc) |
| 7. Alert Center real wiring + channel mapping                                    | shipped      |
| 8. Alert Center SSE push + live connection badge                                 | shipped      |
| 9. Test-suite hardening + concrete receiver adapters + verifier CLI              | shipped      |
| 10. Dashboard MSW smoke tests                                                    | shipped      |
| 11. CI enforcement of dashboard tests + regression gate + WebSocket shim         | shipped      |
| 12. Turnkey AWS deploy + Railway teardown automation                             | shipped      |

**Production readiness: 100%.**

All twelve gates ship, backed by codified SLOs that page on-call when
they degrade and a turnkey deploy path (`scripts/aws-deploy.sh`) that
takes a clean `main` checkout to a running AWS production stack. The
only remaining work is day-2 ops (see `docs/OPERATOR_RUNBOOK.md`) and
optional post-v1 backlog items listed in each phase HANDOFF.
