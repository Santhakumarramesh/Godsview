/**
 * AmbiguityResolver - Handles vague/contradictory strategy descriptions
 * Acts like a senior quant clarifying ambiguous ideas
 */

import { StrategyDSL, Signal, RiskRule, StrategyParameter, RuleSet } from './pipeline';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface ResolvedInterpretation {
  dsl: StrategyDSL;
  confidence: number;
  assumptions: string[];
  ambiguities: string[];
  clarifyingQuestions: string[];
}

export interface AmbiguityAnalysis {
  detected_ambiguities: {
    type: string;
    description: string;
    impact: 'low' | 'medium' | 'high';
  }[];
  contradictions: {
    element1: string;
    element2: string;
    conflict: string;
  }[];
  vagueness_score: number;
  interpretability_score: number;
}

// ============================================================================
// AMBIGUITY RESOLVER
// ============================================================================

export class AmbiguityResolver {
  private commonIndicators = new Set([
    'rsi',
    'macd',
    'bollinger_bands',
    'moving_average',
    'adx',
    'stochastic',
    'cci',
    'roc',
    'atr',
    'sma',
    'ema',
    'vwap',
    'obv',
    'vpt',
  ]);

  private commonConditions = new Set([
    'oversold',
    'overbought',
    'crossover',
    'crossunder',
    'above',
    'below',
    'above_moving_average',
    'below_moving_average',
    'breakout',
    'breakdown',
  ]);

  resolveAmbiguity(rawInput: string): ResolvedInterpretation[] {
    const analysis = this.analyzeAmbiguity(rawInput);
    const interpretations = this.generateInterpretations(rawInput, analysis);
    
    interpretations.sort((a, b) => b.confidence - a.confidence);
    
    return interpretations;
  }

  private analyzeAmbiguity(input: string): AmbiguityAnalysis {
    const lowerInput = input.toLowerCase();
    const detected_ambiguities: any[] = [];
    const contradictions: any[] = [];
    
    let vagueness_score = 0;
    
    if (
      lowerInput.includes('buy') &&
      !this.hasSpecificEntryCondition(input)
    ) {
      detected_ambiguities.push({
        type: 'vague_entry',
        description: 'Entry signal not clearly specified',
        impact: 'high',
      });
      vagueness_score += 0.3;
    }

    if (
      lowerInput.includes('trending') &&
      (lowerInput.includes('range') || lowerInput.includes('ranging'))
    ) {
      contradictions.push({
        element1: 'trending',
        element2: 'ranging',
        conflict:
          'Strategy description contains conflicting market regime assumptions',
      });
    }

    if (
      lowerInput.includes('mean reversion') &&
      (lowerInput.includes('follow') || lowerInput.includes('momentum'))
    ) {
      contradictions.push({
        element1: 'mean reversion',
        element2: 'momentum/trend following',
        conflict:
          'Mean reversion and momentum trading are opposite strategies',
      });
    }

    if (
      lowerInput.includes('risk') &&
      !this.hasRiskSpecification(input)
    ) {
      detected_ambiguities.push({
        type: 'vague_risk',
        description: 'Risk management approach not clearly defined',
        impact: 'high',
      });
      vagueness_score += 0.3;
    }

    if (
      lowerInput.includes('time') ||
      lowerInput.includes('holding') ||
      lowerInput.includes('duration')
    ) {
      if (!this.hasTimeframeSpecification(input)) {
        detected_ambiguities.push({
          type: 'vague_timeframe',
          description: 'Holding period or trade duration not specified',
          impact: 'medium',
        });
        vagueness_score += 0.2;
      }
    }

    if (
      lowerInput.includes('position') ||
      lowerInput.includes('size')
    ) {
      if (!this.hasPositionSizingSpec(input)) {
        detected_ambiguities.push({
          type: 'vague_position_sizing',
          description: 'Position sizing methodology not specified',
          impact: 'medium',
        });
        vagueness_score += 0.2;
      }
    }

    const wordCount = input.split(/\s+/).length;
    const specificity = Math.min(wordCount / 50, 1);
    const interpretability_score = Math.max(1 - vagueness_score, 0) * specificity;

    return {
      detected_ambiguities,
      contradictions,
      vagueness_score,
      interpretability_score,
    };
  }

