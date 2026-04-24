# SIDEBAR_MAP.md — GodsView v2+ Blueprint

**Status:** locked for Phase 0 scaffolding
**Scope:** the complete catalog of navigable pages in `apps/web` (the
Next.js App Router frontend), grouped by section, with routing,
ownership, data sources, RBAC, and phase assignment.

There are **68 pages** total, organized into **10 sections**. Every
page has:

- A canonical route (App Router folder path)
- A short purpose
- The backing service(s) and API routes (from `API_SURFACE.md`)
- RBAC minimum
- Criticality (`P0 = production-required`, `P1 = strong`, `P2 = nice-to-have`)
- Phase at which the page is first shipped (full functionality; earlier
  phases may ship a stub)

"Stub" = route exists, renders a placeholder, prevents 404 drift; does
not claim production functionality.

---

## 0. Layout & navigation

**Global chrome (every page):**

- Top bar: environment badge (dev/staging/prod), kill-switch status
  pill (green/red), global SSE connection indicator, search command-K,
  notifications bell, user menu.
- Left sidebar: 10 section groups, collapsible, with unread counts.
- Breadcrumbs under top bar, derived from route tree.
- Global footer (compact): api version, commit short sha, last sync.

**Sidebar section order (top → bottom):**

1. Command Center
2. Market
3. Signals
4. Strategies
5. Backtests
6. Execution
7. Intelligence
8. Replay
9. Ops & Health
10. Admin

---

## 1. Command Center (6 pages)

The default landing area. Designed for a single operator to monitor
all live state at a glance.

| # | Page              | Route                       | Purpose                                                    | Svc / API                                           | RBAC      | Pri | Phase |
|---|-------------------|-----------------------------|------------------------------------------------------------|-----------------------------------------------------|-----------|-----|-------|
| 1 | Overview          | `/`                         | Live PnL, open positions, recent signals, SLO pulse        | cp: `/v1/ops/health`, `/v1/signals`, `/v1/positions`| viewer+   | P0  | 0     |
| 2 | God Brain         | `/brain`                    | Node graph of universe; color=sentiment, glow=confidence   | cp+int: `/v1/signals`, `/v1/recall/similar`         | viewer+   | P1  | 11    |
| 3 | Live Signals Feed | `/feed`                     | SSE stream of new signals + decisions with filters         | cp: `/v1/signals/stream`                            | viewer+   | P0  | 2     |
| 4 | Alert Center      | `/alerts`                   | Real-time alerts + ack/resolve + routing                   | cp: `/v1/alerts`, `/v1/alerts/stream`               | viewer+   | P0  | 9     |
| 5 | Incidents         | `/alerts/incidents`         | Open / recent incidents + timeline                         | cp: `/v1/incidents`                                 | viewer+   | P0  | 9     |
| 6 | Runbooks          | `/alerts/runbooks`          | Index + render of runbooks                                 | cp: `/v1/runbooks`                                  | viewer+   | P1  | 9     |

---

## 2. Market (8 pages)

Where everything is rooted in a symbol or watchlist.

| #  | Page                  | Route                          | Purpose                                                | Svc / API                                            | RBAC     | Pri | Phase |
|----|-----------------------|--------------------------------|--------------------------------------------------------|------------------------------------------------------|----------|-----|-------|
| 7  | Symbols               | `/market/symbols`              | Browse + search tickers                                | cp: `/v1/symbols`                                    | viewer+  | P0  | 0     |
| 8  | Symbol Detail         | `/market/symbols/[symbol]`     | Overview: price, sessions, recent signals, positions   | cp + int: multi                                       | viewer+  | P0  | 2     |
| 9  | Watchlists            | `/market/watchlists`           | List + reorder watchlists                              | cp: `/v1/watchlists`                                 | viewer+  | P1  | 2     |
| 10 | Watchlist Detail      | `/market/watchlists/[id]`      | Per-symbol rollup inside a watchlist                   | cp: `/v1/watchlists/:id`                             | viewer+  | P1  | 2     |
| 11 | Order Flow            | `/market/orderflow/[symbol]`   | Live L2 + delta + imbalance + FVG overlays             | of: `/v1/ws/orderflow/:symbol`                       | viewer+  | P0  | 3     |
| 12 | Structure Map         | `/market/structure/[symbol]`   | MTF structure: BOS/CHOCH, OBs, liquidity pools         | int: `/v1/orderflow/:symbol/*`                       | viewer+  | P1  | 3     |
| 13 | Sessions              | `/market/sessions`             | Session overlays: Asia/London/NY behavior              | of + int                                             | viewer+  | P2  | 11    |
| 14 | Universe Heatmap      | `/market/heatmap`              | Grid of tickers colored by regime + signal strength    | cp + int                                             | viewer+  | P2  | 11    |

