// PromotionDiscipline: Strict lifecycle gates enforcing evidence-based progression
// Core principle: GodsView earns trust by REFUSING promotion until evidence is strong
// No shortcuts. No exceptions. Evidence required at every tier.

import { Logger } from '../logging/logger';

export type TierName =
  | 'SEED'
  | 'LEARNING'
  | 'PROVEN'
  | 'PAPER'
  | 'SHADOW'
  | 'ASSISTED'
  | 'AUTONOMOUS'
  | 'ELITE';

export interface GateRequirement {
  name: string;
  metric: string;
  threshold: number | string;
  actual: number | string;
  met: boolean;
  reason: string;
}

export interface GateResult {
  strategyId: string;
  currentTier: TierName;
  targetTier: TierName;
  canPromote: boolean;
  gatesPassed: number;
  gatesRequired: number;
  requirements: GateRequirement[];
  failingRequirements: GateRequirement[];
  estimatedDaysToNextTier: number;
  reasoning: string;
}

export interface EvidencePacket {
  strategyId: string;
  targetTier: TierName;
  evidence: Array<{
    category: string;
    items: Array<{
      description: string;
      value: string | number;
      required: boolean;
      met: boolean;
    }>;
  }>;
  packageSummary: string;
  readyForReview: boolean;
}

export interface PromotionTimeline {
  strategyId: string;
  currentTier: TierName;
  roadmap: Array<{
    tier: TierName;
    estimatedDaysUntil: number;
    keyMilestones: string[];
    criticalsBlockingProgress: string[];
  }>;
  projectedAutonomousDate: Date;
}

export interface PromotionReport {
  strategyId: string;
  currentTier: TierName;
  promotionHistory: Array<{
    timestamp: Date;
    fromTier: TierName;
    toTier: TierName;
    gatesPassedCount: number;
    approverNotes: string;
  }>;
  demotionTriggers: string[];
  nextExpectedPromotion: {
    tier: TierName;
    daysUntil: number;
    blockers: string[];
  };
  overallRiskProfile: 'LOW' | 'MODERATE' | 'HIGH';
}

export interface DemotionTrigger {
  dimension: string;
  threshold: number;
  currentValue: number;
  severity: 'MONITOR' | 'WARNING' | 'CRITICAL';
  action: string;
}

export class PromotionDiscipline {
  private logger: Logger;
  private strategyTiers: Map<string, TierName> = new Map();
  private promotionHistory: Map<string, Array<{
    timestamp: Date;
    fromTier: TierName;
    toTier: TierName;
    gatesCount: number;
  }>> = new Map();
  private demotionHistory: Map<string, Array<{
    timestamp: Date;
    fromTier: TierName;
    toTier: TierName;
    reason: string;
  }>> = new Map();

