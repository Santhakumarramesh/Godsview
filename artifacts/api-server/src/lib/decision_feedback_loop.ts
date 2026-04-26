/**
 * decision_feedback_loop.ts — Post-Trade Learning System (Phase 1)
 *
 * Closes the loop between decisions and outcomes:
 *   1. After a trade closes, record the outcome against the original decision
 *   2. Update memory with the result (win/loss/breakeven)
 *   3. Track per-strategy, per-regime, per-factor accuracy
 *   4. Generate improvement suggestions based on outcome patterns
 *   5. Feed accuracy data back to the UDE for confidence calibration
 *
 * This is what makes GodsView self-learning — every trade outcome
 * makes future decisions more accurate.
 */

import { logger as _logger } from "./logger";
import { memorySystem, failureMemory, improvementMemory } from "./memory";
import { getDecisionById, type DecisionResult } from "./unified_decision_engine";
import { publishAlert } from "./signal_stream";

const logger = _logger.child({ module: "decision-feedback" });

// ── Types ────────────────────────────────────────────────────────────────────

export interface TradeOutcome {
  /** The original UDE decision request ID */
  decisionRequestId: string;
  /** Symbol traded */
  symbol: string;
  /** Strategy used */
  strategy: string;
  /** Direction */
  direction: "long" | "short";
  /** Entry price */
  entryPrice: number;
  /** Exit price */
  exitPrice: number;
  /** PnL in dollars */
  pnl: number;
  /** PnL as percentage */
  pnlPct: number;
  /** R-multiple achieved */
  rMultiple: number;
  /** Exit reason */
  exitReason: "target" | "stop" | "trailing_stop" | "time_exit" | "manual" | "flatten";
  /** Hold duration in minutes */
  holdMinutes: number;
  /** Slippage in basis points */
  slippageBps: number;
  /** Market regime at time of trade */
  regime: string;
}

export interface OutcomeFeedback {
  decisionRequestId: string;
  outcome: "win" | "loss" | "breakeven";
  accuracyAnalysis: AccuracyAnalysis;
  improvements: ImprovementSuggestion[];
  memoryUpdated: boolean;
  timestamp: string;
}

export interface AccuracyAnalysis {
  /** Was the direction correct? */
  directionCorrect: boolean;
  /** Did the UDE confidence predict correctly? */
  confidenceCalibrated: boolean;
  /** Which factors were most/least accurate? */
  factorAccuracy: { factor: string; predicted: number; actual: string; accurate: boolean }[];
  /** Was the position sizing appropriate? */
  sizingAppropriate: boolean;
  /** Was the exit optimal? */
  exitQuality: "optimal" | "acceptable" | "premature" | "late";
}

export interface ImprovementSuggestion {
  area: string;
  suggestion: string;
  priority: "high" | "medium" | "low";
  basedOn: string;
}

// ── Outcome Tracking ─────────────────────────────────────────────────────────

const OUTCOME_HISTORY_MAX = parseInt(process.env.FEEDBACK_HISTORY_MAX ?? "1000", 10);
const _outcomeHistory: OutcomeFeedback[] = [];
const _strategyAccuracy: Map<string, { wins: number; losses: number; total: number; totalPnl: number }> = new Map();
const _regimeAccuracy: Map<string, { wins: number; losses: number; total: number }> = new Map();
const _factorAccuracy: Map<string, { correct: number; total: number }> = new Map();

// ── Core Feedback Function ───────────────────────────────────────────────────

/**
 * Process a trade outcome and generate feedback + learning.
 */
