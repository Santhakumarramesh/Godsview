# Phase 3 — AWS Infrastructure as Code (CDK / TypeScript)

**Branch:** `phase-3-aws-cdk`
**Base:** `phase-2-remove-mocks` (commit `3ff42e1`)
**Head:** `9464530`
**Patch:** `phase-3/0001-phase-3-AWS-infrastructure-as-code-via-CDK-TypeScrip.patch`
**Files changed:** 10 (728 insertions, 1 deletion)

---

## What this phase delivers

The third hard production gate: **AWS production deploy via reproducible code**.

Before this phase, the deploy story was a hand-written runbook (`AWS_PRODUCTION_DEPLOY_RUNBOOK.md`) listing console clicks and CLI commands. Drift was guaranteed, rollback was prayer-driven, and "prod" and "dev" had no shared definition.

This phase replaces that with a four-stack AWS CDK app that provisions everything from network to load balancer, with environment-aware sizing baked in. One `pnpm deploy:dev` or `pnpm deploy:prod` command stands up the entire stack.

---

## Apply

```bash
cd /path/to/Godsview
git checkout phase-2-remove-mocks
git checkout -b phase-3-aws-cdk
git am < phase-3/0001-phase-3-AWS-infrastructure-as-code-via-CDK-TypeScrip.patch
```

Or apply directly without branching:

```bash
git apply phase-3/0001-phase-3-AWS-infrastructure-as-code-via-CDK-TypeScrip.patch
```

---

## Stacks shipped

| Stack             | Construct file                | Provisions                                                                          |
| ----------------- | ----------------------------- | ----------------------------------------------------------------------------------- |
| `*-network`       | `infra/lib/network-stack.ts`  | VPC `10.20.0.0/16`, 2 AZs, public + private-egress + isolated subnets, NAT(s), flow logs |
| `*-storage`       | `infra/lib/storage-stack.ts`  | S3 buckets (dashboard, models, logs), ECR repo (`godsview-{env}-api`)               |
| `*-data`          | `infra/lib/data-stack.ts`     | RDS Postgres 16.4, ElastiCache Redis 7.1, Secrets Manager (DB creds + broker slot)  |
| `*-compute`       | `infra/lib/compute-stack.ts`  | ECS Fargate cluster, ALB, CloudFront in front of dashboard                          |

Stack dependency order: **Network → (Storage + Data) → Compute** (compute consumes outputs from all three).

---

## dev vs prod

| Aspect           | dev                | prod                                       |
| ---------------- | ------------------ | ------------------------------------------ |
| NAT gateways     | 1                  | 2 (HA)                                     |
| RDS instance     | db.t4g.micro       | db.t4g.large, multi-AZ                     |
| RDS storage      | 20 → 100 GB        | 100 → 1000 GB                              |
| RDS backups      | 1 day              | 14 days, deletion protected                |
| Performance Insights | off            | on                                         |
| Redis            | cache.t4g.micro single | replication group cache.t4g.small × 2, TLS, auto-failover |
| Fargate tasks    | 1, cpu 512 / mem 1024  | 2 (auto-scale 2→10), cpu 1024 / mem 2048 |
| ECR retention    | 20 images          | 20 images                                  |
| Container Insights | on               | on                                         |
| Removal policy   | DESTROY            | RETAIN                                     |
| Versioned S3     | no                 | yes                                        |
| S3 lifecycle (logs) | 14 days expire  | 90 days expire                             |
| S3 lifecycle (model experiments) | 30 days  | 365 days                                   |
| ECS exec command | enabled            | disabled                                   |
| ALB              | HTTP-only listener | HTTP-only listener (TLS terminated at CloudFront) |

CloudFront sits in front of both: the static dashboard from S3 (with Origin Access Control) and the API behind the ALB (`/api/*` behavior, no caching, ALL_VIEWER originRequestPolicy).

---

## Verification

```bash
cd infra
pnpm install

# Lint
pnpm typecheck

# Synthesize (generates CloudFormation, validates without deploying)
pnpm synth -- -c env=dev
pnpm synth -- -c env=prod

# Diff against deployed (after first deploy)
pnpm diff:dev
```

The repo's root `pnpm typecheck` already passes (`tsc --build` exit 0 across all workspace packages including `infra`).

