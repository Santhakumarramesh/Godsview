// @ts-expect-error TS2307 — auto-suppressed for strict build
import { Strategy, BacktestResult } from '../types';

export interface RobustnessScores {
  edgeStability: number;
  parameterSensitivity: number;
  regimeRobustness: number;
  drawdownProfile: number;
  executionRealism: number;
  complexityPenalty: number;
  sampleSizeAdequacy: number;
  outOfSamplePerformance: number;
}

export interface VariantScore {
  strategyId: string;
  name: string;
  backtestResults: BacktestResult;
  robustnessScores: RobustnessScores;
  compositeScore: number;
  rank: number;
  reasoning: string;
}

export interface ComparisonResult {
  strategyA: string;
  strategyB: string;
  winner: string;
  winMargin: number;
  scoreBreakdown: Record<string, { scoreA: number; scoreB: number; winner: string }>;
  recommendation: string;
}

export class VariantRanker {
  /**
   * Score a strategy variant on 8 robustness dimensions
   */
  private scoreVariant(strategy: Strategy, backtestResults: BacktestResult): RobustnessScores {
    const scores: RobustnessScores = {
      edgeStability: this.scoreEdgeStability(backtestResults),
      parameterSensitivity: this.scoreParameterSensitivity(backtestResults),
      regimeRobustness: this.scoreRegimeRobustness(backtestResults),
      drawdownProfile: this.scoreDrawdownProfile(backtestResults),
      executionRealism: this.scoreExecutionRealism(strategy, backtestResults),
      complexityPenalty: this.scoreComplexityPenalty(strategy),
      sampleSizeAdequacy: this.scoreSampleSizeAdequacy(backtestResults),
      outOfSamplePerformance: this.scoreOutOfSamplePerformance(backtestResults),
    };

    return scores;
  }

  private scoreEdgeStability(backtestResults: BacktestResult): number {
    // Score based on rolling window Sharpe consistency
    if (!backtestResults.rollingWindowSharpe || backtestResults.rollingWindowSharpe.length === 0) {
      return 0.5; // Unknown
    }

    const windows = backtestResults.rollingWindowSharpe;
    const mean = windows.reduce((a: any, b: any) => a + b) / windows.length;
    const variance = windows.reduce((sum: any, v: any) => sum + Math.pow(v - mean, 2), 0) / windows.length;
    const stdDev = Math.sqrt(variance);

    // Lower coefficient of variation = more stable
    const cv = stdDev / Math.max(Math.abs(mean), 0.1);
    if (cv < 0.3) return 1.0;
    if (cv < 0.5) return 0.8;
    if (cv < 0.8) return 0.6;
    if (cv < 1.2) return 0.4;
    return 0.2;
  }

  private scoreParameterSensitivity(backtestResults: BacktestResult): number {
    // Lower sensitivity = higher score
    // Sensitivity measures how much returns change with small parameter variations
    if (!backtestResults.parameterSensitivity) {
      return 0.5; // Unknown
    }

    const sensitivity = backtestResults.parameterSensitivity;
    if (sensitivity < 0.05) return 1.0;
    if (sensitivity < 0.1) return 0.9;
    if (sensitivity < 0.15) return 0.8;
    if (sensitivity < 0.25) return 0.6;
    if (sensitivity < 0.4) return 0.3;
    return 0.1;
  }

  private scoreRegimeRobustness(backtestResults: BacktestResult): number {
    // Score based on performance consistency across regimes
    if (!backtestResults.regimePerformance) {
      return 0.5; // Unknown
    }

    const performances = Object.values(backtestResults.regimePerformance as Record<string, number>);
    if (performances.length < 2) return 0.5; // Only one regime

    const mean = performances.reduce((a, b) => a + b) / performances.length;
    const variance = performances.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / performances.length;
    const stdDev = Math.sqrt(variance);

    // Lower coefficient of variation = more consistent across regimes
    const cv = stdDev / Math.max(Math.abs(mean), 0.1);
    if (cv < 0.2) return 1.0;
    if (cv < 0.4) return 0.85;
    if (cv < 0.7) return 0.65;
    if (cv < 1.2) return 0.4;
    return 0.15;
  }

