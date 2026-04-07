/**
 * Decision Loop Module Index
 * Re-exports all classes and convenience functions
 */

export { default as QuantDecisionPipeline } from './pipeline';
export type {
  StrategyDSL,
  RuleSet,
  Signal,
  RiskRule,
  StrategyParameter,
  StepResult,
  MemoryConsultResult,
  ParseResult,
  CritiqueResult,
  VariantResult,
  BacktestResult,
  PostBacktestAnalysis,
  RankingResult,
  ImprovementSuggestion,
  ExplainResult,
  GovernanceResult,
  MemoryLearnResult,
  FinalRecommendation,
  PipelineStep,
  PipelineState,
  DecisionLoopResult,
} from './pipeline';

export { default as AmbiguityResolver } from './ambiguity_resolver';
export type { ResolvedInterpretation, AmbiguityAnalysis } from './ambiguity_resolver';

export { default as EarlyRejector } from './early_rejector';
export type { EarlyScreenResult, AntiPattern } from './early_rejector';

export { default as CausalReasoner } from './causal_reasoner';
export type { CausalAnalysis, EdgeMechanism, NullHypothesisTest } from './causal_reasoner';

import QuantDecisionPipeline, {
  DecisionLoopResult,
  StrategyDSL,
  PipelineState,
} from './pipeline';

/**
 * Convenience function to run the full decision loop
 */
export async function runDecisionLoop(
  input: string | StrategyDSL,
  memory_db?: any,
  backtest_engine?: any,
  governance_rules?: any,
  explain_engine?: any
): Promise<DecisionLoopResult> {
  const pipeline = new QuantDecisionPipeline(
    memory_db,
    backtest_engine,
    governance_rules,
    explain_engine
  );

  return pipeline.runFull(input);
}

/**
 * Convenience function to run decision loop up to a specific step
 */
export async function runDecisionLoopTo(
  input: string | StrategyDSL,
  stepName: string,
  memory_db?: any,
  backtest_engine?: any,
  governance_rules?: any,
  explain_engine?: any
): Promise<DecisionLoopResult> {
  const pipeline = new QuantDecisionPipeline(
    memory_db,
    backtest_engine,
    governance_rules,
    explain_engine
  );

  return pipeline.runTo(input, stepName as any);
}

/**
 * Convenience function to resume a checkpoint
 */
export async function resumeDecisionLoop(
  savedState: PipelineState,
  fromStep: string,
  memory_db?: any,
  backtest_engine?: any,
  governance_rules?: any,
  explain_engine?: any
): Promise<DecisionLoopResult> {
  const pipeline = new QuantDecisionPipeline(
    memory_db,
    backtest_engine,
    governance_rules,
    explain_engine
  );

  return pipeline.resume(savedState, fromStep as any);
}

export default QuantDecisionPipeline;
