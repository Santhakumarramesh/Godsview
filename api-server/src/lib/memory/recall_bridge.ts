/**
 * Recall Bridge — Integrates memory recall into live trading decisions.
 *
 * This module connects the Memory System to the Pre-Trade Guard,
 * ensuring every trade decision is informed by historical experience.
 *
 * Flow:
 * 1. Signal generated → recall bridge consulted
 * 2. Memory system checks: similar setups, failure patterns, context
 * 3. Recall produces a MemoryRecallResult
 * 4. Result informs position sizing, confidence, and go/no-go
 * 5. Post-trade: outcome fed back to memory for learning
 *
 * Key behaviors:
 * - "avoid" recommendation → trade is BLOCKED (hard gate)
 * - "caution" recommendation → position size reduced by 50%
 * - Similar failure patterns → surfaced to operator
 * - Low historical win rate for context → confidence penalty
 */
import { logger } from "../logger.js";
import { memorySystem, type MemoryAdvice } from "./index.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface RecallInput {
  symbol: string;
  strategy: string;
  direction: "long" | "short";
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  regime: string;
  volatility: number;
  session: string;
  timeframe: string;
}

export interface MemoryRecallResult {
  consulted: boolean;
  timestamp: string;
  advice: MemoryAdvice | null;

  // Actionable outputs
  tradeAllowed: boolean;
  positionSizeMultiplier: number; // 0.0 to 1.0 (1.0 = full size)
  confidenceAdjustment: number;  // -1.0 to +1.0
  warnings: string[];
  reasoning: string[];

  // Metrics from memory
  similarSetupCount: number;
  historicalWinRate: number;
  failurePatternCount: number;
}

export interface PostTradeRecord {
  symbol: string;
  strategy: string;
  direction: "long" | "short";
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pnlPct: number;
  exitReason: string;
  regime: string;
  session: string;
  holdBars: number;
}

// ── Thresholds ───────────────────────────────────────────────────────────────

const RECALL_THRESHOLDS = {
  minSimilarSetups: 3,             // need at least 3 to make judgments
  lowWinRateThreshold: 0.35,       // below this → caution
  veryLowWinRateThreshold: 0.20,   // below this → avoid
  criticalFailureCount: 3,         // if 3+ critical failures matched → avoid
  cautionFailureCount: 1,          // if 1+ failures matched → caution
  cautionSizeMultiplier: 0.5,      // reduce position by 50% on caution
  highWinRateBonus: 0.1,           // confidence boost for >70% win rate
  lowWinRatePenalty: -0.15,        // confidence penalty for <40% win rate
} as const;

// ── Core Functions ───────────────────────────────────────────────────────────

/**
 * Consult memory before executing a trade.
 * Returns recall result with go/no-go decision and sizing adjustments.
 */
