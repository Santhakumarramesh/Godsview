// CalibrationTracker: Continuous backtest-to-live truth tracking
// Compares expected (backtest) vs actual (live) across all dimensions
// Single source of truth for model fidelity and drift detection

import { Logger } from '../logging/logger';

export interface SlippageMetric {
  expectedBps: number;
  actualBps: number;
  discrepancyBps: number;
  count: number;
  rollingAverage: number;
  byTimeOfDay: Record<string, { expected: number; actual: number }>;
  byVolatilityRegime: Record<string, { expected: number; actual: number }>;
  timestamp: Date;
}

export interface FillQualityMetric {
  expectedFillRate: number;
  actualFillRate: number;
  partialFillFrequency: number;
  rejectedOrderRate: number;
  timestamp: Date;
}

export interface DrawdownMetric {
  backtestPredictedMaxDD: number;
  actualMaxDD: number;
  backtestPredictedRunup: number;
  actualRunup: number;
  recoveryDays: number;
  timestamp: Date;
}

export interface RegimeBreakdown {
  regimeType: string;
  backtestAssumedFrequency: number;
  actualFrequency: number;
  performanceDrift: number;
  sharpeInBacktest: number;
  sharpeInLive: number;
}

export interface SignalAccuracy {
  predictedHitRate: number;
  actualHitRate: number;
  false_positives: number;
  false_negatives: number;
  precision: number;
  recall: number;
  f1Score: number;
  timestamp: Date;
}

export interface PnLDivergence {
  backtestExpectedCumulativePnL: number;
  actualCumulativePnL: number;
  percentDivergence: number;
  equity_curve_correlation: number;
  drawdown_correlation: number;
  timestamp: Date;
}

export interface TradeComparison {
  tradeId: string;
  symbol: string;
  backtestExpected: {
    entryPrice: number;
    exitPrice: number;
    expectedPnL: number;
    expectedDuration: number;
  };
  liveActual: {
    entryPrice: number;
    exitPrice: number;
    actualPnL: number;
    actualDuration: number;
  };
  slippageBps: number;
  fillQuality: number;
  timestamp: Date;
}

export interface CalibrationReport {
  period: string;
  generatedAt: Date;
  overallScore: number;
  slippageHealth: SlippageMetric;
  fillQualityHealth: FillQualityMetric;
  drawdownHealth: DrawdownMetric;
  regimeHealth: RegimeBreakdown[];
  signalAccuracyHealth: SignalAccuracy;
  pnlDivergenceHealth: PnLDivergence;
  driftAlerts: DriftAlert[];
  perSymbolScores: Record<string, number>;
  perRegimeScores: Record<string, number>;
  suggestedActions: string[];
}

export interface DriftAlert {
  dimension: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  expectedValue: number;
  actualValue: number;
  divergence: number;
  threshold: number;
  triggeredAt: Date;
  description: string;
}

export interface CalibrationFix {
  dimension: string;
  currentValue: number;
  suggestedValue: number;
  rationale: string;
  confidence: number;
  estimatedImpact: string;
}

export class CalibrationTracker {
  private logger: Logger;
  private tradeHistory: TradeComparison[] = [];
  private slippageHistory: SlippageMetric[] = [];
  private fillQualityHistory: FillQualityMetric[] = [];
  private drawdownHistory: DrawdownMetric[] = [];
  private regimeBreakdowns: Map<string, RegimeBreakdown> = new Map();
  private signalAccuracyHistory: SignalAccuracy[] = [];
  private pnlDivergenceHistory: PnLDivergence[] = [];
  private driftAlerts: DriftAlert[] = [];

