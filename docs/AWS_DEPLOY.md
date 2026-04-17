# GodsView — AWS Production Deploy Runbook

This runbook walks through deploying the full GodsView stack on AWS from a
clean account. It assumes you have the AWS CLI configured, Docker installed,
and `pnpm` available locally.

The architecture we deploy is:

```
                           ┌──────────────────────────────┐
  Internet ─▶ Route 53 ─▶ │  ALB (TLS via ACM)            │
                           └──────────────┬───────────────┘
                                          │
                   ┌──────────────────────┼──────────────────────┐
                   ▼                      ▼                      ▼
          ┌──────────────┐        ┌──────────────┐       ┌──────────────┐
          │ ECS Fargate  │        │ ECS Fargate  │       │ ECS Fargate  │
          │   api-server │        │ py-gateway   │       │   dashboard  │
          │  (Node 22)   │        │ (FastAPI)    │       │  (nginx)     │
          └──────┬───────┘        └──────┬───────┘       └──────────────┘
                 │                       │
                 ▼                       ▼
          ┌──────────────┐        ┌──────────────┐
          │  RDS Postgres│        │ ElastiCache  │
          │   (Neon-     │        │    Redis     │
          │    compatible│        │              │
          │     schema)  │        │              │
          └──────────────┘        └──────────────┘
```

The Python microservice plane (`market-data`, `feature`, `backtest`, `ml`,
`execution`, `risk`, `memory`, `scheduler`) is optional and only needed if
you want the full v2 research stack. Everything below treats it as an add-on
that plugs in behind the same ALB.

---

## 0. Prerequisites

Before you start, confirm the following on your local machine:

```
aws --version            # >= 2.15
docker --version         # >= 24
pnpm --version           # >= 10
node --version           # >= 22.20
```

AWS resources you need on hand:

- An AWS account and an IAM user with at least `AdministratorAccess` for
  the first deploy (you can tighten later).
- A registered domain and an **ACM public certificate** issued in the same
  region you plan to deploy to (us-east-1 is easiest).
- An **ECR** repository per container image (we create these below).

The targets we build on AWS:

- **Compute**: ECS on Fargate (arm64 — AWS Graviton) for the API and the
  dashboard.
- **Database**: RDS Postgres 16 (single-AZ for staging, Multi-AZ for live).
- **Cache / pub-sub**: ElastiCache Redis (required only for the v2 Python
  microservices).
- **Secrets**: AWS Secrets Manager.
- **Logs**: CloudWatch Logs (`/godsview/*`).

---

## 1. One-time AWS Setup

### 1a. Create the VPC + subnets

```
aws ec2 create-vpc --cidr-block 10.42.0.0/16 \
  --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=godsview-vpc}]'
```

Create three public subnets (for the ALB) and three private subnets (for
ECS tasks, RDS, and ElastiCache). Attach an Internet Gateway to the VPC
and a NAT Gateway to each AZ. The exact `aws ec2 create-subnet` commands
are standard and omitted here for brevity — a CloudFormation template
mirror of this layout lives in `infra/cfn/network.yaml` (tracked
separately).

### 1b. Create ECR repositories

```
for svc in godsview-api godsview-dashboard godsview-py-gateway \
           godsview-py-market-data godsview-py-feature \
           godsview-py-backtest godsview-py-ml godsview-py-execution \
           godsview-py-risk godsview-py-memory godsview-py-scheduler; do
  aws ecr create-repository --repository-name $svc \
    --image-scanning-configuration scanOnPush=true \
    --encryption-configuration encryptionType=AES256
done
```

### 1c. Secrets Manager entries

Create one secret per logical group. Example:

