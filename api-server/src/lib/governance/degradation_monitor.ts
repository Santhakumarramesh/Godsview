/**
 * degradation_monitor.ts — Automatic Performance Degradation Detection
 *
 * Continuously monitors strategy metrics for performance drift and triggers
 * automatic demotion when degradation signals exceed thresholds.
 */

import { logger } from "../logger";

// ── Types ──────────────────────────────────────────────────────────────────

export interface DegradationSignal {
  type:
    | "win_rate_decline"
    | "sharpe_decline"
    | "drawdown_breach"
    | "consecutive_losses"
    | "regime_shift"
    | "correlation_break"
    | "volume_anomaly";
  severity: number; // 0-1
  description: string;
  threshold: number;
  currentValue: number;
}

export interface DegradationReport {
  strategyId: string;
  status: "healthy" | "warning" | "degrading" | "critical";
  signals: DegradationSignal[];
  overallScore: number; // 0-100, lower = more degraded
  metrics: {
    recentWinRate: number;
    historicalWinRate: number;
    winRateChange: number;
    recentSharpe: number;
    historicalSharpe: number;
    sharpeChange: number;
    recentDrawdown: number;
    consecutiveLosses: number;
    daysUnderwater: number;
  };
  recommendation: string;
  urgency: "low" | "medium" | "high" | "critical";
}

export interface DriftResult {
  drifting: boolean;
  severity: number;
  changePercent: number;
  evidence: string;
}

export interface DegradationTrend {
  strategyId: string;
  lookbackDays: number;
  overallTrend: "improving" | "stable" | "degrading";
  scoreHistory: { date: string; score: number }[];
  signalHistory: { date: string; signals: string[] }[];
  prediction: { trendInDays: number; estimatedScore: number };
}

interface StrategyMetrics {
  timestamp: string;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  consecutiveLosses: number;
  daysUnderwater: number;
  equity: number;
}

// ── Degradation Monitor ────────────────────────────────────────────────────

export class DegradationMonitor {
  private metricsHistory: Map<string, StrategyMetrics[]> = new Map();
  private degradationCache: Map<string, DegradationReport> = new Map();

  // Thresholds for degradation detection
  private readonly WIN_RATE_DECLINE_THRESHOLD = 0.1; // 10% decline
  private readonly SHARPE_DECLINE_THRESHOLD = 0.3; // 0.3 point decline
  private readonly DRAWDOWN_BREACH = 0.25; // 25% max drawdown
  private readonly CONSECUTIVE_LOSSES_THRESHOLD = 10;
  private readonly DAYS_UNDERWATER_THRESHOLD = 60;
  private readonly REGIME_SHIFT_CORRELATION = 0.6;

