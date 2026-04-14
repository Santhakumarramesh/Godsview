import { StrategyDSL } from './strategy_dsl';

/**
 * Variant metadata describing modifications
 */
export interface VariantMetadata {
  baseStrategyName: string;
  variantType: string;
  description: string;
  modificationsApplied: string[];
  expectedImpact: {
    winRate: number;
    riskReward: number;
    drawdown: number;
  };
}

/**
 * Strategy variant with metadata
 */
export interface StrategyVariant extends StrategyDSL {
  variantMetadata: VariantMetadata;
}

/**
 * Variant Generator
 * Generates multiple strategy variants from a base strategy DSL.
 * Each variant modifies specific parameters in systematic ways to explore
 * the strategy design space while staying within valid DSL constraints.
 */
export class VariantGenerator {
  /**
   * Main function: generate array of variants from base strategy
   */
  public generateVariants(strategy: StrategyDSL): StrategyVariant[] {
    const variants: StrategyVariant[] = [];

    variants.push(this.tighterStops(strategy));
    variants.push(this.widerStops(strategy));
    variants.push(this.aggressiveEntry(strategy));
    variants.push(this.conservativeEntry(strategy));
    variants.push(this.regimeAdapted(strategy));
    variants.push(this.scaledDown(strategy));
    variants.push(this.scaledUp(strategy));
    variants.push(this.filteredHighQuality(strategy));

    return variants;
  }

  private clone(strategy: StrategyDSL): StrategyDSL {
    return JSON.parse(JSON.stringify(strategy)) as StrategyDSL;
  }

  /**
   * Variant: tighter stops (2% below base)
   */
  public tighterStops(strategy: StrategyDSL): StrategyVariant {
    const newStrategy = this.clone(strategy);

    const originalStop = newStrategy.exit.stopLoss?.value ?? 2;
    if (newStrategy.exit.stopLoss) {
      newStrategy.exit.stopLoss.value = Math.max(0.5, originalStop * 0.5);
    }

    const modifications: string[] = [
      `Stop loss reduced from ${originalStop}% to ${newStrategy.exit.stopLoss?.value ?? 1}%`,
    ];

    return {
      ...newStrategy,
      name: `${strategy.name} (Tight Stops)`,
      variantMetadata: {
        baseStrategyName: strategy.name,
        variantType: 'tighter_stops',
        description:
          'Reduces stop loss by 50% to capture quicker exits with lower risk per trade',
        modificationsApplied: modifications,
        expectedImpact: {
          winRate: 0.05,
          riskReward: -0.3,
          drawdown: -0.4,
        },
      },
    };
  }

  /**
   * Variant: wider stops (2x base)
   */
  public widerStops(strategy: StrategyDSL): StrategyVariant {
    const newStrategy = this.clone(strategy);

    const originalStop = newStrategy.exit.stopLoss?.value ?? 2;
    if (newStrategy.exit.stopLoss) {
      newStrategy.exit.stopLoss.value = originalStop * 2;
    }

    const modifications: string[] = [
      `Stop loss increased from ${originalStop}% to ${newStrategy.exit.stopLoss?.value ?? 4}%`,
    ];

    return {
      ...newStrategy,
      name: `${strategy.name} (Wide Stops)`,
      variantMetadata: {
        baseStrategyName: strategy.name,
        variantType: 'wider_stops',
        description:
          'Doubles stop loss to allow more room for market noise and whipsaws',
        modificationsApplied: modifications,
        expectedImpact: {
          winRate: -0.05,
          riskReward: 0.3,
          drawdown: 0.5,
        },
      },
    };
  }

  /**
   * Variant: aggressive entry
   * Lowers minConfirmationsRequired to enter faster.
   */
  public aggressiveEntry(strategy: StrategyDSL): StrategyVariant {
    const newStrategy = this.clone(strategy);

    const originalMin = newStrategy.entry.minConfirmationsRequired ?? 1;
    newStrategy.entry.minConfirmationsRequired = Math.max(1, originalMin - 1);
    newStrategy.entry.aggressiveness = 'aggressive';

    const modifications: string[] = [
      `Minimum confirmations reduced from ${originalMin} to ${newStrategy.entry.minConfirmationsRequired}`,
      'Entry aggressiveness set to aggressive',
    ];

    // Relax quality thresholds for faster entries
    if (newStrategy.filters) {
      const originalQ = newStrategy.filters.minQualityScore;
      const originalE = newStrategy.filters.minEdgeScore;
      newStrategy.filters.minQualityScore = Math.max(0, originalQ - 0.1);
      newStrategy.filters.minEdgeScore = Math.max(0, originalE - 0.1);
      modifications.push('Lowered minimum quality and edge scores by 0.1');
    }

    return {
      ...newStrategy,
      name: `${strategy.name} (Aggressive Entry)`,
      variantMetadata: {
        baseStrategyName: strategy.name,
        variantType: 'aggressive_entry',
        description:
          'Reduces confirmation requirements and quality thresholds to enter trades faster',
        modificationsApplied: modifications,
        expectedImpact: {
          winRate: -0.08,
          riskReward: 0.1,
          drawdown: 0.3,
        },
      },
    };
  }

