# Phase 1c Handoff — CI Lie Closed + Python Lint/Format Hardened

**Branch:** `phase-1c-cleanup` (based on `phase-1b-typesafety`)
**Patch:** `0001-phase-1c-close-the-CI-lie-ruff-lint-format-hardening.patch`
**Files changed:** 142 (CI workflow + 11 surgical Python fixes + 134 format-only)

---

## What This Phase Does

This phase closes Phase 1 by removing the **CI lie**: the `continue-on-error: true` and `|| true` flags that were silently letting type errors and lint errors pass CI as green.

After this phase, **CI tells the truth**. If TypeScript, ruff, or mypy fail, the build fails.

---

## Apply Locally

```bash
# From your local Godsview repo
git checkout phase-1b-typesafety
git checkout -b phase-1c-cleanup
git am < /path/to/0001-phase-1c-close-the-CI-lie-ruff-lint-format-hardening.patch
```

Or if you prefer to merge:

```bash
git checkout main  # or your integration branch
git merge phase-1c-cleanup
```

---

## What Changed

### 1. CI Workflow — `.github/workflows/ci.yml`

**Removed these "lies":**
- `continue-on-error: true` on TypeCheck API Server
- `|| true` on Ruff lint
- `|| true` on Ruff format check
- `|| true` on MyPy typecheck

**Added:**
- TypeCheck Scripts step (was missing entirely)
- TypeCheck Workspace step using `pnpm run typecheck` (full project references)

### 2. Python Lint Surgical Fixes (11 files)

| File | Fix | Code |
|------|-----|------|
| `godsview-openbb/app/agents/reasoning_agent.py` | Removed unused `market = state.data.get("market", {})` | F841 |
| `godsview-openbb/app/analysis/liquidity.py` | `l → lo`, `l2 → lo2` | E741 |
| `godsview-openbb/app/analysis/structure.py` | `l → lo` | E741 |
| `godsview-openbb/app/nodes/timeframe_node.py` | Removed dead duplicate `atr_val = _atr(...)` | — |
| `godsview-openbb/app/state/__init__.py` | Documented `# noqa: F403` on intentional star import | F403 |
| `services/backtest_service/broker.py` | Removed unused `bars_held` (kept comment) | F841 |
| `services/feature_service/indicators.py` | `l → lo` | E741 |
| `services/scheduler_service/main.py` | Removed unused `size = pos.get("size", 0)` | F841 |
| `services/tests/conftest.py` | Documented `# noqa: E402` (intentional below-env-setup import) | E402 |
| `services/tests/test_indicators.py` | `u, m, l` → `upper, mid, lower` for bollinger destructure | E741 |

### 3. Python Format Pass (134 files, format-only)

One-time `ruff format` applied. No logic changes — pure whitespace, quote, and trailing-comma normalization. From this point on, format is enforced in CI.

---

## Verification — All Gates Green

Run from repo root after applying:

```bash
# Python
ruff check .                                     # → 0 errors
ruff format --check .                            # → clean
mypy services/                                   # → 0 errors
pytest services/tests/                           # → 160 passed

# TypeScript
pnpm install
pnpm run typecheck                               # → 0 errors (full workspace)
pnpm --filter @workspace/api-server typecheck    # → 0 errors
pnpm --filter @workspace/dashboard typecheck     # → 0 errors
```

---

## Known Pre-existing Sandbox Limitation

`better-sqlite3` native bindings cannot rebuild in this sandbox (offline node-headers fetch from nodejs.org returns 403). This is **not introduced by this phase** — it exists on the baseline `main` branch as well. Local rebuild on your machine should work normally:

```bash
pnpm rebuild better-sqlite3
```

---

## Phase 1 Status: ✅ COMPLETE

| Sub-phase | What | Status |
|-----------|------|--------|
| 1a | Mechanical TS fixes + 2 failing tests green | ✅ shipped |
| 1b | Surgical type fixes + drizzle-orm operator unification | ✅ shipped |
| 1c | CI lie removed + Python lint/format hardened | ✅ shipped (this patch) |

**Production-readiness gain from Phase 1:** TypeScript and Python quality are now hard-gated. No more silent failures hiding behind `continue-on-error`.

---

## Next: Phase 2

Phase 2 removes mock data from live execution paths:
- `risk_v2` — replace mocked exposure/limits with real broker queries
- `backtest_v2` — wire real bar replay (no synthetic random walks in live paths)
- `analytics` — remove placeholder PnL series

Phase 2 patch will follow the same handoff format.
