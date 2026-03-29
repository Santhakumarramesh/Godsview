import type { C4Category } from "./types";

export type MarketRegimeClass =
  | "trend_day"
  | "mean_reversion_day"
  | "breakout_expansion"
  | "chop_low_edge"
  | "news_distorted";

export interface RegimeEngineInput {
  baseRegime?: string;
  atrPct?: number;
  trendSlope5m?: number;
  directionalPersistence?: number;
  newsLockoutActive?: boolean;
}

export interface RegimeEngineOutput {
  regimeClass: MarketRegimeClass;
  confidence: number;
  reason: string;
  allowsCategories: C4Category[];
}

const ALLOWED_BY_CLASS: Record<MarketRegimeClass, C4Category[]> = {
  trend_day: ["continuation", "breakout"],
  mean_reversion_day: ["reversal", "trap"],
  breakout_expansion: ["breakout", "continuation"],
  chop_low_edge: [],
  news_distorted: [],
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeRegime(value: string | undefined): string {
  return String(value ?? "ranging").trim().toLowerCase();
}

export function classifyMarketRegime(input: RegimeEngineInput): RegimeEngineOutput {
  if (input.newsLockoutActive) {
    return {
      regimeClass: "news_distorted",
      confidence: 0.98,
      reason: "news_lockout_active",
      allowsCategories: ALLOWED_BY_CLASS.news_distorted,
    };
  }

  const base = normalizeRegime(input.baseRegime);
  const atrPct = Math.max(0, Number(input.atrPct ?? 0));
  const slope = Number(input.trendSlope5m ?? 0);
  const persistence = clamp01(Number(input.directionalPersistence ?? 0.5));
  const absSlope = Math.abs(slope);

  if (base.includes("chop") || (persistence < 0.44 && atrPct < 0.0038)) {
    return {
      regimeClass: "chop_low_edge",
      confidence: clamp01(0.65 + (0.5 - persistence) * 0.4),
      reason: "low_directional_edge",
      allowsCategories: ALLOWED_BY_CLASS.chop_low_edge,
    };
  }

  if (base.includes("volatile") || (atrPct > 0.009 && persistence >= 0.48)) {
    return {
      regimeClass: "breakout_expansion",
      confidence: clamp01(0.62 + Math.min(atrPct / 0.02, 0.28)),
      reason: "volatility_expansion",
      allowsCategories: ALLOWED_BY_CLASS.breakout_expansion,
    };
  }

  if (base.includes("trend") || (persistence > 0.62 && absSlope > 0.0006)) {
    return {
      regimeClass: "trend_day",
      confidence: clamp01(0.6 + (persistence - 0.5) * 0.7),
      reason: "persistent_directional_flow",
      allowsCategories: ALLOWED_BY_CLASS.trend_day,
    };
  }

  return {
    regimeClass: "mean_reversion_day",
    confidence: clamp01(0.58 + (0.62 - persistence) * 0.35),
    reason: base.includes("ranging") ? "range_regime_detected" : "balanced_flow_default",
    allowsCategories: ALLOWED_BY_CLASS.mean_reversion_day,
  };
}

export function isCategoryAllowedInRegime(
  category: C4Category,
  regimeClass: MarketRegimeClass,
): boolean {
  return ALLOWED_BY_CLASS[regimeClass].includes(category);
}

