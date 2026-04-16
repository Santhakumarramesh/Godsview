# GodsView — Production Deployment & Operations Guide

Complete guide for deploying, operating, and monitoring GodsView in production environments.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  BROWSER / CLIENT (React Dashboard)                             │
└────────────────────┬────────────────────────────────────────────┘
                     │ HTTPS
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  NGINX (Reverse Proxy + Static Assets)                          │
│  Port 80/443 → Rate limiting, TLS termination, asset serving   │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  EXPRESS.JS API SERVER (Node.js)                                │
│  Port 3001 → 156 routes, 16 core systems, 3188+ unit tests     │
│  • Market Intelligence (SMC, Order Flow, Regime, Macro)        │
│  • Strategy & Intelligence (ML, Context Fusion, Governance)    │
│  • Execution & Safety (Circuit Breaker, Risk, Guards)          │
│  • Brain, Portfolio, Recall, Audit Trail                       │
└────────────────────┬────────────────────────────────────────────┘
         │           │           │
         ▼           ▼           ▼
    ┌────────┐  ┌────────┐  ┌──────────┐
    │POSTGRES│  │ REDIS  │  │ ALPACA   │
    │ 5432   │  │ 6379   │  │  API     │
    └────────┘  └────────┘  └──────────┘
         │
         ▼
    ┌─────────────────────────────────────────────────────────────┐
    │ PYTHON V2 MICROSERVICES (Optional, profile: v2)             │
    │                                                             │
    │ ┌──────────────┬──────────────┬──────────────────────────┐ │
    │ │ API Gateway  │ Market Data  │ Feature Service         │ │
    │ │ (8000)       │ (8001)       │ (8002)                  │ │
    │ └──────────────┴──────────────┴──────────────────────────┘ │
    │ ┌──────────────┬──────────────┬──────────────────────────┐ │
    │ │ Backtest     │ ML Service   │ Execution Service       │ │
    │ │ (8003)       │ (8004)       │ (8005)                  │ │
    │ └──────────────┴──────────────┴──────────────────────────┘ │
    │ ┌──────────────┬──────────────┬──────────────────────────┐ │
    │ │ Risk Service │ Memory Svc   │ Scheduler               │ │
    │ │ (8006)       │ (8007)       │ (8008)                  │ │
    │ └──────────────┴──────────────┴──────────────────────────┘ │
    │                                                             │
    │ Dependencies: PostgreSQL, Redis, MLflow (5000)             │
    └─────────────────────────────────────────────────────────────┘
         │
         ▼
    ┌──────────────────────────────────────────────────────────┐
    │ MONITORING STACK (Optional)                              │
    │ • Prometheus (9090) — Metrics scraping                   │
    │ • Grafana (3000) — Dashboards & alerts                   │
    │ • Structured logging — JSON logs to file/ELK            │
    └──────────────────────────────────────────────────────────┘
```

## Quick Start (Docker Compose)

### 1. Node.js Stack Only (Recommended to start)

```bash
# Clone and configure
git clone https://github.com/Santhakumarramesh/Godsview.git
cd Godsview
cp .env.example .env
# Edit .env: ALPACA_API_KEY, ALPACA_SECRET_KEY, DATABASE_URL

# Start PostgreSQL + API + Nginx (no Python services)
docker compose up -d postgres api nginx

# Verify health
docker compose ps
curl http://localhost/api/healthz

# Tail logs
docker compose logs -f api
```

### 2. Full Stack (Node.js + Python v2 Microservices)

```bash
# Start all services including Python microservices
docker compose --profile v2 up -d

# Verify all services
docker compose ps

# Check Python gateway health
curl http://localhost:8000/health

# Enable Python bridge in API
# Edit .env: PY_SERVICES_ENABLED=true
docker compose restart api
```

### 3. Docker Compose Commands

```bash
# View all services
docker compose ps

# Tail API logs
docker compose logs -f api

