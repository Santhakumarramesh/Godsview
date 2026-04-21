# GodsView v2 Blueprint — Phase 0 reference set

This directory is the canonical source for the v2 scaffold. Every Phase 0
commit (PR1 … PR8) either creates or is constrained by one of the
documents here. When a later phase proposes a change to the monorepo
topology, the DB, the API, or the UI map, the change lands first in the
matching blueprint doc, then in code.

## Index

| Document                   | Scope                                                              |
|----------------------------|--------------------------------------------------------------------|
| `00-overview.md`           | One-page product definition + system decomposition.                |
| `01-architecture.md`       | Runtime topology, service boundaries, message flow.                |
| `02-monorepo-layout.md`    | Every directory, what lives in it, what does NOT live in it.       |
| `03-db-schema.md`          | All Phase 0 tables, columns, indexes, constraints, invariants.     |
| `04-api-surface.md`        | Versioned REST contract + canonical ErrorEnvelope.                 |
| `05-sidebar-map.md`        | The 14-section UI map with per-route phase assignment.             |
| `06-governance.md`         | Trust tiers, promotion pipeline, safety floor (Decision #4).       |
| `07-security.md`           | Auth, secrets, headers, audit, rate limits.                        |
| `08-runbook.md`            | Day-2 operator procedures — deploys, incidents, rollbacks.         |
| `09-phase-roadmap.md`      | Phases 0 → 15 with gates, exit criteria, and dependencies.         |

## Ground rules

1. **One source of truth.** If something is specified here, code must
   match. If code disagrees, the code is the bug unless a blueprint
   update lands in the same PR.
2. **No silent defaults.** Every setting that has a production / dev
   divergence shows up in `04-api-surface.md` or `07-security.md` with
   both values spelled out.
3. **Decision #4 is load-bearing.** The safety floor (kill switch
   enabled, autonomous execution disabled) is not a recommendation —
   the seed script enforces it and the control plane refuses to boot
   with `APP_ENV=production` + `ALLOW_LIVE_EXECUTION=1` unless explicit
   config has been audit-logged.