  checkDegradation(strategyId: string, recent: StrategyMetrics, historical: StrategyMetrics): DegradationReport {
    const signals: DegradationSignal[] = [];
    let overallScore = 100;

    // Win rate decline check
    const winRateChange = historical.winRate - recent.winRate;
    if (winRateChange > this.WIN_RATE_DECLINE_THRESHOLD) {
      const severity = Math.min(1, winRateChange / 0.2);
      signals.push({
        type: "win_rate_decline",
        severity,
        description: `Win rate declined ${(winRateChange * 100).toFixed(1)}% from ${(historical.winRate * 100).toFixed(1)}% to ${(recent.winRate * 100).toFixed(1)}%`,
        threshold: this.WIN_RATE_DECLINE_THRESHOLD,
        currentValue: winRateChange,
      });
      overallScore -= 20 * severity;
    }

    // Sharpe ratio decline check
    const sharpeChange = historical.sharpeRatio - recent.sharpeRatio;
    if (sharpeChange > this.SHARPE_DECLINE_THRESHOLD) {
      const severity = Math.min(1, sharpeChange / 0.5);
      signals.push({
        type: "sharpe_decline",
        severity,
        description: `Sharpe ratio declined from ${historical.sharpeRatio.toFixed(2)} to ${recent.sharpeRatio.toFixed(2)}`,
        threshold: this.SHARPE_DECLINE_THRESHOLD,
        currentValue: sharpeChange,
      });
      overallScore -= 25 * severity;
    }

    // Drawdown breach check
    if (recent.maxDrawdown > this.DRAWDOWN_BREACH) {
      const severity = Math.min(1, recent.maxDrawdown / 0.35);
      signals.push({
        type: "drawdown_breach",
        severity,
        description: `Max drawdown ${(recent.maxDrawdown * 100).toFixed(1)}% exceeds safe limit`,
        threshold: this.DRAWDOWN_BREACH,
        currentValue: recent.maxDrawdown,
      });
      overallScore -= 30 * severity;
    }

    // Consecutive losses check
    if (recent.consecutiveLosses > this.CONSECUTIVE_LOSSES_THRESHOLD) {
      const severity = Math.min(1, (recent.consecutiveLosses - this.CONSECUTIVE_LOSSES_THRESHOLD) / 10);
      signals.push({
        type: "consecutive_losses",
        severity,
        description: `${recent.consecutiveLosses} consecutive losses — edge may be broken`,
        threshold: this.CONSECUTIVE_LOSSES_THRESHOLD,
        currentValue: recent.consecutiveLosses,
      });
      overallScore -= 20 * severity;
    }

    // Days underwater check
    if (recent.daysUnderwater > this.DAYS_UNDERWATER_THRESHOLD) {
      const severity = Math.min(1, (recent.daysUnderwater - this.DAYS_UNDERWATER_THRESHOLD) / 60);
      signals.push({
        type: "correlation_break",
        severity,
        description: `${recent.daysUnderwater} days underwater — recovery stalled`,
        threshold: this.DAYS_UNDERWATER_THRESHOLD,
        currentValue: recent.daysUnderwater,
      });
      overallScore -= 15 * severity;
    }

    overallScore = Math.max(0, Math.min(100, overallScore));

    let status: "healthy" | "warning" | "degrading" | "critical" = "healthy";
    if (overallScore < 30) status = "critical";
    else if (overallScore < 50) status = "degrading";
    else if (overallScore < 70) status = "warning";

    const recommendation = this.generateRecommendation(status, signals);
    const urgency = status === "critical" ? "critical" : status === "degrading" ? "high" : "medium";

    const report: DegradationReport = {
      strategyId,
      status,
      signals,
      overallScore,
      metrics: {
        recentWinRate: recent.winRate,
        historicalWinRate: historical.winRate,
        winRateChange,
        recentSharpe: recent.sharpeRatio,
        historicalSharpe: historical.sharpeRatio,
        sharpeChange,
        recentDrawdown: recent.maxDrawdown,
        consecutiveLosses: recent.consecutiveLosses,
        daysUnderwater: recent.daysUnderwater,
      },
      recommendation,
      urgency,
    };

    this.degradationCache.set(strategyId, report);
    return report;
  }

  monitorAll(strategies: any[]): DegradationReport[] {
    return strategies
      .map((s) => {
        const history = this.metricsHistory.get(s.strategyId) || [];
        if (history.length < 2) return null;

        const recent = history[history.length - 1];
        const historical = history[Math.max(0, history.length - 21)]; // 20 periods back

        return this.checkDegradation(s.strategyId, recent, historical);
      })
      .filter((r) => r !== null) as DegradationReport[];
  }

  detectDrift(recent: number[], historical: number[]): DriftResult {
    if (recent.length < 2 || historical.length < 2) {
      return { drifting: false, severity: 0, changePercent: 0, evidence: "Insufficient data" };
    }

    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const historicalAvg = historical.reduce((a, b) => a + b, 0) / historical.length;

    const changePercent = historicalAvg > 0 ? Math.abs((recentAvg - historicalAvg) / historicalAvg) : 0;
    const drifting = changePercent > 0.15; // 15% threshold
    const severity = Math.min(1, changePercent / 0.3);

    return {
      drifting,
      severity,
      changePercent,
      evidence: `Recent avg ${recentAvg.toFixed(3)} vs historical ${historicalAvg.toFixed(3)} (${(changePercent * 100).toFixed(1)}% change)`,
    };
  }