  // Gate definitions for each tier transition
  private gateDefinitions: Map<string, GateRequirement[]> = new Map([
    [
      'SEED->LEARNING',
      [
        { name: 'Valid DSL', metric: 'dsl_valid', threshold: true, actual: false, met: false, reason: '' },
        { name: 'Passed Early Screen', metric: 'early_screen_passed', threshold: true, actual: false, met: false, reason: '' },
      ],
    ],
    [
      'LEARNING->PROVEN',
      [
        { name: 'Critique Grade', metric: 'critique_grade', threshold: 'B+', actual: 'A', met: false, reason: '' },
        { name: 'Causal Confidence', metric: 'causal_confidence', threshold: 0.6, actual: 0, met: false, reason: '' },
      ],
    ],
    [
      'PROVEN->PAPER',
      [
        { name: 'Backtest Sharpe', metric: 'sharpe', threshold: 0.8, actual: 0, met: false, reason: '' },
        { name: 'Max Drawdown', metric: 'max_dd', threshold: 0.15, actual: 0, met: false, reason: '' },
        { name: 'Sample Size', metric: 'sample_size', threshold: 200, actual: 0, met: false, reason: '' },
      ],
    ],
    [
      'PAPER->SHADOW',
      [
        { name: 'Paper Period', metric: 'paper_days', threshold: 14, actual: 0, met: false, reason: '' },
        { name: 'Paper/Backtest Alignment', metric: 'alignment_percentage', threshold: 0.8, actual: 0, met: false, reason: '' },
        { name: 'No Major Slippage', metric: 'slippage_bps', threshold: 20, actual: 0, met: false, reason: '' },
      ],
    ],
    [
      'SHADOW->ASSISTED',
      [
        { name: 'Shadow Period', metric: 'shadow_days', threshold: 30, actual: 0, met: false, reason: '' },
        { name: 'Shadow Trades', metric: 'shadow_trades', threshold: 50, actual: 0, met: false, reason: '' },
        { name: 'Shadow Sharpe', metric: 'shadow_sharpe', threshold: 0.5, actual: 0, met: false, reason: '' },
        { name: 'Shadow Max DD', metric: 'shadow_max_dd', threshold: 0.25, actual: 0, met: false, reason: '' },
        { name: 'Signal Correlation', metric: 'signal_correlation', threshold: 0.7, actual: 0, met: false, reason: '' },
        { name: 'Fill Realism', metric: 'fill_realism', threshold: 70, actual: 0, met: false, reason: '' },
      ],
    ],
    [
      'ASSISTED->AUTONOMOUS',
      [
        { name: 'Assisted Period', metric: 'assisted_days', threshold: 60, actual: 0, met: false, reason: '' },
        { name: 'Human Override Rate', metric: 'override_rate', threshold: 0.1, actual: 0, met: false, reason: '' },
        { name: 'Performance Consistency', metric: 'consistency_score', threshold: 0.8, actual: 0, met: false, reason: '' },
        { name: 'Calibration Score', metric: 'calibration_score', threshold: 75, actual: 0, met: false, reason: '' },
      ],
    ],
    [
      'AUTONOMOUS->ELITE',
      [
        { name: 'Autonomous Period', metric: 'autonomous_days', threshold: 180, actual: 0, met: false, reason: '' },
        { name: 'Performance Stability', metric: 'performance_stability', threshold: 0.85, actual: 0, met: false, reason: '' },
        { name: 'Sharpe Consistency', metric: 'sharpe_consistency', threshold: 0.8, actual: 0, met: false, reason: '' },
      ],
    ],
  ]);

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Check if strategy can be promoted to target tier
   * Returns detailed gate status with all requirements
   */
  public checkGate(
    strategyId: string,
    currentMetrics: Record<string, number | string | boolean>,
    targetTier: TierName
  ): GateResult {
    const currentTier = this.strategyTiers.get(strategyId) || 'SEED';

    if (currentTier === targetTier) {
      return {
        strategyId,
        currentTier,
        targetTier,
        canPromote: false,
        gatesPassed: 0,
        gatesRequired: 0,
        requirements: [],
        failingRequirements: [],
        estimatedDaysToNextTier: 0,
        reasoning: 'Already at target tier',
      };
    }

    const gateKey = `${currentTier}->${targetTier}`;
    const templateRequirements = this.gateDefinitions.get(gateKey) || [];

    if (templateRequirements.length === 0) {
      return {
        strategyId,
        currentTier,
        targetTier,
        canPromote: false,
        gatesPassed: 0,
        gatesRequired: 0,
        requirements: [],
        failingRequirements: [],
        estimatedDaysToNextTier: 0,
        reasoning: `No valid gate path from ${currentTier} to ${targetTier}`,
      };
    }

    const requirements = this.evaluateRequirements(templateRequirements, currentMetrics);
    const failingRequirements = requirements.filter((r) => !r.met);
    const gatesPassed = requirements.length - failingRequirements.length;

    const canPromote = failingRequirements.length === 0;
    const estimatedDaysToNextTier = this.estimateDaysToNextTier(
      failingRequirements,
      targetTier
    );

    const reasoning = canPromote
      ? `All ${requirements.length} gates passed. Strategy is ready for ${targetTier} tier.`
      : `${failingRequirements.length} gates failing: ${failingRequirements.map((r) => r.name).join(', ')}`;

    const result: GateResult = {
      strategyId,
      currentTier,
      targetTier,
      canPromote,
      gatesPassed,
      gatesRequired: requirements.length,
      requirements,
      failingRequirements,
      estimatedDaysToNextTier,
      reasoning,
    };

    if (canPromote) {
      this.logger.info(`Gate passed: ${strategyId} ready to promote from ${currentTier} to ${targetTier}`);
    } else {
      this.logger.warn(
        `Gate check: ${strategyId} blocked from ${targetTier}. Failing: ${failingRequirements.map((r) => r.name).join(', ')}`
      );
    }

    return result;
  }

