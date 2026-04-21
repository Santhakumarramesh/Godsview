# Phase 12 — CI enforcement for dashboard tests + expanded smoke coverage

**Branch:** `phase-12-ci-dashboard-tests`
**Base:** `phase-11-dashboard-msw-smoke-tests` (commit `45b60bf`, tag `v1.4.0`)
**Head:** `a1160dc`
**Tag:** `v1.5.0`
**Patch:** `phase-12/0001-phase-12-ci-dashboard-tests.patch` (16 KB)
**Files changed:** 7 (250 insertions, 2 deletions)

---

## Why this phase

Phase 11 shipped the dashboard smoke-test suite but didn't wire it into
`.github/workflows/ci.yml`. PRs could land dashboard regressions without
the jsdom/MSW tests ever running — the scaffold existed only as a local
verification tool.

Phase 12 closes that gap and demonstrates the suite scales beyond the
initial 3 pages by adding 3 more covering three distinct page patterns:
no-fetch local state, single-query recharts, and WebSocket live feed.

**Not blocking production readiness.** Production was already 100% at
`v1.4.0` with ten shipped gates. Phase 12 hardens the CI contribution
of the test suite so future dashboard work can't bypass the smoke
tests. Rollback is `git revert a1160dc`.

---

## What shipped

### 1. CI enforcement (`.github/workflows/ci.yml`)

Two changes in the `typecheck-and-test` + `build` jobs:

**`typecheck-and-test` job — new step after api-server tests:**

```yaml
- name: Run Dashboard Smoke Tests
  run: pnpm --filter @workspace/godsview-dashboard test
  env:
    NODE_ENV: test
```

The existing "Run Unit Tests" step was renamed to "Run Unit Tests
(api-server)" to make the split explicit.

**`build` job — new regression gate after the api-server floor:**

```yaml
- name: Verify test count (regression gate — dashboard)
  run: |
    DASH_COUNT=$(pnpm --filter @workspace/godsview-dashboard exec vitest run --reporter=json 2>/dev/null | grep -o '"numPassedTests":[0-9]*' | grep -o '[0-9]*' | head -1 || echo "0")
    echo "Dashboard tests passed: $DASH_COUNT"
    if [ "$DASH_COUNT" -lt 10 ]; then
      echo "::error::Dashboard test count regression: $DASH_COUNT < 10 minimum"
      exit 1
    fi
```

Floor is 10 (suite ships at 13). Same pattern as the existing api-server
floor of 3000.

### 2. FakeWebSocket shim (`src/test/setup.ts`)

Full `new WebSocket(url)` stub class exposing `CONNECTING / OPEN /
CLOSING / CLOSED` states, `addEventListener`, `send`, and `close`.
Opens in a microtask so components see `CONNECTING` during mount. Any
page that calls `new WebSocket(...)` now mounts cleanly under jsdom —
unblocks smoke tests for `news-monitor`, `watchlist`, and any future
page that subscribes to a live feed.

### 3. Expanded MSW handler shapes (`src/test/msw-handlers.ts`)

Four new specific handlers for shapes consumed by the new tests:

| Endpoint                   | Shape source                                           |
| -------------------------- | ------------------------------------------------------ |
| `/api/proof/dashboard`     | `proof.tsx` `ProofDashboardData` interface             |
| `/api/system/risk`         | `lib/api.ts` `RiskConfig` interface                    |
| `/api/system/status`       | Paper/live mode probe used by `useSystemStatus`        |
| `/api/alpaca/account`      | `lib/api.ts` `AlpacaAccount` interface                 |

### 4. Three new smoke tests

| Test                                                                                  | Page pattern                                                                    |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/pages/__tests__/checklist.test.tsx`                                              | Local state only — no useQuery at mount, data loads on button click             |
| `src/pages/__tests__/proof.test.tsx`                                                  | Single useQuery with query-string param; recharts components mount under jsdom  |
| `src/pages/__tests__/news-monitor.test.tsx`                                           | `new WebSocket(...)` in useEffect — depends on the Phase 12 shim                |

Each is ≤ 40 lines. Two assertions per file: header text + one element
that proves the query / shim path worked.

### 5. Launch checklist note (`docs/LAUNCH_CHECKLIST.md`)

Added a paragraph to section 2 documenting the Phase 12 CI enforcement
and the FakeWebSocket shim.

---

## Apply

```bash
cd /path/to/Godsview
git checkout phase-11-dashboard-msw-smoke-tests
git checkout -b phase-12-ci-dashboard-tests
git am < phase-12/0001-phase-12-ci-dashboard-tests.patch
git tag -a v1.5.0 -m "GodsView v1.5.0 — CI enforcement + expanded smoke coverage"
```

No new dependencies — the patch only edits existing files and adds
tests. No `pnpm install` needed.

---

## Files shipped

| File                                                                        | Purpose                                                             |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `.github/workflows/ci.yml`                                                  | +dashboard test step; +dashboard regression gate                    |
| `artifacts/godsview-dashboard/src/test/setup.ts`                            | +FakeWebSocket shim (44 lines)                                      |
| `artifacts/godsview-dashboard/src/test/msw-handlers.ts`                     | +4 endpoint shapes (69 lines)                                       |
| `artifacts/godsview-dashboard/src/pages/__tests__/checklist.test.tsx` (NEW) | Checklist page smoke (2 tests)                                      |
| `artifacts/godsview-dashboard/src/pages/__tests__/proof.test.tsx` (NEW)     | Proof Dashboard page smoke (2 tests)                                |
| `artifacts/godsview-dashboard/src/pages/__tests__/news-monitor.test.tsx` (NEW) | News Monitor page smoke (2 tests)                                |
| `docs/LAUNCH_CHECKLIST.md`                                                  | +paragraph documenting Phase 12 CI enforcement                      |

---

## Verification gate

```bash
cd /path/to/Godsview
./node_modules/.bin/tsc --build                                          # exit 0
./node_modules/.bin/tsc -p artifacts/api-server/tsconfig.json --noEmit   # exit 0
./node_modules/.bin/tsc -p artifacts/godsview-dashboard/tsconfig.json --noEmit # exit 0
cd artifacts/api-server && GODSVIEW_DATA_DIR=.runtime \
  ./node_modules/.bin/vitest run --reporter=dot                          # 3654 passed | 18 skipped