  private generateInterpretations(
    rawInput: string,
    analysis: AmbiguityAnalysis
  ): ResolvedInterpretation[] {
    const interpretations: ResolvedInterpretation[] = [];
    
    const lowerInput = rawInput.toLowerCase();
    
    const hasContradictions = analysis.contradictions.length > 0;
    const ambiguityCount = analysis.detected_ambiguities.length;

    if (lowerInput.includes('rsi')) {
      interpretations.push(
        this.createRSIInterpretation(rawInput, hasContradictions, ambiguityCount)
      );
    }

    if (
      lowerInput.includes('moving average') ||
      lowerInput.includes('cross')
    ) {
      interpretations.push(
        this.createMovingAverageCrossInterpretation(
          rawInput,
          hasContradictions,
          ambiguityCount
        )
      );
    }

    if (
      lowerInput.includes('bollinger') ||
      lowerInput.includes('band')
    ) {
      interpretations.push(
        this.createBollingerBandInterpretation(
          rawInput,
          hasContradictions,
          ambiguityCount
        )
      );
    }

    if (
      lowerInput.includes('breakout') ||
      lowerInput.includes('breakdown')
    ) {
      interpretations.push(
        this.createBreakoutInterpretation(
          rawInput,
          hasContradictions,
          ambiguityCount
        )
      );
    }

    if (
      lowerInput.includes('trend') &&
      !lowerInput.includes('against')
    ) {
      interpretations.push(
        this.createTrendFollowingInterpretation(
          rawInput,
          hasContradictions,
          ambiguityCount
        )
      );
    }

    if (
      lowerInput.includes('mean reversion') ||
      lowerInput.includes('reverting')
    ) {
      interpretations.push(
        this.createMeanReversionInterpretation(
          rawInput,
          hasContradictions,
          ambiguityCount
        )
      );
    }

    if (interpretations.length === 0) {
      interpretations.push(this.createGenericInterpretation(rawInput));
    }

    return interpretations;
  }

  private createRSIInterpretation(
    input: string,
    hasContradictions: boolean,
    ambiguityCount: number
  ): ResolvedInterpretation {
    const lowerInput = input.toLowerCase();
    const isOversold = lowerInput.includes('oversold') || lowerInput.includes('low');
    const isOverbought = lowerInput.includes('overbought') || lowerInput.includes('high');

    const assumptions = [
      'RSI(14) is the primary indicator',
      isOversold ? 'Entry on RSI < 30 (oversold)' : 'Entry on RSI > 70 (overbought)',
      isOversold
        ? 'Exit on RSI > 50 or fixed stop-loss'
        : 'Exit on RSI < 50 or fixed stop-loss',
    ];

    const ambiguities: string[] = [];
    if (!isOversold && !isOverbought) {
      ambiguities.push('RSI threshold not specified (30, 50, or 70?)');
    }
    if (!lowerInput.includes('exit')) {
      ambiguities.push('Exit condition not specified');
    }
    if (!lowerInput.includes('stop') && !lowerInput.includes('loss')) {
      ambiguities.push('Stop-loss methodology undefined');
    }

    const confidence =
      0.8 - (ambiguityCount * 0.1 + (hasContradictions ? 0.2 : 0));

    return {
      dsl: {
        name: isOversold ? 'RSI Oversold Mean Reversion' : 'RSI Overbought Counter-Trend',
        description: `${input}. Interpretation: Use RSI(14) to identify ${
          isOversold ? 'oversold' : 'overbought'
        } conditions and trade mean reversion.`,
        rules: this.buildRSIRules(isOversold),
        parameters: [
          { name: 'rsi_period', type: 'int', default: 14, min: 5, max: 50 },
          {
            name: 'rsi_threshold',
            type: 'int',
            default: isOversold ? 30 : 70,
            min: 20,
            max: 80,
          },
          { name: 'stop_loss_pct', type: 'float', default: 0.02, min: 0.01, max: 0.1 },
          {
            name: 'profit_target_pct',
            type: 'float',
            default: 0.03,
            min: 0.01,
            max: 0.2,
          },
        ],
      },
      confidence: Math.max(confidence, 0.5),
      assumptions,
      ambiguities,
      clarifyingQuestions: [
        'What RSI period should be used? (common: 14)',
        'What is the exact entry threshold? (30, 20, or custom)',
        'What is the exit strategy? (fixed profit target, RSI > 50, or time-based)',
        'How should position size be determined? (fixed, Kelly criterion, or volatility-adjusted)',
      ],
    };
  }

