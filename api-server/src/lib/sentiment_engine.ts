/**
 * sentiment_engine.ts — Retail vs Institutional Sentiment Scorer
 *
 * Contract:
 * - sentimentScore is normalized to [0, 1]
 * - 0.5 is neutral
 * - high score => retail long crowding (fade_long edge)
 * - low score  => retail short crowding (fade_short edge)
 */

import { logger } from "./logger";

export type RetailBias = "long_crowded" | "short_crowded" | "balanced";
export type InstitutionalEdge = "fade_long" | "fade_short" | "none";
export type CrowdingLevel = "extreme" | "high" | "moderate" | "low";

export interface SentimentInput {
  retailLongRatio: number;
  priceTrendSlope: number;
  cvdNet: number;
  openInterestChange: number;
  fundingRate: number;
  intendedDirection: "long" | "short";
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

const EXTREME_THRESHOLD = 0.80;
const HIGH_THRESHOLD = 0.75;
const MODERATE_THRESHOLD = 0.60;

const EDGE_HIGH_THRESHOLD = 0.68;
const EDGE_LOW_THRESHOLD = 0.32;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function crowdingLevel(ratio: number): CrowdingLevel {
  const dominant = Math.max(ratio, 1 - ratio);
  if (dominant >= EXTREME_THRESHOLD) return "extreme";
  if (dominant >= HIGH_THRESHOLD) return "high";
  if (dominant >= MODERATE_THRESHOLD) return "moderate";
  return "low";
}

function trendScore(priceTrendSlope: number): number {
  const slope = clamp(priceTrendSlope, -0.05, 0.05);
  return clamp01(0.5 + slope / 0.1);
}

function fundingScore(rate: number, assetClass: SentimentInput["assetClass"]): number {
  if (assetClass !== "crypto") return 0.5;
  const clamped = clamp(rate, -0.002, 0.002);
  return clamp01(0.5 + clamped / 0.004);
}

function oiScore(openInterestChange: number): number {
  const clamped = clamp(openInterestChange, -0.20, 0.20);
  return clamp01(0.5 + clamped / 0.40);
}

function cvdScore(cvdNet: number): number {
  const clamped = clamp(cvdNet, -1e7, 1e7);
  return clamp01(0.5 + clamped / 2e7);
}

export function computeSentiment(input: SentimentInput): SentimentResult {
  const reasons: string[] = [];
  const longRatio = clamp01(input.retailLongRatio);
  const shortRatio = 1 - longRatio;

  const positioning = longRatio;
  const trend = trendScore(input.priceTrendSlope);
  const funding = fundingScore(input.fundingRate, input.assetClass);
  const oi = oiScore(input.openInterestChange);
  const cvd = cvdScore(input.cvdNet);

  const sentimentScore = clamp01(
    positioning * 0.45 +
    trend * 0.20 +
    funding * 0.15 +
    oi * 0.10 +
    cvd * 0.10,
  );

  const crowding = crowdingLevel(longRatio);
  const retailBias: RetailBias =
    longRatio >= MODERATE_THRESHOLD
      ? "long_crowded"
      : shortRatio >= MODERATE_THRESHOLD
        ? "short_crowded"
        : "balanced";

  const institutionalEdge: InstitutionalEdge =
    sentimentScore >= EDGE_HIGH_THRESHOLD
      ? "fade_long"
      : sentimentScore <= EDGE_LOW_THRESHOLD
        ? "fade_short"
        : "none";

  const aligned =
    institutionalEdge === "none"
      ? true
      : (institutionalEdge === "fade_long" && input.intendedDirection === "short") ||
        (institutionalEdge === "fade_short" && input.intendedDirection === "long");

  const contrarian = aligned && institutionalEdge !== "none";

  if (crowding === "extreme") {
    reasons.push(`Retail positioning is extreme (${(longRatio * 100).toFixed(0)}% long)`);
  } else if (crowding === "high") {
    reasons.push(`Retail positioning is elevated (${(longRatio * 100).toFixed(0)}% long)`);
  }

  if (Math.abs(trend - 0.5) > 0.15) {
    reasons.push(`Price trend ${(trend > 0.5 ? "up" : "down")} momentum is material`);
  }
  if (input.assetClass === "crypto" && Math.abs(funding - 0.5) > 0.1) {
    reasons.push(`Funding pressure is ${(funding > 0.5 ? "long-crowded" : "short-crowded")}`);
  }
  if (Math.abs(oi - 0.5) > 0.1) {
    reasons.push("Open interest change confirms directional participation");
  }
  if (Math.abs(cvd - 0.5) > 0.1) {
    reasons.push("CVD flow is materially imbalanced");
  }

  if (institutionalEdge !== "none") {
    reasons.push(`Institutional edge detected: ${institutionalEdge}`);
    if (!aligned) {
      reasons.push(`Intended ${input.intendedDirection} setup conflicts with institutional edge`);
    }
  }

  if (reasons.length === 0) {
    reasons.push("Sentiment is balanced with no strong crowding signal");
  }

  logger.debug(
    {
      retailBias,
      institutionalEdge,
      sentimentScore: sentimentScore.toFixed(3),
      crowding,
      aligned,
      contrarian,
    },
    "[Sentiment] Computed",
  );

  return {
    retailBias,
    institutionalEdge,
    sentimentScore,
    crowdingLevel: crowding,
    aligned,
    contrarian,
    reasons,
    updatedAt: new Date().toISOString(),
  };
}

export function neutralSentiment(): SentimentResult {
  return {
    retailBias: "balanced",
    institutionalEdge: "none",
    sentimentScore: 0.5,
    crowdingLevel: "low",
    aligned: true,
    contrarian: false,
    reasons: ["No sentiment data available — defaulting to balanced"],
    updatedAt: new Date().toISOString(),
  };
}
