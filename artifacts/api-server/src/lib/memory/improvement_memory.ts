/**
 * improvement_memory.ts — Improvement Tracking and Learning
 *
 * Records successful improvements and A/B test results.
 *
 * Features:
 *   - Track improvement attempts and results
 *   - A/B test result recording
 *   - Improvement effectiveness analysis
 *   - Version history for strategy families
 */

import { logger } from "../logger";

/**
 * An improvement record
 */
export interface ImprovementRecord {
  id: string;
  timestamp: number;
  strategyName: string;
  strategyType: string;
  improvementType:
    | "parameter_tuning"
    | "entry_rule"
    | "exit_rule"
    | "risk_management"
    | "signal_filtering"
    | "timing";
  description: string;
  previousVersion: Record<string, unknown>;
  newVersion: Record<string, unknown>;
  results: {
    winRate: number;
    avgPnl: number;
    avgPnlPercent: number;
    maxDrawdown: number;
    sharpe: number;
    sampleSize: number;
  };
  improvement: {
    winRateDelta: number;
    pnlDelta: number;
    sharpeImprovement: number;
  };
  approved: boolean;
}

/**
 * A/B test result
 */
export interface ABResult {
  testId: string;
  timestamp: number;
  original: Record<string, unknown>;
  variant: Record<string, unknown>;
  results: {
    originalWinRate: number;
    variantWinRate: number;
    originalAvgPnl: number;
    variantAvgPnl: number;
    sampleSize: number;
    statisticalSignificance: number; // 0-1
  };
  winner: "original" | "variant" | "tie";
  recommendation: string;
}

/**
 * Version history for a strategy
 */
export interface VersionHistory {
  strategyFamily: string;
  versions: StrategyVersion[];
  currentBestVersion: StrategyVersion;
  evolutionSummary: string;
}

/**
 * A strategy version
 */
export interface StrategyVersion {
  version: string;
  timestamp: number;
  configuration: Record<string, unknown>;
  metrics: {
    winRate: number;
    avgPnl: number;
    sharpe: number;
  };
  improvementFrom: string | null;
}

/**
 * Effectiveness report
 */
export interface EffectivenessReport {
  improvementType: string;
  successRate: number; // % of improvements that were positive
  avgImprovement: number;
  topImprovements: ImprovementRecord[];
  strategyTypeBreakdown: Record<
    string,
    {
      attempted: number;
      successful: number;
      avgGain: number;
    }
  >;
}

/**
 * Suggested improvement
 */
export interface SuggestedImprovement {
  type: string;
  description: string;
  expectedBenefit: number; // 0-1
  confidence: number; // 0-1
  historicalEvidence: number; // count
  estimatedImpact: {
    winRate: number;
    pnl: number;
  };
}

class ImprovementMemory {
  private improvements: ImprovementRecord[] = [];
  private abTests: ABResult[] = [];
  private versionHistories: Map<string, VersionHistory> = new Map();

  /**
   * Record an improvement attempt
   */
  recordImprovement(improvement: ImprovementRecord): void {
    this.improvements.push(improvement);

    // Update version history
    this.updateVersionHistory(improvement);

    const isPositive = improvement.improvement.winRateDelta > 0 || improvement.improvement.pnlDelta > 0;

    logger.info(
      {
        improvementId: improvement.id,
        type: improvement.improvementType,
        strategy: improvement.strategyName,
        isPositive,
      },
      "Improvement recorded",
    );
  }

  /**
   * Record A/B test result
   */
  recordABResult(original: Record<string, unknown>, variant: Record<string, unknown>, results: ABResult): void {
    this.abTests.push(results);

    logger.info(
      {
        testId: results.testId,
        winner: results.winner,
        significance: results.results.statisticalSignificance,
      },
      "A/B test completed",
    );
  }

  /**
   * Get improvement suggestions based on past successes
   */
  suggestImprovements(strategy: any, currentMetrics: any): SuggestedImprovement[] {
    const suggestions: SuggestedImprovement[] = [];

    // Analyze what improvements worked for similar strategies
    const similarImprovements = this.improvements.filter((i) => i.strategyType === strategy.type);

    if (similarImprovements.length === 0) {
      return suggestions;
    }

    // Group by improvement type
    const byType = new Map<string, ImprovementRecord[]>();
    for (const imp of similarImprovements) {
      if (!byType.has(imp.improvementType)) {
        byType.set(imp.improvementType, []);
      }
      byType.get(imp.improvementType)!.push(imp);
    }

    // Generate suggestions for high-success improvement types
    for (const [type, records] of byType.entries()) {
      const successCount = records.filter((r) => r.improvement.pnlDelta > 0).length;
      const successRate = successCount / records.length;

      if (successRate > 0.5) {
        const avgGain = records.reduce((a, r) => a + r.improvement.pnlDelta, 0) / records.length;
        const avgWinRateGain = records.reduce((a, r) => a + r.improvement.winRateDelta, 0) / records.length;

        suggestions.push({
          type,
          description: `This improvement type has ${Math.round(successRate * 100)}% success rate for your strategy`,
          expectedBenefit: Math.min(1, avgGain / 1000), // Normalize to 0-1
          confidence: successRate,
          historicalEvidence: records.length,
          estimatedImpact: {
            winRate: avgWinRateGain,
            pnl: avgGain,
          },
        });
      }
    }

    // Sort by expected benefit
    suggestions.sort((a, b) => b.expectedBenefit - a.expectedBenefit);

    return suggestions.slice(0, 5);
  }