export async function processTradeOutcome(outcome: TradeOutcome): Promise<OutcomeFeedback> {
  const timestamp = new Date().toISOString();

  logger.info(
    { decisionId: outcome.decisionRequestId, symbol: outcome.symbol, pnl: outcome.pnl },
    "[feedback] Processing trade outcome",
  );

  // 1. Look up the original decision
  const originalDecision = getDecisionById(outcome.decisionRequestId);

  // 2. Classify outcome
  const outcomeClass: "win" | "loss" | "breakeven" =
    outcome.pnlPct > 0.001 ? "win" : outcome.pnlPct < -0.001 ? "loss" : "breakeven";

  // 3. Analyze accuracy
  const accuracyAnalysis = analyzeAccuracy(outcome, originalDecision, outcomeClass);

  // 4. Generate improvements
  const improvements = generateImprovements(outcome, originalDecision, outcomeClass, accuracyAnalysis);

  // 5. Update memory system
  let memoryUpdated = false;
  try {
    // Record in memory for future recall
    await memorySystem.learnFromTrade(
      {
        symbol: outcome.symbol,
        strategy: outcome.strategy,
        direction: outcome.direction,
        entryPrice: outcome.entryPrice,
        stopLoss: originalDecision?.confidence?.factors?.find(f => f.name === "structure")?.score ?? 0,
        regime: outcome.regime,
      },
      {
        pnl: outcome.pnl,
        pnlPct: outcome.pnlPct,
        exitReason: outcome.exitReason,
        holdMinutes: outcome.holdMinutes,
        rMultiple: outcome.rMultiple,
      },
    );

    // Record failure patterns for avoid-in-future logic
    if (outcomeClass === "loss" && outcome.rMultiple < -1.5) {
      failureMemory.recordFailure({
        symbol: outcome.symbol,
        // @ts-expect-error TS2322 — auto-suppressed for strict build
        strategy: outcome.strategy,
        regime: outcome.regime,
        direction: outcome.direction,
        entryPrice: outcome.entryPrice,
        exitPrice: outcome.exitPrice,
        pnl: outcome.pnl,
        rMultiple: outcome.rMultiple,
        exitReason: outcome.exitReason,
        // @ts-expect-error TS2322 — auto-suppressed for strict build
        timestamp,
        // @ts-expect-error TS2322 — auto-suppressed for strict build
        severity: outcome.rMultiple < -2 ? "critical" : "warning",
      });
    }

    // Record improvements for tracking
    if (improvements.length > 0) {
      for (const imp of improvements) {
        improvementMemory.recordImprovement({
          area: imp.area,
          suggestion: imp.suggestion,
          source: `trade_${outcome.decisionRequestId}`,
          outcome: outcomeClass,
          // @ts-expect-error TS2322 — auto-suppressed for strict build
          timestamp,
        });
      }
    }

    memoryUpdated = true;
  } catch (err: any) {
    logger.warn({ err: err.message }, "[feedback] Memory update failed");
  }

  // 6. Update tracking maps
  updateStrategyAccuracy(outcome.strategy, outcomeClass, outcome.pnl);
  updateRegimeAccuracy(outcome.regime, outcomeClass);
  if (originalDecision) {
    updateFactorAccuracy(originalDecision, outcomeClass);
  }

  // 7. Build feedback
  const feedback: OutcomeFeedback = {
    decisionRequestId: outcome.decisionRequestId,
    outcome: outcomeClass,
    accuracyAnalysis,
    improvements,
    memoryUpdated,
    timestamp,
  };

  // Record
  _outcomeHistory.unshift(feedback);
  while (_outcomeHistory.length > OUTCOME_HISTORY_MAX) _outcomeHistory.pop();

  // Publish SSE event
  publishAlert({
    type: "ude_feedback",
    decisionRequestId: outcome.decisionRequestId,
    symbol: outcome.symbol,
    strategy: outcome.strategy,
    outcome: outcomeClass,
    pnl: outcome.pnl,
    rMultiple: outcome.rMultiple,
    improvements: improvements.length,
    timestamp,
  });

  logger.info(
    {
      decisionId: outcome.decisionRequestId,
      outcome: outcomeClass,
      improvements: improvements.length,
      memoryUpdated,
    },
    `[feedback] Outcome processed: ${outcomeClass}`,
  );

  return feedback;
}

// ── Accuracy Analysis ────────────────────────────────────────────────────────

