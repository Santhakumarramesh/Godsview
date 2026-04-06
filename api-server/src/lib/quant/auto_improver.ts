/**
 * auto_improver.ts — GodsView Quant Reasoning: Automatic Strategy Improvement
 *
 * Take a strategy and automatically suggest targeted improvements.
 * Real improvement logic: address the weakest component, estimate impact.
 *
 * Key responsibilities:
 * - Identify the highest-impact improvement opportunity
 * - Suggest specific improvements for entry, exit, filters, sizing
 * - Estimate expected impact on Sharpe, win rate, drawdown
 * - Generate improved strategy code
 */

export interface Improvement {
  component: string; // entry, exit, filters, sizing, regime
  type: string; // specific improvement type
  description: string;
  expectedImpact: {
    winRateChange: number; // +0.05 = 5% improvement
    sharpeChange: number; // +0.2 = 0.2 Sharpe improvement
    drawdownChange: number; // -0.05 = 5% DD reduction
    complexityChange: number; // parameter count change
  };
  implementation: string;
}

export interface ImprovementPlan {
  originalScore: number; // Robustness/Sharpe score
  expectedImprovedScore: number;
  improvements: Improvement[];
  priority: "entry" | "exit" | "filters" | "sizing" | "regime";
  reasoning: string;
  expectedImpact: {
    winRateChange: number;
    sharpeChange: number;
    drawdownChange: number;
    complexityChange: number;
  };
  sequence: string; // order to apply improvements
}

export interface EntryImprovement extends Improvement {}
export interface ExitImprovement extends Improvement {}
export interface FilterImprovement extends Improvement {}
export interface SizingImprovement extends Improvement {}
export interface RegimeImprovement extends Improvement {}

class AutoImprover {
  /**
   * Take a strategy and automatically suggest improvements
   */
  improve(strategy: any, backtestResults?: any): ImprovementPlan {
    const results = backtestResults || {};

    // Calculate current score
    const originalScore = this.calculateCurrentScore(strategy, results);

    // Identify improvement opportunities
    const improvements: Improvement[] = [];

    // Rank components by potential for improvement
    const componentScores = this.scoreComponents(strategy, results);

    // Suggest improvements for worst-performing component
    if (componentScores.entry.score < 70) {
      improvements.push(...this.optimizeEntry(strategy));
    }

    if (componentScores.exit.score < 70) {
      improvements.push(...this.optimizeExit(strategy));
    }

    if (componentScores.filters.score < 70) {
      improvements.push(...this.optimizeFilters(strategy));
    }

    if (componentScores.sizing.score < 70) {
      improvements.push(...this.optimizeSizing(strategy));
    }

    if (componentScores.regime.score < 70) {
      improvements.push(...this.addRegimeAdaptation(strategy));
    }

    // Determine priority
    const sortedComponents = Object.entries(componentScores).sort((a, b) => a[1].score - b[1].score);
    const priority = (sortedComponents[0][0] as any) || "entry";

    // Estimate expected improvement
    let totalWRChange = 0;
    let totalSharpeChange = 0;
    let totalDDChange = 0;
    let totalComplexity = 0;

    for (const imp of improvements) {
      totalWRChange += imp.expectedImpact.winRateChange;
      totalSharpeChange += imp.expectedImpact.sharpeChange;
      totalDDChange += imp.expectedImpact.drawdownChange;
      totalComplexity += imp.expectedImpact.complexityChange;
    }

    const expectedImprovedScore = originalScore + totalSharpeChange * 30; // sharpe drives score

    return {
      originalScore,
      expectedImprovedScore: Math.min(100, expectedImprovedScore),
      improvements,
      priority,
      reasoning: `Focus on ${priority} - this is the limiting factor. Current score: ${originalScore.toFixed(0)}, Expected after improvements: ${expectedImprovedScore.toFixed(0)}`,
      expectedImpact: {
        winRateChange: totalWRChange,
        sharpeChange: totalSharpeChange,
        drawdownChange: totalDDChange,
        complexityChange: totalComplexity,
      },
      sequence: this.generateSequence(improvements),
    };
  }

  /**
   * Optimize entry
   */
  optimizeEntry(strategy: any): EntryImprovement[] {
    const improvements: EntryImprovement[] = [];
    const entry = strategy.entry || {};

    // Entry Improvement 1: Add regime filter to entry
    if (!entry.regimeFilter) {
      improvements.push({
        component: "entry",
        type: "add_regime_filter",
        description:
          "Add regime-based filter to only take entry signals in favorable market conditions (e.g., trending regimes for momentum, ranging for mean reversion)",
        expectedImpact: {
          winRateChange: 0.03,
          sharpeChange: 0.15,
          drawdownChange: -0.05,
          complexityChange: 1,
        },
        implementation:
          "if (regime === 'trending') { signalStrength *= 1.2 } else if (regime === 'choppy') { return null; // skip entry }",
      });
    }

    // Entry Improvement 2: Add confirmation signal
    if (!entry.confirmationSignal) {
      improvements.push({
        component: "entry",
        type: "add_confirmation",
        description:
          "Require TWO independent signals to confirm entry. Reduces false signals from single-indicator noise.",
        expectedImpact: {
          winRateChange: 0.04,
          sharpeChange: 0.12,
          drawdownChange: -0.03,
          complexityChange: 1,
        },
        implementation: "Require signal1.strength > 0.6 AND signal2.strength > 0.6 before entering",
      });
    }

    // Entry Improvement 3: Scale into position
    if (!entry.scaling) {
      improvements.push({
        component: "entry",
        type: "scale_entry",
        description:
          "Instead of single entry, scale in over 2-3 bars. Reduces whipsaw, allows averaging better price.",
        expectedImpact: {
          winRateChange: 0.02,
          sharpeChange: 0.08,
          drawdownChange: -0.02,
          complexityChange: 2,
        },
        implementation: "Split position: 40% at signal, 30% on breakout, 30% on second confirmation",
      });
    }

    // Entry Improvement 4: Signal strength weighting
    if (!entry.signalStrengthWeighting) {
      improvements.push({
        component: "entry",
        type: "signal_strength_weighting",
        description: "Weight entry size by signal strength. Strong signals get larger position, weak get skipped or smaller.",
        expectedImpact: {
          winRateChange: 0.01,
          sharpeChange: 0.10,
          drawdownChange: -0.02,
          complexityChange: 1,
        },
        implementation:
          "positionSize = baseSize * (signal.strength - 0.5) * 2; // range [0, 2x]  if (strength < 0.5) { skip entry }",
      });
    }

    return improvements;
  }

  /**