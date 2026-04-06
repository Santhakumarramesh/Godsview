/**
 * regime_validator.ts — Market Regime Analysis and Conditional Performance
 *
 * Analyze strategy performance across market regimes:
 *   - Segment results by market regime (trend, range, volatile, choppy)
 *   - Per-regime performance metrics and win rates
 *   - Regime transition impact analysis
 *   - Regime-conditional risk metrics
 *   - Identify regime bias (e.g., "only works in trending markets")
 *   - Regime distribution mismatch warnings
 *   - Regime consistency scoring
 *
 * Prevents regime-dependent curve-fitting and false backtest results.
 */

import { logger } from "../logger";
import { TradeOutcome } from "../backtest_engine";

export type MarketRegime = "trending_bull" | "trending_bear" | "range" | "volatile" | "choppy" | "unknown";

export interface RegimeSegment {
  regime: MarketRegime;
  trades: TradeOutcome[];
  count: number;
  wins: number;
  losses: number;
  winRate: number;
  avgR: number;
  profitFactor: number;
  maxDrawdown: number;
  expectancy: number;
  sharpeRatio: number;
}

export interface RegimeTransition {
  from: MarketRegime;
  to: MarketRegime;
  occurrences: number;
  successRate: number;
  avgTradeCount: number;
  notes: string;
}

export interface RegimeProfile {
  regime: MarketRegime;
  prevalence: number;
  profitability: number;
  consistency: number;
  riskAdjustedReturn: number;
  recommendation: "strong" | "acceptable" | "weak" | "avoid";
}

export interface RegimeValidation {
  segments: RegimeSegment[];
  transitions: RegimeTransition[];
  profiles: RegimeProfile[];
  bias: {
    hasBias: boolean;
    biasToward: MarketRegime | null;
    severity: "none" | "mild" | "moderate" | "severe";
    description: string;
  };
  consistency: {
    score: number;
    regimesPerformed: number;
    totalRegimes: number;
  };
}

export class RegimeValidator {
  segmentByRegime(trades: TradeOutcome[]): RegimeSegment[] {
    const segments = new Map<MarketRegime, TradeOutcome[]>();

    for (const trade of trades) {
      const regime = (trade.entryRegime as MarketRegime) || "unknown";
      if (!segments.has(regime)) {
        segments.set(regime, []);
      }
      segments.get(regime)!.push(trade);
    }

    const results: RegimeSegment[] = [];

    for (const [regime, tradeList] of segments.entries()) {
      if (tradeList.length === 0) continue;

      const wins = tradeList.filter((t) => t.won).length;
      const losses = tradeList.length - wins;
      const winRate = wins / tradeList.length;
      const avgR = tradeList.reduce((sum, t) => sum + t.pnlR, 0) / tradeList.length;
      const grossWins = tradeList.filter((t) => t.won).reduce((sum, t) => sum + Math.abs(t.pnlPrice), 0);
      const grossLosses = tradeList.filter((t) => !t.won).reduce((sum, t) => sum + Math.abs(t.pnlPrice), 0);
      const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 999 : 1;
      const drawdowns = this.computeDrawdowns(tradeList);
      const maxDrawdown = drawdowns.length > 0 ? Math.max(...drawdowns) : 0;
      const expectancy = winRate * (avgR > 0 ? avgR : 0) + (1 - winRate) * (avgR < 0 ? avgR : 0);
      const sharpeRatio = this.computeSharpeRatio(tradeList);

      results.push({
        regime,
        trades: tradeList,
        count: tradeList.length,
        wins,
        losses,
        winRate,
        avgR,
        profitFactor,
        maxDrawdown,
        expectancy,
        sharpeRatio,
      });
    }

    return results.sort((a, b) => b.count - a.count);
  }

  analyzeTransitions(trades: TradeOutcome[]): RegimeTransition[] {
    if (trades.length < 2) return [];

    const transitions = new Map<string, TradeOutcome[]>();
    const transitionKey = (from: string, to: string) => `${from}→${to}`;

    for (let i = 0; i < trades.length - 1; i++) {
      const current = (trades[i].entryRegime as MarketRegime) || "unknown";
      const next = (trades[i + 1].entryRegime as MarketRegime) || "unknown";

      if (current === next) continue;

      const key = transitionKey(current, next);
      if (!transitions.has(key)) {
        transitions.set(key, []);
      }
      transitions.get(key)!.push(trades[i + 1]);
    }

    const results: RegimeTransition[] = [];

    for (const [key, tradeList] of transitions.entries()) {
      const [from, to] = key.split("→") as [MarketRegime, MarketRegime];
      const wins = tradeList.filter((t) => t.won).length;
      const successRate = wins / tradeList.length;

      results.push({
        from,
        to,
        occurrences: tradeList.length,
        successRate,
        avgTradeCount: Math.round((tradeList.length / tradeList.length) * 10) / 10,
        notes:
          successRate < 0.3
            ? "Struggles during transition"
            : successRate > 0.7
              ? "Excels during transition"
              : "Neutral during transition",
      });
    }

    return results.sort((a, b) => b.occurrences - a.occurrences);
  }

