/**
 * self_monitor.ts — Self-Monitoring and Self-Check System
 *
 * The system continuously monitors itself:
 *
 *   • Execution Quality — latency, fill rates, slippage
 *   • Model Health — accuracy, calibration, confidence reliability
 *   • Data Pipeline — freshness, validity, continuity
 *   • Risk Limits — portfolio limits, position limits, loss limits
 *   • Performance — Sharpe, win rate, drawdown tracking
 *   • Infrastructure — data feeds, broker connection, order submission
 *
 * Runs self-checks periodically and provides a health score (0-100).
 * Post-trade reviews grade each trade and extract lessons learned.
 * Daily assessments provide accountability and improvement signals.
 */

import { logger as _logger } from "../logger";

const logger = _logger.child({ module: "self_monitor" });

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ExecutionQualityCheck {
  status: "pass" | "warn" | "fail";
  avgSlippage: number;
  maxSlippage: number;
  fillRate: number;
  latencyP95: number;
  issues: string[];
}

export interface ModelHealthCheck {
  status: "pass" | "warn" | "fail";
  recentAccuracy: number;
  calibrationError: number;
  confidenceReliability: number;
  predictionDistribution: { mean: number; std: number };
  issues: string[];
}

export interface DataHealthCheck {
  status: "pass" | "warn" | "fail";
  dataFreshness: number;  // seconds since last update
  missingDataPoints: number;
  dataQuality: number;  // 0-1
  issues: string[];
}

export interface RiskLimitCheck {
  status: "pass" | "warn" | "fail";
  currentDrawdown: number;
  maxAllowedDrawdown: number;
  currentPortfolioSize: number;
  maxAllowedSize: number;
  openPositions: number;
  maxAllowedPositions: number;
  issues: string[];
}

export interface PerformanceCheck {
  status: "pass" | "warn" | "fail";
  winRate: number;
  sharpeRatio: number;
  profitFactor: number;
  maxConsecutiveLosses: number;
  issues: string[];
}

export interface InfraCheck {
  status: "pass" | "warn" | "fail";
  brokerConnected: boolean;
  dataFeedHealthy: boolean;
  apiLatency: number;
  errorRate: number;
  issues: string[];
}

export interface SelfCheckIssue {
  component: string;
  severity: "warning" | "critical";
  message: string;
  autoAction?: string;
}

export interface AutoAction {
  action: string;
  reason: string;
  executed: boolean;
}

export interface SelfCheckReport {
  timestamp: number;
  overall: "healthy" | "warning" | "degraded" | "critical";
  score: number;  // 0-100
  
  checks: {
    execution: ExecutionQualityCheck;
    model: ModelHealthCheck;
    data: DataHealthCheck;
    risk: RiskLimitCheck;
    performance: PerformanceCheck;
    infrastructure: InfraCheck;
  };
  
  issues: SelfCheckIssue[];
  autoActions: AutoAction[];
  requiresHumanReview: boolean;
  nextCheckTime: number;
}

export interface PostTradeReview {
  tradeId: string;
  grade: "A" | "B" | "C" | "D" | "F";
  entryQuality: number;
  exitQuality: number;
  sizingQuality: number;
  timingQuality: number;
  executionQuality: number;
  whatWentRight: string[];
  whatWentWrong: string[];
  lessonLearned: string;
  adjustmentNeeded: boolean;
  suggestedAdjustment?: string;
}

export interface DailyAssessment {
  date: string;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  grossPnL: number;
  netPnL: number;
  sharpeRatio: number;
  maxDrawdown: number;
  strengths: string[];
  weaknesses: string[];
  keyLearnings: string[];
  readyForNextDay: boolean;
  recommendations: string[];
}

export interface TradingReadinessCheck {
  ready: boolean;
  score: number;  // 0-100
  blockers: { reason: string; severity: string }[];
  warnings: string[];
  conditions: {
    dataFeedHealthy: boolean;
    modelCalibrated: boolean;
    riskLimitsOk: boolean;
    marketOpen: boolean;
    noBlackoutPeriod: boolean;
    executionReady: boolean;
    recentPerformanceOk: boolean;
  };
}

// ─── Self Monitor Implementation ────────────────────────────────────────────

export class SelfMonitor {
  private lastCheckTime: number = 0;
  private checkInterval: number = 60000;  // 60 seconds

  constructor() {
    this.loadConfiguration();
  }

  private loadConfiguration() {
    const interval = process.env.SELF_CHECK_INTERVAL_MS;
    if (interval) {
      this.checkInterval = parseInt(interval, 10);
    }
  }

