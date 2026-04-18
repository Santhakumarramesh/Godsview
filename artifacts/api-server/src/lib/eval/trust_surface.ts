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

// TrustSurface: Unified transparency view for operator decision-making
// Single source of truth for WHAT, WHY, and WHAT_NEXT across entire strategy lifecycle
// Generates plain-English briefs that enable confident human approval

import { Logger } from '../logging/logger';

export type TrafficLight = 'GREEN' | 'YELLOW' | 'RED';

export interface TrustViewSection {
  strategyDescription: string; // Plain English, 2 sentences max
  interpretationWinner: {
    name: string;
    reasoning: string;
    weightedScore: number;
    runnerUps: Array<{ name: string; score: number }>;
  };
  earlyScreening: {
    passed: boolean;
    filters: Array<{
      name: string;
      passed: boolean;
      detail: string;
    }>;
  };
  causalEdge: {
    mechanism: string;
    confidence: number;
    keyAssumptions: string[];
    testingPlan: string;
  };
  critique: {
    strengths: string[];
    weaknesses: string[];
    overallGrade: 'A' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'F';
    gradeReasoning: string;
  };
  variantComparison: {
    variantCount: number;
    bestVariant: {
      name: string;
      sharpe: number;
      maxDD: number;
      winRate: number;
    };
    comparisonHighlights: string[];
  };
  backtestResults: {
    sharpe: number;
    maxDrawdown: number;
    winRate: number;
    profitFactor: number;
    sampleSize: number;
    recoveryFactor: number;
  };
  fragility: {
    worstRegime: string;
    worstRegimePerformance: string;
    breakingConditions: string[];
  };
  shadowStatus: {
    inShadow: boolean;
    daysElapsed?: number;
    tradeCount?: number;
    shadowSharpe?: number;
    shadowDrawdown?: number;
    onTrackForPromotion?: boolean;
  };
  calibrationScore: number;
  recommendation: string;
  nextAction: string;
  trafficLight: TrafficLight;
}

export interface TrustCard {
  strategyId: string;
  name: string;
  status: string;
  sharpe: number;
  maxDD: number;
  winRate: number;
  recommendation: 'GO' | 'NO_GO' | 'REVIEW';
  trafficLight: TrafficLight;
  keyRisks: string[];
  nextMilestone: string;
}

export interface GoNoGoDecision {
  strategyId: string;
  decision: 'GO' | 'NO_GO';
  confidence: number; // 0-1
  reasoning: string;
  greenFlags: string[];
  redFlags: string[];
  yellowFlags: string[];
  recommendedAction: 'APPROVE' | 'REJECT' | 'REQUEST_REVIEW';
  decisionTimestamp: Date;
}

export interface DetailedBrief {
  executiveSummary: string;
  allSections: TrustViewSection;
  decisionPath: string;
  evidenceHighlights: string[];
  risks: {
    topRisks: Array<{
      risk: string;
      likelihood: string;
      impact: string;
      mitigation: string;
    }>;
  };
  nextSteps: string[];
  approvalReadiness: 'READY' | 'NEEDS_REVIEW' | 'NOT_READY';
}

export interface ComparisonView {
  strategyA: {
    id: string;
    name: string;
    section: TrustViewSection;
  };
  strategyB: {
    id: string;
    name: string;
    section: TrustViewSection;
  };
  comparison: {
    sharpeEdge: number;
    ddEdge: number;
    winRateEdge: number;
    causalEdgeStrength: string;
    robustnessComparison: string;
    recommendation: 'FAVOR_A' | 'FAVOR_B' | 'EQUIVALENT';
    reasoning: string;
  };
}

export interface PipelineResult {
  strategyId: string;
  strategyName: string;
  dslValid: boolean;
  stage: 'SEED' | 'LEARNING' | 'PROVEN' | 'PAPER' | 'SHADOW' | 'ASSISTED' | 'AUTONOMOUS' | 'ELITE';
  description: string;
  interpretation: {
    type: string;
    confidence: number;
    alternatives: Array<{ type: string; confidence: number }>;
  };
  earlyScreen: {
    passed: boolean;
    filters: Array<{
      name: string;
      passed: boolean;
      reason: string;
    }>;
  };
  causal: {
    mechanism: string;
    confidence: number;
    keyAssumptions: string[];
  };
  critique: {
    grade: 'A' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'F';
    strengths: string[];
    weaknesses: string[];
  };
  variants: Array<{
    name: string;
    sharpe: number;
    maxDD: number;
    winRate: number;
    profitFactor: number;
  }>;
  backtest: {
    sharpe: number;
    maxDD: number;
    winRate: number;
    profitFactor: number;
    sampleSize: number;
    recoveryFactor: number;
  };
  fragility: {
    worstRegime: string;
    worstPerformance: {
      sharpe: number;
      maxDD: number;
    };
    breakingConditions: string[];
  };
  shadowSession?: {
    active: boolean;
    daysElapsed: number;
    tradeCount: number;
    sharpe: number;
    maxDD: number;
    onTrack: boolean;
  };
  calibration: number;
}

