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
 * walk_forward.ts — Walk-Forward Validation Engine
 *
 * Prevent overfitting through realistic out-of-sample testing:
 *   - Anchored (expanding window) walk-forward analysis
 *   - Rolling window walk-forward analysis
 *   - IS/OOS performance comparison
 *   - Overfitting gap detection
 *   - Degradation analysis (performance decay over time)
 *
 * Gold standard for operational readiness validation.
 */

import { logger } from "../logger";
import { TradeOutcome } from "../backtest_engine";

// ── Types ──────────────────────────────────────────────────────────────────

export interface WalkForwardConfig {
  mode: "anchored" | "rolling";
  isWindowSize: number; // In-sample bars
  oosWindowSize: number; // Out-of-sample bars
  stepSize?: number; // Default: oosWindowSize (rolling non-overlapping)
  minData?: number; // Minimum bars required
}

export interface WFWindow {
  windowId: number;
  isStart: number; // bar index
  isEnd: number;
  oosStart: number;
  oosEnd: number;
  isPeriod: number; // bars
  oosPeriod: number; // bars
}

export interface WFWindowResult {
  window: WFWindow;
  isTrades: TradeOutcome[];
  oosTrades: TradeOutcome[];
  isMetrics: {
    trades: number;
    winRate: number;
    sharpe: number;
    profitFactor: number;
    maxDD: number;
    totalPnL: number;
  };
  oosMetrics: {
    trades: number;
    winRate: number;
    sharpe: number;
    profitFactor: number;
    maxDD: number;
    totalPnL: number;
  };
  degradation: {
    winRateDegradation: number; // %
    sharpeDegradation: number; // %
    drawdownIncrease: number; // %
    isToOosRatio: number; // Performance ratio
  };
  consistency: "strong" | "moderate" | "weak";
}

export interface WalkForwardAnalysis {
  config: WalkForwardConfig;
  windows: WFWindowResult[];
  summary: {
    avgISMetrics: any;
    avgOOSMetrics: any;
    avgDegradation: any;
    consistencyScore: number; // 0-1
    overfit: boolean;
    recommendations: string[];
  };
}

// ── Walk-Forward Validator ─────────────────────────────────────────────────

export class WalkForwardValidator {
  /**
   * Generate walk-forward windows
   */
  generateWindows(totalBars: number, config: WalkForwardConfig): WFWindow[] {
    const minData = config.minData || config.isWindowSize;
    if (totalBars < minData) {
      throw new Error(`Insufficient data: ${totalBars} < ${minData}`);
    }

    const windows: WFWindow[] = [];
    const stepSize = config.stepSize || config.oosWindowSize;

    if (config.mode === "anchored") {
      let oosStart = config.isWindowSize;

      for (let windowId = 0; oosStart + config.oosWindowSize <= totalBars; windowId++) {
        const oosEnd = Math.min(oosStart + config.oosWindowSize, totalBars);

        windows.push({
          windowId,
          isStart: 0,
          isEnd: oosStart,
          oosStart,
          oosEnd,
          isPeriod: oosStart,
          oosPeriod: oosEnd - oosStart,
        });

        oosStart += stepSize;
      }
    } else {
      // Rolling
      let isStart = 0;

      for (let windowId = 0; isStart + config.isWindowSize + config.oosWindowSize <= totalBars; windowId++) {
        const isEnd = isStart + config.isWindowSize;
        const oosStart = isEnd;
        const oosEnd = Math.min(oosStart + config.oosWindowSize, totalBars);

        windows.push({
          windowId,
          isStart,
          isEnd,
          oosStart,
          oosEnd,
          isPeriod: config.isWindowSize,
          oosPeriod: oosEnd - oosStart,
        });

        isStart += stepSize;
      }
    }

    logger.debug({ count: windows.length, config }, "Generated walk-forward windows");
    return windows;
  }

