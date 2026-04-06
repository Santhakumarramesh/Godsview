/**
 * Variant Generator
 *
 * Generates intelligent variations of a base strategy by:
 * - Tightening/loosening entry conditions
 * - Adjusting risk-reward targets
 * - Creating regime-specific variants
 * - Testing timeframe variations
 * - Ranking variants by estimated robustness
 */

import { StrategyDSL, cloneStrategy, strategyHash } from './strategy_dsl';

export interface StrategyVariant extends StrategyDSL {
  variantType: 'base' | 'tighter' | 'wider' | 'aggressive' | 'conservative' | 'regime_specific' | 'timeframe_specific';
  robustnessScore: number;
  diversificationScore: number;
  parentId?: string;
}

export interface RankedVariant {
  variant: StrategyVariant;
  rank: number;
  robustnessScore: number;
  diversificationScore: number;
  recommendation: string;
}

export interface StrategyComparison {
  strategyA: StrategyDSL;
  strategyB: StrategyDSL;
  similarities: string[];
  differences: string[];
  recommendation: string;
}

export class VariantGenerator {
  /**
   * Generate N variants of a strategy with different parameter combinations
   */
  generateVariants(base: StrategyDSL, count: number = 5): StrategyVariant[] {
    const variants: StrategyVariant[] = [];

    // Add the base strategy
    const baseVariant: StrategyVariant = {
      ...cloneStrategy(base),
      variantType: 'base',
      robustnessScore: 0.5,
      diversificationScore: 0.5,
      parentId: base.id,
    };
    variants.push(baseVariant);

    // Generate tight variant
    variants.push(this.generateTighterVariant(base));

    // Generate wide variant
    variants.push(this.generateWiderVariant(base));

    // Generate aggressive variant
    variants.push(this.generateAggressiveVariant(base));

    // Generate conservative variant
    variants.push(this.generateConservativeVariant(base));

    // Generate regime-specific variants if count permits
    if (count > 5) {
      const regimeVariants = this.generateRegimeSpecificVariants(base);
      variants.push(...regimeVariants.slice(0, Math.min(3, count - variants.length)));
    }

    return variants.slice(0, count);
  }

  /**
   * Generate tighter variant (stricter entry, tighter stops)
   */
  generateTighterVariant(base: StrategyDSL): StrategyVariant {
    const variant = cloneStrategy(base) as StrategyVariant;
    variant.variantType = 'tighter';
    variant.parentId = base.id;

    // Increase min confirmations
    if (variant.entry.minConfirmationsRequired < variant.entry.conditions.length) {
      variant.entry.minConfirmationsRequired = Math.min(
        variant.entry.conditions.length,
        variant.entry.minConfirmationsRequired + 1
      );
    }

    // Tighten stop loss (reduce by 30%)
    if (variant.exit.stopLoss.type === 'fixed_atr') {
      variant.exit.stopLoss.value *= 0.7;
    }

    // Increase minQualityScore
    variant.filters.minQualityScore = Math.min(0.95, variant.filters.minQualityScore + 0.1);

    // Reduce position size
    variant.sizing.maxPositionPercent *= 0.8;

    // Reduce max open positions
    variant.filters.maxOpenPositions = Math.max(1, variant.filters.maxOpenPositions - 1);

    variant.robustnessScore = 0.65;
    variant.name = `${base.name} (Tight)`;

    return variant;
  }

  /**
   * Generate wider variant (looser entry, wider stops)
   */
  generateWiderVariant(base: StrategyDSL): StrategyVariant {
    const variant = cloneStrategy(base) as StrategyVariant;
    variant.variantType = 'wider';
    variant.parentId = base.id;

    // Decrease min confirmations
    variant.entry.minConfirmationsRequired = Math.max(1, variant.entry.minConfirmationsRequired - 1);

    // Widen stop loss (increase by 30%)
    if (variant.exit.stopLoss.type === 'fixed_atr') {
      variant.exit.stopLoss.value *= 1.3;
    }

    // Decrease minQualityScore
    variant.filters.minQualityScore = Math.max(0.4, variant.filters.minQualityScore - 0.1);

    // Increase position size slightly
    variant.sizing.maxPositionPercent *= 1.15;

    // Increase max open positions
    variant.filters.maxOpenPositions += 1;

    // Adjust targets to maintain RR
    for (const target of variant.exit.takeProfit.targets) {
      target.ratio *= 1.2;
    }

    variant.robustnessScore = 0.45;
    variant.name = `${base.name} (Wide)`;

    return variant;
  }

  /**
   * Generate aggressive variant (max size, best opportunities)
   */
  generateAggressiveVariant(base: StrategyDSL): StrategyVariant {
    const variant = cloneStrategy(base) as StrategyVariant;
    variant.variantType = 'aggressive';
    variant.parentId = base.id;

    // Aggressive entry type
    variant.entry.aggressiveness = 'aggressive';
    variant.entry.type = 'market';

    // Higher risk tolerance
    variant.sizing.maxRiskPercent = Math.min(3.0, variant.sizing.maxRiskPercent * 1.5);
    variant.sizing.maxPositionPercent = Math.min(10, variant.sizing.maxPositionPercent * 1.3);

    // Lower quality filter
    variant.filters.minQualityScore = Math.max(0.5, variant.filters.minQualityScore - 0.15);

    // More open positions allowed
    variant.filters.maxOpenPositions = Math.min(10, variant.filters.maxOpenPositions + 2);

    // Wider targets (but higher expectancy)
    for (const target of variant.exit.takeProfit.targets) {
      target.ratio *= 1.1;
    }

    variant.robustnessScore = 0.4;
    variant.name = `${base.name} (Aggressive)`;

    return variant;
  }

  /**
   * Generate conservative variant (safety first)
   */
  generateConservativeVariant(base: StrategyDSL): StrategyVariant {
    const variant = cloneStrategy(base) as StrategyVariant;
    variant.variantType = 'conservative';
    variant.parentId = base.id;

    // Conservative entry
    variant.entry.aggressiveness = 'conservative';
    variant.entry.type = 'limit';

    // Lower risk per trade
    variant.sizing.maxRiskPercent = Math.max(0.5, variant.sizing.maxRiskPercent * 0.7);
    variant.sizing.maxPositionPercent = Math.max(2, variant.sizing.maxPositionPercent * 0.8);

    // High quality filter
    variant.filters.minQualityScore = Math.min(0.9, variant.filters.minQualityScore + 0.15);
    variant.filters.minEdgeScore = Math.min(0.95, variant.filters.minEdgeScore + 0.15);