export class TrustSurface {
  private logger: Logger;
  private generatedViews: Map<string, TrustViewSection> = new Map();
  private decisionHistory: Map<string, GoNoGoDecision> = new Map();

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Generate full trust surface view from pipeline result
   * Single unified view answering: WHAT, WHY, and WHAT_NEXT
   */
  public generateTrustView(result: PipelineResult): TrustViewSection {
    const view: TrustViewSection = {
      strategyDescription: this.generateDescription(result),
      interpretationWinner: this.generateInterpretationWinner(result),
      earlyScreening: this.generateEarlyScreening(result),
      causalEdge: this.generateCausalEdge(result),
      critique: this.generateCritique(result),
      variantComparison: this.generateVariantComparison(result),
      backtestResults: {
        sharpe: result.backtest.sharpe,
        maxDrawdown: result.backtest.maxDD,
        winRate: result.backtest.winRate,
        profitFactor: result.backtest.profitFactor,
        sampleSize: result.backtest.sampleSize,
        recoveryFactor: result.backtest.recoveryFactor,
      },
      fragility: this.generateFragility(result),
      shadowStatus: this.generateShadowStatus(result),
      calibrationScore: result.calibration,
      recommendation: this.generateRecommendation(result),
      nextAction: this.generateNextAction(result),
      trafficLight: this.computeTrafficLight(result),
    };

    this.generatedViews.set(result.strategyId, view);
    this.logger.info(`Trust view generated for ${result.strategyId}`);

    return view;
  }

  /**
   * Compact 10-line summary card
   */
  public generateCompactCard(result: PipelineResult): TrustCard {
    const view = this.generateTrustView(result);

    const keyRisks = view.fragility.breakingConditions.slice(0, 2);
    const status = `${result.stage} - ${view.critique.overallGrade}`;

    let nextMilestone = '';
    switch (result.stage) {
      case 'LEARNING':
        nextMilestone = 'Achieve critique B+ for PROVEN tier';
        break;
      case 'PROVEN':
        nextMilestone = 'Achieve Sharpe > 0.8 for PAPER validation';
        break;
      case 'PAPER':
        nextMilestone = 'Pass shadow mode for ASSISTED tier';
        break;
      case 'SHADOW':
        nextMilestone = 'Complete shadow promotion';
        break;
      case 'ASSISTED':
        nextMilestone = 'Reach 60+ days with <10% overrides for AUTONOMOUS';
        break;
      default:
        nextMilestone = 'Current tier optimal';
    }

    return {
      strategyId: result.strategyId,
      name: result.strategyName,
      status,
      sharpe: result.backtest.sharpe,
      maxDD: result.backtest.maxDD,
      winRate: result.backtest.winRate,
      recommendation: view.trafficLight === 'GREEN' ? 'GO' : view.trafficLight === 'YELLOW' ? 'REVIEW' : 'NO_GO',
      trafficLight: view.trafficLight,
      keyRisks,
      nextMilestone,
    };
  }

  /**
   * Full detailed brief for operators
   */
  public generateDetailedBrief(result: PipelineResult): DetailedBrief {
    const section = this.generateTrustView(result);

    const executiveSummary = this.generateExecutiveSummary(result, section);
    const decisionPath = this.generateDecisionPath(result, section);
    const evidenceHighlights = this.generateEvidenceHighlights(result, section);
    const risks = this.generateDetailedRisks(result, section);
    const nextSteps = this.generateDetailedNextSteps(result, section);

    const approvalReadiness = this.computeApprovalReadiness(result, section);

    return {
      executiveSummary,
      allSections: section,
      decisionPath,
      evidenceHighlights,
      risks,
      nextSteps,
      approvalReadiness,
    };
  }