export async function recallBeforeTrade(input: RecallInput): Promise<MemoryRecallResult> {
  const timestamp = new Date().toISOString();
  const warnings: string[] = [];
  const reasoning: string[] = [];

  try {
    const setup = {
      name: input.strategy,
      type: input.strategy,
      params: {
        direction: input.direction,
        entry: input.entryPrice,
        sl: input.stopLoss,
        tp: input.takeProfit,
      },
    };

    const marketState = {
      regime: input.regime,
      session: input.session,
      volatility: input.volatility,
      symbol: input.symbol,
      timeframe: input.timeframe,
    };

    const advice = await memorySystem.consultMemory(
      { strategy: setup, context: marketState },
      marketState,
    );

    // Process advice into actionable outputs
    let tradeAllowed = true;
    let positionSizeMultiplier = 1.0;
    let confidenceAdjustment = 0;

    // 1. Check recommendation
    if (advice.recommendation === "avoid") {
      tradeAllowed = false;
      positionSizeMultiplier = 0;
      reasoning.push("Memory system recommends AVOID — blocking trade");
    } else if (advice.recommendation === "caution") {
      positionSizeMultiplier = RECALL_THRESHOLDS.cautionSizeMultiplier;
      reasoning.push(`Memory system recommends CAUTION — reducing position to ${(positionSizeMultiplier * 100).toFixed(0)}%`);
    }

    // 2. Check failure warnings
    const criticalWarnings = advice.failureWarnings.filter(w => w.includes("critical"));
    const allWarnings = advice.failureWarnings;

    if (criticalWarnings.length >= RECALL_THRESHOLDS.criticalFailureCount) {
      tradeAllowed = false;
      positionSizeMultiplier = 0;
      warnings.push(`${criticalWarnings.length} critical failure patterns matched — trade blocked`);
      reasoning.push("Too many critical failure patterns match current setup");
    } else if (allWarnings.length >= RECALL_THRESHOLDS.cautionFailureCount) {
      positionSizeMultiplier = Math.min(positionSizeMultiplier, RECALL_THRESHOLDS.cautionSizeMultiplier);
      warnings.push(...allWarnings);
      reasoning.push(`${allWarnings.length} failure pattern(s) matched — sizing reduced`);
    }

    // 3. Check historical win rate
    if (advice.similarSetups.count >= RECALL_THRESHOLDS.minSimilarSetups) {
      const wr = advice.similarSetups.winRate;

      if (wr < RECALL_THRESHOLDS.veryLowWinRateThreshold) {
        tradeAllowed = false;
        positionSizeMultiplier = 0;
        reasoning.push(`Very low historical win rate (${(wr * 100).toFixed(1)}%) for similar setups — blocked`);
      } else if (wr < RECALL_THRESHOLDS.lowWinRateThreshold) {
        positionSizeMultiplier = Math.min(positionSizeMultiplier, RECALL_THRESHOLDS.cautionSizeMultiplier);
        confidenceAdjustment += RECALL_THRESHOLDS.lowWinRatePenalty;
        reasoning.push(`Low historical win rate (${(wr * 100).toFixed(1)}%) — reducing confidence and size`);
      } else if (wr > 0.70) {
        confidenceAdjustment += RECALL_THRESHOLDS.highWinRateBonus;
        reasoning.push(`Strong historical win rate (${(wr * 100).toFixed(1)}%) — confidence boosted`);
      }
    } else {
      reasoning.push(`Only ${advice.similarSetups.count} similar setups found — insufficient for judgment`);
    }

    // 4. Context prediction alignment
    if (advice.contextPrediction.confidence > 0.6) {
      const contextBias = advice.contextPrediction.bias;
      if (
        (input.direction === "long" && contextBias === "bearish") ||
        (input.direction === "short" && contextBias === "bullish")
      ) {
        confidenceAdjustment -= 0.1;
        warnings.push(`Trade direction (${input.direction}) conflicts with memory context bias (${contextBias})`);
        reasoning.push("Direction conflicts with historical context — confidence reduced");
      }
    }

    // 5. Regime transition risk
    if (advice.regimeHistory.transitionRisk > 0.7) {
      warnings.push("High regime transition risk detected from memory");
      confidenceAdjustment -= 0.05;
      reasoning.push("Elevated regime transition risk — slight confidence reduction");
    }

    // Add memory reasoning
    reasoning.push(...advice.reasoning);

    const result: MemoryRecallResult = {
      consulted: true,
      timestamp,
      advice,
      tradeAllowed,
      positionSizeMultiplier,
      confidenceAdjustment: Math.max(-1, Math.min(1, confidenceAdjustment)),
      warnings,
      reasoning,
      similarSetupCount: advice.similarSetups.count,
      historicalWinRate: advice.similarSetups.winRate,
      failurePatternCount: advice.failureWarnings.length,
    };

    logger.info({
      symbol: input.symbol,
      strategy: input.strategy,
      allowed: tradeAllowed,
      sizeMultiplier: positionSizeMultiplier,
      confAdj: confidenceAdjustment.toFixed(2),
      similarSetups: advice.similarSetups.count,
      warnings: warnings.length,
    }, "Memory recall complete");

    return result;
  } catch (err: any) {
    // Memory failure should NOT block trading — degrade gracefully
    logger.error({ err: err.message, symbol: input.symbol }, "Memory recall failed — degrading gracefully");

    return {
      consulted: false,
      timestamp,
      advice: null,
      tradeAllowed: true, // allow trade when memory is down
      positionSizeMultiplier: 0.75, // but reduce size as caution
      confidenceAdjustment: -0.1,
      warnings: ["Memory system unavailable — trading with reduced confidence"],
      reasoning: ["Memory recall failed, proceeding with caution"],
      similarSetupCount: 0,
      historicalWinRate: 0,
      failurePatternCount: 0,
    };
  }
}

/**
 * Record trade outcome back to memory system for learning.
 */
export async function recordTradeOutcome(record: PostTradeRecord): Promise<void> {
  try {
    const win = record.pnl > 0;
    const trade = {
      id: `${record.symbol}_${Date.now()}`,
      strategy: { name: record.strategy, type: record.strategy, params: {} },
      context: {
        regime: record.regime,
        session: record.session,
        volatility: 0,
        marketState: record.regime,
      },
    };

    const outcome = {
      win,
      pnl: record.pnl,
      pnlPercent: record.pnlPct,
      reason: record.exitReason,
      lessons: win
        ? [`Successful ${record.direction} in ${record.regime} regime`]
        : [`Failed ${record.direction} in ${record.regime} — ${record.exitReason}`],
    };

    await memorySystem.learnFromTrade(trade, outcome);

    logger.info({
      symbol: record.symbol,
      strategy: record.strategy,
      win,
      pnl: record.pnl,
    }, "Trade outcome recorded to memory");
  } catch (err: any) {
    logger.error({ err: err.message }, "Failed to record trade outcome to memory");
  }
}

/**
 * Get memory score for symbol brain integration.
 * Returns a 0-1 score based on historical success for this setup.
 */
export async function getMemoryScoreForSymbol(
  symbol: string,
  regime: string,
  session: string,
): Promise<number> {
  try {
    const advice = await memorySystem.consultMemory(
      { strategy: { name: "any", type: "any", params: {} }, context: { regime, session, volatility: 0, marketState: regime } },
      { regime, session, volatility: 0, symbol, timeframe: "1h" },
    );

    if (advice.similarSetups.count < 3) return 0.5; // neutral if insufficient data
    return Math.max(0, Math.min(1, advice.similarSetups.winRate));
  } catch {
    return 0.5; // neutral on failure
  }
}