# Tail Python gateway logs
docker compose logs -f py-gateway

# Restart a service
docker compose restart api

# Stop all services
docker compose down

# Stop + remove volumes (WARNING: deletes data)
docker compose down -v

# Update and rebuild images
docker compose pull
docker compose up -d --build
```

## Environment Variables

### Required (All Deployments)

```bash
# Alpaca Trading API
ALPACA_API_KEY=pk_...              # Paper or live API key
ALPACA_SECRET_KEY=...              # API secret
ALPACA_BASE_URL=https://paper-api.alpaca.markets  # Or live URL

# Database
DATABASE_URL=postgresql://user:password@host:5432/godsview
POSTGRES_PASSWORD=secure_password  # For docker-compose

# Operator authentication
GODSVIEW_OPERATOR_TOKEN=randomtoken123  # Change in production
```

### Safety Controls (Conservative Defaults)

```bash
# Trading mode
GODSVIEW_ENABLE_LIVE_TRADING=false     # Must explicitly enable live
GODSVIEW_SYSTEM_MODE=paper             # paper or live

# Execution limits
GODSVIEW_KILL_SWITCH=false             # Emergency halt
GODSVIEW_MAX_DAILY_LOSS_USD=250        # Max daily loss
GODSVIEW_MAX_OPEN_EXPOSURE_PCT=0.6     # Max concurrent exposure (60%)
GODSVIEW_MAX_TRADES_PER_SESSION=10     # Max trades per session
GODSVIEW_COOLDOWN_AFTER_LOSSES=3       # Cooldown after N losses
GODSVIEW_COOLDOWN_MINUTES=30           # Cooldown duration

# Data quality
GODSVIEW_BLOCK_ON_DEGRADED_DATA=true   # Halt on bad data
```

### Optional (Advanced Features)

```bash
# Claude reasoning layer
ANTHROPIC_API_KEY=sk_...               # For veto model
CLAUDE_VETO_MODEL=claude-sonnet-4-5-20241022
CLAUDE_TIMEOUT_MS=30000
CLAUDE_MAX_RETRIES=1

# Python v2 bridge
PY_SERVICES_ENABLED=false              # Enable Python microservices
PY_GATEWAY_URL=http://py-gateway:8000

# Cache & messaging
REDIS_URL=redis://localhost:6379

# Integrations
ECON_CALENDAR_URL=https://nfs.faireconomy.media/ff_calendar_thisweek.json

# API configuration
CORS_ORIGIN=http://localhost,https://yourdomain.com
NODE_ENV=production
PORT=3001
DB_POOL_MAX=10
```

## Service Health Checks

### Node.js API Server

```bash
# Liveness (service is running)
curl http://localhost:3001/api/healthz

# Readiness (ready to serve traffic)
curl http://localhost:3001/api/readyz

# Expected response:
# {
#   "status": "ok|degraded|offline",
#   "timestamp": "2026-04-16T00:00:00Z",
#   "subsystems": { ... }
# }
```

### Docker Compose Health

```bash
# Check service health
docker compose ps

# Expected output: All services showing "healthy" or "running"
# STATUS column shows:
# - "Up X seconds (healthy)" = OK
# - "Up X seconds" = running but no health check
# - "Exited (1)" = crashed
```

### Python Services (if enabled)

```bash
# API Gateway health
curl http://localhost:8000/health

# All services health fan-out
curl http://localhost:8000/health/services

# Expected:
# {
#   "status": "healthy",
#   "services": {
#     "market_data": "healthy",
#     "feature_service": "healthy",
#     "ml_service": "healthy",
#     ...
#   }
# }
```

## Monitoring Setup

### Prometheus Configuration

Add to your `prometheus.yml`:

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'godsview'
    static_configs:
      - targets:
          - localhost:3001  # Node.js API metrics
          - localhost:8000  # Python Gateway (if enabled)
          - localhost:8001  # Market Data Service
          - localhost:8002  # Feature Service
          - localhost:8003  # Backtest Service
          - localhost:8004  # ML Service
          - localhost:8005  # Execution Service
          - localhost:8006  # Risk Service
          - localhost:8007  # Memory Service
          - localhost:8008  # Scheduler Service

  - job_name: 'postgres'
    static_configs:
      - targets: ['localhost:5432']

  - job_name: 'redis'
    static_configs:
      - targets: ['localhost:6379']
```