---

## 3. Signals (5 pages)

| #  | Page                  | Route                              | Purpose                                              | Svc / API                              | RBAC       | Pri | Phase |
|----|-----------------------|------------------------------------|------------------------------------------------------|----------------------------------------|------------|-----|-------|
| 15 | Signals List          | `/signals`                         | Filterable historical + live signals                 | cp: `/v1/signals`                      | viewer+    | P0  | 2     |
| 16 | Signal Detail         | `/signals/[id]`                    | Full signal card + decision trace + timeline         | cp: `/v1/signals/:id`                  | viewer+    | P0  | 2     |
| 17 | Decision Explorer     | `/signals/[id]/explain`            | Agent reasoning + evidence tree (recall hits, etc.)  | int: `/v1/agents/runs/:id`             | analyst+   | P1  | 10    |
| 18 | Missed Trades         | `/signals/missed`                  | Opportunities flagged but not traded                 | int: `/v1/recall/missed`               | analyst+   | P2  | 11    |
| 19 | Webhook Receipts      | `/signals/receipts`                | Raw webhook receipts (debug)                         | ing: `/v1/webhooks/receipts`           | operator+  | P1  | 2     |

---

## 4. Strategies (9 pages)

| #  | Page                      | Route                                        | Purpose                                                | Svc / API                                        | RBAC      | Pri | Phase |
|----|---------------------------|----------------------------------------------|--------------------------------------------------------|--------------------------------------------------|-----------|-----|-------|
| 20 | Strategies List           | `/strategies`                                | All strategies + trust + state                         | cp: `/v1/strategies`                             | viewer+   | P0  | 4     |
| 21 | Strategy Detail           | `/strategies/[id]`                           | Versions, trust score, open positions, recent trades   | cp: `/v1/strategies/:id`                         | viewer+   | P0  | 4     |
| 22 | Strategy Versions         | `/strategies/[id]/versions`                  | All versions + parse state + diffs                     | cp: `/v1/strategies/:id/versions`                | viewer+   | P0  | 4     |
| 23 | Version Editor            | `/strategies/[id]/versions/new`              | Paste Pine + parse + preview                           | cp: `POST /v1/strategies/:id/versions`           | analyst+  | P0  | 4     |
| 24 | Version Detail            | `/strategies/[id]/versions/[vid]`            | Parsed AST, lints, constraints, backtests              | cp: `/v1/strategies/:id/versions/:vid`           | viewer+   | P0  | 4     |
| 25 | Trust Timeline            | `/strategies/[id]/trust`                     | Trust components over time                             | cp: `/v1/strategies/:id/trust`                   | viewer+   | P1  | 8     |
| 26 | Promotion State           | `/strategies/[id]/promotion`                 | Current state, history, blocking checks                | pr: `/v1/strategies/:id/promotion`               | operator+ | P0  | 8     |
| 27 | Promotion Queue           | `/strategies/promotion-queue`                | All pending promotions + approve/reject                | pr: `/v1/promotion/queue`                        | operator+ | P1  | 8     |
| 28 | Promotion Config          | `/strategies/promotion-config`               | Per-stage thresholds (admin)                           | pr: `/v1/promotion/config`                       | admin     | P2  | 8     |

---

## 5. Backtests (7 pages)

