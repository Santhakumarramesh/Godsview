/**
 * macro_news_gate.ts — M5d-risk-news-gate
 *
 * Read-only adapter that consumes the existing /api/macro-risk
 * `news_window` signal and shapes it into a per-symbol "should block new
 * entry" decision, plus a diagnostics blob.
 *
 * Hard rules (locked by milestone scope):
 *  - READ-ONLY. No state writes, no upstream provider changes.
 *  - Does NOT add a new gate to the risk_pipeline. The existing gate 6
 *    (news_lockout) is the enforcement point. This adapter only
 *    *contributes* a per-request boolean and a human-readable reason
 *    that gate 6 surfaces verbatim.
 *  - Blocks ONLY new entries. Stop-out exits and `closing=true` requests
 *    are unaffected — the pipeline itself short-circuits the macro-news
 *    contribution for those (see risk_pipeline.ts gate 6).
 *  - Fail-OPEN with HONEST DEGRADED REASON. If the macro-risk aggregate
 *    cannot be built (FRED outage, calendar client throw, anything),
 *    `getMacroNewsGateState()` resolves with `active=false`,
 *    `source="macro-risk-unavailable"`, and the actual error in `reason`.
 *    Rationale: this is an OBSERVATION layer for new entries; if the
 *    macro layer is down we MUST NOT crash the scanner. We choose
 *    transparency (explicit degraded source label visible in
 *    /api/brain-state diagnostics) over a fabricated lockout.
 *  - 5-second in-process cache so per-symbol scans during a single tick
 *    don't hammer FRED/Alpaca-news. The producer itself caches at
 *    6h (FRED) and 30s (Alpaca-news), so this short cache is purely
 *    about coalescing a single scan-tick across N symbols.
 *
 * Diagnostics shape published into m2 snapshot:
 *   {
 *     enabled: true,
 *     active: <true if news_window.active AND applies-to-symbol>,
 *     reason: "macro_news_window_active: <event_label> within restricted window" | null,
 *     affected_symbols: <copied from news_window>,
 *     source: "macro-risk" | "macro-risk-cached" | "macro-risk-unavailable" | "disabled"
 *   }
 *
 * Disable knob: GODSVIEW_MACRO_NEWS_GATE_ENABLED=false sets enabled=false
 * across the board (zero-impact mode); default is enabled=true. There is
 * deliberately no per-test mock — tests inject state via the same
 * `setMacroNewsGateStateForTesting()` helper used here (see __tests__).
 */

import { logger } from "../logger";
import { buildMacroRiskAggregate } from "../../routes/macro_risk";

// ── Types ────────────────────────────────────────────────────────────────────

export type MacroNewsGateSource =
  | "macro-risk"
  | "macro-risk-cached"
  | "macro-risk-unavailable"
  | "disabled";

export interface MacroNewsGateState {
  enabled: boolean;
  active: boolean;
  /** Null when active=false. When active=true, always populated. */
  reason: string | null;
  /** Subset of symbols for which the gate applies. Empty = applies to all. */
  affected_symbols: string[];
  source: MacroNewsGateSource;
  /** ISO timestamp when this state was last refreshed from the producer. */
  last_refreshed_at: string | null;
}

// ── Config ──────────────────────────────────────────────────────────────────

const ENABLED =
  String(process.env.GODSVIEW_MACRO_NEWS_GATE_ENABLED ?? "true").toLowerCase() !== "false";

/** How long to keep a single producer poll before re-fetching. */
const CACHE_TTL_MS = 5_000;

// ── Cache ───────────────────────────────────────────────────────────────────

interface CacheEntry {
  state: MacroNewsGateState;
  fetchedAtMs: number;
}

let cache: CacheEntry | null = null;

/**
 * Test-only override. Production code MUST NOT call this. Used by
 * vitest cases that need to simulate "active news window" deterministically
 * without standing up a fake macro-risk endpoint.
 */
let testOverride: MacroNewsGateState | null = null;

export function setMacroNewsGateStateForTesting(state: MacroNewsGateState | null): void {
  testOverride = state;
  cache = null;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Return the current macro-news-gate state. Cached for CACHE_TTL_MS.
 *
 * Never throws. On producer failure, returns enabled=true, active=false,
 * source="macro-risk-unavailable" with the error string in `reason`.
 */
export async function getMacroNewsGateState(): Promise<MacroNewsGateState> {
  if (testOverride !== null) {
    return testOverride;
  }

  if (!ENABLED) {
    return {
      enabled: false,
      active: false,
      reason: null,
      affected_symbols: [],
      source: "disabled",
      last_refreshed_at: null,
    };
  }

  const nowMs = Date.now();
  if (cache && nowMs - cache.fetchedAtMs < CACHE_TTL_MS) {
    return { ...cache.state, source: "macro-risk-cached" };
  }

  try {
    const agg = await buildMacroRiskAggregate();
    const nw = agg.news_window;
    const state: MacroNewsGateState = {
      enabled: true,
      active: !!nw.active,
      reason: nw.active && nw.reason
        ? `macro_news_window_active: ${nw.reason}`
        : null,
      affected_symbols: Array.isArray(nw.affected_symbols) ? [...nw.affected_symbols] : [],
      source: "macro-risk",
      last_refreshed_at: new Date(nowMs).toISOString(),
    };
    cache = { state, fetchedAtMs: nowMs };
    return state;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { err: msg },
      "[macro_news_gate] /api/macro-risk producer threw; failing open with degraded reason",
    );
    const fallback: MacroNewsGateState = {
      enabled: true,
      active: false,
      reason: `macro-risk endpoint unavailable: ${msg}`,
      affected_symbols: [],
      source: "macro-risk-unavailable",
      last_refreshed_at: new Date(nowMs).toISOString(),
    };
    // Cache the fallback briefly so we don't thrash on a hard outage.
    cache = { state: fallback, fetchedAtMs: nowMs };
    return fallback;
  }
}

/**
 * Pure helper: given gate state and a symbol, return whether the gate
 * applies to NEW entries on that symbol.
 *
 * Rules:
 *   - enabled=false → never applies
 *   - active=false → never applies
 *   - affected_symbols=[] AND active=true → applies to ALL symbols (conservative
 *     default for macro events without explicit related_symbols)
 *   - affected_symbols non-empty → applies only to symbols in the set
 */
export function appliesToSymbol(state: MacroNewsGateState, symbol: string): boolean {
  if (!state.enabled) return false;
  if (!state.active) return false;
  if (state.affected_symbols.length === 0) return true;
  return state.affected_symbols.includes(symbol);
}

/**
 * Convenience: return the (active, reason) pair for a given symbol — what
 * `attemptExecution()` actually plumbs into ExecutionRequest.macroNewsGate.
 */
export function evaluateMacroNewsGateForSymbol(
  state: MacroNewsGateState,
  symbol: string,
): { active: boolean; reason: string | null } {
  const applies = appliesToSymbol(state, symbol);
  if (!applies) return { active: false, reason: null };
  return { active: true, reason: state.reason };
}

/**
 * Drop the in-process cache — used by tests and by ops to force a refetch.
 */
export function resetMacroNewsGateCache(): void {
  cache = null;
}
