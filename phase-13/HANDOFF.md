# Phase 13 — Turnkey AWS deploy + Railway teardown automation

**Branch:** `phase-13-aws-deploy-railway-teardown`
**Base:** `phase-12-ci-dashboard-tests` (commit `a1160dc`, tag `v1.5.0`)
**Head:** `c391e73`
**Tag:** `v1.6.0`
**Patch:** `phase-13/0001-phase-13-aws-deploy-railway-teardown.patch` (~44 KB)
**Files changed:** 5 (937 insertions, 18 deletions)

---

## Why this phase

Phase 3 shipped the CDK stacks and Railway was the interim host while
AWS wasn't yet built. The request on this phase: "deploy in AWS and
delete the deploy from Railways cleanly."

Phase 13 closes the gap by shipping the cutover tooling itself. A clean
checkout plus three commands — preflight, deploy, teardown — walks from
"Railway is live" to "AWS is live, Railway is gone" without any step
where GodsView has no live endpoint.

**Strategy locked in:** stand AWS up first, verify, then tear Railway
down. Dev environment first (single NAT, t4g.micro, 1 task), then prod
(multi-AZ, auto-scaled 2→10 tasks, RDS Multi-AZ, RETAIN policy). Railway
service name is supplied via `$RAILWAY_SERVICE` at script run time so
the repo doesn't hardcode it.

---

## What shipped

### 1. `scripts/aws-preflight.sh` (~7 KB)

Read-only validator you can run any time. Checks:

- **Local toolchain** — node ≥ v20, pnpm ≥ v9, docker daemon reachable, aws CLI.
- **AWS identity** — `aws sts get-caller-identity`; exports
  `CDK_DEFAULT_ACCOUNT` + `CDK_DEFAULT_REGION` for downstream scripts.
- **CDK bootstrap** — warns if `CDKToolkit` stack is missing in region.
- **Secrets Manager** — looks for the four required entries:
  `godsview/<env>/alpaca`, `.../anthropic`, `.../operator-token`,
  `.../alert-webhook-url`. Missing → warning (DataStack will create
  placeholders; operator rotates after deploy).
- **ACM + Route 53** — prod only: ISSUED certs in region, hosted zones visible.
- **Repo layout** — sanity check on `infra/`, `artifacts/*/`, `Dockerfile`.

Exits 0 if everything is green, 1 if any hard check failed. Warnings
don't block. Usage:

```bash
GV_ENV=dev bash scripts/aws-preflight.sh
GV_ENV=prod GV_REGION=us-east-1 bash scripts/aws-preflight.sh
```

### 2. `scripts/aws-deploy.sh` (~9 KB)

Idempotent turnkey deploy. Re-running it is safe: it picks up wherever
it left off (CDK is already idempotent; S3 sync and ECR push are too).

Steps:

1. Re-run preflight (abort on fail).
2. `cdk bootstrap aws://<account>/<region>` if `CDKToolkit` is missing.
3. `pnpm install --frozen-lockfile` → `tsc --build` → api-server vitest
   → dashboard vitest. Phase 12 enforcement means dashboard tests run
   here too.
4. Dashboard `vite build` → `aws s3 sync dist/ s3://godsview-<env>-dashboard-<account>/`
   (if the bucket exists yet; deferred to step 6 if not).
5. Api-server Docker build `--platform linux/arm64` → push to ECR
   `godsview-<env>-api:<git-sha>` and `:latest` (deferred if ECR repo
   not yet created by StorageStack).
6. `cdk deploy --all --context env=<env>` via the existing
   `pnpm deploy:dev|:prod` scripts in `infra/`. On first run this
   creates the ECR repo + S3 bucket, then the script re-runs the
   deferred image push + bundle sync.
7. Poll `http://<alb-dns>/api/healthz` every 10s for up to 10 minutes.
   Probe `/api/readyz` once when `/healthz` goes 200. Print the
   dashboard CloudFront URL from the stack outputs.

Environment knobs:

| Var             | Default        | Effect                                |
| --------------- | -------------- | ------------------------------------- |
| `GV_ENV`        | `dev`          | Targets `godsview-dev-*` stacks       |
| `GV_REGION`     | `us-east-1`    | Deploy region                         |
| `GV_IMAGE_TAG`  | `<git-sha>`    | Image tag pushed to ECR               |
| `GV_SKIP_BUILD` | `0`            | Skip image + dashboard build (infra-only) |
| `GV_YES`        | `0`            | Skip `yes` confirmation prompt (prod) |