  private createMovingAverageCrossInterpretation(
    input: string,
    hasContradictions: boolean,
    ambiguityCount: number
  ): ResolvedInterpretation {
    const lowerInput = input.toLowerCase();
    const isFastAboveSlow = !lowerInput.includes('below');

    const assumptions = [
      'Use two moving averages (fast and slow)',
      isFastAboveSlow
        ? 'Buy when fast MA crosses above slow MA'
        : 'Sell when fast MA crosses below slow MA',
      'Common periods: SMA(50) and SMA(200) or EMA(12) and EMA(26)',
    ];

    const ambiguities: string[] = [];
    if (!lowerInput.includes('50') && !lowerInput.includes('200')) {
      ambiguities.push('Moving average periods not specified');
    }
    if (!lowerInput.includes('sma') && !lowerInput.includes('ema')) {
      ambiguities.push('MA type not specified (SMA vs EMA)');
    }

    const confidence =
      0.75 - (ambiguityCount * 0.1 + (hasContradictions ? 0.2 : 0));

    return {
      dsl: {
        name: 'Moving Average Cross',
        description: `${input}. Interpretation: Trend-following strategy using moving average crossovers.`,
        rules: this.buildMAcrossRules(isFastAboveSlow),
        parameters: [
          { name: 'fast_period', type: 'int', default: 50, min: 10, max: 100 },
          { name: 'slow_period', type: 'int', default: 200, min: 100, max: 500 },
          {
            name: 'ma_type',
            type: 'string',
            default: 'sma',
          },
          { name: 'stop_loss_atr', type: 'float', default: 2.0, min: 1.0, max: 5.0 },
        ],
      },
      confidence: Math.max(confidence, 0.5),
      assumptions,
      ambiguities,
      clarifyingQuestions: [
        'What are the MA periods? (50/200, 20/50, 12/26)',
        'SMA or EMA?',
        'How is stop-loss defined? (ATR multiple, fixed %)',
        'Should the trade close automatically on crossunder?',
      ],
    };
  }

  private createBollingerBandInterpretation(
    input: string,
    hasContradictions: boolean,
    ambiguityCount: number
  ): ResolvedInterpretation {
    const lowerInput = input.toLowerCase();
    const isUpperBand = lowerInput.includes('upper') || lowerInput.includes('overbought');

    const assumptions = [
      'Use Bollinger Bands with default parameters (20, 2)',
      isUpperBand
        ? 'Short when price touches upper band'
        : 'Long when price touches lower band',
      'Exit at mid-band (20-period MA)',
    ];

    const ambiguities: string[] = [];
    if (!lowerInput.includes('20') && !lowerInput.includes('period')) {
      ambiguities.push('BB period not specified (assumed 20)');
    }
    if (!lowerInput.includes('standard')) {
      ambiguities.push('Standard deviation multiplier not specified (assumed 2)');
    }

    const confidence =
      0.72 - (ambiguityCount * 0.1 + (hasContradictions ? 0.2 : 0));

    return {
      dsl: {
        name: 'Bollinger Band Mean Reversion',
        description: `${input}. Interpretation: Mean reversion at Bollinger Band extremes.`,
        rules: this.buildBollingerRules(isUpperBand),
        parameters: [
          { name: 'bb_period', type: 'int', default: 20, min: 10, max: 50 },
          {
            name: 'bb_std_dev',
            type: 'float',
            default: 2.0,
            min: 1.0,
            max: 3.0,
          },
          { name: 'exit_at_midband', type: 'bool', default: true },
          { name: 'stop_loss_std_dev', type: 'float', default: 3.0, min: 2.0, max: 5.0 },
        ],
      },
      confidence: Math.max(confidence, 0.5),
      assumptions,
      ambiguities,
      clarifyingQuestions: [
        'BB period and std dev multiplier?',
        'Exit exactly at midband or with some flexibility?',
        'How is stop loss defined?',
        'Should size decrease if multiple touches?',
      ],
    };
  }

