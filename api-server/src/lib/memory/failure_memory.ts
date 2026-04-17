/**
 * failure_memory.ts — Failure Tracking and Learning
 *
 * Records, analyzes, and learns from trading failures.
 *
 * Features:
 *   - Store failures with context and lessons
 *   - Pattern recognition across failures
 *   - Anti-pattern extraction
 *   - Similarity matching to prevent repeated failures
 */

import { logger } from "../logger";

/**
 * A recorded failure
 */
export interface FailureRecord {
  id: string;
  timestamp: number;
  type: "strategy_rejected" | "backtest_failed" | "live_stopped" | "drawdown_exceeded" | "regime_mismatch";
  strategy: {
    name: string;
    type: string;
    params: Record<string, unknown>;
  };
  context: {
    regime: string;
    session: string;
    volatility: number;
    marketState: string;
  };
  reason: string;
  loss: number;
  severity: "minor" | "moderate" | "severe" | "catastrophic";
  lessons: string[];
}

/**
 * Pattern across failures
 */
export interface FailurePattern {
  pattern: string;
  frequency: number;
  avgLoss: number;
  commonConditions: Record<string, unknown>;
  avoidanceRule: string;
}

/**
 * A matched failure
 */
export interface FailureMatch {
  failure: FailureRecord;
  similarity: number; // 0-1
  warningLevel: "none" | "caution" | "warning" | "critical";
  reason: string;
}

/**
 * Anti-pattern (thing that consistently fails)
 */
export interface AntiPattern {
  name: string;
  description: string;
  indicators: string[];
  historicalLoss: number;
  confidence: number; // 0-1
  avoidanceRule: string;
  frequency: number;
}

class FailureMemory {
  private failures: FailureRecord[] = [];
  private patterns: FailurePattern[] = [];
  private antiPatterns: AntiPattern[] = [];

  /**
   * Record a failed strategy or trade
   */
  recordFailure(failure: FailureRecord): void {
    this.failures.push(failure);

    // Auto-extract patterns
    this.extractPatterns();
    this.extractAntiPatterns();

    logger.info(
      { failureId: failure.id, type: failure.type, severity: failure.severity },
      "Failure recorded",
    );
  }

  /**
   * Check if a setup is similar to known failures
   */
  checkSimilarFailures(strategy: any, context: any = {}): FailureMatch[] {
    const matches: FailureMatch[] = [];

    for (const failure of this.failures) {
      // Strategy type match
      const strategyTypeMatch = failure.strategy.type === strategy.type ? 0.3 : 0;

      // Parameter overlap
      let paramOverlap = 0;
      let paramMatches = 0;
      for (const key in strategy.params) {
        if (key in failure.strategy.params) {
          const sim = this.paramSimilarity(strategy.params[key], failure.strategy.params[key]);
          paramOverlap += sim;
          paramMatches++;
        }
      }
      paramOverlap = paramMatches > 0 ? paramOverlap / paramMatches : 0;

      // Context match
      const contextMatch = context.regime === failure.context.regime ? 0.2 : 0;
      const volatilityMatch = context.volatility
        ? 1 - Math.abs(context.volatility - failure.context.volatility) / Math.max(1, failure.context.volatility)
        : 0;

      // Overall similarity
      const similarity = (strategyTypeMatch + paramOverlap * 0.5 + contextMatch + volatilityMatch * 0.2) / 1.0;

      if (similarity > 0.3) {
        // Determine warning level
        let warningLevel: "none" | "caution" | "warning" | "critical" = "none";
        if (failure.severity === "catastrophic") warningLevel = "critical";
        else if (failure.severity === "severe") warningLevel = "warning";
        else if (failure.severity === "moderate") warningLevel = "caution";

        matches.push({
          failure,
          similarity,
          warningLevel,
          reason: `Similar strategy failed: ${failure.reason}`,
        });
      }
    }

    // Sort by similarity
    matches.sort((a, b) => b.similarity - a.similarity);

    return matches;
  }

  /**
   * Get failure patterns by category
   */
  getFailurePatterns(): FailurePattern[] {
    return [...this.patterns];
  }

  /**
   * Get anti-patterns (things that consistently fail)
   */
  getAntiPatterns(): AntiPattern[] {
    return [...this.antiPatterns];
  }
  /**
   * Generate lessons learned from failures
   */
  generateFailureLessons(): { lesson: string; frequency: number; avgLoss: number }[] {
    const lessons = new Map<string, { count: number; totalLoss: number }>();

    for (const failure of this.failures) {
      for (const lesson of failure.lessons) {
        const existing = lessons.get(lesson) || { count: 0, totalLoss: 0 };
        existing.count += 1;
        existing.totalLoss += failure.loss;
        lessons.set(lesson, existing);
      }
    }

    const result: { lesson: string; frequency: number; avgLoss: number }[] = [];
    for (const [lesson, data] of lessons.entries()) {
      result.push({
        lesson,
        frequency: data.count,
        avgLoss: data.totalLoss / data.count,
      });
    }

    result.sort((a, b) => b.frequency - a.frequency);
    return result;
  }