  /**
   * Side-by-side comparison of two strategies
   */
  public generateComparisonView(resultA: PipelineResult, resultB: PipelineResult): ComparisonView {
    const sectionA = this.generateTrustView(resultA);
    const sectionB = this.generateTrustView(resultB);

    const sharpeEdge = resultA.backtest.sharpe - resultB.backtest.sharpe;
    const ddEdge = resultB.backtest.maxDD - resultA.backtest.maxDD;
    const winRateEdge = resultA.backtest.winRate - resultB.backtest.winRate;

    let recommendation: 'FAVOR_A' | 'FAVOR_B' | 'EQUIVALENT' = 'EQUIVALENT';
    let reasoning = '';

    if (sharpeEdge > 0.2 && ddEdge > 0.02) {
      recommendation = 'FAVOR_A';
      reasoning = `Strategy A has superior risk-adjusted returns (${sharpeEdge.toFixed(2)} Sharpe edge) and lower drawdown.`;
    } else if (sharpeEdge < -0.2 && ddEdge < -0.02) {
      recommendation = 'FAVOR_B';
      reasoning = `Strategy B has superior risk-adjusted returns (${Math.abs(sharpeEdge).toFixed(2)} Sharpe edge) and lower drawdown.`;
    } else {
      recommendation = 'EQUIVALENT';
      reasoning =
        'Strategies are comparable. Choose based on implementation feasibility or diversification goals.';
    }

    const causalEdgeStrength =
      Math.abs(resultA.causal.confidence - resultB.causal.confidence) > 0.15
        ? `${resultA.causal.confidence > resultB.causal.confidence ? 'A' : 'B'} has stronger causal foundation`
        : 'Both have similar causal strength';

    const robustnessComparison =
      resultA.fragility.breakingConditions.length < resultB.fragility.breakingConditions.length
        ? `Strategy A is more robust (${resultA.fragility.breakingConditions.length} breaking conditions vs ${resultB.fragility.breakingConditions.length})`
        : `Strategy B is more robust (${resultB.fragility.breakingConditions.length} breaking conditions vs ${resultA.fragility.breakingConditions.length})`;

    return {
      strategyA: { id: resultA.strategyId, name: resultA.strategyName, section: sectionA },
      strategyB: { id: resultB.strategyId, name: resultB.strategyName, section: sectionB },
      comparison: {
        sharpeEdge,
        ddEdge,
        winRateEdge,
        causalEdgeStrength,
        robustnessComparison,
        recommendation,
        reasoning,
      },
    };
  }

  /**
   * Highlight top 3 risks in plain English
   */
  public highlightRisks(result: PipelineResult): Array<{
    risk: string;
    likelihood: string;
    impact: string;
    mitigation: string;
  }> {
    const risks: Array<{ risk: string; likelihood: string; impact: string; mitigation: string }> =
      [];

    // Risk 1: Regime breakdown
    risks.push({
      risk: `Strategy breaks in ${result.fragility.worstRegime} regime`,
      likelihood: 'Medium',
      impact: `Sharpe drops to ${result.fragility.worstPerformance.sharpe.toFixed(2)}`,
      mitigation: 'Monitor regime transitions; consider regime-aware position sizing',
    });

    // Risk 2: Breaking conditions
    if (result.fragility.breakingConditions.length > 0) {
      risks.push({
        risk: result.fragility.breakingConditions[0],
        likelihood: 'Low to Medium',
        impact: 'Strategy may fail or underperform significantly',
        mitigation: 'Implement safeguards and circuit breakers for this condition',
      });
    }

    // Risk 3: Sample size or overfitting
    if (result.backtest.sampleSize < 200) {
      risks.push({
        risk: `Limited sample size (${result.backtest.sampleSize} trades)`,
        likelihood: 'High',
        impact: 'Live performance may diverge from backtest',
        mitigation: `Extend backtest period or increase trading frequency`,
      });
    } else {
      risks.push({
        risk: 'Calibration drift between backtest and live',
        likelihood: 'Medium',
        impact: 'Slippage, fill quality, or regime distribution may differ',
        mitigation: 'Monitor calibration score continuously during paper trading',
      });
    }

    return risks.slice(0, 3);
  }

