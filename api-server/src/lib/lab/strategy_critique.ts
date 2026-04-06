/**
 * Quant-Style Critique Engine
 *
 * Evaluates strategy quality across multiple dimensions:
 * - Edge source viability
 * - Risk-reward characteristics
 * - Overfit risk
 * - Regime dependence
 * - Implementation complexity
 * - Crowding risk
 * - Execution feasibility
 */

import { StrategyDSL } from './strategy_dsl';

export interface CritiqueReport {
  overallScore: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  verdict: string;
  edgeAnalysis: EdgeAnalysis;
  riskAnalysis: RiskRewardAnalysis;
  overfitRisk: OverfitAnalysis;
  regimeAnalysis: RegimeAnalysis;
  complexityAnalysis: ComplexityAnalysis;
  crowdingRisk: CrowdingAnalysis;
  executionAnalysis: ExecutionAnalysis;
  improvements: Improvement[];
  dealBreakers: string[];
  strengths: string[];
  weaknesses: string[];
  recommendation: 'proceed_to_backtest' | 'needs_revision' | 'fundamentally_flawed' | 'promising_but_incomplete';
}

export interface EdgeAnalysis {
  score: number;
  isArbitrage: boolean;
  isStatisticalEdge: boolean;
  isBehavioralEdge: boolean;
  primarySource: string;
  secondarySources: string[];
  credibilityScore: number;
  concern: string;
}

export interface RiskRewardAnalysis {
  score: number;
  minRR: number;
  maxRR: number;
  avgRR: number;
  riskAsymmetry: number;
  profitFactor: number;
  expectancy: number;
  winRateRequired: number;
  verdict: string;
}

export interface OverfitAnalysis {
  score: number;
  parameterCount: number;
  dataPointsPerParam: number;
  overfitRiskLevel: 'low' | 'moderate' | 'high' | 'critical';
  robustnessScore: number;
  degreeOfFreedom: number;
  concerns: string[];
}

export interface RegimeAnalysis {
  score: number;
  regimeDependence: number;
  bestRegimes: string[];
  worstRegimes: string[];
  diversification: number;
  adaptability: number;
  concerns: string[];
}

export interface ComplexityAnalysis {
  score: number;
  totalConditions: number;
  parameterCount: number;
  complexity: 'simple' | 'moderate' | 'complex' | 'advanced';
  debuggability: number;
  maintainability: number;
  executionRisk: number;
}

export interface CrowdingAnalysis {
  score: number;
  crowdingRisk: 'low' | 'moderate' | 'high';
  indicators: string[];
  patterns: string[];
  estimatedRivalCount: number;
  marketImpact: string;
}

export interface ExecutionAnalysis {
  score: number;
  liquidityRisk: number;
  latencyRisk: number;
  slippageRisk: number;
  detectionRisk: number;
  executionScore: number;
  concerns: string[];
}

export interface Improvement {
  category: string;
  issue: string;
  suggestion: string;
  priority: 'high' | 'medium' | 'low';
  impact: string;
}

export class StrategyCritique {
  /**
   * Comprehensive strategy critique
   */
  critique(strategy: StrategyDSL): CritiqueReport {
    const edgeAnalysis = this.analyzeEdgeSource(strategy);
    const riskAnalysis = this.analyzeRiskReward(strategy);
    const overfitAnalysis = this.analyzeOverfitRisk(strategy);
    const regimeAnalysis = this.analyzeRegimeDependence(strategy);
    const complexityAnalysis = this.analyzeComplexity(strategy);
    const crowdingAnalysis = this.analyzeCrowdingRisk(strategy);
    const executionAnalysis = this.analyzeExecutionFeasibility(strategy);

    // Calculate overall score (weighted average)
    const overallScore = Math.round(
      edgeAnalysis.score * 0.2 +
      riskAnalysis.score * 0.25 +
      (100 - overfitAnalysis.overfitRiskLevel === 'critical' ? 0 :
       overfitAnalysis.overfitRiskLevel === 'high' ? 30 :
       overfitAnalysis.overfitRiskLevel === 'moderate' ? 60 : 85) * 0.15 +
      regimeAnalysis.score * 0.15 +
      (100 - complexityAnalysis.executionRisk * 100) * 0.1 +
      (100 - crowdingAnalysis.crowdingRisk === 'high' ? 70 :
       crowdingAnalysis.crowdingRisk === 'moderate' ? 50 : 90) * 0.1 +
      executionAnalysis.score * 0.05
    );

    // Assign grade
    let grade: 'A' | 'B' | 'C' | 'D' | 'F' = 'C';
    if (overallScore >= 85) grade = 'A';
    else if (overallScore >= 70) grade = 'B';
    else if (overallScore >= 50) grade = 'C';
    else if (overallScore >= 30) grade = 'D';
    else grade = 'F';

    // Identify deal breakers
    const dealBreakers: string[] = [];
    if (riskAnalysis.expectancy < 0) dealBreakers.push('Negative expectancy - edge insufficient');
    if (overfitAnalysis.overfitRiskLevel === 'critical') dealBreakers.push('Critical overfit risk');
    if (strategy.entry.conditions.length === 0) dealBreakers.push('No entry conditions defined');
    if (riskAnalysis.minRR < 1.0) dealBreakers.push('Risk-reward ratio < 1:1 - unacceptable');

    // Identify strengths
    const strengths: string[] = [];
    if (edgeAnalysis.score > 75) strengths.push('Clear, identifiable edge source');
    if (riskAnalysis.avgRR > 2.5) strengths.push('Excellent risk-reward ratios');
    if (regimeAnalysis.diversification > 0.7) strengths.push('Works across multiple regimes');
    if (complexityAnalysis.complexity === 'simple') strengths.push('Simple, easy to execute');
    if (executionAnalysis.score > 75) strengths.push('Realistic execution parameters');

    // Identify weaknesses
    const weaknesses: string[] = [];
    if (edgeAnalysis.score < 50) weaknesses.push('Edge source unclear or weak');
    if (regimeAnalysis.regimeDependence > 0.7) weaknesses.push('Highly regime-dependent');
    if (overfitAnalysis.overfitRiskLevel === 'high' || overfitAnalysis.overfitRiskLevel === 'moderate') {
      weaknesses.push('Significant overfit risk');
    }
    if (crowdingAnalysis.estimatedRivalCount > 100) weaknesses.push('Likely crowded strategy');
    if (executionAnalysis.slippageRisk > 0.7) weaknesses.push('High slippage risk');

    // Generate improvements
    const improvements = this.suggestImprovements(strategy);

    // Determine recommendation
    let recommendation: 'proceed_to_backtest' | 'needs_revision' | 'fundamentally_flawed' | 'promising_but_incomplete' =
      'promising_but_incomplete';

    if (dealBreakers.length > 0) {
      recommendation = 'fundamentally_flawed';
    } else if (overallScore >= 70) {
      recommendation = 'proceed_to_backtest';
    } else if (overallScore >= 50) {
      recommendation = 'needs_revision';
    }

    const verdict = this.generateVerdict(overallScore, grade, dealBreakers);

    return {
      overallScore,
      grade,
      verdict,
      edgeAnalysis,
      riskAnalysis,
      overfitRisk: overfitAnalysis,
      regimeAnalysis,
      complexityAnalysis,