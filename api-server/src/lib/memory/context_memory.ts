/**
 * context_memory.ts — Contextual Market Memory
 *
 * Records market contexts and what happened in them.
 *
 * Features:
 *   - Context-outcome tracking
 *   - Regime transition probabilities
 *   - Strategy performance by context
 *   - Temporal pattern recognition
 */

import { logger } from "../logger";

/**
 * A market context
 */
export interface MarketContext {
  timestamp: number;
  symbol: string;
  session: string; // "premarket", "market", "postmarket"
  regime: string;
  volatility: number; // 0-1
  trend: string; // "up", "down", "sideways"
  trendStrength: number; // 0-1
  volume: number;
  volumeRatio: number; // vs average
  nearSupport: boolean;
  nearResistance: boolean;
  timeOfDay: number; // minutes since open
  dayOfWeek: number; // 0-6
  economicEvents: string[];
}

/**
 * Outcome in a context
 */
export interface ContextOutcome {
  symbol: string;
  entry: number;
  exit: number;
  pnl: number;
  pnlPercent: number;
  holdTime: number;
  win: boolean;
  strategyType: string;
}

/**
 * What typically happens in certain conditions
 */
export interface ContextPrediction {
  context: MarketContext;
  outcomes: ContextOutcome[];
  probability: number; // 0-1
  expectedValue: number;
  winRate: number;
  avgPnlPercent: number;
  confidence: number; // 0-1
}

/**
 * Regime transition
 */
export interface RegimeTransition {
  from: string;
  to: string;
  timestamp: number;
  impact: {
    affectedStrategies: Record<string, number>; // strategy -> win rate change
    avgDrawdown: number;
    volatilityChange: number;
  };
}

/**
 * Transition probability matrix
 */
export interface TransitionMatrix {
  regimes: string[];
  probabilities: Map<string, Map<string, number>>; // from -> to -> probability
  averageDuration: Record<string, number>; // regime -> avg duration ms
}

/**
 * Strategy recommendation for context
 */
export interface StrategyRecommendation {
  strategyType: string;
  winRate: number;
  avgPnl: number;
  avgPnlPercent: number;
  sampleSize: number;
  confidence: number; // 0-1
  reason: string;
}

/**
 * Temporal pattern
 */
export interface TemporalPattern {
  symbol: string;
  timeWindow: { start: number; end: number }; // minutes since open
  dayOfWeek?: number;
  pattern: string; // e.g., "morning_breakout", "lunch_chop", "afternoon_fade"
  reliability: number; // 0-1
  avgReturn: number;
  sampleSize: number;
}

class ContextMemory {
  private contextHistories: Map<string, { context: MarketContext; outcomes: ContextOutcome[] }[]> = new Map();
  private transitions: RegimeTransition[] = [];
  private temporalPatterns: TemporalPattern[] = [];

  /**
   * Record a market context and outcomes
   */
  recordContext(context: MarketContext, outcomes: ContextOutcome[]): void {
    const contextKey = this.contextKey(context);

    if (!this.contextHistories.has(contextKey)) {
      this.contextHistories.set(contextKey, []);
    }

    this.contextHistories.get(contextKey)!.push({
      context,
      outcomes,
    });

    // Extract temporal patterns if applicable
    this.updateTemporalPatterns(context, outcomes);

    logger.info(
      {
        symbol: context.symbol,
        regime: context.regime,
        outcomes: outcomes.length,
      },
      "Context recorded",
    );
  }