### Key Metrics to Monitor

```
# Request metrics
godsview_http_requests_total{method,path,status}        # Request count
godsview_http_request_duration_seconds{quantile}        # Latency (p50, p95, p99)
godsview_http_requests_in_flight                        # Concurrent requests

# Trading metrics
godsview_signals_total{symbol,signal_type}              # Signal detection rate
godsview_trades_total{symbol,outcome}                   # Trade count & outcomes
godsview_ml_predictions_total{approval_status}          # ML approval rate
godsview_open_positions                                 # Current open positions
godsview_equity_dollars                                 # Account equity
godsview_circuit_breaker_trips                          # Emergency closes
godsview_guard_rejections_total{guard_type}             # Safety rejections

# System metrics
godsview_signal_detection_latency_ms{p95}               # Signal latency
godsview_execution_latency_ms{p95}                      # Order latency
godsview_model_drift_status{status}                     # Drift indicator
godsview_database_pool_active_connections               # DB connection pool
```

### Grafana Dashboards

Included dashboards (auto-imported if using `--profile v2`):
1. **Brain Subsystem Dashboard** — Real-time system health, throughput, latency
2. **Execution Dashboard** — Fill rate, slippage, VaR, exposure, margin
3. **Performance Dashboard** — Win rate, profit factor, equity curve

### Prometheus Alert Rules (22 alerts)

Critical alerts configured in `/etc/prometheus/alert.rules`:

**Trading Alerts:**
- Kill switch activated
- Circuit breaker halted (max drawdown)
- Daily loss limit exceeded
- Consecutive losses streak
- Unmatched fills

**Brain Alerts:**
- Subsystem degraded
- High latency detected
- Signal engine stalled
- Error spike detected
- Regime data stale

**Execution Alerts:**
- High slippage detected
- Order rejection rate high
- Exposure limit exceeded
- Margin requirement breached
- VaR limit exceeded

**Infrastructure Alerts:**
- Instance down
- WebSocket disconnected
- DB pool exhausted
- Memory usage high
- Python service down

## Database Initialization

### PostgreSQL Setup

```bash
# If not using Docker, create database manually
createdb godsview
createuser godsview
psql -c "ALTER USER godsview WITH ENCRYPTED PASSWORD 'secure_password';"
psql -c "GRANT ALL PRIVILEGES ON DATABASE godsview TO godsview;"

# Run migrations (automatic on startup, but can be manual)
psql -U godsview -d godsview -f services/migrations/schema.sql
```

### Tables Created

- `orders` — All order placements and fills
- `positions` — Live and historical positions
- `risk_assessments` — VaR, CVaR, stress test results
- `trades` — Completed trades with entry/exit details
- `signals` — Detected signals with quality scores
- `audit_events` — All system decisions and approvals

## Operator Status Page

Access at `http://localhost/` (default HTTP port 80):

### Dashboard Sections

- **Mission Control** — Real-time P&L, win rate, engine health
- **Brain** — Subsystem status visualization
- **Risk Control** — Kill switch, guards, drawdown tracking
- **Execution** — Live orders, position tracking, slippage
- **Performance** — Win rate, profit factor, Sharpe ratio
- **System** — Service health, audit trail, diagnostics

### Key Controls

- **Kill Switch** (red button) — Immediately halt all execution
- **Daily Loss Monitor** — Current daily P&L and limit
- **Exposure Meter** — Current open exposure vs limit
- **Circuit Breaker** — Drawdown percentage and trigger level