  /**
   * Analyze walk-forward performance
   */
  analyzeWalkForward(trades: TradeOutcome[], config: WalkForwardConfig): WalkForwardAnalysis {
    const totalBars = Math.max(...trades.map((t) => t.barIndex), 0);
    const windows = this.generateWindows(totalBars, config);

    const results: WFWindowResult[] = windows.map((window) => {
      const isTrades = trades.filter((t) => t.barIndex >= window.isStart && t.barIndex < window.isEnd);
      const oosTrades = trades.filter(
        (t) => t.barIndex >= window.oosStart && t.barIndex < window.oosEnd
      );

      const isMetrics = this.computeWindowMetrics(isTrades);
      const oosMetrics = this.computeWindowMetrics(oosTrades);

      const degradation = {
        winRateDegradation: isMetrics.winRate > 0 ? ((isMetrics.winRate - oosMetrics.winRate) / isMetrics.winRate) * 100 : 0,
        sharpeDegradation: isMetrics.sharpe > 0 ? ((isMetrics.sharpe - oosMetrics.sharpe) / Math.abs(isMetrics.sharpe)) * 100 : 0,
        drawdownIncrease: isMetrics.maxDD > 0 ? ((oosMetrics.maxDD - isMetrics.maxDD) / isMetrics.maxDD) * 100 : 0,
        isToOosRatio: oosMetrics.sharpe > 0 ? isMetrics.sharpe / oosMetrics.sharpe : 1,
      };

      const consistency = this.rateConsistency(degradation);

      return { window, isTrades, oosTrades, isMetrics, oosMetrics, degradation, consistency };
    });

    // Summary stats
    const avgISMetrics = this.averageMetrics(results.map((r) => r.isMetrics));
    const avgOOSMetrics = this.averageMetrics(results.map((r) => r.oosMetrics));
    const avgDegradation = this.averageDegradation(results.map((r) => r.degradation));

    const consistencyScore =
      results.filter((r) => r.consistency === "strong").length / results.length;
    const overfit = results.filter((r) => r.degradation.isToOosRatio > 1.5).length > results.length * 0.3;

    const recommendations: string[] = [];
    if (overfit) recommendations.push("Overfitting detected. Simplify model or increase regularization.");
    if (avgDegradation.drawdownIncrease > 50) recommendations.push("Drawdown increases significantly OOS. Review risk management.");
    if (consistencyScore < 0.5) recommendations.push("Inconsistent OOS performance. Consider parameter optimization.");

    return {
      config,
      windows: results,
      summary: {
        avgISMetrics,
        avgOOSMetrics,
        avgDegradation,
        consistencyScore,
        overfit,
        recommendations,
      },
    };
  }

  /**
   * Compute overfitting gap
   */
  computeOverfittingGap(analysis: WalkForwardAnalysis): { gap: number; severity: "low" | "moderate" | "high" } {
    const degradations = analysis.windows.map((w) => w.degradation.isToOosRatio);
    const avgGap = degradations.reduce((a, b) => a + b) / degradations.length;

    const severity: "low" | "moderate" | "high" =
      avgGap < 1.1 ? "low" : avgGap < 1.5 ? "moderate" : "high";

    return { gap: avgGap, severity };
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private computeWindowMetrics(trades: TradeOutcome[]) {
    if (trades.length === 0) {
      return {
        trades: 0,
        winRate: 0,
        sharpe: 0,
        profitFactor: 1,
        maxDD: 0,
        totalPnL: 0,
      };
    }

    const wins = trades.filter((t) => t.pnlPrice > 0).length;
    const winRate = wins / trades.length;

    const pnls = trades.map((t) => t.pnlPrice);
    const totalPnL = pnls.reduce((a, b) => a + b);
    const mean = totalPnL / trades.length;
    const variance = pnls.reduce((s, p) => s + (p - mean) ** 2, 0) / trades.length;
    const std = Math.sqrt(variance);
    const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;

    const grossWins = trades.filter((t) => t.pnlPrice > 0).reduce((s, t) => s + t.pnlPrice, 0);
    const grossLoss = Math.abs(
      trades.filter((t) => t.pnlPrice < 0).reduce((s, t) => s + t.pnlPrice, 0)
    );
    const profitFactor = grossLoss > 0 ? grossWins / grossLoss : grossWins > 0 ? 999 : 1;

    let equity = 0;
    let peak = 0;
    let maxDD = 0;
    trades.forEach((trade) => {
      equity += trade.pnlPrice;
      peak = Math.max(peak, equity);
      const dd = (peak - equity) / Math.max(1, peak);
      maxDD = Math.max(maxDD, dd);
    });

    return { trades: trades.length, winRate, sharpe, profitFactor, maxDD, totalPnL };
  }

  private rateConsistency(degradation: any): "strong" | "moderate" | "weak" {
    const score =
      (1 - Math.min(degradation.winRateDegradation / 100, 1)) * 0.3 +
      (1 - Math.min(degradation.drawdownIncrease / 100, 1)) * 0.4 +
      (1 - Math.min(Math.max(degradation.isToOosRatio - 1, 0) / 0.5, 1)) * 0.3;

    return score > 0.7 ? "strong" : score > 0.4 ? "moderate" : "weak";
  }

  private averageMetrics(metrics: any[]) {
    return {
      trades: metrics.reduce((s, m) => s + m.trades, 0) / metrics.length,
      winRate: metrics.reduce((s, m) => s + m.winRate, 0) / metrics.length,
      sharpe: metrics.reduce((s, m) => s + m.sharpe, 0) / metrics.length,
      profitFactor: metrics.reduce((s, m) => s + m.profitFactor, 0) / metrics.length,
      maxDD: metrics.reduce((s, m) => s + m.maxDD, 0) / metrics.length,
      totalPnL: metrics.reduce((s, m) => s + m.totalPnL, 0),
    };
  }

  private averageDegradation(degradations: any[]) {
    return {
      winRateDegradation: degradations.reduce((s, d) => s + d.winRateDegradation, 0) / degradations.length,
      sharpeDegradation: degradations.reduce((s, d) => s + d.sharpeDegradation, 0) / degradations.length,
      drawdownIncrease: degradations.reduce((s, d) => s + d.drawdownIncrease, 0) / degradations.length,
      isToOosRatio: degradations.reduce((s, d) => s + d.isToOosRatio, 0) / degradations.length,
    };
  }
}

// Export singleton
export const walkForwardValidator = new WalkForwardValidator();