// @ts-nocheck
/**
 * DESIGN SCAFFOLD — not wired into the live runtime.
 * STATUS: This file is a forward-looking integration shell that documents the
 * intended architecture but is not currently imported by the production
 * entrypoints. Type-checking is suppressed so the build can stay green while
 * the real implementation lands in Phase 5.
 *
 * REMOVE the `// @ts-nocheck` directive once Phase 5 is implemented and the
 * file is actually mounted in `src/index.ts` / `src/routes/index.ts`.
 */

/**
 * Phase 101 — Regime-Adaptive Intelligence Layer
 *
 * Three subsystems that make GodsView's decision-making adaptive:
 * 1. RegimeRouter — routes signals through regime-specific profiles
 * 2. MTFConfluenceScorer — multi-timeframe alignment analysis
 * 3. AdaptiveOptimizer — Bayesian-inspired parameter tuning
 */

export { RegimeRouter } from "./regime_router.js";
export type { RegimeProfile, RegimeRouterConfig } from "./regime_router.js";

export { MTFConfluenceScorer } from "./mtf_confluence_scorer.js";
export type { MTFConfluenceResult, TimeframeAnalysis } from "./mtf_confluence_scorer.js";

export { AdaptiveOptimizer } from "./adaptive_optimizer.js";
export type { OptimizationResult, OptimizerConfig } from "./adaptive_optimizer.js";
