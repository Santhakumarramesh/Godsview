/**
 * trade_analytics.ts — Trade-Level Performance Analytics
 *
 * Comprehensive trade-level analysis for systematic strategy evaluation:
 *   - Individual trade metrics (entry, exit, duration, P&L)
 *   - Sharpe, Sortino, Calmar ratios for trade sequences
 *   - Drawdown analysis (MDD, recovery, streak)
 *   - Win/loss streak analysis and patterns
 *   - Trade distribution (size, duration, P&L segmentation)
 *   - Monte Carlo resampling for statistical confidence
 *   - Equity curve decomposition and trend analysis
 *
 * Foundation for trade-by-trade strategy validation.
 */

import { logger } from "../logger";
import { TradeOutcome } from "../backtest_engine";

// ── Types ──────────────────────────────────────────────────────────────────

export interface TradeMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;

  winRate: number; // % of winning trades
  profitFactor: number; // Gross wins / Gross losses
  payoffRatio: number; // Avg win / Avg loss

  totalPnL: number;
  avgPnL: number;
  medianPnL: number;
  stddevPnL: number;

  largestWin: number;
  largestLoss: number;

  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;

  avgDuration: number; // bars
  medianDuration: number;
}

export interface DrawdownAnalysis {
  currentDrawdown: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  maxDrawdownDuration: number; // bars
  lastRecoveryDuration: number;
  drawdownCount: number;
  avgDrawdown: number;
  avgRecoveryTime: number;
  ulcerIndex: number;
}

export interface StreakAnalysis {
  winStreak: number;
  lossStreak: number;
  maxWinStreak: number;
  maxLossStreak: number;
  consecutiveWins: number[];
  consecutiveLosses: number[];
}

export interface SegmentedWinRates {
  bySize: Record<string, number>; // e.g., "small": 0.55, "large": 0.48
  byDuration: Record<string, number>; // e.g., "fast": 0.60, "slow": 0.45
  byDirection: Record<string, number>; // "long": 0.52, "short": 0.50
}

export interface TradeDistribution {
  pnlDistribution: Array<{ range: string; count: number; pct: number }>;
  durationDistribution: Array<{ range: string; count: number }>;
  sizeDistribution: Array<{ range: string; count: number }>;
}

export interface MonteCarloResult {
  meanFinalEquity: number;
  stddevEquity: number;
  confidence95Low: number;
  confidence95High: number;
  confidence99Low: number;
  confidence99High: number;
  percentileRanks: Record<number, number>;
  probabilityOfRuin: number;
}

export interface EquityCurveAnalysis {
  trend: "uptrend" | "downtrend" | "sideways";
  trendStrength: number; // 0-1
  volatility: number;
  skewness: number;
  kurtosis: number;
  autocorrelation: number;
  linearRegressionSlope: number;
  r2: number;
}

// ── Trade Analytics ───────────────────────────────────────────────────────

export class TradeAnalytics {
  /**
   * Compute comprehensive trade metrics
   */
  computeTradeMetrics(trades: TradeOutcome[]): TradeMetrics {
    if (trades.length === 0) {
      return this.emptyMetrics();
    }

    const wins = trades.filter((t) => t.pnlPrice > 0);
    const losses = trades.filter((t) => t.pnlPrice < 0);
    const breakeven = trades.filter((t) => t.pnlPrice === 0);

    const pnls = trades.map((t) => t.pnlPrice);
    const totalPnL = pnls.reduce((a, b) => a + b, 0);
    const avgPnL = totalPnL / trades.length;

    const sorted = [...pnls].sort((a, b) => a - b);
    const medianPnL = sorted[Math.floor(sorted.length / 2)];

    const variance = pnls.reduce((s, p) => s + (p - avgPnL) ** 2, 0) / trades.length;
    const stddevPnL = Math.sqrt(variance);

    const grossWins = wins.reduce((s, t) => s + t.pnlPrice, 0);
    const grossLosses = Math.abs(losses.reduce((s, t) => s + t.pnlPrice, 0));
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 999 : 1;

    const avgWin = wins.length > 0 ? grossWins / wins.length : 0;
    const avgLoss = losses.length > 0 ? -grossLosses / losses.length : 0;
    const payoffRatio = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : avgWin > 0 ? 999 : 1;

    const sharpe = this.computeSharpe(pnls);
    const sortino = this.computeSortino(pnls);
    const calmar = this.computeCalmar(pnls, trades);

    const durations = trades.map((t) => t.barsHeld);
    const avgDuration = durations.reduce((a, b) => a + b) / durations.length;
    const sortedDurations = [...durations].sort((a, b) => a - b);
    const medianDuration = sortedDurations[Math.floor(sortedDurations.length / 2)];

    return {
      totalTrades: trades.length,
      winningTrades: wins.length,
      losingTrades: losses.length,
      breakevenTrades: breakeven.length,

      winRate: wins.length / trades.length,
      profitFactor,
      payoffRatio,

      totalPnL,
      avgPnL,
      medianPnL,
      stddevPnL,

      largestWin: Math.max(...pnls),
      largestLoss: Math.min(...pnls),

      sharpeRatio: sharpe,
      sortinoRatio: sortino,
      calmarRatio: calmar,

      avgDuration,
      medianDuration,
    };
  }

