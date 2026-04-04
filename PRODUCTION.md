# GodsView — Production Deployment Guide

## Architecture

```
Browser / Mobile
     │
     ▼
Node.js API Server (port 3000)   ←── /v2/* proxy ──▶  Python API Gateway (8000)
     │                                                       │
     ▼                                                       ├── Market Data    (8001)
PostgreSQL / SQLite                                          ├── Feature        (8002)
                                                            ├── Backtest       (8003)
                                                            ├── ML Service     (8004)
                                                            ├── Execution      (8005)
                                                            ├── Risk           (8006)
                                                            ├── Memory         (8007)
                                                            └── Scheduler      (8008)
                                                                    │
                                                            MLflow (5000) + Redis (6379)
```

## Quick Start (Development)

### 1. TypeScript / Node.js stack

```bash
# Install dependencies
pnpm install

# Run dev server (auto-rebuilds)
pnpm dev

# Access dashboard at http://localhost:5173
```

### 2. Python v2 microservices

```bash
# Install Python deps
pip install -r services/requirements.txt

# Run all 9 services
./services/start.sh all

# Or individual service
./services/start.sh gateway
```

### 3. Docker Compose (recommended)

```bash
cd services/
docker compose up -d

# Check status
docker compose ps
docker compose logs -f api-gateway
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

```bash
cp .env.example .env
```

Required for live trading:
```
ALPACA_KEY_ID=your_alpaca_key
ALPACA_SECRET_KEY=your_alpaca_secret
ALPACA_PAPER=true                  # false for live trading (CAUTION)
LIVE_TRADING_ENABLED=false         # must explicitly enable
SECRET_KEY=<random-64-char-string>
INTERNAL_API_KEY=<random-string>
```

## API Endpoints

### Python v2 Gateway (port 8000)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Gateway health |
| GET | `/health/services` | All service health fan-out |
| POST | `/api/signals` | Detect + ML-filter signals |
| GET | `/api/signals/live` | Recent live signals |
| POST | `/api/backtest/run` | Run backtest |
| GET | `/api/market/bars/{symbol}` | OHLCV bars |
| POST | `/api/ml/predict` | ML prediction for signal |
| POST | `/api/ml/train` | Trigger model training |
| POST | `/api/trades` | Open trade (risk-checked) |
| GET | `/api/trades` | Trade history |
| GET | `/metrics` | Prometheus scrape endpoint |

### Node.js v2 Proxy (port 3000)

Same routes prefixed with `/v2/`:
- `/v2/health`, `/v2/signals`, `/v2/backtest`, `/v2/market/bars/:symbol`, etc.
- `/v2/scheduler/status`, `/v2/scheduler/scan`

### Scheduler Service (port 8008)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/scheduler/status` | Current state + counters |
| POST | `/scheduler/scan/trigger` | Manual scan |
| POST | `/scheduler/retrain/trigger` | Manual retrain |
| PATCH | `/scheduler/watchlist` | Add/remove symbols |
| GET | `/scheduler/errors` | Recent error log |

## Running Tests

```bash
# Full suite (160 tests)
python -m pytest services/tests/ -q

# With coverage
pip install pytest-cov
python -m pytest services/tests/ --cov=services --cov-report=html

# Specific module
python -m pytest services/tests/test_integration_smoke.py -v
```

## Release Gate (Node Stack)

Run this before merging to production:

```bash
pnpm verify:release
```

This command enforces:
- TypeScript typecheck for all workspaces
- Full API-server Vitest suite
- Production builds (API + dashboard)
- Local runtime boot + HTTP deployment-readiness probes (must reach at least `DEGRADED`)
- Post-check cleanup of generated artifacts to keep git clean

## Monitoring

### Prometheus + Grafana

Add to your Prometheus config:
```yaml
scrape_configs:
  - job_name: godsview
    static_configs:
      - targets:
          - localhost:8000  # api-gateway
          - localhost:8001  # market-data
          - localhost:8002  # feature
          - localhost:8003  # backtest
          - localhost:8004  # ml
          - localhost:8005  # execution
          - localhost:8006  # risk
          - localhost:8007  # memory
          - localhost:8008  # scheduler
```

Key metrics:
- `godsview_http_requests_total` — request rate by service/path/status
- `godsview_http_request_duration_seconds` — latency histograms
- `godsview_signals_total` — signal detection rate
- `godsview_trades_total` — trade outcomes
- `godsview_ml_predictions_total` — ML approval rate
- `godsview_open_positions` — current positions
- `godsview_equity_dollars` — account equity

### Health probes (for Kubernetes)

```
GET /health   → liveness probe
GET /ready    → readiness probe (503 until startup complete)
```

## CI/CD

GitHub Actions runs on every push to `main`:

1. **typecheck-and-test** — TypeScript typecheck + Jest tests
2. **python-v2** — ruff lint + 160 pytest tests
3. **build** — pnpm build for api-server + dashboard
4. **docker-python** — Docker build + push Python image to GHCR
5. **docker** — Docker build + push Node.js image to GHCR
6. **deploy** — SSH deploy to production server

Required GitHub Secrets:
- `DEPLOY_HOST` — production server IP
- `DEPLOY_USER` — SSH user
- `DEPLOY_SSH_KEY` — SSH private key

## Git Push (from your terminal)

The sandbox cannot reach GitHub directly. From your local machine:

```bash
# Navigate to the Godsview folder (wherever you selected)
cd ~/path/to/Godsview

# Push all phases (79-88)
git push origin main

# If you need to force-push (only if needed):
git push --force-with-lease origin main
```

## Phase History

| Phase | Commit | Description |
|-------|--------|-------------|
| 79 | `6b0d115` | Production hardening: API wiring, structured logging, build fixes |
| 80 | `fe3610b` | Backtester, Intelligence Center, OpenBB pipeline view |
| 81 | `004061a` | Python v2 microservices (8 services, FastAPI, LanceDB, MLflow) |
| 82 | `b9b27ce` | pytest suite — 130 unit tests |
| 83-88 | `0c40492` | Scheduler, Auth, Circuit Breaker, Prometheus, v2 Proxy, CI, 160 tests |