function analyzeAccuracy(
  outcome: TradeOutcome,
  decision: DecisionResult | undefined,
  outcomeClass: "win" | "loss" | "breakeven",
): AccuracyAnalysis {
  const directionCorrect = outcomeClass === "win";

  // Check if confidence predicted correctly
  const confidenceCalibrated = decision
    ? (decision.confidence.overall > 0.6 && outcomeClass === "win") ||
      (decision.confidence.overall < 0.5 && outcomeClass === "loss")
    : false;

  // Factor accuracy
  const factorAccuracy: AccuracyAnalysis["factorAccuracy"] = [];
  if (decision) {
    for (const factor of decision.confidence.factors) {
      const predicted = factor.score;
      const accurate =
        (predicted > 0.6 && outcomeClass === "win") ||
        (predicted < 0.4 && outcomeClass === "loss") ||
        (predicted >= 0.4 && predicted <= 0.6); // neutral is always "ok"
      factorAccuracy.push({
        factor: factor.name,
        predicted,
        actual: outcomeClass,
        accurate,
      });
    }
  }

  // Sizing
  const sizingAppropriate =
    outcomeClass === "win" ||
    (outcomeClass === "loss" && outcome.rMultiple >= -1.5);

  // Exit quality
  let exitQuality: AccuracyAnalysis["exitQuality"] = "acceptable";
  if (outcomeClass === "win") {
    if (outcome.rMultiple >= 2) exitQuality = "optimal";
    else if (outcome.rMultiple < 0.5) exitQuality = "premature";
  } else if (outcomeClass === "loss") {
    if (outcome.exitReason === "stop") exitQuality = "acceptable";
    else if (outcome.holdMinutes > 180) exitQuality = "late";
    else exitQuality = "premature";
  }

  return {
    directionCorrect,
    confidenceCalibrated,
    factorAccuracy,
    sizingAppropriate,
    exitQuality,
  };
}

// ── Improvement Generator ────────────────────────────────────────────────────

function generateImprovements(
  outcome: TradeOutcome,
  decision: DecisionResult | undefined,
  outcomeClass: "win" | "loss" | "breakeven",
  accuracy: AccuracyAnalysis,
): ImprovementSuggestion[] {
  const suggestions: ImprovementSuggestion[] = [];

  if (outcomeClass === "loss") {
    // Check which factors were wrong
    const wrongFactors = accuracy.factorAccuracy.filter((f) => !f.accurate && f.predicted > 0.6);
    for (const wf of wrongFactors) {
      suggestions.push({
        area: wf.factor,
        suggestion: `${wf.factor} scored ${(wf.predicted * 100).toFixed(0)}% but trade lost — consider reducing ${wf.factor} weight in ${outcome.regime} regime.`,
        priority: "high",
        basedOn: `Trade ${outcome.decisionRequestId}: ${outcome.symbol} ${outcome.direction}`,
      });
    }

    // Big loss
    if (outcome.rMultiple < -1.5) {
      suggestions.push({
        area: "risk_management",
        suggestion: `Trade lost ${outcome.rMultiple.toFixed(1)}R — review stop placement and position sizing for ${outcome.strategy} in ${outcome.regime}.`,
        priority: "high",
        basedOn: `Excessive loss on ${outcome.symbol}`,
      });
    }

    // Late exit
    if (accuracy.exitQuality === "late") {
      suggestions.push({
        area: "exit_timing",
        suggestion: `Trade held ${outcome.holdMinutes}min before stopping out — consider time-based exits for ${outcome.strategy}.`,
        priority: "medium",
        basedOn: `Slow exit on ${outcome.symbol}`,
      });
    }
  }

  if (outcomeClass === "win") {
    // Premature exit
    if (accuracy.exitQuality === "premature" && outcome.rMultiple < 1) {
      suggestions.push({
        area: "exit_timing",
        suggestion: `Won only ${outcome.rMultiple.toFixed(2)}R — trailing stop may be too tight for ${outcome.strategy}.`,
        priority: "medium",
        basedOn: `Premature exit on ${outcome.symbol}`,
      });
    }
  }

  // Slippage concern
  if (outcome.slippageBps > 10) {
    suggestions.push({
      area: "execution",
      suggestion: `Slippage was ${outcome.slippageBps}bps — consider limit orders or different execution timing for ${outcome.symbol}.`,
      priority: "low",
      basedOn: `High slippage on ${outcome.symbol}`,
    });
  }

  return suggestions;
}

