# Phase 11 — Dashboard MSW Smoke Tests

**Branch:** `phase-11-dashboard-msw-smoke-tests`
**Base:** `phase-10-test-suite-hardening-and-receivers` (commit `42ceaa2`, tag `v1.3.0`)
**Head:** `45b60bf`
**Tag:** `v1.4.0`
**Patch:** `phase-11/0001-phase-11-dashboard-msw-smoke-tests.patch` (94 KB — size
dominated by pnpm-lock.yaml deltas for vitest / jsdom / @testing-library /
msw; the actual hand-written code is 523 lines)
**Files changed:** 13 (1477 insertions, 27 deletions)

---

## What this phase delivers

Closes the last explicitly-optional backlog item from the v1.0.0 through
v1.3.0 phase-outs. Phases 4, 9, and 10 each noted dashboard MSW smoke
tests as "would be nice but not blocking production." Phase 11 ships
the scaffolding and three proof-of-life tests so future dashboard work
can land with per-page smoke coverage by copying one 30-line test file.

**Not blocking production readiness.** Production was already 100% at
v1.3.0 (nine shipped gates). Phase 11 is purely additive — rollback is
`git revert 45b60bf`.

---

## Apply

```bash
cd /path/to/Godsview
git checkout phase-10-test-suite-hardening-and-receivers
git checkout -b phase-11-dashboard-msw-smoke-tests
git am < phase-11/0001-phase-11-dashboard-msw-smoke-tests.patch
git tag -a v1.4.0 -m "GodsView v1.4.0 — Dashboard MSW smoke tests"
```

After applying, run `corepack pnpm install` to resolve the new dev deps.

---

## Files shipped

