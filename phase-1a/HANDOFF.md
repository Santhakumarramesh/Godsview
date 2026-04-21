# Phase 1a — Handoff (sync point)

**Branch:** `phase-1a-typesafety`
**Commit:** `8850f6f` — `phase-1a: mechanical TS fixes + 2 failing tests green`
**Patch file (backup):** `phase-1a/0001-phase-1a-mechanical-ts-fixes.patch`

---

## What's in this commit

**Source changes (124 type fixes)**
- 94 × TS1205 fixes — added `type` prefix to re-exports in
  `autonomous/index.ts`, `eval/index.ts`, `explain/index.ts`, `market/index.ts`.
- 30 × TS2769 fixes — rewrote pino calls from `logger.x("msg", err)` to
  `logger.x({ err }, "msg")` across `autonomous_brain.ts`,
  `brain_orchestrator.ts`, `mcp_stream_bridge.ts`, `strategy_evolution.ts`,
  `super_intelligence_v4.ts`, `routes/system_bridge.ts`.

**Test fixes (2 of 3 originally-failing now green locally)**
- `data_truth_engine.ts` → zero-score early return for empty candles.
- `error_body_sanitizer.ts` → JSON-aware message extraction (parses
  `{message, detail, error_description, reason, ...}` before HTML stripping).

**Dependency**
- `better-sqlite3 ^11.10.0` + `@types/better-sqlite3 ^7.6.13` added to
  `artifacts/api-server/devDependencies` so `execution_validator.test.ts`
  can load its native binding in CI.
- `pnpm-workspace.yaml` adds `better-sqlite3` to `onlyBuiltDependencies`.
- `pnpm-lock.yaml` regenerated.

---

## To push from your machine

```bash
cd /path/to/your/local/Godsview      # same repo, wherever you cloned it

# Pull the branch (two options — pick one):

# Option A: fetch directly from the session (if you rsync/scp from here)
#   scp the patch file over, then:
#   git checkout -b phase-1a-typesafety
#   git am 0001-phase-1a-mechanical-ts-fixes.patch

# Option B: if you want to reproduce the commit locally from scratch,
#   apply the patch file:
git checkout main
git pull origin main
git checkout -b phase-1a-typesafety
git am /path/to/0001-phase-1a-mechanical-ts-fixes.patch

# Then push:
git push -u origin phase-1a-typesafety
```

Open a PR titled:
```
phase-1a: mechanical TS fixes + 2 failing tests green
```

Paste the body from the commit message (or from `git log -1 --format=%B`).

---

## CI expectation on this PR

- **TypeCheck API Server** will still report remaining errors, but with
  `continue-on-error: true` the job is currently configured not to fail.
  That flag stays in place until phase-1c when the count hits 0.
- **Vitest** should show the two previously-red tests now green:
  - `src/__tests__/data_truth.test.ts`
  - `src/__tests__/error_body_sanitizer_unit.test.ts`
- **execution_validator.test.ts** depends on `better-sqlite3` — will pass
  in CI (full network) even though the sandbox couldn't fetch Node headers.

---

## Definition of done for Phase 1a

- [x] TS1205 category cleared in the 4 barrel files (0 remaining there)
- [x] TS2769 cleared in the 6 files hit by the pino regex
- [x] `data_truth.test.ts` green locally
- [x] `error_body_sanitizer_unit.test.ts` green locally
- [x] Commit on `phase-1a-typesafety`
- [ ] You merge PR after CI green → I continue Phase 1b

---

## Next up (after you merge)

**Phase 1b — surgical fixes on top-10 offender files** (≈340 errors):
`variant_generator.ts`, `strategy_critique.ts`, `market/index.ts`,
`pipeline_orchestrator.ts`, `quant_api_docs.ts`, `lab.ts`, `data_truth.ts`,
`explain/index.ts`, `trade_analytics.ts`, `autonomous_brain.ts`.

Tell me when `phase-1a-typesafety` is merged and I'll cut
`phase-1b-typesafety` from the new `main`.