  /**
   * Run all self-checks
   */
  runSelfCheck(): SelfCheckReport {
    const timestamp = Date.now();

    const execution = this.checkExecutionQuality();
    const model = this.checkModelHealth();
    const data = this.checkDataHealth();
    const risk = this.checkRiskLimits();
    const performance = this.checkPerformance();
    const infrastructure = this.checkInfrastructure();

    // Aggregate issues
    const issues: SelfCheckIssue[] = [];
    this.collectIssues(issues, "execution", execution);
    this.collectIssues(issues, "model", model);
    this.collectIssues(issues, "data", data);
    this.collectIssues(issues, "risk", risk);
    this.collectIssues(issues, "performance", performance);
    this.collectIssues(issues, "infrastructure", infrastructure);

    // Determine auto actions
    const autoActions = this.determineAutoActions(issues, [
      execution,
      model,
      data,
      risk,
      performance,
      infrastructure,
    ]);

    // Calculate overall score (weighted average)
    const scoreWeights = {
      execution: 0.25,
      model: 0.25,
      data: 0.20,
      risk: 0.20,
      performance: 0.05,
      infrastructure: 0.05,
    };

    const checkScores = {
      execution: this.statusToScore(execution.status),
      model: this.statusToScore(model.status),
      data: this.statusToScore(data.status),
      risk: this.statusToScore(risk.status),
      performance: this.statusToScore(performance.status),
      infrastructure: this.statusToScore(infrastructure.status),
    };

    const score =
      checkScores.execution * scoreWeights.execution +
      checkScores.model * scoreWeights.model +
      checkScores.data * scoreWeights.data +
      checkScores.risk * scoreWeights.risk +
      checkScores.performance * scoreWeights.performance +
      checkScores.infrastructure * scoreWeights.infrastructure;

    // Determine overall health
    let overall: "healthy" | "warning" | "degraded" | "critical" = "healthy";
    if (score < 60) overall = "critical";
    else if (score < 70) overall = "degraded";
    else if (score < 85) overall = "warning";

    const requiresHumanReview =
      issues.some((i) => i.severity === "critical") || overall === "critical";

    const report: SelfCheckReport = {
      timestamp,
      overall,
      score: Math.round(score),
      checks: {
        execution,
        model,
        data,
        risk,
        performance,
        infrastructure,
      },
      issues,
      autoActions,
      requiresHumanReview,
      nextCheckTime: timestamp + this.checkInterval,
    };

    this.lastCheckTime = timestamp;
    return report;
  }

  /**
   * Check execution quality
   */
  checkExecutionQuality(): ExecutionQualityCheck {
    // In production, would pull from actual execution metrics
    // This is a placeholder implementation

    const avgSlippage = 0.0015;  // 1.5 bps
    const maxSlippage = 0.005;   // 5 bps
    const fillRate = 0.99;
    const latencyP95 = 45;  // ms

    const issues: string[] = [];
    let status: "pass" | "warn" | "fail" = "pass";

    if (avgSlippage > 0.002) {
      issues.push("Average slippage exceeds threshold");
      status = "warn";
    }

    if (fillRate < 0.95) {
      issues.push("Fill rate below expected 95%");
      status = "fail";
    }

    if (latencyP95 > 100) {
      issues.push("P95 latency exceeds 100ms");
      status = "warn";
    }

    return {
      status,
      avgSlippage,
      maxSlippage,
      fillRate,
      latencyP95,
      issues,
    };
  }

  /**
   * Check model health
   */
  checkModelHealth(): ModelHealthCheck {
    // In production, would calculate from actual predictions
    const recentAccuracy = 0.56;  // 56% vs expected 55%
    const calibrationError = 0.08;  // 8% vs expected <10%
    const confidenceReliability = 0.72;  // 72% of high-conf preds correct vs expected 75%

    const issues: string[] = [];
    let status: "pass" | "warn" | "fail" = "pass";

    if (recentAccuracy < 0.50) {
      issues.push("Accuracy below 50% threshold");
      status = "fail";
    } else if (recentAccuracy < 0.53) {
      issues.push("Accuracy declining");
      status = "warn";
    }

    if (calibrationError > 0.15) {
      issues.push("Model calibration drifting");
      status = "warn";
    }

    if (confidenceReliability < 0.65) {
      issues.push("High-confidence predictions unreliable");
      status = "warn";
    }

    return {
      status,
      recentAccuracy,
      calibrationError,
      confidenceReliability,
      predictionDistribution: { mean: 0.5, std: 0.2 },
      issues,
    };
  }

