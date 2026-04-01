/**
 * macro_bias_engine.ts — Layer 0: Macro Bias Gate
 *
 * Implements Elliot Hewitt (YoungTraderWealth) 3-layer methodology — Layer 1:
 *   "Before entering any trade, align with the macro tailwind.
 *    DXY trend, rate differential, CPI momentum, and VIX regime
 *    must collectively favour your intended direction."
 *
 * Scores: 0 = extreme bearish headwind, 1 = extreme bullish tailwind.
 * Direction: derived from score. Conviction: how strongly it leans.
 *
 * Usage:
 *   const bias = computeMacroBias({ dxySlope, rateDifferentialBps, ... });
 *   if (bias.conviction === "high" && bias.blockedDirections.includes("long")) {
 *     // block the trade
 *   }
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type MacroBiasDirection = "long" | "short" | "flat";
export type MacroBiasStrength  = "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell";
export type MacroConviction    = "high" | "medium" | "low";
export type AssetClass         = "crypto" | "forex" | "equity" | "commodity";

export interface MacroBiasInput {
  /** DXY 20-day slope as a decimal fraction, e.g. +0.015 = rising dollar */
  dxySlope: number;
  /** Short-end rate differential vs USD in basis points, e.g. +50 = asset yields more */
  rateDifferentialBps: number;
  /** CPI momentum: positive = inflation accelerating, negative = decelerating */
  cpiMomentum: number;
  /** VIX level — baseline fear gauge (raw number e.g. 18.5) */
  vixLevel: number;
  /**
   * Composite macro risk score 0–1 from external risk model.
   * >=0.85 triggers hard lockout regardless of other inputs.
   */
  macroRiskScore: number;
  /** Asset class being traded — weights differ significantly */
  assetClass: AssetClass;
  /** The intended trade direction being evaluated */
  intendedDirection: "long" | "short";
}

export interface MacroBiasResult {
  /** Categorical bias label */
  bias: MacroBiasStrength;
  /** Derived dominant direction */
  direction: MacroBiasDirection;
  /** Composite score 0–1, 0.5 = neutral */
  score: number;
  /** Conviction level driven by magnitude from 0.5 */
  conviction: MacroConviction;
  /** Whether the intended direction is aligned with macro bias */
  aligned: boolean;
  /** Reasons explaining the bias */
  reasons: string[];
  /** Directions currently blocked by macro conviction */
  blockedDirections: MacroBiasDirection[];
  /** Macro is a tailwind for the asset */
  tailwind: boolean;
  /** Macro is a headwind for the asset */
  headwind: boolean;
  /** ISO timestamp of computation */
  updatedAt: string;
}

// ─── Asset-class weights ──────────────────────────────────────────────────────

interface AssetWeights {
  dxy: number;
  rate: number;
  cpi: number;
  vix: number;
}

const ASSET_WEIGHTS: Record<AssetClass, AssetWeights> = {
  forex:     { dxy: 0.40, rate: 0.30, cpi: 0.20, vix: 0.10 },
  equity:    { dxy: 0.20, rate: 0.25, cpi: 0.25, vix: 0.30 },
  commodity: { dxy: 0.35, rate: 0.15, cpi: 0.35, vix: 0.15 },
  crypto:    { dxy: 0.15, rate: 0.10, cpi: 0.10, vix: 0.65 },
};

// ─── Scoring helpers ──────────────────────────────────────────────────────────

/**
 * Maps DXY slope to a 0–1 component score.
 * Rising DXY (positive slope) is bearish for non-USD risk assets (crypto, commodities, some EM forex).
 * We invert so that score > 0.5 means bullish (low DXY pressure).
 */
function scoreDxy(slope: number, assetClass: AssetClass): number {
  // For USD-denominated assets: strong DXY = headwind
  // clamped slope range: ±0.05
  const clamped = Math.max(-0.05, Math.min(0.05, slope));
  const raw = (clamped + 0.05) / 0.10; // 0 (dxy falling hard = bullish) to 1 (rising hard = bearish)

  // Forex: if pair is USD/XXX the interpretation inverts; we assume risk-on bias (non-USD)
  // For crypto/commodity: rising DXY hurts → bearish → invert
  if (assetClass === "equity") {
    // Equity is mixed — moderate DXY is neutral; extreme rises hurt
    return 1 - raw * 0.8;
  }
  return 1 - raw; // rising DXY → lower score (bearish for asset)
}

/**
 * Rate differential score. Positive bps (asset yields more than USD) = bullish.
 * Clamped range: ±200bps
 */
function scoreRateDiff(bps: number): number {
  const clamped = Math.max(-200, Math.min(200, bps));
  return (clamped + 200) / 400; // 0 = very negative → bearish, 1 = very positive → bullish
}

/**
 * CPI momentum score. Accelerating inflation is bearish for equities/bonds,
 * mixed for crypto, and bearish for rate-sensitive assets.
 * We model it as: decelerating CPI (negative momentum) = bullish.
 * Clamped range: ±0.5 (percentage point change in YoY CPI)
 */
function scoreCpi(momentum: number, assetClass: AssetClass): number {
  const clamped = Math.max(-0.5, Math.min(0.5, momentum));
  const raw = (clamped + 0.5) / 1.0; // 0 = decelerating → bullish, 1 = accelerating → bearish

  // Commodities can benefit from inflation — reverse
  if (assetClass === "commodity") return raw;
  return 1 - raw;
}

/**
 * VIX score. High VIX = risk-off = bearish for risk assets (crypto, equity).
 * Thresholds: <15 low, 15-20 normal, 20-30 elevated, >30 extreme
 */