  private slippageThresholdBps = 15;
  private fillRateThreshold = 0.85;
  private drawdownThreshold = 1.3; // 30% worse than backtest
  private correlationThreshold = 0.65;
  private signalAccuracyThreshold = 0.65;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Record a single trade comparison between backtest expectation and live actual
   */
  public recordTrade(
    tradeId: string,
    symbol: string,
    backtestExpected: {
      entryPrice: number;
      exitPrice: number;
      expectedPnL: number;
      expectedDuration: number;
    },
    liveActual: {
      entryPrice: number;
      exitPrice: number;
      actualPnL: number;
      actualDuration: number;
    }
  ): void {
    const slippageBps =
      Math.abs(liveActual.entryPrice - backtestExpected.entryPrice) /
      backtestExpected.entryPrice *
      10000;
    const fillQuality = Math.max(0, 1 - slippageBps / 100);

    const comparison: TradeComparison = {
      tradeId,
      symbol,
      backtestExpected,
      liveActual,
      slippageBps,
      fillQuality,
      timestamp: new Date(),
    };

    this.tradeHistory.push(comparison);

    // Update slippage metrics
    this.updateSlippageMetric(symbol, slippageBps);

    // Update fill quality
    this.updateFillQuality(fillQuality);

    // Check for slippage drift
    if (slippageBps > this.slippageThresholdBps) {
      this.recordDriftAlert(
        'SLIPPAGE',
        backtestExpected.entryPrice,
        liveActual.entryPrice,
        slippageBps,
        this.slippageThresholdBps,
        `Trade ${tradeId} experienced ${slippageBps.toFixed(2)}bps slippage`
      );
    }

    this.logger.debug(
      `Recorded trade ${tradeId}: ${slippageBps.toFixed(2)}bps slippage`
    );
  }

  /**
   * Record drawdown comparison (backtest predicted vs actual experienced)
   */
  public recordDrawdown(
    backtestPredictedMaxDD: number,
    actualMaxDD: number,
    backtestPredictedRunup: number,
    actualRunup: number,
    recoveryDays: number
  ): void {
    const metric: DrawdownMetric = {
      backtestPredictedMaxDD,
      actualMaxDD,
      backtestPredictedRunup,
      actualRunup,
      recoveryDays,
      timestamp: new Date(),
    };

    this.drawdownHistory.push(metric);

    const ddRatio = actualMaxDD / Math.max(backtestPredictedMaxDD, 0.001);
    if (ddRatio > this.drawdownThreshold) {
      this.recordDriftAlert(
        'DRAWDOWN',
        backtestPredictedMaxDD,
        actualMaxDD,
        ddRatio,
        this.drawdownThreshold,
        `Actual max drawdown ${(actualMaxDD * 100).toFixed(2)}% vs predicted ${(backtestPredictedMaxDD * 100).toFixed(2)}%`
      );
    }
  }

  /**
   * Record regime breakdown: expected frequency vs actual observed
   */
  public recordRegimeBreakdown(
    regimeType: string,
    backtestAssumedFrequency: number,
    actualFrequency: number,
    performanceDrift: number,
    sharpeInBacktest: number,
    sharpeInLive: number
  ): void {
    const breakdown: RegimeBreakdown = {
      regimeType,
      backtestAssumedFrequency,
      actualFrequency,
      performanceDrift,
      sharpeInBacktest,
      sharpeInLive,
    };

    this.regimeBreakdowns.set(regimeType, breakdown);

    const frequencyDrift = Math.abs(
      (actualFrequency - backtestAssumedFrequency) /
        Math.max(backtestAssumedFrequency, 0.01)
    );

    if (frequencyDrift > 0.3) {
      this.recordDriftAlert(
        'REGIME_DISTRIBUTION',
        backtestAssumedFrequency,
        actualFrequency,
        frequencyDrift,
        0.3,
        `Regime ${regimeType} frequency drift: expected ${(backtestAssumedFrequency * 100).toFixed(1)}%, actual ${(actualFrequency * 100).toFixed(1)}%`
      );
    }

    if (Math.abs(performanceDrift) > 0.15) {
      this.recordDriftAlert(
        'REGIME_PERFORMANCE',
        sharpeInBacktest,
        sharpeInLive,
        performanceDrift,
        0.15,
        `Regime ${regimeType} Sharpe drift: ${sharpeInBacktest.toFixed(2)} vs ${sharpeInLive.toFixed(2)}`
      );
    }
  }

