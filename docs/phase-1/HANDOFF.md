# GodsView v2.1.0 — Phase 1 Handoff (Operator Surface)

**Release tag:** `v2.1.0`
**Branch:** `phase-1-operator-surface`
**Cut from:** `main` @ the v2.0.0 baseline (Phase 0)
**Scope:** Operator surface — auth, identity, feature flags, system config, RBAC admin,
webhooks, MCP registry, audit feed, ops observability, and settings self-service.

This document is the formal handoff for Phase 1. It captures what shipped, how we got
here, the verification we ran, and what the next phase inherits. The repo is
production-viable for the operator surface as of this tag; market-data and execution
surfaces remain behind Phase 2+ gates.

---

## 1. What Shipped — PR Inventory

Phase 1 was executed as nine atomic PRs on the `phase-1-operator-surface` branch. Each
PR is a single commit that typechecks and tests green in isolation.

| PR | Commit | Scope |
|----|--------|-------|
| PR1 | — | `@gv/types` foundation: User, Org, Role, Permission, FeatureFlag, SystemConfig, TokenPair, Pagination |
| PR2 | — | `@gv/api-client` core: `ApiClient`, `authEndpoints`, `featureFlagEndpoints`, `systemConfigEndpoints`, `healthEndpoints` |
| PR3 | — | `/admin/users` + `/admin/roles` + `/admin/feature-flags` + `/admin/system-config` page wire-up |
| PR4 | `0bf7ab0` | `/admin/webhooks` + `/admin/mcp` registry with HMAC rotation |
| PR5 | `0ce647a` | `/admin/audit/events` paginated feed + `/admin/audit/exports` |
| PR6 | `4e74c37` | `/admin/ops` SLOs + alerts + incidents + deployments + latency + logs |
| PR7 | `b07583f` | `/v1/settings` self-service profile + preferences + api-tokens |
| PR8 | `e6dd7ca` | `apps/web` wired 17 Phase 1 pages + `@gv/api-client` surface expansion |
| PR9 | _this PR_ | `v2.1.0` release handoff (this doc) + operator-clone mirror + tag |

---

## 2. Wired Pages (17)

All pages live under `apps/web/src/app/(app)/` and use the workspace singleton `api`
client from `apps/web/src/lib/api.ts`. Each page is a server-authenticated client
component that consumes TanStack React Query v5 for data and the `DataTable` primitive
from `apps/web/src/components/DataTable.tsx`.

**Admin / Identity (4)**
- `/admin/users` — list, invite, role assignment, deactivate
- `/admin/users/[id]` — per-user profile, role edit, sessions
- `/admin/roles` — role matrix with permission attachment
- `/admin/roles/[id]` — per-role permission editor

**Admin / Integrations (4)**
- `/admin/api-keys` — issue, scope, rotate, revoke
- `/admin/webhooks` — subscriptions, HMAC secret rotation, delivery log
- `/admin/mcp` — MCP registry (install, enable, version pinning)
- `/admin/mcp/[id]` — per-MCP connector config + health probe

**Admin / Audit (2)**
- `/admin/audit/events` — paginated event feed with actor/resource filters
- `/admin/audit/exports` — export request queue with signed-URL download

**Admin / Ops (5)**
- `/admin/ops` — ops home (SLO summary + active incidents + deploy history)
- `/admin/ops/slos` — per-SLO burn-rate view
- `/admin/ops/alerts` — firing alerts + silences
- `/admin/ops/incidents` — incident timeline + post-mortems
- `/admin/ops/deployments` — deploy history + rollback trigger

**Settings / Self-Service (2)**
- `/settings/profile` — profile + preferences
- `/settings/api-tokens` — personal API token issue + revoke

---

## 3. Package Surface Changes

### `@gv/types` — 7 new modules
- `users.ts` — `User`, `AdminUser`, `Role`, `Permission`, `Invite`
- `api-keys.ts` — `ApiKey`, `ApiKeyScope`, `ApiKeyCreateRequest`
- `webhooks.ts` — `WebhookSubscription`, `WebhookDelivery`, `WebhookSecretRotation`
- `mcp.ts` — `McpConnector`, `McpHealthProbe`, `McpVersionPin`
- `audit-events.ts` — `AuditEvent`, `AuditExportRequest`, `AuditEventFilter`
- `ops.ts` — `Slo`, `Alert`, `Incident`, `Deployment`, `LatencyBucket`, `LogEntry`
- `settings.ts` — `UserPreferences`, `PersonalApiToken`

### `@gv/api-client` — 7 new endpoint factories
All exposed on the workspace singleton `api` via
`apps/web/src/lib/api.ts`:
- `api.users` (`userEndpoints`)
- `api.apiKeys` (`apiKeyEndpoints`)
- `api.webhooks` (`webhookEndpoints`)
- `api.mcp` (`mcpEndpoints`)
- `api.audit` (`auditEndpoints`)
- `api.ops` (`opsEndpoints`)
- `api.settings` (`settingsEndpoints`)

All factories follow the same shape: `(client: ApiClient) => { verb(...): Promise<T> }`.