  /**
   * Single GO / NO_GO decision with confidence and reasoning
   */
  public generateGoNoGo(result: PipelineResult): GoNoGoDecision {
    const view = this.generateTrustView(result);

    const greenFlags = this.extractGreenFlags(result, view);
    const redFlags = this.extractRedFlags(result, view);
    const yellowFlags = this.extractYellowFlags(result, view);

    let decision: 'GO' | 'NO_GO' = 'NO_GO';
    let confidence = 0;
    let recommendedAction: 'APPROVE' | 'REJECT' | 'REQUEST_REVIEW' = 'REJECT';

    if (redFlags.length === 0 && greenFlags.length >= 3) {
      decision = 'GO';
      confidence = 0.85 + yellowFlags.length * -0.05;
      recommendedAction = 'APPROVE';
    } else if (redFlags.length <= 2 && greenFlags.length >= 2) {
      decision = 'GO';
      confidence = 0.65;
      recommendedAction = 'REQUEST_REVIEW';
    } else if (redFlags.length >= 3) {
      decision = 'NO_GO';
      confidence = 0.9;
      recommendedAction = 'REJECT';
    } else {
      decision = 'NO_GO';
      confidence = 0.7;
      recommendedAction = 'REQUEST_REVIEW';
    }

    const reasoning =
      decision === 'GO'
        ? `Strategy shows strong fundamentals: ${greenFlags.slice(0, 2).join('; ')}. Ready for next tier.`
        : `Strategy has blockers: ${redFlags.slice(0, 2).join('; ')}. Requires refinement.`;

    const decisionObj: GoNoGoDecision = {
      strategyId: result.strategyId,
      decision,
      confidence: Math.max(0, Math.min(1, confidence)),
      reasoning,
      greenFlags,
      redFlags,
      yellowFlags,
      recommendedAction,
      decisionTimestamp: new Date(),
    };

    this.decisionHistory.set(result.strategyId, decisionObj);
    return decisionObj;
  }

  /**
   * Get decision history
   */
  public getDecisionHistory(strategyId: string): GoNoGoDecision | null {
    return this.decisionHistory.get(strategyId) || null;
  }

  // ========== Private helpers ==========

  private generateDescription(result: PipelineResult): string {
    const mechanic = result.interpretation.type.toLowerCase();
    const sharpeSummary =
      result.backtest.sharpe > 1
        ? 'with strong risk-adjusted returns'
        : result.backtest.sharpe > 0.5
          ? 'with moderate returns'
          : 'with limited positive carry';

    return `${result.strategyName} is a ${mechanic} strategy ${sharpeSummary}. Backtest Sharpe ${result.backtest.sharpe.toFixed(2)}, max DD ${(result.backtest.maxDD * 100).toFixed(1)}%.`;
  }

  private generateInterpretationWinner(result: PipelineResult): {
    name: string;
    reasoning: string;
    weightedScore: number;
    runnerUps: Array<{ name: string; score: number }>;
  } {
    const primary = result.interpretation.type;
    const primaryConfidence = result.interpretation.confidence;

    const runnerUps = result.interpretation.alternatives.map((alt) => ({
      name: alt.type,
      score: alt.confidence,
    }));

    return {
      name: primary,
      reasoning: `${primary} interpretation wins with ${(primaryConfidence * 100).toFixed(0)}% confidence. Outperforms alternatives by capturing market structure.`,
      weightedScore: primaryConfidence,
      runnerUps,
    };
  }

  private generateEarlyScreening(result: PipelineResult): {
    passed: boolean;
    filters: Array<{ name: string; passed: boolean; detail: string }>;
  } {
    const filters = result.earlyScreen.filters.map((f) => ({
      name: f.name,
      passed: f.passed,
      detail: f.reason,
    }));

    return {
      passed: result.earlyScreen.passed,
      filters,
    };
  }

  private generateCausalEdge(result: PipelineResult): {
    mechanism: string;
    confidence: number;
    keyAssumptions: string[];
    testingPlan: string;
  } {
    return {
      mechanism: result.causal.mechanism,
      confidence: result.causal.confidence,
      keyAssumptions: result.causal.keyAssumptions,
      testingPlan: `Validate assumptions during ${result.shadowSession ? 'shadow' : 'paper'} trading phase.`,
    };
  }

  private generateCritique(result: PipelineResult): {
    strengths: string[];
    weaknesses: string[];
    overallGrade: 'A' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'F';
    gradeReasoning: string;
  } {
    const gradeMap: Record<string, string> = {
      A: 'Exceptional design; minimal weaknesses',
      'B+': 'Strong design with few notable issues',
      B: 'Solid design; some concerns present',
      'B-': 'Acceptable design; multiple concerns',
      'C+': 'Borderline; significant improvements needed',
      C: 'Weak design; major overhaul required',
      F: 'Fails multiple criteria; not viable',
    };

    return {
      strengths: result.critique.strengths,
      weaknesses: result.critique.weaknesses,
      overallGrade: result.critique.grade,
      gradeReasoning: gradeMap[result.critique.grade] || 'Grade evaluation pending',
    };
  }