cd ../godsview-dashboard && \
  ./node_modules/.bin/vitest run --config ./vitest.config.ts --reporter=dot  # 13 passed
cd ../api-server && node ./build.mjs                                     # 4.9 MB, 248 ms
cd ../godsview-dashboard && ./node_modules/.bin/vite build --config vite.config.ts # 6.34 s
```

Results at `v1.5.0`:

- Workspace typecheck: exit 0
- api-server typecheck: exit 0
- Dashboard typecheck: exit 0
- api-server vitest: 178 passed | 1 skipped (179 files); 3654 passed | 18 skipped (3672 tests)
- Dashboard vitest: 6 passed (6 files); **13 passed (13 tests)** (was 7 at v1.4.0)
- api-server bundle: 4.9 MB, 248 ms
- Dashboard bundle: 6.34 s

All six gates green.

---

## Test-suite summary at v1.5.0

| Workspace                       | Files        | Tests                     |
| ------------------------------- | ------------ | ------------------------- |
| `@workspace/api-server`         | 178 + 1 skip | 3654 passed + 18 skipped  |
| `@workspace/godsview-dashboard` | **6**        | **13 passed**             |
| **Total**                       | **184**      | **3667 passed**           |

Dashboard coverage breakdown (6 pages):

1. `not-found` — canary (no hooks)
2. `alert-center` — Phase 8+9 six query keys + SSE subscription
3. `alerts` — Raw EventSource + useMutation + 3 useQuery
4. `checklist` — local state only (no mount-time fetch)
5. `proof` — single useQuery + recharts components
6. `news-monitor` — WebSocket live feed via FakeWebSocket shim

---

## Production-readiness gate status at `v1.5.0`

| Gate                                                                             | Status       |
| -------------------------------------------------------------------------------- | ------------ |
| 1. TradingView MCP + webhook router                                              | shipped      |
| 2. Backtesting → paper → assisted live → auto-promotion                          | shipped      |
| 3. AWS production deploy                                                         | shipped      |
| 4. All 68 sidebar pages with RBAC                                                | shipped      |
| 5. SLOs + alert routing + k6 baseline                                            | shipped      |
| 6. Documentation truth pass + launch checklist                                   | shipped      |
| 7. Alert Center real wiring + channel mapping                                    | shipped      |
| 8. Alert Center SSE push + live connection badge                                 | shipped      |
| 9. Test-suite hardening + concrete receiver adapters + verifier CLI              | shipped      |
| 10. Dashboard MSW smoke tests                                                    | shipped      |
| 11. **CI enforcement of dashboard tests + regression gate + WebSocket shim**     | **shipped**  |

**Production readiness: 100%.** All eleven gates shipped. The dashboard
test suite is now enforced on every PR — no silent regressions.

---

## Extending the smoke-test suite

The pattern established across Phase 11 + 12 is:

1. Find a page you want to cover.
2. Check whether it reaches for any jsdom gaps (`new WebSocket`, chart
   ResizeObserver, `matchMedia`) — all three are already shimmed.
3. If it calls an endpoint with a specific shape, add a handler in
   `src/test/msw-handlers.ts`. Otherwise rely on the `/api/*`
   catch-all.
4. Write a ≤ 30-line test in `src/pages/__tests__/<page>.test.tsx`.

When the suite passes 20 tests, bump the regression floor in
`.github/workflows/ci.yml` from 10 to (count − 3). The three-test
margin absorbs legitimate refactors without blocking churn.

---

## Release

```bash
git push origin phase-12-ci-dashboard-tests
git push origin v1.5.0
```

---

## Tag progression

```
v1.0.0  →  production-ready baseline (Phase 7)
v1.1.0  →  (reserved)
v1.2.0  →  Dashboard SSE push for Alert Center (Phase 9)
v1.3.0  →  Test-suite hardening + webhook receiver examples (Phase 10)
v1.4.0  →  Dashboard MSW smoke tests (Phase 11)
v1.5.0  →  CI enforcement + expanded smoke coverage (Phase 12) ← current head
```
