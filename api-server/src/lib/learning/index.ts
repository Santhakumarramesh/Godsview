/**
 * Phase 95 — Learning System
 *
 * Self-improving intelligence that learns from every trade.
 */

export { TradeFeedbackLoop } from "./trade_feedback_loop.js";
export type {
  TradeOutcomeInput, TradeLessonExtracted, ParameterAdjustment,
  FeedbackResult, MemoryEntry,
} from "./trade_feedback_loop.js";

export { ExperimentTracker } from "./experiment_tracker.js";
export type {
  ExperimentRun, ExperimentArtifact, Experiment,
  ComparisonResult,
} from "./experiment_tracker.js";

export { FeatureImportanceAnalyzer } from "./feature_importance.js";
export type {
  FeatureVector, FeatureImportanceResult, FeatureInteraction,
  FeatureAnalysis,
} from "./feature_importance.js";

export { StrategyReinforcementEngine } from "./strategy_reinforcement.js";
export type {
  StrategyState, TradeResult, LifetimeStats, RegimeStats,
  TierTransition, ReinforcementConfig,
} from "./strategy_reinforcement.js";
