# GodsView — AWS Production Scaling Report

**Date:** 2026-04-26
**Instance:** m6i.xlarge (4 vCPU, 16GB RAM, 100GB gp3)
**Elastic IP:** 3.131.8.229
**Region:** us-east-2
**Instance ID:** i-0faeabdd043cef417

---

## 1. Upgrade Summary

| Item | Before | After |
|------|--------|-------|
| Instance Type | t3.small (2 vCPU, 2GB RAM) | m6i.xlarge (4 vCPU, 16GB RAM) |
| EBS Volume | 30GB gp2 | 100GB gp3 |
| IP Address | Dynamic (18.118.161.243) | Elastic IP (3.131.8.229) |
| Docker Services Running | 4 (core only) | 14 (all services) |
| Python v2 Services | 0 | 10 (all healthy) |
| Dashboard Build | Yes | Yes (rebuilt 12.73s) |
| Signal Engine | Active | Active (PAPER mode) |

---

## 2. All 14 Services — Status

| # | Service | Port | Status | Health |
|---|---------|------|--------|--------|
| 1 | postgres | 5432 | Up (healthy) | shared_buffers=512MB |
| 2 | redis | 6379 | Up (healthy) | maxmemory=512MB LRU |
| 3 | api (Node.js) | 3001 | Up (healthy) | PY_SERVICES_ENABLED=true |
| 4 | nginx | 80 | Up | HTTP 200 |
| 5 | py-gateway | 8000 | Up (healthy) | api_gateway OK v2.0.0 |
| 6 | py-market-data | 8001 | Up (healthy) | market_data OK v2.0.0 |
| 7 | py-feature | 8002 | Up (healthy) | feature OK v2.0.0 |
| 8 | py-backtest | 8003 | Up (healthy) | backtest OK v2.0.0 |
| 9 | py-ml | 8004 | Up (healthy) | ml OK v2.0.0 |
| 10 | py-execution | 8005 | Up (healthy) | execution OK v2.0.0 |
| 11 | py-risk | 8006 | Up (healthy) | risk OK v2.0.0, kill_switch=False |
| 12 | py-memory | 8007 | Up (healthy) | memory OK v2.0.0 (LanceDB) |
| 13 | py-scheduler | 8008 | Up (healthy) | scheduler running, scan_count=1 |
| 14 | mlflow | 5000 | Up (healthy) | Tracking server active |

**+ Signal Engine (systemd):** Active on port 8099 — PAPER mode, $100K equity

---

## 3. Endpoint Latencies

| Endpoint | HTTP Code | Response Time |
|----------|-----------|---------------|
| `/` (Dashboard) | 200 | 0.9ms |
| `/api/signal-engine/health` | 200 | 1.9ms |
| `/api/signal-engine/signals` | 200 | 1.5ms |
| `/api/signal-engine/summary` | 200 | 1.5ms |
| `/api/signal-engine/c4-strategy` | 200 | 7.2s (live analysis) |

---

## 4. Resource Usage (Post-Scaling)

| Resource | Capacity | Used | Available |
|----------|----------|------|-----------|
| RAM | 15 GB | 2.3 GB | 12 GB |
| CPU | 4 vCPU | ~15% | ~85% |
| Disk | 97 GB | 31 GB | 67 GB (32%) |

---

## 5. Performance Tuning Applied

### PostgreSQL
- `shared_buffers`: 128MB → 512MB
- `work_mem`: 4MB → 16MB
- `effective_cache_size`: 4GB → 8GB
- `maintenance_work_mem`: 64MB → 256MB

### Redis
- `maxmemory`: unlimited → 512MB
- `maxmemory-policy`: noeviction → allkeys-lru

### Docker
- All services: `restart: unless-stopped`
- Log rotation: `max-size: 50m`, `max-file: 5`
- Resource limits: API container 512MB max

---

## 6. Bugs Fixed During Scaling

1. **Scheduler service crash** — `structlog`-style keyword arguments (`log.info("event", key=value)`) used with standard `logging` module. Fixed to `log.info("event key=%s", value)`.

2. **MLflow healthcheck failure** — Container lacked `curl`. Changed healthcheck to use `python3 urllib.request`.

3. **Dynamic IP lost on stop/start** — Allocated Elastic IP `3.131.8.229` (`eipalloc-051feb4d39caf4ee4`).

---

## 7. Safety Verification

| Rule | Status |
|------|--------|
| Paper mode only | PAPER mode, $100K equity |
| No real-money trading | GODSVIEW_ENABLE_LIVE_TRADING=false |
| C4 threshold at 80 | Confirmed (≥80=PAPER_TRADE) |
| Kill switch available | kill_switch=False (ready) |
| No paper data lost | PostgreSQL volume persisted |
| AMI backup exists | ami-04e123003ab406b73 |

---

## 8. Smoothness Score

### Before (t3.small, 2GB RAM)
- Services running: 4/14 (29%)
- Python v2 services: 0/10 (0%)
- RAM headroom: ~200MB (10%)
- Backtesting: not possible (OOM)
- Dashboard: yes but slow

### After (m6i.xlarge, 16GB RAM)
- Services running: 14/14 (100%)
- Python v2 services: 10/10 (100%)
- RAM headroom: 12GB (80%)
- Backtesting: ready via py-backtest service
- Dashboard: sub-millisecond response

### Overall Smoothness Score: **96/100**

Deductions:
- -2: C4 strategy endpoint takes 7.2s (live analysis, expected)
- -2: MLflow healthcheck needed custom fix (minor)

---

## 9. Git Commits for This Phase

```
eb9f2346 fix: mlflow healthcheck use python3 instead of curl
23cd237b fix: scheduler service structlog-style kwargs → standard logging format
b5d4b6a2 Controlled validation: T65 vs T80 proves threshold 80 correct
```

---

## 10. Live Access

- **Dashboard:** http://3.131.8.229
- **C4 Strategy:** http://3.131.8.229/api/signal-engine/c4-strategy
- **Signal Health:** http://3.131.8.229/api/signal-engine/health
- **Signals:** http://3.131.8.229/api/signal-engine/signals
- **Summary:** http://3.131.8.229/api/signal-engine/summary
