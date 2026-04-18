/**
 * Evaluation Layer Exports
 * Phase 88: Hard Evidence for GodsView Decision Loop
 */

export {
  type GoldenTestCase,
  type Difficulty,
  type Verdict,
  type EdgeMechanism,
  GOLDEN_STRATEGIES,
  getGoldenStrategyById,
  getGoldenStrategiesByDifficulty,
  getGoldenStrategiesByTag,
  getGoldenStrategiesStats
} from './golden_strategies';

export {
  DecisionLoopEvalHarness,
  type AmbiguityMetrics,
  type RejectionMetrics,
  type CritiqueMetrics,
  type VariantMetrics,
  type CausalMetrics,
  type ExplainMetrics,
  type RecommendationMetrics,
  type FullMetrics,
  type SingleTestResult,
  type EvalReport
} from './eval_harness';

export {
  BaselineComparison,
  type BaselineType,
  type BaselineResult,
  type HeadToHeadComparison,
  type LeaderboardEntry,
  type ComparisonReport
} from './baseline_comparison';

/**
 * Convenience function: Run full benchmark suite
 * Returns: EvalReport with golden strategy results + baseline comparison
 */
export async function runFullBenchmark() {
  const { DecisionLoopEvalHarness } = await import('./eval_harness');
  const { BaselineComparison } = await import('./baseline_comparison');
  const { GOLDEN_STRATEGIES } = await import('./golden_strategies');

  // Run evaluation harness
  const harness = new DecisionLoopEvalHarness();
  const evalReport = await harness.runFullEval();

  // Run baseline comparison
  const comparison = new BaselineComparison();
  const comparisonReport = await comparison.runComparison(
    evalReport.testResults,
    GOLDEN_STRATEGIES
  );

  return {
    evalReport,
    comparisonReport,
    timestamp: Date.now()
  };
}

/**
 * Helper: Get latest eval results from file or cache
 */
export function getLatestEvalResults(cached?: any) {
  if (cached) {
    return cached;
  }
  return null;
}

/**
 * Helper: Compare two eval reports for regressions
 */
export function detectRegressions(previous: any, current: any) {
  const harness = new (require('./eval_harness').DecisionLoopEvalHarness)();
  return harness.regressionCheck(previous, current);
}
