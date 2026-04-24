# GodsView — Production Deployment Checklist

## Pre-deployment

- [ ] Copy `.env.example` to `.env` and fill in all `[REQUIRED]` values
- [ ] Set `GODSVIEW_SYSTEM_MODE=paper` (start with paper, never skip to live)
- [ ] Generate operator token: `openssl rand -hex 32` → `GODSVIEW_OPERATOR_TOKEN`
- [ ] Verify Alpaca paper keys work: `curl -H "APCA-API-KEY-ID: $KEY" https://paper-api.alpaca.markets/v2/account`
- [ ] Set `ANTHROPIC_API_KEY` for Claude veto layer

## AWS Infrastructure (CDK)

- [ ] Configure AWS CLI: `aws configure` with IAM credentials
- [ ] Set CDK environment: `export CDK_DEFAULT_ACCOUNT=... CDK_DEFAULT_REGION=us-east-1`
- [ ] Bootstrap CDK: `cd infra && npx cdk bootstrap`
- [ ] Deploy stacks in order:
  - `npx cdk deploy godsview-prod-network`
  - `npx cdk deploy godsview-prod-data`
  - `npx cdk deploy godsview-prod-storage`
  - `npx cdk deploy godsview-prod-compute`
  - `npx cdk deploy godsview-prod-alarms`
- [ ] Store broker secrets in AWS Secrets Manager
- [ ] Set `GODSVIEW_ALERT_EMAIL` for CloudWatch alarm notifications
- [ ] Verify RDS PostgreSQL is accessible from ECS tasks
- [ ] Verify ElastiCache Redis is accessible from ECS tasks

## Docker Build & Push

- [ ] Build image: `docker build -t godsview .`
- [ ] Test locally: `docker run -p 3001:3001 --env-file .env godsview`
- [ ] Hit health check: `curl http://localhost:3001/healthz`
- [ ] Tag and push to ECR: see `.github/workflows/deploy.yml`

## Database

- [ ] Run migrations: `psql $DATABASE_URL -f lib/db/migrations/0001_persistence_layer.sql`
- [ ] Verify tables: `psql $DATABASE_URL -c '\dt'`
- [ ] Seed initial data if needed: `pnpm run seed`

## Post-deployment Verification

- [ ] Run E2E test: `API_BASE=https://your-alb-dns ./scripts/e2e-pipeline-test.sh`
- [ ] Verify all 60 endpoint checks pass
- [ ] Check CloudWatch logs: `/godsview/prod/api`
- [ ] Verify CloudFront dashboard loads
- [ ] Test WebSocket connections for live data streaming

## Trading Safety Verification

- [ ] Confirm kill switch is OFF: `GET /api/safety/status`
- [ ] Confirm paper-only mode: `GET /api/safety/live-allowed` → `allowed: false`
- [ ] Test kill switch activation/deactivation
- [ ] Verify daily loss cap triggers correctly
- [ ] Run paper trades for minimum 14 days before considering live

## Capital Tier Progression

1. **Paper** (0 real capital) — minimum 14 days, >45% win rate
2. **Micro** ($500 max) — minimum 30 days total, >48% win rate, Sharpe >0.8
3. **Small** ($2,000 max) — minimum 60 days total, >50% win rate, Sharpe >1.0
4. **Medium** ($10,000 max) — minimum 90 days total, >52% win rate, Sharpe >1.2
5. **Full** ($50,000+ max) — proven track record, all safety gates green

## Monitoring

- [ ] CloudWatch alarms active (ECS CPU, RDS connections, Redis evictions, ALB 5xx)
- [ ] SNS email notifications confirmed
- [ ] Structured logging flowing to CloudWatch Logs
- [ ] Health endpoints returning 200: `/healthz`, `/readyz`, `/api/health`

## Go-Live Criteria (all must be TRUE)

- [ ] 14+ days paper trading completed
- [ ] Win rate above 45%
- [ ] Sharpe ratio above 0.5
- [ ] Zero kill switch triggers in last 7 days
- [ ] All E2E pipeline checks passing
- [ ] CloudWatch alarms healthy for 48+ hours
- [ ] Database persistence verified (restart and data survives)
- [ ] Operator token set and tested
- [ ] Emergency controls tested (kill switch, flatten all)