  private scoreDrawdownProfile(backtestResults: BacktestResult): number {
    let score = 0;

    // Max drawdown component (lower is better)
    const maxDD = backtestResults.maxDrawdown || 0.5;
    if (maxDD < 0.1) {
      score += 0.4;
    } else if (maxDD < 0.2) {
      score += 0.3;
    } else if (maxDD < 0.35) {
      score += 0.2;
    } else if (maxDD < 0.5) {
      score += 0.1;
    }

    // Recovery time component (faster recovery is better)
    if (backtestResults.maxDrawdownRecoveryDays) {
      const recoveryDays = backtestResults.maxDrawdownRecoveryDays;
      if (recoveryDays < 30) {
        score += 0.3;
      } else if (recoveryDays < 60) {
        score += 0.2;
      } else if (recoveryDays < 120) {
        score += 0.1;
      }
    } else {
      score += 0.15;
    }

    // Tail risk component (avoid extreme losses)
    const worstMonth = backtestResults.worstMonthReturn || -0.3;
    if (worstMonth > -0.15) {
      score += 0.3;
    } else if (worstMonth > -0.25) {
      score += 0.15;
    } else if (worstMonth > -0.4) {
      score += 0.05;
    }

    return Math.min(score, 1);
  }

  private scoreExecutionRealism(strategy: Strategy, backtestResults: BacktestResult): number {
    let score = 0;

    // Slippage handling (if results account for slippage, good)
    if (backtestResults.slippageAssumed && backtestResults.slippageAssumed > 0) {
      score += 0.25;
    }

    // Commission costs
    if (backtestResults.commissionsIncluded) {
      score += 0.25;
    }

    // Spread assumptions
    if (backtestResults.spreadAssumed && backtestResults.spreadAssumed > 0) {
      score += 0.2;
    }

    // Liquidity check during backtest
    if (backtestResults.liquidityCheck) {
      score += 0.15;
    }

    // Order execution realism
    const orderType = strategy.orderType || 'market';
    if (orderType === 'limit' || strategy.entryRules?.some((r: any) => r.type?.includes('limit'))) {
      score += 0.15;
    }

    return Math.min(score, 1);
  }

  private scoreComplexityPenalty(strategy: Strategy): number {
    // Simpler strategies score higher
    let score = 1.0;

    // Penalize for too many rules
    const ruleCount = (strategy.entryRules?.length || 0) + (strategy.exitRules?.length || 0);
    if (ruleCount > 10) {
      score -= 0.3;
    } else if (ruleCount > 6) {
      score -= 0.15;
    } else if (ruleCount > 3) {
      score -= 0.05;
    }

    // Penalize for too many parameters
    const paramCount = strategy.parameters?.length || 0;
    if (paramCount > 15) {
      score -= 0.2;
    } else if (paramCount > 8) {
      score -= 0.1;
    }

    // Penalize for custom/complex indicators
    const customIndicators = strategy.indicators?.filter((i: any) => i.type.includes('Custom')).length || 0;
    if (customIndicators > 0) {
      score -= 0.1;
    }

    return Math.min(Math.max(score, 0), 1);
  }

  private scoreSampleSizeAdequacy(backtestResults: BacktestResult): number {
    // Score based on sufficient number of trades for statistical significance
    const trades = backtestResults.totalTrades || 0;

    if (trades > 500) return 1.0;
    if (trades > 300) return 0.95;
    if (trades > 200) return 0.85;
    if (trades > 100) return 0.7;
    if (trades > 50) return 0.5;
    if (trades > 20) return 0.25;
    return 0.1;
  }

  private scoreOutOfSamplePerformance(backtestResults: BacktestResult): number {
    // Compare out-of-sample to in-sample performance
    if (!backtestResults.outOfSampleSharpe || !backtestResults.sharpeRatio) {
      return 0.5; // Unknown
    }

    const degradation = backtestResults.outOfSampleSharpe / Math.max(backtestResults.sharpeRatio, 0.1);

    if (degradation > 0.9) return 1.0;
    if (degradation > 0.75) return 0.85;
    if (degradation > 0.6) return 0.65;
    if (degradation > 0.4) return 0.4;
    if (degradation > 0.2) return 0.15;
    return 0.05;
  }

  /**
   * Calculate composite robustness score
   */
  private calculateCompositeScore(robustnessScores: RobustnessScores): number {
    // Weighted average of all 8 dimensions
    const weights = {
      edgeStability: 0.15,
      parameterSensitivity: 0.15,
      regimeRobustness: 0.15,
      drawdownProfile: 0.15,
      executionRealism: 0.15,
      complexityPenalty: 0.1,
      sampleSizeAdequacy: 0.1,
      outOfSamplePerformance: 0.15,
    };

    let score = 0;
    score += robustnessScores.edgeStability * weights.edgeStability;
    score += robustnessScores.parameterSensitivity * weights.parameterSensitivity;
    score += robustnessScores.regimeRobustness * weights.regimeRobustness;
    score += robustnessScores.drawdownProfile * weights.drawdownProfile;
    score += robustnessScores.executionRealism * weights.executionRealism;
    score += robustnessScores.complexityPenalty * weights.complexityPenalty;
    score += robustnessScores.sampleSizeAdequacy * weights.sampleSizeAdequacy;
    score += robustnessScores.outOfSamplePerformance * weights.outOfSamplePerformance;

    return Math.min(score, 1);
  }