  /**
   * Analyze drawdowns from trade sequence
   */
  analyzeDrawdowns(trades: TradeOutcome[]): DrawdownAnalysis {
    let peak = 0;
    let maxDD = 0;
    let maxDDPct = 0;
    let maxDDDuration = 0;
    let currentDD = 0;
    let drawdownCount = 0;
    const drawdowns: number[] = [];
    const recoveryTimes: number[] = [];

    let equity = 0;
    let peakIdx = 0;
    let ddStartIdx = 0;

    trades.forEach((trade, idx) => {
      equity += trade.pnlPrice;
      if (equity > peak) {
        if (currentDD > 0) {
          recoveryTimes.push(idx - ddStartIdx);
          drawdownCount++;
        }
        peak = equity;
        peakIdx = idx;
        currentDD = 0;
      } else {
        const dd = (peak - equity) / Math.max(1, peak);
        currentDD = dd;
        if (dd > maxDD) {
          maxDD = dd;
          maxDDPct = maxDD * 100;
          maxDDDuration = idx - peakIdx;
        }
        drawdowns.push(dd);
        if (ddStartIdx === 0) ddStartIdx = peakIdx;
      }
    });

    const avgDD = drawdowns.length > 0 ? drawdowns.reduce((a, b) => a + b) / drawdowns.length : 0;
    const avgRecoveryTime =
      recoveryTimes.length > 0 ? recoveryTimes.reduce((a, b) => a + b) / recoveryTimes.length : 0;

    const ulcer = this.computeUlcerIndex(trades);

    return {
      currentDrawdown: currentDD,
      maxDrawdown: maxDD,
      maxDrawdownPct: maxDDPct,
      maxDrawdownDuration: maxDDDuration,
      lastRecoveryDuration: recoveryTimes.length > 0 ? recoveryTimes[recoveryTimes.length - 1] : 0,
      drawdownCount,
      avgDrawdown: avgDD,
      avgRecoveryTime,
      ulcerIndex: ulcer,
    };
  }

  /**
   * Analyze win/loss streaks
   */
  analyzeStreaks(trades: TradeOutcome[]): StreakAnalysis {
    let winStreak = 0;
    let lossStreak = 0;
    let maxWinStreak = 0;
    let maxLossStreak = 0;
    const consecutiveWins: number[] = [];
    const consecutiveLosses: number[] = [];

    trades.forEach((trade) => {
      if (trade.pnlPrice > 0) {
        winStreak++;
        lossStreak = 0;
        if (winStreak > maxWinStreak) {
          maxWinStreak = winStreak;
        }
      } else if (trade.pnlPrice < 0) {
        lossStreak++;
        if (lossStreak > maxLossStreak) {
          maxLossStreak = lossStreak;
        }
        if (winStreak > 0) {
          consecutiveWins.push(winStreak);
        }
        winStreak = 0;
      }
    });

    if (winStreak > 0) consecutiveWins.push(winStreak);
    if (lossStreak > 0) consecutiveLosses.push(lossStreak);

    return {
      winStreak,
      lossStreak,
      maxWinStreak,
      maxLossStreak,
      consecutiveWins,
      consecutiveLosses,
    };
  }

