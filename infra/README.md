# GodsView AWS Infrastructure

CDK (TypeScript) stack for the GodsView production deployment.

## Stacks

| Stack             | What it provisions                                                            |
| ----------------- | ----------------------------------------------------------------------------- |
| `*-network`       | VPC (10.20.0.0/16), 2 AZs, public + private-egress + isolated subnets, NAT(s) |
| `*-storage`       | S3 buckets (dashboard, models, logs), ECR repo for the api image              |
| `*-data`          | RDS Postgres 16, ElastiCache Redis, Secrets Manager (db creds + broker keys)  |
| `*-compute`       | ECS Fargate cluster running the api, ALB, CloudFront in front of dashboard    |

## Environments

Both `dev` and `prod` are supported. They differ in:

| Aspect           | dev                | prod                              |
| ---------------- | ------------------ | --------------------------------- |
| NAT gateways     | 1                  | 2 (HA)                            |
| RDS instance     | db.t4g.micro       | db.t4g.large, multi-AZ            |
| RDS backups      | 1 day              | 14 days, deletion protected       |
| Redis            | cache.t4g.micro    | replication group (cache.t4g.small × 2) |
| Fargate tasks    | 1, cpu 512/1024    | 2 (auto-scale 2→10), cpu 1024/2048 |
| Removal policy   | DESTROY            | RETAIN                            |
| Versioned S3     | no                 | yes                               |

## Prerequisites

```bash
npm install -g aws-cdk
aws configure  # set credentials + default region
```

## Bootstrap (once per account/region)

```bash
cd infra
pnpm install
npx cdk bootstrap aws://<account-id>/<region>
```

## Deploy

```bash
# Synthesize first to verify
pnpm synth

# Dev
pnpm deploy:dev

# Prod (broadening approval = warns on IAM/SG widening)
pnpm deploy:prod
```

## After first deploy

1. Open the `godsview-prod-broker` secret in Secrets Manager and put your real Alpaca keys in it.
2. Push your api image:

   ```bash
   ECR_URI=$(aws cloudformation describe-stacks \
     --stack-name godsview-prod-compute \
     --query "Stacks[0].Outputs[?OutputKey=='ApiRepoUri'].OutputValue" \
     --output text)
   aws ecr get-login-password | docker login --username AWS --password-stdin $ECR_URI
   docker build -t $ECR_URI:latest .
   docker push $ECR_URI:latest
   ```

3. Force a service redeploy:

   ```bash
   aws ecs update-service --cluster godsview-prod \
     --service ApiService --force-new-deployment
   ```

4. Sync the dashboard build:

   ```bash
   pnpm --filter @workspace/dashboard build
   aws s3 sync artifacts/godsview-dashboard/dist/ s3://godsview-prod-dashboard-<account-id>/ --delete
   ```

## Destroy (dev only — prod has retention)

```bash
pnpm destroy:dev
```

## Cost estimate

Rough monthly costs in `us-east-1`:

| Component        | dev          | prod          |
| ---------------- | ------------ | ------------- |
| NAT              | $32 × 1      | $32 × 2 = $64 |
| RDS              | $13          | $250          |
| Redis            | $13          | $90           |
| Fargate          | $36          | $180+         |
| ALB              | $20          | $20           |
| CloudFront       | usage        | usage         |
| S3 + ECR         | < $5         | < $20         |
| **Total floor**  | **~$120/mo** | **~$650/mo**  |

Live numbers depend on traffic, storage growth, and CloudWatch retention.