```
aws secretsmanager create-secret --name godsview/prod/database \
  --secret-string '{"DATABASE_URL":"postgres://..."}'

aws secretsmanager create-secret --name godsview/prod/alpaca \
  --secret-string '{"ALPACA_API_KEY":"...","ALPACA_SECRET_KEY":"..."}'

aws secretsmanager create-secret --name godsview/prod/anthropic \
  --secret-string '{"ANTHROPIC_API_KEY":"..."}'

aws secretsmanager create-secret --name godsview/prod/app \
  --secret-string '{"GODSVIEW_OPERATOR_TOKEN":"...","JWT_SECRET":"..."}'
```

The ECS Task Execution Role will need `secretsmanager:GetSecretValue` on
these ARNs.

---

## 2. Build and push images

From the repo root on your workstation (must be ARM64 to use Graviton
targets — on x86 hosts, prefix the build with `docker buildx build
--platform linux/arm64`):

```
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export AWS_REGION=us-east-1
export ECR=${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com

aws ecr get-login-password --region $AWS_REGION | \
  docker login --username AWS --password-stdin $ECR
```

### 2a. API + dashboard single-process image

The default `Dockerfile` at the repo root builds the Node API with the
dashboard baked in (`artifacts/api-server/public`), which is the
simplest and cheapest production topology.

```
docker buildx build --platform linux/arm64 \
  -t $ECR/godsview-api:latest \
  -f Dockerfile . --push
```

### 2b. Dashboard (optional, for CDN / separate hosting)

If you'd rather host the dashboard on CloudFront + S3 instead of embedding
it in the API process:

```
pnpm --filter @workspace/godsview-dashboard build
aws s3 sync artifacts/godsview-dashboard/dist/public/ \
  s3://godsview-dashboard-prod/ --delete
aws cloudfront create-invalidation \
  --distribution-id $CF_DIST --paths '/*'
```

### 2c. Python microservices (profile v2 only)

Each Python service shares `services/Dockerfile`. Build once and retag:

```
docker buildx build --platform linux/arm64 \
  -t $ECR/godsview-py-gateway:latest \
  -f services/Dockerfile services --push

for svc in market-data feature backtest ml execution risk memory scheduler; do
  docker tag  $ECR/godsview-py-gateway:latest $ECR/godsview-py-$svc:latest
  docker push $ECR/godsview-py-$svc:latest
done
```

Each container reads `SERVICE=<name>` and dispatches inside its entrypoint.

---

## 3. RDS Postgres

```
aws rds create-db-instance \
  --db-instance-identifier godsview-prod \
  --db-instance-class db.t4g.small \
  --engine postgres --engine-version 16.3 \
  --master-username godsview --master-user-password "$(openssl rand -hex 16)" \
  --allocated-storage 50 --storage-type gp3 \
  --db-name godsview \
  --vpc-security-group-ids sg-xxxxxxxx \
  --db-subnet-group-name godsview-private \
  --backup-retention-period 7 \
  --deletion-protection
```

Once it's `available`, run the Drizzle migrations:

```
DATABASE_URL=postgres://godsview:...@host:5432/godsview?sslmode=require \
  pnpm run db:push
```

---

## 4. ElastiCache Redis (v2 profile only)

```
aws elasticache create-cache-cluster \
  --cache-cluster-id godsview-redis \
  --engine redis --engine-version 7.1 \
  --cache-node-type cache.t4g.small \
  --num-cache-nodes 1 \
  --cache-subnet-group-name godsview-private \
  --security-group-ids sg-xxxxxxxx
```

---

## 5. ECS cluster + task definitions

Create the cluster:

```
aws ecs create-cluster --cluster-name godsview \
  --capacity-providers FARGATE FARGATE_SPOT
```

### 5a. api-server task

Task definition highlights (reference: `infra/ecs/api-task.json`):

