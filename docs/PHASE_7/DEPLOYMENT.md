# Phase 7 — Deployment

The single source of truth for taking the system from a freshly-launched
EC2 instance to a continuously-running paper-trading deployment.

This document is operational. It contains no code changes. Every command
is intended to be copy-pasted exactly. When values must be replaced
(domain, IP, token), they appear as `<ANGLE_BRACKET_PLACEHOLDERS>`.

Contents:

1. EC2 launch + security group
2. Host bootstrap (Docker, Compose, dirs, user)
3. Clone + `.env`
4. `docker compose up`
5. Post-deploy validation (curl)
6. Failure tests (DB kill, env removal, rate-limit spam)
7. Logging validation
8. Security checks
9. Paper-run start + day-2 ongoing checks
10. Six deliverable checklists

---

## 1. EC2 launch + security group

### 1.1 Launch instance

| Setting | Exact value |
|---|---|
| AMI | **Ubuntu Server 22.04 LTS (HVM), SSD volume type** (default x86_64) |
| Instance type | `t3.medium` (2 vCPU, 4 GiB) |
| Key pair | use an existing keypair you can SSH with |
| Network | default VPC, default subnet, public IP |
| Storage | Root EBS: **30 GB gp3** |
| Storage | Additional EBS: **30 GB gp3** mounted at `/data` (Postgres + memory store) |
| IAM role | none required for this topology |

### 1.2 Security group rules

Inbound:

| Type | Port | Source | Note |
|---|---|---|---|
| SSH | 22 | `<YOUR_OFFICE_IP>/32` only | never `0.0.0.0/0` |
| HTTP | 80 | `0.0.0.0/0` (or VPN-only if internal) | nginx is the public surface |
| HTTPS | 443 | `0.0.0.0/0` | optional, only if you terminate TLS on the box |
| Custom TCP | 3001 | none (or `<BASTION>/32` only) | the api container is exposed via nginx; do NOT open 3001 publicly |

Outbound: leave default (all traffic allowed). The api needs egress to:
- `paper-api.alpaca.markets` and `data.alpaca.markets` on 443
- `api.anthropic.com` on 443 (only if Claude veto layer is configured)
- Docker Hub on 443 (image pulls)

### 1.3 Connect

```bash
chmod 600 <KEYFILE>.pem
ssh -i <KEYFILE>.pem ubuntu@<EC2_PUBLIC_IP>
```

---

## 2. Host bootstrap

The bootstrap script committed at `deploy/ec2-bootstrap.sh` automates
this section. Either run it after cloning the repo, OR run the
equivalent commands inline below.

### 2.1 Mount the data volume

```bash
# Identify the unattached EBS volume (usually /dev/nvme1n1 or /dev/xvdf)
sudo lsblk

# Format it (one-time only)
sudo mkfs -t ext4 /dev/nvme1n1

# Mount and persist
sudo mkdir -p /data
sudo mount /dev/nvme1n1 /data
echo "/dev/nvme1n1 /data ext4 defaults,nofail 0 2" | sudo tee -a /etc/fstab

# Subdirectories used by docker-compose.minimal.yml volumes
sudo mkdir -p /data/postgres /data/memory /data/backups /data/logs
sudo chown -R ubuntu:ubuntu /data
```

### 2.2 Install Docker and the Compose plugin

```bash
sudo apt-get update -y
sudo apt-get install -y \
  ca-certificates curl gnupg jq git

# Docker's official GPG key + apt source
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update -y
sudo apt-get install -y \
  docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Verify
docker --version
docker compose version
```

### 2.3 Add ubuntu to the docker group

```bash
sudo usermod -aG docker ubuntu

# Pick up the group membership without rebooting
newgrp docker

# Verify (should NOT print 'permission denied')
docker ps
```

### 2.4 Enable Docker on boot

```bash
sudo systemctl enable --now docker
sudo systemctl status docker --no-pager | head -5
```

---

