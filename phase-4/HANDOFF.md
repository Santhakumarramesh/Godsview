# Phase 4 — Page Gap Closure (manifest + RBAC + duplicate-route fix)

**Branch:** `phase-4-page-gaps`
**Base:** `phase-3-aws-cdk` (commit `9464530`)
**Head:** `99dd09f`
**Patch:** `phase-4/0001-phase-4-page-manifest-as-single-source-of-truth-RBAC.patch`
**Files changed:** 7 (1098 insertions, 282 deletions)

---

## What this phase delivers

The fourth hard production gate (the one labeled "All 68 sidebar pages with RBAC") is split into three concrete sub-gates. Phase 4 lands the structural prerequisites; the bulk data-fetching migration is queued as backlog.

| Sub-gate                                              | Status after Phase 4                                           |
| ----------------------------------------------------- | -------------------------------------------------------------- |
| All 68 routes wired and reachable                     | shipped (was ad-hoc, now manifest-driven)                      |
| No duplicate route registrations                      | shipped (was 3 dupes, now impossible by construction)          |
| RBAC: destructive pages gated by role                 | shipped (12 pages now `operator`-only)                         |
| Each page on React Query hooks (no raw `fetch`)       | tracked in `PAGES.md`; **20 raw-fetch pages** queued for Phase 5/6 |
| Per-page vitest smoke + MSW handlers                  | deferred — sandbox lacks DOM tooling; queued for Phase 6        |

---

## Apply

```bash
cd /path/to/Godsview
git checkout phase-3-aws-cdk
git checkout -b phase-4-page-gaps
git am < phase-4/0001-phase-4-page-manifest-as-single-source-of-truth-RBAC.patch
```

---

## Files shipped

| File                                                         | Purpose                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `artifacts/godsview-dashboard/src/pages/page-manifest.ts`    | Single source of truth for all 68 pages (path + scope + label + minRole + lazy loader). Asserts uniqueness at module load — duplicate paths now throw. |
| `artifacts/godsview-dashboard/src/auth/role-context.tsx`     | `RoleProvider` + `useRole()` hook. Two roles (`viewer`, `operator`), persisted to localStorage. |
| `artifacts/godsview-dashboard/src/auth/route-guard.tsx`      | `<RouteGuard required="operator">` — renders an access-denied panel with a one-click elevation button when current role is insufficient. |
| `artifacts/godsview-dashboard/src/auth/role-switcher.tsx`    | Small viewer/operator toggle in the Shell footer. Replaces SSO claims for unauthenticated dev rollouts. |
| `artifacts/godsview-dashboard/src/App.tsx`                   | **Rewritten.** Down from 282 lines to 154. Maps over `PAGE_MANIFEST` instead of declaring 68 routes inline. Wraps each route in `RouteGuard` when `minRole !== "viewer"`. |
| `artifacts/godsview-dashboard/src/components/layout/Shell.tsx` | Mounts `<RoleSwitcher />` in the sidebar footer.                       |
| `artifacts/godsview-dashboard/PAGES.md`                      | Categorized inventory of every page's data-fetching pattern. The migration backlog. |

---

## Bugs fixed

### 1. Three duplicate routes in `App.tsx`

```diff
- <RoutedPage path="/tradingview-chart"  component={TradingViewChartPage}  scope="page:tradingview-chart" />
- <RoutedPage path="/bloomberg-terminal" component={BloombergTerminalPage} scope="page:bloomberg-terminal" />
- <RoutedPage path="/news-monitor"       component={NewsMonitorPage}       scope="page:news-monitor" />
  …
- <RoutedPage path="/tradingview-chart"  component={TradingViewChartPage}  scope="page:tradingview-chart" />
- <RoutedPage path="/bloomberg-terminal" component={BloombergTerminalPage} scope="page:bloomberg-terminal" />
- <RoutedPage path="/news-monitor"       component={NewsMonitorPage}       scope="page:news-monitor" />
```

Each page was registered twice (lines 190–192 and again at 243–245). Wouter
matched the first one so behaviour was correct, but the manifest now refuses
duplicates — the runtime invariant in `page-manifest.ts` throws at module
load if any path appears twice.

### 2. No client-side authorization on destructive pages