  /**
   * Query what typically happens in conditions like these
   */
  queryContext(current: MarketContext): ContextPrediction {
    const matches: {
      context: MarketContext;
      outcomes: ContextOutcome[];
      similarity: number;
    }[] = [];

    // Find similar historical contexts
    for (const [_, histories] of this.contextHistories.entries()) {
      for (const history of histories) {
        const similarity = this.contextSimilarity(current, history.context);
        if (similarity > 0.4) {
          matches.push({
            context: history.context,
            outcomes: history.outcomes,
            similarity,
          });
        }
      }
    }

    // Aggregate outcomes, weighted by similarity
    let totalOutcomes = 0;
    let totalWins = 0;
    let totalPnlPercent = 0;
    let totalWeight = 0;

    for (const match of matches) {
      const weight = match.similarity;
      for (const outcome of match.outcomes) {
        totalOutcomes += 1;
        if (outcome.win) totalWins += 1;
        totalPnlPercent += outcome.pnlPercent;
        totalWeight += weight;
      }
    }

    const winRate = totalOutcomes > 0 ? totalWins / totalOutcomes : 0;
    const avgPnlPercent = totalOutcomes > 0 ? totalPnlPercent / totalOutcomes : 0;
    const probability = Math.min(1, totalOutcomes / 100); // More data = higher confidence
    const confidence = Math.min(1, totalWeight / 10); // Similarity-weighted confidence

    return {
      context: current,
      outcomes: matches.flatMap((m) => m.outcomes),
      probability,
      expectedValue: avgPnlPercent,
      winRate,
      avgPnlPercent,
      confidence,
    };
  }
  /**
   * Record a regime transition and its impact
   */
  recordRegimeTransition(from: string, to: string, impact: any): void {
    this.transitions.push({
      from,
      to,
      timestamp: Date.now(),
      impact,
    });

    logger.info(
      {
        from,
        to,
        avgDrawdown: impact.avgDrawdown,
      },
      "Regime transition recorded",
    );
  }

  /**
   * Get regime transition probabilities
   */
  getTransitionProbabilities(): TransitionMatrix {
    const regimeMap = new Map<string, Map<string, number>>();
    const durationMap: Record<string, number[]> = {};

    // Count transitions
    for (const transition of this.transitions) {
      if (!regimeMap.has(transition.from)) {
        regimeMap.set(transition.from, new Map());
      }

      const toMap = regimeMap.get(transition.from)!;
      toMap.set(transition.to, (toMap.get(transition.to) || 0) + 1);
    }

    // Normalize to probabilities
    for (const toMap of regimeMap.values()) {
      let total = 0;
      for (const count of toMap.values()) {
        total += count;
      }

      for (const [regime, count] of toMap.entries()) {
        toMap.set(regime, count / total);
      }
    }

    // Average duration (would need timestamps for accuracy)
    const allRegimes = new Set<string>();
    for (const transition of this.transitions) {
      allRegimes.add(transition.from);
      allRegimes.add(transition.to);
    }

    for (const regime of allRegimes) {
      durationMap[regime] = [3600000]; // Default 1 hour
    }

    return {
      regimes: Array.from(allRegimes),
      probabilities: regimeMap,
      averageDuration: durationMap,
    };
  }

  /**
   * Get best strategies for a context
   */
  getBestStrategiesForContext(context: MarketContext): StrategyRecommendation[] {
    const prediction = this.queryContext(context);

    // Group outcomes by strategy type
    const byStrategy = new Map<string, ContextOutcome[]>();
    for (const outcome of prediction.outcomes) {
      if (!byStrategy.has(outcome.strategyType)) {
        byStrategy.set(outcome.strategyType, []);
      }
      byStrategy.get(outcome.strategyType)!.push(outcome);
    }

    const recommendations: StrategyRecommendation[] = [];

    for (const [strategyType, outcomes] of byStrategy.entries()) {
      if (outcomes.length < 2) continue;

      const wins = outcomes.filter((o) => o.win).length;
      const winRate = wins / outcomes.length;
      const avgPnl = outcomes.reduce((a, o) => a + o.pnl, 0) / outcomes.length;
      const avgPnlPercent = outcomes.reduce((a, o) => a + o.pnlPercent, 0) / outcomes.length;

      // Confidence based on sample size
      const confidence = Math.min(1, outcomes.length / 20);

      recommendations.push({
        strategyType,
        winRate,
        avgPnl,
        avgPnlPercent,
        sampleSize: outcomes.length,
        confidence,
        reason: `${Math.round(winRate * 100)}% win rate in similar contexts (n=${outcomes.length})`,
      });
    }

    recommendations.sort((a, b) => b.avgPnlPercent - a.avgPnlPercent);

    return recommendations.slice(0, 5);
  }

