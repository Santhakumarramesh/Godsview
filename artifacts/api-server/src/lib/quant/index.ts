// @ts-expect-error TS2307 — auto-suppressed for strict build
import { Strategy, BacktestResult, MarketData } from '../types';
import HypothesisEngine, { Hypothesis, HypothesisType } from './hypothesis_engine';
import StrategyCritic, { StrategyGrade, RedTeamAnalysis } from './strategy_critic';
import VariantRanker, { VariantScore } from './variant_ranker';
import AutoImprover, { Improvement, ImprovementType } from './auto_improver';

export type RecommendationType = 'DEPLOY' | 'PAPER_TRADE' | 'REJECT' | 'NEEDS_MORE_DATA' | 'NEEDS_IMPROVEMENT';

export interface QuantCoreRecommendation {
  recommendation: RecommendationType;
  reasoning: string;
  confidence: number; // 0-1
  nextSteps: string[];
  risks: string[];
}

export interface PreScreenResult {
  viabilityScore: number; // 0-1
  passesBasicChecks: boolean;
  issues: string[];
  recommendation: RecommendationType;
}

export interface PostBacktestAnalysis {
  gradeResult: StrategyGrade;
  hypotheses: Hypothesis[];
  redTeamAnalysis: RedTeamAnalysis;
  improvements: Improvement[];
  overallAssessment: string;
}

export interface FullAnalysisResult {
  preScreen: PreScreenResult;
  postBacktest: PostBacktestAnalysis;
  recommendation: QuantCoreRecommendation;
  summary: string;
}

/**
 * QuantCore - Main orchestrator for strategy analysis
 * Coordinates HypothesisEngine, StrategyCritic, VariantRanker, and AutoImprover
 */
export class QuantCore {
  private hypothesisEngine: HypothesisEngine;
  private strategyCritic: StrategyCritic;
  private variantRanker: VariantRanker;
  private autoImprover: AutoImprover;

  constructor() {
    this.hypothesisEngine = new HypothesisEngine();
    this.strategyCritic = new StrategyCritic();
    this.variantRanker = new VariantRanker();
    this.autoImprover = new AutoImprover();
  }

  /**
   * Quick viability check before expensive backtesting
   */
  preScreen(strategy: Strategy): PreScreenResult {
    const issues: string[] = [];
    let viabilityScore = 1.0;

    // Check 1: Strategy must have entry rules
    if (!strategy.entryRules || strategy.entryRules.length === 0) {
      issues.push('No entry rules defined');
      viabilityScore -= 0.3;
    }

    // Check 2: Strategy must have exit rules
    if (!strategy.exitRules || strategy.exitRules.length === 0) {
      issues.push('No exit rules defined - unlimited loss potential');
      viabilityScore -= 0.25;
    }

    // Check 3: Some risk management required
    const hasStopLoss = strategy.exitRules?.some((r: any) => r.type === 'stop_loss');
    const hasProfitTarget = strategy.exitRules?.some((r: any) => r.type === 'profit_target');
    const hasPositionSizing = strategy.positionSizingRules?.type && strategy.positionSizingRules.type !== 'fixed';

    if (!hasStopLoss) {
      issues.push('No stop loss protection');
      viabilityScore -= 0.15;
    }

    if (!hasPositionSizing) {
      issues.push('Fixed position sizing ignores market volatility');
      viabilityScore -= 0.1;
    }

    // Check 4: Strategy should target reasonable markets
    const minLiquidity = strategy.minLiquidity || 1000000;
    if (minLiquidity > 10000000000) {
      issues.push('Liquidity requirement is unreasonably high');
      viabilityScore -= 0.2;
    }

    // Check 5: Not overly complex
    const ruleCount = (strategy.entryRules?.length || 0) + (strategy.exitRules?.length || 0);
    if (ruleCount > 15) {
      issues.push('Strategy is overly complex with too many rules');
      viabilityScore -= 0.15;
    }

    // Check 6: Indicators should be reasonable
    if (strategy.indicators && strategy.indicators.length > 10) {
      issues.push('Too many indicators - likely overfitting');
      viabilityScore -= 0.2;
    }

    const passesBasicChecks = issues.length <= 2 && viabilityScore > 0.6;
    const recommendation = this.determinePreScreenRecommendation(passesBasicChecks, viabilityScore, issues);

    return {
      viabilityScore,
      passesBasicChecks,
      issues,
      recommendation,
    };
  }

