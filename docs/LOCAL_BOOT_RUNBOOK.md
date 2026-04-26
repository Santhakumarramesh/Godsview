# GodsView — Local Boot Runbook

The exact commands to bring GodsView up locally with real services. Every command is meant to be copy-pasted.

## 0. Prerequisites

- Docker Desktop ≥ 4.20 (Engine 24+)
- Docker Compose v2 (bundled)
- Node 20.x + pnpm 9.x (only needed if you want to run dev servers outside Docker)
- macOS or Linux. Windows works under WSL2.
- ~6 GB RAM available for containers
- Ports free: 80, 443, 3001, 5432, 6379

## 1. Repo state check

```bash
cd ~/Documents/"Playground 2"/Godsview/Godsview
git status
git log --oneline -5
```

Expected: clean working tree, latest commit visible.

## 2. Environment file

```bash
[ -f .env ] || cp .env.example .env
grep -E "^(DATABASE_URL|REDIS_URL|JWT_SECRET|TRADINGVIEW_WEBHOOK_SECRET)=" .env
```

If anything is empty, fill it in. Generate secrets with:

```bash
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 24   # TRADINGVIEW_WEBHOOK_SECRET
```

## 3. Build the dashboard static bundle

The dashboard is served as static files by nginx. It MUST be built before nginx starts.

```bash
cd artifacts/godsview-dashboard
pnpm install --frozen-lockfile
pnpm run build
ls -la dist/public/index.html   # confirm bundle exists
cd ../..
```

## 4. Boot the stack

```bash
docker compose up -d --build postgres redis api nginx
docker compose ps
```

Expected: 4 services healthy. `api` may take 30–60 s on first boot while migrations run.

## 5. Health checks

```bash
# Postgres reachable
docker compose exec postgres pg_isready -U godsview

# Redis reachable
docker compose exec redis redis-cli ping   # → PONG

# API health
curl -sf http://localhost:3001/health | jq .

# Dashboard reachable
curl -sf http://localhost/ -o /dev/null -w "%{http_code}\n"   # → 200

# OpenAPI docs
curl -sf http://localhost:3001/docs/openapi.json | jq '.info.title'
```

If any of these fail, see `docs/OPERATOR_RUNBOOK.md` § Troubleshooting.

## 6. DB migration + seed

```bash
docker compose exec api node /app/dist/migrate.js
docker compose exec api node /app/dist/seed.js
```

Expected output:
- Migrations: "Applied 0000_init.sql ... Applied 0009_*.sql"
- Seed: "Inserted 3 strategies, 10 brain entities, 1 default risk policy"

## 7. Real flow smoke test

```bash
# 1. Send a fake TradingView alert
bash scripts/test-tradingview-webhook.sh

# 2. Check it landed in DB
docker compose exec postgres psql -U godsview -c \
  "SELECT id, symbol, side, status, created_at FROM signals ORDER BY created_at DESC LIMIT 5;"

# 3. Check it appears in API
curl -s http://localhost:3001/api/signals | jq '.signals[0:3]'

# 4. Verify dashboard shows it
open http://localhost/  # navigate to /signals
```

## 8. Tear down

```bash
docker compose down                # stop, keep volumes
docker compose down -v             # stop AND wipe data
```

## 9. Common failures

| Symptom | Likely cause | Fix |
|---|---|---|
| `nginx` container restart loop | Dashboard `dist/public/` missing | Re-run step 3 |
| `api` exits with `ECONNREFUSED 5432` | Postgres still booting | `docker compose logs postgres` and wait for "ready to accept connections" |
| `api` 500 on `/health` | Migrations failed | `docker compose logs api \| grep migration` |
| `curl localhost` → 502 | API not up yet | wait 60s, retry |
| Dashboard blank | Vite build failed | check `artifacts/godsview-dashboard/dist/public/index.html` exists |

## 10. Where to look when something is wrong

```bash
docker compose logs -f api          # API logs (live)
docker compose logs -f postgres     # DB logs
docker compose exec api ls /data    # API persistent volume
docker compose exec api env | grep -E "^(NODE_ENV|DATABASE_URL|REDIS_URL)"
```
