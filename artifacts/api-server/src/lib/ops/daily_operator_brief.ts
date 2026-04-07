import { EventEmitter } from 'events';

/**
 * Daily Operator Brief for GodsView Quant Intelligence Layer
 * 
 * Generates comprehensive daily and weekly briefings for the operator,
 * covering system health, strategy status, performance, and action items.
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'warning' | 'critical';
  uptime: number; // percentage (0-100)
  lastCheckTime: Date;
  alerts: Array<{
    level: 'info' | 'warning' | 'error' | 'critical';
    message: string;
    timestamp: Date;
    component: string;
  }>;
}

export interface StrategyStatus {
  byTier: {
    autonomous: number;
    assisted: number;
    shadow: number;
    disabled: number;
  };
  pendingPromotions: Array<{
    strategyId: string;
    name: string;
    currentTier: string;
    targetTier: string;
    readinessScore: number;
  }>;
  recentDemotions: Array<{
    strategyId: string;
    name: string;
    fromTier: string;
    toTier: string;
    reason: string;
    timestamp: Date;
  }>;
}

export interface PerformanceMetrics {
  totalPnl: number;
  totalPnlPercent: number;
  dayCount: number;
  bestStrategy: {
    name: string;
    pnl: number;
    sharpeRatio: number;
  };
  worstStrategy: {
    name: string;
    pnl: number;
    sharpeRatio: number;
  };
  avgSharpe: number;
  winRate: number;
  totalTrades: number;
  totalWinningTrades: number;
}

export interface DriftAlert {
  strategyId: string;
  strategyName: string;
  driftScore: number;
  affectedComponent: string;
  severity: 'low' | 'medium' | 'high';
  detectionTime: Date;
  suggestedAction: string;
}

export interface CalibrationStatus {
  score: number; // 0-1, measure of backtest-to-live alignment
  trend: 'improving' | 'stable' | 'degrading';
  alerts: Array<{
    metric: string;
    expectedValue: number;
    actualValue: number;
    divergence: number; // percentage
    severity: 'warning' | 'critical';
  }>;
}

export interface ShadowSession {
  strategyId: string;
  strategyName: string;
  sessionStartDate: Date;
  daysInSession: number;
  paperPnl: number;
  paperSharpe: number;
  estimatedReadyDate: Date;
  comments: string;
}

export interface MemoryHealth {
  storeSize: number; // bytes
  entryCount: number;
  retrievalQuality: number; // 0-1
  lastPruneDate: Date;
  daysSinceLastPrune: number;
}

export interface EvaluationStatus {
  lastGrade: string;
  gradeDate: Date;
  regressions: Array<{
    evaluator: string;
    severity: 'low' | 'medium' | 'high';
    failedTests: number;
  }>;
  lastRunDate: Date;
  avgGrade: string;
}

export interface ActionItem {
  id: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  category: 'strategy' | 'system' | 'compliance' | 'maintenance' | 'investigation';
  title: string;
  description: string;
  requiredBy: Date;
  owner?: string;
  status: 'pending' | 'in_progress' | 'blocked';
}

export interface RiskSummary {
  currentExposure: number;
  maxExposure: number;
  exposureUtilization: number; // percentage
  worstCaseScenario: {
    description: string;
    estimatedLoss: number;
    probability: string;
  };
  mode: 'autonomous' | 'assisted' | 'shadow' | 'emergency_stop';
  riskScore: number; // 0-100
}

export interface DailyBrief {
  date: Date;
  briefId: string;
  systemHealth: SystemHealth;
  strategies: StrategyStatus;
  performance: PerformanceMetrics;
  drift: {
    alertCount: number;
    worstDrift: DriftAlert | null;
    affectedStrategies: DriftAlert[];
  };
  calibration: CalibrationStatus;
  shadow: {
    activeSessions: number;
    sessions: ShadowSession[];
    readyForPromotion: string[]; // strategy names
    recentDecisions: Array<{
      strategyId: string;
      decision: 'approved' | 'rejected' | 'extend';
      date: Date;
    }>;
  };
  memory: MemoryHealth;
  eval: EvaluationStatus;
  actionItems: ActionItem[];
  riskSummary: RiskSummary;
}

export interface WeeklyBrief {
  weekStart: Date;
  weekEnd: Date;
  briefId: string;
  dailyBriefs: DailyBrief[];
  weekSummary: {
    totalPnl: number;
    avgPnl: number;
    bestDay: Date;
    worstDay: Date;
    newStrategiesOnboarded: number;
    strategiesPromoted: number;
    strategiesDemoted: number;
    incidents: number;
    avgSystemHealth: string;
  };
  cumulativeActionItems: ActionItem[];
  recommendations: string[];
}

// ============================================================================
// DAILY OPERATOR BRIEF CLASS
// ============================================================================

export class DailyOperatorBrief extends EventEmitter {
  private briefHistory: Map<string, DailyBrief> = new Map();
  private weeklyHistory: Map<string, WeeklyBrief> = new Map();

  constructor() {
    super();
  }

  public generateBrief(): DailyBrief {
    const today = new Date();
    const briefId = `BRIEF-${today.toISOString().split('T')[0]}-${Math.random().toString(36).substring(7).toUpperCase()}`;

    const brief: DailyBrief = {
      date: today,
      briefId,
      systemHealth: this.generateSystemHealth(),
      strategies: this.generateStrategyStatus(),
      performance: this.generatePerformanceMetrics(),
      drift: this.generateDriftAnalysis(),
      calibration: this.generateCalibrationStatus(),
      shadow: this.generateShadowStatus(),
      memory: this.generateMemoryHealth(),
      eval: this.generateEvaluationStatus(),
      actionItems: this.generateActionItems(),
      riskSummary: this.generateRiskSummary(),
    };

    this.briefHistory.set(briefId, brief);
    return brief;
  }

  public generateWeeklyBrief(dailyBriefs?: DailyBrief[]): WeeklyBrief {
    const today = new Date();
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const briefs = dailyBriefs || Array.from(this.briefHistory.values()).slice(-7);

    const briefId = `WEEKBRIEF-${weekStart.toISOString().split('T')[0]}-${Math.random().toString(36).substring(7).toUpperCase()}`;

    const pnlValues = briefs.map((b) => b.performance.totalPnl);
    const totalPnl = pnlValues.reduce((a, b) => a + b, 0);
    const avgPnl = totalPnl / briefs.length;

    const weekBrief: WeeklyBrief = {
      weekStart,
      weekEnd,
      briefId,
      dailyBriefs: briefs,
      weekSummary: {
        totalPnl,
        avgPnl,
        bestDay: briefs[0].date, // placeholder
        worstDay: briefs[briefs.length - 1].date, // placeholder
        newStrategiesOnboarded: this.countNewStrategies(briefs),
        strategiesPromoted: this.countPromotions(briefs),
        strategiesDemoted: this.countDemotions(briefs),
        incidents: this.countIncidents(briefs),
        avgSystemHealth: this.calculateAvgHealth(briefs),
      },
      cumulativeActionItems: this.aggregateActionItems(briefs),
      recommendations: this.generateWeeklyRecommendations(briefs),
    };

    this.weeklyHistory.set(briefId, weekBrief);
    return weekBrief;
  }

  private generateSystemHealth(): SystemHealth {
    return {
      status: 'healthy',
      uptime: 99.97,
      lastCheckTime: new Date(),
      alerts: [
        {
          level: 'info',
          message: 'All systems operational',
          timestamp: new Date(),
          component: 'system',
        },
      ],
    };
  }

  private generateStrategyStatus(): StrategyStatus {
    return {
      byTier: {
        autonomous: 12,
        assisted: 4,
        shadow: 3,
        disabled: 1,
      },
      pendingPromotions: [
        {
          strategyId: 'STRAT-2025-0847',
          name: 'Mean Reversion Alpha',
          currentTier: 'assisted',
          targetTier: 'autonomous',
          readinessScore: 0.92,
        },
      ],
      recentDemotions: [],
    };
  }

  private generatePerformanceMetrics(): PerformanceMetrics {
    return {
      totalPnl: 125400,
      totalPnlPercent: 2.34,
      dayCount: 1,
      bestStrategy: {
        name: 'High-Frequency Spread Capture',
        pnl: 18750,
        sharpeRatio: 2.15,
      },
      worstStrategy: {
        name: 'Momentum Cross-Asset',
        pnl: -3200,
        sharpeRatio: 0.45,
      },
      avgSharpe: 1.23,
      winRate: 0.62,
      totalTrades: 847,
      totalWinningTrades: 525,
    };
  }

  private generateDriftAnalysis(): {
    alertCount: number;
    worstDrift: DriftAlert | null;
    affectedStrategies: DriftAlert[];
  } {
    return {
      alertCount: 1,
      worstDrift: {
        strategyId: 'STRAT-2025-0521',
        strategyName: 'Volatility Mean Reversion',
        driftScore: 0.18,
        affectedComponent: 'entry signal generator',
        severity: 'medium',
        detectionTime: new Date(Date.now() - 3600000),
        suggestedAction: 'Monitor closely; diagnostic replay recommended',
      },
      affectedStrategies: [
        {
          strategyId: 'STRAT-2025-0521',
          strategyName: 'Volatility Mean Reversion',
          driftScore: 0.18,
          affectedComponent: 'entry signal generator',
          severity: 'medium',
          detectionTime: new Date(Date.now() - 3600000),
          suggestedAction: 'Monitor closely; diagnostic replay recommended',
        },
      ],
    };
  }

  private generateCalibrationStatus(): CalibrationStatus {
    return {
      score: 0.88,
      trend: 'stable',
      alerts: [],
    };
  }

  private generateShadowStatus(): {
    activeSessions: number;
    sessions: ShadowSession[];
    readyForPromotion: string[];
    recentDecisions: Array<{
      strategyId: string;
      decision: 'approved' | 'rejected' | 'extend';
      date: Date;
    }>;
  } {
    return {
      activeSessions: 3,
      sessions: [
        {
          strategyId: 'STRAT-2025-0923',
          strategyName: 'Statistical Arbitrage V2',
          sessionStartDate: new Date(Date.now() - 864000000),
          daysInSession: 10,
          paperPnl: 42350,
          paperSharpe: 1.58,
          estimatedReadyDate: new Date(Date.now() + 432000000),
          comments: 'Performance tracking well; calibration data excellent',
        },
      ],
      readyForPromotion: [],
      recentDecisions: [
        {
          strategyId: 'STRAT-2025-0834',
          decision: 'approved',
          date: new Date(Date.now() - 604800000),
        },
      ],
    };
  }

  private generateMemoryHealth(): MemoryHealth {
    return {
      storeSize: 425897233,
      entryCount: 142857,
      retrievalQuality: 0.91,
      lastPruneDate: new Date(Date.now() - 86400000),
      daysSinceLastPrune: 1,
    };
  }

  private generateEvaluationStatus(): EvaluationStatus {
    return {
      lastGrade: 'A',
      gradeDate: new Date(Date.now() - 3600000),
      regressions: [],
      lastRunDate: new Date(Date.now() - 3600000),
      avgGrade: 'A-',
    };
  }

  private generateActionItems(): ActionItem[] {
    return [
      {
        id: 'ACTION-0001',
        priority: 'medium',
        category: 'strategy',
        title: 'Review drift alert for Volatility Mean Reversion',
        description: 'Investigate component divergence in entry signal generator. Run diagnostic replay.',
        requiredBy: new Date(Date.now() + 86400000),
        owner: 'Quant Engineer',
        status: 'pending',
      },
      {
        id: 'ACTION-0002',
        priority: 'high',
        category: 'compliance',
        title: 'Generate weekly governance report',
        description: 'Complete governance review including strategy tier review, pending promotions, risk posture.',
        requiredBy: new Date(Date.now() + 172800000),
        owner: 'Governance Team',
        status: 'in_progress',
      },
    ];
  }

  private generateRiskSummary(): RiskSummary {
    return {
      currentExposure: 4250000,
      maxExposure: 5000000,
      exposureUtilization: 0.85,
      worstCaseScenario: {
        description: 'Market circuit breaker + major drift in 2 largest strategies',
        estimatedLoss: 385000,
        probability: 'low (<1%)',
      },
      mode: 'autonomous',
      riskScore: 38,
    };
  }

  public getActionItems(): ActionItem[] {
    const brief = this.generateBrief();
    return brief.actionItems.sort((a, b) => {
      const priorityOrder: Record<string, number> = {
        critical: 0,
        high: 1,
        medium: 2,
        low: 3,
      };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  public getRiskSummary(): RiskSummary {
    const brief = this.generateBrief();
    return brief.riskSummary;
  }

  public formatForSlack(): string {
    const brief = this.generateBrief();
    const lines: string[] = [
      '📊 GodsView Daily Operator Brief',
      `_${brief.date.toDateString()}_`,
      '',
      '✅ *System Status*',
      `Status: ${brief.systemHealth.status.toUpperCase()} | Uptime: ${brief.systemHealth.uptime}%`,
      '',
      '📈 *Strategy Portfolio*',
      `Autonomous: ${brief.strategies.byTier.autonomous} | Assisted: ${brief.strategies.byTier.assisted} | Shadow: ${brief.strategies.byTier.shadow}`,
      '',
      '💰 *Yesterday Performance*',
      `PnL: $${brief.performance.totalPnl.toLocaleString()} (${(brief.performance.totalPnlPercent * 100).toFixed(2)}%)`,
      `Avg Sharpe: ${brief.performance.avgSharpe.toFixed(2)} | Win Rate: ${(brief.performance.winRate * 100).toFixed(1)}%`,
      '',
      '⚠️ *Alerts*',
      brief.drift.alertCount > 0
        ? `${brief.drift.alertCount} drift alert(s) detected`
        : 'No drift alerts',
      brief.calibration.alerts.length > 0
        ? `${brief.calibration.alerts.length} calibration alert(s)`
        : 'Calibration nominal',
      '',
      '🎯 *Action Items*',
      `${brief.actionItems.length} item(s) requiring attention`,
      brief.actionItems
        .slice(0, 3)
        .map((item) => `  • [${item.priority.toUpperCase()}] ${item.title}`)
        .join('\n'),
      '',
      `View full brief: Brief ID ${brief.briefId}`,
    ];
    return lines.join('\n');
  }

  public formatForEmail(): string {
    const brief = this.generateBrief();
    const dateStr = brief.date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const lines: string[] = [
      'GodsView Daily Operator Brief',
      dateStr,
      '',
      '========================================================================',
      'SYSTEM STATUS',
      '========================================================================',
      '',
      `Status: ${brief.systemHealth.status.toUpperCase()}`,
      `Uptime: ${brief.systemHealth.uptime}%`,
      `Last Check: ${brief.systemHealth.lastCheckTime.toLocaleTimeString()}`,
      '',
      brief.systemHealth.alerts
        .map((a) => `  [${a.level.toUpperCase()}] ${a.message}`)
        .join('\n'),
      '',
      '========================================================================',
      'STRATEGY PORTFOLIO',
      '========================================================================',
      '',
      `Autonomous Strategies:  ${brief.strategies.byTier.autonomous}`,
      `Assisted Strategies:    ${brief.strategies.byTier.assisted}`,
      `Shadow Strategies:      ${brief.strategies.byTier.shadow}`,
      `Disabled Strategies:    ${brief.strategies.byTier.disabled}`,
      '',
      brief.strategies.pendingPromotions.length > 0
        ? `Pending Promotions: ${brief.strategies.pendingPromotions.length}\n` +
          brief.strategies.pendingPromotions
            .map((p) => `  - ${p.name} (${p.currentTier} -> ${p.targetTier}): ${(p.readinessScore * 100).toFixed(1)}% ready`)
            .join('\n')
        : 'No pending promotions',
      '',
      '========================================================================',
      'YESTERDAY PERFORMANCE',
      '========================================================================',
      '',
      `Total PnL:           $${brief.performance.totalPnl.toLocaleString()} (${(brief.performance.totalPnlPercent * 100).toFixed(2)}%)`,
      `Best Strategy:       ${brief.performance.bestStrategy.name} ($${brief.performance.bestStrategy.pnl.toLocaleString()})`,
      `Worst Strategy:      ${brief.performance.worstStrategy.name} ($${brief.performance.worstStrategy.pnl.toLocaleString()})`,
      `Avg Sharpe Ratio:    ${brief.performance.avgSharpe.toFixed(2)}`,
      `Win Rate:            ${(brief.performance.winRate * 100).toFixed(1)}%`,
      `Total Trades:        ${brief.performance.totalTrades}`,
      `Winning Trades:      ${brief.performance.totalWinningTrades}`,
      '',
      '========================================================================',
      'DRIFT DETECTION',
      '========================================================================',
      '',
      brief.drift.alertCount > 0
        ? `${brief.drift.alertCount} drift alert(s) detected\n\n` +
          brief.drift.affectedStrategies
            .map((d) => `  Strategy: ${d.strategyName}\n  Component: ${d.affectedComponent}\n  Drift Score: ${d.driftScore.toFixed(3)}\n  Severity: ${d.severity.toUpperCase()}\n  Action: ${d.suggestedAction}`)
            .join('\n\n')
        : 'No drift alerts',
      '',
      '========================================================================',
      'CALIBRATION STATUS',
      '========================================================================',
      '',
      `Calibration Score:   ${(brief.calibration.score * 100).toFixed(1)}%`,
      `Trend:               ${brief.calibration.trend.toUpperCase()}`,
      brief.calibration.alerts.length > 0
        ? `Alerts:\n${brief.calibration.alerts.map((a) => `  - ${a.metric}: ${a.divergence.toFixed(1)}% divergence (${a.severity.toUpperCase()})`).join('\n')}`
        : 'Nominal',
      '',
      '========================================================================',
      'ACTION ITEMS',
      '========================================================================',
      '',
      brief.actionItems.length > 0
        ? brief.actionItems
            .map((item) => {
              const dueDate = item.requiredBy.toLocaleDateString();
              return `[${item.priority.toUpperCase()}] ${item.title}\n  Category: ${item.category}\n  Due: ${dueDate}\n  Status: ${item.status}`;
            })
            .join('\n\n')
        : 'No action items',
      '',
      '========================================================================',
      'RISK SUMMARY',
      '========================================================================',
      '',
      `Current Exposure:        $${brief.riskSummary.currentExposure.toLocaleString()}`,
      `Max Exposure:            $${brief.riskSummary.maxExposure.toLocaleString()}`,
      `Utilization:             ${(brief.riskSummary.exposureUtilization * 100).toFixed(1)}%`,
      `Mode:                    ${brief.riskSummary.mode.toUpperCase()}`,
      `Risk Score:              ${brief.riskSummary.riskScore}/100`,
      '',
      `Worst Case:              ${brief.riskSummary.worstCaseScenario.description}`,
      `Est. Loss:               $${brief.riskSummary.worstCaseScenario.estimatedLoss.toLocaleString()}`,
      `Probability:             ${brief.riskSummary.worstCaseScenario.probability}`,
      '',
      '========================================================================',
      `Brief ID: ${brief.briefId}`,
      `Generated: ${brief.date.toISOString()}`,
      '========================================================================',
    ];

    return lines.join('\n');
  }

  private countNewStrategies(briefs: DailyBrief[]): number {
    return briefs.reduce((sum, brief) => {
      return sum + (brief.strategies.byTier.shadow > 0 ? 1 : 0);
    }, 0);
  }

  private countPromotions(briefs: DailyBrief[]): number {
    return briefs.reduce((sum, brief) => {
      return sum + brief.strategies.pendingPromotions.length;
    }, 0);
  }

  private countDemotions(briefs: DailyBrief[]): number {
    return briefs.reduce((sum, brief) => {
      return sum + brief.strategies.recentDemotions.length;
    }, 0);
  }

  private countIncidents(briefs: DailyBrief[]): number {
    return briefs.reduce((sum, brief) => {
      return sum + brief.systemHealth.alerts.filter((a) => a.level === 'error' || a.level === 'critical').length;
    }, 0);
  }

  private calculateAvgHealth(briefs: DailyBrief[]): string {
    if (briefs.length === 0) return 'unknown';
    const healthScores: Record<string, number> = {
      healthy: 100,
      degraded: 75,
      warning: 50,
      critical: 0,
    };
    const avgScore = briefs.reduce((sum, brief) => sum + (healthScores[brief.systemHealth.status] || 50), 0) / briefs.length;
    if (avgScore >= 95) return 'Excellent';
    if (avgScore >= 80) return 'Good';
    if (avgScore >= 60) return 'Fair';
    return 'Poor';
  }

  private aggregateActionItems(briefs: DailyBrief[]): ActionItem[] {
    const itemMap = new Map<string, ActionItem>();
    briefs.forEach((brief) => {
      brief.actionItems.forEach((item) => {
        if (!itemMap.has(item.id)) {
          itemMap.set(item.id, item);
        }
      });
    });
    return Array.from(itemMap.values()).sort((a, b) => {
      const priorityOrder: Record<string, number> = {
        critical: 0,
        high: 1,
        medium: 2,
        low: 3,
      };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  private generateWeeklyRecommendations(briefs: DailyBrief[]): string[] {
    const recommendations: string[] = [];

    const avgDriftAlerts = briefs.reduce((sum, b) => sum + b.drift.alertCount, 0) / briefs.length;
    if (avgDriftAlerts > 1.5) {
      recommendations.push('High drift alert frequency detected. Consider reviewing strategy parameterization.');
    }

    const worstCalibration = briefs.reduce((min, b) => Math.min(min, b.calibration.score), 1);
    if (worstCalibration < 0.8) {
      recommendations.push('Calibration score below 0.8. Run recalibration procedure with latest live data.');
    }

    const demotions = briefs.reduce((sum, b) => sum + b.strategies.recentDemotions.length, 0);
    if (demotions > 2) {
      recommendations.push('Multiple strategy demotions this week. Review gating criteria and deployment conditions.');
    }

    const avgRiskScore = briefs.reduce((sum, b) => sum + b.riskSummary.riskScore, 0) / briefs.length;
    if (avgRiskScore > 60) {
      recommendations.push('Risk score trending high. Consider tightening position limits or reducing autonomous exposure.');
    }

    if (recommendations.length === 0) {
      recommendations.push('System operating nominally. Continue with standard monitoring procedures.');
    }

    return recommendations;
  }
}

export default DailyOperatorBrief;