## Security Considerations

### Network Security

```
# TLS/SSL (recommended)
- Use Nginx with SSL certificates (Let's Encrypt)
- Set CORS_ORIGIN to trusted domains only
- Enable HSTS headers in Nginx config

# API Authentication
- GODSVIEW_OPERATOR_TOKEN required for sensitive endpoints
- Token validation in middleware
- Rate limiting: 100 req/min per IP

# Database
- Use strong POSTGRES_PASSWORD
- PostgreSQL should not be exposed to internet
- Use database firewall rules
```

### Secret Management

```bash
# In production, use environment secrets, not .env file:
- AWS Secrets Manager
- HashiCorp Vault
- Kubernetes Secrets

# Never commit .env to git
.env
.env.local
.env.*.local
```

### Trading Safety

```
# Live trading disabled by default
GODSVIEW_ENABLE_LIVE_TRADING=false

# Enable only after:
1. Passing walk-forward validation (live_assisted_approved)
2. At least 20 paper trades with acceptable slippage
3. Operator approval via /api/autonomy/candidates/:id/activate

# Daily loss limit enforced
- Max loss per day: $250 (configurable)
- Circuit breaker halts all orders

# Kill switch always available
- One-click emergency halt
- All orders immediately flattened
```

## Deployment Checklist

- [ ] Configure `.env` with production credentials
- [ ] Set `NODE_ENV=production`
- [ ] Enable `GODSVIEW_SYSTEM_MODE=paper` initially
- [ ] Configure PostgreSQL with secure password
- [ ] Set `GODSVIEW_OPERATOR_TOKEN` to random secure value
- [ ] Configure Nginx with TLS certificates
- [ ] Set up Prometheus + Grafana (optional but recommended)
- [ ] Configure log rotation (JSON logs)
- [ ] Set up database backup strategy (daily PostgreSQL dumps)
- [ ] Run release verification: `pnpm verify:release`
- [ ] Run market deployment check: `pnpm verify:market:paper`
- [ ] Perform manual testing on paper trading
- [ ] Document operator runbook and alert procedures
- [ ] Set up monitoring dashboards and on-call rotation
- [ ] Only after validation: Set `GODSVIEW_ENABLE_LIVE_TRADING=true`

## Scaling Notes

### Horizontal Scaling

GodsView API is stateless and can be scaled:

```bash
# Scale Node.js API behind load balancer
docker compose up -d --scale api=3 nginx

# Python services are also stateless
docker compose --profile v2 up -d --scale py-gateway=2 --scale py-ml=2
```

### Resource Requirements (Per Instance)

```
Node.js API:    512 MB RAM, 1 CPU
Python Gateway: 256 MB RAM, 1 CPU
Market Data:    256 MB RAM, 1 CPU
Feature Svc:    256 MB RAM, 1 CPU
Backtest Svc:   512 MB RAM, 2 CPU (compute-intensive)
ML Service:     1024 MB RAM, 2 CPU (model training)
Execution Svc:  256 MB RAM, 1 CPU
Risk Service:   512 MB RAM, 2 CPU (stress testing)
Memory Service: 512 MB RAM, 1 CPU
Scheduler:      256 MB RAM, 1 CPU
PostgreSQL:     2 GB RAM, 4 CPU
Redis:          256 MB RAM, 1 CPU
```

### Database Maintenance

```bash
# Daily backup (cron job)
0 2 * * * pg_dump -h localhost -U godsview godsview | gzip > /backups/godsview-$(date +\%Y\%m\%d).sql.gz

# Weekly vacuum (PostgreSQL maintenance)
0 3 * * 0 psql -U godsview -d godsview -c "VACUUM ANALYZE;"

# Monthly archive old trades
0 4 1 * * psql -U godsview -d godsview -f /scripts/archive_trades.sql
```

## Disaster Recovery

### Database Recovery

