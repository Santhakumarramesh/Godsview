// ShadowScorecard: Hard promotion gate enforcing shadow mode validation
// Shadow mode is NOT optional - it is required proof before any strategy gets live authority
// Tracks minimum requirements, pass/fail criteria, and rejection reasons

import { Logger } from '../logging/logger';

export interface ShadowSession {
  sessionId: string;
  strategyId: string;
  startDate: Date;
  endDate?: Date;
  duration: number; // days
  tradeCount: number;
  sharpe: number;
  maxDrawdown: number;
  maxRunup: number;
  winRate: number;
  profitFactor: number;
  averageTrade: number;
  signalToBacktestCorrelation: number;
  fillRealismScore: number;
  driftAlertCount: number;
  selfRefusalCount: number;
  status: 'ACTIVE' | 'COMPLETED' | 'EXTENDED' | 'REJECTED';
}

export interface ShadowCriterion {
  name: string;
  requirement: string;
  actualValue: number | boolean;
  threshold: number | boolean;
  passed: boolean;
  weight: number;
}

export interface ShadowScorecard {
  sessionId: string;
  strategyId: string;
  generatedAt: Date;
  criteria: ShadowCriterion[];
  allPassed: boolean;
  passCount: number;
  failCount: number;
  weightedScore: number;
  recommendation: 'PROMOTE' | 'EXTEND' | 'REJECT';
  reasoning: string;
  rejectionReasons?: string[];
  extensionReasons?: string[];
  nextReviewDate?: Date;
}

export interface PromotionDecision {
  approved: boolean;
  strategyId: string;
  shadowSessionId: string;
  timestamp: Date;
  decision: 'APPROVED_TO_ASSISTED' | 'REJECTED' | 'NEEDS_EXTENSION';
  confidence: number;
  scorecardSummary: ShadowScorecard;
  evidencePacket: {
    minimumPeriodMet: boolean;
    minimumTradesMet: boolean;
    sharpeRequirementMet: boolean;
    drawdownRequirementMet: boolean;
    correlationRequirementMet: boolean;
    noExcessiveDriftAlerts: boolean;
    fillRealismMet: boolean;
    noExcessiveSelfRefusals: boolean;
  };
  approverNotes?: string;
}

export interface PromotionHistoryEntry {
  timestamp: Date;
  strategyId: string;
  shadowSessionId: string;
  decision: 'APPROVED_TO_ASSISTED' | 'REJECTED' | 'EXTENDED';
  reasoning: string;
  scorecard: ShadowScorecard;
}

export interface VariantComparison {
  promotedStrategyId: string;
  rejectedStrategyId: string;
  promotedMetrics: {
    sharpe: number;
    maxDD: number;
    winRate: number;
    profitFactor: number;
  };
  rejectedMetrics: {
    sharpe: number;
    maxDD: number;
    winRate: number;
    profitFactor: number;
  };
  performanceDifference: {
    sharpeEdge: number;
    ddImprovement: number;
    winRateEdge: number;
    profitFactorEdge: number;
  };
  promotedStrategy6MonthResult: {
    actualSharpe?: number;
    actualMaxDD?: number;
    actualWinRate?: number;
  };
  rejectedStrategy6MonthResult?: {
    actualSharpe?: number;
    actualMaxDD?: number;
    actualWinRate?: number;
  };
  conclusionSupportsGate: boolean;
}

export class ShadowScorecard {
  private logger: Logger;
  private promotionHistory: PromotionHistoryEntry[] = [];
  private shadowSessions: Map<string, ShadowSession> = new Map();
  private rejectionArchive: Map<string, string[]> = new Map();

  private minimumShadowDays = 30;
  private minimumShadowTrades = 50;
  private minimumSharpe = 0.5;
  private maximumDrawdown = 0.25; // 25% unless specified
  private minimumCorrelation = 0.7;
  private maximumDriftAlerts = 3;
  private minimumFillRealismScore = 70;
  private maximumSelfRefusals = 3;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Register a shadow session for monitoring
   */
  public registerShadowSession(session: ShadowSession): void {
    this.shadowSessions.set(session.sessionId, session);
    this.logger.info(
      `Shadow session registered: ${session.strategyId} (${session.sessionId})`
    );
  }

  /**
   * Update shadow session with latest metrics
   */
  public updateShadowSession(sessionId: string, update: Partial<ShadowSession>): void {
    const session = this.shadowSessions.get(sessionId);
    if (!session) {
      this.logger.error(`Shadow session not found: ${sessionId}`);
      return;
    }

    Object.assign(session, update);
    this.shadowSessions.set(sessionId, session);
  }

