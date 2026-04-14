/**
 * Strategy Lab Orchestrator
 *
 * Manages the full pipeline: NL parsing → DSL → critique → variant generation.
 * Provides high-level operations for strategy development and refinement.
 *
 * Rewritten against the canonical StrategyDSL shape (FilterSpec is a single
 * object, EntrySpec uses `minConfirmationsRequired`, ExitSpec uses
 * `takeProfit.targets`/`takeProfit.minRR`).
 */

import { StrategyDSL } from './strategy_dsl';
import {
  NaturalLanguageStrategyParser,
} from './strategy_parser';
import {
  StrategyCritique,
  CritiqueResult,
} from './strategy_critique';
import {
  VariantGenerator,
  StrategyVariant,
} from './variant_generator';

// ─── Result Types ─────────────────────────────────────────────────────────────

export interface LabProcessResult {
  originalIdea: string;
  strategy: StrategyDSL;
  critique: CritiqueResult;
  variants: StrategyVariant[];
  processingTime: number;
  timestamp: string;
}

export interface RefinementResult {
  originalStrategy: StrategyDSL;
  refinedStrategy: StrategyDSL;
  changesSummary: string[];
  newCritique: CritiqueResult;
  timestamp: string;
}

export interface StrategyComparison {
  strategyA: StrategyDSL;
  strategyB: StrategyDSL;
  critiqueA: CritiqueResult;
  critiqueB: CritiqueResult;
  differences: {
    category: string;
    description: string;
    advantage: 'A' | 'B' | 'tie';
  }[];
  recommendation: string;
}

export interface RankedVariant {
  variant: StrategyVariant;
  score: number;
  rank: number;
  critique: CritiqueResult;
}

export interface LabStatus {
  totalStrategiesProcessed: number;
  totalVariantsGenerated: number;
  averageCritiqueScore: number;
  topStrategies: StrategyDSL[];
  recentProcesses: LabProcessResult[];
  lastUpdated: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function lower(s: string): string {
  return s.toLowerCase();
}

// ─── Strategy Lab ─────────────────────────────────────────────────────────────

export class StrategyLab {
  private parser: NaturalLanguageStrategyParser;
  private critique: StrategyCritique;
  private variantGenerator: VariantGenerator;
  private processHistory: LabProcessResult[] = [];
  private strategyCache: Map<string, StrategyDSL> = new Map();

  constructor() {
    this.parser = new NaturalLanguageStrategyParser();
    this.critique = new StrategyCritique();
    this.variantGenerator = new VariantGenerator();
  }

  /** Main pipeline: description → strategy → critique → variants */
  public processIdea(description: string): LabProcessResult {
    const startTime = Date.now();

    const strategy = this.parser.parse(description);
    const critiqueResult = this.critique.fullCritique(strategy);
    const variants = this.variantGenerator.generateVariants(strategy);

    const processingTime = Date.now() - startTime;

    const result: LabProcessResult = {
      originalIdea: description,
      strategy,
      critique: critiqueResult,
      variants,
      processingTime,
      timestamp: new Date().toISOString(),
    };

    this.processHistory.push(result);
    this.strategyCache.set(strategy.name, strategy);

    return result;
  }

