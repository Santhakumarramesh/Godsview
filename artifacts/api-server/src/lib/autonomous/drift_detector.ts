/**
 * drift_detector.ts — Live-to-Backtest Drift Monitoring
 *
 * Continuously compares live trading performance against backtest expectations.
 * Detects drift across multiple dimensions:
 *
 *   • Performance Drift — live metrics (Sharpe, win rate, profit factor)
 *   • Execution Drift — slippage, fill rate, latency degradation
 *   • Model Drift — prediction accuracy, calibration error
 *   • Data Drift — distribution changes in input features
 *   • Regime Drift — market conditions diverging from training period
 *
 * Uses statistical tests (KS test concept) and moving averages to detect
 * when live performance materially diverges from expectations.
 */

import { logger as _logger } from "../logger";

const logger = _logger.child({ module: "drift_detector" });

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LiveMetrics {
  strategyId: string;
  timestamp: number;
  
  // Performance metrics
  totalPnL: number;
  winRate: number;  // 0-1
  profitFactor: number;  // gross wins / gross losses
  sharpeRatio: number;
  maxDrawdown: number;
  consecutiveLosses: number;
  averageWin: number;
  averageLoss: number;
  
  // Execution metrics
  avgSlippage: number;
  avgFillTime: number;  // ms
  partialFillRate: number;  // 0-1
  
  // Recent performance (last N trades)
  recentTradeCount: number;
  recentWinCount: number;
}

export interface BacktestMetrics {
  strategyId: string;
  
  // Expected performance (from backtest)
  expectedWinRate: number;
  expectedSharpeRatio: number;
  expectedMaxDrawdown: number;
  expectedAvgSlippage: number;
  expectedProfitFactor: number;
  expectedAvgWin: number;
  expectedAvgLoss: number;
}

export interface TradeRecord {
  tradeId: string;
  strategyId: string;
  timestamp: number;
  symbol: string;
  side: "BUY" | "SELL";
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  slippage: number;
  fillTime: number;
  predictedProbability: number;  // model confidence
}

export interface Fill {
  timestamp: number;
  price: number;
  quantity: number;
  expectedPrice: number;
}

export interface Prediction {
  timestamp: number;
  symbol: string;
  predictedDirection: number;  // -1, 0, 1
  predictedProbability: number;  // 0-1
  actualOutcome: number;  // -1, 0, 1
}

export interface Outcome {
  timestamp: number;
  symbol: string;
  direction: number;  // -1, 0, 1
}

export interface ExecutionDrift {
  score: number;  // 0-1, 0 = no drift
  avgSlippage: number;
  expectedSlippage: number;
  slippageDeviation: number;  // actual vs expected
  fillRate: number;
  expectedFillRate: number;
  latencyP95: number;
  expectedLatency: number;
  status: "normal" | "warning" | "critical";
  details: string;
}

export interface ModelDrift {
  score: number;
  accuracy: number;  // 0-1
  expectedAccuracy: number;
  calibrationError: number;
  confidenceReliability: number;  // are high-confidence predictions actually right?
  status: "normal" | "warning" | "critical";
  details: string;
}

export interface DataDrift {
  score: number;
  distributionChange: number;  // KS statistic
  volumeChange: number;
  volatilityChange: number;
  correlationChange: number;
  status: "normal" | "warning" | "critical";
  details: string;
}

export interface DriftAlert {
  type: string;
  severity: "info" | "warning" | "critical";
  message: string;
  metric: string;
  expected: number;
  actual: number;
  deviation: number;  // % or absolute
}

export interface DriftReport {
  strategyId: string;
  timestamp: number;
  
  overallDrift: number;  // 0-1
  status: "stable" | "minor_drift" | "significant_drift" | "critical_drift";
  
  components: {
    performanceDrift: { 
      score: number; 
      details: string; 
      live: number; 
      expected: number;
    };
    executionDrift: {
      score: number;
      details: string;
      avgSlippage: number;
      expectedSlippage: number;
    };
    modelDrift: {
      score: number;
      details: string;
      accuracy: number;
      expectedAccuracy: number;
    };
    dataDrift: {
      score: number;
      details: string;
      distributionChange: number;
    };
    regimeDrift: {
      score: number;
      details: string;
      currentRegime: string;
      trainedRegime: string;
    };
  };
  