  /**
   * Record signal accuracy metrics
   */
  public recordSignalAccuracy(
    predictedHitRate: number,
    actualHitRate: number,
    false_positives: number,
    false_negatives: number
  ): void {
    const total = false_positives + false_negatives + actualHitRate;
    const precision = total > 0 ? actualHitRate / (actualHitRate + false_positives) : 0;
    const recall = total > 0 ? actualHitRate / (actualHitRate + false_negatives) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    const metric: SignalAccuracy = {
      predictedHitRate,
      actualHitRate,
      false_positives,
      false_negatives,
      precision,
      recall,
      f1Score: f1,
      timestamp: new Date(),
    };

    this.signalAccuracyHistory.push(metric);

    if (actualHitRate < this.signalAccuracyThreshold) {
      this.recordDriftAlert(
        'SIGNAL_ACCURACY',
        predictedHitRate,
        actualHitRate,
        Math.abs(predictedHitRate - actualHitRate),
        this.signalAccuracyThreshold,
        `Signal hit rate ${(actualHitRate * 100).toFixed(1)}% vs predicted ${(predictedHitRate * 100).toFixed(1)}%`
      );
    }
  }

  /**
   * Record PnL divergence between backtest and live
   */
  public recordPnLDivergence(
    backtestExpectedCumulativePnL: number,
    actualCumulativePnL: number,
    equity_curve_correlation: number,
    drawdown_correlation: number
  ): void {
    const percentDivergence =
      Math.abs(actualCumulativePnL - backtestExpectedCumulativePnL) /
      Math.max(Math.abs(backtestExpectedCumulativePnL), 1);

    const metric: PnLDivergence = {
      backtestExpectedCumulativePnL,
      actualCumulativePnL,
      percentDivergence,
      equity_curve_correlation,
      drawdown_correlation,
      timestamp: new Date(),
    };

    this.pnlDivergenceHistory.push(metric);

    if (equity_curve_correlation < this.correlationThreshold) {
      this.recordDriftAlert(
        'PNL_DIVERGENCE',
        backtestExpectedCumulativePnL,
        actualCumulativePnL,
        percentDivergence,
        0.2,
        `Equity curve correlation ${equity_curve_correlation.toFixed(2)} below threshold`
      );
    }
  }

  /**
   * Get comprehensive calibration report for last N days
   */
  public getCalibrationReport(days: number): CalibrationReport {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const recentTrades = this.tradeHistory.filter((t) => t.timestamp > cutoff);
    const recentSlippage = this.slippageHistory.filter((s) => s.timestamp > cutoff);
    const recentFillQuality = this.fillQualityHistory.filter((f) => f.timestamp > cutoff);
    const recentDrawdown = this.drawdownHistory.filter((d) => d.timestamp > cutoff);
    const recentSignalAccuracy = this.signalAccuracyHistory.filter(
      (s) => s.timestamp > cutoff
    );
    const recentPnLDivergence = this.pnlDivergenceHistory.filter((p) => p.timestamp > cutoff);
    const activeAlerts = this.driftAlerts.filter((a) => a.triggeredAt > cutoff);

    const latestSlippage = recentSlippage[recentSlippage.length - 1] || ({} as SlippageMetric);
    const latestFillQuality =
      recentFillQuality[recentFillQuality.length - 1] || ({} as FillQualityMetric);
    const latestDrawdown = recentDrawdown[recentDrawdown.length - 1] || ({} as DrawdownMetric);
    const latestSignalAccuracy =
      recentSignalAccuracy[recentSignalAccuracy.length - 1] || ({} as SignalAccuracy);
    const latestPnLDivergence =
      recentPnLDivergence[recentPnLDivergence.length - 1] || ({} as PnLDivergence);

    const perSymbolScores = this.computePerSymbolScores(recentTrades);
    const perRegimeScores = this.computePerRegimeScores();

    const overallScore = this.computeOverallScore(
      latestSlippage,
      latestFillQuality,
      latestDrawdown,
      latestSignalAccuracy,
      latestPnLDivergence
    );

    const suggestedActions = this.generateSuggestedActions(
      latestSlippage,
      latestDrawdown,
      activeAlerts
    );

    return {
      period: `${days} days`,
      generatedAt: new Date(),
      overallScore,
      slippageHealth: latestSlippage,
      fillQualityHealth: latestFillQuality,
      drawdownHealth: latestDrawdown,
      regimeHealth: Array.from(this.regimeBreakdowns.values()),
      signalAccuracyHealth: latestSignalAccuracy,
      pnlDivergenceHealth: latestPnLDivergence,
      driftAlerts: activeAlerts,
      perSymbolScores,
      perRegimeScores,
      suggestedActions,
    };
  }

