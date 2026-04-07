/**
 * EarlyRejector - "Don't waste backtest time on this" detection
 * Fast pattern matching against known anti-patterns and weak hypotheses
 */

import { StrategyDSL, RuleSet, Signal } from './pipeline';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface EarlyScreenResult {
  verdict: 'PASS' | 'SOFT_REJECT' | 'HARD_REJECT';
  confidence: number;
  reasoning: string;
  checks_failed: string[];
  checks_passed: string[];
  suggestions: string[];
  estimated_backtest_duration_ms?: number;
  risk_assessment: {
    overfitting_risk: number;
    lookback_bias_risk: number;
    regime_risk: number;
    liquidity_risk: number;
    crowding_risk: number;
    complexity_risk: number;
  };
}

export interface AntiPattern {
  name: string;
  description: string;
  indicators: string[];
  risk_level: 'low' | 'medium' | 'high';
}

// ============================================================================
// EARLY REJECTOR
// ============================================================================

export class EarlyRejector {
  private knownAntiPatterns: AntiPattern[] = [
    {
      name: 'too_many_entry_signals',
      description: 'More than 5 entry conditions - suggests overfitting',
      indicators: ['entry_count > 5'],
      risk_level: 'high',
    },
    {
      name: 'excessive_parameters',
      description: 'More than 10 parameters - severe overfitting risk',
      indicators: ['parameter_count > 10'],
      risk_level: 'high',
    },
    {
      name: 'short_lookback',
      description: 'Lookback < 60 bars - insufficient data for robust edge',
      indicators: ['lookback < 60'],
      risk_level: 'high',
    },
    {
      name: 'contradictory_signals',
      description:
        'Buy signals contradicting sell signals in same regime',
      indicators: ['signal_contradiction'],
      risk_level: 'high',
    },
    {
      name: 'common_crowded_approach',
      description:
        'Uses extremely common indicator combination - likely arbitraged away',
      indicators: ['rsi_oversold', 'moving_average_cross', 'bollinger_band'],
      risk_level: 'medium',
    },
    {
      name: 'no_risk_management',
      description: 'No stop-loss or position sizing rules defined',
      indicators: ['no_risk_rules'],
      risk_level: 'high',
    },
    {
      name: 'regime_naive',
      description:
        'No consideration of market regime - will fail in trending markets if range strategy',
      indicators: ['regime_agnostic'],
      risk_level: 'medium',
    },
  ];

