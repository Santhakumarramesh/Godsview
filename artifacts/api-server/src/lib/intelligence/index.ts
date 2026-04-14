/**
 * Phase 101 — Regime-Adaptive Intelligence Layer
 *
 * Three subsystems that make GodsView's decision-making adaptive:
 * 1. RegimeRouter — routes signals through regime-specific profiles
 * 2. MTFConfluenceScorer — multi-timeframe alignment analysis
 * 3. AdaptiveOptimizer — Bayesian-inspired parameter tuning
 */

export { RegimeRouter } from "./regime_router.js";
export type { RegimeProfile } from "./regime_router.js";

export { MTFConfluenceScorer } from "./mtf_confluence_scorer.js";
export type {
  MTFConfluenceScore,
  MTFConfluenceScore as MTFConfluenceResult,
  TimeframeBreakdown,
  TimeframeBreakdown as TimeframeAnalysis,
} from "./mtf_confluence_scorer.js";

export { AdaptiveOptimizer } from "./adaptive_optimizer.js";
export type {
  OptimizationState,
  OptimizationState as OptimizationResult,
} from "./adaptive_optimizer.js";
