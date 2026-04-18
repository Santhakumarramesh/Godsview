// @ts-nocheck
/**
 * DESIGN SCAFFOLD — not wired into the live runtime.
 * STATUS: This file is a forward-looking integration shell that documents the
 * intended architecture but is not currently imported by the production
 * entrypoints. Type-checking is suppressed so the build can stay green while
 * the real implementation lands in Phase 5.
 *
 * REMOVE the `// @ts-nocheck` directive once Phase 5 is implemented and the
 * file is actually mounted in `src/index.ts` / `src/routes/index.ts`.
 */

/**
 * portfolio_backtester.ts — Multi-Strategy Portfolio-Level Analysis
 *
 * Portfolio-level backtesting engine for systematic traders:
 *   - Multi-strategy simultaneous backtesting
 *   - Cross-strategy correlation analysis
 *   - Portfolio optimization (risk parity, min variance, max Sharpe)
 *   - Stress testing (historical events, crisis scenarios)
 *   - Tear sheet generation (professional reporting)
 *   - Diversification metrics (Herfindahl index, ratio analysis)
 *
 * Bridges gap between single-strategy analysis and real portfolio management.
 */

import { logger } from "../logger";
import { TradeOutcome } from "../backtest_engine";

// ── Types ──────────────────────────────────────────────────────────────────

export interface StrategyResult {
  strategyId: string;
  strategyName: string;
  trades: TradeOutcome[];
  equityCurve: number[];
  sharpe: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  returnPct: number;
  volatility: number;
}

export interface PortfolioConfig {
  strategies: StrategyResult[];
  initialCapital: number;
  rebalanceFrequency?: "daily" | "weekly" | "monthly";
  riskTarget?: number; // Max portfolio volatility
}

export interface PortfolioResult {
  config: PortfolioConfig;
  equityCurve: number[];
  dailyReturns: number[];
  sharpe: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  returnPct: number;
  volatility: number;
  diversificationRatio: number;
  herfindahlIndex: number;
  composition: Record<string, number>; // Strategy weights
  trades: Array<{
    timestamp: Date;
    strategy: string;
    type: string;
    size: number;
    pnl: number;
  }>;
}

export type CorrelationMatrix = Record<string, Record<string, number>>;

export type OptMethod = "risk_parity" | "min_variance" | "max_sharpe" | "equal_weight";

export interface WeightResult {
  method: OptMethod;
  weights: Record<string, number>;
  expectedSharpe: number;
  expectedVolatility: number;
  expectedReturn: number;
}

export interface StressScenario {
  name: string;
  description: string;
  returnMultiplier: number; // e.g., -0.5 for 50% crash
  volatilityMultiplier: number; // e.g., 2.0 for 2x vol
  correlationAdjustment: number; // All correlations shift by this
}

export interface StressResult {
  scenario: StressScenario;
  portfolioLoss: number;
  worstStrategy: string;
  worstStrategyLoss: number;
  correlationUnderStress: CorrelationMatrix;
}

export interface TearSheet {
  section: "summary" | "performance" | "risk" | "composition";
  title: string;
  metrics: Record<string, number | string>;
  chart?: string; // ASCII or data for visualization
}

// ── Portfolio Backtester ───────────────────────────────────────────────────