  /**
   * Single 0-100 calibration score
   */
  public getCalibrationScore(): number {
    const recentReport = this.getCalibrationReport(30);
    return Math.max(0, Math.min(100, recentReport.overallScore));
  }

  /**
   * Get drift alert if calibration has degraded beyond threshold
   */
  public getDriftAlert(): DriftAlert | null {
    const criticalAlerts = this.driftAlerts
      .filter((a) => a.severity === 'CRITICAL')
      .sort((a, b) => b.triggeredAt.getTime() - a.triggeredAt.getTime());

    if (criticalAlerts.length > 0) {
      return criticalAlerts[0];
    }

    const highAlerts = this.driftAlerts
      .filter((a) => a.severity === 'HIGH')
      .sort((a, b) => b.triggeredAt.getTime() - a.triggeredAt.getTime());

    return highAlerts.length > 0 ? highAlerts[0] : null;
  }

  /**
   * Per-symbol calibration scores
   */
  public getPerSymbolCalibration(): Record<string, number> {
    return this.computePerSymbolScores(this.tradeHistory);
  }

  /**
   * Per-regime calibration scores
   */
  public getPerRegimeCalibration(): Record<string, number> {
    return this.computePerRegimeScores();
  }

  /**
   * Suggest calibration fixes based on observed drift
   */
  public suggestCalibrationFixes(): CalibrationFix[] {
    const fixes: CalibrationFix[] = [];
    const recentReport = this.getCalibrationReport(30);

    if (recentReport.slippageHealth && recentReport.slippageHealth.discrepancyBps) {
      const discrepancy = recentReport.slippageHealth.discrepancyBps;
      fixes.push({
        dimension: 'SLIPPAGE_ASSUMPTION',
        currentValue: recentReport.slippageHealth.expectedBps,
        suggestedValue: recentReport.slippageHealth.actualBps,
        rationale: `Actual slippage ${recentReport.slippageHealth.actualBps.toFixed(2)}bps exceeds backtest assumption by ${discrepancy.toFixed(2)}bps`,
        confidence: 0.85,
        estimatedImpact: 'More conservative entry/exit modeling required',
      });
    }

    if (recentReport.drawdownHealth && recentReport.drawdownHealth.actualMaxDD) {
      const ratio =
        recentReport.drawdownHealth.actualMaxDD /
        Math.max(recentReport.drawdownHealth.backtestPredictedMaxDD, 0.001);
      if (ratio > 1.2) {
        fixes.push({
          dimension: 'DRAWDOWN_TOLERANCE',
          currentValue: recentReport.drawdownHealth.backtestPredictedMaxDD,
          suggestedValue: recentReport.drawdownHealth.actualMaxDD,
          rationale: `Actual max DD ${(recentReport.drawdownHealth.actualMaxDD * 100).toFixed(2)}% vs backtest ${(recentReport.drawdownHealth.backtestPredictedMaxDD * 100).toFixed(2)}%`,
          confidence: 0.9,
          estimatedImpact: 'Stricter position sizing or wider stop-losses needed',
        });
      }
    }

    if (recentReport.signalAccuracyHealth && recentReport.signalAccuracyHealth.actualHitRate) {
      if (
        recentReport.signalAccuracyHealth.actualHitRate <
        recentReport.signalAccuracyHealth.predictedHitRate * 0.8
      ) {
        fixes.push({
          dimension: 'SIGNAL_GENERATION',
          currentValue: recentReport.signalAccuracyHealth.predictedHitRate,
          suggestedValue: recentReport.signalAccuracyHealth.actualHitRate,
          rationale: `Signal accuracy degraded from ${(recentReport.signalAccuracyHealth.predictedHitRate * 100).toFixed(1)}% to ${(recentReport.signalAccuracyHealth.actualHitRate * 100).toFixed(1)}%`,
          confidence: 0.75,
          estimatedImpact: 'Review feature engineering and market condition assumptions',
        });
      }
    }

    return fixes;
  }