  private createBreakoutInterpretation(
    input: string,
    hasContradictions: boolean,
    ambiguityCount: number
  ): ResolvedInterpretation {
    const lowerInput = input.toLowerCase();
    const isBreakout = lowerInput.includes('breakout');

    const assumptions = [
      'Identify support/resistance levels',
      isBreakout
        ? 'Buy on breakout above resistance'
        : 'Sell on breakdown below support',
      'Use recent N-period highs/lows for levels',
    ];

    const ambiguities: string[] = [];
    if (!lowerInput.includes('high') && !lowerInput.includes('low')) {
      ambiguities.push('Lookback period for highs/lows not specified');
    }
    if (!lowerInput.includes('volume')) {
      ambiguities.push('Volume confirmation not mentioned');
    }

    const confidence =
      0.70 - (ambiguityCount * 0.1 + (hasContradictions ? 0.2 : 0));

    return {
      dsl: {
        name: isBreakout ? 'Breakout Strategy' : 'Breakdown Strategy',
        description: `${input}. Interpretation: ${
          isBreakout ? 'Buy' : 'Sell'
        } on ${
          isBreakout ? 'breakout' : 'breakdown'
        } of support/resistance.`,
        rules: this.buildBreakoutRules(isBreakout),
        parameters: [
          {
            name: 'lookback_period',
            type: 'int',
            default: 20,
            min: 5,
            max: 100,
          },
          {
            name: 'require_volume_confirmation',
            type: 'bool',
            default: true,
          },
          { name: 'stop_loss_pct', type: 'float', default: 0.03, min: 0.01, max: 0.1 },
          {
            name: 'profit_target_pct',
            type: 'float',
            default: 0.05,
            min: 0.01,
            max: 0.2,
          },
        ],
      },
      confidence: Math.max(confidence, 0.5),
      assumptions,
      ambiguities,
      clarifyingQuestions: [
        'What lookback period for highs/lows? (20, 50, 100)',
        'Should volume be confirmed?',
        'How should stop-loss be placed? (below/above extreme)',
        'Should position size scale with volatility?',
      ],
    };
  }

  private createTrendFollowingInterpretation(
    input: string,
    hasContradictions: boolean,
    ambiguityCount: number
  ): ResolvedInterpretation {
    const assumptions = [
      'Follow the trend identified by moving averages or price action',
      'Buy when price is above long-term MA, sell when below',
      'Use ADX or similar to confirm trend strength',
    ];

    const ambiguities: string[] = [];
    if (!input.toLowerCase().includes('adx')) {
      ambiguities.push('Trend strength confirmation not mentioned');
    }

    const confidence =
      0.68 - (ambiguityCount * 0.1 + (hasContradictions ? 0.3 : 0));

    return {
      dsl: {
        name: 'Trend Following',
        description: `${input}. Interpretation: Follow the primary trend.`,
        rules: this.buildTrendFollowingRules(),
        parameters: [
          { name: 'ma_period', type: 'int', default: 50, min: 20, max: 200 },
          { name: 'adx_threshold', type: 'int', default: 25, min: 15, max: 40 },
          { name: 'trailing_stop_atr', type: 'float', default: 2.0, min: 1.0, max: 5.0 },
        ],
      },
      confidence: Math.max(confidence, 0.5),
      assumptions,
      ambiguities,
      clarifyingQuestions: [
        'What constitutes "the trend"? (MA period, price action patterns)',
        'Should trend be confirmed with ADX or similar?',
        'How should trailing stop be set?',
        'How long should we stay in trend?',
      ],
    };
  }