  /** Apply user feedback to refine strategy */
  public refineStrategy(strategy: StrategyDSL, feedback: string): RefinementResult {
    const fb = lower(feedback);
    const changesSummary: string[] = [];
    const refinedStrategy = clone(strategy);

    // ─── Stop loss adjustments ──────────────────────────────────────────────
    if (fb.includes('tight') || fb.includes('reduce stop')) {
      if (refinedStrategy.exit.stopLoss) {
        const currentStop = refinedStrategy.exit.stopLoss.value || 2;
        refinedStrategy.exit.stopLoss.value = Math.max(0.5, currentStop * 0.7);
        changesSummary.push(
          `Tightened stop loss from ${currentStop}% to ${refinedStrategy.exit.stopLoss.value.toFixed(2)}%`,
        );
      }
    }

    if (fb.includes('loose') || fb.includes('wider stop')) {
      if (refinedStrategy.exit.stopLoss) {
        const currentStop = refinedStrategy.exit.stopLoss.value || 2;
        refinedStrategy.exit.stopLoss.value = currentStop * 1.3;
        changesSummary.push(
          `Widened stop loss from ${currentStop}% to ${refinedStrategy.exit.stopLoss.value.toFixed(2)}%`,
        );
      }
    }

    // ─── Entry confirmation adjustments ────────────────────────────────────
    if (fb.includes('conservative') || fb.includes('more confirmation')) {
      const current = refinedStrategy.entry.minConfirmationsRequired ?? 1;
      refinedStrategy.entry.minConfirmationsRequired = current + 1;
      refinedStrategy.entry.aggressiveness = 'conservative';
      changesSummary.push(
        `Increased minConfirmationsRequired to ${refinedStrategy.entry.minConfirmationsRequired}`,
      );
    }

    if (fb.includes('aggressive') || fb.includes('faster entry')) {
      const current = refinedStrategy.entry.minConfirmationsRequired ?? 2;
      refinedStrategy.entry.minConfirmationsRequired = Math.max(1, current - 1);
      refinedStrategy.entry.aggressiveness = 'aggressive';
      changesSummary.push(
        `Reduced minConfirmationsRequired to ${refinedStrategy.entry.minConfirmationsRequired}`,
      );
    }

    // ─── Volatility filter adjustments (via marketContext) ────────────────
    if (fb.includes('filter') || fb.includes('volatility')) {
      const vf = refinedStrategy.marketContext.volatilityFilter;
      if (vf.minATR === undefined && vf.maxATR === undefined) {
        vf.minATR = 0.3;
        vf.maxATR = 2.5;
        changesSummary.push('Added volatility filter (ATR 0.3–2.5)');
      }
    }

    // ─── Filter simplification ────────────────────────────────────────────
    if (fb.includes('simplify') || fb.includes('complex')) {
      const filters = refinedStrategy.filters;
      // Relax the least-critical filters
      if (filters.cooldownBars > 0 || filters.maxCorrelation < 1) {
        filters.cooldownBars = 0;
        filters.maxCorrelation = 1;
        changesSummary.push('Simplified filters (removed cooldown and correlation cap)');
      }
    }

    // ─── Profit target adjustments ───────────────────────────────────────
    if (fb.includes('profit') || fb.includes('target')) {
      const tp = refinedStrategy.exit.takeProfit;
      if (!tp.targets || tp.targets.length === 0) {
        tp.targets = [{ ratio: 3.0, closePercent: 1.0 }];
        tp.minRR = 3.0;
        changesSummary.push('Added default profit target at 3R');
      } else {
        const first = tp.targets[0];
        first.ratio = first.ratio * 1.2;
        tp.minRR = Math.max(tp.minRR, first.ratio);
        changesSummary.push(`Increased profit target to ${first.ratio.toFixed(2)}R`);
      }
    }

    refinedStrategy.name = `${strategy.name} (Refined)`;
    const newCritique = this.critique.fullCritique(refinedStrategy);

    return {
      originalStrategy: strategy,
      refinedStrategy,
      changesSummary,
      newCritique,
      timestamp: new Date().toISOString(),
    };
  }

