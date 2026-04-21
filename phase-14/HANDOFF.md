# Phase 14 — HANDOFF

**Tag:** `v1.7.0`
**Branch:** `phase-14-e2e-integration-test`
**Commit:** `5abba74`
**Date:** 2026-04-18
**Production readiness:** **100%** (13/13 gates shipped)

---

## TL;DR

Phase 14 adds a real end-to-end integration test that proves the
webhook → `signal_stream` → SSE pipeline works over actual HTTP
against the live `signalHub` singleton, and two CI hard-gates that
keep the test from being silently deleted. Production readiness
stays at 100% — this phase closes a coverage gap, not a regression.

---

## What shipped

### 1. `artifacts/api-server/src/__tests__/e2e/webhook_to_sse_e2e.test.ts`

A brand-new integration test file (~240 lines, 4 tests, 2 describe
blocks) that exercises the full transport stack — Express → Node
`http.Server` → SSE frames → client parser — against the production
`signalHub` singleton.

Unlike the existing `streaming_route.test.ts` (which `vi.mock`s
`signal_stream`), this test imports the real modules:

```ts
import {
  publishAlert,
  publishSignal,
  signalHub,
} from "../../lib/signal_stream";
import streamingRouter from "../../routes/streaming";
```

The test mounts `streamingRouter` on an Express app, binds it to a
127.0.0.1 ephemeral port, and opens raw `http.request` SSE clients
(no `EventSource` polyfill — matches how the production dashboard
parses the stream).

**Tests:**

| # | Description                                                       | Proves |
|---|-------------------------------------------------------------------|--------|
| 1 | direct `publishAlert` reaches a subscribed SSE client             | Hub → SSE transport wiring |
| 2 | webhook POST that calls `publishAlert` reaches the SSE subscriber | Full HTTP → publish → SSE round-trip |
| 3 | client filter excludes non-alert events                           | `addClient(res, ["alert"])` semantics |
| 4 | `signalHub.status().clientCount` reflects live connections        | Hub client bookkeeping |

**Design pragmas:**

- Each test embeds a unique correlation `tag` (`phase14-direct-<ts>`,
  `phase14-webhook-<ts>`, etc.) in the payload so events from other
  tests running in parallel against the same singleton hub don't
  produce false positives. The waiter ignores non-matching frames
  and tracks `ignoredBefore` for a sanity assertion.
- A 50ms warmup between opening the SSE connection and firing the
  publish gives `addClient()` a tick to register before the publish
  happens.
- Test 2 uses a minimal test-only `/test-webhook` endpoint mounted
  in `beforeAll` that calls `publishAlert()` directly — the
  production `routes/tradingview_mcp.ts` has `@ts-nocheck` and
  flows webhooks through SignalIngestion + MCPProcessor (which
  have unit coverage elsewhere), so Phase 14 deliberately tests
  the transport layer in isolation.

**Timing:** 4/4 passed in ~627ms during verification. The full
api-server suite went from 3654 → 3658 passing, 179 → 179 test
files (the new file counts as one additional file).

### 2. `.github/workflows/ci.yml`

Two surgical edits to the `build` job:

- **Updated comment** on the existing api-server regression gate
  to reflect the new test count (3654 → 3658). The floor stays at
  3000 — that's the "catastrophic regression" gate, not a per-phase
  counter.

- **New hard gate step** "Verify e2e test file is present (Phase 14 hard gate)"
  immediately after the api-server count gate:

  ```yaml
  - name: Verify e2e test file is present (Phase 14 hard gate)
    # The e2e webhook → SSE test is a load-bearing production gate:
    # it exercises the real signal_stream hub over HTTP, the only
    # test path that does. If someone deletes it, we want CI red.
    run: |
      test -f artifacts/api-server/src/__tests__/e2e/webhook_to_sse_e2e.test.ts \
        || { echo "::error::Phase 14 e2e test file missing"; exit 1; }
      echo "e2e gate file present"
  ```

  This is the same "file presence" gate pattern we rely on for
  other load-bearing test paths. A test count regression surfaces
  as a number drop; a silent deletion of an entire load-bearing
  file could stay under the 3000 floor for a long time without this
  gate.

### 3. `docs/LAUNCH_CHECKLIST.md`

- §2 "Unit + integration tests" adds a Phase 14 paragraph describing
  the new e2e test file, how it differs from the mocked
  `streaming_route.test.ts`, and the CI file-presence gate.
- Command line updated: `3654 tests` → `3658 tests`.
- Reference counts updated to `v1.7.0`.
- Phase 14 HANDOFF reference added to the release notes list.
- Production-readiness gate table extends to 13 rows with a new
  "End-to-end webhook → SSE integration test + CI file-presence
  gate — shipped" row.
- Closing paragraph updated: "All thirteen gates ship… backed by…
  a real end-to-end integration test that proves the webhook → SSE
  transport wiring works against the live signalHub singleton."

---

## Verification gate — all green

Every gate ran clean against the branch before tag:

| Gate                                    | Result                                         |
|-----------------------------------------|------------------------------------------------|
| Workspace `tsc --build`                 | exit 0                                         |
| api-server `tsc --noEmit`               | exit 0                                         |
| dashboard `tsc --noEmit`                | exit 0                                         |
| scripts `tsc --noEmit`                  | exit 0                                         |
| api-server `vitest run`                 | **3658 passed \| 18 skipped** (179 + 1 skip files) |
| dashboard `vitest run`                  | **13 passed** (6 files)                        |
| api-server `node ./build.mjs` (esbuild) | exit 0                                         |
| dashboard `vite build`                  | exit 0                                         |

CI locally-equivalent: `typecheck-and-test`, `contract-validation`,
and `build` jobs all pass. The new Phase 14 file-presence gate
(step in `build`) finds the file and echoes `"e2e gate file present"`.

