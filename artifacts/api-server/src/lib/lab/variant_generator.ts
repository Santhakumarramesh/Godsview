import { StrategyDSL, FilterSpec } from './strategy_dsl';

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
 * Generates multiple strategy variants from a base strategy DSL
 * Each variant modifies specific parameters in systematic ways
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

  /**
   * Variant: tighter stops (2% below base)
   * Lower exit threshold, higher % of winning trades but smaller profits
   */
  public tighterStops(strategy: StrategyDSL): StrategyVariant {
    const newStrategy = JSON.parse(
      JSON.stringify(strategy)
    ) as StrategyDSL;

    if (newStrategy.exit.stopLoss && typeof newStrategy.exit.stopLoss === 'object') {
      const currentStop = newStrategy.exit.stopLoss.value || 2;
      newStrategy.exit.stopLoss.value = Math.max(0.5, currentStop * 0.5);
    }

    const modifications: string[] = [];
    modifications.push(
      `Stop loss reduced from ${strategy.exit.stopLoss?.value || 2}% to ${newStrategy.exit.stopLoss?.value || 1}%`
    );

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
   * Higher threshold, larger stop but more patience for trades
   */
  public widerStops(strategy: StrategyDSL): StrategyVariant {
    const newStrategy = JSON.parse(
      JSON.stringify(strategy)
    ) as StrategyDSL;

    if (newStrategy.exit.stopLoss && typeof newStrategy.exit.stopLoss === 'object') {
      const currentStop = newStrategy.exit.stopLoss.value || 2;
      newStrategy.exit.stopLoss.value = currentStop * 2;
    }

    const modifications: string[] = [];
    modifications.push(
      `Stop loss increased from ${strategy.exit.stopLoss?.value || 2}% to ${newStrategy.exit.stopLoss?.value || 4}%`
    );

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
   * Removes some confirmation requirements, enters sooner
   */
  public aggressiveEntry(strategy: StrategyDSL): StrategyVariant {
    const newStrategy = JSON.parse(
      JSON.stringify(strategy)
    ) as StrategyDSL;

    const currentBars = newStrategy.entry.confirmationBars ?? 1;
    if (currentBars > 1) {
      newStrategy.entry.confirmationBars = Math.max(1, currentBars - 1);
    }

    const modifications: string[] = [];
    modifications.push(
      `Confirmation bars reduced from ${strategy.entry.confirmationBars} to ${newStrategy.entry.confirmationBars}`
    );

    if (newStrategy.filters && newStrategy.filters.length > 0) {
      newStrategy.filters = newStrategy.filters.slice(
        0,
        Math.max(0, newStrategy.filters.length - 1)
      );
      modifications.push('Removed 1 filter for faster entries');
    }

    return {
      ...newStrategy,
      name: `${strategy.name} (Aggressive Entry)`,
      variantMetadata: {
        baseStrategyName: strategy.name,
        variantType: 'aggressive_entry',
        description:
          'Reduces confirmation requirements to enter trades faster with less filter restrictions',
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
   * Adds confirmation bars and stricter filters
   */
  public conservativeEntry(strategy: StrategyDSL): StrategyVariant {
    const newStrategy = JSON.parse(
      JSON.stringify(strategy)
    ) as StrategyDSL;

    newStrategy.entry.confirmationBars =
      (newStrategy.entry.confirmationBars || 1) + 1;

    const modifications: string[] = [];
    modifications.push(
      `Confirmation bars increased from ${strategy.entry.confirmationBars} to ${newStrategy.entry.confirmationBars}`
    );

    const hasVolatilityFilter = newStrategy.filters?.some(
      (f) => f.type === 'volatility'
    );
    if (!hasVolatilityFilter) {
      newStrategy.filters = newStrategy.filters || [];
      newStrategy.filters.push({
        type: 'volatility',
        minAtr: 0.5,
        maxAtr: 2.0,
      });
      modifications.push('Added volatility filter for stable entries');
    }

    return {
      ...newStrategy,
      name: `${strategy.name} (Conservative Entry)`,
      variantMetadata: {
        baseStrategyName: strategy.name,
        variantType: 'conservative_entry',
        description:
          'Increases confirmation bars and adds filters to reduce false signals',
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
   * Adds trend and volatility filters for better regime alignment
   */
  public regimeAdapted(strategy: StrategyDSL): StrategyVariant {
    const newStrategy = JSON.parse(
      JSON.stringify(strategy)
    ) as StrategyDSL;

    newStrategy.filters = newStrategy.filters || [];
    const modifications: string[] = [];

    const hasTrendFilter = newStrategy.filters.some(
      (f) => f.type === 'trend'
    );
    if (!hasTrendFilter) {
      newStrategy.filters.push({
        type: 'trend',
        direction: 'any',
        strength: 'moderate',
      });
      modifications.push('Added trend detection filter');
    }

    const hasVolumeFilter = newStrategy.filters.some(
      (f) => f.type === 'volume'
    );
    if (!hasVolumeFilter) {
      newStrategy.filters.push({
        type: 'volume',
        minVolume: 1000000,
      });
      modifications.push('Added minimum volume filter');
    }

    return {
      ...newStrategy,
      name: `${strategy.name} (Regime Adapted)`,
      variantMetadata: {
        baseStrategyName: strategy.name,
        variantType: 'regime_adapted',
        description:
          'Adds regime and volume filters to improve market condition alignment',
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
   * Smaller position sizes, tighter stops, focus on preservation
   */
  public scaledDown(strategy: StrategyDSL): StrategyVariant {
    const newStrategy = JSON.parse(
      JSON.stringify(strategy)
    ) as StrategyDSL;

    if (newStrategy.sizing) {
      newStrategy.sizing.baseSize =
        (newStrategy.sizing.baseSize || 1) * 0.5;
      newStrategy.sizing.maxSize =
        (newStrategy.sizing.maxSize || 0.02) * 0.5;
    }

    if (newStrategy.exit.stopLoss && typeof newStrategy.exit.stopLoss === 'object') {
      newStrategy.exit.stopLoss.value =
        (newStrategy.exit.stopLoss.value || 2) * 0.75;
    }

    const modifications: string[] = [];
    modifications.push(
      'Position size reduced by 50% for capital preservation'
    );
    modifications.push(
      `Stop loss tightened to ${newStrategy.exit.stopLoss?.value || 1.5}%`
    );

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
   * Larger position sizes with wider stops, aggressive growth mode
   */
  public scaledUp(strategy: StrategyDSL): StrategyVariant {
    const newStrategy = JSON.parse(
      JSON.stringify(strategy)
    ) as StrategyDSL;

    if (newStrategy.sizing) {
      newStrategy.sizing.baseSize =
        (newStrategy.sizing.baseSize || 1) * 1.5;
      newStrategy.sizing.maxSize =
        Math.min((newStrategy.sizing.maxSize || 0.02) * 1.5, 0.1);
    }

    if (newStrategy.exit.stopLoss && typeof newStrategy.exit.stopLoss === 'object') {
      newStrategy.exit.stopLoss.value =
        (newStrategy.exit.stopLoss.value || 2) * 1.5;
    }

    const modifications: string[] = [];
    modifications.push(
      'Position size increased by 50% for aggressive growth'
    );
    modifications.push(
      `Stop loss widened to ${newStrategy.exit.stopLoss?.value || 3}%`
    );

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
   * Adds comprehensive filters to reduce false signals
   */
  public filteredHighQuality(
    strategy: StrategyDSL
  ): StrategyVariant {
    const newStrategy = JSON.parse(
      JSON.stringify(strategy)
    ) as StrategyDSL;

    newStrategy.filters = newStrategy.filters || [];
    const modifications: string[] = [];

    const requiredFilters: FilterSpec[] = [
      {
        type: 'trend',
        direction: 'any',
        strength: 'moderate',
      },
      {
        type: 'volatility',
        minAtr: 0.3,
        maxAtr: 3.0,
      },
      {
        type: 'volume',
        minVolume: 1000000,
      },
      {
        type: 'time',
        allowedHours: [9, 16],
        excludeWeekends: true,
      },
    ];

    requiredFilters.forEach((newFilter) => {
      const exists = newStrategy.filters?.some(
        (f) => f.type === newFilter.type
      );
      if (!exists) {
        newStrategy.filters?.push(newFilter);
        modifications.push(`Added ${newFilter.type} filter`);
      }
    });

    newStrategy.entry.confirmationBars =
      Math.max(newStrategy.entry.confirmationBars || 1, 2);
    modifications.push('Increased confirmation bars to 2 minimum');

    return {
      ...newStrategy,
      name: `${strategy.name} (High Quality)`,
      variantMetadata: {
        baseStrategyName: strategy.name,
        variantType: 'filtered_high_quality',
        description:
          'Comprehensive filters targeting only highest quality setups with strong confirmations',
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
   * Returns variants tuned to different risk tolerance levels
   */
  public generateRiskProfileVariants(
    strategy: StrategyDSL
  ): Map<string, StrategyVariant> {
    const variants = new Map<string, StrategyVariant>();

    variants.set('conservative', this.scaledDown(strategy));
    variants.set('moderate', strategy as any);
    variants.set('aggressive', this.scaledUp(strategy));
    variants.set('quality_focused', this.filteredHighQuality(strategy));

    return variants;
  }

  /**
   * Combine two variant types to create hybrid
   */
  public createHybridVariant(
    strategy: StrategyDSL,
    type1: 'tight' | 'wide' | 'aggressive' | 'conservative' | 'regime' | 'scaled_down' | 'scaled_up' | 'quality',
    type2: 'tight' | 'wide' | 'aggressive' | 'conservative' | 'regime' | 'scaled_down' | 'scaled_up' | 'quality'
  ): StrategyVariant {
    let hybrid = JSON.parse(
      JSON.stringify(strategy)
    ) as StrategyDSL;

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
          return strategy as any;
      }
    };

    const v1 = getVariant(type1);
    const v2 = getVariant(type2);

    hybrid = JSON.parse(JSON.stringify(v1)) as StrategyDSL;

    if (v2.exit.stopLoss && typeof v2.exit.stopLoss === 'object') {
      hybrid.exit.stopLoss = v2.exit.stopLoss;
    }

    if (v2.sizing) {
      hybrid.sizing = v2.sizing;
    }

    if (v2.filters) {
      v2.filters.forEach((f) => {
        if (
          !hybrid.filters?.some(
            (existing) => existing.type === f.type
          )
        ) {
          hybrid.filters?.push(f);
        }
      });
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
