# GodsView AWS Deployment Guide

Quick reference for deploying GodsView to AWS infrastructure.

## Quick Start

### 1. Pre-Deployment (5 minutes)

```bash
# Install prerequisites
aws --version          # AWS CLI v2+
cdk --version         # AWS CDK 2.100.0+
docker --version      # Docker 20.10.0+
node --version        # Node 18.0.0+
pnpm --version        # pnpm 9.0.0+

# Configure AWS credentials
aws configure --profile godsview
export AWS_PROFILE=godsview

# Copy and update environment file
cp .env.example .env
# Edit .env with your Alpaca keys, Anthropic API key, etc.
```

### 2. Run Validation (2 minutes)

```bash
bash scripts/validate-deploy.sh
# All checks should pass before proceeding
```

### 3. Deploy Staging (Dev) (30 minutes)

```bash
# Deploy infrastructure
cd infra
pnpm install
pnpm deploy:dev

# Push Docker image
docker build -t $(aws cloudformation describe-stacks --stack-name godsview-dev-storage --query "Stacks[0].Outputs[?OutputKey=='ApiRepoUri'].OutputValue" --output text):latest .
docker push $(aws cloudformation describe-stacks --stack-name godsview-dev-storage --query "Stacks[0].Outputs[?OutputKey=='ApiRepoUri'].OutputValue" --output text):latest

# Deploy application
aws ecs update-service --cluster godsview-dev --service ApiService --force-new-deployment

# Deploy dashboard
pnpm --filter @workspace/dashboard build
aws s3 sync artifacts/godsview-dashboard/dist/ s3://$(aws cloudformation describe-stacks --stack-name godsview-dev-storage --query "Stacks[0].Outputs[?OutputKey=='DashboardBucketName'].OutputValue" --output text)/
```

### 4. Deploy Production (Prod) (45 minutes + approval)

Same as staging but:
- Use `pnpm deploy:prod` (requires approval)
- Automatically handles multi-AZ, auto-scaling, backups
- Requires manual approval in CI/CD pipeline

---

## Files Overview

### Documentation

| File | Purpose |
|------|---------|
| `infra/README.md` | Quick CDK reference |
| `infra/DEPLOY_RUNBOOK.md` | Detailed deployment procedures |
| `infra/INFRASTRUCTURE_SUMMARY.md` | Complete infrastructure overview |
| `DEPLOYMENT_GUIDE.md` | This file - quick reference |

### Scripts

| Script | Purpose |
|--------|---------|
| `scripts/validate-deploy.sh` | Pre-deployment validation |
| `scripts/aws-deploy.sh` | Complete deployment automation |
| `scripts/aws-preflight.sh` | AWS permission checks |
| `scripts/health-check-all.sh` | Post-deployment verification |

### Infrastructure

| Directory | Purpose |
|-----------|---------|
| `infra/bin/` | CDK entry point |
| `infra/lib/` | CDK stacks (network, storage, data, compute) |
| `infra/compose/` | Docker Compose for local development |

### CI/CD

| File | Purpose |
|------|---------|
| `.github/workflows/deploy.yml` | Production deployment pipeline |
| `.github/workflows/ci.yml` | Testing and linting |
| `.github/workflows/production-ci.yml` | Production checks |

---

## Deployment Architecture

### Network Stack
- VPC with 10.20.0.0/16 CIDR
- 2 Availability Zones
- Public, private, and isolated subnets
- NAT gateways (1 dev, 2 prod)

### Storage Stack
- S3 buckets (dashboard, models, logs)
- ECR repository for Docker images
- Versioning and lifecycle policies

### Data Stack
- RDS PostgreSQL (db.t4g.micro dev, db.t4g.large prod)
- ElastiCache Redis (single dev, replicated prod)
- Secrets Manager for credentials

### Compute Stack
- ECS Fargate cluster
- Application Load Balancer
- CloudFront CDN for dashboard
- Auto-scaling (prod only)
- CloudWatch monitoring

