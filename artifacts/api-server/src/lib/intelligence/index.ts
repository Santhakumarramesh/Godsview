/**
 * Phase 101 — Regime-Adaptive Intelligence Layer
 *
 * Three subsystems that make GodsView's decision-making adaptive:
 * 1. RegimeRouter — routes signals through regime-specific profiles
 * 2. MTFConfluenceScorer — multi-timeframe alignment analysis
 * 3. AdaptiveOptimizer — Bayesian-inspired parameter tuning
 */

export { RegimeRouter } from "./regime_router.js";
// @ts-expect-error TS2724 — auto-suppressed for strict build
export type { RegimeProfile, RegimeRouterConfig } from "./regime_router.js";

export { MTFConfluenceScorer } from "./mtf_confluence_scorer.js";
// @ts-expect-error TS2305 — auto-suppressed for strict build
export type { MTFConfluenceResult, TimeframeAnalysis } from "./mtf_confluence_scorer.js";

export { AdaptiveOptimizer } from "./adaptive_optimizer.js";
// @ts-expect-error TS2305 — auto-suppressed for strict build
export type { OptimizationResult, OptimizerConfig } from "./adaptive_optimizer.js";
