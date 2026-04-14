/**
 * Phase 101 — Adaptive Parameter Optimizer
 *
 * Continuously tunes MCP pipeline thresholds based on rolling performance.
 * Uses a Bayesian-inspired approach: starts with priors, updates with evidence.
 *
 * Parameters optimized:
 *   - minConfirmationScore (0.4 - 0.85)
 *   - Layer weights (structure, orderflow, context, memory, sentiment, dataQuality)
 *   - Risk per trade (0.25% - 2%)
 *   - Regime-specific overrides
 *
 * Optimization rules:
 *   1. If approval rate > 80% and win rate < 45% → raise confirmation threshold
 *   2. If approval rate < 20% and win rate > 60% → lower threshold (too selective)
 *   3. If a scoring dimension correlates with wins → increase its weight
 *   4. If a dimension doesn't predict outcomes → decrease its weight
 *   5. After N consecutive losses → tighten all thresholds temporarily
 *   6. After strong streak → relax slightly (but not too much)
 */

import type { MCPPipelineConfig } from "../tradingview_mcp/types";

/**
 * Represents a single trade outcome with scoring breakdown and result.
 */
export interface TradeOutcome {
  signalId: string;
  timestamp: Date;
  approved: boolean;
  scores: Record<string, number>; // dimension scores at decision time
  pnl: number | null; // null if not yet closed
  won: boolean | null;
  regime: string;
  signalType: string;
}

/**
 * Performance metrics for a single scoring dimension.
 */
export interface DimensionPerformance {
  dimension: string;
  winCorrelation: number; // Pearson correlation of score with wins
  avgScoreOnWins: number;
  avgScoreOnLosses: number;
  predictivePower: number; // 0-1, how well this dimension predicts outcomes
  suggestedWeight: number;
}

/**
 * Audit trail entry for parameter changes.
 */
export interface ParameterChange {
  timestamp: Date;
  parameter: string;
  oldValue: number;
  newValue: number;
  reason: string;
  triggerMetric: string;
  triggerValue: number;
}

/**
 * Full snapshot of optimizer state.
 */
export interface OptimizationState {
  currentConfig: MCPPipelineConfig;
  rollingWindow: TradeOutcome[];
  windowSize: number;
  totalOptimizations: number;
  lastOptimizedAt: Date | null;
  parameterHistory: ParameterChange[];
  performanceByDimension: Map<string, DimensionPerformance>;
}

/**
 * AdaptiveOptimizer continuously tunes MCP pipeline parameters based on observed performance.
 */
export class AdaptiveOptimizer {
  private currentConfig: MCPPipelineConfig;
  private rollingWindow: TradeOutcome[] = [];
  private windowSize: number;
  private totalOptimizations: number = 0;
  private lastOptimizedAt: Date | null = null;
  private parameterHistory: ParameterChange[] = [];
  private performanceByDimension: Map<string, DimensionPerformance> = new Map();
  private tradesSinceLastOptimization: number = 0;

  // Guard rails
  private readonly MIN_CONFIRMATION_SCORE = 0.4;
  private readonly MAX_CONFIRMATION_SCORE = 0.85;
  private readonly MIN_RISK_PER_TRADE = 0.25;
  private readonly MAX_RISK_PER_TRADE = 2.0;
  private readonly MIN_WEIGHT = 0.02;
  private readonly MAX_WEIGHT = 0.4;
  private readonly MIN_SAMPLES_FOR_OPTIMIZATION = 20;
  private readonly COOLDOWN_TRADES = 10;
  private readonly MAX_CHANGE_PER_CYCLE = 0.1; // 10% of current value

  constructor(initialConfig: MCPPipelineConfig, windowSize: number = 100) {
    this.currentConfig = { ...initialConfig };
    this.windowSize = windowSize;
    this.initializeDimensionTracking();
  }

  /**
   * Initialize performance tracking for all scoring dimensions.
   */
  private initializeDimensionTracking(): void {
    const dimensions = [
      "structure",
      "orderflow",
      "context",
      "memory",
      "sentiment",
      "dataQuality",
    ];

    for (const dim of dimensions) {
      this.performanceByDimension.set(dim, {
        dimension: dim,
        winCorrelation: 0,
        avgScoreOnWins: 0,
        avgScoreOnLosses: 0,
        predictivePower: 0.5, // neutral prior
        suggestedWeight: 0.16, // equal weight initially
      });
    }
  }