  /**
   * Rank multiple strategy variants by robustness
   */
  rankVariants(variants: Array<{ strategy: Strategy; backtestResults: BacktestResult }>): VariantScore[] {
    const scores: VariantScore[] = variants.map((variant, index) => {
      const robustnessScores = this.scoreVariant(variant.strategy, variant.backtestResults);
      const compositeScore = this.calculateCompositeScore(robustnessScores);

      return {
        strategyId: variant.strategy.id || `variant-${index}`,
        name: variant.strategy.name || `Variant ${index + 1}`,
        backtestResults: variant.backtestResults,
        robustnessScores,
        compositeScore,
        rank: 0, // Will be set after sorting
        reasoning: '',
      };
    });

    // Sort by composite score (descending)
    scores.sort((a, b) => b.compositeScore - a.compositeScore);

    // Assign ranks and generate reasoning
    for (let i = 0; i < scores.length; i++) {
      scores[i].rank = i + 1;
      scores[i].reasoning = this.generateRankingReasoning(scores[i], scores.length);
    }

    return scores;
  }

  private generateRankingReasoning(score: VariantScore, totalVariants: number): string {
    const parts: string[] = [];

    parts.push(`Ranked #${score.rank} out of ${totalVariants} variants.`);

    // Identify strengths
    const robustness = score.robustnessScores;
    const strengths: string[] = [];

    if (robustness.edgeStability > 0.8) {
      strengths.push('edge stability');
    }
    if (robustness.parameterSensitivity > 0.8) {
      strengths.push('parameter robustness');
    }
    if (robustness.regimeRobustness > 0.8) {
      strengths.push('regime consistency');
    }
    if (robustness.drawdownProfile > 0.8) {
      strengths.push('drawdown management');
    }
    if (robustness.executionRealism > 0.8) {
      strengths.push('execution feasibility');
    }
    if (robustness.outOfSamplePerformance > 0.8) {
      strengths.push('generalization to new data');
    }

    if (strengths.length > 0) {
      parts.push(`Strengths: ${strengths.join(', ')}.`);
    }

    // Identify weaknesses
    const weaknesses: string[] = [];

    if (robustness.edgeStability < 0.5) {
      weaknesses.push('unstable edge');
    }
    if (robustness.parameterSensitivity < 0.5) {
      weaknesses.push('sensitive to parameters');
    }
    if (robustness.regimeRobustness < 0.5) {
      weaknesses.push('regime dependent');
    }
    if (robustness.drawdownProfile < 0.5) {
      weaknesses.push('high drawdown risk');
    }
    if (robustness.sampleSizeAdequacy < 0.5) {
      weaknesses.push('insufficient trades');
    }
    if (robustness.outOfSamplePerformance < 0.5) {
      weaknesses.push('poor generalization');
    }

    if (weaknesses.length > 0) {
      parts.push(`Weaknesses: ${weaknesses.join(', ')}.`);
    }

    // Recommendation
    if (score.rank === 1) {
      parts.push('Recommendation: Best variant - most robust. Suitable for live deployment.');
    } else if (score.rank <= 3) {
      parts.push('Recommendation: Good variant with acceptable robustness. Can deploy with monitoring.');
    } else if (score.rank <= totalVariants / 2) {
      parts.push('Recommendation: Moderate variant. Needs further refinement before deployment.');
    } else {
      parts.push('Recommendation: Weak variant. Significant robustness issues. Not recommended for deployment.');
    }

    return parts.join(' ');
  }