function scoreVix(vixLevel: number, assetClass: AssetClass): number {
  // Normalise VIX to a 0–1 fear score (1 = extreme fear)
  const fearScore = Math.min(1, Math.max(0, (vixLevel - 10) / 40)); // 10→0, 50→1

  if (assetClass === "commodity") {
    // Some commodities benefit from flight-to-safety (gold) — partial inversion
    return 0.5 + (1 - fearScore - 0.5) * 0.5;
  }
  return 1 - fearScore; // higher fear = lower score = bearish
}

// ─── Main computation ─────────────────────────────────────────────────────────

export function computeMacroBias(input: MacroBiasInput): MacroBiasResult {
  const {
    dxySlope,
    rateDifferentialBps,
    cpiMomentum,
    vixLevel,
    macroRiskScore,
    assetClass,
    intendedDirection,
  } = input;

  const now = new Date().toISOString();
  const reasons: string[] = [];

  // ── Hard lockout: extreme macro risk ──
  if (macroRiskScore >= 0.85) {
    reasons.push(`Macro risk score ${macroRiskScore.toFixed(2)} ≥ 0.85 — hard lockout`);
    return {
      bias: "strong_sell",
      direction: "flat",
      score: 0,
      conviction: "high",
      aligned: false,
      reasons,
      blockedDirections: ["long", "short"],
      tailwind: false,
      headwind: true,
      updatedAt: now,
    };
  }

  // ── Compute component scores ──
  const w = ASSET_WEIGHTS[assetClass];
  const dxyScore  = scoreDxy(dxySlope, assetClass);
  const rateScore = scoreRateDiff(rateDifferentialBps);
  const cpiScore  = scoreCpi(cpiMomentum, assetClass);
  const vixScore  = scoreVix(vixLevel, assetClass);

  const composite = (
    dxyScore  * w.dxy +
    rateScore * w.rate +
    cpiScore  * w.cpi +
    vixScore  * w.vix
  );

  // ── Build reason strings ──
  if (dxySlope > 0.01)  reasons.push(`DXY rising (slope ${dxySlope.toFixed(3)}) — headwind`);
  if (dxySlope < -0.01) reasons.push(`DXY falling (slope ${dxySlope.toFixed(3)}) — tailwind`);
  if (rateDifferentialBps > 50)  reasons.push(`Rate diff +${rateDifferentialBps}bps — favourable carry`);
  if (rateDifferentialBps < -50) reasons.push(`Rate diff ${rateDifferentialBps}bps — negative carry`);
  if (cpiMomentum > 0.1)  reasons.push(`CPI accelerating (${cpiMomentum.toFixed(2)}) — inflation risk`);
  if (cpiMomentum < -0.1) reasons.push(`CPI decelerating (${cpiMomentum.toFixed(2)}) — easing tailwind`);
  if (vixLevel > 30)  reasons.push(`VIX elevated at ${vixLevel.toFixed(1)} — risk-off environment`);
  if (vixLevel < 15)  reasons.push(`VIX low at ${vixLevel.toFixed(1)} — risk-on regime`);
  if (macroRiskScore > 0.6) reasons.push(`Macro risk score ${macroRiskScore.toFixed(2)} — elevated caution`);
  if (reasons.length === 0) reasons.push("Macro conditions neutral — no dominant bias");

  // ── Derive bias label ──
  let bias: MacroBiasStrength;
  if      (composite >= 0.75) bias = "strong_buy";
  else if (composite >= 0.60) bias = "buy";
  else if (composite >= 0.40) bias = "neutral";
  else if (composite >= 0.25) bias = "sell";
  else                        bias = "strong_sell";

  // ── Derive direction and conviction ──
  let direction: MacroBiasDirection;
  const deviation = Math.abs(composite - 0.5);

  let conviction: MacroConviction;
  if      (deviation >= 0.20) conviction = "high";
  else if (deviation >= 0.10) conviction = "medium";
  else                        conviction = "low";

  if      (composite >= 0.55) direction = "long";
  else if (composite <= 0.45) direction = "short";
  else                        direction = "flat";

  // ── Blocked directions: only at high conviction ──
  const blockedDirections: MacroBiasDirection[] = [];
  if (conviction === "high") {
    if (direction === "long")  blockedDirections.push("short");
    if (direction === "short") blockedDirections.push("long");
    if (direction === "flat")  { blockedDirections.push("long"); blockedDirections.push("short"); }
  }

  const tailwind = composite >= 0.60 && intendedDirection === "long"  ||
                   composite <= 0.40 && intendedDirection === "short";
  const headwind = composite <= 0.40 && intendedDirection === "long"  ||
                   composite >= 0.60 && intendedDirection === "short";

  const aligned = !blockedDirections.includes(intendedDirection) &&
                  (direction === intendedDirection || direction === "flat");

  return {
    bias,
    direction,
    score: Math.round(composite * 1000) / 1000,
    conviction,
    aligned,
    reasons,
    blockedDirections,
    tailwind,
    headwind,
    updatedAt: now,
  };
}

/**
 * Returns a fully neutral macro bias result — used when macro data is unavailable
 * or when running in replay mode where macro context should not block trades.
 */
export function neutralMacroBias(): MacroBiasResult {
  return {
    bias: "neutral",
    direction: "flat",
    score: 0.5,
    conviction: "low",
    aligned: true,
    reasons: ["No macro data — neutral placeholder"],
    blockedDirections: [],
    tailwind: false,
    headwind: false,
    updatedAt: new Date().toISOString(),
  };
}