  /**
   * Compute segmented win rates
   */
  analyzeSegmentedWinRates(trades: TradeOutcome[]): SegmentedWinRates {
    const bySize: Record<string, number> = {};
    const byDuration: Record<string, number> = {};
    const byDirection: Record<string, number> = {};

    // Size segments
    const sizes = trades.map((t) => Math.abs(t.pnlPrice));
    const sizePercentile33 = sizes.sort((a, b) => a - b)[Math.floor(sizes.length / 3)];
    const sizePercentile66 = sizes[Math.floor((sizes.length * 2) / 3)];

    const smallTrades = trades.filter((t) => Math.abs(t.pnlPrice) <= sizePercentile33);
    const mediumTrades = trades.filter(
      (t) => Math.abs(t.pnlPrice) > sizePercentile33 && Math.abs(t.pnlPrice) <= sizePercentile66
    );
    const largeTrades = trades.filter((t) => Math.abs(t.pnlPrice) > sizePercentile66);

    bySize["small"] = smallTrades.filter((t) => t.pnlPrice > 0).length / smallTrades.length || 0;
    bySize["medium"] = mediumTrades.filter((t) => t.pnlPrice > 0).length / mediumTrades.length || 0;
    bySize["large"] = largeTrades.filter((t) => t.pnlPrice > 0).length / largeTrades.length || 0;

    // Duration segments
    const durations = trades.map((t) => t.barsHeld);
    const durationPercentile33 = durations.sort((a, b) => a - b)[Math.floor(durations.length / 3)];
    const durationPercentile66 = durations[Math.floor((durations.length * 2) / 3)];

    const fastTrades = trades.filter(
      (t) => (t.barsHeld) <= durationPercentile33
    );
    const mediumDuration = trades.filter(
      (t) =>
        (t.barsHeld) > durationPercentile33 &&
        (t.barsHeld) <= durationPercentile66
    );
    const slowTrades = trades.filter(
      (t) => (t.barsHeld) > durationPercentile66
    );

    byDuration["fast"] = fastTrades.filter((t) => t.pnlPrice > 0).length / fastTrades.length || 0;
    byDuration["medium"] =
      mediumDuration.filter((t) => t.pnlPrice > 0).length / mediumDuration.length || 0;
    byDuration["slow"] = slowTrades.filter((t) => t.pnlPrice > 0).length / slowTrades.length || 0;

    // Direction segments
    const longTrades = trades.filter((t) => t.direction === "long");
    const shortTrades = trades.filter((t) => t.direction === "short");

    byDirection["long"] = longTrades.filter((t) => t.pnlPrice > 0).length / longTrades.length || 0;
    byDirection["short"] = shortTrades.filter((t) => t.pnlPrice > 0).length / shortTrades.length || 0;

    return { bySize, byDuration, byDirection };
  }