  screen(strategy: StrategyDSL, memoryContext: any): EarlyScreenResult {
    const checks_passed: string[] = [];
    const checks_failed: string[] = [];
    const suggestions: string[] = [];

    const startTime = Date.now();

    // Check 1: Entry signal count
    const entry_count = strategy.rules.entry.length;
    if (entry_count > 5) {
      checks_failed.push(
        `Excessive entry signals (${entry_count} > 5) - overfitting risk`
      );
      suggestions.push('Reduce entry conditions to 2-3 most significant ones');
    } else if (entry_count > 0) {
      checks_passed.push(`Entry signal count reasonable (${entry_count})`);
    }

    // Check 2: Exit signal count
    const exit_count = strategy.rules.exit.length;
    if (exit_count === 0) {
      checks_failed.push('No exit conditions defined');
      suggestions.push('Add explicit exit signals or profit/loss targets');
    } else {
      checks_passed.push(`Exit signals defined (${exit_count})`);
    }

    // Check 3: Parameter count
    const param_count = (strategy.parameters || []).length;
    if (param_count > 10) {
      checks_failed.push(
        `Too many parameters (${param_count} > 10) - severe overfitting risk`
      );
      suggestions.push(
        'Reduce to 3-5 core parameters, eliminate redundant ones'
      );
    } else if (param_count > 0) {
      checks_passed.push(`Parameter count reasonable (${param_count})`);
    }

    // Check 4: Lookback periods
    const max_lookback = Math.max(
      ...strategy.rules.entry.map((s) => s.lookback || 0),
      ...strategy.rules.exit.map((s) => s.lookback || 0)
    );
    if (max_lookback < 10) {
      checks_failed.push(
        `Very short lookback (${max_lookback} bars) - insufficient data history`
      );
      suggestions.push('Use at least 20-50 bars of lookback history');
    } else if (max_lookback >= 20) {
      checks_passed.push(`Reasonable lookback period (${max_lookback} bars)`);
    }

    // Check 5: Risk management rules
    const has_risk_rules = (strategy.rules.risk_management || []).length > 0;
    if (!has_risk_rules) {
      checks_failed.push('No risk management rules defined');
      suggestions.push(
        'Add stop-loss (ATR-based or fixed %), max drawdown, or position sizing rules'
      );
    } else {
      checks_passed.push('Risk management rules defined');
    }

    // Check 6: Anti-pattern matching
    const matched_patterns = this.matchAntiPatterns(strategy);
    if (matched_patterns.length > 0) {
      checks_failed.push(
        `Known anti-patterns detected: ${matched_patterns.map((p) => p.name).join(', ')}`
      );
      matched_patterns.forEach((pattern) => {
        suggestions.push(
          `Avoid pattern "${pattern.name}": ${pattern.description}`
        );
      });
    } else {
      checks_passed.push('No obvious anti-patterns detected');
    }

    // Check 7: Edge hypothesis strength
    const edge_strength = this.assessEdgeHypothesis(strategy);
    if (edge_strength.confidence < 0.3) {
      checks_failed.push(
        `Weak edge hypothesis - mechanism unclear (confidence: ${(edge_strength.confidence * 100).toFixed(0)}%)`
      );
      suggestions.push(
        'Clarify the market inefficiency being exploited. What behavior or microstructure?'
      );
    } else if (edge_strength.confidence >= 0.6) {
      checks_passed.push(
        `Clear edge hypothesis identified (${edge_strength.mechanism})`
      );
    }

    // Check 8: Complexity vs benefit analysis
    const complexity = this.assessComplexity(strategy);
    if (complexity.ratio > 2.5) {
      checks_failed.push(
        `Complex strategy with unclear benefit (complexity:${complexity.ratio.toFixed(2)})`
      );
      suggestions.push(
        'Simplify: each rule should provide measurable edge improvement'
      );
    } else {
      checks_passed.push('Complexity justified by expected benefit');
    }

    // Check 9: Regime awareness
    const regime_aware = this.assessRegimeAwareness(strategy);
    if (!regime_aware.aware) {
      checks_failed.push('Strategy shows no regime awareness');
      suggestions.push(
        'Add regime filter (ADX, volatility, or trend detection) to adapt to market conditions'
      );
    } else {
      checks_passed.push('Strategy includes regime awareness');
    }

    // Check 10: Historical similarity check (if memory context provided)
    const similarity_check = this.checkHistoricalSimilarity(
      strategy,
      memoryContext
    );
    if (similarity_check.high_similarity_found) {
      checks_failed.push(
        `Similarity to known failures (${similarity_check.most_similar})`
      );
      suggestions.push(
        `This approach has been tried: ${similarity_check.failure_reason}`
      );
    } else if (similarity_check.passed) {
      checks_passed.push('No close similarity to past failures');
    }

    // Calculate risk assessment
    const risk_assessment = {
      overfitting_risk: Math.min(param_count / 10, 1.0),
      lookback_bias_risk: max_lookback < 50 ? 0.7 : 0.2,
      regime_risk: regime_aware.aware ? 0.2 : 0.6,
      liquidity_risk: 0.3,
      crowding_risk: matched_patterns.some((p) =>
        p.name.includes('crowded')
      )
        ? 0.7
        : 0.3,
      complexity_risk: complexity.ratio > 2.0 ? 0.6 : 0.2,
    };

    // Determine verdict
    let verdict: 'PASS' | 'SOFT_REJECT' | 'HARD_REJECT' = 'PASS';
    let confidence = 1.0;

    const hard_reject_conditions = [
      exit_count === 0,
      param_count > 15,
      !has_risk_rules,
      matched_patterns.some((p) => p.risk_level === 'high'),
    ];

    const soft_reject_conditions = [
      entry_count > 5,
      param_count > 10,
      max_lookback < 10,
      edge_strength.confidence < 0.3,
      complexity.ratio > 2.5,
    ];

    if (hard_reject_conditions.some((c) => c)) {
      verdict = 'HARD_REJECT';
      confidence = 0.9;
    } else if (soft_reject_conditions.filter((c) => c).length >= 2) {
      verdict = 'SOFT_REJECT';
      confidence = 0.7;
    }

    if (verdict !== 'PASS') {
      confidence -= checks_failed.length * 0.05;
    } else {
      confidence += checks_passed.length * 0.05;
    }

    confidence = Math.max(0.1, Math.min(confidence, 0.99));

    return {
      verdict,
      confidence,
      reasoning: this.buildReasoning(verdict, checks_failed, checks_passed),
      checks_failed,
      checks_passed,
      suggestions: suggestions.slice(0, 5),
      risk_assessment,
      estimated_backtest_duration_ms:
        100 + (param_count * 10 + entry_count * 5) * 1000,
    };
  }

  private matchAntiPatterns(strategy: StrategyDSL): AntiPattern[] {
    const matched: AntiPattern[] = [];

    for (const pattern of this.knownAntiPatterns) {
      let matches = 0;

      if (
        pattern.name === 'too_many_entry_signals' &&
        strategy.rules.entry.length > 5
      ) {
        matches++;
      }
      if (
        pattern.name === 'excessive_parameters' &&
        (strategy.parameters || []).length > 10
      ) {
        matches++;
      }
      if (
        pattern.name === 'short_lookback' &&
        Math.max(
          ...strategy.rules.entry.map((s) => s.lookback || 0)
        ) < 60
      ) {
        matches++;
      }
      if (
        pattern.name === 'no_risk_management' &&
        (!strategy.rules.risk_management || strategy.rules.risk_management.length === 0)
      ) {
        matches++;
      }
      if (pattern.name === 'common_crowded_approach') {
        const indicators = [
          ...strategy.rules.entry.map((s) => s.indicator),
          ...strategy.rules.exit.map((s) => s.indicator),
        ].join(' ');
        if (
          indicators.includes('rsi') &&
          indicators.includes('moving_average')
        ) {
          matches++;
        }
      }

      if (matches > 0) {
        matched.push(pattern);
      }
    }

    return matched;
  }

