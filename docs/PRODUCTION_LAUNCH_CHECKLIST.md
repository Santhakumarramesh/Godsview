# GodsView — Production Launch Checklist

## Pre-Launch (Do These First)

### 1. Local Build Verification
```bash
rm -f .git/index.lock
pnpm install
cd godsview-dashboard && pnpm build    # Must exit 0
cd ../api-server && pnpm build         # Must exit 0
pnpm test                              # All tests pass
```

### 2. TypeScript Clean
```bash
cd godsview-dashboard && pnpm typecheck   # 0 errors (excluding @workspace/ refs)
cd ../api-server && pnpm typecheck        # 0 errors
```

### 3. Git Sync
```bash
git add -A
git commit -m "Production release: all 68 pages, TS errors fixed, E2E test script"
git push origin main
```

### 4. End-to-End Pipeline Test
```bash
# Start services locally
docker compose up -d
# Wait 30 seconds for services to initialize
sleep 30
# Run pipeline test
bash scripts/e2e-pipeline-test.sh
```

---

## Infrastructure Verification

### 5. AWS CDK Deploy
```bash
cd infra
npx cdk diff --all --context env=prod   # Review changes
npx cdk deploy --all --context env=prod  # Deploy
```

### 6. Verify AWS Services
- [ ] ECS tasks running (desired count matches running count)
- [ ] RDS instance available (check AWS console)
- [ ] ElastiCache cluster available
- [ ] S3 bucket accessible
- [ ] CloudFront distribution deployed
- [ ] Secrets Manager keys present (ALPACA_API_KEY, ALPACA_SECRET_KEY, DATABASE_URL)
- [ ] CloudWatch alarms created and in OK state

### 7. Monitoring Confirmed
- [ ] CloudWatch log groups receiving logs
- [ ] SNS alarm notifications configured (email verified)
- [ ] ECS CPU alarm < 80%
- [ ] RDS connections alarm < 80
- [ ] ALB 5xx alarm not firing
- [ ] Container Insights enabled

---

## Application Verification

### 8. API Health
```bash
curl https://your-domain/health          # 200
curl https://your-domain/api/health      # { db: "ok", redis: "ok" }
curl https://your-domain/api/system      # System status
```

### 9. Data Flowing
- [ ] Alpaca WebSocket connected (check logs for "connected to Alpaca stream")
- [ ] Live prices updating (GET /api/alpaca/ticker returns fresh data)
- [ ] Market scanner producing candidates (GET /api/scanner)
- [ ] Signal pipeline generating signals (GET /api/signals)

### 10. Core Intelligence
- [ ] Brain cycle running (GET /api/brain/consciousness shows activity)
- [ ] Regime detection updating (GET /api/regime)
- [ ] Order flow features computing (GET /api/orderbook/features?symbol=BTCUSD)
- [ ] SMC engine detecting structures (GET /api/market?symbol=BTCUSD)

### 11. Risk Engine
- [ ] Kill switch is OFF (GET /api/execution/kill-switch)
- [ ] Risk policies loaded (GET /api/risk)
- [ ] Circuit breaker armed (GET /api/execution/circuit-breaker)
- [ ] Daily loss limits set
- [ ] Max position limits configured

### 12. Execution Modes
- [ ] Paper trading works (submit test order via /api/paper-trading/order)
- [ ] Broker connector healthy (Alpaca API key valid)
- [ ] No orphan positions
- [ ] Slippage tracking active

---

## Security

### 13. Access Control
- [ ] RBAC roles configured (admin, operator, trader, viewer)
- [ ] API key rotation schedule documented
- [ ] No secrets in code (grep -r "AKIA" src/ returns empty)
- [ ] Environment variables set via Secrets Manager, not .env on server

### 14. Audit Trail
- [ ] Audit logger capturing actions (GET /api/governance/audit)
- [ ] Kill switch actions logged
- [ ] Order submissions logged
- [ ] Auth events logged

---

## Post-Launch Monitoring (First 24 Hours)

### 15. Watch These Metrics
- [ ] API p99 latency < 5s
- [ ] Error rate < 1%
- [ ] ECS memory < 85%
- [ ] RDS CPU < 80%
- [ ] No 5xx errors from ALB
- [ ] WebSocket reconnections < 5/hour

### 16. Verify Learning Loop
- [ ] Post-trade feedback storing (check /api/journal)
- [ ] Setup memory recording (check /api/memory)
- [ ] ML model not drifting (check /api/model-gov or brain health)

### 17. Emergency Procedures Tested
- [ ] Kill switch activates within 1 second
- [ ] Emergency flatten works
- [ ] Strategy pause works
- [ ] Symbol pause works

---

## Sign-Off

| Area | Status | Verified By | Date |
|------|--------|-------------|------|
| Build clean | | | |
| Tests pass | | | |
| E2E pipeline | | | |
| AWS deployed | | | |
| Monitoring live | | | |
| Risk engine armed | | | |
| Paper trade verified | | | |
| Kill switch tested | | | |
| Audit trail active | | | |

**Production readiness: APPROVED / NOT APPROVED**

Signed: _________________________ Date: _____________