  // ========== Private helpers ==========

  private updateSlippageMetric(symbol: string, slippageBps: number): void {
    const now = new Date();
    const hour = now.getHours().toString();
    const volatilityRegime = this.estimateVolatilityRegime();

    const latest = this.slippageHistory[this.slippageHistory.length - 1];

    const metric: SlippageMetric = {
      expectedBps: latest?.expectedBps || 10,
      actualBps: slippageBps,
      discrepancyBps: slippageBps - (latest?.expectedBps || 10),
      count: (latest?.count || 0) + 1,
      rollingAverage:
        (latest?.rollingAverage || 0) * 0.95 + slippageBps * 0.05,
      byTimeOfDay: {
        ...(latest?.byTimeOfDay || {}),
        [hour]: {
          expected: latest?.byTimeOfDay?.[hour]?.expected || 10,
          actual: slippageBps,
        },
      },
      byVolatilityRegime: {
        ...(latest?.byVolatilityRegime || {}),
        [volatilityRegime]: {
          expected: latest?.byVolatilityRegime?.[volatilityRegime]?.expected || 10,
          actual: slippageBps,
        },
      },
      timestamp: now,
    };

    this.slippageHistory.push(metric);
  }

  private updateFillQuality(fillQuality: number): void {
    const latest = this.fillQualityHistory[this.fillQualityHistory.length - 1];

    const metric: FillQualityMetric = {
      expectedFillRate: latest?.expectedFillRate || 0.95,
      actualFillRate: (latest?.actualFillRate || 0.95) * 0.9 + fillQuality * 0.1,
      partialFillFrequency:
        fillQuality < 0.95 ? (latest?.partialFillFrequency || 0) + 1 : latest?.partialFillFrequency || 0,
      rejectedOrderRate: latest?.rejectedOrderRate || 0,
      timestamp: new Date(),
    };

    this.fillQualityHistory.push(metric);
  }

  private recordDriftAlert(
    dimension: string,
    expectedValue: number,
    actualValue: number,
    divergence: number,
    threshold: number,
    description: string
  ): void {
    let severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';

    if (divergence > threshold * 3) {
      severity = 'CRITICAL';
    } else if (divergence > threshold * 2) {
      severity = 'HIGH';
    } else if (divergence > threshold * 1.5) {
      severity = 'MEDIUM';
    }

    const alert: DriftAlert = {
      dimension,
      severity,
      expectedValue,
      actualValue,
      divergence,
      threshold,
      triggeredAt: new Date(),
      description,
    };

    this.driftAlerts.push(alert);
    this.logger.warn(`Drift alert [${severity}] ${description}`);
  }

  private estimateVolatilityRegime(): string {
    const recentTrades = this.tradeHistory.slice(-100);
    if (recentTrades.length === 0) return 'UNKNOWN';

    const avgSlippage =
      recentTrades.reduce((sum, t) => sum + t.slippageBps, 0) / recentTrades.length;

    if (avgSlippage > 20) return 'HIGH';
    if (avgSlippage > 10) return 'MEDIUM';
    return 'LOW';
  }

