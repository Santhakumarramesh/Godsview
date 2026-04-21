# Phase 1b Handoff — `phase-1b-typesafety`

**Branch:** `phase-1b-typesafety`
**Commit:** `14c7551`
**Base:** `phase-1a-typesafety` (commit `8850f6f`)
**Patch:** `0001-phase-1b-typesafety.patch` (221 KB, 147 files)

---

## What Phase 1b does

Closes the drizzle-orm peer-dependency identity split that survived
Phase 1a and does the top-file surgical type fixes the mechanical
Phase 1a pass couldn't reach.

### Root cause fixed

`pnpm`'s peer-dependency hashing resolved `drizzle-orm` to multiple
distinct copies (one per peer subgraph). Routes that imported
operators directly from `drizzle-orm` ended up with
`AnyColumn`/`SQLWrapper` types from one instance and columns from
`@workspace/db` from a different instance. `tsc` complained on every
`.where(eq(table.col, val))` call.

### What changed

| # | Area | Change |
|---|------|--------|
| 1 | `lib/db/src/index.ts` | Re-export every drizzle-orm operator from `@workspace/db`. All consumers now share a single drizzle-orm type instance. |
| 2 | ~50 routes + lib files | Rewrote `from "drizzle-orm"` → `from "@workspace/db"` for operator imports. |
| 3 | ~70 surgical files | `unknown` narrowing, explicit Express 5 param casts, pino logger object shape, SubsystemStatus union widening, Zod inference fixes. |
| 4 | `lib/utils/params.ts` (new) | Central `paramString`/`paramSymbol`/`paramInt`/`paramFloat`/`paramEnum` helpers to coerce Express 5 `string \| string[] \| ParsedQs` cleanly. |
| 5 | 21 `__tests__/*.ts` | Extended every `vi.mock("@workspace/db", ...)` block with operator stubs so mocks match the new re-export surface. `sql` is `Object.assign(vi.fn(() => ""), { raw: vi.fn((s) => s) })` to support both tagged-template and `.raw()` usage. |

---

## How to apply (on your machine)

```bash
# from the repo root (clean working tree, on branch phase-1a-typesafety or main)
cd /path/to/Godsview
git fetch origin
git checkout -b phase-1b-typesafety
git am /path/to/phase-1b/0001-phase-1b-typesafety.patch
```

If `git am` fails on one of the Phase 1a–tracked files, drop the patch
onto a fresh checkout of `phase-1a-typesafety` first:

```bash
git checkout phase-1a-typesafety
git checkout -b phase-1b-typesafety
git am /path/to/phase-1b/0001-phase-1b-typesafety.patch
```

Then push:

```bash
git push -u origin phase-1b-typesafety
```

---

## Verification (must all pass on your machine)

```bash
# 1. Workspace typecheck
npx tsc --build
# expected exit 0

# 2. api-server typecheck
cd artifacts/api-server && npx tsc --noEmit && cd ../..
# expected exit 0

# 3. api-server vitest
cd artifacts/api-server && ./node_modules/.bin/vitest run
# expected (assuming better-sqlite3 prebuild lands — see known issue below):
#   Test Files  179 passed (179)
#   Tests      3672 passed (3672)
#
# if better-sqlite3 still needs rebuild:
#   Test Files   1 failed | 178 passed (179)
#   Tests       18 failed | 3654 passed (3672)
#   (only execution_validator.test.ts)
```

---

## Known pre-existing issue — NOT a Phase 1b regression

`src/__tests__/execution_validator.test.ts` (18 tests) fails to load
the `better-sqlite3` native binding. Confirmed identical failure on
the pre-Phase-1b baseline via `git stash && npx vitest run` (same 18
tests fail with the same binding error).

On any normal dev/CI machine (network egress to `nodejs.org`), this
resolves automatically:

```bash
pnpm rebuild better-sqlite3
```

If the binding still can't be located after rebuild, force a clean
install of the package:

```bash
rm -rf node_modules/.pnpm/better-sqlite3@11.10.0
pnpm install --force
```

The sandbox this commit was built in could not reach
`nodejs.org/download/release/v22.22.0/node-v22.22.0-headers.tar.gz`
(403 from `node-gyp install`), which is the only reason the 18 tests
show as failing here.

---

## What's next (Phase 1c — tail files + CI flag)

Phase 1b leaves `.github/workflows/ci.yml` line 39 with
`continue-on-error: true` on the API-Server typecheck step. That flag
is the "CI lie" we are unwinding. Phase 1c will:

1. Fix remaining TS errors in the tail files (low-traffic routes,
   scripts, `ops/*`, `explain/*` subsystems).
2. Flip `continue-on-error: true` → removed (or explicit `false`) on
   the TypeCheck API Server CI step.
3. Add a `npx tsc --build` gate to `ci.yml` at the repo root level.

After Phase 1c, Phase 1 closes.

---

## Sign-off

- [x] `npx tsc --build` → 0 errors
- [x] `artifacts/api-server` `tsc --noEmit` → 0 errors
- [x] 3654/3672 vitest passing (18 pre-existing `better-sqlite3`
      failures, not introduced by this phase)
- [x] Patch file generated
- [x] HANDOFF written
- [ ] User applies patch + pushes `phase-1b-typesafety` to GitHub
- [ ] User confirms verification steps pass on their machine