  private createMeanReversionInterpretation(
    input: string,
    hasContradictions: boolean,
    ambiguityCount: number
  ): ResolvedInterpretation {
    const assumptions = [
      'Strategy exploits short-term overshoots from fair value',
      'Buy when price drops significantly, sell when it recovers',
      'Use volatility bands or historical std dev',
    ];

    const ambiguities: string[] = [];
    if (!input.toLowerCase().includes('recover')) {
      ambiguities.push('Recovery target not specified');
    }

    const confidence =
      0.70 - (ambiguityCount * 0.1 + (hasContradictions ? 0.3 : 0));

    return {
      dsl: {
        name: 'Mean Reversion',
        description: `${input}. Interpretation: Trade mean reversion to fair value.`,
        rules: this.buildMeanReversionRules(),
        parameters: [
          { name: 'std_dev_periods', type: 'int', default: 20, min: 10, max: 50 },
          { name: 'entry_std_dev', type: 'float', default: 2.0, min: 1.0, max: 3.0 },
          { name: 'exit_std_dev', type: 'float', default: 0.5, min: 0.1, max: 1.0 },
          { name: 'stop_loss_std_dev', type: 'float', default: 3.5, min: 2.5, max: 5.0 },
        ],
      },
      confidence: Math.max(confidence, 0.5),
      assumptions,
      ambiguities,
      clarifyingQuestions: [
        'What is "fair value"? (MA, midband, or equilibrium price)',
        'How many standard deviations for entry?',
        'How many standard deviations for exit?',
        'Should this work across all market regimes?',
      ],
    };
  }

  private createGenericInterpretation(input: string): ResolvedInterpretation {
    return {
      dsl: {
        name: 'Custom Strategy',
        description: input,
        rules: {
          entry: [
            {
              indicator: 'custom',
              condition: 'User-defined condition',
              lookback: 20,
            },
          ],
          exit: [
            {
              indicator: 'custom',
              condition: 'User-defined condition',
              lookback: 20,
            },
          ],
        },
        parameters: [
          {
            name: 'param_1',
            type: 'float',
            default: 0.1,
            min: 0.01,
            max: 1.0,
          },
        ],
      },
      confidence: 0.4,
      assumptions: ['Requires manual specification and clarification'],
      ambiguities: ['Complete strategy specification needed'],
      clarifyingQuestions: [
        'Can you describe the specific entry trigger?',
        'How is the exit determined?',
        'What is the target market regime (trending/ranging)?',
        'What is the typical holding period?',
        'Are there specific risk management rules?',
      ],
    };
  }

  private buildRSIRules(isOversold: boolean): RuleSet {
    return {
      entry: [
        {
          indicator: 'rsi',
          condition: isOversold ? 'oversold' : 'overbought',
          threshold: isOversold ? 30 : 70,
          lookback: 14,
        },
      ],
      exit: [
        {
          indicator: 'rsi',
          condition: isOversold ? 'above' : 'below',
          threshold: 50,
          lookback: 14,
        },
      ],
      risk_management: [
        { type: 'fixed_stop_loss', value: 0.02, applies_to: 'all_trades' },
        {
          type: 'profit_target',
          value: 0.03,
          applies_to: 'all_trades',
        },
      ],
    };
  }

