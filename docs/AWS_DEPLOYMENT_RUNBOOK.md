# GodsView — AWS Deployment Runbook

**Last updated:** 2026-04-26
**Target environment:** single-region production stack (us-east-1 by default).

This runbook is the step-by-step bring-up. Every command is meant to be
copy-pasted. Anywhere you see `${VAR}`, set the value beforehand.

---

## 0. Prerequisites

- AWS CLI v2 authenticated to the target account
- Domain name + ACM certificate (us-east-1 for CloudFront, us-east-1 or regional for ALB)
- An RDS-eligible VPC (3 AZs, private subnets, NAT gateway)
- Docker image built and pushed to GHCR or ECR (CI handles this)

```
export AWS_REGION=us-east-1
export PROJECT=godsview
export ENV=prod
```

## 1. Networking

```
# 3 private subnets + 3 public subnets across 3 AZs.
# Use an existing VPC, or terraform/cloudformation to provision one.
```

Required: ALB sits in public subnets, ECS tasks + RDS + ElastiCache in private subnets, NAT gateway for outbound.

## 2. Secrets

```
aws secretsmanager create-secret --name ${PROJECT}/${ENV}/db_password \
  --secret-string "$(openssl rand -base64 32)"
aws secretsmanager create-secret --name ${PROJECT}/${ENV}/jwt_secret \
  --secret-string "$(openssl rand -hex 64)"
aws secretsmanager create-secret --name ${PROJECT}/${ENV}/tradingview_webhook_secret \
  --secret-string "$(openssl rand -hex 32)"
aws secretsmanager create-secret --name ${PROJECT}/${ENV}/operator_token \
  --secret-string "$(openssl rand -hex 32)"
# Alpaca only when going live:
aws secretsmanager create-secret --name ${PROJECT}/${ENV}/alpaca_key    --secret-string "PK..."
aws secretsmanager create-secret --name ${PROJECT}/${ENV}/alpaca_secret --secret-string "..."
```

## 3. Database — RDS Postgres

```
aws rds create-db-instance \
  --db-instance-identifier ${PROJECT}-${ENV} \
  --db-instance-class db.t4g.medium \
  --engine postgres --engine-version 16.4 \
  --allocated-storage 50 --storage-type gp3 \
  --master-username godsview \
  --master-user-password "$(aws secretsmanager get-secret-value --secret-id ${PROJECT}/${ENV}/db_password --query SecretString --output text)" \
  --backup-retention-period 7 \
  --multi-az \
  --vpc-security-group-ids ${SG_DB} \
  --db-subnet-group-name ${SUBNET_GROUP_DB} \
  --no-publicly-accessible \
  --deletion-protection
```

Take a baseline snapshot once the instance is healthy:

```
aws rds create-db-snapshot --db-instance-identifier ${PROJECT}-${ENV} \
  --db-snapshot-identifier ${PROJECT}-${ENV}-baseline-$(date +%Y%m%d)
```

## 4. Redis — ElastiCache

```
aws elasticache create-cache-cluster \
  --cache-cluster-id ${PROJECT}-${ENV} \
  --cache-node-type cache.t4g.small \
  --engine redis --engine-version 7.x \
  --num-cache-nodes 1 \
  --cache-subnet-group-name ${SUBNET_GROUP_CACHE} \
  --security-group-ids ${SG_CACHE}
```

## 5. ECS — Cluster + service

Build and push the image (CI does this on `main`):

```
docker build -t ${PROJECT}:$(git rev-parse --short HEAD) .
docker tag  ${PROJECT}:$(git rev-parse --short HEAD) ghcr.io/santhakumarramesh/godsview:latest
docker push ghcr.io/santhakumarramesh/godsview:latest
```

Task definition (essential fields only):