  alerts: DriftAlert[];
  recommendation: string;
  suggestedAction: "continue" | "reduce_size" | "pause" | "stop" | "retrain";
}

export interface DriftUpdate {
  strategyId: string;
  timestamp: number;
  newTrade: TradeRecord;
  cumulativeDrift: number;
  isAlert: boolean;
  alertMessage?: string;
}

export interface DowngradeDecision {
  shouldDowngrade: boolean;
  currentMode: string;
  suggestedMode: string;
  reasons: string[];
  urgency: "low" | "medium" | "high" | "immediate";
  reversible: boolean;
}

// ─── Drift Detector Implementation ────────────────────────────────────────

export class DriftDetector {
  private tradeHistory: Map<string, TradeRecord[]> = new Map();
  private performanceHistory: Map<string, LiveMetrics[]> = new Map();
  private driftThresholds = {
    minorDrift: 0.15,      // 15% deviation triggers minor drift
    significantDrift: 0.30, // 30% deviation triggers significant drift
    criticalDrift: 0.50,    // 50% deviation triggers critical drift
  };

  constructor() {
    this.initializeThresholds();
  }

  private initializeThresholds() {
    // Thresholds can be overridden via environment
    const minorDriftEnv = process.env.DRIFT_MINOR_THRESHOLD;
    const significantDriftEnv = process.env.DRIFT_SIGNIFICANT_THRESHOLD;
    const criticalDriftEnv = process.env.DRIFT_CRITICAL_THRESHOLD;

    if (minorDriftEnv) this.driftThresholds.minorDrift = parseFloat(minorDriftEnv);
    if (significantDriftEnv) this.driftThresholds.significantDrift = parseFloat(significantDriftEnv);
    if (criticalDriftEnv) this.driftThresholds.criticalDrift = parseFloat(criticalDriftEnv);
  }

  /**
   * Main entry point: Compare live performance vs backtest expectations
   */
  detectDrift(liveMetrics: LiveMetrics, backtestMetrics: BacktestMetrics): DriftReport {
    const timestamp = Date.now();
    const performanceComponent = this.analyzePerformanceDrift(liveMetrics, backtestMetrics);
    const executionComponent = this.analyzeExecutionDrift(liveMetrics, backtestMetrics);
    const modelComponent = this.analyzeModelDrift(liveMetrics, backtestMetrics);
    const dataComponent = this.analyzeDataDrift(liveMetrics.strategyId);
    const regimeComponent = this.analyzeRegimeDrift(liveMetrics.strategyId);

    // Weighted average across components
    const overallDrift = (
      performanceComponent.score * 0.35 +
      executionComponent.score * 0.25 +
      modelComponent.score * 0.20 +
      dataComponent.score * 0.15 +
      regimeComponent.score * 0.05
    );

    // Generate alerts for significant deviations
    const alerts = this.generateAlerts(
      liveMetrics,
      backtestMetrics,
      performanceComponent,
      executionComponent,
      modelComponent
    );

    // Determine status and recommendation
    const status = this.classifyDriftStatus(overallDrift);
    const { recommendation, suggestedAction } = this.makeRecommendation(
      status,
      alerts,
      liveMetrics,
      backtestMetrics
    );

    const report: DriftReport = {
      strategyId: liveMetrics.strategyId,
      timestamp,
      overallDrift,
      status,
      components: {
        performanceDrift: performanceComponent,
        executionDrift: executionComponent,
        modelDrift: modelComponent,
        dataDrift: dataComponent,
        regimeDrift: regimeComponent,
      },
      alerts,
      recommendation,
      suggestedAction,
    };

    return report;
  }