| #  | Page                  | Route                                 | Purpose                                               | Svc / API                                     | RBAC     | Pri | Phase |
|----|-----------------------|---------------------------------------|-------------------------------------------------------|-----------------------------------------------|----------|-----|-------|
| 29 | Runs List             | `/backtests`                          | All runs, filterable by strategy/status               | bt: `/v1/backtests`                           | viewer+  | P0  | 6     |
| 30 | New Run               | `/backtests/new`                      | Configure & kick a new run                            | bt: `POST /v1/backtests`                      | analyst+ | P0  | 6     |
| 31 | Run Detail            | `/backtests/[id]`                     | Equity, drawdown, metrics, trades                     | bt: `/v1/backtests/:id`                       | viewer+  | P0  | 6     |
| 32 | Run Trades            | `/backtests/[id]/trades`              | Per-trade breakdown + MAE/MFE                         | bt: `/v1/backtests/:id/trades`                | viewer+  | P0  | 6     |
| 33 | Run Logs              | `/backtests/[id]/logs`                | Engine logs (tail / download)                         | bt: `/v1/backtests/:id/logs`                  | viewer+  | P1  | 6     |
| 34 | Stress Sweeps         | `/backtests/stress`                   | Monte-Carlo / slippage sweeps                         | bt: `POST /v1/backtests/stress`               | analyst+ | P1  | 6     |
| 35 | Cross-Strategy Compare| `/backtests/compare`                  | Side-by-side metrics of ≤5 runs                       | bt: multi                                     | analyst+ | P1  | 6     |

---

## 6. Execution (10 pages)

| #  | Page                   | Route                                | Purpose                                                 | Svc / API                                          | RBAC        | Pri | Phase |
|----|------------------------|--------------------------------------|---------------------------------------------------------|----------------------------------------------------|-------------|-----|-------|
| 36 | Orders                 | `/execution/orders`                  | Live + recent orders                                    | ex: `/v1/orders`                                   | viewer+     | P0  | 7     |
| 37 | Order Detail           | `/execution/orders/[id]`             | Order + child orders + fills                            | ex: `/v1/orders/:id`                               | viewer+     | P0  | 7     |
| 38 | Fills                  | `/execution/fills`                   | Fill tape                                               | ex: `/v1/fills`                                    | viewer+     | P0  | 7     |
| 39 | Positions              | `/execution/positions`               | Open positions + live P&L                               | ex: `/v1/positions`                                | viewer+     | P0  | 7     |
| 40 | Position Detail        | `/execution/positions/[symbol]`      | Averages, exits, screenshots                            | ex: `/v1/positions/:symbol`                        | viewer+     | P0  | 7     |
| 41 | Risk Dashboard         | `/execution/risk`                    | Exposure, drawdown, daily loss cap                      | ex: `/v1/risk/exposure`                            | viewer+     | P0  | 7     |
| 42 | Risk Budgets           | `/execution/risk/budgets`            | Edit budgets                                            | ex: `/v1/risk/budgets`                             | admin       | P0  | 7     |
| 43 | Kill Switch            | `/execution/killswitch`              | Engage / release kill switch                            | ex: `/v1/risk/killswitch`                          | operator+   | P0  | 7     |
| 44 | Calibration            | `/execution/calibration`             | Current calibration snapshot + drift                    | cal: `/v1/calibration/*`                           | analyst+    | P0  | 8     |
| 45 | Fill Divergence        | `/execution/calibration/divergence`  | Predicted vs actual fills                               | cal: `/v1/calibration/fill_divergence`             | analyst+    | P1  | 8     |

---

## 7. Intelligence (8 pages)

| #  | Page                    | Route                                 | Purpose                                                 | Svc / API                                        | RBAC      | Pri | Phase |
|----|-------------------------|---------------------------------------|---------------------------------------------------------|--------------------------------------------------|-----------|-----|-------|
| 46 | Agents                  | `/intelligence/agents`                | Agent registry + recent runs                            | int: `/v1/agents/runs`                           | analyst+  | P1  | 10    |
| 47 | Agent Run Detail        | `/intelligence/agents/runs/[id]`      | Full run: inputs, steps, outputs                        | int: `/v1/agents/runs/:id`                       | analyst+  | P1  | 10    |
| 48 | Ask (bespoke query)     | `/intelligence/ask`                   | Natural-language query UI → agent run                   | int: `POST /v1/agents/runs`                      | analyst+  | P2  | 10    |
| 49 | Memory Browser          | `/intelligence/memory`                | Browse stored memory entries                            | int: `/v1/memory/entries`                        | analyst+  | P1  | 11    |
| 50 | Memory Search           | `/intelligence/memory/search`         | Semantic + filter search                                | int: `/v1/memory/search`                         | analyst+  | P1  | 11    |
| 51 | Recall Viewer           | `/intelligence/recall/[signal_id]`    | Similar past setups for a signal                        | int: `/v1/recall/similar`                        | viewer+   | P1  | 11    |
| 52 | Screenshots             | `/intelligence/screenshots`           | Pinned screenshots + evidence wall                      | sr: `/v1/screenshots`                            | viewer+   | P1  | 3     |
| 53 | Regime Monitor          | `/intelligence/regime`                | Current regime per symbol/session                       | int: derived                                     | viewer+   | P2  | 11    |