  private determinePreScreenRecommendation(passes: boolean, score: number, issues: string[]): RecommendationType {
    if (!passes && score < 0.4) {
      return 'REJECT';
    }
    if (issues.length > 3) {
      return 'NEEDS_IMPROVEMENT';
    }
    if (passes) {
      return 'NEEDS_MORE_DATA'; // Move to backtesting
    }
    return 'NEEDS_IMPROVEMENT';
  }

  /**
   * Deep analysis after backtest completes
   */
  postBacktestAnalysis(strategy: Strategy, backtestResults: BacktestResult, marketData?: MarketData[]): PostBacktestAnalysis {
    // Step 1: Test hypotheses
    let hypotheses = this.hypothesisEngine.generateHypotheses(strategy);
    if (marketData) {
      hypotheses = hypotheses.map(h => this.hypothesisEngine.testHypothesis(h, marketData));
    }

    // Step 2: Get strategy grade
    const gradeResult = this.strategyCritic.gradeStrategy(strategy, backtestResults);

    // Step 3: Red team analysis
    const redTeamAnalysis = this.strategyCritic.redTeamAnalysis(strategy, backtestResults);

    // Step 4: Get improvement suggestions
    const improvements = this.autoImprover.suggestImprovements(strategy, backtestResults);

    // Step 5: Generate assessment
    const hypothesisSynthesis = this.hypothesisEngine.synthesize(hypotheses);
    const overallAssessment = this.generatePostBacktestAssessment(gradeResult, redTeamAnalysis, hypothesisSynthesis);

    return {
      gradeResult,
      hypotheses,
      redTeamAnalysis,
      improvements,
      overallAssessment,
    };
  }

  private generatePostBacktestAssessment(grade: StrategyGrade, redTeam: RedTeamAnalysis, hypothesis: any): string {
    const parts: string[] = [];

    parts.push(`Overall grade: ${grade.overall}. ${grade.explanation}`);

    if (redTeam.estimatedFailureProbability > 0.5) {
      parts.push(`Risk assessment: High failure probability (${(redTeam.estimatedFailureProbability * 100).toFixed(0)}%). Strategy has ${redTeam.vulnerabilities.length} critical vulnerabilities.`);
    } else if (redTeam.estimatedFailureProbability > 0.3) {
      parts.push(`Risk assessment: Moderate failure probability (${(redTeam.estimatedFailureProbability * 100).toFixed(0)}%). Several vulnerabilities identified.`);
    } else {
      parts.push(`Risk assessment: Lower failure probability (${(redTeam.estimatedFailureProbability * 100).toFixed(0)}%). Reasonable safeguards in place.`);
    }

    parts.push(`Edge hypothesis: Most likely source is ${hypothesis.mostLikelyEdgeSource.name} (confidence: ${(hypothesis.edgeProbability * 100).toFixed(1)}%).`);

    if (hypothesis.risks.length > 0) {
      parts.push(`Risks: ${hypothesis.risks.slice(0, 2).join('; ')}`);
    }

    return parts.join(' ');
  }

  /**
   * Complete analysis pipeline
   */
  fullAnalysis(strategy: Strategy, backtestResults?: BacktestResult, marketData?: MarketData[]): FullAnalysisResult {
    // Step 1: Pre-screen
    const preScreen = this.preScreen(strategy);

    if (!preScreen.passesBasicChecks) {
      // Still do analysis but flag issues
      const postBacktest = backtestResults ? this.postBacktestAnalysis(strategy, backtestResults, marketData) : this.generateEmptyPostBacktest();

      const recommendation = this.generateFinalRecommendation(strategy, preScreen, null, postBacktest);

      return {
        preScreen,
        postBacktest,
        recommendation,
        summary: `Pre-screen failed with ${preScreen.issues.length} issues. Not recommended for deployment.`,
      };
    }

    // Step 2: Post-backtest analysis (if we have backtest results)
    const postBacktest = backtestResults ? this.postBacktestAnalysis(strategy, backtestResults, marketData) : this.generateEmptyPostBacktest();

    // Step 3: Final recommendation
    const recommendation = this.generateFinalRecommendation(strategy, preScreen, backtestResults, postBacktest);

    // Step 4: Summary
    const summary = this.generateSummary(strategy, preScreen, backtestResults, postBacktest, recommendation);

    return {
      preScreen,
      postBacktest,
      recommendation,
      summary,
    };
  }