  private computePerSymbolScores(trades: TradeComparison[]): Record<string, number> {
    const scores: Record<string, number> = {};

    const bySymbol = new Map<string, TradeComparison[]>();
    trades.forEach((t) => {
      if (!bySymbol.has(t.symbol)) bySymbol.set(t.symbol, []);
      bySymbol.get(t.symbol)!.push(t);
    });

    bySymbol.forEach((symbolTrades, symbol) => {
      const avgSlippage =
        symbolTrades.reduce((sum, t) => sum + t.slippageBps, 0) / symbolTrades.length;
      const avgFillQuality =
        symbolTrades.reduce((sum, t) => sum + t.fillQuality, 0) / symbolTrades.length;

      const slippageScore = Math.max(0, 100 - avgSlippage * 2);
      const fillScore = avgFillQuality * 100;
      scores[symbol] = (slippageScore + fillScore) / 2;
    });

    return scores;
  }

  private computePerRegimeScores(): Record<string, number> {
    const scores: Record<string, number> = {};

    this.regimeBreakdowns.forEach((breakdown, regime) => {
      const frequencyScore = Math.max(
        0,
        100 - Math.abs(breakdown.actualFrequency - breakdown.backtestAssumedFrequency) * 100
      );
      const sharpeScore = Math.max(
        0,
        100 - Math.abs(breakdown.sharpeInLive - breakdown.sharpeInBacktest) * 50
      );
      scores[regime] = (frequencyScore + sharpeScore) / 2;
    });

    return scores;
  }

  private computeOverallScore(
    slippage: SlippageMetric,
    fillQuality: FillQualityMetric,
    drawdown: DrawdownMetric,
    signalAccuracy: SignalAccuracy,
    pnlDivergence: PnLDivergence
  ): number {
    let score = 100;

    if (slippage.discrepancyBps !== undefined) {
      const slippageScore = Math.max(0, 100 - slippage.discrepancyBps * 2);
      score = score * 0.2 + slippageScore * 0.2;
    }

    if (fillQuality.actualFillRate !== undefined) {
      const fillScore = fillQuality.actualFillRate * 100;
      score = score * 0.8 + fillScore * 0.2;
    }

    if (drawdown.actualMaxDD !== undefined) {
      const ddRatio = drawdown.actualMaxDD / Math.max(drawdown.backtestPredictedMaxDD, 0.001);
      const ddScore = Math.max(0, 100 - (ddRatio - 1) * 50);
      score = score * 0.8 + ddScore * 0.2;
    }

    if (signalAccuracy.actualHitRate !== undefined) {
      const signalScore = signalAccuracy.actualHitRate * 100;
      score = score * 0.8 + signalScore * 0.2;
    }

    if (pnlDivergence.equity_curve_correlation !== undefined) {
      const correlationScore = pnlDivergence.equity_curve_correlation * 100;
      score = score * 0.8 + correlationScore * 0.2;
    }

    return Math.max(0, Math.min(100, score));
  }

  private generateSuggestedActions(
    slippage: SlippageMetric,
    drawdown: DrawdownMetric,
    alerts: DriftAlert[]
  ): string[] {
    const actions: string[] = [];

    if (slippage.discrepancyBps !== undefined && slippage.discrepancyBps > 5) {
      actions.push(
        `Review order execution logic: slippage ${slippage.discrepancyBps.toFixed(2)}bps above expectation`
      );
    }

    if (drawdown.actualMaxDD !== undefined) {
      const ratio = drawdown.actualMaxDD / Math.max(drawdown.backtestPredictedMaxDD, 0.001);
      if (ratio > 1.25) {
        actions.push(`Recalibrate position sizing: actual DD ${ratio.toFixed(2)}x backtest`);
      }
    }

    alerts.slice(0, 3).forEach((alert) => {
      actions.push(`Address ${alert.dimension} drift: ${alert.description}`);
    });

    return actions;
  }
}