---

## Operator playbook (post-merge)

### One-time bootstrap (per AWS account / region)

```bash
npm install -g aws-cdk
aws configure                         # set credentials + default region
cd infra && pnpm install
npx cdk bootstrap aws://<account-id>/<region>
```

### Deploy

```bash
cd infra
pnpm deploy:dev      # spins up dev environment
pnpm deploy:prod     # broadens approval prompts on IAM/SG widening
```

### After first deploy — fill the broker secret

The `BrokerKeys` secret is created with placeholder values. Open it in the Secrets Manager console (or via CLI) and put the real Alpaca keys:

```json
{
  "ALPACA_API_KEY": "AK...",
  "ALPACA_SECRET_KEY": "..."
}
```

Until this is done, the api will run in `runtimeConfig.hasAlpacaKeys = false` mode and (per Phase 2) every broker-dependent endpoint will respond `503 broker_not_configured` in production. That is the intended fail-closed behavior.

### Push the api image

```bash
ECR_URI=$(aws cloudformation describe-stacks \
  --stack-name godsview-prod-compute \
  --query "Stacks[0].Outputs[?OutputKey=='ApiRepoUri'].OutputValue" \
  --output text)
aws ecr get-login-password | docker login --username AWS --password-stdin $ECR_URI
docker build -t $ECR_URI:latest -f api-server/Dockerfile .
docker push $ECR_URI:latest

aws ecs update-service --cluster godsview-prod \
  --service ApiService --force-new-deployment
```

### Sync the dashboard

```bash
DASH_BUCKET=$(aws cloudformation describe-stacks \
  --stack-name godsview-prod-storage \
  --query "Stacks[0].Outputs[?starts_with(OutputKey,'Dashboard')].OutputValue" \
  --output text)
pnpm --filter @workspace/dashboard build
aws s3 sync artifacts/godsview-dashboard/dist/ s3://$DASH_BUCKET/ --delete
```

### Destroy (dev only — prod is RETAIN)

```bash
cd infra && pnpm destroy:dev
```

---

## Cost (us-east-1, monthly floor)

| Component        | dev          | prod          |
| ---------------- | ------------ | ------------- |
| NAT              | $32          | $64           |
| RDS              | $13          | $250          |
| Redis            | $13          | $90           |
| Fargate          | $36          | $180+         |
| ALB              | $20          | $20           |
| CloudFront       | usage-based  | usage-based   |
| S3 + ECR         | < $5         | < $20         |
| **Floor**        | **~$120/mo** | **~$650/mo**  |

Real numbers depend on traffic, storage growth, CloudWatch retention.

---

## What's NOT in this phase (deferred to later)

- **HTTPS on ALB** — currently HTTP-only because TLS is terminated at CloudFront. To put TLS on the ALB itself (for direct ALB clients), add an ACM cert + Route 53 hosted zone + listener on 443. Deferred until a custom domain is registered.
- **WAF** — CloudFront and ALB both have WAF integration points. Add when you have a real attack surface.
- **GuardDuty / Security Hub** — account-level, deserves its own stack.
- **Backups beyond RDS PITR** — AWS Backup vault for cross-region copies should be a separate stack.
- **CI/CD wiring** — the GitHub Actions workflow that calls `pnpm deploy:prod` on merge to main is Phase 6 territory.
- **Observability** — Phase 6 adds CloudWatch alarms, X-Ray, k6 load test baseline.

---

## Production-readiness gate status after Phase 3

| Gate                                                          | Status        |
| ------------------------------------------------------------- | ------------- |
| 1. TradingView MCP + webhook router                           | shipped (pre-existing, validated in Phase 1) |
| 2. Backtesting → paper → assisted live → auto-promotion        | partial — backtesting + paper exist; auto-promotion is Phase 5 |
| 3. **AWS production deploy**                                  | **DONE**      |
| 4. All 68 sidebar pages with RBAC                             | Phase 4 (next) |

---

## Next phase

**Phase 4 — Page gap closure (68/68 with hooks + tests).** Audit the dashboard sidebar against the four-quadrant page map, fill any missing pages, ensure each one consumes data via `@tanstack/react-query` hooks (no fetch-in-render), and add per-page vitest coverage with MSW handlers for happy / loading / error states.