  /**
   * Extract common patterns
   */
  private extractPatterns(): void {
    const patternMap = new Map<string, FailureRecord[]>();

    for (const failure of this.failures) {
      // Group by strategy type
      const key = failure.strategy.type;
      if (!patternMap.has(key)) {
        patternMap.set(key, []);
      }
      patternMap.get(key)!.push(failure);
    }

    this.patterns = [];

    for (const [strategyType, records] of patternMap.entries()) {
      const frequency = records.length;
      const avgLoss = records.reduce((a, r) => a + r.loss, 0) / frequency;

      // Common conditions
      const conditions: Record<string, any> = {};
      const regimes = new Map<string, number>();
      for (const rec of records) {
        regimes.set(rec.context.regime, (regimes.get(rec.context.regime) || 0) + 1);
      }
      if (regimes.size > 0) {
        const mostCommon = Array.from(regimes.entries()).sort((a, b) => b[1] - a[1])[0];
        conditions.preferredRegime = mostCommon[0];
        conditions.regimeFrequency = mostCommon[1] / frequency;
      }

      this.patterns.push({
        pattern: strategyType,
        frequency,
        avgLoss,
        commonConditions: conditions,
        avoidanceRule: `Avoid ${strategyType} in ${conditions.preferredRegime || "adverse"} conditions`,
      });
    }

    this.patterns.sort((a, b) => b.frequency - a.frequency);
  }

  /**
   * Extract anti-patterns
   */
  private extractAntiPatterns(): void {
    const patternMap = new Map<string, FailureRecord[]>();

    // Group by common characteristics
    for (const failure of this.failures) {
      const key = `${failure.strategy.type}|${failure.context.regime}`;
      if (!patternMap.has(key)) {
        patternMap.set(key, []);
      }
      patternMap.get(key)!.push(failure);
    }

    this.antiPatterns = [];

    for (const [key, records] of patternMap.entries()) {
      if (records.length < 2) continue;

      const [strategyType, regime] = key.split("|");
      const frequency = records.length;
      const totalLoss = records.reduce((a, r) => a + r.loss, 0);
      const avgLoss = totalLoss / frequency;

      // Build confidence from severity distribution
      const severities = records.map((r) => r.severity);
      const severeCount = severities.filter((s) => s === "severe" || s === "catastrophic").length;
      const confidence = severeCount / frequency;

      // Extract indicators from reasons
      const indicators = this.extractIndicators(records);

      this.antiPatterns.push({
        name: `${strategyType} in ${regime}`,
        description: `Strategy type "${strategyType}" consistently fails in "${regime}" regime`,
        indicators,
        historicalLoss: totalLoss,
        confidence,
        avoidanceRule: `Never trade ${strategyType} during ${regime}`,
        frequency,
      });
    }

    this.antiPatterns.sort((a, b) => b.confidence - a.confidence);
  }
  /**
   * Extract common indicators from failure reasons
   */
  private extractIndicators(failures: FailureRecord[]): string[] {
    const indicators = new Set<string>();

    const keywords = ["volatile", "gap", "news", "weekend", "premarket", "earnings", "illiquid"];

    for (const failure of failures) {
      for (const keyword of keywords) {
        if (failure.reason.toLowerCase().includes(keyword)) {
          indicators.add(keyword);
        }
      }
    }

    return Array.from(indicators);
  }

  /**
   * Measure similarity between two parameter values
   */
  private paramSimilarity(a: unknown, b: unknown): number {
    if (typeof a === "number" && typeof b === "number") {
      if (a === 0 && b === 0) return 1;
      const ratio = Math.min(a, b) / Math.max(a, b);
      return Math.max(0, 2 * ratio - 1); // Similarity in range [0, 1]
    }

    if (typeof a === "string" && typeof b === "string") {
      return a === b ? 1 : 0;
    }

    if (typeof a === "boolean" && typeof b === "boolean") {
      return a === b ? 1 : 0;
    }

    return 0;
  }

  /**
   * Get memory stats
   */
  getStats(): {
    totalFailures: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
    avgLoss: number;
    patternsDetected: number;
    antiPatternsDetected: number;
  } {
    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    let totalLoss = 0;

    for (const failure of this.failures) {
      byType[failure.type] = (byType[failure.type] || 0) + 1;
      bySeverity[failure.severity] = (bySeverity[failure.severity] || 0) + 1;
      totalLoss += failure.loss;
    }

    return {
      totalFailures: this.failures.length,
      byType,
      bySeverity,
      avgLoss: this.failures.length > 0 ? totalLoss / this.failures.length : 0,
      patternsDetected: this.patterns.length,
      antiPatternsDetected: this.antiPatterns.length,
    };
  }
}

export const failureMemory = new FailureMemory();