## 3. Clone the repo and create `.env`

### 3.1 Clone

```bash
sudo mkdir -p /opt/godsview
sudo chown ubuntu:ubuntu /opt/godsview
cd /opt
git clone https://github.com/Santhakumarramesh/Godsview.git godsview
cd godsview

# Verify the Phase 1–6 commits are present
git log --oneline | head -5
```

### 3.2 Create `.env` from the canonical template

The `.env.example` in the repo is from before Phase 3. Use the
template below — it reflects the Phase 1–6 contract documented in
`docs/PHASE_5/ENV_MATRIX.md`. Copy this into `/opt/godsview/.env`
verbatim and fill in the four `<...>` values.

```bash
cd /opt/godsview
cat > .env <<'ENVEOF'
# ─── Runtime ─────────────────────────────────────────────────────
NODE_ENV=production
PORT=3001
HTTP_PORT=80
LOG_LEVEL=info
GODSVIEW_TRUST_PROXY=true

# ─── CORS — set to your domain or "*" for testing ───────────────
CORS_ORIGIN=*

# ─── Database (compose-internal Postgres) ──────────────────────
DATABASE_URL=postgresql://godsview:<SET_A_STRONG_PASSWORD>@postgres:5432/godsview
POSTGRES_PASSWORD=<SET_A_STRONG_PASSWORD>
DB_POOL_MAX=10

# ─── Redis (compose-internal) ───────────────────────────────────
REDIS_URL=redis://redis:6379

# ─── Memory store (mounted to /data on host) ───────────────────
MEMORY_STORE_PATH=/data/memory

# ─── Broker (Alpaca PAPER) ─────────────────────────────────────
ALPACA_API_KEY=<YOUR_PAPER_KEY_PK_...>
ALPACA_SECRET_KEY=<YOUR_PAPER_SECRET>
ALPACA_BASE_URL=https://paper-api.alpaca.markets

# ─── Phase 3 — system mode + execution ─────────────────────────
GODSVIEW_SYSTEM_MODE=paper
GODSVIEW_OPERATOR_TOKEN=<RUN_openssl_rand_-hex_32_AND_PASTE_HERE>

# ─── Phase 3 — risk gates ──────────────────────────────────────
GODSVIEW_MAX_DATA_AGE_MS=30000
GODSVIEW_MAX_DAILY_LOSS_PCT=2
GODSVIEW_MAX_CONCURRENT_POSITIONS=1
GODSVIEW_MAX_TRADES_PER_DAY=3

# ─── Phase 4 — proof system ────────────────────────────────────
GODSVIEW_PAPER_STARTING_EQUITY=10000

# ─── Phase 5 — background jobs (REQUIRED for continuous run) ───
GODSVIEW_RUN_RECONCILER=true
GODSVIEW_RECONCILER_INTERVAL_MS=300000
GODSVIEW_RUN_DATA_HEALTH=true
GODSVIEW_DATA_HEALTH_INTERVAL_MS=60000

# ─── Phase 6 — per-route rate limits (defaults shown) ──────────
GODSVIEW_PHASE6_ORDERS_RATE_LIMIT_PER_MIN=30
GODSVIEW_PHASE6_PROOF_RATE_LIMIT_PER_MIN=120
GODSVIEW_PHASE6_RECONCILE_RATE_LIMIT_PER_MIN=6

# ─── Other operational knobs ───────────────────────────────────
GODSVIEW_RATE_LIMIT_WINDOW_MS=60000
GODSVIEW_RATE_LIMIT_MAX=300
GODSVIEW_REQUEST_TIMEOUT_MS=45000
GODSVIEW_KEEPALIVE_TIMEOUT_MS=65000
GODSVIEW_SHUTDOWN_TIMEOUT_MS=20000
GODSVIEW_REQUEST_BODY_LIMIT=1mb
ENVEOF

# Generate the operator token in place
TOK=$(openssl rand -hex 32)
sed -i "s|<RUN_openssl_rand_-hex_32_AND_PASTE_HERE>|${TOK}|g" .env
echo "Operator token written into .env. Save this for curl calls:"
echo "${TOK}"

# Generate a strong DB password in place
DBP=$(openssl rand -base64 24 | tr -d /=+ | cut -c1-32)
sed -i "s|<SET_A_STRONG_PASSWORD>|${DBP}|g" .env

# Set Alpaca keys manually
$EDITOR .env
# (replace <YOUR_PAPER_KEY_PK_...> and <YOUR_PAPER_SECRET>)

# Lock down permissions
chmod 600 .env
```

