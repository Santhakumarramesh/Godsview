# Architecture Reference

**Scope:** The locked-in structural decisions for the trading-OS
rebuild. Every phase references this document by section.

---

## 1. Target monorepo layout

The rebuild consolidates the current scattered layout (Node/Express
under `artifacts/api-server`, Python microservices under `services/`,
React/Vite dashboard, orphan root-level `.ts` files) into a single
coherent monorepo.

```
godsview/
├── README.md
├── ARCHITECTURE.md                     # top-level summary (points here)
├── pnpm-workspace.yaml                 # Node workspaces
├── pyproject.toml                      # Python workspace (uv/poetry)
├── tsconfig.base.json
├── package.json
├── docker-compose.yml                  # local dev
├── docker-compose.override.yml         # per-dev overrides (gitignored)
│
├── apps/                               # user-facing applications
│   ├── web/                            # Next.js 15 dashboard
│   │   ├── app/                        # App Router
│   │   │   ├── (auth)/                 # auth-only group
│   │   │   ├── (public)/               # public routes
│   │   │   ├── api/                    # Next.js API routes (BFF)
│   │   │   └── layout.tsx
│   │   ├── components/
│   │   ├── lib/
│   │   ├── styles/
│   │   └── next.config.ts
│   └── admin/                          # operator-only admin UI (optional, Phase 13)
│
├── services/                           # Python backend services
│   ├── control_plane/                  # FastAPI — the primary API
│   │   ├── app/
│   │   │   ├── main.py
│   │   │   ├── routes/                 # REST + SSE + WS routers
│   │   │   ├── models/                 # Pydantic request/response
│   │   │   ├── db/                     # SQLAlchemy models
│   │   │   ├── auth/
│   │   │   ├── deps.py
│   │   │   └── middleware/
│   │   ├── tests/
│   │   └── pyproject.toml
│   ├── ingestion/                      # market data + webhook ingestion
│   ├── orderflow/                      # order book processing + features
│   ├── backtest_runner/                # queued backtest execution
│   ├── calibration/                    # live-vs-backtest comparison
│   ├── promotion/                      # lifecycle state machine
│   ├── intelligence/                   # multi-agent reasoning
│   ├── execution/                      # broker adapters + order management
│   ├── screenshot_renderer/            # headless chart screenshots
│   ├── replay/                         # event replay engine
│   └── shared/                         # shared types, event bus, db, auth
│       ├── contracts.py
│       ├── event_bus.py
│       ├── db.py
│       ├── auth.py
│       └── tracing.py
│
├── packages/                           # Node/TS shared libs (if any remain)
│   ├── ui/                             # shared React components
│   └── sdk/                            # TS client for the Python API
│
├── infra/                              # CDK stacks
│   ├── lib/
│   │   ├── network_stack.ts
│   │   ├── storage_stack.ts
│   │   ├── data_stack.ts
│   │   ├── compute_stack.ts
│   │   ├── event_bus_stack.ts
│   │   └── observability_stack.ts
│   ├── bin/
│   └── cdk.json
│
├── ops/                                # operations tooling
│   ├── runbooks/                       # markdown runbooks
│   ├── scripts/                        # aws-deploy, railway-teardown, preflight, drills
│   └── dashboards/                     # CloudWatch dashboard JSON
│
├── docs/
│   ├── architecture/                   # ADRs
│   ├── operator/                       # OPERATOR_RUNBOOK, LAUNCH_CHECKLIST
│   └── api/                            # auto-generated openapi.json, redoc.html
│
├── tests/
│   ├── e2e/                            # cross-service end-to-end
│   ├── load/                           # k6 scripts
│   └── fixtures/
│
└── .github/
    ├── workflows/
    │   ├── ci.yml
    │   ├── cd.yml
    │   └── nightly-soak.yml
    └── CODEOWNERS
```

### Removed from repo in Phase 0

The current repo has ~30 orphan artifacts that Phase 0 either
re-homes or deletes:

- Root-level `.ts` files not referenced by any service (`attribution_engine_explain.ts`,
  `diagnostics.ts`, `fragility_detector.ts`, `guided_builder.ts`,
  `mode_manager.ts`, `post_trade_loop.ts`, `report_generator.ts`,
  `safety_boundaries.ts`, `self_monitor.ts`, `strategy_summarizer.ts`)
  → either (a) delete if truly dead, or (b) re-home under
  `services/intelligence/app/` with tests.
- `godsview-openbb/` and `godsview_openbb/` — duplicate trees.
  One stays under `services/ingestion/openbb/`, the other deletes.
- `replit.md`, `replit.nix`, `replit-start.sh` — delete (Replit is
  not a production target).
- `railway.json`, `railway.toml` — retire in Phase 12 per the
  existing cutover playbook.
- `mockup-sandbox/` under `artifacts/` — delete (was exploration).
- Multiple competing README/status docs at root
  (`CHANGES_SUMMARY.txt`, `IMPLEMENTATION_COMPLETION_REPORT.md`,
  `PHASES_12_16_SUMMARY.md`, `PRODUCTION.md`, `PRODUCTION_READINESS.md`,
  `QUICK_START.md`, `SESSION_HANDOFF.md`, `SYNTHETIC_DATA_SAFETY_FIXES.md`)
  → collapsed into `README.md` + `docs/architecture/ADRs`.

---

## 2. Service map

Nine backend services, one web app, one optional admin app. Each
service is independently deployable, has its own health endpoint,
its own migrations (if applicable), and its own tests.

### 2.1 `services/control_plane` (FastAPI)

**Role:** Primary API for the web app. Thin: delegates domain work
to other services via HTTP + event bus.
**Port:** 8000
**Scaling:** horizontal (stateless).
**Key routes:** see [`API_SURFACE.md`](API_SURFACE.md).

**Responsibilities:**
- Auth (JWT issue + verify), RBAC enforcement.
- Orchestration: signal/strategy/order/backtest CRUD.
- SSE + WebSocket fan-out for the dashboard.
- Request tracing (injects `X-Request-Id`).
- Rate limiting (per-user, per-endpoint).

### 2.2 `services/ingestion`

**Role:** Pull live market data from brokers/vendors and push into
the event bus. Also accepts raw webhook payloads.
**Port:** 8010
**Scaling:** horizontal; partitions by symbol.

**Responsibilities:**
- Broker WebSocket adapters (Alpaca v1, OpenBB, later IBKR/Binance).
- Raw event retention to S3 (append-only partitioned by UTC hour).
- Normalization to `MarketEvent` schema.
- Publish to `market.ticks`, `market.candles`, `market.depth`.
- Webhook endpoint `/webhook/tradingview` (signature verified,
  dedup-keyed, persisted to `webhook_receipts`).

### 2.3 `services/orderflow`

**Role:** Consume raw order book + trade tape and compute features.
**Port:** 8020
**Scaling:** horizontal; partitions by symbol.

**Responsibilities:**
- Feature computation: delta, cumulative delta, imbalance,
  absorption, liquidity sweeps, FVG detection, order block tagging.
- Rolling windows (1m/5m/15m/1h) persisted to `orderflow_snapshots`.
- Publish `orderflow.features` on every update.
- Serve `/api/orderflow/*` queries via the control plane.

### 2.4 `services/backtest_runner`

**Role:** Execute backtests (on-demand + continuous).
**Port:** 8030
**Scaling:** worker pool via SQS; 1 worker handles 1 run at a time.

**Responsibilities:**
- Deterministic historical execution with slippage + latency models.
- Walk-forward / out-of-sample harness.
- Scenario sets (regime / session / symbol cohorts).
- Artifact persistence to S3 (equity curve, trade list, metrics).
- Metrics persistence to Postgres (`backtest_runs`, `backtest_metrics`).
- Publish `backtest.completed` on finish.