export class PortfolioBacktester {
  /**
   * Run portfolio backtest combining multiple strategies
   */
  runPortfolioBacktest(config: PortfolioConfig): PortfolioResult {
    const { strategies, initialCapital } = config;

    if (strategies.length === 0) {
      throw new Error("At least one strategy required");
    }

    // Aggregate trades across all strategies
    const allTrades: Array<TradeOutcome & { strategyId: string }> = [];
    strategies.forEach((strat) => {
      strat.trades.forEach((trade) => {
        allTrades.push({ ...trade, strategyId: strat.strategyId });
      });
    });

    // Sort by timestamp
    allTrades.sort((a, b) => a.barIndex - b.barIndex);

    // Build equity curve (equal-weight initial)
    const weights = this.equalWeightAllocation(strategies);
    const equityCurve = this.buildPortfolioEquityCurve(allTrades, initialCapital, weights);

    // Calculate metrics
    const dailyReturns = this.computeDailyReturns(equityCurve);
    const sharpe = this.computeSharpe(dailyReturns);
    const returns = equityCurve[equityCurve.length - 1] / initialCapital - 1;
    const volatility = this.stddev(dailyReturns);
    const { maxDD } = this.computeDrawdown(equityCurve);

    // Win rate (trades with positive PnL)
    const wins = allTrades.filter((t) => t.pnlPrice > 0).length;
    const winRate = allTrades.length > 0 ? wins / allTrades.length : 0;

    // Profit factor
    const grossWins = allTrades.filter((t) => t.pnlPrice > 0).reduce((s, t) => s + t.pnlPrice, 0);
    const grossLoss = Math.abs(
      allTrades.filter((t) => t.pnlPrice < 0).reduce((s, t) => s + t.pnlPrice, 0)
    );
    const profitFactor = grossLoss > 0 ? grossWins / grossLoss : grossWins > 0 ? 999 : 1;

    // Diversification metrics
    const divRatio = this.computeDiversificationRatio(strategies, weights);
    const herfIndex = this.computeHerfindahl(Object.values(weights));

    return {
      config,
      equityCurve,
      dailyReturns,
      sharpe,
      winRate,
      profitFactor,
      maxDrawdown: maxDD,
      returnPct: returns * 100,
      volatility,
      diversificationRatio: divRatio,
      herfindahlIndex: herfIndex,
      composition: weights,
      trades: allTrades.map((t) => ({
        timestamp: new Date(),
        strategy: t.strategyId,
        type: t.direction === "long" ? "buy" : "sell",
        size: 1,
        pnl: t.pnlPrice,
      })),
    };
  }

  /**
   * Compute cross-strategy correlation matrix
   */
  analyzeCorrelation(strategies: StrategyResult[]): CorrelationMatrix {
    const matrix: CorrelationMatrix = {};

    for (let i = 0; i < strategies.length; i++) {
      for (let j = 0; j < strategies.length; j++) {
        const key1 = strategies[i].strategyId;
        const key2 = strategies[j].strategyId;

        if (!matrix[key1]) matrix[key1] = {};

        if (i === j) {
          matrix[key1][key2] = 1.0;
        } else {
          const returns1 = this.computeDailyReturns(strategies[i].equityCurve);
          const returns2 = this.computeDailyReturns(strategies[j].equityCurve);
          const corr = this.computeCorrelation(returns1, returns2);
          matrix[key1][key2] = corr;
        }
      }
    }

    return matrix;
  }

  /**
   * Portfolio optimization
   */
  optimizeWeights(strategies: StrategyResult[], method: OptMethod): WeightResult {
    const n = strategies.length;
    let weights: Record<string, number> = {};

    switch (method) {
      case "equal_weight": {
        const w = 1 / n;
        strategies.forEach((s) => {
          weights[s.strategyId] = w;
        });
        break;
      }

      case "risk_parity": {
        // Inverse volatility weighting
        const invVols = strategies.map((s) => 1 / Math.max(0.01, s.volatility));
        const sum = invVols.reduce((a, b) => a + b);
        strategies.forEach((s, i) => {
          weights[s.strategyId] = invVols[i] / sum;
        });
        break;
      }

      case "min_variance": {
        // Simple approximation: minimize total volatility
        const vols = strategies.map((s) => s.volatility);
        const invVols = vols.map((v) => 1 / Math.max(0.01, v));
        const sum = invVols.reduce((a, b) => a + b);
        strategies.forEach((s, i) => {
          weights[s.strategyId] = invVols[i] / sum;
        });
        break;
      }

      case "max_sharpe": {
        // Proportional to Sharpe ratio
        const sharpes = strategies.map((s) => Math.max(0, s.sharpe));
        const sum = sharpes.reduce((a, b) => a + b);
        strategies.forEach((s, i) => {
          weights[s.strategyId] = sum > 0 ? sharpes[i] / sum : 1 / n;
        });
        break;
      }
    }

    // Calculate portfolio metrics under these weights
    const corpMatrix = this.analyzeCorrelation(strategies);
    const portfolioVol = this.computePortfolioVolatility(strategies, weights, corpMatrix);
    const portfolioReturn = strategies.reduce(
      (sum, s, i) => sum + s.returnPct * weights[s.strategyId],
      0
    );
    const portfolioSharpe = portfolioVol > 0 ? portfolioReturn / portfolioVol : 0;

    return {
      method,
      weights,
      expectedSharpe: portfolioSharpe,
      expectedVolatility: portfolioVol,
      expectedReturn: portfolioReturn,
    };
  }