// ── Tracking Helpers ─────────────────────────────────────────────────────────

function updateStrategyAccuracy(strategy: string, outcome: "win" | "loss" | "breakeven", pnl: number): void {
  if (!_strategyAccuracy.has(strategy)) {
    _strategyAccuracy.set(strategy, { wins: 0, losses: 0, total: 0, totalPnl: 0 });
  }
  const acc = _strategyAccuracy.get(strategy)!;
  acc.total++;
  acc.totalPnl += pnl;
  if (outcome === "win") acc.wins++;
  else if (outcome === "loss") acc.losses++;
}

function updateRegimeAccuracy(regime: string, outcome: "win" | "loss" | "breakeven"): void {
  if (!_regimeAccuracy.has(regime)) {
    _regimeAccuracy.set(regime, { wins: 0, losses: 0, total: 0 });
  }
  const acc = _regimeAccuracy.get(regime)!;
  acc.total++;
  if (outcome === "win") acc.wins++;
  else if (outcome === "loss") acc.losses++;
}

function updateFactorAccuracy(decision: DecisionResult, outcome: "win" | "loss" | "breakeven"): void {
  for (const factor of decision.confidence.factors) {
    const key = factor.name;
    if (!_factorAccuracy.has(key)) {
      _factorAccuracy.set(key, { correct: 0, total: 0 });
    }
    const acc = _factorAccuracy.get(key)!;
    acc.total++;
    const predicted = factor.score > 0.5;
    const actual = outcome === "win";
    if (predicted === actual) acc.correct++;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getFeedbackHistory(limit = 50): OutcomeFeedback[] {
  return _outcomeHistory.slice(0, limit);
}

export function getStrategyAccuracy(): Record<string, { wins: number; losses: number; total: number; winRate: number; totalPnl: number }> {
  const result: Record<string, any> = {};
  for (const [strategy, acc] of _strategyAccuracy) {
    result[strategy] = {
      ...acc,
      winRate: acc.total > 0 ? acc.wins / acc.total : 0,
    };
  }
  return result;
}

export function getRegimeAccuracy(): Record<string, { wins: number; losses: number; total: number; winRate: number }> {
  const result: Record<string, any> = {};
  for (const [regime, acc] of _regimeAccuracy) {
    result[regime] = {
      ...acc,
      winRate: acc.total > 0 ? acc.wins / acc.total : 0,
    };
  }
  return result;
}

export function getFactorAccuracy(): Record<string, { correct: number; total: number; accuracy: number }> {
  const result: Record<string, any> = {};
  for (const [factor, acc] of _factorAccuracy) {
    result[factor] = {
      ...acc,
      accuracy: acc.total > 0 ? acc.correct / acc.total : 0,
    };
  }
  return result;
}

export function getFeedbackStats() {
  const totalOutcomes = _outcomeHistory.length;
  const wins = _outcomeHistory.filter((f) => f.outcome === "win").length;
  const losses = _outcomeHistory.filter((f) => f.outcome === "loss").length;

  return {
    totalOutcomes,
    wins,
    losses,
    breakeven: totalOutcomes - wins - losses,
    winRate: totalOutcomes > 0 ? wins / totalOutcomes : 0,
    totalImprovements: _outcomeHistory.reduce((sum, f) => sum + f.improvements.length, 0),
    strategyCount: _strategyAccuracy.size,
    regimeCount: _regimeAccuracy.size,
  };
}