### 3.3 Verify Alpaca keys before bringing the stack up

```bash
KEY=$(grep ^ALPACA_API_KEY .env | cut -d= -f2)
SEC=$(grep ^ALPACA_SECRET_KEY .env | cut -d= -f2)
curl -s -H "APCA-API-KEY-ID: ${KEY}" -H "APCA-API-SECRET-KEY: ${SEC}" \
  https://paper-api.alpaca.markets/v2/account | jq .
# Expect: { "id": "...", "account_number": "...", "status": "ACTIVE", ... }
# If you see {"message":"forbidden."} the keys are wrong.
```

---

## 4. Docker deployment

### 4.1 Build and start

```bash
cd /opt/godsview
docker compose -f docker-compose.minimal.yml up -d --build
```

Expected: four containers (`postgres`, `redis`, `api`, `nginx`).
Build takes 3–8 minutes on a t3.medium the first time (pnpm install +
esbuild + vite). Subsequent rebuilds are ~30 s with the layer cache.

### 4.2 Verify containers are healthy

```bash
docker compose -f docker-compose.minimal.yml ps
```

Expected (after ~60 s while the api healthcheck runs):

```
NAME                  IMAGE                        STATUS
godsview-postgres-1   postgres:16-alpine           Up (healthy)
godsview-redis-1      redis:7-alpine               Up (healthy)
godsview-api-1        godsview-api:latest          Up (healthy)
godsview-nginx-1      nginx:1.27-alpine            Up
```

If any container is `Restarting`, see Section 6 (failure testing) and
Section 9 (logs).

### 4.3 Run database migrations

```bash
docker compose -f docker-compose.minimal.yml exec api \
  pnpm --filter @workspace/db run migrate
```

Expected: `Migrations applied: N` or `Already up to date`.

---

## 5. Post-deploy validation

All curls below assume the api is reachable on `localhost` (i.e. you
are on the EC2 host). For external testing, replace `localhost` with
`<EC2_PUBLIC_IP>` and curl from your laptop.

### 5.1 Liveness + Phase 6 health

```bash
# Original liveness (immediate, no dep check)
curl -s http://localhost/healthz | jq .

# Phase 6 health: db + redis + last reconciler/data-health timestamps
curl -s http://localhost/api/health/phase6 | jq .
```

Expected (Phase 6):

```json
{
  "service": { "status": "ok", "uptime_sec": 120 },
  "db":      { "status": "ok", "latency_ms": 4 },
  "redis":   { "status": "ok", "latency_ms": 1 },
  "last_reconciler_run":    null,        // null until first tick fires
  "last_data_health_check": null,
  "checked_at": "2026-05-05T12:00:00.000Z"
}
```

### 5.2 Strict readiness

```bash
curl -s http://localhost/api/ready/phase6 | jq .
```

Expected when ready (HTTP 200):

```json
{
  "ready": true,
  "reasons": [],
  "db":    { "status": "ok", "latency_ms": 4 },
  "redis": { "status": "ok", "latency_ms": 1 },
  "env_missing": [],
  "checked_at": "2026-05-05T12:00:00.000Z"
}
```

### 5.3 Phase 6 metrics

```bash
curl -s http://localhost/api/ops/metrics | jq .
```

### 5.4 Proof endpoints (read-only)

