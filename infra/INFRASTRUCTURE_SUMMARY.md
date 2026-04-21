# GodsView AWS Infrastructure Summary

This document provides a comprehensive overview of the AWS CDK-based infrastructure supporting GodsView.

## Architecture Overview

GodsView uses a multi-stack approach in AWS CDK for clear separation of concerns and independent scaling:

```
┌─────────────────────────────────────────────────────────────┐
│                   CloudFront (Dashboard CDN)                │
└────────────────┬────────────────────────────────────────────┘
                 │
┌────────────────▼──────────────────┐
│    Application Load Balancer      │
│      (public, HTTPS listener)     │
└────────────────┬──────────────────┘
                 │
     ┌───────────┴──────────┐
     │                      │
┌────▼─────────┐   ┌────────▼─────────┐
│  ECS Fargate │   │  S3 (Dashboard)  │
│   Tasks (2)  │   │   via CloudFront │
└────┬─────────┘   └──────────────────┘
     │
     └─────────────────┬──────────────────────────────┐
                       │                              │
            ┌──────────▼──────────┐      ┌────────────▼──────┐
            │   RDS Postgres      │      │  ElastiCache Redis │
            │  (db.t4g.large)     │      │  (cache.t4g.small) │
            │  Multi-AZ (Prod)    │      │  Replicated (Prod) │
            └─────────────────────┘      └───────────────────┘
                       │
        ┌──────────────┴──────────────┐
        │                             │
    ┌───▼────────┐          ┌────────▼─────┐
    │   Secrets  │          │ CloudWatch    │
    │  Manager   │          │ Logs + Metrics│
    └────────────┘          └───────────────┘
```

## CDK Stacks

### 1. Network Stack (`godsview-{env}-network`)

**Purpose**: VPC infrastructure, subnets, NAT gateways, security groups

**Key Resources**:
- **VPC**: 10.20.0.0/16 CIDR block across 2 Availability Zones
- **Subnets**:
  - Public (24-bit): For ALB and NAT gateways
  - Private with Egress (24-bit): For ECS tasks (outbound internet access)
  - Isolated (24-bit): For RDS and ElastiCache (no internet)
- **NAT Gateways**:
  - Dev: 1 NAT gateway (for cost)
  - Prod: 2 NAT gateways (one per AZ for HA)
- **Flow Logs**: VPC Flow Logs for rejected traffic (security monitoring)

**Environment Differences**:
| Aspect | Dev | Prod |
|--------|-----|------|
| NAT Gateways | 1 | 2 |
| Cost | ~$32/month | ~$64/month |

**Outputs**:
- VPC ID
- Subnet IDs (public, private, isolated)

---

### 2. Storage Stack (`godsview-{env}-storage`)

**Purpose**: S3 buckets for static assets and artifacts, ECR for container images

**Key Resources**:

#### S3 Buckets

1. **Dashboard Bucket** (`godsview-{env}-dashboard-{account}`)
   - Static website content (HTML, CSS, JS)
   - Served via CloudFront CDN
   - Versioning enabled in prod
   - Encryption: S3-managed
   - Block public access: Enabled

2. **Models Bucket** (`godsview-{env}-models-{account}`)
   - ML model artifacts
   - Python backtest results
   - Lifecycle rule: Delete after 365 days (prod) or 30 days (dev)
   - Versioning enabled in prod

3. **Logs Bucket** (`godsview-{env}-logs-{account}`)
   - CloudFront access logs
   - ALB access logs
   - S3 access logs

#### ECR Repository

- **API Repository**: `godsview-{env}-api`
  - For Node.js API server Docker images
  - Lifecycle policy: Keep 10 latest images
  - Encryption: AWS-managed

**Environment Differences**:
| Aspect | Dev | Prod |
|--------|-----|------|
| Versioning | Disabled | Enabled |
| Auto-delete objects | Yes | No (RETAIN) |
| Lifecycle expiration | 30 days | 365 days |
| Removal policy | DESTROY | RETAIN |