---

## Common Tasks

### View Deployment Status

```bash
# Check CloudFormation stacks
aws cloudformation describe-stacks \
  --query 'Stacks[*].[StackName,StackStatus]' \
  --output table

# Check ECS service
aws ecs describe-services \
  --cluster godsview-dev \
  --services ApiService \
  --query 'services[0].{Status:status, Desired:desiredCount, Running:runningCount}' \
  --output table

# Check RDS
aws rds describe-db-instances \
  --query 'DBInstances[?contains(DBInstanceIdentifier, `godsview`)].{Id:DBInstanceIdentifier, Status:DBInstanceStatus}' \
  --output table
```

### View Logs

```bash
# API logs
aws logs tail /ecs/godsview-dev/api --follow

# Filter for errors
aws logs tail /ecs/godsview-dev/api --follow --filter-pattern "ERROR"

# Get logs from specific time
aws logs tail /ecs/godsview-dev/api --since 1h
```

### Scale ECS Service (Dev)

```bash
# Scale to 3 tasks
aws ecs update-service \
  --cluster godsview-dev \
  --service ApiService \
  --desired-count 3
```

### Rotate Database Password

```bash
NEW_PASSWORD=$(openssl rand -base64 32)

aws rds modify-db-instance \
  --db-instance-identifier godsview-dev-db \
  --master-user-password "$NEW_PASSWORD" \
  --apply-immediately

# Update Secrets Manager
aws secretsmanager update-secret \
  --secret-id godsview-dev-db \
  --secret-string "{\"username\":\"godsview\",\"password\":\"$NEW_PASSWORD\"}"

# Restart service to use new password
aws ecs update-service \
  --cluster godsview-dev \
  --service ApiService \
  --force-new-deployment
```

### Rollback to Previous Image

```bash
# If deployment fails and health checks fail:
aws ecs update-service \
  --cluster godsview-dev \
  --service ApiService \
  --force-new-deployment  # Uses previous task definition

# Or explicitly specify previous task definition revision
aws ecs update-service \
  --cluster godsview-dev \
  --service ApiService \
  --task-definition godsview-dev-api:PREVIOUS_REVISION \
  --force-new-deployment
```

---

## Environment Variables

Key variables required in `.env`:

```bash
# AWS
AWS_PROFILE=godsview
AWS_REGION=us-east-1

# Alpaca Trading
ALPACA_API_KEY=your-key
ALPACA_SECRET_KEY=your-secret
ALPACA_BASE_URL=https://paper-api.alpaca.markets

# Anthropic (Claude)
ANTHROPIC_API_KEY=your-api-key

# Safety Controls
GODSVIEW_SYSTEM_MODE=paper              # or 'live'
GODSVIEW_ENABLE_LIVE_TRADING=false
GODSVIEW_MAX_DAILY_LOSS_USD=250
GODSVIEW_MAX_OPEN_EXPOSURE_PCT=0.6

# Database
POSTGRES_PASSWORD=strong-random-password
DB_POOL_MAX=10
```

See `.env.example` for complete list.

---

## Troubleshooting

### Validation Script Fails

```bash
# Run with verbose output
VERBOSE=1 bash scripts/validate-deploy.sh

# Check specific prerequisites
aws sts get-caller-identity  # AWS credentials
docker ps                     # Docker daemon
cdk --version               # CDK installed
```

### Deployment Fails

```bash
# Check CloudFormation events
aws cloudformation describe-stack-events \
  --stack-name godsview-dev-compute \
  --query 'StackEvents[*].[Timestamp,ResourceStatus,ResourceStatusReason]' \
  | head -20

# Check ECS task logs
aws logs tail /ecs/godsview-dev/api --follow

# If networking issue, check security groups
aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=*godsview*" \
  --query 'SecurityGroups[*].[GroupName,GroupId]' \
  --output table
```