  createRegimeProfiles(segments: RegimeSegment[], totalBars: number): RegimeProfile[] {
    return segments.map((seg) => {
      const prevalence = (seg.count / Math.max(totalBars, 1)) * 100;
      const profitability = seg.expectancy;
      const consistency = Math.max(seg.sharpeRatio, 0);
      const riskAdjustedReturn = seg.maxDrawdown > 0 ? seg.avgR / seg.maxDrawdown : seg.avgR;

      let recommendation: RegimeProfile["recommendation"];
      if (seg.winRate > 0.55 && seg.profitFactor > 1.5) {
        recommendation = "strong";
      } else if (seg.winRate > 0.45 && seg.profitFactor > 1.0) {
        recommendation = "acceptable";
      } else if (seg.winRate > 0.35) {
        recommendation = "weak";
      } else {
        recommendation = "avoid";
      }

      return {
        regime: seg.regime,
        prevalence,
        profitability,
        consistency,
        riskAdjustedReturn,
        recommendation,
      };
    });
  }

  detectRegimeBias(segments: RegimeSegment[]): {
    hasBias: boolean;
    biasToward: MarketRegime | null;
    severity: "none" | "mild" | "moderate" | "severe";
    description: string;
  } {
    if (segments.length === 0) {
      return {
        hasBias: false,
        biasToward: null,
        severity: "none",
        description: "No data to analyze",
      };
    }

    const sorted = [...segments].sort((a, b) => b.winRate - a.winRate);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    const wrDiff = best.winRate - worst.winRate;

    let severity: "none" | "mild" | "moderate" | "severe";
    if (wrDiff < 0.1) {
      severity = "none";
    } else if (wrDiff < 0.2) {
      severity = "mild";
    } else if (wrDiff < 0.35) {
      severity = "moderate";
    } else {
      severity = "severe";
    }

    const hasBias = wrDiff > 0.15;
    const description = hasBias
      ? `Strategy performs ${(wrDiff * 100).toFixed(1)}% better in ${best.regime} (${(best.winRate * 100).toFixed(1)}% WR) than ${worst.regime} (${(worst.winRate * 100).toFixed(1)}% WR). Consider specializing or adapting parameters.`
      : "Strategy performs consistently across market regimes.";

    return {
      hasBias,
      biasToward: hasBias ? best.regime : null,
      severity,
      description,
    };
  }

  validateRegimeConsistency(segments: RegimeSegment[]): {
    score: number;
    regimesPerformed: number;
    totalRegimes: number;
    warnings: string[];
  } {
    const warnings: string[] = [];
    let performedCount = 0;

    for (const seg of segments) {
      if (seg.winRate > 0.45 && seg.profitFactor > 0.8) {
        performedCount++;
      } else if (seg.count < 5) {
        warnings.push(`Insufficient data in ${seg.regime} (${seg.count} trades)`);
      } else {
        warnings.push(`Poor performance in ${seg.regime} (${(seg.winRate * 100).toFixed(1)}% WR)`);
      }
    }

    const score = segments.length > 0 ? (performedCount / segments.length) * 100 : 0;

    return {
      score,
      regimesPerformed: performedCount,
      totalRegimes: segments.length,
      warnings,
    };
  }

  validateStrategy(trades: TradeOutcome[], totalBars: number = 0): RegimeValidation {
    logger.info({ tradeCount: trades.length }, "Starting regime validation");

    const segments = this.segmentByRegime(trades);
    const transitions = this.analyzeTransitions(trades);
    const profiles = this.createRegimeProfiles(segments, totalBars);
    const bias = this.detectRegimeBias(segments);
    const consistency = this.validateRegimeConsistency(segments);

    return {
      segments,
      transitions,
      profiles,
      bias,
      consistency,
    };
  }

  private computeDrawdowns(trades: TradeOutcome[]): number[] {
    const drawdowns: number[] = [];
    let cumulR = 0;
    let peak = 0;

    for (const trade of trades) {
      cumulR += trade.pnlR;
      peak = Math.max(peak, cumulR);
      const dd = peak - cumulR;
      if (dd > 0) {
        drawdowns.push(dd);
      }
    }

    return drawdowns;
  }

  private computeSharpeRatio(trades: TradeOutcome[]): number {
    if (trades.length < 2) return 0;

    const returns = trades.map((t) => t.pnlR);
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
    const std = Math.sqrt(Math.max(variance, 0));

    return std > 0 ? (mean / std) * Math.sqrt(252) : 0;
  }
}

export const regimeValidator = new RegimeValidator();