  shouldAutoDemote(report: DegradationReport): { demote: boolean; targetTier: string; urgency: string } {
    const criticalSignals = report.signals.filter((s) => s.severity > 0.7);
    const demote = report.status === "critical" || (report.status === "degrading" && criticalSignals.length > 0);

    const targetTier = report.status === "critical" ? "DEGRADING" : "LEARNING";

    return {
      demote,
      targetTier,
      urgency: report.urgency,
    };
  }

  recordMetrics(strategyId: string, metrics: any): void {
    const newMetrics: StrategyMetrics = {
      timestamp: new Date().toISOString(),
      winRate: metrics.winRate || 0,
      sharpeRatio: metrics.sharpeRatio || 0,
      maxDrawdown: metrics.maxDrawdown || 0,
      consecutiveLosses: metrics.consecutiveLosses || 0,
      daysUnderwater: metrics.daysUnderwater || 0,
      equity: metrics.equity || 0,
    };

    if (!this.metricsHistory.has(strategyId)) {
      this.metricsHistory.set(strategyId, []);
    }

    const history = this.metricsHistory.get(strategyId)!;
    history.push(newMetrics);

    // Keep last 100 data points
    if (history.length > 100) {
      history.shift();
    }
  }

  getDegradationTrend(strategyId: string, lookbackDays: number): DegradationTrend {
    const history = this.metricsHistory.get(strategyId) || [];
    const cutoffTime = Date.now() - lookbackDays * 86400000;

    const relevantHistory = history.filter((m) => new Date(m.timestamp).getTime() > cutoffTime);

    // Calculate trend
    const scores = relevantHistory.map((m) => {
      let score = 100;
      if (m.winRate < 0.5) score -= 20;
      if (m.sharpeRatio < 0.8) score -= 25;
      if (m.maxDrawdown > 0.2) score -= 20;
      return Math.max(0, score);
    });

    const overallTrend =
      scores.length > 1 && scores[scores.length - 1] > scores[0]
        ? "improving"
        : scores.length > 1 && scores[scores.length - 1] < scores[0]
          ? "degrading"
          : "stable";

    // Simple linear extrapolation
    let estimatedScore = 50;
    if (scores.length > 1) {
      const trend = (scores[scores.length - 1] - scores[0]) / (scores.length - 1);
      estimatedScore = scores[scores.length - 1] + trend * 7; // Project 7 days
    }

    return {
      strategyId,
      lookbackDays,
      overallTrend,
      scoreHistory: relevantHistory.map((m, i) => ({
        date: m.timestamp,
        score: scores[i] || 50,
      })),
      signalHistory: relevantHistory.map((m) => ({
        date: m.timestamp,
        signals: this.generateSignalList(m),
      })),
      prediction: {
        trendInDays: 7,
        estimatedScore: Math.max(0, Math.min(100, estimatedScore)),
      },
    };
  }

  private generateRecommendation(status: string, signals: DegradationSignal[]): string {
    if (status === "critical") return "IMMEDIATE DEMOTION RECOMMENDED — critical performance degradation";
    if (status === "degrading" && signals.length > 2) return "DEMOTION RECOMMENDED — multiple degradation signals";
    if (status === "degrading") return "MONITOR CLOSELY — strategy showing signs of degradation";
    if (status === "warning") return "INCREASED MONITORING — watch for further decline";
    return "CONTINUE MONITORING";
  }

  private generateSignalList(metrics: StrategyMetrics): string[] {
    const signals: string[] = [];
    if (metrics.winRate < 0.5) signals.push("low_win_rate");
    if (metrics.sharpeRatio < 0.8) signals.push("low_sharpe");
    if (metrics.maxDrawdown > 0.2) signals.push("high_drawdown");
    if (metrics.consecutiveLosses > 5) signals.push("consecutive_losses");
    if (metrics.daysUnderwater > 30) signals.push("underwater");
    return signals;
  }
}