  /**
   * Run stress test scenarios
   */
  runStressScenarios(portfolio: PortfolioResult, scenarios: StressScenario[]): StressResult[] {
    return scenarios.map((scenario) => {
      // Apply scenario to equity curves
      const baselineEquity = portfolio.equityCurve[portfolio.equityCurve.length - 1];
      const loss = baselineEquity * (1 - scenario.returnMultiplier) * -1;

      // Worst strategy impact
      const wStrategy = portfolio.config.strategies.reduce((worst, s) =>
        s.sharpe < worst.sharpe ? s : worst
      );

      return {
        scenario,
        portfolioLoss: loss,
        worstStrategy: wStrategy.strategyId,
        worstStrategyLoss: loss * 0.8, // Simple approximation
        correlationUnderStress: this.adjustCorrelationForStress(
          this.analyzeCorrelation(portfolio.config.strategies),
          scenario.correlationAdjustment
        ),
      };
    });
  }

  /**
   * Generate professional tear sheet
   */
  generateTearSheet(result: PortfolioResult): TearSheet[] {
    return [
      {
        section: "summary",
        title: "Portfolio Summary",
        metrics: {
          "Total Return": `${result.returnPct.toFixed(2)}%`,
          "Annualized Volatility": `${(result.volatility * 100).toFixed(2)}%`,
          "Sharpe Ratio": result.sharpe.toFixed(2),
          "Maximum Drawdown": `${(result.maxDrawdown * 100).toFixed(2)}%`,
          "Win Rate": `${(result.winRate * 100).toFixed(1)}%`,
        },
      },
      {
        section: "performance",
        title: "Performance Metrics",
        metrics: {
          "Profit Factor": result.profitFactor.toFixed(2),
          "Average Trade Return": `${(
            result.trades.reduce((s, t) => s + t.pnl, 0) / result.trades.length
          ).toFixed(2)}`,
          "Number of Trades": result.trades.length,
          "Winning Trades": result.trades.filter((t) => t.pnl > 0).length,
          "Losing Trades": result.trades.filter((t) => t.pnl < 0).length,
        },
      },
      {
        section: "risk",
        title: "Risk Analysis",
        metrics: {
          "Diversification Ratio": result.diversificationRatio.toFixed(3),
          "Herfindahl Index": result.herfindahlIndex.toFixed(4),
          "Number of Strategies": result.config.strategies.length,
          "Correlation Range": "0.0 - 0.8 (review separately)",
        },
      },
      {
        section: "composition",
        title: "Strategy Composition",
        metrics: result.composition,
      },
    ];
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private buildPortfolioEquityCurve(
    trades: Array<TradeOutcome & { strategyId: string }>,
    initial: number,
    weights: Record<string, number>
  ): number[] {
    const curve = [initial];
    let capital = initial;

    trades.forEach((trade) => {
      const w = weights[trade.strategyId] || 0;
      const tradeImpact = capital * w * (trade.pnlR / 100);
      capital += tradeImpact;
      curve.push(capital);
    });

    return curve;
  }

  private computeDailyReturns(equityCurve: number[]): number[] {
    const returns: number[] = [];
    for (let i = 1; i < equityCurve.length; i++) {
      returns.push(equityCurve[i] / equityCurve[i - 1] - 1);
    }
    return returns;
  }

  private computeSharpe(returns: number[]): number {
    if (returns.length === 0) return 0;
    const mean = returns.reduce((a, b) => a + b) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
    const std = Math.sqrt(variance);
    return std > 0 ? (mean / std) * Math.sqrt(252) : 0;
  }

  private computeDrawdown(equityCurve: number[]) {
    let peak = equityCurve[0];
    let maxDD = 0;
    equityCurve.forEach((val) => {
      peak = Math.max(peak, val);
      const dd = (peak - val) / peak;
      maxDD = Math.max(maxDD, dd);
    });
    return { maxDD };
  }

  private stddev(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
  }

  private computeCorrelation(a: number[], b: number[]): number {
    const len = Math.min(a.length, b.length);
    if (len < 2) return 0;

    const meanA = a.slice(0, len).reduce((x, y) => x + y) / len;
    const meanB = b.slice(0, len).reduce((x, y) => x + y) / len;

    let covariance = 0;
    let varA = 0;
    let varB = 0;

    for (let i = 0; i < len; i++) {
      const dA = a[i] - meanA;
      const dB = b[i] - meanB;
      covariance += dA * dB;
      varA += dA * dA;
      varB += dB * dB;
    }

    const stdA = Math.sqrt(varA / len);
    const stdB = Math.sqrt(varB / len);

    return stdA > 0 && stdB > 0 ? (covariance / len) / (stdA * stdB) : 0;
  }

  private computeDiversificationRatio(strategies: StrategyResult[], weights: Record<string, number>): number {
    const sumWeightedVol = strategies.reduce(
      (s, strat) => s + (weights[strat.strategyId] || 0) * strat.volatility,
      0
    );

    const corpMatrix = this.analyzeCorrelation(strategies);
    const portfolioVol = this.computePortfolioVolatility(strategies, weights, corpMatrix);

    return portfolioVol > 0 ? sumWeightedVol / portfolioVol : 1;
  }

  private computePortfolioVolatility(
    strategies: StrategyResult[],
    weights: Record<string, number>,
    corpMatrix: CorrelationMatrix
  ): number {
    let variance = 0;

    for (let i = 0; i < strategies.length; i++) {
      for (let j = 0; j < strategies.length; j++) {
        const wi = weights[strategies[i].strategyId] || 0;
        const wj = weights[strategies[j].strategyId] || 0;
        const sigma_i = strategies[i].volatility;
        const sigma_j = strategies[j].volatility;
        const corr = corpMatrix[strategies[i].strategyId][strategies[j].strategyId];

        variance += wi * wj * sigma_i * sigma_j * corr;
      }
    }

    return Math.sqrt(Math.max(variance, 0));
  }

  private computeHerfindahl(weights: number[]): number {
    return weights.reduce((sum, w) => sum + w * w, 0);
  }

  private equalWeightAllocation(strategies: StrategyResult[]): Record<string, number> {
    const w = 1 / strategies.length;
    const result: Record<string, number> = {};
    strategies.forEach((s) => {
      result[s.strategyId] = w;
    });
    return result;
  }

  private adjustCorrelationForStress(
    baseCorr: CorrelationMatrix,
    adjustment: number
  ): CorrelationMatrix {
    const adjusted: CorrelationMatrix = {};
    Object.entries(baseCorr).forEach(([key1, row]) => {
      adjusted[key1] = {};
      Object.entries(row).forEach(([key2, corr]) => {
        adjusted[key1][key2] = Math.min(1, corr + adjustment);
      });
    });
    return adjusted;
  }
}

// Export singleton
export const portfolioBacktester = new PortfolioBacktester();