---

## File manifest

```
A  artifacts/api-server/src/__tests__/e2e/webhook_to_sse_e2e.test.ts   (NEW, 337 lines)
M  .github/workflows/ci.yml                                             (+13, -0)
M  docs/LAUNCH_CHECKLIST.md                                             (+27, -5)
```

Commit: `5abba74 Phase 14: End-to-end webhook → SSE integration test`
Tag:    `v1.7.0`
Branch: `phase-14-e2e-integration-test`

---

## How to apply

From a clean `main` checkout of `v1.6.0`:

```bash
git checkout main
git fetch --tags
git checkout -b phase-14-e2e-integration-test v1.6.0
git am /sessions/nice-amazing-feynman/mnt/Godsview/phase-14/0001-phase-14-e2e-integration-test.patch
```

Or, if the branch is already pushed:

```bash
git fetch origin phase-14-e2e-integration-test
git checkout phase-14-e2e-integration-test
```

Then verify locally:

```bash
pnpm install --frozen-lockfile
pnpm -r typecheck
pnpm -F api-server test        # expect: 3658 passed | 18 skipped
pnpm -F @workspace/godsview-dashboard test  # expect: 13 passed
cd artifacts/api-server && node ./build.mjs && cd -
pnpm -F @workspace/godsview-dashboard build
```

Then tag and push:

```bash
git tag -a v1.7.0 -m "GodsView v1.7.0 — Phase 14: End-to-end webhook → SSE integration test"
git push origin phase-14-e2e-integration-test
git push origin v1.7.0
```

---

## Tag progression

| Tag      | Phase     | Summary                                                            |
|----------|-----------|--------------------------------------------------------------------|
| v1.0.0   | Phase 7   | Production-ready baseline (7 gates)                                |
| v1.1.0   | Phase 8   | Real Alert Center wiring + channel mapping                         |
| v1.2.0   | Phase 9   | Dashboard SSE push for Alert Center                                |
| v1.3.0   | Phase 10  | Test-suite hardening + webhook receiver examples                   |
| v1.4.0   | Phase 11  | Dashboard MSW smoke tests                                          |
| v1.5.0   | Phase 12  | CI enforcement + WebSocket shim + 13 dashboard tests               |
| v1.6.0   | Phase 13  | Turnkey AWS deploy + Railway teardown automation                   |
| **v1.7.0** | **Phase 14** | **End-to-end webhook → SSE integration test + CI file gate**  |

---

## What this phase intentionally does NOT change

- Runtime behavior on production. The e2e test runs in `vitest`
  only; the api-server entry (`index.ts`) is untouched. Prod SSE
  hot path is byte-identical.
- `signal_stream.ts`, `streaming.ts`, `tradingview_mcp.ts`. No
  source changes — this phase only adds a test that exercises
  them. If the test fails, the bug is in production code, not in
  the test.
- The 3000 api-server floor. That's the catastrophic-regression
  gate; it stays. The per-phase count lives in comments for
  operator context.
- dashboard test suite (13 tests). No changes.

---

## Rollback

Pure git undo — the phase is one commit, the tag is one pointer,
the patch file is a single file:

```bash
# Local branch rollback
git checkout phase-14-e2e-integration-test
git reset --hard HEAD~1       # drops Phase 14
git tag -d v1.7.0              # drops local tag

# If pushed, remove the remote tag too:
git push origin :refs/tags/v1.7.0
```

No runtime-deploy rollback is needed because the deployed artifacts
did not change — the api-server `dist/` is the same byte-for-byte
image as in `v1.6.0`. Only `artifacts/api-server/src/` gains a new
test file; CI and docs are the only other changes.

---

## Phase 15+ backlog (not started)

Optional hardening work that can follow. None of these block
production.

1. **Phase 15 — MCPProcessor end-to-end coverage.** The Phase 14
   test hits the transport layer with a synthetic `/test-webhook`.
   The natural next step is a second e2e test that POSTs to the
   real `/api/mcp/tradingview/webhook`, runs the SignalIngestion +
   MCPProcessor path, and asserts the resulting alert lands on SSE.
   This would require removing `@ts-nocheck` from
   `routes/tradingview_mcp.ts` first (cleanup task).
2. **Phase 16 — SSE reconnection soak test.** A long-running test
   that opens an SSE client, kills the socket, reconnects, and
   verifies the ring-buffer replay delivers the events emitted
   during the gap. Would round out the reliability story for
   dashboard users on flaky networks.
3. **Phase 17 — Load-test the e2e path.** A k6 scenario that fires
   N webhooks and opens M SSE clients and asserts every published
   alert reaches every matching client within a p95 bound.
   Validates Phase 6's SLO budget against the full pipeline.
4. **Phase 18 — Remove `@ts-nocheck` from `routes/tradingview_mcp.ts`.**
   Clean up the last `@ts-nocheck` in the api-server source tree.
   Currently gated by a handful of `any`-typed MCP types that need
   structured `zod` shapes. Coupling this to Phase 15 keeps the
   refactor testable end-to-end.

Each of these can ship as a patch-only phase under the existing
`patch + HANDOFF + tag + CI green` discipline.

---

## Reference

- Patch file: `/sessions/nice-amazing-feynman/mnt/Godsview/phase-14/0001-phase-14-e2e-integration-test.patch`
- New test: `artifacts/api-server/src/__tests__/e2e/webhook_to_sse_e2e.test.ts`
- CI updates: `.github/workflows/ci.yml` (new "Verify e2e test file is present" step in `build`)
- Checklist: `docs/LAUNCH_CHECKLIST.md` §2 + §10 table
- Prior e2e-adjacent coverage: `streaming_route.test.ts` (mocked), `signal_stream.test.ts` (unit)
