/**
 * sentiment_engine.ts — Layer 0.5: Retail Sentiment Gate
 *
 * Implements Elliot Hewitt (YoungTraderWealth) 3-layer methodology — Layer 2:
 *   "When retail is extremely positioned on one side, institutions fade them.
 *    Avoid trading with the crowd at extremes — be the institution."
 *
 * Composite score 0–1 from:
 *   - Retail positioning (long ratio, funding rate)
 *   - Cumulative Volume Delta (CVD net direction)
 *   - Open Interest change (fuel for moves or exhaustion)
 *   - Price trend slope (confirmatory or divergent signal)
 *
 * A score > 0.65 = crowd is long-crowded → institutional edge is to fade longs.
 * A score < 0.35 = crowd is short-crowded → institutional edge is to fade shorts.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type RetailBias      = "long_crowded" | "short_crowded" | "balanced";
export type InstitutionalEdge = "fade_long" | "fade_short" | "none";
export type CrowdingLevel   = "extreme" | "high" | "moderate" | "low";

export interface SentimentInput {
  /**
   * Ratio of retail traders positioned long: 0–1.
   * e.g. 0.72 = 72% of retail accounts are long.
   * Sources: Alpaca, IG Client Sentiment, etc.
   */
  retailLongRatio: number;
  /**
   * Price trend slope over recent period as a decimal fraction.
   * Positive = price trending up, negative = down.
   * Used to determine if crowd is trend-following or counter-trend.
   */
  priceTrendSlope: number;
  /**
   * Net Cumulative Volume Delta over the session window.
   * Positive = net buying pressure, negative = net selling.
   */
  cvdNet: number;
  /**
   * Open Interest change as a decimal fraction (e.g. +0.05 = +5% OI).
   * Increasing OI with price rising = leveraged longs; with price falling = leveraged shorts.
   */
  openInterestChange: number;
  /**
   * Perpetual funding rate (annualised decimal, e.g. 0.0003 = 0.03% per 8h).
   * Positive = longs pay shorts = crowded long. Negative = shorts pay longs.
   */
  fundingRate: number;
  /** Direction the strategy wants to trade */
  intendedDirection: "long" | "short";
  /** Asset class — weights and thresholds vary */
  assetClass: "crypto" | "forex" | "equity" | "commodity";
}

export interface SentimentResult {
  /** Categorical label for the dominant retail bias */
  retailBias: RetailBias;
  /** Which side institutions have an edge fading */
  institutionalEdge: InstitutionalEdge;
  /**
   * Composite sentiment score 0–1.
   * >0.5 = net long sentiment; <0.5 = net short sentiment.
   */
  sentimentScore: number;
  /** Level of crowd concentration */
  crowdingLevel: CrowdingLevel;
  /** Whether the intended direction is aligned (not trading with the extreme crowd) */
  aligned: boolean;
  /** True when the intended trade is a contrarian institutional fade */
  contrarian: boolean;
  /** Reasons explaining the sentiment reading */
  reasons: string[];
  /** ISO timestamp of computation */
  updatedAt: string;
}

// ─── Thresholds ───────────────────────────────────────────────────────────────

const CROWDING = {
  extreme:  0.78,
  high:     0.68,
  moderate: 0.58,
} as const;

// ─── Component scorers ────────────────────────────────────────────────────────

/**
 * Retail long ratio component: 0.5 = neutral (50/50), 1 = fully long crowded
 * For short-crowding: ratio < 0.5 is bearish; inverted to 0 = fully short crowded
 * Returns: score where >0.5 = long bias, <0.5 = short bias
 */
function scorePositioning(longRatio: number): number {
  // Clamp to valid range
  return Math.max(0, Math.min(1, longRatio));
}

/**
 * Funding rate component (crypto-specific, but used universally).
 * Positive funding = longs crowded = bullish sentiment → high score
 * Clamped at ±0.002 (±0.2% per 8h, which is already extreme)
 */
function scoreFunding(fundingRate: number, assetClass: string): number {
  if (assetClass === "forex" || assetClass === "equity") {
    // Funding not directly applicable — neutral
    return 0.5;
  }
  const clamped = Math.max(-0.002, Math.min(0.002, fundingRate));
  return (clamped + 0.002) / 0.004; // 0 = very negative funding, 1 = very positive
}

/**
 * Price trend slope component — are retail traders trend-following at extremes?
 * When price is trending up AND crowd is heavily long = late trend buying = bearish signal.
 * We return how "trend-confirming" retail is (high = they are chasing the trend = bad).
 * Score >0.5 = crowd is chasing an uptrend (long crowded risk).
 */
function scoreTrend(slope: number): number {
  const clamped = Math.max(-0.05, Math.min(0.05, slope));
  return (clamped + 0.05) / 0.10; // 0 = strong down-trend, 1 = strong up-trend
}

/**
 * OI change component: rising OI in uptrend = leveraged long accumulation.
 * Positive OI change → higher score (more bullish crowding risk).
 * Clamped range: ±0.20 (±20% OI change)
 */
function scoreOI(oiChange: number): number {
  const clamped = Math.max(-0.20, Math.min(0.20, oiChange));
  return (clamped + 0.20) / 0.40;
}

/**
 * CVD net component: positive CVD = buy-side dominates.
 * We normalise against a typical session range of ±$10M notional equivalent.
 * For non-USD instruments or equity, scale accordingly.
 */