---

## 8. Replay (3 pages)

| #  | Page                  | Route                             | Purpose                                              | Svc / API                                       | RBAC     | Pri | Phase |
|----|-----------------------|-----------------------------------|------------------------------------------------------|-------------------------------------------------|----------|-----|-------|
| 54 | Replay Sessions       | `/replay`                         | List own sessions + create new                       | rp: `/v1/replay/sessions`                       | analyst+ | P1  | 14    |
| 55 | Replay Workspace      | `/replay/[session_id]`            | Full replay UI: play, pause, scrub, layered views    | rp: `/v1/ws/replay/:session_id`                 | analyst+ | P1  | 14    |
| 56 | Replay Time Travel    | `/replay/[session_id]/timeline`   | Timeline scrub + bookmarks                           | rp: same WS                                     | analyst+ | P2  | 14    |

---

## 9. Ops & Health (8 pages)

| #  | Page              | Route                        | Purpose                                               | Svc / API                                        | RBAC       | Pri | Phase |
|----|-------------------|------------------------------|-------------------------------------------------------|--------------------------------------------------|------------|-----|-------|
| 57 | Health            | `/ops/health`                | All services + dependencies                           | cp: `/v1/ops/health`                             | viewer+    | P0  | 0     |
| 58 | SLOs              | `/ops/slo`                   | SLO registry + burn rates                             | cp: `/v1/ops/slo`                                | viewer+    | P0  | 6     |
| 59 | Latency           | `/ops/latency`               | p50/p95/p99 per service                               | cp: `/v1/ops/latency/:service`                   | viewer+    | P1  | 6     |
| 60 | Queues            | `/ops/queues`                | Per-topic depth + lag                                 | cp: `/v1/ops/queue/:topic`                       | operator+  | P0  | 2     |
| 61 | Events Stream     | `/ops/events`                | SSE stream of system events                           | cp: `/v1/ops/events/stream`                      | operator+  | P1  | 6     |
| 62 | Deployments       | `/ops/deployments`           | Deploy history + rollback                             | cp: `/v1/deployments`                            | viewer+    | P1  | 12    |
| 63 | Feature Flags     | `/ops/flags`                 | Flag list + toggle                                    | cp: `/v1/feature_flags`                          | admin      | P0  | 0     |
| 64 | Audit Log         | `/ops/audit`                 | Searchable audit log                                  | cp: `/v1/audit`                                  | admin      | P0  | 1     |

---

## 10. Admin (4 pages)

| #  | Page            | Route                  | Purpose                                              | Svc / API                                       | RBAC   | Pri | Phase |
|----|-----------------|------------------------|------------------------------------------------------|-------------------------------------------------|--------|-----|-------|
| 65 | Users           | `/admin/users`         | User management                                      | cp: `/v1/users`                                 | admin  | P0  | 1     |
| 66 | API Keys        | `/admin/api-keys`      | Mint / revoke API keys                               | cp: `/v1/api_keys`                              | any    | P1  | 1     |
| 67 | System Config   | `/admin/system`        | Key/value config editor                              | cp: `/v1/system_config`                         | admin  | P0  | 0     |
| 68 | Runbook Editor  | `/admin/runbooks`      | Create / edit runbooks                               | cp: `/v1/runbooks`                              | admin  | P1  | 9     |

---

## 11. Page criticality summary

| Priority | Count | Meaning                                                             |
|----------|-------|---------------------------------------------------------------------|
| P0       | 32    | Must ship for production launch. Blockers if broken.                |
| P1       | 26    | Strong UX; production-ready without them works but feels incomplete.|
| P2       | 10    | Nice-to-have polish / advanced workflows.                           |
| **Total**| **68**|                                                                     |

---

## 12. Shipping order by phase (pages-only view)