  /**
   * Get evidence packet - everything needed to justify promotion
   */
  public getEvidencePacket(
    strategyId: string,
    currentMetrics: Record<string, number | string | boolean>,
    targetTier: TierName
  ): EvidencePacket {
    const currentTier = this.strategyTiers.get(strategyId) || 'SEED';
    const gateKey = `${currentTier}->${targetTier}`;
    const templateRequirements = this.gateDefinitions.get(gateKey) || [];

    const evidence = this.buildEvidenceCategories(
      strategyId,
      currentMetrics,
      targetTier,
      templateRequirements
    );

    const requiredMet = evidence
      .flatMap((e) => e.items)
      .every((item) => !item.required || item.met);

    const packageSummary = requiredMet
      ? `Complete evidence package for promotion to ${targetTier}`
      : `Incomplete evidence for ${targetTier} - ${templateRequirements.filter((r) => !this.checkRequirementMet(r, currentMetrics)).length} gates failing`;

    return {
      strategyId,
      targetTier,
      evidence,
      packageSummary,
      readyForReview: requiredMet,
    };
  }

  /**
   * Enforce minimum evidence - no shortcuts allowed
   */
  public enforceMinimumEvidence(
    strategyId: string,
    currentMetrics: Record<string, number | string | boolean>
  ): {
    canShortcut: boolean;
    blockedReason: string;
  } {
    const currentTier = this.strategyTiers.get(strategyId) || 'SEED';

    // Key gates that cannot be skipped
    const blockedShortcuts = [
      'SHADOW->ASSISTED', // Shadow mode is mandatory
      'PAPER->SHADOW', // Paper validation required
      'ASSISTED->AUTONOMOUS', // Assisted period required
    ];

    // Cannot skip required time gates
    const pastGate = `${currentTier}->*`;
    const timeBasedGates = ['PAPER', 'SHADOW', 'ASSISTED', 'AUTONOMOUS'];

    if (timeBasedGates.includes(currentTier)) {
      return {
        canShortcut: false,
        blockedReason: `Tier ${currentTier} requires minimum time. No shortcuts allowed.`,
      };
    }

    return {
      canShortcut: false,
      blockedReason: 'GodsView enforces strict promotion discipline. All gates required.',
    };
  }

  /**
   * Get timeline to next tier with milestones
   */
  public getPromotionTimeline(
    strategyId: string,
    currentMetrics: Record<string, number | string | boolean>
  ): PromotionTimeline {
    const currentTier = this.strategyTiers.get(strategyId) || 'SEED';

    const tierSequence: TierName[] = [
      'SEED',
      'LEARNING',
      'PROVEN',
      'PAPER',
      'SHADOW',
      'ASSISTED',
      'AUTONOMOUS',
      'ELITE',
    ];

    const currentIndex = tierSequence.indexOf(currentTier);
    const roadmap = [];

    for (let i = currentIndex + 1; i < tierSequence.length; i++) {
      const tier = tierSequence[i];
      const daysEstimate = this.estimateDaysToTier(tier, currentMetrics);
      const keyMilestones = this.getKeyMilestones(tier);
      const blockers = this.getBlockingCritera(tier, currentMetrics);

      roadmap.push({
        tier,
        estimatedDaysUntil: daysEstimate,
        keyMilestones,
        criticalsBlockingProgress: blockers,
      });
    }

    const autonomousEntry = roadmap.find((r) => r.tier === 'AUTONOMOUS');
    const projectedAutonomousDate = new Date();
    if (autonomousEntry) {
      projectedAutonomousDate.setDate(
        projectedAutonomousDate.getDate() + autonomousEntry.estimatedDaysUntil
      );
    }

    return {
      strategyId,
      currentTier,
      roadmap,
      projectedAutonomousDate,
    };
  }