```bash
# Empty until first paper trade — that's expected
curl -s http://localhost/api/proof/trades  | jq '.kind, .count'
curl -s http://localhost/api/proof/metrics | jq '.metrics'
curl -s http://localhost/api/proof/equity  | jq '.starting_equity, .ending_equity'

# Integrity check (should report zero violations on a fresh install)
curl -s http://localhost/api/proof/integrity | jq '.total_violations'
```

### 5.5 Reconciliation status (Phase 5 jobs running?)

```bash
curl -s http://localhost/api/proof/reconciliation/status | jq .
```

Expect both `reconciler.enabled` and `data_health.enabled` to be `true`.
After ~5 min the first `reconciler.last_result` will populate.

### 5.6 Manual reconciliation trigger (operator-token gated)

```bash
TOK=$(grep ^GODSVIEW_OPERATOR_TOKEN /opt/godsview/.env | cut -d= -f2)

# Without the token (must fail with 401)
curl -sX POST http://localhost/api/proof/reconciliation/run -w "\nHTTP %{http_code}\n"

# With the token (must succeed)
curl -sX POST http://localhost/api/proof/reconciliation/run \
  -H "X-Operator-Token: ${TOK}" | jq .
```

---

## 6. Failure tests

Run each one ONCE during the initial commissioning so you have proof
that the safety properties hold. Recovery after each test is a single
`docker compose ... up -d`.

### 6.1 Kill the database — readiness must turn red

```bash
docker compose -f docker-compose.minimal.yml stop postgres

curl -s http://localhost/api/ready/phase6 | jq .
# Expect: HTTP 503, ready: false, reasons includes "db_fail"

curl -s http://localhost/api/health/phase6 | jq .
# Expect: HTTP 503, db.status: "fail"

# Recover
docker compose -f docker-compose.minimal.yml start postgres
sleep 10
curl -s http://localhost/api/ready/phase6 | jq .ready
# Expect: true within ~15 s
```

### 6.2 Remove a required env var — container must restart loop

```bash
# Snapshot the current ALPACA_API_KEY value
ORIG=$(grep ^ALPACA_API_KEY /opt/godsview/.env)

# Blank it out
sed -i 's|^ALPACA_API_KEY=.*$|ALPACA_API_KEY=|' /opt/godsview/.env

# Recreate the api container so it picks up the new env
docker compose -f docker-compose.minimal.yml up -d --no-deps --force-recreate api

# Confirm the restart loop
docker compose -f docker-compose.minimal.yml ps api
# Expect: status "Restarting" (Phase 6 fail-fast exited with code 1)

# Confirm the fail-fast log line
docker compose -f docker-compose.minimal.yml logs --no-color --tail=30 api | grep -i "phase6"
# Expect: "[phase6] required env missing" with var: ALPACA_API_KEY

# Restore
sed -i "s|^ALPACA_API_KEY=.*$|${ORIG}|" /opt/godsview/.env
docker compose -f docker-compose.minimal.yml up -d --no-deps --force-recreate api
sleep 30
docker compose -f docker-compose.minimal.yml ps api
# Expect: Up (healthy) within ~60 s
```

### 6.3 Spam orders — rate limit must fire (429)

```bash
TOK=$(grep ^GODSVIEW_OPERATOR_TOKEN /opt/godsview/.env | cut -d= -f2)

# Hit the order endpoint 35 times in one minute (limit is 30/min)
for i in $(seq 1 35); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost/api/alpaca/orders \
    -H "Content-Type: application/json" \
    -H "X-Operator-Token: ${TOK}" \
    -d '{"symbol":"BTCUSD","side":"buy","qty":0.0001,"limit_price":50000,"stop_loss_price":49500,"take_profit_price":51000}'
done | sort | uniq -c

# Expect counts roughly:
#   ~30 of 200/4xx (some accepted, some rejected by other gates)
#   ~5  of 429 (rate-limited)
```

### 6.4 Spam reconciliation trigger — rate limit must fire (6/min)