**Outputs**:
- Dashboard bucket name
- Models bucket name
- ECR repository URI

---

### 3. Data Stack (`godsview-{env}-data`)

**Purpose**: Database and cache infrastructure, secrets management

**Key Resources**:

#### RDS PostgreSQL

- **Version**: PostgreSQL 16.4
- **Instance types**:
  - Dev: `db.t4g.micro` (burstable, 2GB RAM)
  - Prod: `db.t4g.large` (2 vCPU, 8GB RAM)
- **Storage**:
  - Dev: 20 GB initial, 100 GB max
  - Prod: 100 GB initial, 1000 GB max
- **Backup**:
  - Dev: 1 day retention
  - Prod: 14 days retention, deletion protected
- **HA**:
  - Dev: Single AZ
  - Prod: Multi-AZ with automatic failover
- **Monitoring**:
  - Performance Insights (prod)
  - CloudWatch logs export
  - IAM authentication
- **Security**:
  - Placed in isolated subnets
  - Security group restricts access
  - Encryption at rest: Enabled

#### ElastiCache Redis

- **Version**: 7.1
- **Node types**:
  - Dev: `cache.t4g.micro` (single node)
  - Prod: `cache.t4g.small` x2 (replication group with failover)
- **Configuration**:
  - Dev: Single node, no replication
  - Prod: 2-node replicated group with automatic failover
- **Features**:
  - Encryption at rest (prod)
  - Encryption in transit (prod)
  - Multi-AZ (prod)
- **Security**:
  - Placed in isolated subnets
  - Security group restricts access

#### Secrets Manager

Two secrets created:

1. **Database Secret** (`godsview-{env}-db`)
   - Auto-generated username/password for RDS
   - Automatically rotated by RDS

2. **Broker Secret** (`godsview-{env}-broker`)
   - Alpaca API keys
   - Manually managed (no auto-rotation in CDK)
   - Must be populated after stack creation

**Environment Differences**:
| Aspect | Dev | Prod |
|--------|-----|------|
| RDS Instance | db.t4g.micro | db.t4g.large |
| RDS Storage | 20GB | 100GB |
| RDS Multi-AZ | No | Yes |
| RDS Backup | 1 day | 14 days |
| RDS Deletion Protected | No | Yes |
| RDS Performance Insights | No | Yes |
| Redis Node Type | cache.t4g.micro | cache.t4g.small |
| Redis Replication | Single node | 2-node group |
| Redis Multi-AZ | No | Yes |
| Cost | ~$26/month | ~$340/month |

**Outputs**:
- RDS endpoint, port, database name
- Redis endpoint, port
- Database secret ARN
- Broker secret ARN

---

### 4. Compute Stack (`godsview-{env}-compute`)

**Purpose**: ECS Fargate for API service, ALB for routing, CloudFront for dashboard

**Key Resources**:

#### ECS Cluster

- **Name**: `godsview-{env}`
- **Container Insights**: Enabled (CloudWatch metrics)
- **Launch Type**: Fargate (serverless containers)

#### Task Definition

- **Family**: `godsview-{env}-api`
- **CPU/Memory**:
  - Dev: 512 CPU units, 1024 MB RAM
  - Prod: 1024 CPU units, 2048 MB RAM
- **Container**:
  - Image: Latest from ECR repository
  - Port: 3001
  - Health check: HTTP endpoint every 30 seconds
  - Log driver: CloudWatch Logs
- **Secrets & Configuration**:
  - Database URL (from RDS secret)
  - Alpaca keys (from broker secret)
  - Redis URL (environment variable)
  - Node environment (dev/prod)

#### Application Load Balancer (ALB)

- **Scheme**: Internet-facing (public)
- **Listeners**:
  - Dev: HTTP on port 80
  - Prod: HTTPS on port 443 (certificate via ACM)
- **Target Group**:
  - Health checks: /api/healthz
  - Stickiness: Disabled (stateless)
  - Deregistration delay: 30 seconds