  /**
   * Analyze trade distribution
   */
  analyzeTradeDistribution(trades: TradeOutcome[]): TradeDistribution {
    const pnls = trades.map((t) => t.pnlPrice);
    const min = Math.min(...pnls);
    const max = Math.max(...pnls);
    const range = max - min;
    const binSize = range / 5;

    const pnlDistribution = [];
    for (let i = 0; i < 5; i++) {
      const binMin = min + i * binSize;
      const binMax = binMin + binSize;
      const count = pnls.filter((p) => p >= binMin && p < binMax).length;
      pnlDistribution.push({
        range: `${binMin.toFixed(0)}-${binMax.toFixed(0)}`,
        count,
        pct: count / trades.length,
      });
    }

    const durations = trades.map((t) => t.barsHeld);
    const durationDistribution = [
      { range: "1-5", count: durations.filter((d) => d >= 1 && d <= 5).length },
      { range: "6-20", count: durations.filter((d) => d >= 6 && d <= 20).length },
      { range: "21-50", count: durations.filter((d) => d >= 21 && d <= 50).length },
      { range: "50+", count: durations.filter((d) => d > 50).length },
    ];

    const sizes = trades.map((t) => Math.abs(t.pnlPrice));
    const sizeMin = Math.min(...sizes);
    const sizeMax = Math.max(...sizes);
    const sizeRange = sizeMax - sizeMin;
    const sizeBin = sizeRange / 3;

    const sizeDistribution = [
      {
        range: `${sizeMin.toFixed(0)}-${(sizeMin + sizeBin).toFixed(0)}`,
        count: sizes.filter((s) => s >= sizeMin && s < sizeMin + sizeBin).length,
      },
      {
        range: `${(sizeMin + sizeBin).toFixed(0)}-${(sizeMin + 2 * sizeBin).toFixed(0)}`,
        count: sizes.filter((s) => s >= sizeMin + sizeBin && s < sizeMin + 2 * sizeBin).length,
      },
      {
        range: `${(sizeMin + 2 * sizeBin).toFixed(0)}-${sizeMax.toFixed(0)}`,
        count: sizes.filter((s) => s >= sizeMin + 2 * sizeBin && s <= sizeMax).length,
      },
    ];

    return { pnlDistribution, durationDistribution, sizeDistribution };
  }

  /**
   * Monte Carlo simulation for confidence intervals
   */
  monteCarloSimulation(trades: TradeOutcome[], iterations: number = 1000): MonteCarloResult {
    const pnls = trades.map((t) => t.pnlPrice);
    const results: number[] = [];

    for (let i = 0; i < iterations; i++) {
      let equity = 0;
      for (let j = 0; j < trades.length; j++) {
        const randomIdx = Math.floor(Math.random() * pnls.length);
        equity += pnls[randomIdx];
      }
      results.push(equity);
    }

    results.sort((a, b) => a - b);

    const mean = results.reduce((a, b) => a + b) / results.length;
    const variance = results.reduce((s, r) => s + (r - mean) ** 2, 0) / results.length;
    const stddev = Math.sqrt(variance);

    const confidence95Low = results[Math.floor(results.length * 0.025)];
    const confidence95High = results[Math.floor(results.length * 0.975)];
    const confidence99Low = results[Math.floor(results.length * 0.005)];
    const confidence99High = results[Math.floor(results.length * 0.995)];

    const percentileRanks: Record<number, number> = {};
    [10, 25, 50, 75, 90].forEach((p) => {
      percentileRanks[p] = results[Math.floor((results.length * p) / 100)];
    });

    const ruin = results.filter((r) => r < -Math.max(...pnls)).length / results.length;

    return {
      meanFinalEquity: mean,
      stddevEquity: stddev,
      confidence95Low,
      confidence95High,
      confidence99Low,
      confidence99High,
      percentileRanks,
      probabilityOfRuin: ruin,
    };
  }