```
{
  "family": "godsview-api",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024", "memory": "2048",
  "taskRoleArn": "arn:aws:iam::ACCT:role/godsview-task",
  "executionRoleArn": "arn:aws:iam::ACCT:role/godsview-exec",
  "containerDefinitions": [{
    "name": "api",
    "image": "ghcr.io/santhakumarramesh/godsview:latest",
    "portMappings": [{ "containerPort": 3001 }],
    "environment": [
      { "name": "NODE_ENV",      "value": "production" },
      { "name": "EXECUTION_MODE","value": "paper" }
    ],
    "secrets": [
      { "name": "DATABASE_URL",                "valueFrom": "arn:aws:secretsmanager:...:db_url"           },
      { "name": "REDIS_URL",                   "valueFrom": "arn:aws:secretsmanager:...:redis_url"        },
      { "name": "JWT_SECRET",                  "valueFrom": "arn:aws:secretsmanager:...:jwt_secret"       },
      { "name": "TRADINGVIEW_WEBHOOK_SECRET",  "valueFrom": "arn:aws:secretsmanager:...:tv_secret"        },
      { "name": "GODSVIEW_OPERATOR_TOKEN",     "valueFrom": "arn:aws:secretsmanager:...:operator_token"   }
    ],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "/ecs/godsview", "awslogs-region": "us-east-1", "awslogs-stream-prefix": "api"
      }
    },
    "healthCheck": {
      "command": ["CMD-SHELL", "curl -fsS http://localhost:3001/health || exit 1"],
      "interval": 30, "timeout": 5, "retries": 3, "startPeriod": 60
    }
  }]
}
```

## 6. ALB

- HTTPS listener on 443 with the ACM cert
- Target group on port 3001, healthcheck path `/health`
- Path rules: `/api/*`, `/tradingview/*` → API target group; everything else → CloudFront

## 7. CloudFront + S3 (dashboard)

```
# Build dashboard
cd artifacts/godsview-dashboard
pnpm install --frozen-lockfile
pnpm run build
aws s3 sync dist/public/ s3://${PROJECT}-${ENV}-dashboard/ --delete --cache-control "max-age=300"
aws cloudfront create-invalidation --distribution-id ${CF_DIST} --paths "/*"
```

CloudFront origin: S3 for static assets, ALB origin for `/api/*` and `/tradingview/*`.

## 8. DNS

```
# Route53
aws route53 change-resource-record-sets --hosted-zone-id ${ZONE} \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "godsview.example.com",
        "Type": "A",
        "AliasTarget": { "DNSName": "${CF_DIST}.cloudfront.net", "HostedZoneId": "Z2FDTNDATAQYW2", "EvaluateTargetHealth": false }
      }
    }]
  }'
```

## 9. Migrations + seed (first deploy)

```
# Connect to running task
aws ecs execute-command --cluster godsview --task ${TASK_ID} \
  --container api --interactive --command "/bin/sh"

# Inside the container:
node /app/dist/migrate.js
node /app/dist/seed.js
```

## 10. Smoke test in production

```
curl -fsS https://godsview.example.com/health
curl -fsS https://godsview.example.com/api/system/status | jq .
```

Send a real Pine alert against the prod TV secret and verify:
- HTTP 201
- envelope contains signal/trade/audit IDs
- the row exists in RDS

## 11. Monitoring + alarms

CloudWatch alarms to wire (one per item):
- ECS service: any unhealthy task → SNS → PagerDuty
- ALB 5xx > 1% over 5 min → SNS
- RDS CPU > 80% sustained 10 min → SNS
- RDS free-storage < 10 GB → SNS
- Redis evictions > 0 → SNS
- Custom metric: `signals_rejected_per_min` > 50 → SNS (possible attack or data quality drop)

## 12. Backup + restore (DR test)

```
# Take an on-demand snapshot weekly
aws rds create-db-snapshot --db-instance-identifier ${PROJECT}-${ENV} \
  --db-snapshot-identifier ${PROJECT}-${ENV}-weekly-$(date +%Y%m%d)

# Restore drill (do this in a non-prod account or staging cluster):
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier ${PROJECT}-restore-test \
  --db-snapshot-identifier ${PROJECT}-${ENV}-weekly-YYYYMMDD
```

A quarterly DR drill is required before flipping to assisted-live or autonomous.

## 13. Rollback

```
# Revert the ECS service to the previous task definition revision
aws ecs update-service --cluster godsview --service godsview-api \
  --task-definition godsview-api:${PREV_REV}
# Force redeploy
aws ecs update-service --cluster godsview --service godsview-api --force-new-deployment
```

If the new image is broken at boot, the service will keep the old tasks running because the new ones won't pass healthcheck. ALB drains and we're back. Document the incident in `docs/runbooks/`.

## 14. Cost guardrails

- ECS Fargate t4g.medium-class task at 1024 cpu / 2048 mem ≈ $35/mo (24×7)
- RDS t4g.medium multi-AZ ≈ $90/mo
- ElastiCache t4g.small ≈ $15/mo
- ALB ≈ $18/mo + data
- CloudFront ≈ $1–10/mo for low traffic
- S3 ≈ $1/mo
- NAT gateway ≈ $35/mo + data — single-NAT trade-off for cost
- Total floor: ~$200/mo in prod, before paid users.
