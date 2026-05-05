# Single EC2 + Docker Deployment

The minimal way to run GodsView in paper mode on one box. No Fargate,
no RDS, no managed Redis — just a single EC2 instance running
docker-compose against the bundled Postgres + Redis containers.

This is the **recommended starting topology** for the paper-trading
proof phase. Once 30+ days of clean paper logs exist (per the user's
Phase 1 acceptance criteria), the existing `infra/` CDK stack can be
brought online for AWS-managed scaling.

## 1. Prerequisites

- An AWS account with EC2 access
- A keypair you can SSH to
- Alpaca paper API keys
- A domain (optional, for HTTPS — covered below)

## 2. EC2 instance

| Setting | Recommended |
|---|---|
| AMI | Amazon Linux 2023 (or Ubuntu 24.04 LTS) |
| Instance type | `t3.medium` (2 vCPU, 4 GB) for paper mode; `t3.large` for higher trade frequency |
| Storage | 30 GB gp3 root + 30 GB gp3 EBS attached at `/data` for `MEMORY_STORE_PATH` and Postgres volume |
| Security group | TCP 22 (your IP only), TCP 80 (public if exposing dashboard), TCP 443 (if HTTPS) |
| IAM role | none required for single-EC2 mode |

## 3. Bootstrap script (`deploy/ec2-bootstrap.sh`)

SSH into the box and run the bootstrap script (committed under `deploy/`):

```bash
sudo bash deploy/ec2-bootstrap.sh
```

What it does:

1. Installs Docker + docker compose plugin
2. Creates `/opt/godsview` and chowns it to the `ec2-user`
3. Creates `/data/memory` and `/data/postgres` for persistent volumes
4. Adds the user to the `docker` group

You'll need to log out and back in once after the bootstrap so the
`docker` group membership takes effect.

## 4. Clone + configure

```bash
cd /opt
git clone https://github.com/Santhakumarramesh/Godsview.git godsview
cd godsview

# Copy and edit env
cp .env.example .env
$EDITOR .env

# At minimum set:
#   POSTGRES_PASSWORD                — strong random
#   ALPACA_API_KEY / ALPACA_SECRET_KEY
#   GODSVIEW_OPERATOR_TOKEN           — `openssl rand -hex 32`
#   CORS_ORIGIN                       — your domain or `*` for testing
#   GODSVIEW_SYSTEM_MODE=paper         — DO NOT change to live yet
#   GODSVIEW_RUN_RECONCILER=true       — enable Phase 5 jobs
#   GODSVIEW_RUN_DATA_HEALTH=true
```

See `docs/PHASE_5/ENV_MATRIX.md` for the full env reference.

## 5. Bring it up (minimal stack)

```bash
docker compose -f docker-compose.minimal.yml up -d --build
```

This starts four containers: `postgres`, `redis`, `api`, `nginx`.
**No Python microservices** are started — the Phase 1–5 backend lives
entirely inside `api`.

To use the full microservice stack (rare for paper mode):
```bash
docker compose -f docker-compose.yml up -d --build
```

## 6. Run database migrations

```bash
# Check migrations dir contents
ls lib/db/migrations/

# Apply
docker compose -f docker-compose.minimal.yml exec api \
  pnpm --filter @workspace/db run migrate
```

## 7. Verify

```bash
# Health endpoints
curl http://localhost/healthz
curl http://localhost/api/system/diagnostics

# Phase 3 grep proofs (run from the repo root)
grep -rn "placeOrder\b" artifacts/api-server/src --include="*.ts" \
  | grep -v __tests__ | grep -v "\.test\." \
  | grep -v "//.*placeOrder\|^[^:]*: \* "
# Expected: only lib/order_executor.ts:401 + lib/alpaca.ts:660

# Phase 4 — confirm proof endpoints respond
curl http://localhost/api/proof/trades  | jq '.kind, .count'
curl http://localhost/api/proof/metrics | jq '.metrics.total_executed'
curl http://localhost/api/proof/equity  | jq '.starting_equity'

# Phase 5 — confirm jobs running
curl http://localhost/api/proof/reconciliation/status | jq '.reconciler.running, .data_health.running'

# Tail logs
docker compose -f docker-compose.minimal.yml logs -f api | jq -r '
  select(.channel == "execution" or .channel == "proof" or .channel == "reconciliation")'
```

## 8. Backup

The Postgres volume holds all trade history. Take a daily snapshot:

```bash
# Add to /etc/cron.daily/godsview-backup:
docker compose -f /opt/godsview/docker-compose.minimal.yml exec -T postgres \
  pg_dump -U godsview godsview | gzip > /data/backups/godsview-$(date +%F).sql.gz
find /data/backups -name "godsview-*.sql.gz" -mtime +14 -delete
```

To restore:
```bash
gunzip -c /data/backups/godsview-2026-05-05.sql.gz | \
  docker compose -f docker-compose.minimal.yml exec -T postgres psql -U godsview godsview
```

## 9. HTTPS (optional)

The minimal stack ships HTTP only. For HTTPS, terminate at nginx with
Caddy or certbot:

```bash
sudo dnf install -y certbot
sudo certbot certonly --standalone -d yourdomain.com
# Mount /etc/letsencrypt into nginx and add a 443 server block in nginx/default.conf.
```

Or put the EC2 box behind an AWS ALB with an ACM certificate (no
nginx changes needed).

## 10. Update / redeploy

```bash
cd /opt/godsview
git pull
docker compose -f docker-compose.minimal.yml up -d --build api
```

The api container's healthcheck (`start_period: 60s`) gives it room
to boot, run startup validators, and start the Phase 5 background
jobs before being marked healthy.

## 11. Rollback

```bash
cd /opt/godsview
git checkout PREVIOUS_GOOD_SHA
docker compose -f docker-compose.minimal.yml up -d --build api
```

Postgres state survives container rebuilds (pgdata volume).