  /**
   * Generate full promotion report with history and forward projections
   */
  public generatePromotionReport(
    strategyId: string,
    currentMetrics: Record<string, number | string | boolean>
  ): PromotionReport {
    const currentTier = this.strategyTiers.get(strategyId) || 'SEED';
    const promotions = this.promotionHistory.get(strategyId) || [];
    const demotions = this.demotionHistory.get(strategyId) || [];

    const promotionHistoryWithNotes = promotions.map((p) => ({
      timestamp: p.timestamp,
      fromTier: p.fromTier,
      toTier: p.toTier,
      gatesPassedCount: p.gatesCount,
      approverNotes: `Promoted from ${p.fromTier} to ${p.toTier} with ${p.gatesCount} gates passed`,
    }));

    const demotionTriggers = this.getDemotionTriggers(strategyId, currentMetrics).map(
      (t) => t.action
    );

    const timeline = this.getPromotionTimeline(strategyId, currentMetrics);
    const nextPromotion = timeline.roadmap[0] || {
      tier: 'ELITE' as TierName,
      estimatedDaysUntil: 999,
      keyMilestones: [],
      criticalsBlockingProgress: [],
    };

    const riskProfile = this.computeRiskProfile(currentTier, demotionTriggers);

    return {
      strategyId,
      currentTier,
      promotionHistory: promotionHistoryWithNotes,
      demotionTriggers,
      nextExpectedPromotion: {
        tier: nextPromotion.tier,
        daysUntil: nextPromotion.estimatedDaysUntil,
        blockers: nextPromotion.criticalsBlockingProgress,
      },
      overallRiskProfile: riskProfile,
    };
  }

  /**
   * Get demotion triggers - what would cause demotion from current tier
   */
  public getDemotionTriggers(
    strategyId: string,
    currentMetrics: Record<string, number | string | boolean>
  ): DemotionTrigger[] {
    const currentTier = this.strategyTiers.get(strategyId) || 'SEED';
    const triggers: DemotionTrigger[] = [];

    // Common demotion triggers across all tiers
    if (currentTier !== 'SEED') {
      const calibrationScore = (currentMetrics.calibration_score || 100) as number;
      if (calibrationScore < 50) {
        triggers.push({
          dimension: 'CALIBRATION_SEVERE',
          threshold: 50,
          currentValue: calibrationScore,
          severity: 'CRITICAL',
          action: 'Demotion likely if calibration drops below 50',
        });
      } else if (calibrationScore < 65) {
        triggers.push({
          dimension: 'CALIBRATION_WARNING',
          threshold: 65,
          currentValue: calibrationScore,
          severity: 'WARNING',
          action: 'Monitor calibration closely',
        });
      }
    }

    if (currentTier === 'ASSISTED' || currentTier === 'AUTONOMOUS' || currentTier === 'ELITE') {
      const overrideRate = (currentMetrics.override_rate || 0) as number;
      if (overrideRate > 0.25) {
        triggers.push({
          dimension: 'HIGH_OVERRIDE_RATE',
          threshold: 0.25,
          currentValue: overrideRate,
          severity: 'CRITICAL',
          action: 'Excessive human overrides trigger demotion to PAPER',
        });
      } else if (overrideRate > 0.15) {
        triggers.push({
          dimension: 'ELEVATED_OVERRIDE_RATE',
          threshold: 0.15,
          currentValue: overrideRate,
          severity: 'WARNING',
          action: 'Monitor override rate - approaching demotion threshold',
        });
      }
    }

    if (currentTier === 'AUTONOMOUS' || currentTier === 'ELITE') {
      const autonomousSharpe = (currentMetrics.autonomous_sharpe || 0.8) as number;
      if (autonomousSharpe < 0.3) {
        triggers.push({
          dimension: 'SHARPE_COLLAPSE',
          threshold: 0.3,
          currentValue: autonomousSharpe,
          severity: 'CRITICAL',
          action: 'Sharpe collapse triggers demotion to ASSISTED',
        });
      } else if (autonomousSharpe < 0.5) {
        triggers.push({
          dimension: 'SHARPE_DEGRADATION',
          threshold: 0.5,
          currentValue: autonomousSharpe,
          severity: 'WARNING',
          action: 'Monitor Sharpe degradation',
        });
      }
    }

    return triggers;
  }