```
{
  "family": "godsview-api",
  "runtimePlatform": { "cpuArchitecture": "ARM64", "operatingSystemFamily": "LINUX" },
  "cpu": "1024", "memory": "2048",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "executionRoleArn": "arn:aws:iam::ACCOUNT:role/godsview-task-execution",
  "taskRoleArn":      "arn:aws:iam::ACCOUNT:role/godsview-api-task",
  "containerDefinitions": [{
    "name": "api",
    "image": "ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/godsview-api:latest",
    "portMappings": [{ "containerPort": 3000, "protocol": "tcp" }],
    "essential": true,
    "environment": [
      { "name": "NODE_ENV",          "value": "production" },
      { "name": "PORT",              "value": "3000" },
      { "name": "CORS_ORIGINS",      "value": "https://godsview.example.com" },
      { "name": "TRUST_PROXY",       "value": "1" },
      { "name": "GODSVIEW_SYSTEM_MODE", "value": "paper" },
      { "name": "BRAIN_AUTOSTART",   "value": "true" },
      { "name": "GODSVIEW_DATA_DIR", "value": "/var/lib/godsview" }
    ],
    "secrets": [
      { "name": "DATABASE_URL",            "valueFrom": "arn:aws:secretsmanager:...:godsview/prod/database:DATABASE_URL::" },
      { "name": "ALPACA_API_KEY",          "valueFrom": "arn:aws:secretsmanager:...:godsview/prod/alpaca:ALPACA_API_KEY::" },
      { "name": "ALPACA_SECRET_KEY",       "valueFrom": "arn:aws:secretsmanager:...:godsview/prod/alpaca:ALPACA_SECRET_KEY::" },
      { "name": "ANTHROPIC_API_KEY",       "valueFrom": "arn:aws:secretsmanager:...:godsview/prod/anthropic:ANTHROPIC_API_KEY::" },
      { "name": "GODSVIEW_OPERATOR_TOKEN", "valueFrom": "arn:aws:secretsmanager:...:godsview/prod/app:GODSVIEW_OPERATOR_TOKEN::" }
    ],
    "healthCheck": {
      "command": ["CMD-SHELL", "wget -qO- http://localhost:3000/healthz || exit 1"],
      "interval": 30, "timeout": 5, "retries": 3, "startPeriod": 60
    },
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group":         "/godsview/api",
        "awslogs-region":        "us-east-1",
        "awslogs-stream-prefix": "api"
      }
    }
  }]
}
```

Register it and create the service:

```
aws ecs register-task-definition --cli-input-json file://infra/ecs/api-task.json
aws ecs create-service \
  --cluster godsview --service-name godsview-api \
  --task-definition godsview-api --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-priv-a,subnet-priv-b,subnet-priv-c],securityGroups=[sg-api],assignPublicIp=DISABLED}" \
  --load-balancers "targetGroupArn=arn:aws:elasticloadbalancing:...,containerName=api,containerPort=3000" \
  --health-check-grace-period-seconds 90 \
  --deployment-configuration "maximumPercent=200,minimumHealthyPercent=50"
```

### 5b. Python services (v2 profile)

Repeat the pattern above for each `godsview-py-*` service, using
`services/Dockerfile`. Set `SERVICE=<name>` as an environment variable so
the shared entrypoint knows which FastAPI app to start. All v2 services
share the same cluster and VPC but each has its own target group on the
internal ALB (port `8081` for the gateway, `8090`+ for the others).

---

## 6. Application Load Balancer

Create the ALB in the three public subnets, attach your ACM certificate,
and define these listener rules:

```
443 default           → target group: godsview-api       (host: godsview.example.com)
443 /api/v2/*         → target group: godsview-py-gateway
443 /healthz          → target group: godsview-api
80  *                 → redirect to 443
```

Enable **HTTP/2**, set idle timeout to `120s`, and turn on access logs to
an S3 bucket.

---

## 7. DNS + TLS

```
aws route53 change-resource-record-sets --hosted-zone-id ZXXXXXXXX \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "godsview.example.com",
        "Type": "A",
        "AliasTarget": {
          "HostedZoneId": "Z35SXDOTRQ7X7K",
          "DNSName": "dualstack.godsview-alb-xxxxx.us-east-1.elb.amazonaws.com",
          "EvaluateTargetHealth": true
        }
      }
    }]
  }'
```