```bash
# Restore from backup
gunzip < /backups/godsview-20260416.sql.gz | psql -U godsview -d godsview

# Point-in-time recovery (if using PostgreSQL WAL archiving)
# Configure postgresql.conf: wal_level = replica, archive_command
```

### Service Recovery

```bash
# All services auto-restart on failure
# docker-compose restart policy: unless-stopped

# Manual recovery
docker compose down
docker compose up -d --build
```

### Data Integrity Checks

```bash
# Verify audit trail consistency
curl http://localhost:3001/api/system/audit | jq '.integrity_check'

# Verify execution prices vs fills
curl http://localhost:3001/api/execution/pnl | jq '.reconciliation'
```

## Testing Before Production

### Staging Environment

```bash
# Mirror production config
export NODE_ENV=staging
export GODSVIEW_SYSTEM_MODE=paper
export ALPACA_BASE_URL=https://paper-api.alpaca.markets

# Run full test suite
pnpm verify:release

# Run market deployment verification
pnpm verify:market:paper
```

### Load Testing

```bash
# API load test (100 VUs, 5min ramp)
k6 run load-tests/k6-api-stress.js

# WebSocket test (100 concurrent connections)
k6 run load-tests/k6-websocket.js

# Expected thresholds:
# - P95 latency < 2s
# - P99 latency < 5s
# - Error rate < 5%
```

## CI/CD Pipeline

GitHub Actions workflow (.github/workflows/deploy.yml):

1. **typecheck-and-test** — TypeScript + 3188 unit tests
2. **python-v2** — Ruff lint + pytest (130+ tests)
3. **security-scan** — Dependency audit + secret detection
4. **contract-validation** — Zod ↔ Pydantic contract tests
5. **build** — Build + regression gate (min 3000 tests)
6. **docker** — Build + push Docker images to GHCR
7. **deploy** — SSH deploy to production server

Required GitHub Secrets:
```
DEPLOY_HOST       — Production server IP
DEPLOY_USER       — SSH user
DEPLOY_SSH_KEY    — SSH private key
DEPLOY_PORT       — SSH port (default 22)
```

## Logs & Debugging

### Log Levels

```bash
# Set in .env
LOG_LEVEL=info  # info, warn, error, debug

# Structured JSON logging
# Each log entry includes: timestamp, request_id, level, service, message, metadata
```

### Tail Logs

```bash
# API server
docker compose logs -f api

# Python services
docker compose logs -f py-gateway py-ml py-execution

# PostgreSQL
docker compose logs -f postgres

# All services
docker compose logs -f
```

### Debug an Execution

```bash
# Find trade ID from dashboard or API
TRADE_ID=123abc

# Replay decision (full reconstruction)
curl http://localhost:3001/api/system/audit/replay/$TRADE_ID | jq .

# Includes:
# - Raw market data at decision time
# - All signal scores
# - ML probability & regime
# - Guard evaluations
# - Execution outcome
```

## Support & Escalation

### On-Call Runbook

1. **Alert fires** → Check Grafana dashboard
2. **Identify issue** → Check logs and metrics
3. **Apply immediate fix**:
   - Pull kill switch if trading is affected
   - Restart failing service: `docker compose restart <service>`
   - Check data quality via `/api/healthz`
4. **Root cause analysis** → Check audit trail
5. **Permanent fix** → Create patch and deploy

### Common Issues

| Issue | Solution |
|-------|----------|
| API not responding | Check PostgreSQL health, restart API service |
| Orders not executing | Check kill switch, verify daily loss limit, check Alpaca API status |
| High slippage | Check market volatility, verify execution service is running |
| Model drift detected | Retrain model with recent data, check market regime changes |
| Database connection errors | Verify PostgreSQL is running, check connection pool limits |

## Support Contact

- GitHub Issues: https://github.com/Santhakumarramesh/Godsview/issues
- Email: support@godsview.dev
- Documentation: See `ARCHITECTURE.md` for detailed technical reference
