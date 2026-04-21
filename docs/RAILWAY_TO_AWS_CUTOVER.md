# Railway → AWS Cutover Playbook

This is the step-by-step migration from the Railway-hosted GodsView
deployment to the AWS production stack defined in `infra/`. The strategy
is **stand AWS up first, verify, then tear Railway down** — at no point
is GodsView without a live endpoint.

> **Sequence at a glance:**
>
> 1. Deploy AWS **dev** (fast feedback loop, single NAT, t4g.micro).
> 2. Smoke-test AWS dev for ~24h while Railway keeps serving live traffic.
> 3. Deploy AWS **prod** (multi-AZ, auto-scaled, RDS Multi-AZ, RETAIN policy).
> 4. Migrate Postgres data from Railway → RDS (snapshot + restore window).
> 5. Flip DNS to the AWS ALB / CloudFront. Drain via low TTL.
> 6. Watch metrics for 24h. If green, run `scripts/railway-teardown.sh`.
> 7. Update `LAUNCH_CHECKLIST.md` to reference the new endpoint.

If something goes sideways at any step, **leave Railway running** —
rollback is "flip DNS back, fix root cause, re-attempt cutover."

---

## 0. Prerequisites

- AWS account with admin / power-user IAM (you'll be running CDK).
- AWS profile authenticated locally (`aws sts get-caller-identity` works).
- Docker daemon running (api-server image build + push).
- Node ≥ 20, pnpm ≥ 9, k6 (for the perf gate in `LAUNCH_CHECKLIST.md` §3).
- Railway CLI authenticated (`railway login`) for the teardown step.
- DNS authority for the production domain (Route 53 hosted zone or a way
  to update your registrar's records).

Run the preflight first — it's read-only and answers "are we ready?":

```bash
GV_ENV=dev bash scripts/aws-preflight.sh
```

Fix any `fail` lines before going further.

---

## 1. Deploy AWS dev

```bash
GV_ENV=dev bash scripts/aws-deploy.sh
```

What this does (from `scripts/aws-deploy.sh`):

1. Re-runs preflight.
2. CDK-bootstraps the account/region if not already done.
3. Installs deps, builds, runs the full test suite (api-server + dashboard).
4. Builds the dashboard Vite bundle and (after the StorageStack lands)
   syncs it to `s3://godsview-dev-dashboard-<account>/`.
5. Builds the api-server Docker image (linux/arm64), pushes it to ECR
   `godsview-dev-api:<git-sha>` and `:latest`.
6. `cdk deploy --all -c env=dev` — lands all four stacks
   (`network`, `storage`, `data`, `compute`).
7. Polls `http://<alb-dns>/api/healthz` for up to 10 minutes.

Expect the first deploy to take ~25-35 minutes (RDS is the slow leg).

When the script exits 0 you'll see the ALB DNS and CloudFront URL.
Smoke-test:

```bash
export DEV_API="http://<alb-dns-from-deploy>"
curl -sf $DEV_API/api/healthz                        | jq .
curl -sf $DEV_API/api/readyz                         | jq .
curl -sf $DEV_API/api/governance/scheduler/status    | jq '.status, .lastRunAt'
curl -sf $DEV_API/api/calibration/scheduler/status   | jq '.status, .lastRunAt'
curl -sf $DEV_API/api/slo/router/status              | jq '.router.running'
```

All should return `200` and the schedulers should be `running`. Send a
test alert (uses the operator token you stored in Secrets Manager):

```bash
curl -sf -X POST $DEV_API/api/ops/test-alert \
  -H "Authorization: Bearer $GODSVIEW_OPERATOR_TOKEN"
```

A message should arrive in the configured Slack / PagerDuty channel
within ~10 seconds.

> **Bake time.** Leave dev running ≥ 24h. Watch CloudWatch Logs and the
> SLO budgets endpoint. If anything misbehaves, fix it on dev — Railway
> is still serving live users, so you have unlimited time.

---

## 2. Deploy AWS prod

Once dev is stable:

```bash
GV_ENV=prod bash scripts/aws-deploy.sh
```

The script will prompt for `yes` confirmation before touching prod. The
prod stack is materially heavier than dev — see `infra/lib/` for the
exact deltas — so plan ~40-60 minutes for a first-time deploy:

| Resource           | dev               | prod                                   |
| ------------------ | ----------------- | -------------------------------------- |
| NAT gateways       | 1 (cheap path)    | 2 (one per AZ, no SPOF)                |
| RDS                | t4g.micro single  | t4g.large Multi-AZ + 7-day backups     |
| ECS                | 1 task 512/1024   | 2 tasks auto-scale 2→10, 1024/2048     |
| Removal policy     | DESTROY           | RETAIN (S3, RDS)                       |

After deploy, repeat the smoke-test block from §1 against the prod ALB.
Don't flip DNS yet — Railway is still authoritative.

---

## 3. Pre-cutover DNS prep

In your hosted zone (Route 53 or wherever your record lives):

1. **Lower TTL on the production record to 60s, ≥ 30 minutes before the
   cutover.** This is the single most important step. If you skip it,
   downstream resolvers will pin Railway's IP for whatever the previous
   TTL was (often 1 hour).
2. Verify the ALB and CloudFront distribution are healthy:
   ```bash
   aws elbv2 describe-target-health \
     --target-group-arn $(aws elbv2 describe-target-groups \
       --names godsview-prod-api-tg --query 'TargetGroups[0].TargetGroupArn' \
       --output text) \
     --region us-east-1
   ```
   All targets should be `healthy`.
3. Confirm the ACM certificate covers the production domain (CloudFront
   needs an ACM cert in us-east-1 regardless of where the ALB lives).

---

## 4. Migrate Postgres from Railway → RDS

If GodsView state on Railway is just rolling SLO observations and
recent ring-buffer artifacts, you can skip a real migration — the AWS
side will rebuild from live signal flow within an hour. Otherwise:

```bash
# 1. From the Railway dashboard or CLI, take a logical dump:
PGPASSWORD=<railway-pg-password> pg_dump \
  -h <railway-pg-host> -U <railway-pg-user> -d <railway-db-name> \
  --no-owner --no-privileges \
  -F c -f /tmp/godsview-railway.dump

# 2. Get the RDS endpoint + secret from Secrets Manager:
RDS_HOST=$(aws cloudformation describe-stacks --stack-name godsview-prod-data \
  --query "Stacks[0].Outputs[?OutputKey=='DbEndpoint'].OutputValue" \
  --output text)
RDS_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id godsview/prod/db --query SecretString --output text)

# 3. Restore (during a 5-minute maintenance window — pause writes on
#    Railway by stopping its api service):
PGPASSWORD=$(echo $RDS_SECRET | jq -r .password) pg_restore \
  -h $RDS_HOST -U $(echo $RDS_SECRET | jq -r .username) \
  -d godsview --no-owner --no-privileges \
  --clean --if-exists /tmp/godsview-railway.dump
```

If the migration fails halfway, RDS RETAIN policy + AWS automated backups
let you re-restore at will. Don't proceed to DNS flip until restore
completes cleanly.

---

## 5. DNS flip

In Route 53:

```bash
aws route53 change-resource-record-sets --hosted-zone-id <ZONE_ID> \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "api.godsview.example.com",
        "Type": "A",
        "AliasTarget": {
          "HostedZoneId": "<ALB_HOSTED_ZONE_ID>",
          "DNSName": "<ALB_DNS_NAME>",
          "EvaluateTargetHealth": true
        }
      }
    }]
  }'
```

Watch DNS propagation:

```bash
for i in $(seq 1 20); do
  dig +short api.godsview.example.com
  sleep 30
done
```

When most resolvers return the AWS ALB (or its alias), the cutover is
effectively done. Run smoke tests against the public hostname:

```bash
export PROD_API="https://api.godsview.example.com"
curl -sf $PROD_API/api/healthz | jq .
curl -sf $PROD_API/api/readyz  | jq .
```

---

## 6. Bake time on AWS (24h)

Don't tear down Railway yet. For 24h:

- Watch CloudWatch Logs for the api-server task.
- Watch SLO budgets:
  ```bash
  curl -sf $PROD_API/api/slo/budgets | jq '.snapshot | map({id, errorBudgetRemaining, sampleCount})'
  ```
- Watch the alert router status:
  ```bash
  curl -sf $PROD_API/api/slo/router/status | jq '.router.running, .router.forwardedCount'
  ```
- If a Railway resolver still hits the old endpoint (you'll see it in
  Railway logs), wait — TTL is still draining.

If anything regresses, the rollback is one DNS change away — flip the
record back to the Railway endpoint while you investigate.

---

## 7. Tear down Railway

Once the AWS stack has been green for 24h:

```bash
RAILWAY_SERVICE=<your-railway-service-name> \
  bash scripts/railway-teardown.sh
```

The teardown script enforces a hard gate:

- It re-checks `/api/healthz` and `/api/readyz` against the AWS ALB.
- It refuses to run if either probe is non-200 (you can override with
  `GV_SKIP_AWS_CHECK=1`, but don't).
- It prompts for `delete <service-name>` confirmation (skip with `GV_YES=1`).
- It runs `railway down`, then `railway service delete`, then verifies
  the service no longer appears in `railway service list`.

What the script intentionally does NOT do:

- Delete the Railway *project* itself (you may want to keep the project
  shell for billing history). Delete it from the dashboard if desired.
- Delete Railway-managed databases (Postgres, Redis). Snapshot and
  delete those manually after you're certain you no longer need them.

---

## 8. Post-cutover housekeeping

- [ ] Update `docs/LAUNCH_CHECKLIST.md` §6 to use the AWS hostname.
- [ ] Remove `railway.toml` and `railway.json` from the repo (they no
      longer reflect a live target). Optional: keep them with a comment
      pointing at the cutover commit, in case someone wants the history.
- [ ] Update CI to drop any Railway-specific deploy step (the
      `.github/workflows/ci.yml` `deploy` job in this repo already SSHes
      directly to a target; no Railway hooks are present).
- [ ] Bump the launch-checklist tag and write a release note.

---

## 9. Rollback procedure (if cutover fails mid-flight)

| Where you are                        | Rollback                                                    |
| ------------------------------------ | ----------------------------------------------------------- |
| AWS dev fails to deploy              | `cd infra && pnpm destroy:dev` — Railway is unaffected      |
| AWS prod deploys but health probes red | Don't flip DNS. Investigate. Railway still serving live     |
| DNS flipped, AWS regresses           | Flip DNS back to the Railway record (prep this command in advance) |
| Postgres restore fails               | Roll forward — the script left the previous DB intact; restore from RDS automated backup |
| Already torn down Railway, AWS dies  | Re-deploy Railway from `railway.toml` — it's still in git history |

For the very last row: tag `v1.6.0` is your last "Railway-and-AWS"
checkpoint. Anything tagged after that is AWS-only. Plan accordingly.

---

## Reference

- `scripts/aws-preflight.sh`   — read-only validator; run any time
- `scripts/aws-deploy.sh`      — turnkey AWS deploy
- `scripts/railway-teardown.sh` — gated Railway teardown
- `infra/lib/`                  — CDK stacks
- `docs/AWS_DEPLOY.md`          — Phase 3 CDK deep-dive (still authoritative)
- `docs/LAUNCH_CHECKLIST.md`    — pre-launch gate
- `docs/OPERATOR_RUNBOOK.md`    — day-2 operations