  /**
   * Check data pipeline health
   */
  checkDataHealth(): DataHealthCheck {
    // In production, would check actual data freshness from providers
    const dataFreshness = 2;  // seconds
    const missingDataPoints = 0;
    const dataQuality = 0.998;  // 99.8% valid

    const issues: string[] = [];
    let status: "pass" | "warn" | "fail" = "pass";

    if (dataFreshness > 5) {
      issues.push("Data feed lagging");
      status = "warn";
    }

    if (missingDataPoints > 10) {
      issues.push("Significant missing data points");
      status = "fail";
    }

    if (dataQuality < 0.99) {
      issues.push("Data quality degraded");
      status = "warn";
    }

    return {
      status,
      dataFreshness,
      missingDataPoints,
      dataQuality,
      issues,
    };
  }

  /**
   * Check risk limits
   */
  checkRiskLimits(): RiskLimitCheck {
    // In production, would pull from portfolio state
    const currentDrawdown = 0.032;  // 3.2%
    const maxAllowedDrawdown = 0.10;  // 10%
    const currentPortfolioSize = 95000;
    const maxAllowedSize = 100000;
    const openPositions = 3;
    const maxAllowedPositions = 5;

    const issues: string[] = [];
    let status: "pass" | "warn" | "fail" = "pass";

    if (currentDrawdown > maxAllowedDrawdown * 0.8) {
      issues.push("Drawdown approaching limit");
      status = "warn";
    }

    if (currentDrawdown > maxAllowedDrawdown) {
      issues.push("Drawdown exceeded maximum");
      status = "fail";
    }

    if (currentPortfolioSize > maxAllowedSize * 0.9) {
      issues.push("Portfolio size approaching limit");
      status = "warn";
    }

    return {
      status,
      currentDrawdown,
      maxAllowedDrawdown,
      currentPortfolioSize,
      maxAllowedSize,
      openPositions,
      maxAllowedPositions,
      issues,
    };
  }

  /**
   * Check recent performance
   */
  checkPerformance(): PerformanceCheck {
    // In production, would calculate from recent trade metrics
    const winRate = 0.55;
    const sharpeRatio = 1.8;
    const profitFactor = 1.6;
    const maxConsecutiveLosses = 3;

    const issues: string[] = [];
    let status: "pass" | "warn" | "fail" = "pass";

    if (winRate < 0.45) {
      issues.push("Win rate below 45%");
      status = "fail";
    } else if (winRate < 0.50) {
      issues.push("Win rate declining");
      status = "warn";
    }

    if (sharpeRatio < 1.0) {
      issues.push("Sharpe ratio below 1.0");
      status = "warn";
    }

    if (profitFactor < 1.2) {
      issues.push("Profit factor declining");
      status = "warn";
    }

    if (maxConsecutiveLosses > 5) {
      issues.push("Excessive consecutive losses");
      status = "fail";
    }

    return {
      status,
      winRate,
      sharpeRatio,
      profitFactor,
      maxConsecutiveLosses,
      issues,
    };
  }

  /**
   * Check infrastructure health
   */
  checkInfrastructure(): InfraCheck {
    // In production, would ping actual services
    const brokerConnected = true;
    const dataFeedHealthy = true;
    const apiLatency = 35;  // ms
    const errorRate = 0.001;  // 0.1%

    const issues: string[] = [];
    let status: "pass" | "warn" | "fail" = "pass";

    if (!brokerConnected) {
      issues.push("Broker connection lost");
      status = "fail";
    }

    if (!dataFeedHealthy) {
      issues.push("Data feed unhealthy");
      status = "fail";
    }

    if (apiLatency > 100) {
      issues.push("API latency elevated");
      status = "warn";
    }

    if (errorRate > 0.01) {
      issues.push("Error rate elevated");
      status = "warn";
    }

    return {
      status,
      brokerConnected,
      dataFeedHealthy,
      apiLatency,
      errorRate,
      issues,
    };
  }