  /**
   * Variant: conservative entry
   * Requires more confirmations and tightens filters.
   */
  public conservativeEntry(strategy: StrategyDSL): StrategyVariant {
    const newStrategy = this.clone(strategy);

    const originalMin = newStrategy.entry.minConfirmationsRequired ?? 1;
    newStrategy.entry.minConfirmationsRequired = originalMin + 1;
    newStrategy.entry.aggressiveness = 'conservative';

    const modifications: string[] = [
      `Minimum confirmations increased from ${originalMin} to ${newStrategy.entry.minConfirmationsRequired}`,
      'Entry aggressiveness set to conservative',
    ];

    if (newStrategy.filters) {
      newStrategy.filters.minQualityScore = Math.min(
        1,
        newStrategy.filters.minQualityScore + 0.1,
      );
      newStrategy.filters.minEdgeScore = Math.min(
        1,
        newStrategy.filters.minEdgeScore + 0.1,
      );
      modifications.push('Raised minimum quality and edge scores by 0.1');
    }

    return {
      ...newStrategy,
      name: `${strategy.name} (Conservative Entry)`,
      variantMetadata: {
        baseStrategyName: strategy.name,
        variantType: 'conservative_entry',
        description:
          'Increases confirmation requirements and filter quality to reduce false signals',
        modificationsApplied: modifications,
        expectedImpact: {
          winRate: 0.12,
          riskReward: -0.1,
          drawdown: -0.25,
        },
      },
    };
  }

  /**
   * Variant: regime adapted
   * Adjusts marketContext regime filter to prefer stronger trends.
   */
  public regimeAdapted(strategy: StrategyDSL): StrategyVariant {
    const newStrategy = this.clone(strategy);
    const modifications: string[] = [];

    if (newStrategy.marketContext?.regimeFilter) {
      const rf = newStrategy.marketContext.regimeFilter;
      rf.minStrength = Math.min(1, (rf.minStrength ?? 0.5) + 0.15);
      modifications.push(
        `Regime minimum strength raised to ${rf.minStrength.toFixed(2)}`,
      );
    }
    if (newStrategy.marketContext?.trendFilter) {
      newStrategy.marketContext.trendFilter.mtfAlignment = true;
      newStrategy.marketContext.trendFilter.minTrendStrength = 0.6;
      modifications.push(
        'Enabled multi-timeframe alignment with 0.6 minimum trend strength',
      );
    }

    return {
      ...newStrategy,
      name: `${strategy.name} (Regime Adapted)`,
      variantMetadata: {
        baseStrategyName: strategy.name,
        variantType: 'regime_adapted',
        description:
          'Tightens regime and trend filters to improve market condition alignment',
        modificationsApplied: modifications,
        expectedImpact: {
          winRate: 0.08,
          riskReward: 0.15,
          drawdown: -0.2,
        },
      },
    };
  }