  private generateVariantComparison(result: PipelineResult): {
    variantCount: number;
    bestVariant: { name: string; sharpe: number; maxDD: number; winRate: number };
    comparisonHighlights: string[];
  } {
    const bestVariant = result.variants.reduce((best, current) =>
      current.sharpe > best.sharpe ? current : best
    );

    const highlights: string[] = [];
    if (result.variants.length > 1) {
      const avgSharpe =
        result.variants.reduce((sum, v) => sum + v.sharpe, 0) / result.variants.length;
      const sharpeEdge = bestVariant.sharpe - avgSharpe;
      highlights.push(
        `Best variant outperforms average by ${sharpeEdge.toFixed(2)} Sharpe`
      );
    }

    return {
      variantCount: result.variants.length,
      bestVariant: {
        name: bestVariant.name,
        sharpe: bestVariant.sharpe,
        maxDD: bestVariant.maxDD,
        winRate: bestVariant.winRate,
      },
      comparisonHighlights: highlights,
    };
  }

  private generateFragility(result: PipelineResult): {
    worstRegime: string;
    worstRegimePerformance: string;
    breakingConditions: string[];
  } {
    return {
      worstRegime: result.fragility.worstRegime,
      worstRegimePerformance: `Sharpe ${result.fragility.worstPerformance.sharpe.toFixed(2)}, DD ${(result.fragility.worstPerformance.maxDD * 100).toFixed(1)}%`,
      breakingConditions: result.fragility.breakingConditions,
    };
  }

  private generateShadowStatus(result: PipelineResult): {
    inShadow: boolean;
    daysElapsed?: number;
    tradeCount?: number;
    shadowSharpe?: number;
    shadowDrawdown?: number;
    onTrackForPromotion?: boolean;
  } {
    if (!result.shadowSession || !result.shadowSession.active) {
      return { inShadow: false };
    }

    return {
      inShadow: true,
      daysElapsed: result.shadowSession.daysElapsed,
      tradeCount: result.shadowSession.tradeCount,
      shadowSharpe: result.shadowSession.sharpe,
      shadowDrawdown: result.shadowSession.maxDD,
      onTrackForPromotion: result.shadowSession.onTrack,
    };
  }

  private generateRecommendation(result: PipelineResult): string {
    const goNoGo = this.generateGoNoGo(result);
    return goNoGo.reasoning;
  }

  private generateNextAction(result: PipelineResult): string {
    switch (result.stage) {
      case 'SEED':
        return 'Pass early screen and critique review';
      case 'LEARNING':
        return 'Achieve B+ grade and >0.6 causal confidence';
      case 'PROVEN':
        return 'Reach Sharpe >0.8 with <15% max DD for paper trading';
      case 'PAPER':
        return 'Complete 14+ days paper validation within 20% of backtest';
      case 'SHADOW':
        return 'Pass shadow scorecard: 30 days, 50 trades, Sharpe >0.5';
      case 'ASSISTED':
        return 'Complete 60+ days with <10% human override rate';
      case 'AUTONOMOUS':
        return 'Maintain 6+ months of stable performance';
      case 'ELITE':
        return 'Strategy is fully autonomous and optimized';
      default:
        return 'Unknown stage';
    }
  }

  private computeTrafficLight(result: PipelineResult): TrafficLight {
    if (
      result.backtest.sharpe >= 0.8 &&
      result.backtest.maxDD <= 0.15 &&
      result.critique.grade >= 'B'
    ) {
      return 'GREEN';
    }
    if (result.backtest.sharpe >= 0.5 || result.critique.grade >= 'B-') {
      return 'YELLOW';
    }
    return 'RED';
  }

  private generateExecutiveSummary(result: PipelineResult, view: TrustViewSection): string {
    return (
      `${view.strategyDescription} ` +
      `Current stage: ${result.stage}. ` +
      `Critique: ${view.critique.overallGrade}. ` +
      `Recommendation: ${view.recommendation}`
    );
  }

