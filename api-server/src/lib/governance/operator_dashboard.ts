/**
 * operator_dashboard.ts — Operator Review & Decision Interface
 *
 * Provides data structures and logic for the operator dashboard experience,
 * including pending reviews, alerts, system health, and operator decisions.
 */

import { logger } from "../logger";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ReviewItem {
  id: string;
  type: "promotion" | "demotion" | "retirement" | "override";
  strategyId: string;
  strategyName: string;
  currentTier: string;
  targetTier: string;
  priority: "low" | "medium" | "high" | "critical";
  createdAt: string;
  expiresAt: string;
  evidence: {
    title: string;
    summary: string;
    key_metrics: Record<string, number>;
  };
  recommendation: string;
  requiresApproval: boolean;
}

export interface OperatorAlert {
  id: string;
  severity: "info" | "warning" | "critical";
  type: "performance" | "risk" | "system" | "governance";
  title: string;
  description: string;
  affectedStrategies: string[];
  suggestedAction: string;
  createdAt: string;
  status: "open" | "acknowledged" | "resolved";
}

export interface SystemHealthOverview {
  timestamp: string;
  overall_health: "green" | "yellow" | "red";
  portfolioMetrics: {
    totalStrategies: number;
    activeStrategies: number;
    pausedStrategies: number;
    retiredStrategies: number;
    totalPnL: number;
    dailyPnL: number;
    totalDrawdown: number;
  };
  riskMetrics: {
    totalExposure: number;
    maxDrawdown: number;
    portfolioSharpe: number;
    concentrationAlert: boolean;
    correlationAlert: boolean;
    volatilityAlert: boolean;
  };
  systemMetrics: {
    uptime: number;
    lastErrorAt: string | null;
    errorCount24h: number;
    latencyMs: number;
  };
  alerts: {
    critical: number;
    warning: number;
    info: number;
  };
}

export interface PortfolioOverview {
  timestamp: string;
  metrics: {
    total_strategies: number;
    active_strategies: number;
    total_pnl: number;
    daily_pnl: number;
    weekly_pnl: number;
    monthly_pnl: number;
    sharpe_ratio: number;
    max_drawdown: number;
    win_rate: number;
  };
  tiers: {
    tier: string;
    count: number;
    avg_sharpe: number;
    total_pnl: number;
  }[];
  topPerformers: {
    strategyId: string;
    name: string;
    pnl: number;
    sharpe: number;
    tier: string;
  }[];
  bottomPerformers: {
    strategyId: string;
    name: string;
    pnl: number;
    sharpe: number;
    tier: string;
  }[];
  atRiskStrategies: {
    strategyId: string;
    name: string;
    reason: string;
    tier: string;
    suggestedAction: string;
  }[];
}

export interface DailyOperatorReport {
  date: string;
  generatedAt: string;

  portfolioSummary: {
    totalStrategies: number;
    activeStrategies: number;
    pausedStrategies: number;
    degradingStrategies: number;
    totalPnL: number;
    dailyPnL: number;
    weeklyPnL: number;
  };

  governance: {
    promotionsPending: number;
    demotionsPending: number;
    retirementsPending: number;
    operatorDecisionsPending: number;
  };

  alerts: {
    totalUnresolved: number;
    critical: number;
    warning: number;
    byType: Record<string, number>;
  };

  topPerformers: { name: string; pnl: number; sharpe: number }[];
  bottomPerformers: { name: string; pnl: number; sharpe: number }[];

  riskSummary: {
    totalExposure: number;
    maxDrawdown: number;
    portfolioSharpe: number;
    concentrationAlert: boolean;
    correlationAlert: boolean;
    volatilityAlert: boolean;
  };

  recommendations: string[];
  keyMetrics: Record<string, number>;
}

// ── Operator Dashboard ─────────────────────────────────────────────────────

export class OperatorDashboard {
  private pendingReviews: Map<string, ReviewItem> = new Map();
  private alerts: Map<string, OperatorAlert> = new Map();
  private operatorDecisions: Map<string, any> = new Map();
  private strategyStates: Map<string, any> = new Map();

  getPendingReviews(): ReviewItem[] {
    const now = Date.now();
    const pending = Array.from(this.pendingReviews.values()).filter((r) => new Date(r.expiresAt).getTime() > now);

    // Sort by priority
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return pending.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  }