  /**
   * Variant: scaled down
   * Smaller position sizes, tighter stops, focus on capital preservation.
   */
  public scaledDown(strategy: StrategyDSL): StrategyVariant {
    const newStrategy = this.clone(strategy);
    const modifications: string[] = [];

    if (newStrategy.sizing) {
      const origRisk = newStrategy.sizing.maxRiskPercent;
      const origPos = newStrategy.sizing.maxPositionPercent;
      newStrategy.sizing.maxRiskPercent = origRisk * 0.5;
      newStrategy.sizing.maxPositionPercent = origPos * 0.5;
      modifications.push(
        `Max risk reduced from ${origRisk}% to ${newStrategy.sizing.maxRiskPercent}%`,
      );
      modifications.push(
        `Max position reduced from ${origPos}% to ${newStrategy.sizing.maxPositionPercent}%`,
      );
    }

    if (newStrategy.exit.stopLoss) {
      const origStop = newStrategy.exit.stopLoss.value ?? 2;
      newStrategy.exit.stopLoss.value = origStop * 0.75;
      modifications.push(
        `Stop loss tightened to ${newStrategy.exit.stopLoss.value}%`,
      );
    }

    return {
      ...newStrategy,
      name: `${strategy.name} (Scaled Down)`,
      variantMetadata: {
        baseStrategyName: strategy.name,
        variantType: 'scaled_down',
        description:
          'Smaller positions and tighter stops for capital preservation and lower drawdown',
        modificationsApplied: modifications,
        expectedImpact: {
          winRate: 0.0,
          riskReward: -0.2,
          drawdown: -0.6,
        },
      },
    };
  }

  /**
   * Variant: scaled up
   * Larger position sizes with wider stops, aggressive growth mode.
   */
  public scaledUp(strategy: StrategyDSL): StrategyVariant {
    const newStrategy = this.clone(strategy);
    const modifications: string[] = [];

    if (newStrategy.sizing) {
      const origRisk = newStrategy.sizing.maxRiskPercent;
      const origPos = newStrategy.sizing.maxPositionPercent;
      newStrategy.sizing.maxRiskPercent = Math.min(origRisk * 1.5, 5);
      newStrategy.sizing.maxPositionPercent = Math.min(origPos * 1.5, 25);
      modifications.push(
        `Max risk increased from ${origRisk}% to ${newStrategy.sizing.maxRiskPercent}%`,
      );
      modifications.push(
        `Max position increased from ${origPos}% to ${newStrategy.sizing.maxPositionPercent}%`,
      );
    }

    if (newStrategy.exit.stopLoss) {
      const origStop = newStrategy.exit.stopLoss.value ?? 2;
      newStrategy.exit.stopLoss.value = origStop * 1.5;
      modifications.push(
        `Stop loss widened to ${newStrategy.exit.stopLoss.value}%`,
      );
    }

    return {
      ...newStrategy,
      name: `${strategy.name} (Scaled Up)`,
      variantMetadata: {
        baseStrategyName: strategy.name,
        variantType: 'scaled_up',
        description:
          'Larger positions and wider stops for accelerated growth in favorable conditions',
        modificationsApplied: modifications,
        expectedImpact: {
          winRate: 0.0,
          riskReward: 0.2,
          drawdown: 0.5,
        },
      },
    };
  }

  /**
   * Variant: filtered high quality
   * Tightens FilterSpec thresholds and adds cooldown.
   */
  public filteredHighQuality(strategy: StrategyDSL): StrategyVariant {
    const newStrategy = this.clone(strategy);
    const modifications: string[] = [];

    if (newStrategy.filters) {
      newStrategy.filters.minQualityScore = Math.min(
        1,
        Math.max(newStrategy.filters.minQualityScore, 0.75),
      );
      newStrategy.filters.minEdgeScore = Math.min(
        1,
        Math.max(newStrategy.filters.minEdgeScore, 0.7),
      );
      newStrategy.filters.maxCorrelation = Math.min(
        newStrategy.filters.maxCorrelation,
        0.5,
      );
      newStrategy.filters.cooldownBars = Math.max(
        newStrategy.filters.cooldownBars,
        3,
      );
      modifications.push(
        `Quality score threshold set to ${newStrategy.filters.minQualityScore}`,
      );
      modifications.push(
        `Edge score threshold set to ${newStrategy.filters.minEdgeScore}`,
      );
      modifications.push(
        `Max correlation tightened to ${newStrategy.filters.maxCorrelation}`,
      );
      modifications.push(
        `Cooldown bars raised to ${newStrategy.filters.cooldownBars}`,
      );
    }

    const originalMin = newStrategy.entry.minConfirmationsRequired ?? 1;
    newStrategy.entry.minConfirmationsRequired = Math.max(originalMin, 2);
    modifications.push(
      `Minimum confirmations raised to ${newStrategy.entry.minConfirmationsRequired}`,
    );

    return {
      ...newStrategy,
      name: `${strategy.name} (High Quality)`,
      variantMetadata: {
        baseStrategyName: strategy.name,
        variantType: 'filtered_high_quality',
        description:
          'Tightens filter thresholds and confirmations for highest-quality setups only',
        modificationsApplied: modifications,
        expectedImpact: {
          winRate: 0.15,
          riskReward: 0.05,
          drawdown: -0.35,
        },
      },
    };
  }