  /**
   * Post-trade review: analyze a single trade
   */
  postTradeReview(trade: any): PostTradeReview {
    // Analyze trade execution quality
    const entryQuality = this.gradeEntryExecution(trade);
    const exitQuality = this.gradeExitExecution(trade);
    const sizingQuality = this.gradeSizing(trade);
    const timingQuality = this.gradeTiming(trade);
    const executionQuality = this.gradeExecution(trade);

    // Calculate overall grade
    const avgGrade =
      (entryQuality + exitQuality + sizingQuality + timingQuality + executionQuality) / 5;
    const grade = this.scoreToGrade(avgGrade);

    // Extract lessons
    const whatWentRight: string[] = [];
    const whatWentWrong: string[] = [];

    if (entryQuality > 0.75) whatWentRight.push("Good entry price");
    if (entryQuality < 0.5) whatWentWrong.push("Poor entry execution");

    if (exitQuality > 0.75) whatWentRight.push("Excellent exit timing");
    if (exitQuality < 0.5) whatWentWrong.push("Exit too early or too late");

    if (sizingQuality > 0.75) whatWentRight.push("Appropriate position sizing");
    if (sizingQuality < 0.5) whatWentWrong.push("Position size mismatched risk");

    const lessonLearned = this.extractLesson(trade, avgGrade);
    const adjustmentNeeded = avgGrade < 0.7;

    return {
      tradeId: trade.id || "unknown",
      grade,
      entryQuality,
      exitQuality,
      sizingQuality,
      timingQuality,
      executionQuality,
      whatWentRight,
      whatWentWrong,
      lessonLearned,
      adjustmentNeeded,
      suggestedAdjustment: adjustmentNeeded
        ? this.suggestAdjustment(trade, avgGrade)
        : undefined,
    };
  }

  /**
   * Daily review and assessment
   */
  dailySelfAssessment(): DailyAssessment {
    // In production, would aggregate all trades from today
    const totalTrades = 12;
    const winningTrades = 7;
    const losingTrades = 5;
    const winRate = winningTrades / totalTrades;
    const grossPnL = 2500;
    const netPnL = 2150;  // after costs
    const sharpeRatio = 1.9;
    const maxDrawdown = 0.035;

    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const keyLearnings: string[] = [];

    if (winRate > 0.55) strengths.push("Above-average win rate");
    if (winRate < 0.50) weaknesses.push("Win rate below target");

    if (sharpeRatio > 1.5) strengths.push("Strong risk-adjusted returns");
    if (sharpeRatio < 1.0) weaknesses.push("Risk-adjusted returns insufficient");

    if (maxDrawdown > 0.05) weaknesses.push("Daily drawdown excessive");

    keyLearnings.push("Market consolidation helped mean-reversion setups");
    keyLearnings.push("Missed opportunities in gap-up moves");

    const readyForNextDay =
      winRate > 0.45 && sharpeRatio > 1.0 && maxDrawdown < 0.10;

    const recommendations: string[] = [];
    if (!readyForNextDay) {
      recommendations.push("Review strategy parameters before resuming");
    }
    if (maxDrawdown > 0.05) {
      recommendations.push("Reduce Kelly fraction for next session");
    }

    return {
      date: new Date().toISOString().split("T")[0],
      totalTrades,
      winningTrades,
      losingTrades,
      winRate,
      grossPnL,
      netPnL,
      sharpeRatio,
      maxDrawdown,
      strengths,
      weaknesses,
      keyLearnings,
      readyForNextDay,
      recommendations,
    };
  }