- **Security Group**:
  - Inbound: 80/443 from 0.0.0.0/0
  - Outbound: All to targets

#### ECS Service

- **Name**: `ApiService`
- **Task count**:
  - Dev: 1 task
  - Prod: 2 tasks (minimum)
- **Auto-scaling** (prod only):
  - Min: 2 tasks
  - Max: 10 tasks
  - Target CPU: 70%
  - Target Memory: 80%
- **Deployment**:
  - Type: Rolling
  - Max percentage: 200% (allows temporary 2x capacity during update)
  - Min healthy: 50%

#### CloudFront Distribution

- **Origin**: S3 bucket (dashboard)
- **Security**:
  - Origin Access Control (OAC) for private S3
  - Viewer HTTPS only
  - Modern TLS versions only
- **Caching**:
  - Cache policy based on object type
  - Compress enabled (gzip, brotli)
- **Domain**: CloudFront default domain or custom domain (if provided)

#### CloudWatch Logs

- **Log Group**: `/ecs/godsview-{env}/api`
- **Retention**:
  - Dev: 1 week
  - Prod: 1 month

**Environment Differences**:
| Aspect | Dev | Prod |
|--------|-----|------|
| ECS Tasks | 1 | 2-10 |
| CPU per Task | 512 | 1024 |
| Memory per Task | 1024 MB | 2048 MB |
| ALB Scheme | HTTP | HTTPS |
| Auto-scaling | No | Yes (2-10) |
| Log Retention | 1 week | 1 month |
| Cost | ~$36/month | ~$180+/month |

**Outputs**:
- ALB DNS name
- ECS cluster name
- CloudFront distribution ID
- CloudWatch log group name

---

## Deployment Workflow

### Prerequisites Check
Run before deployment:
```bash
bash scripts/validate-deploy.sh
```

This validates:
- AWS credentials and CLI configuration
- Docker daemon and image builds
- Environment variables
- Required AWS permissions

### Staging (Dev) Deployment

1. **Create infrastructure**:
   ```bash
   cd infra
   pnpm install
   pnpm deploy:dev
   ```
   Creates 4 stacks (network, storage, data, compute)

2. **Build and push API image**:
   ```bash
   docker build -t $ECR_REPO:latest .
   docker push $ECR_REPO:latest
   aws ecs update-service --cluster godsview-dev --service ApiService --force-new-deployment
   ```

3. **Deploy dashboard**:
   ```bash
   pnpm --filter @workspace/dashboard build
   aws s3 sync artifacts/godsview-dashboard/dist/ s3://$DASHBOARD_BUCKET/
   ```

### Production (Prod) Deployment

Same process as staging, but:
- Uses `pnpm deploy:prod` (requires approval for IAM/SG changes)
- Creates multi-AZ RDS, replicated Redis, auto-scaling ECS
- CloudFront requires manual domain/certificate setup

---

## Cost Estimation

### Dev Environment (monthly)

| Component | Size | Cost |
|-----------|------|------|
| NAT Gateway | 1 | $32.00 |
| RDS | db.t4g.micro | $13.00 |
| ElastiCache | cache.t4g.micro | $13.00 |
| ECS Fargate | 512 CPU, 1GB RAM | $36.00 |
| ALB | 1 LB | $20.00 |
| CloudFront | Usage | $5.00 |
| S3 / ECR | Storage | < $5.00 |
| **Total Floor** | | **~$120/month** |

### Production Environment (monthly)

| Component | Size | Cost |
|-----------|------|------|
| NAT Gateways | 2 | $64.00 |
| RDS | db.t4g.large multi-AZ | $250.00 |
| ElastiCache | cache.t4g.small ×2 | $90.00 |
| ECS Fargate | 1024 CPU, 2GB RAM × 2-10 | $180-900+ |
| ALB | 1 LB | $20.00 |
| CloudFront | Usage | $10-50 |
| S3 / ECR | Storage | < $20.00 |
| **Total Floor** | | **~$650+/month** |

---

## Disaster Recovery

