/**
 * strategy_compiler/index.ts — Barrel export for Strategy Compiler
 *
 * Exports the strategy compiler and all related types for Phase 32.
 */

// ── DSL Types ────────────────────────────────────────────────────────────

export type {
  EntryCondition,
  ExitCondition,
  TimeFilter,
  VolatilityFilter,
  PositionSizing,
  StrategyDSL,
  DSLValidationResult,
} from "./dsl_types";

// ── Compiler ─────────────────────────────────────────────────────────────

export {
  strategyCompiler,
  type CompilationStage,
  type CompilationError,
  type ExecutionPlan,
  type CompilationResult,
} from "./compiler";