### 2.5 `services/calibration`

**Role:** Close the bidirectional loop.
**Port:** 8040
**Scaling:** singleton (scheduler-driven) + horizontal workers.

**Responsibilities:**
- Subscribe to `fill.recorded`; compare actual vs backtest
  expectations per strategy.
- Maintain slippage/latency distributions per symbol × strategy.
- Compute `trust_score` per `strategy_version`.
- Drift detection (KS test, population stability index).
- Publish `calibration.updated`, `drift.detected`.

### 2.6 `services/promotion`

**Role:** Lifecycle state machine for strategies.
**Port:** 8050
**Scaling:** singleton scheduler + horizontal API workers.

**Responsibilities:**
- Gate evaluation on the promotion cron.
- State transitions: draft → parsed → backtested → stress_tested →
  paper_approved → assisted_live → autonomous_candidate →
  autonomous_active; plus demoted/retired.
- Audit trail (`promotion_states` + event stream).
- Subscribe to `calibration.updated`, `drift.detected` for
  auto-demotion.

### 2.7 `services/intelligence`

**Role:** Multi-agent reasoning layer.
**Port:** 8060
**Scaling:** horizontal; GPU-optional.

**Responsibilities:**
- Agent orchestration (see Phase 8 spec).
- Memory/recall over pgvector.
- Evidence packet assembly.
- Returns ranked actions + explanations to the control plane.
- Does NOT execute trades directly — proposes to the deterministic
  core, which decides.

### 2.8 `services/execution`

**Role:** Convert approved decisions into broker orders.
**Port:** 8070
**Scaling:** horizontal but one broker account = one logical worker
to preserve order sequencing.

**Responsibilities:**
- Broker adapters (Alpaca v1).
- Bracket orders (entry + SL + TP) with broker-native types where
  supported; simulated brackets otherwise.
- Kill switch (reads `system.mode` on every order submit).
- Fill capture → `fill.recorded` event.
- Reconciliation (end-of-day sweep).

### 2.9 `services/screenshot_renderer`

**Role:** Produce chart screenshots tied to signals/orders/incidents.
**Port:** 8080
**Scaling:** horizontal; CPU-bound.

**Responsibilities:**
- Headless Chromium (Playwright) to render a chart page.
- Input: symbol + time range + overlay list + theme.
- Output: PNG to S3 + `screenshots` row with metadata.
- Serves `/api/screenshots/:id` (signed S3 URL).

### 2.10 `services/replay`

**Role:** Reconstruct any past time window for review.
**Port:** 8090
**Scaling:** on-demand; one job per operator request.

**Responsibilities:**
- Read raw events from S3 + Postgres.
- Step-through replay with configurable speed.
- Outputs to the dashboard's Replay page via WebSocket.
- Can trigger screenshot renderer for bookmarked moments.

### 2.11 `apps/web` (Next.js)

**Role:** Operator-facing dashboard.
**Port:** 3000 (Next.js dev); behind CloudFront in prod.

**Responsibilities:**
- Server-rendered pages for SEO-irrelevant but large pages (Replay,
  Strategy Lab).
- Client components for live feeds (SSE/WS subscriptions).
- BFF layer under `app/api/*` for auth-only browser calls.
- All 68 sidebar pages (see [`SIDEBAR_MAP.md`](SIDEBAR_MAP.md)).

---

## 3. Event bus

### 3.1 Abstraction

All services use `shared/event_bus.py`, which provides:

```python
class EventBus(Protocol):
    async def publish(self, topic: str, event: Event) -> None: ...
    async def subscribe(self, topic: str, group: str) -> AsyncIterator[Event]: ...
    async def ack(self, topic: str, group: str, event_id: str) -> None: ...
    async def replay(self, topic: str, since: datetime) -> AsyncIterator[Event]: ...
```