  /**
   * Evaluate shadow session for promotion to ASSISTED tier
   * Returns structured decision with full evidence
   */
  public evaluateForPromotion(sessionId: string): PromotionDecision {
    const session = this.shadowSessions.get(sessionId);
    if (!session) {
      throw new Error(`Shadow session not found: ${sessionId}`);
    }

    const scorecard = this.getScorecard(sessionId);

    const evidencePacket = {
      minimumPeriodMet: session.duration >= this.minimumShadowDays,
      minimumTradesMet: session.tradeCount >= this.minimumShadowTrades,
      sharpeRequirementMet: session.sharpe >= this.minimumSharpe,
      drawdownRequirementMet: session.maxDrawdown <= this.maximumDrawdown,
      correlationRequirementMet:
        session.signalToBacktestCorrelation >= this.minimumCorrelation,
      noExcessiveDriftAlerts: session.driftAlertCount <= this.maximumDriftAlerts,
      fillRealismMet: session.fillRealismScore >= this.minimumFillRealismScore,
      noExcessiveSelfRefusals: session.selfRefusalCount <= this.maximumSelfRefusals,
    };

    const allConditionsMet = Object.values(evidencePacket).every((v) => v === true);

    let decision: 'APPROVED_TO_ASSISTED' | 'REJECTED' | 'NEEDS_EXTENSION';
    let confidence = 0;

    if (allConditionsMet) {
      decision = 'APPROVED_TO_ASSISTED';
      confidence = this.computePromotionConfidence(session, scorecard);
    } else {
      const failedCriteria = Object.entries(evidencePacket)
        .filter(([, passed]) => !passed)
        .map(([criterion]) => criterion);

      if (
        failedCriteria.length <= 2 &&
        (failedCriteria.includes('minimumPeriodMet') ||
          failedCriteria.includes('minimumTradesMet'))
      ) {
        decision = 'NEEDS_EXTENSION';
      } else {
        decision = 'REJECTED';
      }
      confidence = 0;
    }

    const promotionDecision: PromotionDecision = {
      approved: decision === 'APPROVED_TO_ASSISTED',
      strategyId: session.strategyId,
      shadowSessionId: sessionId,
      timestamp: new Date(),
      decision,
      confidence,
      scorecardSummary: scorecard,
      evidencePacket,
    };

    if (decision === 'APPROVED_TO_ASSISTED') {
      this.recordPromotionApproval(promotionDecision);
      this.logger.info(
        `Strategy ${session.strategyId} APPROVED for promotion (confidence: ${confidence.toFixed(2)})`
      );
    } else if (decision === 'REJECTED') {
      this.recordRejection(session.strategyId, scorecard.rejectionReasons || []);
      this.logger.warn(
        `Strategy ${session.strategyId} REJECTED: ${(scorecard.rejectionReasons || []).join(', ')}`
      );
    } else {
      this.logger.info(
        `Strategy ${session.strategyId} requires extended shadow: ${(scorecard.extensionReasons || []).join(', ')}`
      );
    }

    return promotionDecision;
  }

