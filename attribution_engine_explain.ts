/**
 * attribution_engine_explain.ts — Return Attribution and Factor Analysis
 *
 * Deep decomposition of trading returns to identify true sources of edge:
 *   - Brinson attribution: decompose return by setup type, regime, symbol, session
 *   - Skill vs luck separation: t-statistics, p-values, bootstrap confidence intervals
 *   - Factor contribution: which factors (volatility, trend, regime) drive returns
 *   - Entry vs exit quality attribution
 *   - Time-based attribution: intraday patterns, day-of-week effects
 *
 * Uses real statistical methods (not hand-waving):
 *   - T-tests to measure significance
 *   - Bootstrap resampling for confidence intervals
 *   - Regime decomposition based on market conditions
 */

import { logger } from "../logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AttributionComponent {
  type: string; // "setupType", "regime", "symbol", "session", "dayOfWeek"
  category: string; // e.g., "Breakout", "Trending Up", "SPY", "Asia", "Monday"
  return: number;
  count: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
}

export interface AttributionReport {
  totalReturn: number;
  totalTrades: number;

  // By source
  bySetupType: AttributionComponent[];
  byRegime: AttributionComponent[];
  bySession: AttributionComponent[];
  bySymbol: AttributionComponent[];
  byDayOfWeek: AttributionComponent[];

  // Skill decomposition
  alphaReturn: number; // excess return
  betaReturn: number; // market-correlated
  noiseReturn: number; // luck component

  // Key findings
  topContributor: { category: string; contribution: number; percentage: number };
  bottomContributor: { category: string; contribution: number; percentage: number };
  insights: string[];
}

export interface FactorAnalysisResult {
  factor: string;
  correlation: number;
  betaExposure: number;
  explanation: string;
  strength: "strong" | "moderate" | "weak" | "none";
}

export interface SkillLuckReport {
  totalReturn: number;
  estimatedSkill: number;
  estimatedLuck: number;
  skillPercentage: number;

  // Statistical tests
  tStatistic: number;
  pValue: number;
  isStatisticallySignificant: boolean;
  confidenceLevel: string; // "95%", "90%", or "not significant"

  // Bootstrap analysis
  bootstrapMedian: number;
  bootstrapCI95: [number, number]; // [lower, upper]
  bootstrapCI99: [number, number];
  percentBetterThanRandom: number; // 0-100

  explanation: string;
}

export interface RegimeAttributionReport {
  totalReturn: number;
  byRegime: Array<{
    regime: string;
    return: number;
    trades: number;
    winRate: number;
    bestRegime?: boolean;
    worstRegime?: boolean;
  }>;
  regimeExposure: Record<string, number>; // Time in each regime
  explanation: string;
}

export interface TemporalAttributionReport {
  byHour: Array<{
    hour: string; // "09:30-10:00"
    return: number;