**Dev/CI backend:** Redis Streams (`redis.asyncio`).
**Prod backend:** AWS EventBridge for fan-out + SQS per consumer
for durable queuing. SQS FIFO for ordered topics (market ticks
keyed by symbol).

### 3.2 Topics

| Topic | Producer | Consumers | Ordering |
|-------|----------|-----------|----------|
| `market.ticks.<symbol>` | ingestion | orderflow, replay | FIFO by symbol |
| `market.candles.<symbol>.<tf>` | ingestion | backtest, dashboard | FIFO |
| `market.depth.<symbol>` | ingestion | orderflow | FIFO |
| `signals.received` | ingestion (webhook), intelligence | promotion, execution, dashboard | non-FIFO, dedup-keyed |
| `orderflow.features.<symbol>` | orderflow | intelligence, dashboard | FIFO |
| `backtest.started` | backtest_runner | dashboard | non-FIFO |
| `backtest.completed` | backtest_runner | calibration, promotion, dashboard | non-FIFO |
| `calibration.updated` | calibration | promotion, dashboard | non-FIFO |
| `drift.detected` | calibration | promotion, alerts | non-FIFO |
| `promotion.state_changed` | promotion | alerts, dashboard, audit | non-FIFO |
| `orders.submitted` | execution | dashboard | non-FIFO |
| `orders.updated` | execution | dashboard | non-FIFO |
| `fills.recorded` | execution | calibration, dashboard, audit | non-FIFO |
| `alerts.fired` | control_plane, calibration | alert_router, dashboard | non-FIFO |
| `screenshots.taken` | screenshot_renderer | dashboard | non-FIFO |
| `system.mode_changed` | control_plane (operator) | all services | non-FIFO, broadcast |
| `system.health` | all services | dashboard, alert_router | non-FIFO |

### 3.3 Event envelope

Every event carries:

```python
class Event(BaseModel):
    id: UUID                    # event ID
    topic: str
    ts: datetime                # UTC, microsecond
    producer: str               # service name
    correlation_id: str         # ties to originating request/signal
    causation_id: str | None    # event ID that caused this one
    payload: dict               # topic-specific, Pydantic-validated
    schema_version: int = 1
```

### 3.4 Idempotency + dedup

Producers include a `dedup_key` header for topics where duplicates
are possible (webhooks, retries). Consumers maintain a processed-ID
cache (Redis, 24h TTL) to drop duplicates.

---

## 4. Request tracing

Every inbound request is tagged with `X-Request-Id` (if the client
sent one, preserve it; else generate a ULID). The control plane
propagates it into:

- SQL query comments (`/* req=<id> */`) for slow-query attribution.
- Structured logs (`request_id=<id>`).
- Event envelopes as `correlation_id` when a request triggers an
  event.
- OpenTelemetry spans (Phase 13).

In prod, CloudWatch Logs Insights indexes `request_id` so any
incident timeline can be reconstructed from any leaf service log.

---

## 5. Auth + RBAC

### 5.1 Authentication

- JWT (HS256 dev, RS256 prod) issued by `control_plane/auth/*`.
- Access token: 15 min. Refresh token: 7 days, rotated on use.
- `apps/web` stores tokens in httpOnly cookies (not localStorage).
- Service-to-service: internal mTLS in prod; shared-secret in dev.

### 5.2 RBAC roles

| Role | Scope |
|------|-------|
| `viewer` | Read-only: all dashboards, no writes, no execution. |
| `analyst` | `viewer` + strategy CRUD, backtest submission, no promotion past paper_approved, no live execution. |
| `operator` | `analyst` + promotion approvals, live execution toggles, kill switch, mode changes. |
| `admin` | `operator` + user management, system config, secrets viewing. |

### 5.3 Policy layer

Routes declare required role via FastAPI dependency:

```python
@router.post("/promotion/approve", dependencies=[Depends(require_role("operator"))])
async def approve_promotion(...): ...
```

All policy checks are logged to `audit_events` with the acting user,
IP, user-agent, and the policy that authorized the call.

---