  private assessEdgeHypothesis(strategy: StrategyDSL): {
    confidence: number;
    mechanism: string;
  } {
    const description = (strategy.description || '').toLowerCase();
    let confidence = 0;
    let mechanism = '';

    const edgeKeywords: Record<string, string> = {
      'mean reversion': 'Behavioral overreaction/mean reversion',
      'trend following': 'Momentum/trend persistence',
      'breakout': 'Institutional accumulation at support/resistance',
      'oversold': 'Oversold bounce on panic selling',
      'overbought': 'Profit-taking on euphoria',
      'volatility': 'Volatility regime shift',
      'seasonality': 'Seasonal patterns and calendar effects',
      'pairs': 'Relative value/pairs trading',
      'momentum': 'Momentum continuation',
      'divergence': 'Price-indicator divergence mean reversion',
    };

    for (const [keyword, mech] of Object.entries(edgeKeywords)) {
      if (description.includes(keyword)) {
        confidence = Math.min(confidence + 0.3, 1.0);
        mechanism = mech;
      }
    }

    if (confidence === 0) {
      confidence = 0.2;
      mechanism = 'Unclear or unstated';
    }

    return { confidence, mechanism };
  }

  private assessComplexity(strategy: StrategyDSL): { ratio: number } {
    const signal_count = strategy.rules.entry.length + strategy.rules.exit.length;
    const param_count = (strategy.parameters || []).length;
    const risk_rule_count = (strategy.rules.risk_management || []).length;

    const total_complexity = signal_count + param_count * 0.5 + risk_rule_count;

    const expected_benefit_base = 1.0;
    const expected_benefit =
      expected_benefit_base +
      (strategy.rules.entry.length > 2 ? 0.3 : 0) +
      (risk_rule_count > 0 ? 0.2 : 0);

    const ratio = total_complexity / expected_benefit;

    return { ratio };
  }

  private assessRegimeAwareness(strategy: StrategyDSL): {
    aware: boolean;
  } {
    const rules_text = JSON.stringify(strategy.rules).toLowerCase();
    const parameters_text = JSON.stringify(strategy.parameters).toLowerCase();

    const regime_indicators = [
      'adx',
      'atr',
      'volatility',
      'regime',
      'trend_strength',
      'market_condition',
    ];

    const aware = regime_indicators.some(
      (ind) => rules_text.includes(ind) || parameters_text.includes(ind)
    );

    return { aware };
  }

  private checkHistoricalSimilarity(
    strategy: StrategyDSL,
    memoryContext: any
  ): {
    high_similarity_found: boolean;
    passed: boolean;
    most_similar: string;
    failure_reason: string;
  } {
    if (!memoryContext || !memoryContext.known_failures) {
      return {
        high_similarity_found: false,
        passed: true,
        most_similar: '',
        failure_reason: '',
      };
    }

    const strategy_text = `${strategy.name} ${strategy.description}`.toLowerCase();
    const keywords_from_strategy = strategy.rules.entry
      .map((s) => s.indicator)
      .concat(strategy.rules.exit.map((s) => s.indicator));

    for (const failure of memoryContext.known_failures) {
      let match_score = 0;

      for (const keyword of keywords_from_strategy) {
        if (failure.toLowerCase().includes(keyword)) {
          match_score += 1;
        }
      }

      if (match_score >= 3) {
        return {
          high_similarity_found: true,
          passed: false,
          most_similar: failure,
          failure_reason:
            'Similar strategy has been tested and failed - likely overfitting',
        };
      }
    }

    return {
      high_similarity_found: false,
      passed: true,
      most_similar: '',
      failure_reason: '',
    };
  }

  private buildReasoning(
    verdict: string,
    failed: string[],
    passed: string[]
  ): string {
    if (verdict === 'HARD_REJECT') {
      return `Strategy rejected: ${failed.slice(0, 2).join('; ')}. These are critical flaws that indicate the strategy will not produce robust edge.`;
    }

    if (verdict === 'SOFT_REJECT') {
      return `Strategy flagged for revision: ${failed.slice(0, 2).join('; ')}. These issues reduce confidence in edge robustness. Consider improvements before backtesting.`;
    }

    return `Strategy passes initial screening. ${passed.length} positive indicators detected. Recommend proceeding to critique and backtest.`;
  }
}

export default EarlyRejector;
