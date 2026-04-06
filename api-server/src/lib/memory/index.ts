/**
 * memory/index.ts — Phase 4 Memory System Orchestrator
 *
 * Central interface for the enhanced memory and learning system.
 *
 * Exports:
 *   - Market embeddings for similarity search
 *   - Failure memory for learning from losses
 *   - Improvement memory for tracking successes
 *   - Context memory for market conditions
 *   - Memory store for persistence
 *   - MemorySystem orchestrator
 */

// ── Market Embeddings ────────────────────────────────────────────────────

export {
  type MarketState,
  type TradeOutcome,
  type SimilarState,
  type MarketCluster,
  type RegimeShiftSignal,
  marketEmbeddings,
} from "./market_embeddings";

// ── Failure Memory ───────────────────────────────────────────────────────

export {
  type FailureRecord,
  type FailurePattern,
  type FailureMatch,
  type AntiPattern,
  failureMemory,
} from "./failure_memory";

// ── Improvement Memory ───────────────────────────────────────────────────

export {
  type ImprovementRecord,
  type ABResult,
  type VersionHistory,
  type StrategyVersion,
  type EffectivenessReport,
  type SuggestedImprovement,
  improvementMemory,
} from "./improvement_memory";

// ── Context Memory ───────────────────────────────────────────────────────

export {
  type MarketContext,
  type ContextOutcome,
  type ContextPrediction,
  type RegimeTransition,
  type TransitionMatrix,
  type StrategyRecommendation,
  type TemporalPattern,
  contextMemory,
} from "./context_memory";

// ── Memory Store ────────────────────────────────────────────────────────

export { type MemoryStats, memoryStore } from "./memory_store";

// ── Memory System Orchestrator ──────────────────────────────────────────

import { marketEmbeddings } from "./market_embeddings";
import { failureMemory } from "./failure_memory";
import { improvementMemory } from "./improvement_memory";
import { contextMemory } from "./context_memory";
import { memoryStore } from "./memory_store";
import { logger } from "../logger";

/**
 * Advice from memory system
 */
export interface MemoryAdvice {
  similarSetups: {
    count: number;
    winRate: number;
    avgReturn: number;
  };
  failureWarnings: string[];
  contextPrediction: {
    bias: string;
    confidence: number;
  };
  regimeHistory: {
    currentRegimeWinRate: number;
    transitionRisk: number;
  };
  recommendation: "proceed" | "caution" | "avoid";
  reasoning: string[];
}

/**
 * Memory suggestion
 */
export interface MemorySuggestion {
  type: string;
  description: string;
  confidence: number;
  action: string;
}

/**
 * Central Memory System
 */
export class MemorySystem {
  async initialize(): Promise<void> {
    logger.info("Memory system initialized");
  }

  /**
   * Consult memory before a trade
   */
  async consultMemory(setup: any, marketState: any): Promise<MemoryAdvice> {
    const reasoning: string[] = [];

    // Check similar setups
    const similarSetups = marketEmbeddings.findSimilar(marketState, 10);
    const winRate = similarSetups.filter((s) => s.outcome?.win).length / Math.max(1, similarSetups.length);
    const avgReturn =
      similarSetups.length > 0
        ? similarSetups.reduce((a, s) => a + (s.outcome?.pnlPercent || 0), 0) / similarSetups.length
        : 0;

    if (similarSetups.length > 0) {
      reasoning.push(`Found ${similarSetups.length} similar setups with ${(winRate * 100).toFixed(1)}% win rate`);
    }

    // Check failure warnings
    const failureMatches = failureMemory.checkSimilarFailures(setup, marketState);
    const failureWarnings = failureMatches
      .filter((m) => m.warningLevel !== "none")
      .map((m) => `${m.warningLevel}: ${m.reason}`);

    if (failureMatches.length > 0) {
      reasoning.push(`Found ${failureMatches.length} similar failures`);
    }

    // Check context prediction
    const contextPred = contextMemory.queryContext(marketState);
    const bias = contextPred.avgPnlPercent > 0 ? "bullish" : contextPred.avgPnlPercent < 0 ? "bearish" : "neutral";

    reasoning.push(`Market context bias: ${bias} (${(contextPred.avgPnlPercent * 100).toFixed(2)}% avg return)`);

    // Regime analysis
    const currentRegimeWinRate = winRate;
    const transitionRisk = Math.random(); // Would use regime transition probabilities

    // Overall recommendation
    let recommendation: "proceed" | "caution" | "avoid" = "proceed";
    if (failureWarnings.filter((w) => w.includes("critical")).length > 0) {
      recommendation = "avoid";
    } else if (failureWarnings.length > 0 || winRate < 0.4) {
      recommendation = "caution";
    }

    return {
      similarSetups: {
        count: similarSetups.length,
        winRate,
        avgReturn,
      },
      failureWarnings,
      contextPrediction: {
        bias,
        confidence: contextPred.confidence,
      },
      regimeHistory: {
        currentRegimeWinRate,
        transitionRisk,
      },
      recommendation,
      reasoning,
    };
  }