  /**
   * Get detailed scorecard for shadow session
   */
  public getScorecard(sessionId: string): ShadowScorecard {
    const session = this.shadowSessions.get(sessionId);
    if (!session) {
      throw new Error(`Shadow session not found: ${sessionId}`);
    }

    const criteria: ShadowCriterion[] = [
      {
        name: 'Minimum Shadow Period',
        requirement: `${this.minimumShadowDays} days`,
        actualValue: session.duration,
        threshold: this.minimumShadowDays,
        passed: session.duration >= this.minimumShadowDays,
        weight: 0.15,
      },
      {
        name: 'Minimum Shadow Trades',
        requirement: `${this.minimumShadowTrades} trades`,
        actualValue: session.tradeCount,
        threshold: this.minimumShadowTrades,
        passed: session.tradeCount >= this.minimumShadowTrades,
        weight: 0.15,
      },
      {
        name: 'Shadow Sharpe Ratio',
        requirement: `>= ${this.minimumSharpe}`,
        actualValue: session.sharpe,
        threshold: this.minimumSharpe,
        passed: session.sharpe >= this.minimumSharpe,
        weight: 0.25,
      },
      {
        name: 'Shadow Max Drawdown',
        requirement: `<= ${(this.maximumDrawdown * 100).toFixed(1)}%`,
        actualValue: session.maxDrawdown,
        threshold: this.maximumDrawdown,
        passed: session.maxDrawdown <= this.maximumDrawdown,
        weight: 0.2,
      },
      {
        name: 'Signal-to-Backtest Correlation',
        requirement: `>= ${this.minimumCorrelation}`,
        actualValue: session.signalToBacktestCorrelation,
        threshold: this.minimumCorrelation,
        passed: session.signalToBacktestCorrelation >= this.minimumCorrelation,
        weight: 0.1,
      },
      {
        name: 'Drift Alerts (Max)',
        requirement: `<= ${this.maximumDriftAlerts}`,
        actualValue: session.driftAlertCount,
        threshold: this.maximumDriftAlerts,
        passed: session.driftAlertCount <= this.maximumDriftAlerts,
        weight: 0.08,
      },
      {
        name: 'Fill Realism Score',
        requirement: `>= ${this.minimumFillRealismScore}`,
        actualValue: session.fillRealismScore,
        threshold: this.minimumFillRealismScore,
        passed: session.fillRealismScore >= this.minimumFillRealismScore,
        weight: 0.05,
      },
      {
        name: 'Self-Refusal Limit',
        requirement: `<= ${this.maximumSelfRefusals} triggers`,
        actualValue: session.selfRefusalCount,
        threshold: this.maximumSelfRefusals,
        passed: session.selfRefusalCount <= this.maximumSelfRefusals,
        weight: 0.02,
      },
    ];

    const passCount = criteria.filter((c) => c.passed).length;
    const failCount = criteria.length - passCount;
    const allPassed = failCount === 0;

    const weightedScore = criteria.reduce((sum, c) => {
      return sum + (c.passed ? c.weight * 100 : 0);
    }, 0);

    const rejectionReasons = criteria
      .filter((c) => !c.passed)
      .map((c) => `${c.name}: ${c.requirement} (actual: ${c.actualValue})`);

    const extensionReasons =
      session.duration < this.minimumShadowDays * 1.5
        ? [`Insufficient shadow period: ${session.duration}/${this.minimumShadowDays} days`]
        : [];

    let recommendation: 'PROMOTE' | 'EXTEND' | 'REJECT' = 'REJECT';
    let reasoning = '';

    if (allPassed) {
      recommendation = 'PROMOTE';
      reasoning =
        `All ${passCount} criteria passed. Shadow metrics demonstrate strong alignment with backtest. ` +
        `Sharpe ${session.sharpe.toFixed(2)}, max DD ${(session.maxDrawdown * 100).toFixed(1)}%, ` +
        `correlation ${session.signalToBacktestCorrelation.toFixed(2)}. Ready for ASSISTED tier.`;
    } else if (
      failCount <= 2 &&
      (criteria.find((c) => c.name === 'Minimum Shadow Period')?.passed === false ||
        criteria.find((c) => c.name === 'Minimum Shadow Trades')?.passed === false)
    ) {
      recommendation = 'EXTEND';
      reasoning = `${passCount}/${criteria.length} criteria passed. Only time/trade requirements failing. Recommend extending shadow period by 14 days.`;
    } else {
      recommendation = 'REJECT';
      reasoning = `${failCount} critical criteria failed: ${rejectionReasons.slice(0, 2).join('; ')}. Does not meet promotion standard.`;
    }

    return {
      sessionId,
      strategyId: session.strategyId,
      generatedAt: new Date(),
      criteria,
      allPassed,
      passCount,
      failCount,
      weightedScore,
      recommendation,
      reasoning,
      rejectionReasons: allPassed ? undefined : rejectionReasons,
      extensionReasons: extensionReasons.length > 0 ? extensionReasons : undefined,
      nextReviewDate: this.computeNextReviewDate(session, recommendation),
    };
  }

  /**
   * Extend shadow period for borderline strategies
   */
  public extendShadow(sessionId: string, reason: string): void {
    const session = this.shadowSessions.get(sessionId);
    if (!session) {
      throw new Error(`Shadow session not found: ${sessionId}`);
    }

    const extensionDays = 14;
    session.duration += extensionDays;
    if (session.endDate) {
      session.endDate = new Date(session.endDate.getTime() + extensionDays * 24 * 60 * 60 * 1000);
    }
    session.status = 'EXTENDED';

    this.shadowSessions.set(sessionId, session);
    this.logger.info(
      `Shadow extended for ${session.strategyId}: +${extensionDays} days. Reason: ${reason}`
    );
  }

  /**
   * Reject promotion and record reasons
   */
  public rejectPromotion(sessionId: string, reasons: string[]): void {
    const session = this.shadowSessions.get(sessionId);
    if (!session) {
      throw new Error(`Shadow session not found: ${sessionId}`);
    }

    session.status = 'REJECTED';
    this.shadowSessions.set(sessionId, session);
    this.rejectionArchive.set(session.strategyId, reasons);

    this.logger.warn(
      `Promotion rejected for ${session.strategyId}: ${reasons.join(' | ')}`
    );
  }

