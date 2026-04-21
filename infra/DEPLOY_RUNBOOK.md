# GodsView AWS Deployment Runbook

Complete guide for deploying GodsView to AWS staging and production environments.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Pre-Deployment Verification](#pre-deployment-verification)
3. [Staging Deployment](#staging-deployment)
4. [Production Deployment](#production-deployment)
5. [Post-Deployment Health Verification](#post-deployment-health-verification)
6. [Rollback Procedures](#rollback-procedures)
7. [Secrets Rotation](#secrets-rotation)
8. [Monitoring and Observability](#monitoring-and-observability)
9. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Tools

Install the following tools before deploying:

```bash
# AWS CLI v2
aws --version  # must be 2.x or later

# AWS CDK
npm install -g aws-cdk
cdk --version  # must be 2.100.0 or later

# Docker
docker --version  # must be 20.10.0 or later

# Node.js and pnpm
node --version   # must be 18.0.0 or later
pnpm --version   # must be 9.0.0 or later

# Optional but recommended
jq              # for JSON parsing
watch           # for monitoring deployments
```

### AWS Account Setup

1. **AWS Credentials**: Configure AWS CLI with appropriate credentials.

   ```bash
   aws configure --profile godsview
   export AWS_PROFILE=godsview
   aws sts get-caller-identity  # verify credentials
   ```

2. **Required AWS Services Enabled**:
   - CloudFormation
   - EC2 (VPC, Security Groups, ECS, etc.)
   - RDS (Aurora/PostgreSQL)
   - ElastiCache (Redis)
   - ECR (Elastic Container Registry)
   - S3 (Simple Storage Service)
   - CloudFront
   - ALB (Application Load Balancer)
   - Secrets Manager
   - CloudWatch
   - CloudTrail (for audit logging)

3. **IAM Permissions**: Your IAM user/role must have permissions for:
   - CDK deployment (CloudFormation, EC2, RDS, ElastiCache, S3, ECR, IAM)
   - Secrets Manager read/write
   - CloudWatch logs and metrics

4. **Service Quotas**: Verify AWS service quotas:
   - VPCs: at least 1 available (default 5)
   - ECS clusters: at least 1 available (default 10)
   - NAT Gateways: 2 available for prod (default 5 per AZ)
   - Fargate vCPU: sufficient capacity (check CloudFormation errors)

### Environment Variables

Create a `.env` file in the repository root with these variables:

```bash
# AWS Configuration
AWS_PROFILE=godsview
AWS_REGION=us-east-1

# Alpaca (Paper/Live Trading)
ALPACA_API_KEY=your-api-key
ALPACA_SECRET_KEY=your-secret-key
ALPACA_BASE_URL=https://paper-api.alpaca.markets  # or https://api.alpaca.markets

# Anthropic (Claude for decision veto)
ANTHROPIC_API_KEY=your-anthropic-api-key
CLAUDE_VETO_MODEL=claude-sonnet-4-5-20241022
CLAUDE_TIMEOUT_MS=30000
CLAUDE_MAX_RETRIES=1

# Safety Controls
GODSVIEW_SYSTEM_MODE=paper       # or 'live'
GODSVIEW_ENABLE_LIVE_TRADING=false
GODSVIEW_KILL_SWITCH=false
GODSVIEW_MAX_DAILY_LOSS_USD=250
GODSVIEW_MAX_OPEN_EXPOSURE_PCT=0.6
GODSVIEW_MAX_TRADES_PER_SESSION=10
GODSVIEW_COOLDOWN_AFTER_LOSSES=3
GODSVIEW_COOLDOWN_MINUTES=30
GODSVIEW_BLOCK_ON_DEGRADED_DATA=true
GODSVIEW_OPERATOR_TOKEN=change-me-in-production

# Database
DB_POOL_MAX=10
POSTGRES_PASSWORD=strong-password-change-me

# Dashboard / CORS
CORS_ORIGIN=https://yourdomain.com  # staging or prod domain

# Economic Calendar (optional)
ECON_CALENDAR_URL=https://nfs.faireconomy.media/ff_calendar_thisweek.json

# Python Services (optional, only if v2 enabled)
PY_SERVICES_ENABLED=false
PY_GATEWAY_URL=http://py-gateway:8000
```

---

## Pre-Deployment Verification

Run the validation script to ensure all prerequisites are met:

```bash
bash scripts/validate-deploy.sh
```

This script checks:
- AWS credentials and CLI configuration
- Required environment variables
- Docker daemon availability
- Docker image builds (api-server, Python services)
- Database connectivity
- Redis connectivity
- Required AWS resources

**Do not proceed with deployment until all checks pass.**

---

## Staging Deployment

Staging is the testing environment (typically `dev` context in CDK).

### Step 1: Create/Update Infrastructure (one-time or as needed)

```bash
cd infra

# Install dependencies
pnpm install

# Verify the CDK app synthesizes correctly
pnpm synth

# View the CloudFormation changes before applying
pnpm diff

# Deploy infrastructure (includes VPC, RDS, Redis, ECR, S3, ALB)
GV_ENV=dev pnpm deploy:dev
```

**Expected CloudFormation stacks created**:
- `godsview-dev-network`
- `godsview-dev-storage`
- `godsview-dev-data`
- `godsview-dev-compute`

**Typical duration**: 15-25 minutes

### Step 2: Build and Push Docker Image

```bash
# From repository root
cd /path/to/godsview

# Get ECR repo URI from CloudFormation output
ECR_REPO=$(aws cloudformation describe-stacks \
  --stack-name godsview-dev-storage \
  --query "Stacks[0].Outputs[?OutputKey=='ApiRepoUri'].OutputValue" \
  --output text)

# Authenticate Docker with ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin $ECR_REPO

# Build and push the API image
docker build -t $ECR_REPO:latest \
  --build-arg ENVIRONMENT=staging \
  .

docker push $ECR_REPO:latest

# Tag as 'staging' for easy rollback
docker tag $ECR_REPO:latest $ECR_REPO:staging
docker push $ECR_REPO:staging
```

**Expected time**: 5-10 minutes

### Step 3: Populate Secrets Manager

Secrets are created as empty placeholder by CDK. Populate them with real values:

```bash
# Database credentials (auto-generated by RDS, typically in Secrets Manager)
# Verify they exist:
aws secretsmanager list-secrets | grep godsview-dev

# Broker/Alpaca credentials (manual)
aws secretsmanager put-secret-value \
  --secret-id godsview-dev-broker \
  --secret-string '{
    "alpaca_api_key": "'$ALPACA_API_KEY'",
    "alpaca_secret_key": "'$ALPACA_SECRET_KEY'",
    "alpaca_base_url": "'$ALPACA_BASE_URL'"
  }'
```

### Step 4: Update ECS Service

Force the ECS service to pull the new Docker image:

```bash
aws ecs update-service \
  --cluster godsview-dev \
  --service ApiService \
  --force-new-deployment \
  --region us-east-1
```

**Monitor deployment**:
```bash
aws ecs describe-services \
  --cluster godsview-dev \
  --services ApiService \
  --query 'services[0].{Status:status, DesiredCount:desiredCount, RunningCount:runningCount}' \
  --region us-east-1
```

### Step 5: Deploy Dashboard

```bash
# Build dashboard
pnpm --filter @workspace/dashboard build

# Get S3 bucket name
DASHBOARD_BUCKET=$(aws cloudformation describe-stacks \
  --stack-name godsview-dev-storage \
  --query "Stacks[0].Outputs[?OutputKey=='DashboardBucketName'].OutputValue" \
  --output text)

# Sync built files to S3
aws s3 sync artifacts/godsview-dashboard/dist/ \
  s3://$DASHBOARD_BUCKET/ \
  --delete \
  --cache-control "max-age=3600" \
  --exclude "*.html" \
  --metadata-directive REPLACE

# HTML files with no-cache
aws s3 sync artifacts/godsview-dashboard/dist/ \
  s3://$DASHBOARD_BUCKET/ \
  --include "*.html" \
  --exclude "*" \
  --cache-control "no-cache, must-revalidate" \
  --metadata-directive REPLACE
```

### Step 6: Verify Staging Deployment

```bash
# Run health checks
bash scripts/validate-deploy.sh
```

---

## Production Deployment

Production deployment follows the same steps but uses `prod` context and includes manual approval gates.

### Pre-Production Checklist

- [ ] Staging deployment is healthy for 24+ hours
- [ ] All tests pass in CI/CD pipeline
- [ ] Code review approved by at least 2 team members
- [ ] Change documentation updated
- [ ] Rollback plan documented
- [ ] On-call engineer notified
- [ ] Maintenance window scheduled (if applicable)

### Step 1: Create/Update Infrastructure

```bash
cd infra

pnpm install
pnpm synth

# View diff - THIS WILL REQUIRE MANUAL APPROVAL IF CHANGING IAM/SG
pnpm diff

# Deploy prod (requires broadening approval for IAM/SG changes)
GV_ENV=prod pnpm deploy:prod
```

**Expected CloudFormation stacks created**:
- `godsview-prod-network`
- `godsview-prod-storage`
- `godsview-prod-data`
- `godsview-prod-compute`

**Typical duration**: 25-35 minutes

### Step 2: Build and Push Production Image

```bash
cd /path/to/godsview

ECR_REPO=$(aws cloudformation describe-stacks \
  --stack-name godsview-prod-storage \
  --query "Stacks[0].Outputs[?OutputKey=='ApiRepoUri'].OutputValue" \
  --output text)

aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin $ECR_REPO

docker build -t $ECR_REPO:latest \
  --build-arg ENVIRONMENT=production \
  .

docker push $ECR_REPO:latest

# Tag with timestamp and git commit for traceability
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
GIT_SHA=$(git rev-parse --short HEAD)
docker tag $ECR_REPO:latest $ECR_REPO:prod-$TIMESTAMP-$GIT_SHA
docker push $ECR_REPO:prod-$TIMESTAMP-$GIT_SHA
```

### Step 3: Populate Production Secrets

```bash
# LIVE trading credentials - be extremely careful
aws secretsmanager put-secret-value \
  --secret-id godsview-prod-broker \
  --secret-string '{
    "alpaca_api_key": "'$PROD_ALPACA_API_KEY'",
    "alpaca_secret_key": "'$PROD_ALPACA_SECRET_KEY'",
    "alpaca_base_url": "https://api.alpaca.markets"
  }'

# Operator token for emergency controls
aws secretsmanager put-secret-value \
  --secret-id godsview-prod-operator \
  --secret-string '{
    "token": "'$(openssl rand -hex 32)'"
  }'
```

### Step 4: Perform Blue-Green Deployment

GodsView uses ALB target groups for zero-downtime deployments:

```bash
# Set environment to use new image
aws ecs update-service \
  --cluster godsview-prod \
  --service ApiService \
  --force-new-deployment \
  --region us-east-1

# Monitor rolling deployment
while true; do
  aws ecs describe-services \
    --cluster godsview-prod \
    --services ApiService \
    --query 'services[0].{Status:status, DesiredCount:desiredCount, RunningCount:runningCount, PendingCount:pendingCount}' \
    --region us-east-1
  sleep 10
done
```

**Safe rollout indicators**:
- Running count reaches desired count (typically 2-4 instances)
- Pending count returns to 0
- All health checks passing

### Step 5: Deploy Production Dashboard

```bash
pnpm --filter @workspace/dashboard build

DASHBOARD_BUCKET=$(aws cloudformation describe-stacks \
  --stack-name godsview-prod-storage \
  --query "Stacks[0].Outputs[?OutputKey=='DashboardBucketName'].OutputValue" \
  --output text)

aws s3 sync artifacts/godsview-dashboard/dist/ \
  s3://$DASHBOARD_BUCKET/ \
  --delete \
  --cache-control "max-age=86400" \
  --exclude "*.html" \
  --metadata-directive REPLACE

aws s3 sync artifacts/godsview-dashboard/dist/ \
  s3://$DASHBOARD_BUCKET/ \
  --include "*.html" \
  --exclude "*" \
  --cache-control "no-cache, must-revalidate" \
  --metadata-directive REPLACE

# Invalidate CloudFront cache
CLOUDFRONT_ID=$(aws cloudformation describe-stacks \
  --stack-name godsview-prod-compute \
  --query "Stacks[0].Outputs[?OutputKey=='DashboardDistributionId'].OutputValue" \
  --output text)

aws cloudfront create-invalidation \
  --distribution-id $CLOUDFRONT_ID \
  --paths "/*"
```

### Step 6: Verify Production Deployment

```bash
# Run comprehensive health checks
bash scripts/validate-deploy.sh

# Manual smoke tests
curl -s https://api.yourdomain.com/api/healthz | jq .
curl -s https://yourdomain.com/ | head -20
```

---

## Post-Deployment Health Verification

Run these checks immediately after deployment and continue monitoring for 1 hour.

### Immediate Checks (0-5 minutes)

```bash
# 1. API health endpoints
curl -v https://api.yourdomain.com/api/healthz
curl -v https://api.yourdomain.com/api/readyz

# 2. ECS service status
aws ecs describe-services \
  --cluster godsview-prod \
  --services ApiService \
  --query 'services[0].{Status:status, DesiredCount:desiredCount, RunningCount:runningCount}'

# 3. RDS database connectivity
ENDPOINT=$(aws rds describe-db-instances \
  --db-instance-identifier godsview-prod-db \
  --query 'DBInstances[0].Endpoint.Address' \
  --output text)
pg_isready -h $ENDPOINT -p 5432 -U godsview

# 4. Redis connectivity
REDIS_ENDPOINT=$(aws elasticache describe-cache-clusters \
  --cache-cluster-id godsview-prod-redis \
  --show-cache-node-info \
  --query 'CacheClusters[0].CacheNodes[0].Endpoint.Address' \
  --output text)
redis-cli -h $REDIS_ENDPOINT -p 6379 ping
```

### Extended Checks (5-60 minutes)

```bash
# 5. CloudWatch metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/ECS \
  --metric-name CPUUtilization \
  --dimensions Name=ServiceName,Value=ApiService Name=ClusterName,Value=godsview-prod \
  --start-time $(date -u -d '15 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 \
  --statistics Average,Maximum

# 6. ALB target health
ALB_ARN=$(aws cloudformation describe-stacks \
  --stack-name godsview-prod-compute \
  --query "Stacks[0].Outputs[?OutputKey=='LoadBalancerArn'].OutputValue" \
  --output text)

TARGET_GROUP_ARN=$(aws elbv2 describe-target-groups \
  --load-balancer-arn $ALB_ARN \
  --query 'TargetGroups[0].TargetGroupArn' \
  --output text)

aws elbv2 describe-target-health \
  --target-group-arn $TARGET_GROUP_ARN \
  --query 'TargetHealthDescriptions[*].{Target:Target.Id, State:TargetHealth.State, Reason:TargetHealth.Reason}'

# 7. Application logs
aws logs tail /ecs/godsview-prod/api --follow --max-items 100
```

### Success Criteria

All of the following must be true:

- ✓ API responds to `/api/healthz` with HTTP 200
- ✓ API responds to `/api/readyz` with HTTP 200 and `{"ready": true}`
- ✓ ECS service has all desired tasks running and healthy
- ✓ RDS database responds to connectivity check
- ✓ Redis responds to PING
- ✓ ALB reports all targets as healthy
- ✓ No ERROR or FATAL logs in past 5 minutes
- ✓ CPU utilization below 70%, memory below 80%
- ✓ Dashboard loads without 5xx errors

---

## Rollback Procedures

### Rollback Types

#### 1. Fast Rollback (within 5 minutes of deployment)

**If ECS deployment hasn't completed or health checks fail:**

```bash
# Revert to previous task definition
CLUSTER=godsview-prod
SERVICE=ApiService

# Get previous task definition revision
PREVIOUS_TASK=$(aws ecs describe-services \
  --cluster $CLUSTER \
  --services $SERVICE \
  --query 'services[0].taskDefinition' \
  --output text | sed 's/:.*/:/' | xargs -I {} bash -c 'aws ecs list-task-definitions --family-prefix godsview-prod-api --query "taskDefinitionArns[-2]" --output text')

# Update service to use previous task definition
aws ecs update-service \
  --cluster $CLUSTER \
  --service $SERVICE \
  --task-definition $PREVIOUS_TASK \
  --force-new-deployment
```

#### 2. Standard Rollback (5-60 minutes after deployment)

**If critical issues discovered, revert to previous Docker image:**

```bash
ECR_REPO=$(aws cloudformation describe-stacks \
  --stack-name godsview-prod-storage \
  --query "Stacks[0].Outputs[?OutputKey=='ApiRepoUri'].OutputValue" \
  --output text)

# Get previous image tag
PREVIOUS_IMAGE=$(aws ecr describe-images \
  --repository-name godsview \
  --query 'imageDetails | sort_by(@, &imagePushedAt) | [-2].imageTags[0]' \
  --output text)

# Force redeploy with previous image
aws ecs update-service \
  --cluster godsview-prod \
  --service ApiService \
  --task-definition godsview-prod-api:LATEST \
  --force-new-deployment

# Monitor rollback
watch -n 5 'aws ecs describe-services \
  --cluster godsview-prod \
  --services ApiService \
  --query "services[0].{Status:status, DesiredCount:desiredCount, RunningCount:runningCount}"'
```

#### 3. Database Rollback (RDS Snapshot Restore)

**If database corruption or data loss occurs:**

```bash
# List available backups
aws rds describe-db-snapshots \
  --db-instance-identifier godsview-prod-db \
  --query 'DBSnapshots[*].[DBSnapshotIdentifier, SnapshotCreateTime, Status]' \
  --output table

# Restore from snapshot (creates new instance, requires manual DNS cutover)
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier godsview-prod-db-restore \
  --db-snapshot-identifier <snapshot-id> \
  --db-instance-class db.t4g.large

# Monitor restoration
aws rds describe-db-instances \
  --db-instance-identifier godsview-prod-db-restore \
  --query 'DBInstances[0].[DBInstanceStatus, PercentProgress]'
```

#### 4. Infrastructure Rollback (Stack Restore)

**If CDK deploy introduces breaking changes (rare):**

```bash
# List CloudFormation stack events to identify issues
aws cloudformation describe-stack-events \
  --stack-name godsview-prod-compute \
  --query 'StackEvents[*].[Timestamp, ResourceStatus, ResourceStatusReason]' \
  --output table | head -20

# For database/networking changes, use RDS/VPC snapshots rather than
# CloudFormation rollback (manually update DNS, security groups, etc.)
```

### Rollback Decision Tree

```
Is the API responding?
├─ Yes, but with errors
│  ├─ Health check failing? → Fast Rollback
│  └─ Business logic broken? → Standard Rollback
├─ No
│  ├─ Did ECS finish deployment? → Fast Rollback
│  └─ Database connectivity lost? → Database Rollback
└─ Infrastructure broken
   └─ Infrastructure Rollback + manual review
```

---

## Secrets Rotation

### Database Password Rotation

```bash
# Generate new password
NEW_PASSWORD=$(openssl rand -base64 32)

# Update RDS
aws rds modify-db-instance \
  --db-instance-identifier godsview-prod-db \
  --master-user-password "$NEW_PASSWORD" \
  --apply-immediately

# Update Secrets Manager
aws secretsmanager update-secret \
  --secret-id godsview-prod-db \
  --secret-string '{
    "username": "godsview",
    "password": "'$NEW_PASSWORD'"
  }'

# Restart ECS service to pick up new credentials
aws ecs update-service \
  --cluster godsview-prod \
  --service ApiService \
  --force-new-deployment
```

### Alpaca / Broker Credentials Rotation

```bash
# 1. Generate new API keys in Alpaca dashboard
# 2. Update Secrets Manager
aws secretsmanager put-secret-value \
  --secret-id godsview-prod-broker \
  --secret-string '{
    "alpaca_api_key": "'$NEW_API_KEY'",
    "alpaca_secret_key": "'$NEW_SECRET_KEY'",
    "alpaca_base_url": "https://api.alpaca.markets"
  }'

# 3. Restart service
aws ecs update-service \
  --cluster godsview-prod \
  --service ApiService \
  --force-new-deployment

# 4. Verify by checking /api/status endpoint (should show connection OK)
curl https://api.yourdomain.com/api/status
```

### Anthropic API Key Rotation

```bash
# 1. Generate new key in Anthropic dashboard
# 2. Update .env or deploy new image with new key

# If using environment variables via ECS task definition:
aws ecs register-task-definition \
  --family godsview-prod-api \
  --cli-input-json file://task-definition.json
  # Update ANTHROPIC_API_KEY in JSON first

# 3. Force service redeploy
aws ecs update-service \
  --cluster godsview-prod \
  --service ApiService \
  --force-new-deployment
```

### Rotation Schedule

- **Database passwords**: Every 90 days
- **Broker/Alpaca credentials**: When rotating keys (recommended every 180 days)
- **Anthropic API keys**: When rotating keys (recommended every 180 days)
- **Operator token**: Every 30 days (emergency access only)

---

## Monitoring and Observability

### CloudWatch Dashboard

Access the GodsView dashboard:

```bash
# Navigate to CloudWatch in AWS Console
# Look for: GodsView-prod or godsview-prod dashboard

# Or create one programmatically
aws cloudwatch put-dashboard \
  --dashboard-name godsview-prod \
  --dashboard-body file://monitoring/dashboard.json
```

### Key Metrics to Monitor

```bash
# ECS CPU/Memory
aws cloudwatch get-metric-statistics \
  --namespace AWS/ECS \
  --metric-name CPUUtilization \
  --dimensions Name=ServiceName,Value=ApiService Name=ClusterName,Value=godsview-prod \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 \
  --statistics Average,Maximum

# RDS connections
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name DatabaseConnections \
  --dimensions Name=DBInstanceIdentifier,Value=godsview-prod-db \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 \
  --statistics Average

# ALB request count
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApplicationELB \
  --metric-name RequestCount \
  --dimensions Name=LoadBalancer,Value=app/godsview-prod-alb/xxx \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

### Log Aggregation

```bash
# View recent errors
aws logs tail /ecs/godsview-prod/api --follow --filter-pattern "ERROR"

# Count errors by type
aws logs filter-log-events \
  --log-group-name /ecs/godsview-prod/api \
  --filter-pattern "ERROR" \
  --start-time $(($(date +%s%N) - 3600000)) \
  --query 'events[*].message' \
  --output text | sort | uniq -c | sort -rn
```

### Alarms and Notifications

Set up SNS alerts for critical conditions:

```bash
# High CPU alarm
aws cloudwatch put-metric-alarm \
  --alarm-name godsview-prod-high-cpu \
  --alarm-description "Alert when ECS CPU exceeds 80%" \
  --metric-name CPUUtilization \
  --namespace AWS/ECS \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT:AlertTopic

# Service unhealthy
aws cloudwatch put-metric-alarm \
  --alarm-name godsview-prod-unhealthy-targets \
  --alarm-description "Alert when ALB targets are unhealthy" \
  --metric-name UnHealthyHostCount \
  --namespace AWS/ApplicationELB \
  --statistic Average \
  --period 60 \
  --threshold 0 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT:AlertTopic
```

---

## Troubleshooting

### Issue: "ECS Task stops immediately after starting"

**Symptoms**: Task goes from PENDING → RUNNING → STOPPED in seconds

**Diagnosis**:
```bash
# Check ECS task logs
aws ecs describe-tasks \
  --cluster godsview-prod \
  --tasks <task-arn> \
  --query 'tasks[0].stoppedReason'

# Check CloudWatch logs
aws logs tail /ecs/godsview-prod/api --follow
```

**Common Causes & Solutions**:

1. **Missing environment variables**
   ```bash
   # Verify secret is accessible
   aws secretsmanager get-secret-value --secret-id godsview-prod-db
   ```

2. **Database unreachable**
   ```bash
   # Verify RDS is running
   aws rds describe-db-instances --db-instance-identifier godsview-prod-db
   
   # Check security group allows ECS → RDS
   aws ec2 describe-security-groups --group-ids sg-xxx
   ```

3. **Docker image doesn't exist**
   ```bash
   # List available images
   aws ecr describe-images --repository-name godsview
   ```

### Issue: "ALB returning 502 Bad Gateway"

**Symptoms**: API requests timeout or return 502

**Diagnosis**:
```bash
# Check target health
aws elbv2 describe-target-health \
  --target-group-arn <target-group-arn> \
  --query 'TargetHealthDescriptions[*].{Target:Target.Id, State:TargetHealth.State, Reason:TargetHealth.Reason}'

# Check ECS service
aws ecs describe-services \
  --cluster godsview-prod \
  --services ApiService
```

**Solutions**:
- Increase task timeout in ALB target group
- Scale up ECS task count if overwhelmed
- Check application logs for crashes

### Issue: "Database connection pool exhausted"

**Symptoms**: "too many connections" errors in logs

**Solutions**:
```bash
# Increase connection pool
aws ecs register-task-definition \
  --family godsview-prod-api \
  --container-definitions '[{"name": "api", "environment": [{"name": "DB_POOL_MAX", "value": "20"}]}]'

# Increase RDS max connections
aws rds modify-db-instance \
  --db-instance-identifier godsview-prod-db \
  --db-parameter-group-name custom-godsview-params \
  --apply-immediately
```

### Issue: "Redis connection timeout"

**Symptoms**: Cache operations fail, APIs slower

**Diagnosis**:
```bash
# Check Redis cluster
aws elasticache describe-cache-clusters \
  --cache-cluster-id godsview-prod-redis \
  --show-cache-node-info

# Try direct connection
redis-cli -h <redis-endpoint> -p 6379 ping
```

**Solutions**:
- Scale up Redis instance
- Check security group allows ECS → Redis
- Review CloudWatch Redis CPU/memory metrics

### Issue: "Out of memory on Fargate task"

**Symptoms**: Task killed with OOMKilled signal

**Solutions**:
```bash
# Increase task memory
aws ecs register-task-definition \
  --family godsview-prod-api \
  --memory 2048 \
  --cpu 1024
```

---

## Support and Escalation

| Severity | Response | Owner |
|----------|----------|-------|
| Service down | 5 minutes | On-call engineer |
| Degraded performance | 15 minutes | Engineering team |
| Security incident | Immediately | Security team + on-call |
| Non-critical bug | Next business day | Engineering backlog |

**Escalation contacts**:
- On-call engineer: [Defined in team PagerDuty]
- Engineering lead: [Defined in team Slack]
- AWS TAM: [AWS support case]

---

## Appendix: Useful Commands

```bash
# Get all stack outputs
aws cloudformation describe-stacks \
  --stack-name godsview-prod-compute \
  --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' \
  --output table

# Monitor deployment in real-time
watch -n 5 'aws ecs describe-services \
  --cluster godsview-prod \
  --services ApiService \
  --query "services[0].{Status:status,Desired:desiredCount,Running:runningCount,Pending:pendingCount}"'

# Tail logs from all tasks
aws logs tail /ecs/godsview-prod/api --follow

# Get most recent deployment event
aws ecs describe-services \
  --cluster godsview-prod \
  --services ApiService \
  --query 'services[0].events[0]'

# List all images in ECR repo
aws ecr describe-images \
  --repository-name godsview \
  --query 'sort_by(imageDetails, &imagePushedAt)[*].[imageTags[0],imagePushedAt]' \
  --output table
```

---

**Last Updated**: 2026-04-21
**Version**: 1.0
**Status**: Active