```bash
TOK=$(grep ^GODSVIEW_OPERATOR_TOKEN /opt/godsview/.env | cut -d= -f2)

for i in $(seq 1 10); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost/api/proof/reconciliation/run \
    -H "X-Operator-Token: ${TOK}"
done | sort | uniq -c

# Expect: ~6 of 200, ~4 of 429
```

---

## 7. Logging validation

### 7.1 Tail everything

```bash
docker compose -f docker-compose.minimal.yml logs -f api
```

Pino emits JSON lines in production (`NODE_ENV=production`). Each
line carries: `time`, `level`, `channel` (when from a Phase 5 child
logger), `request_id` (added by pinoHttp), `audit_id` (on Phase 3
audit lines and Phase 4-5 trade lifecycle lines), `msg`, plus any
contextual fields.

### 7.2 Filter by channel

```bash
# Reconciliation channel only
docker compose -f docker-compose.minimal.yml logs --no-color api | \
  jq -r 'select(.channel=="reconciliation") | "\(.time) \(.level) \(.msg)"'

# Proof channel
docker compose -f docker-compose.minimal.yml logs --no-color api | \
  jq -r 'select(.channel=="proof") | "\(.time) \(.level) \(.msg)"'

# Execution audit lines (priority high = fallback closures, kill switch trips)
docker compose -f docker-compose.minimal.yml logs --no-color api | \
  jq -r 'select(.priority=="high")'

# All HIGH PRIORITY events across channels
docker compose -f docker-compose.minimal.yml logs --no-color api | \
  jq -r 'select(.priority=="high" or (.blocking_gate // empty) != null)'

# Trace by audit_id (after a known order attempt)
AUDIT_ID=audit_1714960800000_42
docker compose -f docker-compose.minimal.yml logs --no-color api | \
  jq -r --arg id "$AUDIT_ID" 'select(.audit_id == $id)'

# Trace by request_id (after a known curl call — read X-Request-ID from response headers)
REQ_ID=...
docker compose -f docker-compose.minimal.yml logs --no-color api | \
  jq -r --arg id "$REQ_ID" 'select(.req.id == $id)'
```

---

## 8. Security checks

### 8.1 Operator-token gate (must reject without token)

```bash
# Reconciliation trigger
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost/api/proof/reconciliation/run
# Expect: 401

curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost/api/proof/reconciliation/run \
  -H "X-Operator-Token: WRONG_TOKEN"
# Expect: 403

curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost/api/proof/reconciliation/run \
  -H "X-Operator-Token: ${TOK}"
# Expect: 200
```

### 8.2 No secrets in logs (must be empty)

```bash
docker compose -f docker-compose.minimal.yml logs --no-color api | \
  grep -E "ALPACA_SECRET_KEY=|GODSVIEW_OPERATOR_TOKEN=|POSTGRES_PASSWORD="
# Expect: NO output. If any line matches, redact and reload.

docker compose -f docker-compose.minimal.yml logs --no-color api | \
  grep -iE "secret|password|api[_-]?key" | head
# Expect: only structural strings (e.g., "no_trading_key" reason codes),
# never raw secret values.
```

### 8.3 No stack traces in production responses

```bash
# Trigger a 5xx by sending malformed JSON
curl -s -X POST http://localhost/api/alpaca/orders \
  -H "Content-Type: application/json" \
  -H "X-Operator-Token: ${TOK}" \
  -d 'this is not json' | jq .
# Expect: { "error": "...", "message": "...", "request_id": "..." }
# MUST NOT include a "stack" field or file paths from artifacts/api-server/.
```

### 8.4 No public access to operator surfaces

From your laptop (NOT from the EC2 host):

```bash
PUB=<EC2_PUBLIC_IP>
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://${PUB}/api/system/kill-switch -d '{"on":true}'
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://${PUB}/api/proof/reconciliation/run
# Both: 401 or 403 (operator-token gated)
```

