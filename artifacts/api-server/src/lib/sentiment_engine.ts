/**
 * sentiment_engine.ts — Retail vs Institutional Sentiment Scorer
 *
 * Implements Elliot Hewitt's Layer 2 (YoungTraderWealth method):
 * "When 80% of retail traders are long, institutions are short.
 * Use retail positioning as a contrarian signal — fade the crowd."
 *
 * Inputs:
 *   1. Retail long ratio    — % of retail traders positioned long (e.g. 0.72 = 72% long)
 *   2. Price trend slope    — Is price going with or against retail?
 *   3. CVD divergence       — Cumulative Volume Delta diverging from retail direction?
 *   4. Open interest change — Rising OI with price = institutional accumulation
 *   5. Funding rate (crypto)— Positive = retail leaning long; negative = retail short
 *
 * Contrarian logic:
 *   - Retail >70% long  → institutional bias = SHORT → fade
 *   - Retail >70% short → institutional bias = LONG  → fade
 *   - Retail 40-60%     → no edge from sentiment alone
 *
 * Output:
 *   SentimentResult {
 *     retailBias: "long_crowded" | "short_crowded" | "balanced"
 *     institutionalEdge: "fade_long" | "fade_short" | "none"
 *     sentimentScore: number  (-1 short, 0 neutral, +1 long institutional)
 *     crowdingLevel: "extreme" | "high" | "moderate" | "low"
 *     aligned: boolean  (is intended direction aligned with institutional edge?)
 *     reasons: string[]
 *   }
 */

import { logger } from "./logger";

// ── Types ────────────────────────────────────────────────────────────────────

export type RetailBias = "long_crowded" | "short_crowded" | "balanced";
export type InstitutionalEdge = "fade_long" | "fade_short" | "none";
export type CrowdingLevel = "extreme" | "high" | "moderate" | "low";

export interface SentimentInput {
  /** Fraction of retail traders long (0–1). E.g. 0.72 = 72% long. */
  retailLongRatio: number;
  /** Price momentum slope over last 20 bars (positive = uptrend) */
  priceTrendSlope: number;
  /** CVD net delta over last 20 bars — positive = buy pressure */
  cvdNet: number;
  /**
   * Change in open interest over last session.
   * Positive + price up = accumulation (institutional long)
   * Positive + price down = distribution (institutional short)
   */
  openInterestChange: number;
  /**
   * Perpetual funding rate (crypto only, pass 0 for other assets).
   * Positive = longs paying shorts = retail crowded long.
   */
  fundingRate: number;
  /** Which direction the setup wants to trade */
  intendedDirection: "long" | "short";
  /** Asset class affects weighting of funding rate signal */
  assetClass: "crypto" | "forex" | "equity" | "commodity";
}

export interface SentimentResult {
  retailBias: RetailBias;
  institutionalEdge: InstitutionalEdge;
  sentimentScore: number;
  crowdingLevel: CrowdingLevel;
  aligned: boolean;
  contrarian: boolean;
  reasons: string[];
  updatedAt: string;
}

// ── Crowding thresholds ───────────────────────────────────────────────────────

const EXTREME_THRESHOLD = 0.78;
const HIGH_THRESHOLD    = 0.68;
const MODERATE_THRESHOLD = 0.58;

// ── Helpers ──────────────────────────────────────────────────────────────────

function crowdingLevel(ratio: number): CrowdingLevel {
  const r = ratio > 0.5 ? ratio : 1 - ratio; // distance from 50%
  if (r >= EXTREME_THRESHOLD)  return "extreme";
  if (r >= HIGH_THRESHOLD)     return "high";
  if (r >= MODERATE_THRESHOLD) return "moderate";
  return "low";
}

/**
 * Funding rate to contrarian score (crypto only).
 * Positive funding = retail long crowded → institutional short → score -1
 */
function fundingScore(rate: number, assetClass: string): number {
  if (assetClass !== "crypto") return 0;
  // Typical funding: -0.01% to +0.03% per 8h. Cap at ±0.05%.
  return -Math.max(-1, Math.min(1, rate / 0.0005));
}

/** CVD confirmation: does institutional flow confirm or contradict setup? */
function cvdAlignmentScore(cvdNet: number, direction: "long" | "short"): number {
  const normalised = Math.max(-1, Math.min(1, cvdNet / 10_000));
  return direction === "long" ? normalised : -normalised;
}

// ── Main scorer ──────────────────────────────────────────────────────────────