  /**
   * Record a trade outcome and trigger optimization check if conditions met.
   */
  recordOutcome(outcome: TradeOutcome): void {
    this.rollingWindow.push(outcome);
    this.tradesSinceLastOptimization++;

    // Maintain rolling window size
    if (this.rollingWindow.length > this.windowSize) {
      this.rollingWindow.shift();
    }

    // Check if optimization is warranted
    if (
      this.rollingWindow.length >= this.MIN_SAMPLES_FOR_OPTIMIZATION &&
      this.tradesSinceLastOptimization >= this.COOLDOWN_TRADES
    ) {
      this.optimize();
      this.tradesSinceLastOptimization = 0;
    }
  }

  /**
   * Run optimization rules and return list of changes made.
   */
  optimize(): ParameterChange[] {
    const changes: ParameterChange[] = [];

    if (this.rollingWindow.length < this.MIN_SAMPLES_FOR_OPTIMIZATION) {
      return changes;
    }

    // Update dimension analysis
    this.updateDimensionAnalysis();

    // Apply optimization rules
    changes.push(...this.optimizeConfirmationThreshold());
    changes.push(...this.optimizeWeights());
    changes.push(...this.optimizeRiskLevel());
    changes.push(...this.applyStreakAdjustment());

    this.totalOptimizations++;
    this.lastOptimizedAt = new Date();

    // Record all changes in history
    for (const change of changes) {
      this.parameterHistory.push(change);
    }

    return changes;
  }

  /**
   * Compute and update dimension performance metrics.
   */
  private updateDimensionAnalysis(): void {
    const approved = this.rollingWindow.filter((o) => o.approved);
    const winningOutcomes = this.rollingWindow.filter((o) => o.won === true);
    const losingOutcomes = this.rollingWindow.filter((o) => o.won === false);

    for (const [dimension, perf] of this.performanceByDimension.entries()) {
      const scoresOnWins = winningOutcomes
        .map((o) => o.scores[dimension] ?? 0)
        .filter((s) => s !== undefined);
      const scoresOnLosses = losingOutcomes
        .map((o) => o.scores[dimension] ?? 0)
        .filter((s) => s !== undefined);

      perf.avgScoreOnWins =
        scoresOnWins.length > 0
          ? scoresOnWins.reduce((a, b) => a + b, 0) / scoresOnWins.length
          : 0;

      perf.avgScoreOnLosses =
        scoresOnLosses.length > 0
          ? scoresOnLosses.reduce((a, b) => a + b, 0) / scoresOnLosses.length
          : 0;

      // Compute Pearson correlation with outcomes
      const allScores = this.rollingWindow.map((o) => o.scores[dimension] ?? 0);
      const outcomes = this.rollingWindow.map((o) => (o.won ? 1 : 0));

      perf.winCorrelation = this.computeCorrelation(allScores, outcomes);

      // Predictive power: correlation magnitude + separation of scores
      const scoreSeparation = Math.abs(perf.avgScoreOnWins - perf.avgScoreOnLosses);
      perf.predictivePower = Math.max(
        0,
        Math.abs(perf.winCorrelation) * 0.6 + (Math.min(1, scoreSeparation) * 0.4)
      );

      // Suggested weight based on predictive power
      // Normalize so weights sum to ~1.0
      perf.suggestedWeight = this.MIN_WEIGHT + perf.predictivePower * 0.3;
    }
  }

  /**
   * Optimize confirmation threshold based on approval and win rates.
   * Rule 1: If approval > 80% and win rate < 45% → raise threshold
   * Rule 2: If approval < 20% and win rate > 60% → lower threshold
   */
  private optimizeConfirmationThreshold(): ParameterChange[] {
    const changes: ParameterChange[] = [];
    const approved = this.rollingWindow.filter((o) => o.approved);
    const approvalRate = approved.length / this.rollingWindow.length;

    const winningApproved = approved.filter((o) => o.won === true);
    const winRateOnApproved =
      approved.length > 0 ? winningApproved.length / approved.length : 0;

    const oldThreshold = this.currentConfig.minConfirmationScore;
    let newThreshold = oldThreshold;
    let reason = "";
    let triggerMetric = "";
    let triggerValue = 0;

    // Rule 1: Too many approvals but poor results
    if (approvalRate > 0.8 && winRateOnApproved < 0.45) {
      const increase = Math.min(
        this.MAX_CHANGE_PER_CYCLE * oldThreshold,
        0.05
      );
      newThreshold = Math.min(
        this.MAX_CONFIRMATION_SCORE,
        oldThreshold + increase
      );
      reason = "Rule 1: High approval rate with low win rate";
      triggerMetric = "approvalRate";
      triggerValue = approvalRate;
    }

    // Rule 2: Too selective but high win rate
    if (approvalRate < 0.2 && winRateOnApproved > 0.6) {
      const decrease = Math.min(
        this.MAX_CHANGE_PER_CYCLE * oldThreshold,
        0.05
      );
      newThreshold = Math.max(
        this.MIN_CONFIRMATION_SCORE,
        oldThreshold - decrease
      );
      reason = "Rule 2: Low approval rate but high win rate when approved";
      triggerMetric = "approvalRate";
      triggerValue = approvalRate;
    }

    if (newThreshold !== oldThreshold) {
      this.currentConfig.minConfirmationScore = newThreshold;
      changes.push({
        timestamp: new Date(),
        parameter: "minConfirmationScore",
        oldValue: oldThreshold,
        newValue: newThreshold,
        reason,
        triggerMetric,
        triggerValue,
      });
    }

    return changes;
  }