  /**
   * Analyze equity curve characteristics
   */
  analyzeEquityCurve(equityCurve: number[]): EquityCurveAnalysis {
    if (equityCurve.length < 2) {
      return this.emptyEquityCurveAnalysis();
    }

    const returns: number[] = [];
    for (let i = 1; i < equityCurve.length; i++) {
      returns.push(equityCurve[i] / equityCurve[i - 1] - 1);
    }

    // Trend
    const { slope } = this.linearRegression(
      equityCurve.map((_, i) => i),
      equityCurve
    );
    const trend: "uptrend" | "downtrend" | "sideways" =
      Math.abs(slope) < 0.01 ? "sideways" : slope > 0 ? "uptrend" : "downtrend";
    const trendStrength = Math.min(Math.abs(slope) * 100, 1);

    const volatility = this.stddev(returns);
    const skewness = this.computeSkewness(returns);
    const kurtosis = this.computeKurtosis(returns);

    // Autocorrelation (lag-1)
    const mean = returns.reduce((a, b) => a + b) / returns.length;
    let autocovar = 0;
    let variance = 0;
    for (let i = 1; i < returns.length; i++) {
      autocovar += (returns[i] - mean) * (returns[i - 1] - mean);
      variance += (returns[i] - mean) ** 2;
    }
    const autocorr = variance > 0 ? autocovar / variance : 0;

    const { r2 } = this.linearRegression(
      equityCurve.map((_, i) => i),
      equityCurve
    );

    return {
      trend,
      trendStrength,
      volatility,
      skewness,
      kurtosis,
      autocorrelation: autocorr,
      linearRegressionSlope: slope,
      r2,
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private emptyMetrics(): TradeMetrics {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      breakevenTrades: 0,
      winRate: 0,
      profitFactor: 1,
      payoffRatio: 1,
      totalPnL: 0,
      avgPnL: 0,
      medianPnL: 0,
      stddevPnL: 0,
      largestWin: 0,
      largestLoss: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      calmarRatio: 0,
      avgDuration: 0,
      medianDuration: 0,
    };
  }

  private emptyEquityCurveAnalysis(): EquityCurveAnalysis {
    return {
      trend: "sideways",
      trendStrength: 0,
      volatility: 0,
      skewness: 0,
      kurtosis: 0,
      autocorrelation: 0,
      linearRegressionSlope: 0,
      r2: 0,
    };
  }

  private computeSharpe(pnls: number[]): number {
    if (pnls.length < 2) return 0;
    const mean = pnls.reduce((a, b) => a + b) / pnls.length;
    const variance = pnls.reduce((s, p) => s + (p - mean) ** 2, 0) / pnls.length;
    const std = Math.sqrt(variance);
    return std > 0 ? (mean / std) * Math.sqrt(252) : 0;
  }

  private computeSortino(pnls: number[]): number {
    if (pnls.length < 2) return 0;
    const mean = pnls.reduce((a, b) => a + b) / pnls.length;
    const downside = pnls.filter((p) => p < mean);
    if (downside.length === 0) return this.computeSharpe(pnls);
    const variance = downside.reduce((s, p) => s + (p - mean) ** 2, 0) / downside.length;
    const std = Math.sqrt(variance);
    return std > 0 ? (mean / std) * Math.sqrt(252) : 0;
  }

  private computeCalmar(pnls: number[], trades: TradeOutcome[]): number {
    const dd = this.analyzeDrawdowns(trades);
    const totalReturn = pnls.reduce((a, b) => a + b, 0);
    return dd.maxDrawdown > 0 ? totalReturn / dd.maxDrawdown : totalReturn > 0 ? 999 : 0;
  }

  private computeUlcerIndex(trades: TradeOutcome[]): number {
    let equity = 0;
    let peak = 0;
    let sumSquared = 0;

    trades.forEach((trade) => {
      equity += trade.pnlPrice;
      peak = Math.max(peak, equity);
      const dd = ((peak - equity) / peak) * 100;
      sumSquared += dd * dd;
    });

    return Math.sqrt(sumSquared / trades.length);
  }

  private linearRegression(x: number[], y: number[]) {
    const n = x.length;
    const sumX = x.reduce((a, b) => a + b);
    const sumY = y.reduce((a, b) => a + b);
    const sumXY = x.reduce((s, xi, i) => s + xi * y[i], 0);
    const sumX2 = x.reduce((s, xi) => s + xi * xi, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    const yPred = x.map((xi) => slope * xi + intercept);
    const ssRes = y.reduce((s, yi, i) => s + (yi - yPred[i]) ** 2, 0);
    const ssTot = y.reduce((s, yi) => s + (yi - (sumY / n)) ** 2, 0);
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    return { slope, intercept, r2 };
  }

  private stddev(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
  }

  private computeSkewness(values: number[]): number {
    const mean = values.reduce((a, b) => a + b) / values.length;
    const std = this.stddev(values);
    if (std === 0) return 0;
    const m3 = values.reduce((s, v) => s + Math.pow((v - mean) / std, 3), 0) / values.length;
    return m3;
  }

  private computeKurtosis(values: number[]): number {
    const mean = values.reduce((a, b) => a + b) / values.length;
    const std = this.stddev(values);
    if (std === 0) return 0;
    const m4 = values.reduce((s, v) => s + Math.pow((v - mean) / std, 4), 0) / values.length;
    return m4 - 3;
  }
}

// Export singleton
export const tradeAnalytics = new TradeAnalytics();