## 6. Feature flags

`shared/flags.py` provides a simple flag service backed by Postgres
table `feature_flags`. Evaluation is deterministic (no third-party
vendor for v1) and served from a 30-second in-memory cache.

Flags we anticipate:
- `live_trading_enabled` — global kill switch for order submission
- `intelligence_layer_enabled` — fall back to deterministic-only
- `screenshot_rendering_enabled` — disable if vendor costs spike
- `new_calibration_method` — A/B gates for calibration logic
- `replay_rate_limit` — per-user cap on replay CPU time

Every flag has an owner, a created-at, a last-toggled-at, and an
operator comment. The `/settings/flags` admin page surfaces them.

---

## 7. Deployment topology

### 7.1 Dev (local)

`docker-compose` stands up:
- Postgres 16
- Redis 7
- MinIO (S3-compatible)
- LocalStack for SQS/EventBridge emulation
- All 9 backend services + web app
- Traefik reverse proxy on :80 routing by path/hostname

### 7.2 Dev (AWS)

Mirrors prod shape at lower capacity (see [`AWS_RESOURCES.md`](AWS_RESOURCES.md)).

### 7.3 Prod (AWS)

- VPC with 3 AZs, private subnets for ECS/RDS/Redis, public for ALB
- Multi-AZ RDS (db.t4g.large)
- ElastiCache Redis cluster (cache.t4g.small, 2 nodes)
- ECS Fargate services behind ALB (9 backend services + web app)
- CloudFront in front of `apps/web` for static assets
- Managed secrets in Secrets Manager
- Central CloudWatch for logs + metrics; alarms pipe to SNS → PagerDuty

---

## 8. Observability contract

Every service exposes:
- `GET /healthz` — liveness (returns 200 if process is alive)
- `GET /readyz` — readiness (returns 200 if dependencies are up)
- `GET /metrics` — Prometheus format (consumed by a sidecar in prod)
- Structured JSON logs to stdout with: `ts`, `level`, `service`,
  `request_id`, `event`, `details`

Every endpoint emits a SLO observation (latency + error) to
`services/control_plane/slo/` for the budget tracker established
in the existing Phase 6 work.

---

## 9. Change management

- **ADRs** live in `docs/architecture/adr-NNNN-<slug>.md` using the
  [MADR](https://adr.github.io/madr/) template.
- Every architectural change that contradicts this document requires
  an ADR *and* a BLUEPRINT.md version bump.
- Small tactical changes (e.g., adding a port, adding a topic) can
  land without an ADR but must update this file in the same PR.

---

## Appendix A: Why these choices

Brief rationale for the five architecture decisions, preserved for
future readers.

**A.1 Why Next.js over keeping React+Vite?** The dashboard is
evolving toward mixed server-rendered + live-subscription pages
(replay, strategy lab, portfolio overview). Next.js App Router
handles that mix natively; Vite would require a separate SSR layer.

**A.2 Why FastAPI over keeping Node/Express?** The calibration,
backtest, and intelligence layers are all Python-native. The
existing `services/` tree is already Python. Consolidating the
control plane in Python removes the TypeScript ↔ Python shared-
contracts maintenance burden that shows up in the current
`shared_contracts.test.ts` + `shared_contracts.py` duplication.

**A.3 Why Postgres (not a mix of Mongo/Cassandra/Redshift)?**
ACID + JSONB + partitioning + pgvector covers everything we need
for v1. Adding a second data store before proving we need it would
be premature.

**A.4 Why Redis Streams → SQS/EventBridge over Kafka?** Kafka is
powerful but operationally heavy. Redis Streams is ~free in dev;
SQS+EventBridge is the managed equivalent and costs < $50/mo at
our expected event volume. Revisit Kafka at 10× current volume.

**A.5 Why S3 (not local disk / NFS)?** Versioning + lifecycle
policies + cross-region replication + signed URLs are all
first-class in S3. MinIO gives us the same SDK in dev.