### RDS Snapshots

- Auto-created by AWS according to backup retention
- Manual snapshots can be created
- Restore to new instance (old one not affected)
- Typical restore time: 5-10 minutes

### ElastiCache

- Prod: Automatic failover to replica (seconds)
- Dev: Manual recovery required
- Export: Available via dump

### ECS / ELB

- Stateless architecture enables quick recovery
- Image is pulled from ECR
- Redeployment creates new tasks
- Previous task definition retained for rollback

---

## Security

### Network Security

- **VPC**: Private subnets for data layer
- **Security Groups**: Restrictive ingress rules
- **VPC Flow Logs**: Monitor rejected traffic
- **NAT Gateways**: Outbound-only from private subnets

### Data Security

- **RDS**: Encryption at rest, IAM authentication
- **Redis**: Encryption at rest and in transit (prod)
- **Secrets Manager**: Encrypted secrets with rotation
- **S3**: Encryption, block public access, versioning (prod)

### Application Security

- **IAM Roles**: Task role with minimal permissions
- **Secrets Injection**: Via ECS task definition, not environment
- **HTTPS**: CloudFront and ALB enforce HTTPS (prod)
- **Health Checks**: Automatic unhealthy task replacement

---

## Monitoring

### CloudWatch

- **Metrics**: ECS CPU, memory, ALB requests, RDS connections
- **Logs**: Centralized /ecs/godsview-{env}/api
- **Alarms**: Configured for critical conditions
- **Dashboards**: Custom dashboards available

### Performance Insights (Prod only)

- Detailed RDS performance metrics
- Slow query identification
- Load profile analysis

### Container Insights

- ECS cluster metrics
- Task-level metrics
- Service-level metrics

---

## Scaling Strategies

### Horizontal (Add More Tasks)

**Dev**: Manual via AWS Console or CLI
```bash
aws ecs update-service --desired-count 2
```

**Prod**: Automatic via Application Auto Scaling
- Target tracking: 70% CPU, 80% memory
- Min: 2 tasks, Max: 10 tasks
- Scale-up: 1-2 minutes
- Scale-down: 5-10 minutes (cooldown)

### Vertical (Increase Task Size)

```bash
# Update task definition with new CPU/memory
aws ecs register-task-definition ...
# Update service to use new task definition
aws ecs update-service --force-new-deployment
```

### Database Scaling

**RDS**: Modify instance type (requires downtime in dev, blue/green in prod)
```bash
aws rds modify-db-instance --db-instance-class db.t4g.xlarge
```

**ElastiCache**: Add replicas or upgrade node type (requires downtime)

---

## Maintenance Windows

### Recommended Schedule

- **Dev**: Any time (non-critical)
- **Prod**: 
  - Maintenance window: Sunday 02:00-04:00 UTC
  - Database updates: Automatic minor versions
  - Manual updates: Schedule advance approval

---

## Troubleshooting

### Common Issues

1. **ECS tasks won't start**
   - Check CloudWatch logs
   - Verify security groups allow RDS/Redis access
   - Verify image exists in ECR

2. **Database connection errors**
   - Check RDS endpoint is reachable
   - Verify security group allows port 5432
   - Check database credentials in Secrets Manager

3. **Redis connection errors**
   - Check Redis endpoint is reachable
   - Verify security group allows port 6379
   - Check REDIS_URL environment variable

4. **ALB returning 502**
   - Check target health
   - Verify health check endpoint
   - Check application logs

---

## Related Documentation

- [DEPLOY_RUNBOOK.md](./DEPLOY_RUNBOOK.md) - Step-by-step deployment guide
- [README.md](./README.md) - Quick start guide
- [scripts/validate-deploy.sh](../scripts/validate-deploy.sh) - Pre-deployment validation
- [.github/workflows/deploy.yml](../.github/workflows/deploy.yml) - CI/CD pipeline

---

**Last Updated**: 2026-04-21
**Maintained By**: Engineering Team
**CDK Version**: 2.158.0+