---

## 9. Paper-run start + day-2 ongoing checks

### 9.1 Confirm continuous-run conditions (run once after deployment)

```bash
# 1. Stack is healthy
docker compose -f docker-compose.minimal.yml ps | grep -v "(healthy)" | head
# Expect: only the header line and nginx (which has no healthcheck)

# 2. Phase 6 readiness is green
curl -s http://localhost/api/ready/phase6 | jq -r .ready
# Expect: true

# 3. Both background jobs are running
curl -s http://localhost/api/proof/reconciliation/status | \
  jq '{recon_enabled: .reconciler.enabled, recon_running: .reconciler.running, health_enabled: .data_health.enabled, health_running: .data_health.running}'
# Expect: all four → true

# 4. System mode is paper
curl -s http://localhost/api/system/diagnostics | jq -r .system_mode
# Expect: "paper"

# 5. Restart policy is "always"
docker inspect $(docker compose -f /opt/godsview/docker-compose.minimal.yml ps -q api) \
  --format '{{ .HostConfig.RestartPolicy.Name }}'
# Expect: "always"
```

### 9.2 Daily ops check (automate via cron if you like)

```bash
#!/usr/bin/env bash
# /opt/godsview/scripts/daily-check.sh
cd /opt/godsview
echo "=== $(date -Is) ==="
curl -fsS http://localhost/api/ready/phase6 | jq -c '{ready, reasons}'
curl -fsS http://localhost/api/proof/integrity | jq -c '{total_violations, by_rule}'
curl -fsS http://localhost/api/ops/metrics | \
  jq -c '{requests: .counters.total_requests, failed: .counters.failed_requests,
          orders: .counters.order_executions, rejected: .counters.rejected_trades,
          recon: .counters.reconciliation_runs}'
curl -fsS http://localhost/api/proof/metrics | jq -c '.metrics | {trades: .total_executed, closed: .total_closed, win_rate, total_pnl, max_drawdown_pct}'
```

Wire to cron:
```bash
sudo tee /etc/cron.d/godsview-daily <<'CRON'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 8 * * * ubuntu /opt/godsview/scripts/daily-check.sh >> /data/logs/daily-check.log 2>&1
CRON
```

### 9.3 Weekly Postgres backup

```bash
sudo tee /etc/cron.daily/godsview-backup <<'BACKUP'
#!/usr/bin/env bash
set -e
cd /opt/godsview
docker compose -f docker-compose.minimal.yml exec -T postgres \
  pg_dump -U godsview godsview | gzip > /data/backups/godsview-$(date +%F).sql.gz
find /data/backups -name "godsview-*.sql.gz" -mtime +14 -delete
BACKUP
sudo chmod +x /etc/cron.daily/godsview-backup
```

Restore (if ever needed):

```bash
gunzip -c /data/backups/godsview-2026-05-05.sql.gz | \
  docker compose -f /opt/godsview/docker-compose.minimal.yml exec -T postgres \
  psql -U godsview godsview
```

### 9.4 Confirm the system is generating paper trades

After the strategy fires its first signal (depends on market
conditions; can be hours or days):

```bash
# Should show count > 0 once any setup confirms
curl -s http://localhost/api/proof/trades | jq '.count'

# Equity curve should have at least one point once any trade closes
curl -s http://localhost/api/proof/equity | jq '.points | length'

# Metrics
curl -s http://localhost/api/proof/metrics | jq '.metrics'
```

---

## 10. Six deliverable checklists

### Deliverable 1 — EC2 setup commands (one-line summary)

```bash
# After SSH'ing in as ubuntu
sudo apt-get update -y && sudo apt-get install -y ca-certificates curl gnupg jq git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update -y && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker ubuntu && newgrp docker
sudo systemctl enable --now docker
sudo mkdir -p /data/{postgres,memory,backups,logs}
sudo chown -R ubuntu:ubuntu /data /opt
```

