# GodsView — Claude Design Handoff

**Local repo root:** `Godsview/` (your selected folder)
**GitHub:** https://github.com/Santhakumarramesh/Godsview
**Active branch:** `phase-7-launch-and-scale`
**Head commit:** `f11e8fa` — `phase-7(pr4): portfolio rebalancer cron + intents + alembic 0015`
**Claude Design project:** https://claude.ai/design/p/e730b54e-9cb4-4cc5-b0f2-a543bba49505
**Brief in effect:** `CLAUDE_DESIGN_MASTER_SPEC.md` (repo root)

---

## Directory map — where Claude Design's output should land

```
Godsview/                                # repo root (your workspace folder)
├── CLAUDE_DESIGN_MASTER_SPEC.md         # canonical brief — 68 pages, 9 sections
├── CLAUDE_DESIGN_PROJECT.txt            # project pointer + kickoff state
├── docs/claude-design/                  # THIS doc + future snapshot dir
│   └── HANDOFF.md                       # ← you are here
│
├── apps/web/                            # Next.js 15 app — where design lands as code
│   ├── src/app/                         # pages (app router, grouped `(app)` + `(auth)`)
│   ├── src/components/                  # shared page components
│   ├── src/lib/                         # client helpers (api, hooks)
│   ├── tailwind.config.ts               # current palette (dark command-center base)
│   └── package.json
│
├── packages/
│   ├── types/                           # Zod schemas — wire contract source of truth
│   ├── api-client/                      # typed REST client wrapping /v1 endpoints
│   ├── ui/                              # shared UI primitives for Next.js + mobile
│   └── config/                          # shared tsconfig/eslint
│
├── services/control_plane/              # FastAPI backend (Python 3.11)
│   ├── app/routes/                      # REST surface the UI calls
│   ├── app/models.py                    # SQLAlchemy ORM
│   └── alembic/                         # migrations
│
├── blueprint/                           # architecture docs feeding the design
│   ├── BLUEPRINT.md
│   ├── phases/                          # per-phase plans
│   └── reference/                       # API_SURFACE, DB_SCHEMA, SIDEBAR_MAP, AWS_RESOURCES, ARCHITECTURE
│
└── infra/                               # AWS CDK (TypeScript) — mirrors the AWS diagram
```

**Where to save Claude Design snapshots:** `docs/claude-design/snapshots/<YYYY-MM-DD>-<section>/` — one folder per generation pass so each iteration is versioned next to the spec that produced it.

---

## The 68-page sidebar — mapped to existing routes

The Next.js app already implements most of the sidebar. Claude Design should match these paths so its prototype drops straight into `apps/web/src/app/(app)/`:

| Section | Implemented pages (route) |
|---|---|
| Command | `/overview`, `/ops/health`, `/ops/alerts`, `/ops/slos`, `/ops/incidents`, `/ops/logs`, `/ops/latency`, `/ops/deployments`, `/ops/feeds`, `/ops/flags` |
| Market | `/market/symbols`, `/market/watchlist`, `/market/sessions`, `/market/liquidity`, `/market/levels`, `/market/regimes` |
| Intel (structure+flow+fusion) | `/intel/structure`, `/intel/flow`, `/intel/fusion`, `/intel/setups`, `/intel/recall`, `/intel/agents`, `/intel/calibration` |
| Strategies | `/strategies`, `/strategies/active`, `/strategies/builder`, `/strategies/dna`, `/strategies/promotions` |
| Quant Lab | `/quant/backtests`, `/quant/experiments`, `/quant/metrics`, `/quant/ranking`, `/quant/replay` |
| Learning | `/learning/drift`, `/learning/feedback`, `/learning/missed`, `/research/brainstorm`, `/research/regimes` |
| Portfolio | `/portfolio/allocation`, `/portfolio/correlation`, `/portfolio/drawdown`, `/portfolio/exposure`, `/portfolio/pnl` |
| Execution | `/execution/orders`, `/execution/fills`, `/execution/positions`, `/execution/risk`, `/execution/killswitch`, `/replay` |
| Governance | `/governance/approvals`, `/governance/policies`, `/governance/trust`, `/governance/demotions` |
| Audit | `/audit/events`, `/audit/exports`, `/audit/kv-changes` |
| Admin | `/admin/users`, `/admin/roles`, `/admin/api-keys`, `/admin/webhooks`, `/admin/mcp`, `/admin/system` |
| Settings | `/settings/profile`, `/settings/preferences`, `/settings/api-tokens` |
| Auth | `/(auth)/login` |