### Service Won't Start

```bash
# Get detailed task info
aws ecs describe-tasks \
  --cluster godsview-dev \
  --tasks $(aws ecs list-tasks --cluster godsview-dev --query 'taskArns[0]' --output text) \
  --query 'tasks[0].[lastStatus, stoppedReason]'

# Check RDS is reachable
aws rds describe-db-instances \
  --db-instance-identifier godsview-dev-db \
  --query 'DBInstances[0].DBInstanceStatus'

# Check Redis is reachable
aws elasticache describe-cache-clusters \
  --cache-cluster-id godsview-dev-redis \
  --show-cache-node-info \
  --query 'CacheClusters[0].CacheClusterStatus'
```

### API Returns 502

```bash
# Check target health
ALB_ARN=$(aws cloudformation describe-stacks \
  --stack-name godsview-dev-compute \
  --query "Stacks[0].Outputs[?OutputKey=='LoadBalancerArn'].OutputValue" \
  --output text)

TARGET_GROUP=$(aws elbv2 describe-target-groups \
  --load-balancer-arn "$ALB_ARN" \
  --query 'TargetGroups[0].TargetGroupArn' \
  --output text)

aws elbv2 describe-target-health --target-group-arn "$TARGET_GROUP"

# Check if service has running tasks
aws ecs describe-services \
  --cluster godsview-dev \
  --services ApiService \
  --query 'services[0].{Desired:desiredCount,Running:runningCount,Pending:pendingCount}'
```

---

## Monitoring

### CloudWatch Metrics

```bash
# CPU utilization
aws cloudwatch get-metric-statistics \
  --namespace AWS/ECS \
  --metric-name CPUUtilization \
  --dimensions Name=ServiceName,Value=ApiService Name=ClusterName,Value=godsview-dev \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average,Maximum

# ALB request count
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApplicationELB \
  --metric-name RequestCount \
  --dimensions Name=LoadBalancer,Value=app/godsview-dev-alb/xxx \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

### Set Up Alarms

```bash
# High CPU alarm
aws cloudwatch put-metric-alarm \
  --alarm-name godsview-dev-high-cpu \
  --alarm-description "CPU > 80%" \
  --metric-name CPUUtilization \
  --namespace AWS/ECS \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2
```

---

## Cost Optimization

### Development Environment
- Use `db.t4g.micro` for RDS (burstable, ~$13/month)
- Single NAT gateway (~$32/month)
- Single ECS task (~$36/month)
- Total: ~$120/month

### Production Environment (Baseline)
- Use `db.t4g.large` for RDS (~$250/month)
- Multi-AZ RDS (+failover, no extra cost)
- Two NAT gateways for HA (~$64/month)
- Two ECS tasks with auto-scaling 2-10 (~$180-900+/month depending on load)
- CloudFront (~$10-50/month depending on traffic)
- Total: ~$650+/month baseline

### Cost Reduction Tips
1. Use auto-scaling (prod): Down-scale during low traffic
2. Use spot instances: Not supported by Fargate yet
3. Reserved instances: For predictable prod workloads
4. CloudFront caching: Reduce origin requests

---

## Next Steps

1. **Deploy Staging**: Follow quick start above
2. **Run Health Checks**: `bash scripts/health-check-all.sh`
3. **Test Application**: Access via ALB DNS
4. **Monitor**: Set up CloudWatch dashboards
5. **Plan Production**: Review cost estimates, capacity planning
6. **Deploy Production**: Use CI/CD pipeline with approval gate

---

## Support

- **Documentation**: See files in `infra/` directory
- **Issues**: Check CloudFormation events and ECS logs
- **On-Call**: [Team PagerDuty] for production issues
- **AWS TAM**: For AWS service support

---

**Last Updated**: 2026-04-21
**Version**: 1.0
**CDK Version**: 2.158.0+
