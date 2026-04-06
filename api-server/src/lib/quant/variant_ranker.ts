/**
 * variant_ranker.ts — GodsView Quant Reasoning: Strategy Robustness Ranking
 *
 * Score strategy variants across multiple robustness dimensions.
 * Real quant work: rank by robustness, not just PnL.
 *
 * Key responsibilities:
 * - Score robustness across 8+ independent dimensions
 * - Rank variants by composite quality score
 * - Compare strategies fairly (PnL-adjusted robustness)
 * - Identify fragile vs resilient approaches
 */

export interface StrategyMetrics {
  sharpe: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  totalTrades: number;
  monthlyConsistency: number;
  inSampleVsOutSampleDecay: number; // gap between in/out performance
  parameterSensitivity: number; // 0-1: how much does PnL degrade with param changes
  regimeConsistency: number; // 0-1: % of regimes where strategy works
  recoveryFactor: number;
  complexityRank: number; // 1-10: complexity (higher = more fragile)
}

export interface RobustnessScore {
  overall: number; // 0-100
  parameterStability: number; // how sensitive to parameter changes
  regimeAdaptability: number; // works across regimes
  outOfSampleDecay: number; // in-sample vs out-of-sample gap (0 = no decay)
  drawdownBehavior: number; // recovery speed, max DD
  consistencyScore: number; // Sharpe consistency across periods
  complexityPenalty: number; // simpler = more robust
  sampleSize: number; // enough trades? (0-100)
  edgeDurability: number; // expected longevity of edge
  backtestTrust: number; // 0-100: trust this backtest
  liveReadiness: number; // 0-100: ready for live trading
  explanation: string[];
  warnings: string[];
}

export interface RankedVariant {
  strategy: any;
  results: any;
  robustness: RobustnessScore;
  rank: number;
  recommendedCapitalAllocation: number; // % of capital
  reason: string;
}

export interface ComparisonResult {
  strategyA: { name: string; score: number };
  strategyB: { name: string; score: number };
  winner: "A" | "B" | "tie";
  difference: number;
  reasoning: string[];
}

class VariantRanker {
  /**
   * Score a strategy across multiple robustness dimensions
   */
  scoreRobustness(strategy: any, backtestResults: any): RobustnessScore {
    const metrics: StrategyMetrics = {
      sharpe: backtestResults.sharpe || 0,
      winRate: backtestResults.winRate || 0.5,
      profitFactor: backtestResults.profitFactor || 1.0,
      maxDrawdown: backtestResults.maxDrawdown || 0.3,
      totalTrades: backtestResults.totalTrades || 0,
      monthlyConsistency: backtestResults.monthlyConsistency || 0.5,
      inSampleVsOutSampleDecay: backtestResults.outOfSampleDecay || 0.2,
      parameterSensitivity: this.estimateParameterSensitivity(strategy, backtestResults),
      regimeConsistency: this.estimateRegimeConsistency(strategy, backtestResults),
      recoveryFactor: backtestResults.recoveryFactor || 0,
      complexityRank: this.estimateComplexity(strategy),
    };

    const explanation: string[] = [];
    const warnings: string[] = [];

    // ── Dimension 1: Parameter Stability ──────────────────────────────────────
    const parameterStability = this.scoreParameterStability(metrics, explanation);

    // ── Dimension 2: Regime Adaptability ──────────────────────────────────────
    const regimeAdaptability = this.scoreRegimeAdaptability(metrics, explanation);

    // ── Dimension 3: Out-of-Sample Decay ─────────────────────────────────────
    const outOfSampleDecay = Math.max(0, 100 - metrics.inSampleVsOutSampleDecay * 300);

    // ── Dimension 4: Drawdown Behavior ───────────────────────────────────────
    const drawdownBehavior = this.scoreDrawdownBehavior(metrics, explanation, warnings);

    // ── Dimension 5: Consistency Score ───────────────────────────────────────
    const consistencyScore = this.scoreConsistency(metrics, explanation);

    // ── Dimension 6: Complexity Penalty ──────────────────────────────────────
    const complexityPenalty = this.scoreComplexityPenalty(metrics, explanation, warnings);

    // ── Dimension 7: Sample Size ────────────────────────────────────────────
    const sampleSize = this.scoreSampleSize(metrics, explanation, warnings);

    // ── Dimension 8: Edge Durability ────────────────────────────────────────
    const edgeDurability = this.scoreEdgeDurability(metrics, explanation);

    // ── Backtest Trust Score ──────────────────────────────────────────────────
    const backtestTrust = this.scoreBacktestTrust(metrics, explanation, warnings);

    // ── Live Readiness ──────────────────────────────────────────────────────
    const liveReadiness = this.scoreLiveReadiness(metrics, warnings);

    // ── Composite Score ─────────────────────────────────────────────────────
    const overall = this.computeCompositeScore({
      parameterStability,
      regimeAdaptability,
      outOfSampleDecay,
      drawdownBehavior,
      consistencyScore,
      complexityPenalty,
      sampleSize,
      edgeDurability,
      backtestTrust,
      liveReadiness,
    });

    return {
      overall,
      parameterStability,
      regimeAdaptability,
      outOfSampleDecay,
      drawdownBehavior,
      consistencyScore,
      complexityPenalty,
      sampleSize,
      edgeDurability,
      backtestTrust,
      liveReadiness,
      explanation,
      warnings,
    };
  }

  /**
   * Rank multiple strategy variants
   */
  rankByRobustness(variants: { strategy: any; results: any }[]): RankedVariant[] {
    const ranked = variants
      .map((v) => ({
        strategy: v.strategy,
        results: v.results,
        robustness: this.scoreRobustness(v.strategy, v.results),
        rank: 0,
        recommendedCapitalAllocation: 0,
        reason: "",
      }))
      .sort((a, b) => b.robustness.overall - a.robustness.overall)
      .map((v, idx) => {
        const allocation = this.allocateCapital(idx, variants.length, v.robustness.overall);
        return {
          ...v,
          rank: idx,
          recommendedCapitalAllocation: allocation,
          reason: this.generateReason(v.robustness, idx, variants.length),
        };
      });

    return ranked;
  }

  /**
   * Compute composite quality score
   */
  computeQualityScore(metrics: StrategyMetrics): number {
    // Simple quality score: Sharpe / MaxDD ratio
    const riskAdjusted = metrics.sharpe / Math.max(metrics.maxDrawdown, 0.1);
    const winRateScore = (metrics.winRate - 0.5) * 100; // 0-50 scale
    const consistency = metrics.monthlyConsistency * 100; // 0-100

    return riskAdjusted * 20 + winRateScore * 0.5 + consistency * 0.3;
  }

  /**
   * Compare robustness of two strategies
   */
  compareRobustness(a: any, b: any): ComparisonResult {
    const scoreA = this.scoreRobustness(a.strategy, a.results);
    const scoreB = this.scoreRobustness(b.strategy, b.results);

    const reasoning: string[] = [];

    // Compare each dimension
    if (scoreA.parameterStability > scoreB.parameterStability + 5) {
      reasoning.push(`Strategy A is more parameter-stable (${scoreA.parameterStability.toFixed(0)} vs ${scoreB.parameterStability.toFixed(0)})`);
    }

    if (scoreA.regimeAdaptability > scoreB.regimeAdaptability + 5) {
      reasoning.push(`Strategy A adapts better across regimes (${scoreA.regimeAdaptability.toFixed(0)} vs ${scoreB.regimeAdaptability.toFixed(0)})`);
    }