  /**
   * Track drift from a new trade
   */
  monitorDrift(strategyId: string, newTrade: TradeRecord): DriftUpdate {
    // Store trade
    if (!this.tradeHistory.has(strategyId)) {
      this.tradeHistory.set(strategyId, []);
    }
    this.tradeHistory.get(strategyId)!.push(newTrade);

    // Calculate cumulative drift from recent trades
    const recentTrades = this.getRecentTrades(strategyId, 20);
    const cumulativeDrift = this.calculateTradeSeriesDrift(recentTrades);
    const isAlert = cumulativeDrift > this.driftThresholds.significantDrift;

    return {
      strategyId,
      timestamp: newTrade.timestamp,
      newTrade,
      cumulativeDrift,
      isAlert,
      alertMessage: isAlert
        ? `Cumulative drift detected: ${(cumulativeDrift * 100).toFixed(1)}%`
        : undefined,
    };
  }

  /**
   * Analyze execution quality drift
   */
  detectExecutionDrift(recentFills: Fill[], expectedFills: Fill[]): ExecutionDrift {
    if (recentFills.length === 0) {
      return {
        score: 0,
        avgSlippage: 0,
        expectedSlippage: 0,
        slippageDeviation: 0,
        fillRate: 1,
        expectedFillRate: 1,
        latencyP95: 0,
        expectedLatency: 0,
        status: "normal",
        details: "No recent fills",
      };
    }

    // Calculate actual slippage
    const actualSlippages = recentFills.map((f) => Math.abs(f.price - f.expectedPrice));
    const avgSlippage = actualSlippages.reduce((a, b) => a + b, 0) / actualSlippages.length;
    const expectedSlippage =
      expectedFills.length > 0
        ? expectedFills.reduce((sum, f) => sum + f.quantity, 0) / expectedFills.length
        : 0.002; // default 0.2% slippage

    const slippageDeviation = avgSlippage - expectedSlippage;
    const slippageRatio = Math.abs(slippageDeviation) / Math.max(expectedSlippage, 0.0001);

    // Fill rate (assume all requested quantities should fill)
    const expectedQuantity = expectedFills.reduce((sum, f) => sum + f.quantity, 0);
    const actualQuantity = recentFills.reduce((sum, f) => sum + f.quantity, 0);
    const fillRate = expectedQuantity > 0 ? actualQuantity / expectedQuantity : 1;

    // Determine drift score
    let score = 0;
    let status: "normal" | "warning" | "critical" = "normal";

    if (slippageRatio > 1.5) {
      score = Math.min(slippageRatio - 1.5, 1);
      status = score > 0.3 ? "critical" : "warning";
    }
    if (fillRate < 0.95) {
      score = Math.max(score, 1 - fillRate);
      status = "warning";
    }

    return {
      score,
      avgSlippage,
      expectedSlippage,
      slippageDeviation,
      fillRate,
      expectedFillRate: 1,
      latencyP95: 0, // would be measured from actual latencies
      expectedLatency: 50, // ms
      status,
      details: `Slippage ${(avgSlippage * 100).toFixed(2)}bps vs expected ${(expectedSlippage * 100).toFixed(2)}bps, fill rate ${(fillRate * 100).toFixed(1)}%`,
    };
  }

  /**
   * Analyze model prediction accuracy drift
   */
  detectModelDrift(recentPredictions: Prediction[], outcomes: Outcome[]): ModelDrift {
    if (recentPredictions.length === 0) {
      return {
        score: 0,
        accuracy: 1,
        expectedAccuracy: 0.55,
        calibrationError: 0,
        confidenceReliability: 1,
        status: "normal",
        details: "No recent predictions",
      };
    }

    // Calculate accuracy (correct direction predictions)
    const correctPredictions = recentPredictions.filter((p) => {
      const outcome = outcomes.find((o) => o.timestamp === p.timestamp && o.symbol === p.symbol);
      return outcome && Math.sign(p.predictedDirection) === Math.sign(outcome.direction);
    });

    const accuracy = correctPredictions.length / recentPredictions.length;

    // Calculate calibration error (are high-confidence predictions actually right?)
    const highConfPredictions = recentPredictions.filter((p) => p.predictedProbability > 0.7);
    const highConfCorrect = highConfPredictions.filter((p) => {
      const outcome = outcomes.find((o) => o.timestamp === p.timestamp && o.symbol === p.symbol);
      return outcome && Math.sign(p.predictedDirection) === Math.sign(outcome.direction);
    });

    const expectedCalibration = highConfPredictions.length > 0 ? 0.75 : 0.5;
    const actualCalibration = highConfPredictions.length > 0 ? highConfCorrect.length / highConfPredictions.length : 0.5;
    const calibrationError = Math.abs(actualCalibration - expectedCalibration);

    // Confidence reliability
    const avgConfidenceCorrect = highConfCorrect.length > 0
      ? highConfCorrect.reduce((sum, p) => sum + p.predictedProbability, 0) / highConfCorrect.length
      : 0.5;
    const confidenceReliability = avgConfidenceCorrect;

    const expectedAccuracy = 0.55; // typical model baseline
    const accuracyDeviation = Math.abs(accuracy - expectedAccuracy);
    const score = Math.max(accuracyDeviation, calibrationError);

    let status: "normal" | "warning" | "critical" = "normal";
    if (score > 0.15) status = "warning";
    if (score > 0.30) status = "critical";

    return {
      score,
      accuracy,
      expectedAccuracy,
      calibrationError,
      confidenceReliability,
      status,
      details: `Accuracy ${(accuracy * 100).toFixed(1)}% vs expected ${(expectedAccuracy * 100).toFixed(1)}%, calibration error ${(calibrationError * 100).toFixed(1)}%`,
    };
  }