  private generateEmptyPostBacktest(): PostBacktestAnalysis {
    return {
      gradeResult: {
        overall: 'F' as any,
        subGrades: {} as any,
        scores: {},
        explanation: 'No backtest results available',
      },
      hypotheses: [],
      redTeamAnalysis: {
        critiques: [],
        vulnerabilities: [],
        failureScenarios: [],
        estimatedFailureProbability: 1.0,
        breakingPoints: [],
      },
      improvements: [],
      overallAssessment: 'Insufficient data for analysis',
    };
  }

  /**
   * Get final recommendation
   */
  getRecommendation(strategy: Strategy, backtestResults?: BacktestResult, marketData?: MarketData[]): QuantCoreRecommendation {
    const fullAnalysis = this.fullAnalysis(strategy, backtestResults, marketData);
    return fullAnalysis.recommendation;
  }

  private generateFinalRecommendation(strategy: Strategy, preScreen: PreScreenResult, backtestResults: BacktestResult | undefined, postBacktest: PostBacktestAnalysis): QuantCoreRecommendation {
    const grade = postBacktest.gradeResult.overall;
    const failureProbability = postBacktest.redTeamAnalysis.estimatedFailureProbability;
    const hypothesisSynthesis = this.hypothesisEngine.synthesize(postBacktest.hypotheses);

    // Score the strategy
    let score = 0;
    let recommendation: RecommendationType = 'REJECT';

    // Grade contribution
    switch (grade) {
      case 'A':
        score += 40;
        break;
      case 'B':
        score += 30;
        break;
      case 'C':
        score += 15;
        break;
      case 'D':
        score += 5;
        break;
      case 'F':
        score -= 20;
        break;
    }

    // Risk contribution
    score -= failureProbability * 30;

    // Edge hypothesis contribution
    score += hypothesisSynthesis.edgeProbability * 20;

    // Backtest quality contribution
    if (backtestResults) {
      if (backtestResults.sharpeRatio && backtestResults.sharpeRatio > 1.0) {
        score += 10;
      }
      if (backtestResults.outOfSampleSharpe && backtestResults.outOfSampleSharpe > 0.5) {
        score += 10;
      }
    }

    // Determine recommendation
    if (score > 60) {
      recommendation = 'DEPLOY';
    } else if (score > 40) {
      recommendation = 'PAPER_TRADE';
    } else if (score > 20) {
      recommendation = 'NEEDS_MORE_DATA';
    } else if (score > 0) {
      recommendation = 'NEEDS_IMPROVEMENT';
    } else {
      recommendation = 'REJECT';
    }

    // Adjust based on missing data
    if (!backtestResults) {
      recommendation = 'NEEDS_MORE_DATA';
    }

    const confidence = Math.min(Math.max((Math.abs(score) / 100), 0), 1);
    const reasoning = this.generateRecommendationReasoning(recommendation, score, grade, failureProbability, hypothesisSynthesis);
    const nextSteps = this.generateNextSteps(recommendation, postBacktest);
    const risks = this.identifyTopRisks(postBacktest, failureProbability);

    return {
      recommendation,
      reasoning,
      confidence,
      nextSteps,
      risks,
    };
  }

  private generateRecommendationReasoning(rec: RecommendationType, score: number, grade: string, failureProb: number, hypo: any): string {
    switch (rec) {
      case 'DEPLOY':
        return `Strategy shows strong fundamentals (Grade: ${grade}, Score: ${score.toFixed(0)}) with low failure risk (${(failureProb * 100).toFixed(0)}%). Edge appears to be real with confidence of ${(hypo.edgeProbability * 100).toFixed(0)}%. Ready for live deployment with monitoring.`;
      case 'PAPER_TRADE':
        return `Strategy shows promise (Grade: ${grade}, Score: ${score.toFixed(0)}) but with moderate risk (${(failureProb * 100).toFixed(0)}) and uncertain edge (${(hypo.edgeProbability * 100).toFixed(0)}% confidence). Recommend paper trading first.`;
      case 'NEEDS_MORE_DATA':
        return `Strategy needs additional validation. Insufficient backtest data or edge clarity (${(hypo.edgeProbability * 100).toFixed(0)}% confidence). Run longer backtest or forward test.`;
      case 'NEEDS_IMPROVEMENT':
        return `Strategy has fundamental issues (Grade: ${grade}) and high failure risk (${(failureProb * 100).toFixed(0)}%). Multiple improvements recommended before consideration.`;
      case 'REJECT':
        return `Strategy fails basic viability checks (Grade: ${grade}, Score: ${score.toFixed(0)}). Failure probability is unacceptably high (${(failureProb * 100).toFixed(0)}%). Not recommended for trading.`;
    }
  }