function scoreCvd(cvdNet: number): number {
  // Normalise: assume ±1e7 as reasonable session extremes
  const norm = cvdNet / 1e7;
  const clamped = Math.max(-1, Math.min(1, norm));
  return (clamped + 1) / 2; // 0 = strong sell CVD, 1 = strong buy CVD
}

// ─── Main computation ─────────────────────────────────────────────────────────

export function computeSentiment(input: SentimentInput): SentimentResult {
  const {
    retailLongRatio,
    priceTrendSlope,
    cvdNet,
    openInterestChange,
    fundingRate,
    intendedDirection,
    assetClass,
  } = input;

  const now = new Date().toISOString();
  const reasons: string[] = [];

  // ── Component scores ──
  const posScore     = scorePositioning(retailLongRatio);
  const trendScore   = scoreTrend(priceTrendSlope);
  const fundingScore = scoreFunding(fundingRate, assetClass);
  const oiScore      = scoreOI(openInterestChange);
  const cvdScore     = scoreCvd(cvdNet);

  // ── Composite: positioning dominates ──
  const composite =
    posScore     * 0.45 +
    trendScore   * 0.20 +
    fundingScore * 0.15 +
    oiScore      * 0.10 +
    cvdScore     * 0.10;

  // ── Crowding level based on distance from 0.5 ──
  const longPressure  = composite;
  const shortPressure = 1 - composite;
  const dominantPressure = Math.max(longPressure, shortPressure);

  let crowdingLevel: CrowdingLevel;
  if      (dominantPressure >= CROWDING.extreme)  crowdingLevel = "extreme";
  else if (dominantPressure >= CROWDING.high)     crowdingLevel = "high";
  else if (dominantPressure >= CROWDING.moderate) crowdingLevel = "moderate";
  else                                            crowdingLevel = "low";

  // ── Retail bias label ──
  let retailBias: RetailBias;
  if      (composite >= CROWDING.moderate) retailBias = "long_crowded";
  else if (composite <= 1 - CROWDING.moderate) retailBias = "short_crowded";
  else                                         retailBias = "balanced";

  // ── Institutional edge ──
  let institutionalEdge: InstitutionalEdge;
  if      (crowdingLevel === "extreme" || crowdingLevel === "high") {
    institutionalEdge = composite >= 0.5 ? "fade_long" : "fade_short";
  } else {
    institutionalEdge = "none";
  }

  // ── Build reasons ──
  if (retailLongRatio >= CROWDING.extreme) {
    reasons.push(`Retail ${(retailLongRatio * 100).toFixed(0)}% long — extreme crowding`);
  } else if (retailLongRatio <= 1 - CROWDING.extreme) {
    reasons.push(`Retail ${(retailLongRatio * 100).toFixed(0)}% long — extreme short crowding`);
  } else if (retailLongRatio >= 0.60) {
    reasons.push(`Retail ${(retailLongRatio * 100).toFixed(0)}% long — elevated long sentiment`);
  } else if (retailLongRatio <= 0.40) {
    reasons.push(`Retail ${(retailLongRatio * 100).toFixed(0)}% long — elevated short sentiment`);
  }

  if (fundingRate > 0.001)  reasons.push(`Funding rate +${(fundingRate * 100).toFixed(3)}% — longs paying premium`);
  if (fundingRate < -0.001) reasons.push(`Funding rate ${(fundingRate * 100).toFixed(3)}% — shorts paying premium`);
  if (openInterestChange > 0.08)  reasons.push(`OI rising +${(openInterestChange * 100).toFixed(1)}% — leveraged buildup`);
  if (openInterestChange < -0.08) reasons.push(`OI falling ${(openInterestChange * 100).toFixed(1)}% — deleveraging`);
  if (cvdNet > 5e6)  reasons.push(`CVD net +${(cvdNet / 1e6).toFixed(1)}M — buy side dominant`);
  if (cvdNet < -5e6) reasons.push(`CVD net ${(cvdNet / 1e6).toFixed(1)}M — sell side dominant`);

  if (institutionalEdge === "fade_long") {
    reasons.push("Institutional edge: fade crowded retail longs");
  } else if (institutionalEdge === "fade_short") {
    reasons.push("Institutional edge: fade crowded retail shorts");
  } else if (reasons.length === 0) {
    reasons.push("Retail sentiment balanced — no crowding signal");
  }

  // ── Alignment ──
  // Aligned = we are NOT trading with the crowd at extremes
  const tradingWithCrowd =
    (institutionalEdge === "fade_long"  && intendedDirection === "long") ||
    (institutionalEdge === "fade_short" && intendedDirection === "short");

  const contrarian =
    (institutionalEdge === "fade_long"  && intendedDirection === "short") ||
    (institutionalEdge === "fade_short" && intendedDirection === "long");

  const aligned = !tradingWithCrowd;

  return {
    retailBias,
    institutionalEdge,
    sentimentScore: Math.round(composite * 1000) / 1000,
    crowdingLevel,
    aligned,
    contrarian,
    reasons,
    updatedAt: now,
  };
}

/**
 * Returns a neutral sentiment result — used when sentiment data is unavailable
 * or when running in replay mode where sentiment should not block trades.
 */
export function neutralSentiment(): SentimentResult {
  return {
    retailBias: "balanced",
    institutionalEdge: "none",
    sentimentScore: 0.5,
    crowdingLevel: "low",
    aligned: true,
    contrarian: false,
    reasons: ["No sentiment data — neutral placeholder"],
    updatedAt: new Date().toISOString(),
  };
}
