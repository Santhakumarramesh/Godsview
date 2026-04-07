/**
 * regime_sizing_adapter.ts — Phase 12C
 *
 * Regime-Adaptive Position Sizing
 *
 * Scales the Kelly fraction based on the current market regime.
 * A trending regime gets full Kelly, a choppy/volatile one gets reduced sizing.
 *
 * Regime → Kelly multiplier:
 *   TRENDING / HIGH_MOMENTUM / BREAKOUT   → 1.00 (full size)
 *   MEAN_REVERSION / RANGE_BOUND          → 0.75
 *   VOLATILE / HIGH_VOLATILITY            → 0.50
 *   LOW_VOLATILITY / COMPRESSION          → 0.60 (potential breakout — size up cautiously)
 *   CHOPPY / UNCERTAIN / MIXED            → 0.40
 *   UNKNOWN / any unlisted                → 0.50 (conservative default)
 *
 * The regime confidence (0–1) further scales: multiplier × sqrt(confidence).
 * sqrt is used instead of linear to avoid punishing moderate-confidence regimes too much.
 *
 * Max downscale: never go below 0.25× the base Kelly.
 */

export type RegimeKind =
  | "TRENDING" | "HIGH_MOMENTUM" | "BREAKOUT" | "UPTREND" | "DOWNTREND"
  | "MEAN_REVERSION" | "RANGE_BOUND" | "RANGING"
  | "VOLATILE" | "HIGH_VOLATILITY"
  | "LOW_VOLATILITY" | "COMPRESSION" | "SQUEEZE"
  | "CHOPPY" | "UNCERTAIN" | "MIXED"
  | string; // open-ended for future regimes

// ── Regime multiplier table ────────────────────────────────────────────────────

const REGIME_MULTIPLIERS: Record<string, number> = {
  // Strongly trending — full size
  TRENDING: 1.00,
  HIGH_MOMENTUM: 1.00,
  BREAKOUT: 0.95,
  UPTREND: 0.95,
  DOWNTREND: 0.90,

  // Mean-reversion / range
  MEAN_REVERSION: 0.75,
  RANGE_BOUND: 0.75,
  RANGING: 0.70,

  // Volatile — reduced size (larger stops needed)
  VOLATILE: 0.50,
  HIGH_VOLATILITY: 0.50,

  // Low volatility — modest sizing (anticipating breakout)
  LOW_VOLATILITY: 0.60,
  COMPRESSION: 0.60,
  SQUEEZE: 0.65,

  // Choppy / uncertain — minimal size
  CHOPPY: 0.40,
  UNCERTAIN: 0.45,
  MIXED: 0.45,
};

const DEFAULT_MULTIPLIER = 0.50;
const MIN_MULTIPLIER = 0.25;

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Returns the regime-adjusted Kelly fraction.
 *
 * @param baseKelly    Kelly fraction from strategy params (0–1)
 * @param regime       Current regime string (case-insensitive)
 * @param confidence   Regime confidence score (0–1, default 0.7)
 * @returns Adjusted Kelly fraction (never below baseKelly × MIN_MULTIPLIER)
 */
export function adaptKellyToRegime(
  baseKelly: number,
  regime: RegimeKind,
  confidence = 0.7,
): number {
  const key = String(regime).toUpperCase().trim();
  const multiplier = REGIME_MULTIPLIERS[key] ?? DEFAULT_MULTIPLIER;

  // Confidence scaling: sqrt so moderate confidence (0.5) still gives 70.7% of multiplier
  const confScale = Math.sqrt(Math.max(0, Math.min(1, confidence)));
  const adjusted = baseKelly * multiplier * confScale;

  // Apply floor: never below 25% of base Kelly
  const floor = baseKelly * MIN_MULTIPLIER;
  return Math.max(floor, Math.min(baseKelly, adjusted));
}

/**
 * Returns regime sizing metadata for logging / UI display.
 */
export function regimeSizingInfo(regime: RegimeKind, confidence = 0.7) {
  const key = String(regime).toUpperCase().trim();
  const multiplier = REGIME_MULTIPLIERS[key] ?? DEFAULT_MULTIPLIER;
  const confScale = Math.sqrt(Math.max(0, Math.min(1, confidence)));
  const effectiveScale = multiplier * confScale;

  return {
    regime: key,
    regimeMultiplier: multiplier,
    confidenceScale: Number(confScale.toFixed(3)),
    effectiveScale: Number(effectiveScale.toFixed(3)),
    sizingTier:
      effectiveScale >= 0.85 ? "FULL"
      : effectiveScale >= 0.65 ? "STANDARD"
      : effectiveScale >= 0.45 ? "REDUCED"
      : "MINIMAL",
  };
}

/**
 * List of known regime strings and their multipliers (for UI display).
 */
export function getRegimeMultiplierTable() {
  return Object.entries(REGIME_MULTIPLIERS)
    .sort((a, b) => b[1] - a[1])
    .map(([regime, multiplier]) => ({ regime, multiplier }));
}