### Deliverable 2 — `.env` template

The full template is in section 3.2 above. It is also reproduced as a
self-contained block in `docs/PHASE_5/ENV_MATRIX.md` section 9.

Required values to fill in:

```
POSTGRES_PASSWORD            (random, openssl rand -base64 24)
GODSVIEW_OPERATOR_TOKEN      (random, openssl rand -hex 32)
ALPACA_API_KEY               (your paper-trading key)
ALPACA_SECRET_KEY            (your paper-trading secret)
CORS_ORIGIN                  (your domain, or "*" for testing)
```

### Deliverable 3 — Docker commands

```bash
# Bring up
docker compose -f docker-compose.minimal.yml up -d --build

# Status
docker compose -f docker-compose.minimal.yml ps

# Logs
docker compose -f docker-compose.minimal.yml logs -f api
docker compose -f docker-compose.minimal.yml logs -f api | jq -r 'select(.channel=="reconciliation")'

# Restart api after config change
docker compose -f docker-compose.minimal.yml up -d --no-deps --force-recreate api

# Apply DB migrations
docker compose -f docker-compose.minimal.yml exec api pnpm --filter @workspace/db run migrate

# Stop everything
docker compose -f docker-compose.minimal.yml down

# Update code and rebuild
cd /opt/godsview && git pull && \
  docker compose -f docker-compose.minimal.yml up -d --build api
```

### Deliverable 4 — Verification checklist

Run after every fresh deploy. **All must be ✓ before declaring the
system "running."**

| # | Check | Command | Pass criterion |
|---|---|---|---|
| 1 | Containers up | `docker compose -f docker-compose.minimal.yml ps` | postgres, redis, api all `(healthy)` |
| 2 | Liveness | `curl -s http://localhost/healthz` | `status: "ok"` |
| 3 | Phase 6 health | `curl -s http://localhost/api/health/phase6` | HTTP 200; `service.status: "ok"`; `db` and `redis` both `ok` |
| 4 | Phase 6 readiness | `curl -s http://localhost/api/ready/phase6` | HTTP 200; `ready: true`; `env_missing: []` |
| 5 | Metrics endpoint | `curl -s http://localhost/api/ops/metrics` | returns counters object |
| 6 | Proof — trades | `curl -s http://localhost/api/proof/trades \| jq .kind` | `"executed"` |
| 7 | Proof — metrics | `curl -s http://localhost/api/proof/metrics \| jq .starting_equity` | `10000` (or your `GODSVIEW_PAPER_STARTING_EQUITY`) |
| 8 | Proof — equity | `curl -s http://localhost/api/proof/equity \| jq .starting_equity` | matches above |
| 9 | Proof — integrity | `curl -s http://localhost/api/proof/integrity \| jq .total_violations` | `0` |
| 10 | Reconciler enabled | `curl -s http://localhost/api/proof/reconciliation/status \| jq .reconciler.enabled` | `true` |
| 11 | Data health enabled | `curl -s http://localhost/api/proof/reconciliation/status \| jq .data_health.enabled` | `true` |
| 12 | System mode | `curl -s http://localhost/api/system/diagnostics \| jq -r .system_mode` | `"paper"` |
| 13 | Operator gate | `curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost/api/proof/reconciliation/run` | `401` |
| 14 | Restart policy | `docker inspect $(docker compose -f docker-compose.minimal.yml ps -q api) --format '{{ .HostConfig.RestartPolicy.Name }}'` | `always` |
| 15 | Alpaca account reachable | (curl from section 3.3) | account JSON returned |

### Deliverable 5 — Failure test checklist

Run all five during initial commissioning. Restore after each.