  /** Compare two strategies side-by-side */
  public compareStrategies(a: StrategyDSL, b: StrategyDSL): StrategyComparison {
    const critiqueA = this.critique.fullCritique(a);
    const critiqueB = this.critique.fullCritique(b);
    const differences: StrategyComparison['differences'] = [];

    if (critiqueA.edge.expectancy > critiqueB.edge.expectancy) {
      differences.push({
        category: 'Edge',
        description: `Strategy A has better expectancy (${critiqueA.edge.expectancy.toFixed(3)} vs ${critiqueB.edge.expectancy.toFixed(3)})`,
        advantage: 'A',
      });
    } else if (critiqueB.edge.expectancy > critiqueA.edge.expectancy) {
      differences.push({
        category: 'Edge',
        description: 'Strategy B has better expectancy',
        advantage: 'B',
      });
    }

    if (critiqueA.riskReward.riskRewardRatio > critiqueB.riskReward.riskRewardRatio) {
      differences.push({
        category: 'Risk/Reward',
        description: `Strategy A has better ratio (${critiqueA.riskReward.riskRewardRatio.toFixed(2)} vs ${critiqueB.riskReward.riskRewardRatio.toFixed(2)})`,
        advantage: 'A',
      });
    } else if (critiqueB.riskReward.riskRewardRatio > critiqueA.riskReward.riskRewardRatio) {
      differences.push({
        category: 'Risk/Reward',
        description: 'Strategy B has better ratio',
        advantage: 'B',
      });
    }

    if (critiqueA.overfit.overallRisk !== critiqueB.overfit.overallRisk) {
      const betterFitness = critiqueA.overfit.overallRisk === 'low' ? 'A' : 'B';
      differences.push({
        category: 'Overfit Risk',
        description: `Strategy ${betterFitness} has lower overfit risk`,
        advantage: betterFitness,
      });
    }

    if (critiqueA.complexity.complexityScore < critiqueB.complexity.complexityScore) {
      differences.push({
        category: 'Complexity',
        description: 'Strategy A is simpler',
        advantage: 'A',
      });
    } else if (critiqueB.complexity.complexityScore < critiqueA.complexity.complexityScore) {
      differences.push({
        category: 'Complexity',
        description: 'Strategy B is simpler',
        advantage: 'B',
      });
    }

    const recommendedStrategy = critiqueA.overallScore > critiqueB.overallScore ? 'A' : 'B';
    const recommendation = `Strategy ${recommendedStrategy} is recommended (Score: ${Math.max(critiqueA.overallScore, critiqueB.overallScore).toFixed(2)}/10)`;

    return {
      strategyA: a,
      strategyB: b,
      critiqueA,
      critiqueB,
      differences,
      recommendation,
    };
  }

  /** Score and rank variants by overall critique score */
  public rankVariants(variants: StrategyVariant[]): RankedVariant[] {
    const ranked: RankedVariant[] = variants.map((variant) => ({
      variant,
      score: 0,
      rank: 0,
      critique: this.critique.fullCritique(variant),
    }));

    ranked.forEach((rv) => {
      rv.score = rv.critique.overallScore;
    });

    ranked.sort((a, b) => b.score - a.score);
    ranked.forEach((rv, index) => {
      rv.rank = index + 1;
    });

    return ranked;
  }

  /** Get current lab status and statistics */
  public getLabStatus(): LabStatus {
    const scores = this.processHistory.map((p) => p.critique.overallScore);
    const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

    const topStrategies = Array.from(this.strategyCache.values()).slice(0, 5);

    return {
      totalStrategiesProcessed: this.processHistory.length,
      totalVariantsGenerated: this.processHistory.reduce(
        (sum, p) => sum + p.variants.length,
        0,
      ),
      averageCritiqueScore: avgScore,
      topStrategies,
      recentProcesses: this.processHistory.slice(-5),
      lastUpdated: new Date().toISOString(),
    };
  }

  public clearHistory(): void {
    this.processHistory = [];
    this.strategyCache.clear();
  }

  public getCachedStrategy(name: string): StrategyDSL | undefined {
    return this.strategyCache.get(name);
  }

  public getProcessHistory(): LabProcessResult[] {
    return this.processHistory;
  }
}

// ─── Re-exports ───────────────────────────────────────────────────────────────

export {
  NaturalLanguageStrategyParser,
  StrategyCritique,
  VariantGenerator,
};
export type { StrategyVariant, CritiqueResult };

export default StrategyLab;
