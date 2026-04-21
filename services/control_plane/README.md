# GodsView control_plane

The authoritative service for GodsView v2. Owns identity, feature flags,
audit log, SLO catalog, system config, and orchestration of downstream
services via the event bus.

## Local dev

```bash
cd services/control_plane
python3 -m venv .venv && source .venv/bin/activate
pip install -e .[dev]

# env
cp ../../.env.example ../../.env
export DATABASE_URL=postgresql+asyncpg://godsview:godsview@localhost:5432/godsview
export REDIS_URL=redis://localhost:6379/0
export JWT_SIGNING_KEY=dev-secret-do-not-use-in-prod-at-least-32-chars

# migrations
alembic upgrade head

# seed admin + default flags
python -m app.scripts.seed_bootstrap

# run
uvicorn app.main:app --reload --port 8000
```

Interactive docs at `http://localhost:8000/docs`.

## Phase surface

Phase 0 ships: `GET /health/live`, `GET /health/ready`, `POST /auth/login`,
`POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`, flags, system
config, audit (read-only list), and a bootstrap seed script.

Subsequent phases extend this service with signals ingestion proxy (2),
risk engine (7), promotion FSM (8), alert router (9), intelligence agent
orchestration (10), and replay controller (14).