  /**
   * Manually promote strategy to next tier (with approval)
   */
  public promoteStrategy(
    strategyId: string,
    approverNotes: string
  ): {
    success: boolean;
    fromTier: TierName;
    toTier: TierName;
    message: string;
  } {
    const currentTier = this.strategyTiers.get(strategyId) || 'SEED';

    const tierSequence: TierName[] = [
      'SEED',
      'LEARNING',
      'PROVEN',
      'PAPER',
      'SHADOW',
      'ASSISTED',
      'AUTONOMOUS',
      'ELITE',
    ];

    const currentIndex = tierSequence.indexOf(currentTier);
    if (currentIndex === -1 || currentIndex >= tierSequence.length - 1) {
      return {
        success: false,
        fromTier: currentTier,
        toTier: currentTier,
        message: 'Strategy already at max tier or unknown tier',
      };
    }

    const nextTier = tierSequence[currentIndex + 1];
    this.strategyTiers.set(strategyId, nextTier);

    if (!this.promotionHistory.has(strategyId)) {
      this.promotionHistory.set(strategyId, []);
    }

    this.promotionHistory.get(strategyId)!.push({
      timestamp: new Date(),
      fromTier: currentTier,
      toTier: nextTier,
      gatesCount: 0,
    });

    this.logger.info(`${strategyId} promoted: ${currentTier} -> ${nextTier}. Notes: ${approverNotes}`);

    return {
      success: true,
      fromTier: currentTier,
      toTier: nextTier,
      message: `Successfully promoted to ${nextTier}`,
    };
  }

  /**
   * Demote strategy to earlier tier (emergency use)
   */
  public demoteStrategy(
    strategyId: string,
    targetTier: TierName,
    reason: string
  ): {
    success: boolean;
    fromTier: TierName;
    toTier: TierName;
    message: string;
  } {
    const currentTier = this.strategyTiers.get(strategyId) || 'SEED';

    if (currentTier === targetTier) {
      return {
        success: false,
        fromTier: currentTier,
        toTier: currentTier,
        message: 'Already at target tier',
      };
    }

    this.strategyTiers.set(strategyId, targetTier);

    if (!this.demotionHistory.has(strategyId)) {
      this.demotionHistory.set(strategyId, []);
    }

    this.demotionHistory.get(strategyId)!.push({
      timestamp: new Date(),
      fromTier: currentTier,
      toTier: targetTier,
      reason,
    });

    this.logger.error(`${strategyId} demoted: ${currentTier} -> ${targetTier}. Reason: ${reason}`);

    return {
      success: true,
      fromTier: currentTier,
      toTier: targetTier,
      message: `Demoted to ${targetTier} due to: ${reason}`,
    };
  }

  // ========== Private helpers ==========

  private evaluateRequirements(
    templates: GateRequirement[],
    metrics: Record<string, number | string | boolean>
  ): GateRequirement[] {
    return templates.map((template) => {
      const met = this.checkRequirementMet(template, metrics);
      const actualValue = metrics[template.metric] || 'N/A';

      return {
        ...template,
        actual: actualValue,
        met,
        reason: met ? 'Requirement met' : `Actual ${actualValue} below threshold ${template.threshold}`,
      };
    });
  }