  private buildMAcrossRules(isFastAboveSlow: boolean): RuleSet {
    return {
      entry: [
        {
          indicator: 'moving_average_cross',
          condition: isFastAboveSlow ? 'crossover' : 'crossunder',
          lookback: 50,
        },
      ],
      exit: [
        {
          indicator: 'moving_average_cross',
          condition: isFastAboveSlow ? 'crossunder' : 'crossover',
          lookback: 50,
        },
      ],
      risk_management: [
        { type: 'atr_stop', value: 2.0, applies_to: 'all_trades' },
      ],
    };
  }

  private buildBollingerRules(isUpperBand: boolean): RuleSet {
    return {
      entry: [
        {
          indicator: 'bollinger_bands',
          condition: isUpperBand ? 'touch_upper' : 'touch_lower',
          threshold: 2.0,
          lookback: 20,
        },
      ],
      exit: [
        {
          indicator: 'bollinger_bands',
          condition: 'touch_middle',
          lookback: 20,
        },
      ],
      risk_management: [
        {
          type: 'bollinger_band_stop',
          value: 3.0,
          applies_to: 'all_trades',
        },
      ],
    };
  }

  private buildBreakoutRules(isBreakout: boolean): RuleSet {
    return {
      entry: [
        {
          indicator: 'breakout',
          condition: isBreakout ? 'above_high' : 'below_low',
          lookback: 20,
        },
      ],
      exit: [
        {
          indicator: 'fixed_target',
          condition: 'profit_target_reached',
          threshold: 0.05,
          lookback: 1,
        },
      ],
      risk_management: [
        { type: 'fixed_stop_loss', value: 0.03, applies_to: 'all_trades' },
      ],
    };
  }

  private buildTrendFollowingRules(): RuleSet {
    return {
      entry: [
        {
          indicator: 'moving_average',
          condition: 'above',
          lookback: 50,
        },
        {
          indicator: 'adx',
          condition: 'above',
          threshold: 25,
          lookback: 14,
        },
      ],
      exit: [
        {
          indicator: 'moving_average',
          condition: 'below',
          lookback: 50,
        },
      ],
      risk_management: [
        { type: 'atr_trailing_stop', value: 2.0, applies_to: 'all_trades' },
      ],
    };
  }

  private buildMeanReversionRules(): RuleSet {
    return {
      entry: [
        {
          indicator: 'bollinger_bands',
          condition: 'touch_lower',
          threshold: 2.0,
          lookback: 20,
        },
      ],
      exit: [
        {
          indicator: 'bollinger_bands',
          condition: 'near_middle',
          threshold: 0.5,
          lookback: 20,
        },
      ],
      risk_management: [
        {
          type: 'bollinger_band_stop',
          value: 3.5,
          applies_to: 'all_trades',
        },
      ],
    };
  }

  private hasSpecificEntryCondition(input: string): boolean {
    const lowerInput = input.toLowerCase();
    return (
      Array.from(this.commonIndicators).some((ind) => lowerInput.includes(ind)) &&
      Array.from(this.commonConditions).some((cond) => lowerInput.includes(cond))
    );
  }

  private hasRiskSpecification(input: string): boolean {
    const lowerInput = input.toLowerCase();
    return (
      lowerInput.includes('stop') ||
      lowerInput.includes('loss') ||
      lowerInput.includes('risk') ||
      lowerInput.includes('atr') ||
      lowerInput.includes('percent')
    );
  }

  private hasTimeframeSpecification(input: string): boolean {
    const lowerInput = input.toLowerCase();
    return (
      lowerInput.includes('minute') ||
      lowerInput.includes('hour') ||
      lowerInput.includes('day') ||
      lowerInput.includes('week') ||
      lowerInput.includes('month') ||
      lowerInput.includes('holding') ||
      /\d+\s*(min|hour|day)/.test(input)
    );
  }

  private hasPositionSizingSpec(input: string): boolean {
    const lowerInput = input.toLowerCase();
    return (
      lowerInput.includes('kelly') ||
      lowerInput.includes('volatility') ||
      lowerInput.includes('fixed') ||
      lowerInput.includes('atr') ||
      lowerInput.includes('size')
    );
  }
}

export default AmbiguityResolver;