  private generateDecisionPath(result: PipelineResult, view: TrustViewSection): string {
    return (
      `1. Interpretation: ${view.interpretationWinner.name} won (${(view.interpretationWinner.weightedScore * 100).toFixed(0)}% confidence). ` +
      `2. Critique: Grade ${view.critique.overallGrade}. ` +
      `3. Backtest: Sharpe ${view.backtestResults.sharpe.toFixed(2)}, max DD ${(view.backtestResults.maxDrawdown * 100).toFixed(1)}%. ` +
      `4. Causal: ${view.causalEdge.mechanism} (${(view.causalEdge.confidence * 100).toFixed(0)}% confidence). ` +
      `5. Recommendation: ${view.recommendation}`
    );
  }

  private generateEvidenceHighlights(result: PipelineResult, view: TrustViewSection): string[] {
    return [
      `Interpretation: ${view.interpretationWinner.name}`,
      `Critique Grade: ${view.critique.overallGrade}`,
      `Backtest Sharpe: ${result.backtest.sharpe.toFixed(2)}`,
      `Max Drawdown: ${(result.backtest.maxDD * 100).toFixed(1)}%`,
      `Causal Confidence: ${(result.causal.confidence * 100).toFixed(0)}%`,
      `Calibration: ${result.calibration.toFixed(0)}/100`,
    ];
  }

  private generateDetailedRisks(
    result: PipelineResult,
    view: TrustViewSection
  ): {
    topRisks: Array<{
      risk: string;
      likelihood: string;
      impact: string;
      mitigation: string;
    }>;
  } {
    return {
      topRisks: this.highlightRisks(result),
    };
  }

  private generateDetailedNextSteps(result: PipelineResult, view: TrustViewSection): string[] {
    return [
      `Next milestone: ${view.nextAction}`,
      `Continue monitoring calibration (current: ${result.calibration.toFixed(0)}/100)`,
      `Review fragility: worst regime is ${view.fragility.worstRegime}`,
      `Follow lifecycle gate requirements for ${result.stage}`,
    ];
  }

  private computeApprovalReadiness(result: PipelineResult, view: TrustViewSection): 'READY' | 'NEEDS_REVIEW' | 'NOT_READY' {
    if (view.trafficLight === 'GREEN' && view.critique.overallGrade >= 'B') {
      return 'READY';
    }
    if (view.trafficLight === 'YELLOW' || view.critique.overallGrade >= 'B-') {
      return 'NEEDS_REVIEW';
    }
    return 'NOT_READY';
  }

  private extractGreenFlags(result: PipelineResult, view: TrustViewSection): string[] {
    const flags: string[] = [];

    if (result.backtest.sharpe > 0.8) flags.push('Strong Sharpe > 0.8');
    if (result.backtest.maxDD < 0.1) flags.push('Low max drawdown < 10%');
    if (result.backtest.winRate > 0.55) flags.push('Win rate > 55%');
    if (result.causal.confidence > 0.7) flags.push('Strong causal foundation');
    if (view.critique.overallGrade === 'A' || view.critique.overallGrade === 'B+')
      flags.push(`Critique grade ${view.critique.overallGrade}`);
    if (result.backtest.recoveryFactor > 2) flags.push('Strong recovery factor');

    return flags;
  }

  private extractRedFlags(result: PipelineResult, view: TrustViewSection): string[] {
    const flags: string[] = [];

    if (result.backtest.sharpe < 0.3) flags.push('Weak Sharpe < 0.3');
    if (result.backtest.maxDD > 0.3) flags.push('High max drawdown > 30%');
    if (result.backtest.winRate < 0.45) flags.push('Low win rate < 45%');
    if (result.causal.confidence < 0.5) flags.push('Weak causal foundation');
    if (view.critique.overallGrade === 'C' || view.critique.overallGrade === 'F')
      flags.push(`Critique grade ${view.critique.overallGrade}`);
    if (result.fragility.breakingConditions.length > 3) flags.push('Multiple breaking conditions');

    return flags;
  }

  private extractYellowFlags(result: PipelineResult, view: TrustViewSection): string[] {
    const flags: string[] = [];

    if (result.backtest.sharpe < 0.5) flags.push('Moderate Sharpe 0.3-0.5');
    if (result.backtest.maxDD > 0.2) flags.push('Moderate max drawdown 20-30%');
    if (result.backtest.sampleSize < 200) flags.push('Limited sample size');
    if (result.causal.confidence < 0.65) flags.push('Moderate causal confidence');
    if (view.critique.overallGrade === 'B-' || view.critique.overallGrade === 'C+')
      flags.push(`Critique grade ${view.critique.overallGrade}`);

    return flags;
  }
}