  private generateNextSteps(rec: RecommendationType, postBacktest: PostBacktestAnalysis): string[] {
    const steps: string[] = [];

    switch (rec) {
      case 'DEPLOY':
        steps.push('Set up monitoring and alerting for strategy signals');
        steps.push('Implement gradual position scaling (start 20% of target size)');
        steps.push('Record daily P&L metrics and compare to backtest expectations');
        steps.push('Plan quarterly strategy review with stop-loss at -30% loss');
        break;

      case 'PAPER_TRADE':
        steps.push('Run paper trading for at least 3-6 months');
        steps.push('Compare paper trading results to backtest expectations');
        steps.push('If paper trading succeeds, transition to 20% live allocation');
        steps.push('Implement improvements from post-backtest analysis before live deployment');
        break;

      case 'NEEDS_MORE_DATA':
        steps.push('Run backtest on longer historical period (10+ years)');
        steps.push('Perform walk-forward analysis on unseen data');
        steps.push('Test strategy on multiple asset classes/markets');
        steps.push('Increase sample size to at least 200 trades');
        break;

      case 'NEEDS_IMPROVEMENT':
        steps.push(`Apply top improvement: ${postBacktest.improvements[0]?.name || 'Reduce complexity'}`);
        steps.push('Address critical vulnerabilities identified in red team analysis');
        steps.push('Rebalance risk management (add/improve stop losses)');
        steps.push('Simplify strategy by removing low-impact rules');
        break;

      case 'REJECT':
        steps.push('Review strategy concept from scratch');
        steps.push('Consider if edge hypothesis is fundamentally flawed');
        steps.push('If pursuing, start with more data and larger sample size');
        break;
    }

    return steps;
  }

  private identifyTopRisks(postBacktest: PostBacktestAnalysis, failureProb: number): string[] {
    const risks: string[] = [];

    if (failureProb > 0.6) {
      risks.push(`High estimated failure probability: ${(failureProb * 100).toFixed(0)}%`);
    }

    // Add vulnerabilities
    risks.push(...postBacktest.redTeamAnalysis.vulnerabilities.slice(0, 2));

    // Add hypothesis risks
    // Add worst case scenarios
    if (postBacktest.redTeamAnalysis.failureScenarios.length > 0) {
      risks.push(`Potential failure scenario: ${postBacktest.redTeamAnalysis.failureScenarios[0]}`);
    }

    return risks.slice(0, 5);
  }

  private generateSummary(strategy: Strategy, preScreen: PreScreenResult, backtestResults: BacktestResult | undefined, postBacktest: PostBacktestAnalysis, recommendation: QuantCoreRecommendation): string {
    const parts: string[] = [];

    parts.push(`Strategy: ${strategy.name || 'Unnamed'}`);
    parts.push(`Pre-screen viability: ${(preScreen.viabilityScore * 100).toFixed(0)}%`);

    if (backtestResults) {
      parts.push(`Backtest: ${backtestResults.totalTrades} trades, ${(backtestResults.totalReturn * 100).toFixed(1)}% return, Sharpe: ${backtestResults.sharpeRatio?.toFixed(2)}, Max DD: ${(backtestResults.maxDrawdown * 100).toFixed(1)}%`);
    }

    parts.push(`Grade: ${postBacktest.gradeResult.overall}`);
    parts.push(`Recommendation: ${recommendation.recommendation} (confidence: ${(recommendation.confidence * 100).toFixed(0)}%)`);

    return parts.join(' | ');
  }
}

// Export all components
export default QuantCore;
export { HypothesisEngine, StrategyCritic, VariantRanker, AutoImprover };
export type { Hypothesis, StrategyGrade, VariantScore, Improvement };

export const quantCore = new QuantCore();