  private checkRequirementMet(
    requirement: GateRequirement,
    metrics: Record<string, number | string | boolean>
  ): boolean {
    const actual = metrics[requirement.metric];

    if (actual === undefined || actual === null) return false;

    if (typeof requirement.threshold === 'number') {
      return (actual as number) >= requirement.threshold;
    }

    if (typeof requirement.threshold === 'boolean') {
      return (actual as boolean) === requirement.threshold;
    }

    // String comparison (e.g., grade)
    const gradeOrder = { F: 0, 'C': 1, 'C+': 2, 'B-': 3, B: 4, 'B+': 5, A: 6 };
    return (gradeOrder[actual as string] || 0) >= (gradeOrder[requirement.threshold as string] || 0);
  }

  private buildEvidenceCategories(
    strategyId: string,
    metrics: Record<string, number | string | boolean>,
    targetTier: TierName,
    requirements: GateRequirement[]
  ): Array<{
    category: string;
    items: Array<{ description: string; value: string | number; required: boolean; met: boolean }>;
  }> {
    const evidence = [];

    evidence.push({
      category: 'Gate Requirements',
      items: requirements.map((r) => ({
        description: r.name,
        value: `${metrics[r.metric] || 'N/A'} (threshold: ${r.threshold})`,
        required: true,
        met: this.checkRequirementMet(r, metrics),
      })),
    });

    return evidence;
  }

  private estimateDaysToNextTier(
    failingRequirements: GateRequirement[],
    targetTier: TierName
  ): number {
    if (failingRequirements.length === 0) return 0;

    // Time-based gates
    const timeGates: Record<string, number> = {
      PAPER: 14,
      SHADOW: 30,
      ASSISTED: 60,
      AUTONOMOUS: 180,
      ELITE: 365,
    };

    const estimatedDays = timeGates[targetTier] || 30;
    return estimatedDays;
  }

  private estimateDaysToTier(tier: TierName, metrics: Record<string, number | string | boolean>): number {
    const baseEstimates: Record<string, number> = {
      LEARNING: 7,
      PROVEN: 14,
      PAPER: 28,
      SHADOW: 58,
      ASSISTED: 118,
      AUTONOMOUS: 298,
      ELITE: 663,
    };

    return baseEstimates[tier] || 30;
  }

  private getKeyMilestones(tier: TierName): string[] {
    const milestones: Record<TierName, string[]> = {
      SEED: ['Pass DSL validation', 'Pass early screening'],
      LEARNING: ['Achieve B+ critique grade', 'Reach 0.6 causal confidence'],
      PROVEN: ['Sharpe > 0.8', 'Max DD < 15%', '200+ backtest trades'],
      PAPER: ['14+ days paper validation', 'Within 20% of backtest'],
      SHADOW: ['30+ days shadow', '50+ shadow trades', 'Sharpe > 0.5'],
      ASSISTED: ['60+ days assisted', '<10% human override rate'],
      AUTONOMOUS: ['6+ months autonomous', 'Stable performance'],
      ELITE: ['Maintained elite status', 'Continuous optimization'],
    };

    return milestones[tier] || [];
  }

  private getBlockingCritera(tier: TierName, metrics: Record<string, number | string | boolean>): string[] {
    const blockers: string[] = [];

    if (tier === 'SHADOW' && (metrics.sharpe as number) < 0.8) {
      blockers.push('Sharpe too low for paper trading');
    }
    if (tier === 'ASSISTED' && (metrics.shadow_sharpe as number) < 0.5) {
      blockers.push('Shadow Sharpe below 0.5 minimum');
    }
    if (tier === 'AUTONOMOUS' && (metrics.assisted_days as number) < 60) {
      blockers.push('Insufficient assisted period');
    }

    return blockers;
  }

  private computeRiskProfile(currentTier: TierName, demotionTriggers: string[]): 'LOW' | 'MODERATE' | 'HIGH' {
    if (demotionTriggers.length === 0) return 'LOW';
    if (demotionTriggers.length <= 2) return 'MODERATE';
    return 'HIGH';
  }
}