  getSystemHealth(): SystemHealthOverview {
    const strategies = Array.from(this.strategyStates.values());
    const activeStrategies = strategies.filter((s) => s.status === "active");
    const pausedStrategies = strategies.filter((s) => s.status === "paused");
    const retiredStrategies = strategies.filter((s) => s.status === "retired");

    const totalPnL = strategies.reduce((sum, s) => sum + (s.pnl || 0), 0);
    const dailyPnL = strategies.reduce((sum, s) => sum + (s.dailyPnL || 0), 0);
    const totalDrawdown = Math.max(...strategies.map((s) => s.maxDrawdown || 0), 0);

    const alertCounts = this.getAlertSummary();
    let overallHealth: "green" | "yellow" | "red" = "green";
    if (alertCounts.critical > 0) overallHealth = "red";
    else if (alertCounts.warning > 2) overallHealth = "yellow";

    return {
      timestamp: new Date().toISOString(),
      overall_health: overallHealth,
      portfolioMetrics: {
        totalStrategies: strategies.length,
        activeStrategies: activeStrategies.length,
        pausedStrategies: pausedStrategies.length,
        retiredStrategies: retiredStrategies.length,
        totalPnL,
        dailyPnL,
        totalDrawdown,
      },
      riskMetrics: {
        totalExposure: activeStrategies.reduce((sum, s) => sum + (s.exposure || 0), 0),
        maxDrawdown: totalDrawdown,
        portfolioSharpe: this.calculatePortfolioSharpe(strategies),
        concentrationAlert: this.checkConcentration(strategies),
        correlationAlert: this.checkCorrelation(strategies),
        volatilityAlert: this.checkVolatility(strategies),
      },
      systemMetrics: {
        uptime: 0.9999,
        lastErrorAt: null,
        errorCount24h: 0,
        latencyMs: 45,
      },
      alerts: {
        critical: alertCounts.critical,
        warning: alertCounts.warning,
        info: alertCounts.info,
      },
    };
  }

  getPortfolioOverview(): PortfolioOverview {
    const strategies = Array.from(this.strategyStates.values());

    const metrics = {
      total_strategies: strategies.length,
      active_strategies: strategies.filter((s) => s.status === "active").length,
      total_pnl: strategies.reduce((sum, s) => sum + (s.pnl || 0), 0),
      daily_pnl: strategies.reduce((sum, s) => sum + (s.dailyPnL || 0), 0),
      weekly_pnl: strategies.reduce((sum, s) => sum + (s.weeklyPnL || 0), 0),
      monthly_pnl: strategies.reduce((sum, s) => sum + (s.monthlyPnL || 0), 0),
      sharpe_ratio: this.calculatePortfolioSharpe(strategies),
      max_drawdown: Math.max(...strategies.map((s) => s.maxDrawdown || 0), 0),
      win_rate: this.calculatePortfolioWinRate(strategies),
    };

    // Group by tier
    const tierMap = new Map<string, any[]>();
    for (const s of strategies) {
      const tier = s.tier || "LEARNING";
      if (!tierMap.has(tier)) tierMap.set(tier, []);
      tierMap.get(tier)!.push(s);
    }

    const tiers = Array.from(tierMap.entries()).map(([tier, members]) => ({
      tier,
      count: members.length,
      avg_sharpe: members.reduce((sum, m) => sum + (m.sharpeRatio || 0), 0) / members.length,
      total_pnl: members.reduce((sum, m) => sum + (m.pnl || 0), 0),
    }));

    const sorted = [...strategies].sort((a, b) => (b.pnL || 0) - (a.pnL || 0));

    return {
      timestamp: new Date().toISOString(),
      metrics,
      tiers,
      topPerformers: sorted.slice(0, 5).map((s) => ({
        strategyId: s.strategyId,
        name: s.name,
        pnl: s.pnL || 0,
        sharpe: s.sharpeRatio || 0,
        tier: s.tier || "LEARNING",
      })),
      bottomPerformers: sorted.slice(-5).map((s) => ({
        strategyId: s.strategyId,
        name: s.name,
        pnl: s.pnL || 0,
        sharpe: s.sharpeRatio || 0,
        tier: s.tier || "LEARNING",
      })),
      atRiskStrategies: this.identifyAtRiskStrategies(strategies),
    };
  }

  getAlerts(): OperatorAlert[] {
    const now = Date.now();
    return Array.from(this.alerts.values())
      .filter((a) => a.status !== "resolved")
      .sort((a, b) => {
        const severityOrder = { critical: 0, warning: 1, info: 2 };
        return severityOrder[a.severity] - severityOrder[b.severity];
      });
  }