ACM certificates attached to the ALB auto-renew.

---

## 8. Post-deploy verification

From your workstation:

```
# 1. ALB is routing traffic
curl -sSf https://godsview.example.com/healthz
# → {"status":"ok", ...}

# 2. Dashboard is served
curl -sSf https://godsview.example.com/ | head -c 200
# → <!doctype html><html>...

# 3. Key API endpoints respond
curl -sSf "https://godsview.example.com/api/signals?limit=5"
curl -sSf "https://godsview.example.com/api/alpaca/ticker?symbols=AAPL"
curl -sSf "https://godsview.example.com/api/alpaca/accuracy"

# 4. SSE stream is open (should emit `retry:` line + data frames)
curl -sN --max-time 5 "https://godsview.example.com/api/alpaca/stream?symbols=AAPL"
```

Inside the AWS console:

- ECS Service `godsview-api` shows `running=desired` and all tasks
  healthy.
- CloudWatch `/godsview/api` log group shows `Server listening` and
  `Alpaca market data stream started` entries.
- ALB target group shows `healthy` for every task.

---

## 9. Rollback procedure

Every deploy is recorded as an ECS task definition revision. To roll back:

```
# List recent task definitions
aws ecs list-task-definitions --family-prefix godsview-api \
  --sort DESC --max-results 5

# Re-point the service at the previous revision
aws ecs update-service \
  --cluster godsview --service godsview-api \
  --task-definition godsview-api:PREVIOUS_REVISION \
  --force-new-deployment
```

If you need to roll back a database migration, prefer a forward-fix
migration. Destructive rollbacks are only safe during the first 5 minutes
after a deploy, before production data has written new rows.

---

## 10. Operational notes

- **Autoscaling**: Target tracking on CPU at 60%. Min=2, Max=10 for the
  API. Python services scale on message queue depth.
- **Backups**: RDS automatic snapshots with 7-day retention plus a daily
  logical dump to S3 via the `db:backup` job.
- **Cost estimate** (Graviton, 2 tasks, RDS `db.t4g.small`, single-AZ,
  no Python plane): **~$85–110/month** before bandwidth.
- **Live trading**: Do NOT flip `GODSVIEW_SYSTEM_MODE=live_enabled` until
  you've run `pnpm run verify:release` green against the deployed instance
  and rotated `GODSVIEW_OPERATOR_TOKEN`.
- **Kill switch**: Set the ECS service desired count to `0` — the ALB will
  start returning `503` within 30 seconds and the brain stops issuing
  new orders. Open positions on Alpaca are unaffected.

---

## 11. Common failures and fixes

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Tasks crash-loop with `ENV variable is required` | Secret not mapped in task def | Add the secret to `containerDefinitions[0].secrets` |
| Tasks healthy but ALB says `unhealthy` | Security group blocks SG of ALB | Add ALB SG ingress on port 3000 |
| `DATABASE_URL` auth fails | RDS security group excludes ECS SG | Add ingress 5432 from the ECS SG |
| Dashboard blank, API responds | Missing `/dashboard/dist/public` copy | Re-run `pnpm build` and push the image |
| `No module named 'app'` in Python logs | `GODSVIEW_SERVICE_ROOT` unset | Export `SERVICE=<name>` in the task env |
| 502 from `/api/alpaca/stream` | ALB idle timeout too short | Raise to 120s on the listener |

---

## 12. Next steps

- Wire CI/CD: push to `main` → GitHub Actions builds images, pushes to
  ECR, and updates task definitions (see `.github/workflows/deploy.yml`).
- Add **AWS WAF** rules in front of the ALB for basic bot and SQLi
  protection.
- Enable **GuardDuty** and **Security Hub** on the account.
- Replicate into a second region if you need multi-region failover.