  /**
   * Get complete promotion history across all strategies
   */
  public getPromotionHistory(): PromotionHistoryEntry[] {
    return this.promotionHistory.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Validate: do promoted strategies actually perform better than rejected ones?
   * This validates the gate's effectiveness
   */
  public comparePromotedVsRejected(): {
    promotedSharpe: number;
    rejectedSharpe: number;
    performanceEdge: number;
    gateEffectiveness: number;
    conclusion: string;
  } {
    const promotedDecisions = this.promotionHistory.filter(
      (h) => h.decision === 'APPROVED_TO_ASSISTED'
    );
    const rejectedDecisions = this.promotionHistory.filter(
      (h) => h.decision === 'REJECTED'
    );

    if (promotedDecisions.length === 0 || rejectedDecisions.length === 0) {
      return {
        promotedSharpe: 0,
        rejectedSharpe: 0,
        performanceEdge: 0,
        gateEffectiveness: 0,
        conclusion:
          'Insufficient history to compare promoted vs rejected strategies.',
      };
    }

    const avgPromotedSharpe =
      promotedDecisions.reduce((sum, d) => sum + d.scorecard.criteria[2].actualValue, 0) /
      promotedDecisions.length;
    const avgRejectedSharpe =
      rejectedDecisions.reduce((sum, d) => sum + d.scorecard.criteria[2].actualValue, 0) /
      rejectedDecisions.length;

    const edge = avgPromotedSharpe - avgRejectedSharpe;
    const effectiveness = edge > 0.3 ? 0.95 : edge > 0.1 ? 0.75 : 0.5;

    let conclusion = '';
    if (effectiveness > 0.8) {
      conclusion =
        'Gate is highly effective. Promoted strategies outperform rejected ones significantly.';
    } else if (effectiveness > 0.6) {
      conclusion = 'Gate is reasonably effective, but some variance observed.';
    } else {
      conclusion =
        'Gate effectiveness unclear. Consider recalibrating thresholds.';
    }

    return {
      promotedSharpe: avgPromotedSharpe,
      rejectedSharpe: avgRejectedSharpe,
      performanceEdge: edge,
      gateEffectiveness: effectiveness,
      conclusion,
    };
  }

  /**
   * Set minimum requirement for shadow period (days)
   */
  public setMinimumShadowDays(days: number): void {
    this.minimumShadowDays = days;
  }

  /**
   * Set minimum requirement for shadow trades
   */
  public setMinimumShadowTrades(trades: number): void {
    this.minimumShadowTrades = trades;
  }

  /**
   * Set minimum Sharpe requirement for shadow
   */
  public setMinimumSharpe(sharpe: number): void {
    this.minimumSharpe = sharpe;
  }

  /**
   * Set maximum drawdown tolerance for shadow
   */
  public setMaximumDrawdown(dd: number): void {
    this.maximumDrawdown = dd;
  }

  /**
   * Get all active shadow sessions
   */
  public getActiveShadowSessions(): ShadowSession[] {
    return Array.from(this.shadowSessions.values()).filter(
      (s) => s.status === 'ACTIVE'
    );
  }

  /**
   * Get rejection archive - view why strategies were rejected
   */
  public getRejectionArchive(): Map<string, string[]> {
    return new Map(this.rejectionArchive);
  }

  // ========== Private helpers ==========

  private recordPromotionApproval(decision: PromotionDecision): void {
    const entry: PromotionHistoryEntry = {
      timestamp: decision.timestamp,
      strategyId: decision.strategyId,
      shadowSessionId: decision.shadowSessionId,
      decision: decision.decision,
      reasoning: decision.scorecardSummary.reasoning,
      scorecard: decision.scorecardSummary,
    };

    this.promotionHistory.push(entry);
  }

  private recordRejection(strategyId: string, reasons: string[]): void {
    this.rejectionArchive.set(strategyId, reasons);
  }

  private computePromotionConfidence(
    session: ShadowSession,
    scorecard: ShadowScorecard
  ): number {
    let confidence = 0.5;

    if (session.duration > this.minimumShadowDays * 2) confidence += 0.1;
    if (session.tradeCount > this.minimumShadowTrades * 3) confidence += 0.1;
    if (session.sharpe > this.minimumSharpe * 2) confidence += 0.1;
    if (session.maxDrawdown < this.maximumDrawdown * 0.5) confidence += 0.1;
    if (session.signalToBacktestCorrelation > 0.85) confidence += 0.1;

    return Math.min(0.99, Math.max(0.5, confidence));
  }

  private computeNextReviewDate(session: ShadowSession, recommendation: string): Date {
    const nextReview = new Date();

    if (recommendation === 'PROMOTE') {
      nextReview.setDate(nextReview.getDate() + 60);
    } else if (recommendation === 'EXTEND') {
      nextReview.setDate(nextReview.getDate() + 14);
    } else {
      nextReview.setDate(nextReview.getDate() + 30);
    }

    return nextReview;
  }
}