export function computeSentiment(input: SentimentInput): SentimentResult {
  const reasons: string[] = [];
  const longRatio = Math.max(0, Math.min(1, input.retailLongRatio));
  const shortRatio = 1 - longRatio;

  // ── 1. Retail positioning signal ─────────────────────────────────────────
  let positioningScore = 0; // +1 = institutions long, -1 = institutions short
  const crowding = crowdingLevel(longRatio);

  if (longRatio >= MODERATE_THRESHOLD) {
    // Retail crowded long → institutions likely SHORT
    const intensity = (longRatio - 0.5) / 0.5;
    positioningScore = -intensity;
    reasons.push(`Retail ${(longRatio * 100).toFixed(0)}% long — crowd fading signal (institutional SHORT)`);
  } else if (shortRatio >= MODERATE_THRESHOLD) {
    // Retail crowded short → institutions likely LONG
    const intensity = (shortRatio - 0.5) / 0.5;
    positioningScore = intensity;
    reasons.push(`Retail ${(shortRatio * 100).toFixed(0)}% short — crowd fading signal (institutional LONG)`);
  }

  // ── 2. Price trend vs retail positioning ─────────────────────────────────
  // "Retail chases price" pattern: if price is going up and retail is still
  // holding shorts, the move is institutional and will continue.
  let trendConfirmScore = 0;
  if (input.priceTrendSlope > 0.002 && longRatio < 0.45) {
    trendConfirmScore = 0.3;
    reasons.push("Price rising against retail shorts — institutional accumulation pattern");
  } else if (input.priceTrendSlope < -0.002 && longRatio > 0.55) {
    trendConfirmScore = -0.3;
    reasons.push("Price falling against retail longs — institutional distribution pattern");
  }

  // ── 3. Funding rate (crypto) ──────────────────────────────────────────────
  const funding = fundingScore(input.fundingRate, input.assetClass);
  if (Math.abs(funding) > 0.2 && input.assetClass === "crypto") {
    reasons.push(`Funding rate ${(input.fundingRate * 10000).toFixed(1)}bps — ${input.fundingRate > 0 ? "longs paying (crowded)" : "shorts paying (crowded)"}`);
  }

  // ── 4. Open interest confirmation ────────────────────────────────────────
  let oiScore = 0;
  if (input.openInterestChange > 0 && input.priceTrendSlope > 0) {
    oiScore = 0.2;  // New money coming in on upside = institutional long
    reasons.push("OI rising with price — new institutional longs entering");
  } else if (input.openInterestChange > 0 && input.priceTrendSlope < 0) {
    oiScore = -0.2; // New money on downside = institutional short
    reasons.push("OI rising on decline — institutional shorts building");
  }

  // ── 5. CVD alignment ─────────────────────────────────────────────────────
  const cvdConf = cvdAlignmentScore(input.cvdNet, input.intendedDirection);
  if (Math.abs(cvdConf) > 0.3) {
    reasons.push(`CVD ${input.cvdNet > 0 ? "net buy" : "net sell"} pressure ${cvdConf > 0 ? "confirms" : "contradicts"} ${input.intendedDirection} thesis`);
  }

  // ── Composite ────────────────────────────────────────────────────────────
  const sentimentScore = Math.max(-1, Math.min(1,
    positioningScore * 0.45 +
    trendConfirmScore * 0.20 +
    funding           * 0.15 +
    oiScore           * 0.10 +
    cvdConf           * 0.10
  ));

  // ── Derive labels ─────────────────────────────────────────────────────────
  const retailBias: RetailBias =
    longRatio >= MODERATE_THRESHOLD  ? "long_crowded"  :
    shortRatio >= MODERATE_THRESHOLD ? "short_crowded" : "balanced";

  const institutionalEdge: InstitutionalEdge =
    sentimentScore <= -0.25 ? "fade_long"  :
    sentimentScore >= 0.25  ? "fade_short" : "none";

  // "aligned" = institutional edge agrees with intended direction
  const aligned =
    institutionalEdge === "none" ? true :
    institutionalEdge === "fade_short" && input.intendedDirection === "long"  ? true :
    institutionalEdge === "fade_long"  && input.intendedDirection === "short" ? true :
    false;

  const contrarian = !aligned && institutionalEdge !== "none";
  if (contrarian) {
    reasons.push(`⚠ Intended ${input.intendedDirection} trades AGAINST institutional edge (${institutionalEdge})`);
  }

  logger.debug({ retailBias, institutionalEdge, sentimentScore: sentimentScore.toFixed(3), crowding }, "[Sentiment] Computed");

  return {
    retailBias, institutionalEdge, sentimentScore,
    crowdingLevel: crowding, aligned, contrarian, reasons,
    updatedAt: new Date().toISOString(),
  };
}

// ── Default neutral ───────────────────────────────────────────────────────────

export function neutralSentiment(): SentimentResult {
  return {
    retailBias: "balanced", institutionalEdge: "none", sentimentScore: 0,
    crowdingLevel: "low", aligned: true, contrarian: false,
    reasons: ["No sentiment data available — defaulting to balanced"],
    updatedAt: new Date().toISOString(),
  };
}