  /**
   * Generate variants with risk profiling
   */
  public generateRiskProfileVariants(
    strategy: StrategyDSL,
  ): Map<string, StrategyVariant> {
    const variants = new Map<string, StrategyVariant>();

    variants.set('conservative', this.scaledDown(strategy));
    variants.set('moderate', this.identityVariant(strategy));
    variants.set('aggressive', this.scaledUp(strategy));
    variants.set('quality_focused', this.filteredHighQuality(strategy));

    return variants;
  }

  private identityVariant(strategy: StrategyDSL): StrategyVariant {
    return {
      ...this.clone(strategy),
      variantMetadata: {
        baseStrategyName: strategy.name,
        variantType: 'identity',
        description: 'Base strategy with no modifications',
        modificationsApplied: [],
        expectedImpact: { winRate: 0, riskReward: 0, drawdown: 0 },
      },
    };
  }

  /**
   * Combine two variant types to create a hybrid.
   */
  public createHybridVariant(
    strategy: StrategyDSL,
    type1:
      | 'tight'
      | 'wide'
      | 'aggressive'
      | 'conservative'
      | 'regime'
      | 'scaled_down'
      | 'scaled_up'
      | 'quality',
    type2:
      | 'tight'
      | 'wide'
      | 'aggressive'
      | 'conservative'
      | 'regime'
      | 'scaled_down'
      | 'scaled_up'
      | 'quality',
  ): StrategyVariant {
    const getVariant = (t: string): StrategyVariant => {
      switch (t) {
        case 'tight':
          return this.tighterStops(strategy);
        case 'wide':
          return this.widerStops(strategy);
        case 'aggressive':
          return this.aggressiveEntry(strategy);
        case 'conservative':
          return this.conservativeEntry(strategy);
        case 'regime':
          return this.regimeAdapted(strategy);
        case 'scaled_down':
          return this.scaledDown(strategy);
        case 'scaled_up':
          return this.scaledUp(strategy);
        case 'quality':
          return this.filteredHighQuality(strategy);
        default:
          return this.identityVariant(strategy);
      }
    };

    const v1 = getVariant(type1);
    const v2 = getVariant(type2);

    const hybrid = JSON.parse(JSON.stringify(v1)) as StrategyDSL;

    // Merge: take v2's stop loss, sizing, and filter tightenings.
    if (v2.exit.stopLoss) {
      hybrid.exit.stopLoss = JSON.parse(
        JSON.stringify(v2.exit.stopLoss),
      );
    }

    if (v2.sizing) {
      hybrid.sizing = JSON.parse(JSON.stringify(v2.sizing));
    }

    if (v2.filters && hybrid.filters) {
      hybrid.filters.minQualityScore = Math.max(
        hybrid.filters.minQualityScore,
        v2.filters.minQualityScore,
      );
      hybrid.filters.minEdgeScore = Math.max(
        hybrid.filters.minEdgeScore,
        v2.filters.minEdgeScore,
      );
      hybrid.filters.maxCorrelation = Math.min(
        hybrid.filters.maxCorrelation,
        v2.filters.maxCorrelation,
      );
      hybrid.filters.cooldownBars = Math.max(
        hybrid.filters.cooldownBars,
        v2.filters.cooldownBars,
      );
    }

    return {
      ...hybrid,
      name: `${strategy.name} (${type1}+${type2})`,
      variantMetadata: {
        baseStrategyName: strategy.name,
        variantType: 'hybrid',
        description: `Combines ${type1} and ${type2} variant characteristics`,
        modificationsApplied: [
          ...v1.variantMetadata.modificationsApplied,
          ...v2.variantMetadata.modificationsApplied,
        ],
        expectedImpact: {
          winRate:
            (v1.variantMetadata.expectedImpact.winRate +
              v2.variantMetadata.expectedImpact.winRate) /
            2,
          riskReward:
            (v1.variantMetadata.expectedImpact.riskReward +
              v2.variantMetadata.expectedImpact.riskReward) /
            2,
          drawdown:
            (v1.variantMetadata.expectedImpact.drawdown +
              v2.variantMetadata.expectedImpact.drawdown) /
            2,
        },
      },
    };
  }
}

export default VariantGenerator;