  /**
   * Optimize layer weights based on dimensional predictive power.
   * Rule 3: If a dimension correlates with wins → increase weight
   * Rule 4: If dimension doesn't predict outcomes → decrease weight
   */
  private optimizeWeights(): ParameterChange[] {
    const changes: ParameterChange[] = [];
    const weights = this.currentConfig.weights || {
      structure: 0.25,
      orderflow: 0.25,
      context: 0.15,
      memory: 0.15,
      sentiment: 0.1,
      dataQuality: 0.1,
    };

    for (const [dimension, perf] of this.performanceByDimension.entries()) {
      const oldWeight = weights[dimension as keyof typeof weights] || 0.16;
      let newWeight = oldWeight;

      // Rule 3: Strong predictive power → increase weight
      if (perf.predictivePower > 0.7) {
        const increase = Math.min(
          this.MAX_CHANGE_PER_CYCLE * oldWeight,
          0.03
        );
        newWeight = Math.min(this.MAX_WEIGHT, oldWeight + increase);
      }

      // Rule 4: Poor predictive power → decrease weight
      if (perf.predictivePower < 0.3) {
        const decrease = Math.min(
          this.MAX_CHANGE_PER_CYCLE * oldWeight,
          0.02
        );
        newWeight = Math.max(this.MIN_WEIGHT, oldWeight - decrease);
      }

      if (newWeight !== oldWeight) {
        (weights[dimension as keyof typeof weights] as any) = newWeight;
        changes.push({
          timestamp: new Date(),
          parameter: `weights.${dimension}`,
          oldValue: oldWeight,
          newValue: newWeight,
          reason:
            perf.predictivePower > 0.7
              ? "Rule 3: High predictive power"
              : "Rule 4: Low predictive power",
          triggerMetric: "predictivePower",
          triggerValue: perf.predictivePower,
        });
      }
    }

    // Normalize weights to sum to 1.0
    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    if (sum > 0) {
      for (const key in weights) {
        (weights[key as keyof typeof weights] as any) /= sum;
      }
    }

    this.currentConfig.weights = weights;
    return changes;
  }

  /**
   * Optimize risk per trade based on rolling Sharpe ratio and drawdown.
   */
  private optimizeRiskLevel(): ParameterChange[] {
    const changes: ParameterChange[] = [];

    if (this.rollingWindow.length < this.MIN_SAMPLES_FOR_OPTIMIZATION) {
      return changes;
    }

    const oldRisk = this.currentConfig.riskPerTradePct;

    // Calculate rolling Sharpe
    const pnls = this.rollingWindow.map((o) => o.pnl ?? 0);
    const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
    const variance =
      pnls.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, pnls.length - 1);
    const stdDev = Math.sqrt(variance);
    const sharpe = stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : 0;

    // Calculate max drawdown
    let peak = 0;
    let cumPnl = 0;
    let maxDD = 0;
    for (const outcome of this.rollingWindow) {
      cumPnl += outcome.pnl ?? 0;
      peak = Math.max(peak, cumPnl);
      maxDD = Math.max(maxDD, peak - cumPnl);
    }

    let newRisk = oldRisk;

    // Increase risk if Sharpe is strong and drawdown is mild
    if (sharpe > 1.5 && maxDD < 2.0) {
      const increase = Math.min(this.MAX_CHANGE_PER_CYCLE * oldRisk, 0.2);
      newRisk = Math.min(this.MAX_RISK_PER_TRADE, oldRisk + increase);
    }
    // Decrease risk if Sharpe is poor or drawdown is severe
    else if (sharpe < 0.5 || maxDD > 5.0) {
      const decrease = Math.min(this.MAX_CHANGE_PER_CYCLE * oldRisk, 0.2);
      newRisk = Math.max(this.MIN_RISK_PER_TRADE, oldRisk - decrease);
    }