  /**
   * Learn from a completed trade
   */
  async learnFromTrade(trade: any, outcome: any): Promise<void> {
    // Record in appropriate memory systems
    if (outcome.win) {
      // Record successful context
      contextMemory.recordContext(trade.context, [outcome]);
    } else {
      // Record failure
      failureMemory.recordFailure({
        id: trade.id,
        timestamp: Date.now(),
        type: "live_stopped",
        strategy: trade.strategy,
        context: trade.context,
        reason: outcome.reason || "Trade closed with loss",
        loss: Math.abs(outcome.pnl),
        severity: Math.abs(outcome.pnl) > 1000 ? "severe" : "moderate",
        lessons: outcome.lessons || [],
      });
    }

    logger.info(
      { tradeId: trade.id, outcome: outcome.win ? "win" : "loss", pnl: outcome.pnl },
      "Learning from trade",
    );
  }

  /**
   * Learn from strategy evaluation
   */
  async learnFromEvaluation(strategy: any, results: any): Promise<void> {
    // Record improvement if metrics improved
    if (results.improvement) {
      improvementMemory.recordImprovement({
        id: `imp_${Date.now()}`,
        timestamp: Date.now(),
        strategyName: strategy.name,
        strategyType: strategy.type,
        improvementType: results.improvementType,
        description: results.description,
        previousVersion: results.before,
        newVersion: results.after,
        results: results.metrics,
        improvement: results.improvement,
        approved: results.approved,
      });
    }

    logger.info(
      { strategy: strategy.name, improved: results.improvement !== undefined },
      "Learning from evaluation",
    );
  }

  /**
   * Get memory-driven suggestions
   */
  async getSuggestions(context: any): Promise<MemorySuggestion[]> {
    const suggestions: MemorySuggestion[] = [];

    // Improvement suggestions
    const improvements = improvementMemory.suggestImprovements(context.strategy, context.metrics);
    for (const imp of improvements) {
      suggestions.push({
        type: "improvement",
        description: imp.description,
        confidence: imp.confidence,
        action: `Consider applying: ${imp.type}`,
      });
    }

    // Strategy recommendations for context
    const strategies = contextMemory.getBestStrategiesForContext(context.marketState);
    if (strategies.length > 0) {
      const best = strategies[0];
      suggestions.push({
        type: "strategy",
        description: best.reason,
        confidence: best.confidence,
        action: `Try ${best.strategyType} (${(best.winRate * 100).toFixed(1)}% win rate)`,
      });
    }

    // Anti-pattern warnings
    const antiPatterns = failureMemory.getAntiPatterns();
    for (const ap of antiPatterns.slice(0, 2)) {
      if (ap.confidence > 0.6) {
        suggestions.push({
          type: "warning",
          description: ap.description,
          confidence: ap.confidence,
          action: ap.avoidanceRule,
        });
      }
    }

    return suggestions;
  }

  /**
   * Get system statistics
   */
  async getStats(): Promise<Record<string, unknown>> {
    return {
      embeddings: marketEmbeddings.getStats(),
      failures: failureMemory.getStats(),
      improvements: improvementMemory.getStats(),
      context: contextMemory.getStats(),
      store: memoryStore.getStats(),
    };
  }
}

export const memorySystem = new MemorySystem();
