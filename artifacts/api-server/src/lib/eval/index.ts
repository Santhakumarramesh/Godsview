/**
 * Evaluation Layer Exports
 * Phase 88: Hard Evidence for GodsView Decision Loop
 */

export {
  GOLDEN_STRATEGIES,
  getGoldenStrategyById,
  getGoldenStrategiesByDifficulty,
  getGoldenStrategiesByTag,
  getGoldenStrategiesStats
} from './golden_strategies';
export type {
  GoldenTestCase,
  Difficulty,
  Verdict,
  EdgeMechanism,
} from './golden_strategies';

export {
  DecisionLoopEvalHarness,
} from './eval_harness';
export type {
  AmbiguityMetrics,
  RejectionMetrics,
  CritiqueMetrics,
  VariantMetrics,
  CausalMetrics,
  ExplainMetrics,
  RecommendationMetrics,
  FullMetrics,
  SingleTestResult,
  EvalReport
} from './eval_harness';

export {
  BaselineComparison,
} from './baseline_comparison';
export type {
  BaselineType,
  BaselineResult,
  HeadToHeadComparison,
  LeaderboardEntry,
  ComparisonReport
} from './baseline_comparison';

/**
 * Convenience function: Run full benchmark suite
 * Returns: EvalReport with golden strategy results + baseline comparison
 */
export async function runFullBenchmark(): Promise<any> {
  const { DecisionLoopEvalHarness } = await import('./eval_harness');
  const { BaselineComparison } = await import('./baseline_comparison');
  const { GOLDEN_STRATEGIES } = await import('./golden_strategies');

  // Run evaluation harness
  const harness = new (DecisionLoopEvalHarness as any)();
  const evalReport = await harness.runFullEval();

  // Run baseline comparison
  const comparison = new (BaselineComparison as any)();
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
export function getLatestEvalResults(cached?: any): any {
  if (cached) {
    return cached;
  }
  return null;
}

/**
 * Helper: Compare two eval reports for regressions
 */
export function detectRegressions(previous: any, current: any): any {
  const harness = new ((require('./eval_harness') as any).DecisionLoopEvalHarness)();
  return harness.regressionCheck(previous, current);
}