    if (newRisk !== oldRisk) {
      this.currentConfig.riskPerTradePct = newRisk;
      changes.push({
        timestamp: new Date(),
        parameter: "riskPerTradePct",
        oldValue: oldRisk,
        newValue: newRisk,
        reason: `Sharpe: ${sharpe.toFixed(2)}, MaxDD: ${maxDD.toFixed(2)}`,
        triggerMetric: "sharpe",
        triggerValue: sharpe,
      });
    }

    return changes;
  }

  /**
   * Apply streak-based adjustments.
   * Rule 5: After N consecutive losses → tighten thresholds
   * Rule 6: After strong streak → relax slightly
   */
  private applyStreakAdjustment(): ParameterChange[] {
    const changes: ParameterChange[] = [];

    if (this.rollingWindow.length < 5) {
      return changes;
    }

    const recentN = 5;
    const recent = this.rollingWindow.slice(-recentN);
    const losses = recent.filter((o) => o.won === false).length;
    const wins = recent.filter((o) => o.won === true).length;

    const oldThreshold = this.currentConfig.minConfirmationScore;
    let newThreshold = oldThreshold;

    // Rule 5: All recent trades are losses
    if (losses === recentN) {
      const increase = Math.min(this.MAX_CHANGE_PER_CYCLE * oldThreshold, 0.05);
      newThreshold = Math.min(
        this.MAX_CONFIRMATION_SCORE,
        oldThreshold + increase
      );

      changes.push({
        timestamp: new Date(),
        parameter: "minConfirmationScore",
        oldValue: oldThreshold,
        newValue: newThreshold,
        reason: "Rule 5: Consecutive losses detected",
        triggerMetric: "consecutiveLosses",
        triggerValue: losses,
      });
    }

    // Rule 6: Strong win streak
    if (wins === recentN) {
      const decrease = Math.min(
        this.MAX_CHANGE_PER_CYCLE * oldThreshold,
        0.03
      );
      newThreshold = Math.max(
        this.MIN_CONFIRMATION_SCORE,
        oldThreshold - decrease
      );

      if (newThreshold !== oldThreshold) {
        changes.push({
          timestamp: new Date(),
          parameter: "minConfirmationScore",
          oldValue: oldThreshold,
          newValue: newThreshold,
          reason: "Rule 6: Strong win streak detected",
          triggerMetric: "consecutiveWins",
          triggerValue: wins,
        });
      }
    }

    if (newThreshold !== oldThreshold) {
      this.currentConfig.minConfirmationScore = newThreshold;
    }

    return changes;
  }

  /**
   * Compute Pearson correlation between two arrays.
   */
  private computeCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length < 2) {
      return 0;
    }

    const n = x.length;
    const meanX = x.reduce((a, b) => a + b, 0) / n;
    const meanY = y.reduce((a, b) => a + b, 0) / n;

    let covariance = 0;
    let varX = 0;
    let varY = 0;

    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      covariance += dx * dy;
      varX += dx * dx;
      varY += dy * dy;
    }

    const denominator = Math.sqrt(varX * varY);
    if (denominator === 0) {
      return 0;
    }

    return covariance / denominator;
  }

  /**
   * Get the current optimized configuration.
   */
  getOptimizedConfig(): MCPPipelineConfig {
    return { ...this.currentConfig };
  }

  /**
   * Get dimension analysis results.
   */
  getDimensionAnalysis(): DimensionPerformance[] {
    return Array.from(this.performanceByDimension.values());
  }

  /**
   * Get parameter change history with optional limit.
   */
  getParameterHistory(limit?: number): ParameterChange[] {
    if (!limit) {
      return [...this.parameterHistory];
    }
    return this.parameterHistory.slice(-limit);
  }

  /**
   * Get full optimizer state snapshot.
   */
  getState(): OptimizationState {
    return {
      currentConfig: { ...this.currentConfig },
      rollingWindow: [...this.rollingWindow],
      windowSize: this.windowSize,
      totalOptimizations: this.totalOptimizations,
      lastOptimizedAt: this.lastOptimizedAt ? new Date(this.lastOptimizedAt) : null,
      parameterHistory: [...this.parameterHistory],
      performanceByDimension: new Map(this.performanceByDimension),
    };
  }

  /**
   * Reset to initial configuration.
   */
  reset(initialConfig: MCPPipelineConfig): void {
    this.currentConfig = { ...initialConfig };
    this.rollingWindow = [];
    this.totalOptimizations = 0;
    this.lastOptimizedAt = null;
    this.parameterHistory = [];
    this.tradesSinceLastOptimization = 0;
    this.initializeDimensionTracking();
  }
}

// Types are already exported inline at their declaration above.
