/**
 * backtest/index.ts — Backtesting & Validation Module Exports
 *
 * Complete suite of backtesting and validation tools:
 *   - Experiment tracking and management
 *   - Parameter optimization (grid search, walk-forward)
 *   - Regime-based strategy validation
 *   - Trade-level analytics (Sharpe, Sortino, Calmar)
 *   - Interactive market replay with annotations
 *
 * Production-grade analysis for quantitative strategy development.
 */

// ── Experiment Tracking ────────────────────────────────────────────────────
export {
  ExperimentTracker,
  experimentTracker,
  type BacktestExperiment,
  type ExperimentComparison,
  type StrategyParams,
} from "./experiment_tracker";

// ── Parameter Optimization ─────────────────────────────────────────────────
export {
  ParameterTuner,
  parameterTuner,
  type ParameterRange,
  type ParameterSet,
  type TuningResult,
  type WalkForwardResult,
  type SensitivityAnalysis,
} from "./parameter_tuner";

// ── Regime Validation ──────────────────────────────────────────────────────
export {
  RegimeValidator,
  regimeValidator,
  type MarketRegime,
  type RegimeSegment,
  type RegimeTransition,
  type RegimeProfile,
  type RegimeValidation,
} from "./regime_validator";

// ── Trade Analytics ───────────────────────────────────────────────────────
export {
  TradeAnalytics,
  tradeAnalytics,
  type TradeMetrics,
  type DrawdownAnalysis,
  type StreakAnalysis,
  type SegmentedWinRates,
  type TradeDistribution,
  type MonteCarloResult,
  type EquityCurveAnalysis,
} from "./trade_analytics";

// ── Replay Engine ──────────────────────────────────────────────────────────
export {
  ReplayEngine,
  createReplayEngine,
  type ReplayState,
  type ReplayControl,
  type ReplayEvent,
} from "./replay_engine";

// ── Walk-Forward Validator ───────────────────────────────────────────────────
export {
  WalkForwardValidator,
  walkForwardValidator,
  type WalkForwardConfig,
  type WFWindow,
  type WFWindowResult,
  type WalkForwardAnalysis,
} from "./walk_forward";

// ── Fill Simulator ────────────────────────────────────────────────────────────
export {
  FillSimulator,
  fillSimulator,
  type FillConfig,
  type FillResult,
} from "./fill_simulator";

// ── Quality Benchmarks ────────────────────────────────────────────────────────
export {
  QualityBenchmarks,
  qualityBenchmarks,
  type QualityThresholds,
  type RobustnessAnalysis,
  type MonteCarloAnalysis,
  type QualityReport,
} from "./quality_benchmarks";

// ── Sensitivity Analysis ───────────────────────────────────────────────────────
export {
  SensitivityAnalyzer,
  sensitivityAnalyzer,
  type SweepConfig,
  type SweepResult,
  type OverfitReport,
  type MonteCarloResult,
  type RegimeSplitResult,
  type RollingResult,
  type ConfidenceInterval,
} from "./sensitivity_analyzer";

// ── Portfolio Backtester ────────────────────────────────────────────────────────
export {
  PortfolioBacktester,
  portfolioBacktester,
  type StrategyResult,
  type PortfolioConfig,
  type PortfolioResult,
  type WeightResult,
  type StressScenario,
  type StressResult,
} from "./portfolio_backtester";

// ── Validation Engine ──────────────────────────────────────────────────────────
export {
  BacktestValidator,
  backestValidator,
  type BiasCheck,
  type DataQualityReport,
  type SignificanceReport,
  type StabilityReport,
  type RecoveryReport,
  type ConsistencyReport,
  type ValidationReport,
} from "./validation_engine";

// ── Orchestrator ───────────────────────────────────────────────────────────────
export {
  BacktestOrchestrator,
  backtestOrchestrator,
  type EnhancedBacktestConfig,
  type EnhancedBacktestResult,
} from "./orchestrator";

/**
 * Complete backtest analysis workflow example:
 *
 * ```typescript
 * import {
 *   experimentTracker,
 *   parameterTuner,
 *   regimeValidator,
 *   tradeAnalytics,
 *   createReplayEngine,
 * } from "@/lib/backtest";
 *
 * // 1. Track an experiment
 * const exp = experimentTracker.createExperiment(
 *   "SMC-Breakout",
 *   { entrySensitivity: 0.8, tpMultiplier: 2.5 },
 *   { start: "2023-01-01", end: "2023-12-31" },
 *   ["EURUSD", "GBPUSD"],
 *   "1m",
 * );
 * experimentTracker.tagExperiment(exp.experimentId, ["baseline", "production"]);
 *
 * // 2. Run backtest and add metrics
 * const metrics = await runBacktest(...);
 * experimentTracker.addMetrics(exp.experimentId, metrics);
 *
 * // 3. Analyze trade-level performance
 * const analytics = tradeAnalytics.computeTradeMetrics(trades);
 * const drawdowns = tradeAnalytics.analyzeDrawdowns(trades);
 * const streaks = tradeAnalytics.analyzeStreaks(trades);
 * const distribution = tradeAnalytics.analyzeTradeDistribution(trades);
 *
 * // 4. Validate by market regime
 * const validation = regimeValidator.validateStrategy(trades);
 * if (validation.bias.hasBias) {
 *   console.warn("Strategy has regime bias:", validation.bias.description);
 * }
 *
 * // 5. Run Monte Carlo for confidence intervals
 * const mc = tradeAnalytics.monteCarloSimulation(trades, 1000);
 * console.log("95% CI for final equity:", mc.confidence95Low, mc.confidence95High);
 *
 * // 6. Optimize parameters with walk-forward testing
 * const paramRanges = [
 *   { name: "entrySensitivity", min: 0.5, max: 1.0, step: 0.1 },
 *   { name: "tpMultiplier", min: 2.0, max: 3.0, step: 0.25 },
 * ];
 * const grid = paramTuner.generateGrid(paramRanges);
 * // ... test all combinations ...
 * const ranked = paramTuner.rankParameterSets(results, "sharpe");
 * const wf = paramTuner.walkForwardOptimization(timestampedResults, 60, 20);
 *
 * // 7. Replay trades for manual verification
 * const replay = createReplayEngine(bars, confirmations, outcomes);
 * replay.play();
 * while (replay.getControl().playing) {
 *   const events = replay.advancePlayback();
 *   // Handle events in UI...
 * }
 *
 * // 8. Compare experiments
 * const comparison = experimentTracker.compareExperiments([exp1.experimentId, exp2.experimentId]);
 * console.log("Parameter diff:", comparison.parameterDiff);
 * console.log("Metric comparison:", comparison.metricComparison);
 *
 * // 9. Get best experiment
 * const best = experimentTracker.getBestExperiment("SMC-Breakout", "sharpeRatio");
 * ```
 */
