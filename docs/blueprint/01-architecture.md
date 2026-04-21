# 01 · Architecture

## Runtime topology

```
                     ┌───────────────────────┐
                     │     TradingView       │
                     │  (Pine Script engine) │
                     └───────────┬───────────┘
                                 │ webhook (HMAC-signed)
                                 ▼
                     ┌───────────────────────┐
                     │    MCP Server (TV)    │   Phase 2
                     │  /tv-webhook + router │
                     └───────────┬───────────┘
                                 │
                                 ▼
            ┌────────────────────────────────────────┐
            │   Control Plane (FastAPI + async SQL)  │
            │                                        │
            │   • auth / users / roles / audit       │
            │   • flags / system config              │
            │   • structure / flow / fusion routes   │   Phases 2-11
            │   • governance / execution gateway     │
            └──────┬───────────────┬─────────────────┘
                   │               │
                   ▼               ▼
        ┌───────────────┐  ┌──────────────────┐
        │ Postgres 16   │  │ Redis 7          │
        │ (OLTP + audit)│  │ (rate limit + ps)│
        └───────────────┘  └──────────────────┘
                   │
                   ▼
        ┌───────────────────────────────────┐
        │      Object storage (S3/MinIO)    │
        │  recall screenshots, exports,     │
        │  strategy artifacts               │
        └───────────────────────────────────┘

            ┌───────────────────────────────┐
            │  apps/web  (Next.js 15)       │
            │    - TanStack Query           │
            │    - AuthContext + AuthGate   │
            │    - Sidebar-driven routing   │
            └───────────────┬───────────────┘
                            │ REST (bearer)
                            ▼
                     control plane
```

## Service boundaries

The control plane is the only service that touches the DB. Every other
process — workers, brokers, MCP servers — talks to it over the REST
contract. This is intentional: it lets us version the data model
independently of the adapters and keeps the audit trail centralized.

## Message flow (Phase 9+)

```
TV webhook → MCP → structure → flow → fusion → setup → recall
                                                          │
                                                          ▼
                                              multi-agent brain
                                                          │
                                                          ▼
                                                   risk engine
                                                          │
                                                          ▼
                                                execution engine
                                                          │
                                                          ▼
                                                        broker
                                                          │
                                                          ▼
                                                   learning loop
                                                          │
                                                          ▼
                                                    Quant Lab
```

Every arrow is an auditable state transition. The correlation ID that
enters at the webhook is propagated through every hop.