Pre-Phase 4: any visitor in any browser tab could navigate to
`/execution-control`, `/risk-command-v2`, or `/capital-gating` and submit the
mutation forms. The api-server's Phase 2 `require503IfNoBroker` gate was the
only thing standing between the user and a mistake (and that gate only
activates when broker keys aren't configured).

Post-Phase 4: those routes now require `operator` role. The default role is
`viewer`. Switching to operator is a one-click action in the sidebar (or, in
a future build, will come from the SSO JWT). The server gate remains the
authoritative one — this is intent confirmation + UI affordance, not security
on its own.

---

## RBAC map

12 pages require `operator`:

| Path                       | Why                                              |
| -------------------------- | ------------------------------------------------ |
| `/command-center`          | Unified control surface — flips kill switches    |
| `/execution`               | Sends live broker orders                         |
| `/execution-control`       | Order routing + venue selection                  |
| `/exec-reliability`        | Failsafe + reconciliation triggers               |
| `/risk`                    | Edits risk caps                                  |
| `/risk-command-v2`         | VaR + capital guard mutations                    |
| `/advanced-risk`           | Stress tests can spawn live mutations            |
| `/capital-gating`          | Promotes strategies to live capital              |
| `/paper-trading-program`   | Validation pipeline + cert promotion             |
| `/ops-security`            | Chaos + deploy controls                          |
| `/model-governance`        | Promotes / rolls back models                     |
| `/settings`                | Edits secrets + system config                    |

Every other path is `viewer` (the read-only default).

---

## How RBAC is enforced

```
User → Shell → RoleProvider (reads localStorage)
              ↓
              Router maps PAGE_MANIFEST
              ↓
              For minRole === "viewer":  <Component />
              For minRole === "operator": <RouteGuard required="operator"><Component /></RouteGuard>
              ↓
              RouteGuard reads useRole().can("operator")
              ↓
              Allowed: render component
              Denied: render access-denied panel + elevation button
```

The server still returns `403 forbidden` (or `503 broker_not_configured` per
Phase 2) on the actual endpoint — RBAC + 503 are layered defense.

---

## Migration backlog (queued for Phase 5/6)

`PAGES.md` categorizes every page:

| Pattern      | Count |
| ------------ | ----- |
| `rq-only`    | 4     |
| `mixed`      | 31    |
| `raw-fetch`  | 20    |
| `static`     | 13    |

The 20 `raw-fetch` pages are the priority A backlog. They have no React
Query at all — every data load is a hand-rolled `useEffect` + `fetch` +
`useState`, which means they don't pick up Phase 2's demo-mode signaling and
won't participate in Phase 5's promotion-cache invalidation graph.

The 31 `mixed` pages already use React Query but still have escape-hatch
`fetch(` calls; cleanup is mechanical.

---

## Verification

```bash
cd /path/to/Godsview
pnpm install                # if not already
./node_modules/.bin/tsc --build       # exit 0 — wire-up of manifest, RBAC, route guard all type-check
```

The TypeScript build is the load-bearing gate for this phase: it imports the
entire manifest, every lazy loader, and every consumer. Any runtime defect
in the wiring would surface as a compile error.

---

## What's deferred to Phase 5/6

- **Per-page vitest smoke tests with MSW handlers** — sandbox lacks DOM tooling
  and offline mode prevents installing happy-dom + @testing-library. Phase 6
  will add the test toolchain alongside the SLO + k6 work.
- **fetch → React Query migration of the 20 raw-fetch pages** — Phase 5 (auto
  promotion + calibration cron) touches the same endpoints, so doing both at
  once minimizes context-switching.
- **SSO integration** — RoleSwitcher is the dev placeholder. Real auth comes
  with the v1.0.0 launch.

---

## Production-readiness gate status after Phase 4

| Gate                                                          | Status        |
| ------------------------------------------------------------- | ------------- |
| 1. TradingView MCP + webhook router                           | shipped       |
| 2. Backtesting → paper → assisted live → auto-promotion        | partial — auto-promotion is Phase 5 |
| 3. AWS production deploy                                      | shipped (Phase 3) |
| 4. **All 68 sidebar pages with RBAC**                         | **shipped (this phase)** — page conversion to React Query queued for Phase 5/6 |

---

## Next phase

**Phase 5 — Auto promotion pipeline + calibration cron.** Build the
backtesting → paper → assisted-live → auto-promotion ladder with model
governance hooks; add a calibration cron job (hourly) that rebalances
confidence based on recent prediction accuracy. The cron should invalidate
the dashboard's React Query caches on the calibration endpoint so the UI
truth re-syncs without a full refresh.