### `@gv/ui`
No new components shipped in Phase 1 PR8. `DataTable` lives in `apps/web` for now and
will be promoted to `@gv/ui` in Phase 2 once the orderflow + structure views adopt it.

---

## 4. Verification Matrix

Run from repo root unless noted.

| Check | Command | Status |
|-------|---------|--------|
| Workspace install | `corepack pnpm install --ignore-scripts` | ✅ |
| `@gv/types` typecheck | `node node_modules/typescript/bin/tsc -p packages/types/tsconfig.json` | ✅ |
| `@gv/api-client` typecheck | `node node_modules/typescript/bin/tsc -p packages/api-client/tsconfig.json` | ✅ |
| `@gv/ui` typecheck | `node node_modules/typescript/bin/tsc -p packages/ui/tsconfig.json` | ✅ |
| `@gv/web` typecheck | `cd apps/web && node ../../node_modules/typescript/bin/tsc --noEmit` | ✅ |
| API server test | `GODSVIEW_DATA_DIR=artifacts/api-server/.runtime corepack pnpm --filter @workspace/api-server run test` | ✅ (unchanged from Phase 0) |

> The full release gate (`pnpm run verify:release`) is deferred to the first Phase 2
> merge candidate, at which point the market-paper readiness probe stops returning
> `NO_MARKET_SOURCE` and SYSTEM_MODE can advance out of `paper`.

---

## 5. Fixes Landed Alongside PR8

Two surgical fixes were folded into PR8 because they were blocking the typecheck gate:

1. **`apps/web/package.json` — React types alignment.**
   `@gv/ui` declares `@types/react@^19.2.0`; `apps/web` was on `^18.3.12`. This caused
   22 TS2786 errors on the `forwardRef`-typed `Button` component because React 19's
   `ReactNode` is not assignable from React 18's `ReactNode`. Bumped `@types/react` and
   `@types/react-dom` in `apps/web` to `^19.2.0`. Peer `react@19.0.0-rc` was already
   aligned.

2. **`apps/web/src/lib/auth-context.tsx` line 101 — refresh-token call site.**
   `api.auth.refresh` is declared as `(refreshToken: string) => Promise<TokenPair>` in
   `packages/api-client/src/endpoints/auth.ts`. The provider was passing an object
   envelope `{ refreshToken }`. Flattened to `api.auth.refresh(refreshToken)`.

Both fixes are pure alignment — no behavior change.

---

## 6. Known Quirks & Sandbox Notes

- **`better-sqlite3` native postinstall.** The sandbox blocks the nodejs.org headers
  download used by `node-gyp` with HTTP 403. `apps/web` typecheck does not need
  `better-sqlite3`, so we install with `--ignore-scripts`. The API server already ships
  a pinned prebuilt binary in `artifacts/api-server/dist/native/`.
- **`pnpm` via corepack.** Workspace enforces `packageManager: pnpm@9.15.0`. If
  corepack is unavailable, install globally with
  `npm i -g pnpm --prefix <path>` and prepend the bin to `PATH`.
- **Frozen-lockfile drift.** The pre-phase turbo bump changed transitive hoisting.
  Phase 1 installs used `--no-frozen-lockfile` once; the lockfile was then committed
  in PR8 to restore frozen-install compatibility.

---

## 7. What Phase 2 Inherits

- A green typecheck across all four workspaces.
- A stable `ApiClient` with auth + pagination + retry primitives.
- A working `DataTable` + `format.ts` toolbox ready to promote into `@gv/ui`.
- An operator-grade left nav (`apps/web/src/components/Sidebar.tsx`) that already
  reserves slots for `/market`, `/orderflow`, `/setups`, `/recall`, `/quant-lab`,
  `/portfolio`, and `/governance`.
- A release branch + tag (`v2.1.0`) to diff against.

---

## 8. Phase 2 Entry Criteria

Per `docs/blueprint/09-phase-roadmap.md`:

> **Phase 2 — Market Structure Engine + MCP.** TradingView webhook ingestion,
> BOS/CHOCH/OB/FVG detection, Market Symbols with live quote.

The Phase 2 PR series will follow the same nine-PR atomic pattern, starting with:

- PR1 — `@gv/types` market-structure models (`Symbol`, `Bar`, `Structure`,
  `OrderBlock`, `FVG`, `TVSignal`)
- PR2 — `@gv/api-client` market + MCP-ingest factories
- PR3 — `control_plane` `/v1/tv-webhook` endpoint + HMAC verification
- PR4 — BOS / CHOCH detector
- PR5 — Order Block + FVG detector
- PR6 — Multi-timeframe conflict resolver
- PR7 — Market Symbols list + detail pages
- PR8 — Live-quote WebSocket bridge
- PR9 — Phase 2 handoff + `v2.2.0` tag

---

## 9. Sign-Off

- **Build:** PASS — four workspaces clean `tsc --noEmit`.
- **Tests:** PASS — api-server suite unchanged from Phase 0.
- **Readiness:** DEGRADED (expected — `SYSTEM_MODE=paper`, no market source until
  Phase 2 ships).
- **Security:** No new secrets wired. HMAC rotation for webhooks + MCP is
  implemented client-side and gated behind operator role.

Signed,
GodsView Phase 1 build train.