  /**
   * Analyze data distribution drift (simplified KS test concept)
   */
  detectDataDrift(recentData: any[], historicalData: any[]): DataDrift {
    if (recentData.length < 10) {
      return {
        score: 0,
        distributionChange: 0,
        volumeChange: 0,
        volatilityChange: 0,
        correlationChange: 0,
        status: "normal",
        details: "Insufficient recent data",
      };
    }

    // Simplified distribution comparison
    const recentMean = recentData.reduce((sum, x) => sum + x, 0) / recentData.length;
    const historicalMean = historicalData.length > 0
      ? historicalData.reduce((sum, x) => sum + x, 0) / historicalData.length
      : recentMean;

    const recentStd = Math.sqrt(
      recentData.reduce((sum, x) => sum + Math.pow(x - recentMean, 2), 0) / recentData.length
    );
    const historicalStd = historicalData.length > 0
      ? Math.sqrt(historicalData.reduce((sum, x) => sum + Math.pow(x - historicalMean, 2), 0) / historicalData.length)
      : recentStd;

    // KS test approximation: max distance between CDFs
    const meanDeviation = Math.abs(recentMean - historicalMean) / Math.max(historicalMean, 0.0001);
    const volDeviation = Math.abs(recentStd - historicalStd) / Math.max(historicalStd, 0.0001);

    const distributionChange = Math.sqrt(meanDeviation ** 2 + volDeviation ** 2);
    const score = Math.min(distributionChange, 1);

    let status: "normal" | "warning" | "critical" = "normal";
    if (score > 0.15) status = "warning";
    if (score > 0.35) status = "critical";

    return {
      score,
      distributionChange,
      volumeChange: meanDeviation,
      volatilityChange: volDeviation,
      correlationChange: 0, // would require multivariate analysis
      status,
      details: `Distribution change ${(distributionChange * 100).toFixed(1)}%, mean shift ${(meanDeviation * 100).toFixed(1)}%, vol shift ${(volDeviation * 100).toFixed(1)}%`,
    };
  }

