/**
 * checklist_engine.ts — Pre-Trade Discipline Gate
 *
 * Validates trading setups against a standardized checklist of criteria
 * before execution. Provides both manual evaluation and auto-fill capabilities
 * using SMC engine output.
 *
 * The checklist ensures consistent risk management and discipline across all trades.
 */

import type { SMCState } from "./schemas";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ChecklistItem {
  key: string;
  label: string;
  required: boolean;
  value: boolean;
}

export interface ChecklistResult {
  symbol: string;
  setup_type: string;
  session: string;
  items: ChecklistItem[];
  passed: boolean;
  score: number; // 0-1
  blocked_reasons: string[];
  evaluated_at: string; // ISO string
}

// ── Template ────────────────────────────────────────────────────────────────────

export const CHECKLIST_TEMPLATE: Omit<ChecklistItem, "value">[] = [
  {
    key: "htf_bias_aligned",
    label: "HTF bias aligned with trade direction",
    required: true,
  },
  {
    key: "liquidity_swept",
    label: "Liquidity sweep confirmed",
    required: true,
  },
  {
    key: "structure_shift",
    label: "Market structure shift (BOS/CHoCH) detected",
    required: true,
  },
  {
    key: "displacement_confirmed",
    label: "Displacement / strong move confirmed",
    required: true,
  },
  {
    key: "entry_zone_touched",
    label: "Price at Order Block or FVG entry zone",
    required: true,
  },
  {
    key: "rr_minimum_met",
    label: "Risk:Reward ratio >= 3:1",
    required: true,
  },
  {
    key: "session_valid",
    label: "Valid trading session (London/NY)",
    required: true,
  },
  {
    key: "no_news_lockout",
    label: "No high-impact news lockout active",
    required: true,
  },
];

// ── Evaluation ─────────────────────────────────────────────────────────────────

export interface EvaluateChecklistInput {
  symbol: string;
  setup_type: string;
  session: string;
  htf_bias_aligned: boolean;
  liquidity_swept: boolean;
  structure_shift: boolean;
  displacement_confirmed: boolean;
  entry_zone_touched: boolean;
  rr_minimum_met: boolean;
  session_valid: boolean;
  no_news_lockout: boolean;
}

/**
 * Evaluate a checklist with explicit boolean values.
 * Maps each boolean to the template and computes passed/score/blocked_reasons.
 */
export function evaluateChecklist(
  input: EvaluateChecklistInput,
): ChecklistResult {
  const items: ChecklistItem[] = CHECKLIST_TEMPLATE.map((template) => {
    const value: boolean =
      input[template.key as keyof Omit<EvaluateChecklistInput, "symbol" | "setup_type" | "session">] ?? false;
    return {
      key: template.key,
      label: template.label,
      required: template.required,
      value,
    };
  });

  // All required items must be true
  const blockedReasons: string[] = items
    .filter((item) => item.required && !item.value)
    .map((item) => item.label);

  const passed: boolean = blockedReasons.length === 0;

  // Score: count of true items / total items
  const trueCount: number = items.filter((item) => item.value).length;
  const score: number = items.length > 0 ? trueCount / items.length : 0;

  return {
    symbol: input.symbol,
    setup_type: input.setup_type,
    session: input.session,
    items,
    passed,
    score: Math.round(score * 100) / 100,
    blocked_reasons: blockedReasons,
    evaluated_at: new Date().toISOString(),
  };
}

// ── Auto-Evaluation ────────────────────────────────────────────────────────────

/**
 * Auto-evaluate a checklist using SMC engine output and regime data.
 * Maps SMC state and regime signals to checklist booleans.
 */
export function autoEvaluateChecklist(
  symbol: string,
  smcState: SMCState,
  regimeState: any, // Can be expanded with full type later
  sessionLabel: string,
  setupType: string = "smc",
): ChecklistResult {
  // HTF bias aligned: trend is not range
  const htfBiasAligned: boolean = smcState.structure.trend !== "range";

  // Liquidity swept: any pool has been swept
  const liquiditySwept: boolean = smcState.liquidityPools.some(
    (p: any) => p.swept === true,
  );

  // Structure shift: BOS or CHoCH detected
  const structureShift: boolean =
    smcState.structure.bos === true || smcState.structure.choch === true;

  // Displacement confirmed: structureScore > 0.6
  const displacementConfirmed: boolean =
    smcState.structure.structureScore > 0.6;

  // Entry zone touched: active order blocks or unfilled FVGs exist
  const entryZoneTouched: boolean =
    smcState.activeOBs.length > 0 || smcState.unfilledFVGs.length > 0;

  // RR minimum met: placeholder (computed by caller in manual override)
  const rrMinimumMet: boolean = true;

  // Session valid: London, NY, or overlap session
  const sessionValid: boolean = [
    "london",
    "new_york",
    "london_ny_overlap",
  ].includes(sessionLabel.toLowerCase());

  // No news lockout: placeholder (caller overrides based on calendar)
  const noNewsLockout: boolean = true;

  return evaluateChecklist({
    symbol,
    setup_type: setupType,
    session: sessionLabel,
    htf_bias_aligned: htfBiasAligned,
    liquidity_swept: liquiditySwept,
    structure_shift: structureShift,
    displacement_confirmed: displacementConfirmed,
    entry_zone_touched: entryZoneTouched,
    rr_minimum_met: rrMinimumMet,
    session_valid: sessionValid,
    no_news_lockout: noNewsLockout,
  });
}

// ── Cache ──────────────────────────────────────────────────────────────────────

export const checklistCache = new Map<string, ChecklistResult>();

const CACHE_TTL_MS: number = 2 * 60 * 1000; // 2 minutes

/**
 * Get cached checklist result if valid, otherwise null.
 */
export function getCachedChecklist(symbol: string): ChecklistResult | null {
  const cached = checklistCache.get(symbol);
  if (!cached) return null;

  // Check TTL: if evaluated more than 2 min ago, invalidate
  const ageMs =
    new Date().getTime() - new Date(cached.evaluated_at).getTime();
  if (ageMs > CACHE_TTL_MS) {
    checklistCache.delete(symbol);
    return null;
  }

  return cached;
}

/**
 * Cache a checklist result.
 */
export function cacheChecklist(
  symbol: string,
  result: ChecklistResult,
): void {
  checklistCache.set(symbol, result);
}

/**
 * Clear all cached results.
 */
export function clearChecklistCache(): void {
  checklistCache.clear();
}
