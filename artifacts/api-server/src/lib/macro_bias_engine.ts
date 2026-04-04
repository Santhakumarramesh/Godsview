/**
 * macro_bias_engine.ts — Institutional Macro Bias Scorer
 *
 * Contract:
 * - score is normalized to [0, 1]
 * - 0.5 is neutral, >0.5 bullish, <0.5 bearish
 * - conviction derives from |score - 0.5|
 */

import { logger } from "./logger";

export type MacroBiasDirection = "long" | "short" | "flat";
export type MacroBiasLabel = "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell";
export type ConvictionLevel = "high" | "medium" | "low";

export interface MacroBiasInput {
  dxySlope: number;
  rateDifferentialBps: number;
  cpiMomentum: number;
  vixLevel: number;
  macroRiskScore: number;
  assetClass: "crypto" | "forex" | "equity" | "commodity";
  intendedDirection: "long" | "short";
}

export interface MacroBiasResult {
  bias: MacroBiasLabel;
  direction: MacroBiasDirection;
  score: number;
  conviction: ConvictionLevel;
  aligned: boolean;
  reasons: string[];
  blockedDirections: MacroBiasDirection[];
  tailwind: boolean;
  headwind: boolean;
  updatedAt: string;
}

const WEIGHTS: Record<MacroBiasInput["assetClass"], { dxy: number; rate: number; cpi: number; vix: number }> = {
  forex: { dxy: 0.40, rate: 0.30, cpi: 0.20, vix: 0.10 },
  crypto: { dxy: 0.15, rate: 0.10, cpi: 0.10, vix: 0.65 },
  equity: { dxy: 0.20, rate: 0.25, cpi: 0.25, vix: 0.30 },
  commodity: { dxy: 0.25, rate: 0.15, cpi: 0.35, vix: 0.25 },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function scoreDxy(slope: number, assetClass: MacroBiasInput["assetClass"]): number {
  const scale = assetClass === "equity" ? 0.08 : 0.05;
  const norm = clamp(slope, -scale, scale) / scale; // [-1, 1]
  if (assetClass === "forex") {
    return clamp01(0.5 + norm / 2);
  }
  return clamp01(0.5 - norm / 2);
}

function scoreRateDiff(bps: number): number {
  const norm = clamp(bps, -200, 200) / 200;
  return clamp01(0.5 + norm / 2);
}

function scoreCpi(delta: number, assetClass: MacroBiasInput["assetClass"]): number {
  const norm = clamp(delta, -0.5, 0.5) / 0.5;
  if (assetClass === "commodity") {
    return clamp01(0.5 + norm / 2);
  }
  return clamp01(0.5 - norm / 2);
}

function scoreVix(vix: number): number {
  const clamped = clamp(vix, 10, 50);
  return clamp01(1 - (clamped - 10) / 40);
}

export function computeMacroBias(input: MacroBiasInput): MacroBiasResult {
  const reasons: string[] = [];
  const blockedDirections: MacroBiasDirection[] = [];

  if (input.macroRiskScore >= 0.85) {
    reasons.push(`Macro lockout active (risk=${input.macroRiskScore.toFixed(2)})`);
    return {
      bias: "neutral",
      direction: "flat",
      score: 0,
      conviction: "high",
      aligned: false,
      reasons,
      blockedDirections: ["long", "short"],
      tailwind: false,
      headwind: true,
      updatedAt: new Date().toISOString(),
    };
  }

  const weights = WEIGHTS[input.assetClass];
  const dxy = scoreDxy(input.dxySlope, input.assetClass);
  const rate = scoreRateDiff(input.rateDifferentialBps);
  const cpi = scoreCpi(input.cpiMomentum, input.assetClass);
  const vix = scoreVix(input.vixLevel);

  const score = clamp01(
    dxy * weights.dxy +
    rate * weights.rate +
    cpi * weights.cpi +
    vix * weights.vix,
  );

  if (Math.abs(dxy - 0.5) > 0.1) {
    reasons.push(`DXY is ${(dxy > 0.5 ? "supportive" : "adverse")} for ${input.assetClass}`);
  }
  if (Math.abs(rate - 0.5) > 0.1) {
    reasons.push(`Rate differential is ${(rate > 0.5 ? "favorable" : "unfavorable")}`);
  }
  if (Math.abs(cpi - 0.5) > 0.1) {
    reasons.push(`CPI momentum is ${(cpi > 0.5 ? "supportive" : "headwind")}`);
  }
  if (input.vixLevel >= 30) {
    reasons.push(`VIX elevated at ${input.vixLevel}`);
  } else if (input.vixLevel <= 15) {
    reasons.push(`VIX low at ${input.vixLevel}`);
  }

  let bias: MacroBiasLabel;
  let direction: MacroBiasDirection;
  if (score >= 0.80) {
    bias = "strong_buy";
    direction = "long";
  } else if (score >= 0.60) {
    bias = "buy";
    direction = "long";
  } else if (score <= 0.20) {
    bias = "strong_sell";
    direction = "short";
  } else if (score <= 0.40) {
    bias = "sell";
    direction = "short";
  } else {
    bias = "neutral";
    direction = "flat";
  }

  const deviation = Math.abs(score - 0.5);
  const conviction: ConvictionLevel =
    deviation >= 0.20 ? "high" : deviation >= 0.10 ? "medium" : "low";

  const aligned = direction === "flat" ? true : direction === input.intendedDirection;

  if (conviction === "high") {
    if (direction === "long") blockedDirections.push("short");
    if (direction === "short") blockedDirections.push("long");
    if (!aligned) {
      reasons.push(`Counter-macro direction detected (intent=${input.intendedDirection}, macro=${direction})`);
    }
  }

  if (reasons.length === 0) {
    reasons.push("Macro inputs are balanced");
  }

  const tailwind = direction !== "flat" && aligned;
  const headwind = direction !== "flat" && !aligned;

  logger.debug(
    {
      assetClass: input.assetClass,
      bias,
      direction,
      score: score.toFixed(3),
      conviction,
      aligned,
    },
    "[MacroBias] Computed",
  );

  return {
    bias,
    direction,
    score,
    conviction,
    aligned,
    reasons,
    blockedDirections,
    tailwind,
    headwind,
    updatedAt: new Date().toISOString(),
  };
}

export function neutralMacroBias(): MacroBiasResult {
  return {
    bias: "neutral",
    direction: "flat",
    score: 0.5,
    conviction: "low",
    aligned: true,
    reasons: ["No macro data available — defaulting to neutral"],
    blockedDirections: [],
    tailwind: false,
    headwind: false,
    updatedAt: new Date().toISOString(),
  };
}