| # | Failure | Trigger | Expected | Recovery |
|---|---|---|---|---|
| 1 | DB down | `docker compose stop postgres` | `/api/ready/phase6` → 503, `db.status: "fail"` | `docker compose start postgres`, wait ~15 s, recheck |
| 2 | Required env removed | Blank `ALPACA_API_KEY` in `.env`, recreate api | container Restarting; logs show `[phase6] required env missing` | restore env, recreate api |
| 3 | Order rate limit | Loop POST 35× to `/api/alpaca/orders` in 60 s | ~30 of 200/4xx, ~5 of 429 | wait 60 s, limit resets |
| 4 | Reconciler rate limit | Loop POST 10× to `/api/proof/reconciliation/run` with token | ~6 of 200, ~4 of 429 | wait 60 s, limit resets |
| 5 | Operator gate | POST to reconciliation/run without token | 401 | n/a |

### Deliverable 6 — First-run checklist

Once the verification checklist passes, leave the system running and
check these conditions over the next 24 hours:

- [ ] After ~5 min: `curl -s http://localhost/api/proof/reconciliation/status | jq .reconciler.last_result.ran_at` is non-null.
- [ ] After ~1 min: `curl -s http://localhost/api/proof/reconciliation/status | jq .data_health.last_result.ran_at` is non-null.
- [ ] After 1 hour: `curl -s http://localhost/api/ops/metrics | jq .counters.total_requests` is non-zero (the readiness probes alone count).
- [ ] After 24 hours: `curl -s http://localhost/api/ops/metrics | jq .counters.reconciliation_runs` ≥ 24×60/5 ≈ 288 (one tick every 5 min default).
- [ ] After the first paper trade fires: `curl -s http://localhost/api/proof/trades | jq .count` ≥ 1; `audit_id` is set on every trade row.
- [ ] After the first trade closes: `curl -s http://localhost/api/proof/equity | jq '.points | length'` ≥ 1.
- [ ] After 24 hours of running: `curl -s http://localhost/api/proof/integrity | jq .total_violations` is 0 (or any violations are expected, e.g., legacy rows pre-dating the audit_id column).
- [ ] Daily backup is producing files in `/data/backups/godsview-YYYY-MM-DD.sql.gz`.
- [ ] No HIGH PRIORITY log lines appearing unexpectedly:
      `docker compose logs --no-color api | jq -r 'select(.priority=="high")' | head`

---

## Common operational issues

| Symptom | Likely cause | Fix |
|---|---|---|
| api restarts every ~30s | Phase 6 fail-fast env validator failed | check `docker compose logs api`; look for `[phase6] required env missing` |
| `db.status: "fail"` in /api/health/phase6 | Postgres container unhealthy or password mismatch | `docker compose logs postgres`; verify `POSTGRES_PASSWORD` matches both `DATABASE_URL` and the env var |
| All requests returning 503 | Database initial migration not run | `docker compose exec api pnpm --filter @workspace/db run migrate` |
| Orders returning `data_staleness` block | Alpaca WebSocket stream is in polling fallback or unauthenticated | `curl /api/alpaca/stream-status`; check Alpaca creds |
| Many `untracked_positions` in reconciler | Manual trades placed outside the system | this is informational; not an error |
| `closed_without_pnl` integrity violations | A `recordTradeClose` failed mid-flight | check `docker compose logs api` around the row's exit_time; manual UPDATE may be needed |
| Operator-token endpoint returns 403 even with correct token | `GODSVIEW_OPERATOR_TOKEN` env var has trailing whitespace or is unset | re-paste cleanly; restart api |

## When to escalate to live mode

Per Phase 1 acceptance criteria — **only after** you have:

- 30+ days of continuous paper running with no manual intervention
- 100+ closed trades in `/api/proof/trades`
- Zero unexplained `priority: "high"` log lines
- Zero un-actioned `total_violations` in `/api/proof/integrity`
- A reproducible understanding of the equity curve
- A documented procedure for switching `GODSVIEW_SYSTEM_MODE=live_enabled`,
  rotating to live Alpaca keys, and confirming the operator-token gate
  blocks unauthorized requests in live mode.

Live trading is OUT OF SCOPE for Phase 7. The current document is for
paper mode only.