  recordDecision(reviewId: string, decision: string, notes: string): void {
    const review = this.pendingReviews.get(reviewId);
    if (!review) {
      logger.warn({ reviewId }, "Decision on unknown review");
      return;
    }

    const decisionRecord = {
      id: `decision_${Date.now()}`,
      reviewId,
      decision,
      notes,
      operator: "operator_name", // Would come from auth
      timestamp: new Date().toISOString(),
      strategyId: review.strategyId,
    };

    this.operatorDecisions.set(decisionRecord.id, decisionRecord);
    this.pendingReviews.delete(reviewId);

    logger.info({ reviewId, decision, strategyId: review.strategyId }, "Operator decision recorded");
  }

  generateDailyReport(): DailyOperatorReport {
    const strategies = Array.from(this.strategyStates.values());
    const pendingReviews = this.getPendingReviews();
    const alerts = this.getAlerts();

    const activeStrategies = strategies.filter((s) => s.status === "active");
    const pausedStrategies = strategies.filter((s) => s.status === "paused");
    const degradingStrategies = strategies.filter((s) => s.tier === "DEGRADING" || s.tier === "SUSPENDED");

    const sorted = [...strategies].sort((a, b) => (b.pnL || 0) - (a.pnL || 0));

    const alertCounts: Record<string, number> = {};
    for (const alert of alerts) {
      alertCounts[alert.type] = (alertCounts[alert.type] || 0) + 1;
    }

    return {
      date: new Date().toISOString().split("T")[0],
      generatedAt: new Date().toISOString(),

      portfolioSummary: {
        totalStrategies: strategies.length,
        activeStrategies: activeStrategies.length,
        pausedStrategies: pausedStrategies.length,
        degradingStrategies: degradingStrategies.length,
        totalPnL: strategies.reduce((sum, s) => sum + (s.pnL || 0), 0),
        dailyPnL: strategies.reduce((sum, s) => sum + (s.dailyPnL || 0), 0),
        weeklyPnL: strategies.reduce((sum, s) => sum + (s.weeklyPnL || 0), 0),
      },

      governance: {
        promotionsPending: pendingReviews.filter((r) => r.type === "promotion").length,
        demotionsPending: pendingReviews.filter((r) => r.type === "demotion").length,
        retirementsPending: pendingReviews.filter((r) => r.type === "retirement").length,
        operatorDecisionsPending: pendingReviews.length,
      },

      alerts: {
        totalUnresolved: alerts.length,
        critical: alerts.filter((a) => a.severity === "critical").length,
        warning: alerts.filter((a) => a.severity === "warning").length,
        byType: alertCounts,
      },

      topPerformers: sorted.slice(0, 5).map((s) => ({
        name: s.name,
        pnl: s.pnL || 0,
        sharpe: s.sharpeRatio || 0,
      })),

      bottomPerformers: sorted.slice(-5).map((s) => ({
        name: s.name,
        pnl: s.pnL || 0,
        sharpe: s.sharpeRatio || 0,
      })),

      riskSummary: {
        totalExposure: activeStrategies.reduce((sum, s) => sum + (s.exposure || 0), 0),
        maxDrawdown: Math.max(...strategies.map((s) => s.maxDrawdown || 0), 0),
        portfolioSharpe: this.calculatePortfolioSharpe(strategies),
        concentrationAlert: this.checkConcentration(strategies),
        correlationAlert: this.checkCorrelation(strategies),
        volatilityAlert: this.checkVolatility(strategies),
      },

      recommendations: this.generateRecommendations(strategies, alerts, degradingStrategies),

      keyMetrics: {
        total_trades: strategies.reduce((sum, s) => sum + (s.totalTrades || 0), 0),
        avg_win_rate: this.calculatePortfolioWinRate(strategies),
        avg_sharpe: strategies.reduce((sum, s) => sum + (s.sharpeRatio || 0), 0) / Math.max(1, strategies.length),
        profit_factor: this.calculateProfitFactor(strategies),
      },
    };
  }

  pauseStrategy(strategyId: string, reason: string): void {
    const strategy = this.strategyStates.get(strategyId);
    if (strategy) {
      strategy.status = "paused";
      strategy.pauseReason = reason;
      strategy.pausedAt = new Date().toISOString();
      logger.info({ strategyId, reason }, `Strategy paused by operator`);
    }
  }

  resumeStrategy(strategyId: string): void {
    const strategy = this.strategyStates.get(strategyId);
    if (strategy) {
      strategy.status = "active";
      strategy.pauseReason = null;
      logger.info({ strategyId }, `Strategy resumed by operator`);
    }
  }

  overridePromotion(strategyId: string, targetTier: string, reason: string): void {
    const decision = {
      id: `override_${Date.now()}`,
      type: "override_promotion",
      strategyId,
      targetTier,
      reason,
      timestamp: new Date().toISOString(),
      operator: "operator_name",
    };

    this.operatorDecisions.set(decision.id, decision);
    logger.warn({ strategyId, targetTier, reason }, `Promotion overridden by operator`);
  }

