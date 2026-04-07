/**
 * Phase 94 — Backtesting Engine
 *
 * Complete backtesting infrastructure with replay, metrics, and validation.
 */

export { ReplayEngine } from "./replay_engine.js";
export type {
  ReplayBar, ReplayTick, ReplayOrder, ReplayPosition,
  ReplayConfig, ReplayState, StrategyCallback,
} from "./replay_engine.js";

export { calculateMetrics } from "./metrics_calculator.js";
export type { BacktestMetrics } from "./metrics_calculator.js";

export { WalkForwardValidator } from "./walk_forward_validator.js";
export type { WalkForwardConfig, WalkForwardWindow, WalkForwardResult } from "./walk_forward_validator.js";
