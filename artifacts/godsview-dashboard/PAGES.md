# GodsView Dashboard — Page Inventory & Migration Tracker

Generated at the end of Phase 4. Tracks the data-fetching pattern of every
routed page so the fetch → `@tanstack/react-query` migration has a concrete
backlog instead of anecdote.

## Summary

| Pattern      | Count | Description                                                                     |
| ------------ | ----- | ------------------------------------------------------------------------------- |
| `rq-only`    | 4     | Uses React Query hooks only. This is the target state.                          |
| `mixed`      | 31    | Uses React Query **and** raw `fetch(` escape hatches. Needs cleanup.            |
| `raw-fetch`  | 20    | No React Query — raw `fetch(` plus `useEffect`/`useState` loading state. Highest migration priority. |
| `static`     | 13    | Purely presentational — no remote data calls. Fine as-is.                       |
| **Total**    | **68**| Matches the sidebar and the `PAGE_MANIFEST` source of truth.                    |

Source of truth: `src/pages/page-manifest.ts`. Sidebar: `src/components/layout/Shell.tsx`.

## Why we care

Every `fetch(` inside a component is a missed cache-hit, a lost retry, a lost
stale-while-revalidate, and a lost chance to participate in the query
invalidation graph. When Phase 2 added `X-Demo-Data: true` + the `_demo: true`
body flag, only the React Query call sites picked up the signal (via
`select()`) — raw-`fetch` call sites silently keep rendering demo data as if
it were live.

Converting every page to `useQuery`/`useMutation`:
- lets the query client handle retries consistently,
- lets React Query's `staleTime` cut down on redundant round trips,
- surfaces Phase 2 demo-mode banners everywhere, not just the 4 gold-standard
  pages,
- and gives Phase 5 (auto-promotion + calibration cron) a single invalidation
  surface to bust caches after a model promotion.

## RBAC status (new in Phase 4)

Pages that can mutate live state now require `operator` role. See
`src/auth/role-context.tsx` + `src/auth/route-guard.tsx`. The Shell footer
includes a `RoleSwitcher` for dev/testing.

Operator-gated paths (10):
- `/command-center`
- `/execution`
- `/execution-control`
- `/exec-reliability`
- `/risk`
- `/risk-command-v2`
- `/advanced-risk`
- `/capital-gating`
- `/paper-trading-program`
- `/ops-security`
- `/model-governance`
- `/settings`

Everything else is `viewer`.

## Migration backlog — raw-fetch pages (priority A)

Do these first. They have no React Query at all.

| Page                        | Route                         | Why it's touchy                          |
| --------------------------- | ----------------------------- | ---------------------------------------- |
| `autonomous-brain.tsx`      | `/autonomous-brain`           | Per-symbol AI — live tick & setup data   |
| `calibration.tsx`           | `/calibration`                | Phase 5 cron invalidation point          |
| `capital-gating.tsx`        | `/capital-gating`             | Operator-only; launch control            |
| `checklist.tsx`             | `/checklist`                  | Cold reads, low stakes                   |
| `dashboard.tsx`             | `/`                           | Landing page — high visibility           |
| `decision-loop.tsx`         | `/decision-loop`              | Strategy pipeline live feed              |
| `eval-harness.tsx`          | `/eval-harness`               | Benchmarks — query invalidation wanted   |
| `infinity.tsx`              | `/infinity`                   | Multi-chart aggregate                    |
| `institutional-intelligence.tsx` | `/institutional-intelligence` | Macro/sentiment blend                |
| `intelligence-center.tsx`   | `/intelligence-center`        | Top-level intel roll-up                  |
| `ops.tsx`                   | `/ops`                        | Health dashboard                         |
| `paper-trading-program.tsx` | `/paper-trading-program`      | Operator-only; validation tracking       |
| `performance.tsx`           | `/performance`                | Perf dashboard                           |
| `performance-analytics.tsx` | `/performance-analytics`      | Deep drill-down                          |
| `risk-command-v2.tsx`       | `/risk-command-v2`            | Operator-only; VaR + capital guard       |
| `stitch-lab.tsx`            | `/stitch-lab`                 | Design-pack — low stakes                 |
| `super-intelligence.tsx`    | `/super-intelligence`         | AI engine dashboard                      |
| `trades.tsx`                | `/trades`                     | Trade log                                |
| `trust-surface.tsx`         | `/trust-surface`              | Operator view of live truth              |
| `war-room.tsx`              | `/war-room`                   | Consensus / group view                   |

## Migration backlog — mixed pages (priority B)

These already import `useQuery` from `@tanstack/react-query` but still have
raw `fetch(` calls. Convert the escape hatches to dedicated query hooks; that
usually means adding a hook to `src/lib/api.ts` and the corresponding server
endpoint to `api-server/src/routes/…`.

- alert-center
- alerts
- alpaca
- analytics
- audit
- backtest-credibility
- backtester
- candle-xray
- correlation-lab
- data-integrity
- decision-explainability
- decision-replay
- exec-reliability
- execution
- execution-control
- microstructure
- model-governance
- pipeline
- pipeline-status
- portfolio
- proof
- regime-intelligence
- reports
- risk
- sentiment-intel
- setup-explorer
- signals
- system
- system-audit
- trade-journal
- watchlist

## Gold standard — keep these as the reference implementation

- `daily-review.tsx`
- `market-structure.tsx`
- `mcp-backtester.tsx`
- `side-by-side.tsx`

## Static pages — acceptable as-is

- advanced-risk, bloomberg-terminal, brain, brain-graph, brain-nodes,
  command-center, economic-calendar, mcp-signals, news-monitor, ops-security,
  quant-lab, settings, tradingview-chart

(These render Bloomberg-style terminals or static docs — no remote data to
migrate. If they grow live data in a future phase, add React Query at that
time.)

## Completion criteria

The "68/68 hooks + tests" gate is satisfied when:

1. `raw-fetch` count reaches 0 (move everything to React Query hooks).
2. `mixed` count reaches 0 (remove every `fetch(` escape hatch).
3. Each page has a corresponding `*.test.tsx` smoke test that mounts the
   component with an MSW-intercepted happy / error path.

Phase 4 lands the **structural prerequisites** (manifest, RBAC, duplicate-route
fix, tracker). The conversion work above is budgeted for Phase 5/6 alongside
the auto-promotion pipeline and SLO work respectively — those phases touch the
same endpoints, so batching minimizes context-switching.