**Pending pages (Phase 7 PR7):** `/admin/brokers`, `/portfolio/rebalance`, `/ops/venues`. The rebalance page wires to the `/v1/rebalance/*` surface that just landed in PR4.

---

## Backend contracts the prototype must honour

Every page's data shape is owned by the Zod schemas in `packages/types/src/*.ts`. Key files to pass Claude Design when generating data-driven screens:

- `packages/types/src/market.ts` — symbols, candles, direction
- `packages/types/src/order-flow.ts` — delta, imbalance, absorption, DOM
- `packages/types/src/setups.ts` — setup types, confidence, RR
- `packages/types/src/portfolio.ts` — exposure, allocation, correlation
- `packages/types/src/rebalance.ts` — rebalance plans + intents (Phase 7 PR4)
- `packages/types/src/governance.ts` — approvals, anomalies, trust tiers
- `packages/types/src/autonomy.ts` — autonomy FSM, kill switch
- `packages/types/src/quant.ts` — backtests, replay, experiments, ranking
- `packages/types/src/recall.ts` — case library, similarity, screenshots
- `packages/types/src/learning.ts` — calibration, regime, drift

REST endpoint catalogue: `packages/api-client/src/endpoints/*.ts` — one file per module, matches the `/v1/<module>` backend routes.

---

## Visual system (already in `tailwind.config.ts`)

```
background   hsl(220 25% 7%)    — obsidian deck
surface      hsl(220 23% 10%)   — card base
border       hsl(220 13% 20%)
foreground   hsl(210 20% 96%)
muted        hsl(220 13% 50%)
primary      hsl(199 89% 48%)   — electric cyan
success      hsl(142 71% 45%)
warn         hsl(38 92% 50%)
danger       hsl(0 72% 51%)
font-sans    Inter stack
font-mono    JetBrains Mono stack (numbers, tickers, PnL)
```

The master spec in `CLAUDE_DESIGN_MASTER_SPEC.md` extends this with the glassmorphism + hero hologram treatment — Claude Design should treat those tokens as canonical.

---

## What's currently shipping (so design stays in sync with code)

**Live surfaces (v2.6.0):** phases 0–6 complete. Auth, live trades, market structure, order flow, setups, quant lab, recall + learning, portfolio exposure + allocation + PnL, governance (approvals + anomalies + trust), autonomy + kill-switch.

**In-flight (Phase 7, branch `phase-7-launch-and-scale`):**
- PR1 ✅ `@gv/types` launch-scale models
- PR2 ✅ `@gv/api-client` launch-scale endpoints
- PR3 ✅ Multi-broker adapter registry + Interactive Brokers stub
- PR4 ✅ Portfolio rebalancer (alembic 0015, `/v1/rebalance/*`, governance `rebalance_execute`) — **just shipped**
- PR5 ⏳ Anomaly detector expansion (venue_latency_breach, broker_outage, calibration_brier_regression)
- PR6 ⏳ Mobile operator inbox (`/v1/mobile/inbox`)
- PR7 ⏳ `apps/web` launch-scale pages (`/admin/brokers`, `/portfolio/rebalance`, `/ops/venues`)
- PR8 ⏳ v2.7.0 release handoff + tag

**Design implication:** the three new pages in PR7 don't have reference implementations yet — Claude Design has open runway there.

---

## How to round-trip between Claude Design and this repo

1. Generate a page or component set in Claude Design.
2. Save the snapshot to `docs/claude-design/snapshots/<YYYY-MM-DD>-<section>/` (HTML + component files + notes).
3. When promoting to code:
   - Components → `packages/ui/src/components/` (if reusable) or `apps/web/src/components/` (if page-scoped)
   - Pages → `apps/web/src/app/(app)/<section>/<page>/page.tsx`
   - Wire data via `packages/api-client` — never fetch directly
   - Types come from `packages/types` — never redefine wire shapes
4. Commit on a feature branch, reference the snapshot folder in the PR body.

---

## Quick reference for the designer

- **Repo root:** Your workspace folder (the one selected in Cowork).
- **Spec:** `CLAUDE_DESIGN_MASTER_SPEC.md` in that folder.
- **Next.js app:** `apps/web/`.
- **Shared UI primitives:** `packages/ui/src/components/`.
- **Wire contracts:** `packages/types/src/` (Zod → TypeScript types).
- **Backend URL shape:** `/v1/<module>/<resource>` — documented in `packages/api-client/src/endpoints/`.
- **Blueprint docs:** `blueprint/reference/SIDEBAR_MAP.md`, `API_SURFACE.md`, `DB_SCHEMA.md`, `ARCHITECTURE.md`, `AWS_RESOURCES.md`.