  forceRetire(strategyId: string, reason: string): void {
    const strategy = this.strategyStates.get(strategyId);
    if (strategy) {
      strategy.status = "retired";
      strategy.retirementReason = reason;
      strategy.retiredAt = new Date().toISOString();
      logger.info({ strategyId, reason }, `Strategy force-retired by operator`);
    }
  }

  // Private helpers

  private identifyAtRiskStrategies(strategies: any[]) {
    return strategies
      .filter((s) => s.maxDrawdown > 0.2 || s.sharpeRatio < 0.8 || (s.consecutiveLosses || 0) > 5)
      .map((s) => {
        let reason = "";
        if (s.maxDrawdown > 0.2) reason = `High drawdown ${(s.maxDrawdown * 100).toFixed(1)}%`;
        else if (s.sharpeRatio < 0.8) reason = `Low Sharpe ${s.sharpeRatio.toFixed(2)}`;
        else if ((s.consecutiveLosses || 0) > 5) reason = `${s.consecutiveLosses} consecutive losses`;

        return {
          strategyId: s.strategyId,
          name: s.name,
          reason,
          tier: s.tier || "LEARNING",
          suggestedAction: "Monitor closely or consider demotion",
        };
      })
      .slice(0, 10);
  }

  private calculatePortfolioSharpe(strategies: any[]): number {
    if (strategies.length === 0) return 0;
    const weighted = strategies.reduce((sum, s) => sum + (s.sharpeRatio || 0), 0);
    return weighted / strategies.length;
  }

  private calculatePortfolioWinRate(strategies: any[]): number {
    if (strategies.length === 0) return 0;
    const weighted = strategies.reduce((sum, s) => sum + (s.winRate || 0), 0);
    return weighted / strategies.length;
  }

  private calculateProfitFactor(strategies: any[]): number {
    const totalWins = strategies.reduce((sum, s) => sum + Math.max(0, s.pnL || 0), 0);
    const totalLosses = strategies.reduce((sum, s) => sum + Math.abs(Math.min(0, s.pnL || 0)), 0);
    return totalLosses > 0 ? totalWins / totalLosses : 1;
  }

  private checkConcentration(strategies: any[]): boolean {
    const exposures = strategies.map((s) => s.exposure || 0);
    const totalExposure = exposures.reduce((a, b) => a + b, 0);
    const maxExposure = Math.max(...exposures);
    return maxExposure / Math.max(1, totalExposure) > 0.3; // Alert if one strategy > 30%
  }

  private checkCorrelation(strategies: any[]): boolean {
    // Simplified: alert if portfolio mostly in one market regime
    const regimes = new Map<string, number>();
    for (const s of strategies) {
      const r = s.regime || "UNKNOWN";
      regimes.set(r, (regimes.get(r) || 0) + 1);
    }
    const maxRegimeCount = Math.max(...Array.from(regimes.values()));
    return maxRegimeCount / strategies.length > 0.6; // Alert if 60%+ in one regime
  }

  private checkVolatility(strategies: any[]): boolean {
    const volatilities = strategies.map((s) => s.volatility || 0);
    const avgVol = volatilities.reduce((a, b) => a + b, 0) / Math.max(1, volatilities.length);
    return avgVol > 0.3; // Alert if average volatility > 30%
  }

  private getAlertSummary() {
    const counts = { critical: 0, warning: 0, info: 0 };
    for (const alert of this.alerts.values()) {
      if (alert.status !== "resolved") {
        counts[alert.severity] = (counts[alert.severity] || 0) + 1;
      }
    }
    return counts;
  }

  private generateRecommendations(strategies: any[], alerts: any[], degrading: any[]): string[] {
    const recs: string[] = [];

    if (degrading.length > 0) {
      recs.push(`${degrading.length} strategies in degradation state — consider demotion or retirement`);
    }

    const criticalAlerts = alerts.filter((a) => a.severity === "critical");
    if (criticalAlerts.length > 0) {
      recs.push(`${criticalAlerts.length} critical alert(s) requiring immediate attention`);
    }

    const lowSharpe = strategies.filter((s) => s.sharpeRatio < 0.8);
    if (lowSharpe.length > Math.ceil(strategies.length * 0.2)) {
      recs.push("More than 20% of strategies underperforming — review parameter tuning");
    }

    if (recs.length === 0) {
      recs.push("Portfolio health nominal — continue monitoring");
    }

    return recs;
  }
}
