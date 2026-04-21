# 05 · Sidebar map

The web app exposes **66 routes** in 14 sections. Phase 0 ships 6
functional pages and 60 stubs. Source of truth:
`apps/web/src/lib/sidebar.ts`. The table below mirrors that file — keep
them in sync when routes move.

## Functional in Phase 0 (6)

| Route                  | Owner           | Description                                         |
|------------------------|-----------------|-----------------------------------------------------|
| `/overview`            | apps/web         | Landing cards — control plane status + roles.      |
| `/market/symbols`      | apps/web         | Filterable Phase 0 watchlist (seed data).          |
| `/ops/health`          | control plane    | Live + readiness + dep checks.                     |
| `/ops/flags`           | control plane    | Feature flag toggles (admin).                      |
| `/admin/system`        | control plane    | System config CRUD (admin).                        |
| `/login`               | apps/web         | Credential login.                                  |

## Stubs by phase

| Phase | Routes                                                                                                    |
|-------|-----------------------------------------------------------------------------------------------------------|
| 1     | ops/slos, ops/alerts, ops/incidents, ops/deployments, ops/latency, ops/logs, audit/events, audit/kv-changes, audit/exports, admin/users, admin/roles, admin/api-keys, admin/webhooks, admin/mcp, settings/profile, settings/preferences, settings/api-tokens |
| 2     | market/watchlist, market/levels, market/sessions, intel/structure, ops/feeds                              |
| 3     | market/liquidity, intel/flow                                                                              |
| 4     | market/regimes, intel/fusion, research/regimes                                                            |
| 5     | intel/setups, strategies, strategies/builder, strategies/active                                           |
| 6     | replay, quant/backtests, quant/replay, quant/experiments, quant/metrics, quant/ranking, strategies/promotions, strategies/dna, research/brainstorm |
| 7     | intel/recall, learning/missed                                                                             |
| 8     | intel/agents, intel/calibration, learning/feedback, learning/drift                                        |
| 9     | execution/orders, execution/fills, execution/positions, execution/risk, execution/killswitch              |
| 10    | portfolio/pnl, portfolio/exposure, portfolio/correlation, portfolio/allocation, portfolio/drawdown        |
| 11    | governance/trust, governance/approvals, governance/demotions, governance/policies                         |

## Role gates

- `admin`: audit/**, admin/**, `ops/flags` (write).
- `operator`: `ops/flags` (write), `execution/**`, `governance/approvals`.
- `analyst`: read everywhere except audit and admin.
- `viewer`: read `/overview`, `/market/**`, `/intel/**`, `/portfolio/**`.

`AuthGate` enforces authentication; per-route role filtering lives in
`Sidebar.tsx` (items are hidden) and in the API's `require_role`
dependencies (responses are 403).