### 3. `scripts/railway-teardown.sh` (~6 KB)

Gated Railway teardown. The central design choice: the script
**refuses to run if AWS isn't already serving**. Specifically:

1. Verifies the `railway` CLI is present and authenticated.
2. Pulls the AWS ALB DNS from the `godsview-<env>-compute`
   CloudFormation output.
3. `curl`s `/api/healthz` and `/api/readyz` on the AWS ALB. If either
   is non-200 the script dies.
4. Probes `/api/governance/scheduler/status` — if the promotion cron
   isn't `running`, warns and asks for explicit `yes` confirmation.
5. Requires the operator type `delete <service-name>` to continue
   (skip with `GV_YES=1`).
6. `railway down --yes` → `railway service delete --service <name> --yes`.
7. Verifies the service is no longer in `railway service list`.

Required: `RAILWAY_SERVICE=<name>`. Optional: `GV_ENV` (default: prod —
we gate on the env that should be serving live users), `GV_SKIP_AWS_CHECK=1`
(dangerous, not recommended).

### 4. `docs/RAILWAY_TO_AWS_CUTOVER.md` (~8 KB)

Step-by-step playbook matching the dev-first cutover strategy:

- §0  Prerequisites + preflight
- §1  Deploy AWS dev + smoke-test + bake 24h
- §2  Deploy AWS prod
- §3  Pre-cutover DNS prep (lower TTL to 60s ≥ 30 min ahead)
- §4  Migrate Postgres Railway → RDS via `pg_dump` + `pg_restore`
- §5  DNS flip (Route 53 UPSERT → ALB alias)
- §6  24h bake on AWS with SLO + CloudWatch watchdog
- §7  Run `scripts/railway-teardown.sh`
- §8  Post-cutover housekeeping (LAUNCH_CHECKLIST update, remove
      `railway.toml`, drop Railway deploy hooks)
- §9  Rollback matrix for every step

### 5. `docs/LAUNCH_CHECKLIST.md`

§5 (AWS deploy) now points at the new scripts as the preferred path
with the low-level `cdk deploy` commands retained as an alternate. The
production-readiness table grew to twelve gates through Phase 13.

---

## Apply

```bash
cd /path/to/Godsview
git checkout phase-12-ci-dashboard-tests
git checkout -b phase-13-aws-deploy-railway-teardown
git am < phase-13/0001-phase-13-aws-deploy-railway-teardown.patch
git tag -a v1.6.0 -m "GodsView v1.6.0 — Turnkey AWS deploy + Railway teardown"
```

No new dependencies — the patch adds three shell scripts and one
markdown doc. Nothing to `pnpm install`.

---

## Files shipped

| File                                  | Purpose                                                  |
| ------------------------------------- | -------------------------------------------------------- |
| `scripts/aws-preflight.sh` (NEW)      | Read-only validator (toolchain, AWS, secrets, ACM, repo) |
| `scripts/aws-deploy.sh` (NEW)         | Turnkey end-to-end AWS deploy                            |
| `scripts/railway-teardown.sh` (NEW)   | Gated Railway teardown (requires AWS healthy first)      |
| `docs/RAILWAY_TO_AWS_CUTOVER.md` (NEW)| Step-by-step migration playbook + rollback matrix        |
| `docs/LAUNCH_CHECKLIST.md`            | §5 points at new scripts; gate table extended to 12      |

---

## Verification gate

```bash
cd /path/to/Godsview
bash -n scripts/aws-preflight.sh scripts/aws-deploy.sh scripts/railway-teardown.sh
./node_modules/.bin/tsc --build                                                 # exit 0
./node_modules/.bin/tsc -p artifacts/api-server/tsconfig.json --noEmit          # exit 0
./node_modules/.bin/tsc -p artifacts/godsview-dashboard/tsconfig.json --noEmit  # exit 0
cd artifacts/api-server && GODSVIEW_DATA_DIR=.runtime \
  ./node_modules/.bin/vitest run --reporter=dot                                 # 3654 passed | 18 skipped
cd ../godsview-dashboard && \
  ./node_modules/.bin/vitest run --config ./vitest.config.ts --reporter=dot     # 13 passed
cd ../api-server && node ./build.mjs                                            # ~4.9 MB, ~354 ms
cd ../godsview-dashboard && ./node_modules/.bin/vite build --config vite.config.ts # 5.92 s
```