  /**
   * Get temporal patterns
   */
  getTemporalPatterns(symbol: string): TemporalPattern[] {
    return this.temporalPatterns.filter((p) => p.symbol === symbol);
  }
  /**
   * Context similarity (0-1)
   */
  private contextSimilarity(a: MarketContext, b: MarketContext): number {
    let score = 0;
    let weights = 0;

    // Symbol match (0.15)
    if (a.symbol === b.symbol) {
      score += 1 * 0.15;
    }
    weights += 0.15;

    // Regime match (0.25)
    if (a.regime === b.regime) {
      score += 1 * 0.25;
    } else {
      score += 0.2 * 0.25; // Partial credit
    }
    weights += 0.25;

    // Volatility similarity (0.15)
    const volDiff = Math.abs(a.volatility - b.volatility);
    score += Math.max(0, 1 - volDiff) * 0.15;
    weights += 0.15;

    // Trend match (0.15)
    if (a.trend === b.trend) {
      score += 1 * 0.15;
    } else {
      score += 0.3 * 0.15;
    }
    weights += 0.15;

    // Time of day similarity (0.15)
    const timeDiff = Math.abs(a.timeOfDay - b.timeOfDay);
    const maxTimeDiff = 390; // 6.5 hours in minutes
    score += Math.max(0, 1 - timeDiff / maxTimeDiff) * 0.15;
    weights += 0.15;

    // Day of week (0.15)
    if (a.dayOfWeek === b.dayOfWeek) {
      score += 1 * 0.15;
    } else {
      score += 0.2 * 0.15;
    }
    weights += 0.15;

    return weights > 0 ? score / weights : 0;
  }

  /**
   * Context key for grouping
   */
  private contextKey(context: MarketContext): string {
    return `${context.symbol}|${context.session}|${context.regime}`;
  }

  /**
   * Update temporal patterns
   */
  private updateTemporalPatterns(context: MarketContext, outcomes: ContextOutcome[]): void {
    // Simple pattern detection: if outcomes cluster in time of day, record it
    const avgReturn = outcomes.reduce((a, o) => a + o.pnlPercent, 0) / outcomes.length;
    const winCount = outcomes.filter((o) => o.win).length;
    const reliability = winCount / outcomes.length;

    if (outcomes.length >= 3 && reliability > 0.6) {
      // Potentially a meaningful pattern
      const pattern = this.classifyTimePattern(context.timeOfDay, avgReturn);

      const existing = this.temporalPatterns.find(
        (p) =>
          p.symbol === context.symbol &&
          p.pattern === pattern &&
          p.timeWindow.start <= context.timeOfDay &&
          context.timeOfDay <= p.timeWindow.end,
      );

      if (existing) {
        // Update existing pattern
        existing.sampleSize += outcomes.length;
        existing.reliability = (existing.reliability * (existing.sampleSize - outcomes.length) + reliability * outcomes.length) / existing.sampleSize;
        existing.avgReturn =
          (existing.avgReturn * (existing.sampleSize - outcomes.length) + avgReturn * outcomes.length) / existing.sampleSize;
      } else {
        // Create new pattern
        this.temporalPatterns.push({
          symbol: context.symbol,
          timeWindow: this.getTimeWindow(context.timeOfDay),
          dayOfWeek: context.dayOfWeek,
          pattern,
          reliability,
          avgReturn,
          sampleSize: outcomes.length,
        });
      }
    }
  }

  /**
   * Classify time-based pattern
   */
  private classifyTimePattern(minutesSinceOpen: number, return_: number): string {
    if (minutesSinceOpen < 60) return "morning_breakout";
    if (minutesSinceOpen < 180) return "morning_momentum";
    if (minutesSinceOpen < 270) return "lunch_chop";
    if (minutesSinceOpen < 330) return "afternoon_recovery";
    return "close_range";
  }

  /**
   * Get time window for pattern
   */
  private getTimeWindow(minutesSinceOpen: number): { start: number; end: number } {
    const bucketSize = 60; // 1-hour buckets
    const start = Math.floor(minutesSinceOpen / bucketSize) * bucketSize;
    return { start, end: start + bucketSize };
  }

  /**
   * Get memory stats
   */
  getStats(): {
    contextsRecorded: number;
    transitionsRecorded: number;
    temporalPatternsDetected: number;
    uniqueContextTypes: number;
  } {
    return {
      contextsRecorded: this.contextHistories.size,
      transitionsRecorded: this.transitions.length,
      temporalPatternsDetected: this.temporalPatterns.length,
      uniqueContextTypes: this.contextHistories.size,
    };
  }
}

export const contextMemory = new ContextMemory();