  /**
   * Compare two strategy variants head-to-head
   */
  compareTwo(variantA: { strategy: Strategy; backtestResults: BacktestResult }, variantB: { strategy: Strategy; backtestResults: BacktestResult }): ComparisonResult {
    const scoresA = this.scoreVariant(variantA.strategy, variantA.backtestResults);
    const scoresB = this.scoreVariant(variantB.strategy, variantB.backtestResults);

    const compositeA = this.calculateCompositeScore(scoresA);
    const compositeB = this.calculateCompositeScore(scoresB);

    const winner = compositeA > compositeB ? (variantA.strategy.name || 'A') : variantB.strategy.name || 'B';
    const winMargin = Math.abs(compositeA - compositeB);

    const breakdown: Record<string, { scoreA: number; scoreB: number; winner: string }> = {
      edgeStability: {
        scoreA: scoresA.edgeStability,
        scoreB: scoresB.edgeStability,
        winner: scoresA.edgeStability > scoresB.edgeStability ? 'A' : 'B',
      },
      parameterSensitivity: {
        scoreA: scoresA.parameterSensitivity,
        scoreB: scoresB.parameterSensitivity,
        winner: scoresA.parameterSensitivity > scoresB.parameterSensitivity ? 'A' : 'B',
      },
      regimeRobustness: {
        scoreA: scoresA.regimeRobustness,
        scoreB: scoresB.regimeRobustness,
        winner: scoresA.regimeRobustness > scoresB.regimeRobustness ? 'A' : 'B',
      },
      drawdownProfile: {
        scoreA: scoresA.drawdownProfile,
        scoreB: scoresB.drawdownProfile,
        winner: scoresA.drawdownProfile > scoresB.drawdownProfile ? 'A' : 'B',
      },
      executionRealism: {
        scoreA: scoresA.executionRealism,
        scoreB: scoresB.executionRealism,
        winner: scoresA.executionRealism > scoresB.executionRealism ? 'A' : 'B',
      },
      complexityPenalty: {
        scoreA: scoresA.complexityPenalty,
        scoreB: scoresB.complexityPenalty,
        winner: scoresA.complexityPenalty > scoresB.complexityPenalty ? 'A' : 'B',
      },
      sampleSizeAdequacy: {
        scoreA: scoresA.sampleSizeAdequacy,
        scoreB: scoresB.sampleSizeAdequacy,
        winner: scoresA.sampleSizeAdequacy > scoresB.sampleSizeAdequacy ? 'A' : 'B',
      },
      outOfSamplePerformance: {
        scoreA: scoresA.outOfSamplePerformance,
        scoreB: scoresB.outOfSamplePerformance,
        winner: scoresA.outOfSamplePerformance > scoresB.outOfSamplePerformance ? 'A' : 'B',
      },
    };

    let recommendation = '';
    if (winMargin > 0.15) {
      recommendation = `${winner} is significantly more robust. Recommend ${winner}.`;
    } else if (winMargin > 0.05) {
      recommendation = `${winner} is moderately better. Recommend ${winner} with qualification that difference is marginal.`;
    } else {
      recommendation = `Variants are nearly equivalent in robustness. Choose based on other criteria (simplicity, capital requirements, etc.).`;
    }

    return {
      strategyA: variantA.strategy.name || 'A',
      strategyB: variantB.strategy.name || 'B',
      winner,
      winMargin,
      scoreBreakdown: breakdown,
      recommendation,
    };
  }

  /**
   * Get top N variants with explanation
   */
  topN(variants: Array<{ strategy: Strategy; backtestResults: BacktestResult }>, n: number): VariantScore[] {
    const ranked = this.rankVariants(variants);
    return ranked.slice(0, Math.min(n, ranked.length));
  }

  /**
   * Get variance analysis - how much do variants differ in each dimension?
   */
  varianceAnalysis(variants: Array<{ strategy: Strategy; backtestResults: BacktestResult }>): Record<string, { mean: number; stdDev: number; range: [number, number] }> {
    const allScores = variants.map(v => this.scoreVariant(v.strategy, v.backtestResults));

    const dimensions = [
      'edgeStability',
      'parameterSensitivity',
      'regimeRobustness',
      'drawdownProfile',
      'executionRealism',
      'complexityPenalty',
      'sampleSizeAdequacy',
      'outOfSamplePerformance',
    ] as const;

    const analysis: Record<string, { mean: number; stdDev: number; range: [number, number] }> = {};

    for (const dim of dimensions) {
      const values = allScores.map(s => s[dim]);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
      const stdDev = Math.sqrt(variance);
      const min = Math.min(...values);
      const max = Math.max(...values);

      analysis[dim] = {
        mean,
        stdDev,
        range: [min, max],
      };
    }

    return analysis;
  }

  /**
   * Consensus score - how much do all variants agree on quality?
   */
  consensusScore(variants: Array<{ strategy: Strategy; backtestResults: BacktestResult }>): number {
    if (variants.length < 2) return 1.0; // No disagreement with 1 variant

    const ranked = this.rankVariants(variants);
    const topScore = ranked[0].compositeScore;
    const bottomScore = ranked[ranked.length - 1].compositeScore;

    // Measure spread relative to mean
    const mean = ranked.reduce((sum, v) => sum + v.compositeScore, 0) / ranked.length;
    const variance = ranked.reduce((sum, v) => sum + Math.pow(v.compositeScore - mean, 2), 0) / ranked.length;
    const stdDev = Math.sqrt(variance);

    // Coefficient of variation (0 = perfect agreement, 1 = high disagreement)
    const cv = stdDev / Math.max(mean, 0.1);

    // Convert to consensus score (0-1, higher = more consensus)
    return 1 / (1 + cv);
  }
}

export default VariantRanker;

export const variantRanker = new VariantRanker();