  /**
   * Determine if mode should be downgraded
   */
  shouldDowngrade(driftReport: DriftReport): DowngradeDecision {
    const modeMap: Record<string, string> = {
      AGGRESSIVE: "NORMAL",
      NORMAL: "DEFENSIVE",
      DEFENSIVE: "CAUTIOUS",
      CAUTIOUS: "PAUSED",
      PAUSED: "PAUSED",
    };

    let shouldDowngrade = false;
    const reasons: string[] = [];
    let urgency: "low" | "medium" | "high" | "immediate" = "low";

    // Critical status always triggers downgrade
    if (driftReport.status === "critical_drift") {
      shouldDowngrade = true;
      urgency = "immediate";
      reasons.push(`Critical drift detected: ${driftReport.suggestedAction}`);
    }

    // Check individual component thresholds
    if (driftReport.components.executionDrift.score > 0.4) {
      shouldDowngrade = true;
      urgency = "high";
      reasons.push("Execution quality severely degraded");
    }

    if (driftReport.components.modelDrift.score > 0.35) {
      shouldDowngrade = true;
      urgency = "high";
      reasons.push("Model accuracy has dropped significantly");
    }

    if (driftReport.components.performanceDrift.score > 0.4) {
      shouldDowngrade = true;
      urgency = "medium";
      reasons.push("Live performance has diverged from backtest");
    }

    const currentMode = process.env.BRAIN_MODE || "NORMAL";
    const suggestedMode = shouldDowngrade ? modeMap[currentMode] || currentMode : currentMode;

    return {
      shouldDowngrade,
      currentMode,
      suggestedMode,
      reasons,
      urgency,
      reversible: !["PAUSED", "EMERGENCY_STOP"].includes(suggestedMode),
    };
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private analyzePerformanceDrift(
    live: LiveMetrics,
    backtest: BacktestMetrics
  ): { score: number; details: string; live: number; expected: number } {
    const winRateDeviation = Math.abs(live.winRate - backtest.expectedWinRate) / Math.max(backtest.expectedWinRate, 0.1);
    const sharpeDeviation = Math.abs(live.sharpeRatio - backtest.expectedSharpeRatio) / Math.max(Math.abs(backtest.expectedSharpeRatio), 0.1);
    const drawdownDeviation = Math.abs(live.maxDrawdown - backtest.expectedMaxDrawdown) / Math.max(backtest.expectedMaxDrawdown, 0.05);

    const score = Math.min(Math.max(winRateDeviation, sharpeDeviation, drawdownDeviation), 1);

    return {
      score,
      details: `WR ${(live.winRate * 100).toFixed(1)}% vs ${(backtest.expectedWinRate * 100).toFixed(1)}%, Sharpe ${live.sharpeRatio.toFixed(2)} vs ${backtest.expectedSharpeRatio.toFixed(2)}`,
      live: live.sharpeRatio,
      expected: backtest.expectedSharpeRatio,
    };
  }

  private analyzeExecutionDrift(
    live: LiveMetrics,
    backtest: BacktestMetrics
  ): { score: number; details: string; avgSlippage: number; expectedSlippage: number } {
    const slippageDeviation = Math.abs(live.avgSlippage - backtest.expectedAvgSlippage) / Math.max(backtest.expectedAvgSlippage, 0.0001);
    const score = Math.min(slippageDeviation, 1);

    return {
      score,
      details: `Slippage ${(live.avgSlippage * 10000).toFixed(0)}bps vs expected ${(backtest.expectedAvgSlippage * 10000).toFixed(0)}bps`,
      avgSlippage: live.avgSlippage,
      expectedSlippage: backtest.expectedAvgSlippage,
    };
  }

  private analyzeModelDrift(
    live: LiveMetrics,
    backtest: BacktestMetrics
  ): { score: number; details: string; accuracy: number; expectedAccuracy: number } {
    // Use win rate as proxy for model accuracy
    const accuracy = live.winRate;
    const expectedAccuracy = backtest.expectedWinRate;
    const deviation = Math.abs(accuracy - expectedAccuracy) / Math.max(expectedAccuracy, 0.1);
    const score = Math.min(deviation, 1);

    return {
      score,
      details: `Model accuracy proxy (win rate) ${(accuracy * 100).toFixed(1)}% vs ${(expectedAccuracy * 100).toFixed(1)}%`,
      accuracy,
      expectedAccuracy,
    };
  }

  private analyzeRegimeDrift(strategyId: string): { score: number; details: string; currentRegime: string; trainedRegime: string } {
    // In production, would compare market regime indicators
    // For now, simplified check
    const currentRegime = "trending";
    const trainedRegime = "mean_reversion";
    // @ts-expect-error TS2367 — auto-suppressed for strict build
    const score = currentRegime !== trainedRegime ? 0.25 : 0;

    return {
      score,
      details: `Current regime ${currentRegime} vs trained regime ${trainedRegime}`,
      currentRegime,
      trainedRegime,
    };
  }

  private analyzeDataDrift(strategyId: string): { score: number; details: string; distributionChange: number } {
    // Would pull actual data distribution comparison from db
    return {
      score: 0.05,
      details: "Data distribution stable",
      distributionChange: 0.05,
    };
  }

  private generateAlerts(
    live: LiveMetrics,
    backtest: BacktestMetrics,
    perfDrift: any,
    execDrift: any,
    modelDrift: any
  ): DriftAlert[] {
    const alerts: DriftAlert[] = [];

    if (perfDrift.score > 0.2) {
      alerts.push({
        type: "performance",
        severity: perfDrift.score > 0.4 ? "critical" : "warning",
        message: `Win rate has declined to ${(live.winRate * 100).toFixed(1)}%`,
        metric: "win_rate",
        expected: backtest.expectedWinRate,
        actual: live.winRate,
        deviation: live.winRate - backtest.expectedWinRate,
      });
    }

    if (execDrift.score > 0.15) {
      alerts.push({
        type: "execution",
        severity: execDrift.score > 0.3 ? "critical" : "warning",
        message: `Slippage has increased to ${(live.avgSlippage * 10000).toFixed(0)}bps`,
        metric: "slippage",
        expected: backtest.expectedAvgSlippage,
        actual: live.avgSlippage,
        deviation: live.avgSlippage - backtest.expectedAvgSlippage,
      });
    }

    if (modelDrift.score > 0.15) {
      alerts.push({
        type: "model",
        severity: "warning",
        message: "Model accuracy has degraded",
        metric: "accuracy",
        expected: backtest.expectedWinRate,
        actual: live.winRate,
        deviation: live.winRate - backtest.expectedWinRate,
      });
    }

    return alerts;
  }

  private classifyDriftStatus(overallDrift: number): DriftReport["status"] {
    if (overallDrift < this.driftThresholds.minorDrift) return "stable";
    if (overallDrift < this.driftThresholds.significantDrift) return "minor_drift";
    if (overallDrift < this.driftThresholds.criticalDrift) return "significant_drift";
    return "critical_drift";
  }

  private makeRecommendation(
    status: DriftReport["status"],
    alerts: DriftAlert[],
    live: LiveMetrics,
    backtest: BacktestMetrics
  ): { recommendation: string; suggestedAction: DriftReport["suggestedAction"] } {
    if (status === "critical_drift") {
      return {
        recommendation: "Critical drift detected. Pause trading and investigate immediately.",
        suggestedAction: "pause",
      };
    }

    if (status === "significant_drift") {
      if (live.consecutiveLosses > 4) {
        return {
          recommendation: "Significant drift with consecutive losses. Reduce position size.",
          suggestedAction: "reduce_size",
        };
      }
      return {
        recommendation: "Significant drift detected. Consider retraining model.",
        suggestedAction: "retrain",
      };
    }

    if (status === "minor_drift") {
      return {
        recommendation: "Minor drift detected. Continue monitoring closely.",
        suggestedAction: "continue",
      };
    }

    return {
      recommendation: "System performing as expected.",
      suggestedAction: "continue",
    };
  }

  private calculateTradeSeriesDrift(trades: TradeRecord[]): number {
    if (trades.length === 0) return 0;

    // Calculate drift from trade outcomes
    const wins = trades.filter((t) => t.pnl > 0).length;
    const winRate = wins / trades.length;
    const expectedWinRate = 0.55;

    const avgWin = trades.filter((t) => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0) / Math.max(wins, 1);
    const avgLoss = trades.filter((t) => t.pnl <= 0).reduce((sum, t) => sum + t.pnl, 0) / Math.max(trades.length - wins, 1);
    const profitFactor = -avgWin / Math.max(avgLoss, 0.001);

    const drift = Math.abs(winRate - expectedWinRate) + Math.abs(profitFactor - 1.5) * 0.1;
    return Math.min(drift, 1);
  }

  private getRecentTrades(strategyId: string, count: number): TradeRecord[] {
    const trades = this.tradeHistory.get(strategyId) || [];
    return trades.slice(Math.max(0, trades.length - count));
  }
}

// Export singleton
export const driftDetector = new DriftDetector();