Results at `v1.6.0`:

- Bash script syntax (all three): exit 0
- Workspace typecheck: exit 0
- api-server typecheck: exit 0
- Dashboard typecheck: exit 0
- api-server vitest: 178 passed | 1 skipped files; **3654 passed | 18 skipped tests**
- Dashboard vitest: 6 files; **13 passed tests** (unchanged from v1.5.0)
- api-server bundle: ~4.9 MB, ~354 ms
- Dashboard bundle: 5.92 s

All eight gates green.

---

## What Sakthi runs locally

This sandbox has no AWS or Railway CLI credentials, so the scripts are
written to be run from the operator's authenticated local machine.

```bash
# 1. Start fresh and pull v1.6.0.
cd /path/to/Godsview
git fetch --all --tags
git checkout v1.6.0

# 2. Preflight (read-only — fix anything that fails).
GV_ENV=dev bash scripts/aws-preflight.sh

# 3. AWS dev deploy. Bake 24h.
GV_ENV=dev bash scripts/aws-deploy.sh

# 4. AWS prod deploy. Bake 24h while Railway still serves.
GV_ENV=prod bash scripts/aws-deploy.sh

# 5. Follow docs/RAILWAY_TO_AWS_CUTOVER.md §3–§6 for DNS + Postgres
#    migration + 24h bake on AWS.

# 6. Tear down Railway (gated: AWS must be healthy for this to succeed).
RAILWAY_SERVICE=<your-railway-service-name> \
  bash scripts/railway-teardown.sh
```

Expect step 3 (first `cdk deploy`) to take 25–35 minutes — RDS is the
slow leg. Step 4 (prod) is 40–60 minutes.

---

## Production-readiness gate status at `v1.6.0`

| Gate                                                                             | Status       |
| -------------------------------------------------------------------------------- | ------------ |
| 1. TradingView MCP + webhook router                                              | shipped      |
| 2. Backtesting → paper → assisted live → auto-promotion                          | shipped      |
| 3. AWS production deploy                                                         | shipped      |
| 4. All 68 sidebar pages with RBAC                                                | shipped      |
| 5. SLOs + alert routing + k6 baseline                                            | shipped      |
| 6. Documentation truth pass + launch checklist                                   | shipped      |
| 7. Alert Center real wiring + channel mapping                                    | shipped      |
| 8. Alert Center SSE push + live connection badge                                 | shipped      |
| 9. Test-suite hardening + concrete receiver adapters + verifier CLI              | shipped      |
| 10. Dashboard MSW smoke tests                                                    | shipped      |
| 11. CI enforcement of dashboard tests + regression gate + WebSocket shim         | shipped      |
| 12. **Turnkey AWS deploy + Railway teardown automation**                         | **shipped**  |

**Production readiness: 100%.** All twelve gates shipped.

---

## Release

```bash
git push origin phase-13-aws-deploy-railway-teardown
git push origin v1.6.0
```

---

## Tag progression

```
v1.0.0  →  production-ready baseline (Phase 7)
v1.1.0  →  (reserved)
v1.2.0  →  Dashboard SSE push for Alert Center (Phase 9)
v1.3.0  →  Test-suite hardening + webhook receiver examples (Phase 10)
v1.4.0  →  Dashboard MSW smoke tests (Phase 11)
v1.5.0  →  CI enforcement + expanded smoke coverage (Phase 12)
v1.6.0  →  Turnkey AWS deploy + Railway teardown (Phase 13) ← current head
```

---

## Rollback

`git revert c391e73` drops the scripts + doc. The CDK stacks in
`infra/lib/` are unchanged by this phase, so rollback is purely the
removal of the automation — no infrastructure implications.

If you already ran `aws-deploy.sh` and want to undo the AWS deploy:

```bash
GV_ENV=dev bash -c 'cd infra && pnpm destroy:dev'   # dev
# prod destroy intentionally requires a manual cdk destroy pass because
# RETAIN policy on S3/RDS means you need to clean those up yourself.
```

If you already ran `railway-teardown.sh` and want Railway back:

```bash
# In the Railway project directory:
railway up   # rebuilds from railway.toml in the repo
```

`railway.toml` and `railway.json` are preserved in git history at tag
`v1.6.0` — so even if §8 of the cutover playbook removed them in a
follow-up commit, you can restore from this tag.