A page is counted in the phase where its *full* functionality lands.
Phases not listed ship no new pages (they ship backend, infra, or
CI gates only).

| Phase | Pages added (count) | Note                                          |
|-------|---------------------|-----------------------------------------------|
| 0     | 6  (#1, #7, #57, #63, #64 stub, #67)         | Auth + health + flags + config + stubs for #65 |
| 1     | 3  (#64, #65, #66)                            | Admin domain                                   |
| 2     | 7  (#3, #8 stub→full, #9, #10, #15, #16, #19) | Signals + watchlists wiring                    |
| 3     | 5  (#11, #12, #52, #60 wire, #38 stub)        | Orderflow + screenshots                        |
| 4     | 5  (#20, #21, #22, #23, #24)                  | Strategy authoring                             |
| 5     | 2  (#6 wire, #18 stub)                        | Manual decisions wiring (page #6 already stubbed)|
| 6     | 8  (#29–#35, #58, #59)                        | Backtests + SLO/latency pages                  |
| 7     | 10 (#36–#45 promote)                          | Execution surface + risk                       |
| 8     | 6  (#25, #26, #27, #28, #44 full, #45)        | Promotion + calibration                        |
| 9     | 4  (#4, #5, #6 full, #68)                     | Alerts + incidents + runbooks                  |
| 10    | 3  (#46, #47, #48)                            | Agents                                         |
| 11    | 7  (#2, #13, #14, #49, #50, #51, #53)         | God Brain + memory + recall                    |
| 12    | 1  (#62)                                      | Deployments                                    |
| 14    | 3  (#54, #55, #56)                            | Replay                                         |

Phase 13 and Phase 15 ship infra and CI only; no new pages.

---

## 13. Shared UI primitives (not pages, reusable)

These are `packages/ui` components the pages above depend on. Phase 0
lands their skeletons; each phase extends them.

- `KillSwitchPill` — top-bar status
- `SseStatusDot` — connection heartbeat
- `SignalCard` — across feed, detail, recall
- `OrderCard` / `PositionCard`
- `StrategyTrustGauge`
- `BacktestEquityChart`
- `L2Ladder` + `DeltaTape` + `FvgOverlay`
- `AgentRunTree` (steps + tool calls)
- `RecallCohortPanel`
- `AlertRow` (ack/resolve inline)
- `PromotionChecksTable`
- `TimelineScrubber` (replay)

All primitives are keyboard-navigable and WCAG AA from Phase 4 onward.
Contrast and focus-state checks run in CI (axe-core on the storybook).

---

## 14. Routing conventions

- Next.js App Router.
- Route groups used sparingly: `(auth)` for the login flow outside the
  default shell; `(admin)` for admin area if layout diverges.
- Dynamic segments: singular + id — `/strategies/[id]`, never
  `/strategies/[strategyId]`.
- Query params are persistent via `nuqs`: lists remember filters,
  cursor, sort across refresh.
- Every data-fetching page has `loading.tsx`, `error.tsx`, and
  `not-found.tsx` siblings.
- Every SSE page auto-reconnects with exponential backoff (200ms →
  8s) and uses `Last-Event-ID` for catch-up on reconnect.

---

## 15. Page acceptance checklist (per page, used in PRs)

A page is "shipped" when:

1. Route renders without console errors.
2. All data loads show a skeleton or spinner (no layout shift).
3. Empty states render content, not a blank area.
4. Error boundary catches API failures and offers retry.
5. Unit test covers the "happy path" render.
6. MSW smoke test covers one error path + one loading path.
7. axe-core reports zero serious violations.
8. Corresponding API routes appear in API_SURFACE.md.
9. RBAC is enforced: viewer can't hit admin pages, etc.
10. The page is linked from at least one parent / nav entry.

---

## 16. What's not in v1 (deliberate)

- Mobile-first responsive layouts. Dashboard targets ≥1440px
  workstations first. Phase 14+ adds responsive polish.
- Multi-tenant UI. `org` claim is reserved in JWT but all pages
  default to the single-org install.
- Dark/light toggle. Dark-only v1 (ops workload context).
- User-authored dashboards. Layout is fixed; Phase 15+ may add
  user-saved layouts.
- External embed widgets. Internal-only for v1.

---

**End of SIDEBAR_MAP.md**