| File                                                                  | Purpose                                                                    |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `artifacts/godsview-dashboard/vitest.config.ts` (NEW)                 | jsdom env + setup file + src alias + dot reporter                          |
| `artifacts/godsview-dashboard/src/test/setup.ts` (NEW)                | jest-dom matchers + MSW lifecycle + EventSource / matchMedia / Resize / IO shims |
| `artifacts/godsview-dashboard/src/test/msw-server.ts` (NEW)           | `setupServer(...handlers)` for node mode                                   |
| `artifacts/godsview-dashboard/src/test/msw-handlers.ts` (NEW)         | Defaults for `/api/alerts/*`, `/api/slo/*`, `/api/governance/*`; permissive `/api/*` catch-all |
| `artifacts/godsview-dashboard/src/test/render.tsx` (NEW)              | `renderPage(<Page/>)` helper with QueryClientProvider + wouter Router      |
| `artifacts/godsview-dashboard/src/pages/__tests__/not-found.test.tsx` (NEW) | Canary — no hooks, proves infrastructure works                        |
| `artifacts/godsview-dashboard/src/pages/__tests__/alert-center.test.tsx` (NEW) | Phase 8 + 9 exercise — 6 query keys + SSE subscription              |
| `artifacts/godsview-dashboard/src/pages/__tests__/alerts.test.tsx` (NEW) | Raw EventSource + useMutation + 3 useQuery                              |
| `artifacts/godsview-dashboard/package.json`                           | Adds `test` + `test:watch` scripts; 5 new devDeps (vitest, jsdom, @testing-library/*, msw) |
| `artifacts/godsview-dashboard/tsconfig.json`                          | Excludes test files + scaffolding from `tsc --noEmit` build              |
| `artifacts/godsview-dashboard/src/pages/alert-center.tsx`             | Defensive coercion of `messagesSent` / `failureRate` / `lastSent` so the render tree never calls `.toFixed()` on `undefined` |
| `docs/LAUNCH_CHECKLIST.md`                                            | Dashboard test step + reference to Phase 11 scaffold                       |
| `pnpm-lock.yaml`                                                      | Lockfile entries for the five new devDeps                                  |

---

## Test infrastructure design

### vitest.config.ts (separate from vite.config.ts)

`vite.config.ts` loads `@replit/vite-plugin-cartographer` and
`@replit/vite-plugin-dev-banner` at the top level. These plugins are
dev-server-only and do not load under jsdom. `vitest.config.ts` builds
a minimal config: `@vitejs/plugin-react` + path alias + jsdom env.

### setup.ts shims

jsdom doesn't ship:

- `EventSource` (used by `useAlertStream` hook, Phase 9) → stubbed
  with a `FakeEventSource` class that opens in a microtask and then
  stays silent. Enough for the component tree to render without
  throwing during mount.
- `window.matchMedia` (used by next-themes, embla) → vi.fn mock.
- `ResizeObserver` (used by Radix dropdowns, tooltips) → noop class.
- `IntersectionObserver` (used by some chart components) → noop class.
- `window.scrollTo` → vi.fn.

### MSW handler strategy

Two-tier:

**Tier 1 — specific shapes.** For endpoints where the Phase 8 route
wired a particular shape (e.g. `/api/alerts/channels` returns an array
of objects with `id / name / type / status / messagesSent / failureRate /
lastSent / priority / enabled`), the handler returns *exactly that
shape*. This keeps smoke tests honest against the real contract.

**Tier 2 — permissive catch-all.** For any other `/api/*` GET, return
`{}` or `[]` based on a path-tail heuristic (`.../strategies` →
`[]`, `.../status` → `{}`). Keeps smoke tests green when a page
fans out to ten endpoints we haven't enumerated.

Tests can override any handler for a single test:

```ts
server.use(http.get("/api/alerts/summary", () =>
  HttpResponse.json({ totalActive: 99, ... })
));
```

### renderPage helper

```ts
renderPage(<AlertCenterPage />, { initialPath: "/alert-center" });
```

Injects:
- Fresh `QueryClient` per test (prevents cache leak between tests).
- `retry: false`, `refetchOnWindowFocus: false` — failed queries
  surface immediately.
- wouter `<Router>` — pages that use `<Link>` / `useLocation`
  work under test.

---

## Bug surfaced during test authoring

The Alert Center page's `NotificationChannels` component called
`ch.failureRate.toFixed(1)` without defending against missing fields.
Phase 8's route always includes `failureRate`, but if the backend ever
returned a partial payload the page would crash with
`TypeError: Cannot read properties of undefined (reading 'toFixed')`.

Fixed by coercing at the query-boundary:

```ts
const channels = rawChannels.map((c: any) => ({
  ...c,
  messagesSent: typeof c.messagesSent === 'number' ? c.messagesSent : 0,
  failureRate: typeof c.failureRate === 'number' ? c.failureRate : 0,
  lastSent:
    typeof c.lastSent === 'string' && c.lastSent.includes('T')
      ? toRelTime(c.lastSent)
      : c.lastSent ?? '—',
}));
```

This is a small but real defensive-coding improvement — the kind of
bug MSW smoke tests exist to surface.

---

## Verification gate

```bash
cd /path/to/Godsview
./node_modules/.bin/tsc --build                                          # exit 0
./node_modules/.bin/tsc -p artifacts/godsview-dashboard/tsconfig.json --noEmit   # exit 0
cd artifacts/api-server && GODSVIEW_DATA_DIR=.runtime \
  ./node_modules/.bin/vitest run --reporter=dot                          # 3654 passed | 18 skipped
cd ../godsview-dashboard && \
  ./node_modules/.bin/vitest run --config ./vitest.config.ts             # 7 passed
cd ../api-server && node ./build.mjs                                     # 4.9 MB bundle, 242 ms
cd ../godsview-dashboard && ./node_modules/.bin/vite build --config vite.config.ts  # 6.99 s
```

Results at `v1.4.0`:

- Workspace typecheck: exit 0
- Dashboard typecheck: exit 0
- api-server vitest: 178 passed | 1 skipped (179 files); 3654 passed | 18 skipped (3672 tests)
- Dashboard vitest: 3 passed (3 files); 7 passed (7 tests)
- api-server bundle: 4.9 MB, 242 ms
- Dashboard bundle: 6.99 s, alert-center 23.77 kB / 6.11 kB gzip

All six green at `v1.4.0`.

---

## Test-suite summary at v1.4.0

| Workspace                       | Files        | Tests                     |
| ------------------------------- | ------------ | ------------------------- |
| `@workspace/api-server`         | 178 + 1 skip | 3654 passed + 18 skipped  |
| `@workspace/godsview-dashboard` | 3            | 7 passed                  |
| **Total**                       | **182**      | **3661 passed**           |

Coverage breakdown:

- api-server: 3654 tests exercise all Phase 1–10 route handlers,
  promotion / calibration schedulers, SLO scanner, SSE alert router,
  production gate, and governance scaffolds.
- Dashboard: 7 tests scaffold the smoke-test harness — one canary, one
  push-subscriber page (alert-center), one multi-query page (alerts).
- The 18 skipped tests are the `execution_validator.test.ts` file,
  which probes `better-sqlite3` at load time and gracefully skips when
  the native binding is unavailable (Phase 10 hardening).

---

## Production-readiness gate status at `v1.4.0`

| Gate                                                                                | Status       |
| ----------------------------------------------------------------------------------- | ------------ |
| 1. TradingView MCP + webhook router                                                 | shipped      |
| 2. Backtesting → paper → assisted live → auto-promotion                             | shipped      |
| 3. AWS production deploy                                                            | shipped      |
| 4. All 68 sidebar pages with RBAC                                                   | shipped      |
| 5. SLOs + alert routing + k6 baseline                                               | shipped      |
| 6. Documentation truth pass + launch checklist                                      | shipped      |
| 7. Alert Center real wiring + channel mapping                                       | shipped      |
| 8. Alert Center SSE push + live connection badge                                    | shipped      |
| 9. Test-suite hardening + concrete receiver adapters + verifier CLI                 | shipped      |
| 10. **Dashboard MSW smoke tests (was explicitly optional)**                         | **shipped**  |

**Production readiness: 100%.** All gates shipped. Zero items remaining
on any backlog — the list that started "optional, deferred" at Phase 4
is now empty.

---

## Extending the smoke-test suite

Add a new test in under 30 lines:

```ts
// artifacts/godsview-dashboard/src/pages/__tests__/<page>.test.tsx
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import MyPage from "../<page>";
import { renderPage } from "../../test/render";

describe("MyPage", () => {
  it("renders without throwing", async () => {
    renderPage(<MyPage />);
    expect(await screen.findByText(/expected-header/i)).toBeInTheDocument();
  });
});
```

The MSW catch-all means you don't need to mock every endpoint the
page fans out to. Override only the endpoints whose shape matters
for what you're asserting:

```ts
import { server } from "../../test/msw-server";
import { http, HttpResponse } from "msw";

it("renders the promoted strategy row", async () => {
  server.use(
    http.get("/api/strategies", () =>
      HttpResponse.json({ strategies: [{ id: "s99", name: "Test Strat", status: "live" }] })
    )
  );
  renderPage(<StrategiesPage />);
  expect(await screen.findByText(/Test Strat/)).toBeInTheDocument();
});
```

---

## Release

```bash
git push origin phase-11-dashboard-msw-smoke-tests
git push origin v1.4.0
```

---

## Tag progression

```
v1.0.0  →  production-ready baseline (Phase 7)
v1.1.0  →  (reserved)
v1.2.0  →  Dashboard SSE push for Alert Center (Phase 9)
v1.3.0  →  Test-suite hardening + webhook receiver examples (Phase 10)
v1.4.0  →  Dashboard MSW smoke tests (Phase 11) ← current head
```