  /**
   * Get best version of a strategy family
   */
  getBestVersion(strategyFamily: string): VersionHistory | null {
    return this.versionHistories.get(strategyFamily) || null;
  }
  /**
   * Get effectiveness report
   */
  getImprovementEffectiveness(): EffectivenessReport[] {
    const reports: EffectivenessReport[] = [];

    const byType = new Map<string, ImprovementRecord[]>();
    for (const imp of this.improvements) {
      if (!byType.has(imp.improvementType)) {
        byType.set(imp.improvementType, []);
      }
      byType.get(imp.improvementType)!.push(imp);
    }

    for (const [type, records] of byType.entries()) {
      const successful = records.filter((r) => r.improvement.pnlDelta > 0);
      const successRate = records.length > 0 ? successful.length / records.length : 0;
      const avgImprovement =
        successful.length > 0 ? successful.reduce((a, r) => a + r.improvement.pnlDelta, 0) / successful.length : 0;

      // Breakdown by strategy type
      const strategyBreakdown: Record<string, any> = {};
      for (const rec of records) {
        if (!strategyBreakdown[rec.strategyType]) {
          strategyBreakdown[rec.strategyType] = {
            attempted: 0,
            successful: 0,
            totalGain: 0,
          };
        }
        const breakdown = strategyBreakdown[rec.strategyType];
        breakdown.attempted += 1;
        if (rec.improvement.pnlDelta > 0) {
          breakdown.successful += 1;
          breakdown.totalGain += rec.improvement.pnlDelta;
        }
      }

      // Convert to average
      for (const breakdown of Object.values(strategyBreakdown) as any[]) {
        breakdown.avgGain = breakdown.successful > 0 ? breakdown.totalGain / breakdown.successful : 0;
      }

      const topImprovement = [...records].sort((a, b) => b.improvement.pnlDelta - a.improvement.pnlDelta).slice(0, 3);

      reports.push({
        improvementType: type,
        successRate,
        avgImprovement,
        topImprovements: topImprovement,
        strategyTypeBreakdown: strategyBreakdown,
      });
    }

    return reports;
  }

  /**
   * Update version history for a strategy
   */
  private updateVersionHistory(improvement: ImprovementRecord): void {
    const family = improvement.strategyName;
    let history = this.versionHistories.get(family);

    if (!history) {
      history = {
        strategyFamily: family,
        versions: [],
        currentBestVersion: null as any,
        evolutionSummary: "",
      };
    }

    // Create new version record
    const newVersion: StrategyVersion = {
      version: `v${history.versions.length + 1}`,
      timestamp: improvement.timestamp,
      configuration: improvement.newVersion,
      metrics: {
        winRate: improvement.results.winRate,
        avgPnl: improvement.results.avgPnl,
        sharpe: improvement.results.sharpe,
      },
      improvementFrom: history.versions.length > 0 ? history.versions[history.versions.length - 1].version : null,
    };

    history.versions.push(newVersion);

    // Update current best
    if (!history.currentBestVersion || newVersion.metrics.sharpe > history.currentBestVersion.metrics.sharpe) {
      history.currentBestVersion = newVersion;
    }

    // Update evolution summary
    if (history.versions.length > 1) {
      const first = history.versions[0];
      const last = history.versions[history.versions.length - 1];
      const winRateDelta = last.metrics.winRate - first.metrics.winRate;
      const sharpeDelta = last.metrics.sharpe - first.metrics.sharpe;
      history.evolutionSummary =
        `From v1 to v${history.versions.length}: ` +
        `${winRateDelta > 0 ? "+" : ""}${(winRateDelta * 100).toFixed(1)}% win rate, ` +
        `${sharpeDelta > 0 ? "+" : ""}${sharpeDelta.toFixed(2)} Sharpe`;
    }

    this.versionHistories.set(family, history);
  }

  /**
   * Get memory stats
   */
  getStats(): {
    improvementsRecorded: number;
    successfulImprovements: number;
    successRate: number;
    abTestsCompleted: number;
    strategiesTracked: number;
    totalVersions: number;
  } {
    const successful = this.improvements.filter((i) => i.improvement.pnlDelta > 0).length;

    let totalVersions = 0;
    for (const history of this.versionHistories.values()) {
      totalVersions += history.versions.length;
    }

    return {
      improvementsRecorded: this.improvements.length,
      successfulImprovements: successful,
      successRate: this.improvements.length > 0 ? successful / this.improvements.length : 0,
      abTestsCompleted: this.abTests.length,
      strategiesTracked: this.versionHistories.size,
      totalVersions,
    };
  }
}

export const improvementMemory = new ImprovementMemory();