  /**
   * Check if system is ready for trading
   */
  shouldBeTrading(): TradingReadinessCheck {
    const selfCheck = this.runSelfCheck();

    const dataFeedHealthy = selfCheck.checks.data.status !== "fail";
    const modelCalibrated =
      selfCheck.checks.model.status !== "fail" && selfCheck.checks.model.recentAccuracy > 0.50;
    const riskLimitsOk =
      selfCheck.checks.risk.status !== "fail" &&
      selfCheck.checks.risk.currentDrawdown < selfCheck.checks.risk.maxAllowedDrawdown * 0.9;
    const marketOpen = this.isMarketOpen();
    const noBlackoutPeriod = !this.isInBlackoutPeriod();
    const executionReady = selfCheck.checks.execution.status !== "fail";
    const recentPerformanceOk =
      selfCheck.checks.performance.status !== "fail" &&
      selfCheck.checks.performance.maxConsecutiveLosses < 6;

    const ready =
      dataFeedHealthy &&
      modelCalibrated &&
      riskLimitsOk &&
      marketOpen &&
      noBlackoutPeriod &&
      executionReady &&
      recentPerformanceOk;

    // Calculate score
    let score = 100;
    if (!dataFeedHealthy) score -= 20;
    if (!modelCalibrated) score -= 15;
    if (!riskLimitsOk) score -= 15;
    if (!marketOpen) score -= 10;
    if (!noBlackoutPeriod) score -= 10;
    if (!executionReady) score -= 15;
    if (!recentPerformanceOk) score -= 10;

    const blockers: { reason: string; severity: string }[] = [];
    if (!dataFeedHealthy) blockers.push({ reason: "Data feed unhealthy", severity: "critical" });
    if (!marketOpen) blockers.push({ reason: "Market closed", severity: "critical" });
    if (!executionReady) blockers.push({ reason: "Execution system not ready", severity: "critical" });

    const warnings: string[] = [];
    if (!modelCalibrated) warnings.push("Model accuracy below threshold");
    if (!riskLimitsOk) warnings.push("Risk limits approaching thresholds");
    if (recentPerformanceOk && selfCheck.checks.performance.maxConsecutiveLosses > 3) {
      warnings.push("Recent consecutive losses detected");
    }

    return {
      ready,
      score: Math.max(0, score),
      blockers,
      warnings,
      conditions: {
        dataFeedHealthy,
        modelCalibrated,
        riskLimitsOk,
        marketOpen,
        noBlackoutPeriod,
        executionReady,
        recentPerformanceOk,
      },
    };
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private collectIssues(
    issues: SelfCheckIssue[],
    component: string,
    check: any
  ) {
    if (check.issues && Array.isArray(check.issues)) {
      check.issues.forEach((msg: string) => {
        issues.push({
          component,
          severity: check.status === "fail" ? "critical" : "warning",
          message: msg,
        });
      });
    }
  }

  private determineAutoActions(
    issues: SelfCheckIssue[],
    checks: any[]
  ): AutoAction[] {
    const actions: AutoAction[] = [];

    // Auto-reduce position size if drawdown approaching
    if (
      issues.some((i) => i.message.includes("Drawdown approaching")) &&
      !issues.some((i) => i.message.includes("exceeded"))
    ) {
      actions.push({
        action: "reduce_kelly_fraction",
        reason: "Drawdown approaching limit",
        executed: false,
      });
    }

    // Auto-pause if critical issues
    if (issues.some((i) => i.severity === "critical")) {
      actions.push({
        action: "pause_trading",
        reason: "Critical system issues detected",
        executed: false,
      });
    }

    return actions;
  }

  private statusToScore(status: string): number {
    switch (status) {
      case "pass":
        return 100;
      case "warn":
        return 75;
      case "fail":
        return 40;
      default:
        return 50;
    }
  }

  private gradeEntryExecution(trade: any): number {
    // Would analyze entry price vs optimal entry
    return 0.78;
  }

  private gradeExitExecution(trade: any): number {
    // Would analyze exit price vs optimal exit
    return 0.82;
  }

  private gradeSizing(trade: any): number {
    // Would analyze position size vs risk budget
    return 0.75;
  }

  private gradeTiming(trade: any): number {
    // Would analyze timing relative to market conditions
    return 0.72;
  }

  private gradeExecution(trade: any): number {
    // Would analyze execution quality (slippage, fill rate)
    return 0.85;
  }

  private scoreToGrade(score: number): PostTradeReview["grade"] {
    if (score >= 0.9) return "A";
    if (score >= 0.8) return "B";
    if (score >= 0.7) return "C";
    if (score >= 0.6) return "D";
    return "F";
  }

  private extractLesson(trade: any, score: number): string {
    if (score >= 0.85) return "Execution was excellent; maintain current discipline";
    if (score >= 0.75) return "Good trade; look for consistent improvements in timing";
    if (score >= 0.65) return "Trade managed adequately; review entry/exit criteria";
    if (score >= 0.55) return "Multiple areas need improvement; focus on risk management";
    return "Poor execution; review all aspects of trade management";
  }

  private suggestAdjustment(trade: any, score: number): string | undefined {
    if (score < 0.5) return "Revisit entry and exit rules; consider stricter filters";
    if (score < 0.65) return "Improve position sizing methodology";
    if (score < 0.75) return "Focus on market timing and regime confirmation";
    return undefined;
  }

  private isMarketOpen(): boolean {
    // In production, would check actual market hours
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();

    // NYSE hours: 9:30-16:00 EST, Mon-Fri
    return day >= 1 && day <= 5 && hour >= 9 && hour < 16;
  }

  private isInBlackoutPeriod(): boolean {
    // In production, would check for earnings blackouts, etc.
    return false;
  }
}

export const selfMonitor = new SelfMonitor();
