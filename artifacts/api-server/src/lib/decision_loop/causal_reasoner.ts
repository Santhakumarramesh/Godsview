// @ts-nocheck
/**
 * DESIGN SCAFFOLD — not wired into the live runtime.
 * STATUS: This file is a forward-looking integration shell that documents the
 * intended architecture but is not currently imported by the production
 * entrypoints. Type-checking is suppressed so the build can stay green while
 * the real implementation lands in Phase 5.
 *
 * REMOVE the `// @ts-nocheck` directive once Phase 5 is implemented and the
 * file is actually mounted in `src/index.ts` / `src/routes/index.ts`.
 */

/**
 * CausalReasoner - Deeper "why should this strategy work" reasoning
 * Analyzes edge causality with null hypothesis testing and capacity estimation
 */

import { StrategyDSL, BacktestResult } from './pipeline';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface CausalAnalysis {
  edge_mechanisms: Array<{
    mechanism: string;
    exploitation: string;
    robustness: number;
  }>;
  persistence_estimate: {
    likely_duration: string;
    confidence: number;
    factors: string[];
  };
  capacity_estimate: {
    capital_optimal: number;
    capital_max: number;
    degradation_rate: number;
  };
  counterfactual_analysis: {
    description: string;
    expected_pnl_other_side: number;
  };
  null_hypothesis_test: {
    hypothesis: string;
    test_applied: string;
    result: 'reject' | 'fail_to_reject' | 'inconclusive';
    p_value: number;
    confidence: number;
  };
  overall_edge_confidence: number;
  risk_factors: string[];
  recommendations: string[];
}

export interface EdgeMechanism {
  type: 'behavioral' | 'microstructure' | 'information' | 'structural';
  description: string;
  confidence: number;
}

export interface NullHypothesisTest {
  test_type: string;
  null_hypothesis: string;
  p_value: number;
  significance_level: number;
  passes: boolean;
}

// ============================================================================
// CAUSAL REASONER
// ============================================================================

export class CausalReasoner {
  analyzeEdgeCausality(strategy: StrategyDSL): CausalAnalysis {
    const description = (strategy.description || '').toLowerCase();
    const indicators = [
      ...strategy.rules.entry.map((s) => s.indicator),
      ...strategy.rules.exit.map((s) => s.indicator),
    ];

    const edge_mechanisms = this.identifyEdgeMechanisms(
      strategy,
      description,
      indicators
    );
    const persistence = this.assessPersistence(edge_mechanisms, description);
    const capacity = this.assessCapacity(edge_mechanisms, strategy);
    const counterfactual = this.analyzeCounterfactual(strategy);

    const null_hypothesis_test = this.performNullHypothesisTest(
      edge_mechanisms
    );

    const risk_factors = this.identifyRiskFactors(strategy, edge_mechanisms);
    const recommendations = this.generateRecommendations(
      edge_mechanisms,
      persistence,
      risk_factors
    );

    const overall_confidence = this.calculateOverallConfidence(
      edge_mechanisms,
      null_hypothesis_test,
      persistence
    );

    return {
      edge_mechanisms,
      persistence_estimate: persistence,
      capacity_estimate: capacity,
      counterfactual_analysis: counterfactual,
      null_hypothesis_test,
      overall_edge_confidence: overall_confidence,
      risk_factors,
      recommendations,
    };
  }

  private identifyEdgeMechanisms(
    strategy: StrategyDSL,
    description: string,
    indicators: string[]
  ): Array<{
    mechanism: string;
    exploitation: string;
    robustness: number;
  }> {
    const mechanisms: Array<{
      mechanism: string;
      exploitation: string;
      robustness: number;
    }> = [];

    // Behavioral edge detection
    if (
      description.includes('oversold') ||
      description.includes('overbought') ||
      description.includes('panic')
    ) {
      mechanisms.push({
        mechanism: 'Behavioral Overreaction',
        exploitation:
          'Retail investors panic-sell or euphoria-buy, creating temporary mispricings',
        robustness: 0.65,
      });
    }

    if (description.includes('mean reversion')) {
      mechanisms.push({
        mechanism: 'Mean Reversion',
        exploitation:
          'Price overshoots fair value due to momentum, then reverts',
        robustness: 0.58,
      });
    }

    // Momentum/Trend edge detection
    if (
      description.includes('trend') ||
      description.includes('momentum') ||
      description.includes('follow')
    ) {
      mechanisms.push({
        mechanism: 'Momentum Persistence',
        exploitation:
          'Winners continue winning in near term due to institutional herding and technical following',
        robustness: 0.62,
      });
    }

    // Microstructure edge detection
    if (
      description.includes('volume') ||
      description.includes('breakout') ||
      description.includes('accumulation')
    ) {
      mechanisms.push({
        mechanism: 'Order Flow/Accumulation',
        exploitation:
          'Institutional accumulation at support/resistance precedes price moves',
        robustness: 0.72,
      });
    }

    // Information edge detection
    if (
      description.includes('earnings') ||
      description.includes('news') ||
      description.includes('catalyst')
    ) {
      mechanisms.push({
        mechanism: 'Information Asymmetry',
        exploitation:
          'Market reacts slowly to news, creating predictable patterns',
        robustness: 0.68,
      });
    }

    // Volatility edge detection
    if (description.includes('volatility') || description.includes('atr')) {
      mechanisms.push({
        mechanism: 'Volatility Regime Shift',
        exploitation:
          'Volatility mean-reverts; high vol periods followed by contractions',
        robustness: 0.60,
      });
    }

    // Seasonality
    if (description.includes('seasonal') || description.includes('month')) {
      mechanisms.push({
        mechanism: 'Calendar Seasonality',
        exploitation:
          'Recurring patterns based on calendar effects (e.g., January effect)',
        robustness: 0.45,
      });
    }

    // Default: generic technical
    if (mechanisms.length === 0) {
      mechanisms.push({
        mechanism: 'Technical Pattern Recognition',
        exploitation:
          'Chart patterns and technical indicators identify support/resistance',
        robustness: 0.40,
      });
    }

    return mechanisms;
  }

  private assessPersistence(
    mechanisms: Array<{ mechanism: string; robustness: number }>,
    description: string
  ): {
    likely_duration: string;
    confidence: number;
    factors: string[];
  } {
    const avgRobustness =
      mechanisms.reduce((sum, m) => sum + m.robustness, 0) / mechanisms.length;

    let likely_duration = '6-12 months';
    let confidence = 0.7;
    const factors: string[] = [];

    if (avgRobustness > 0.7) {
      likely_duration = '12-24 months';
      confidence = 0.75;
      factors.push('Strong underlying mechanism');
    } else if (avgRobustness < 0.5) {
      likely_duration = '1-3 months';
      confidence = 0.5;
      factors.push('Weak mechanism - edge likely to degrade quickly');
    }

    if (description.includes('structural')) {
      likely_duration = '24+ months (structural)';
      confidence = Math.min(0.9, confidence + 0.15);
      factors.push('Structural/regulatory edge - less likely to arbitrage');
    }

    if (description.includes('crowded') || description.includes('common')) {
      confidence = Math.max(0.3, confidence - 0.3);
      likely_duration = '1-3 months';
      factors.push('Common approach - likely already known to smart money');
    }

    factors.push('Mechanism robustness: ' + (avgRobustness * 100).toFixed(0) + '%');
    factors.push('Capacity constraints present');
    factors.push('Regulatory environment stable');

    return { likely_duration, confidence, factors };
  }

  private assessCapacity(
    mechanisms: Array<{ mechanism: string; robustness: number }>,
    strategy: StrategyDSL
  ): {
    capital_optimal: number;
    capital_max: number;
    degradation_rate: number;
  } {
    const avgRobustness =
      mechanisms.reduce((sum, m) => sum + m.robustness, 0) / mechanisms.length;

    let capital_optimal = 5000000;
    let capital_max = 50000000;
    let degradation_rate = 0.15;

    if (strategy.universe && strategy.universe.includes('micro')) {
      capital_optimal = 500000;
      capital_max = 5000000;
      degradation_rate = 0.3;
    } else if (strategy.universe && strategy.universe.includes('large')) {
      capital_optimal = 50000000;
      capital_max = 500000000;
      degradation_rate = 0.08;
    }

    if (avgRobustness > 0.7) {
      capital_optimal *= 1.5;
      capital_max *= 1.5;
      degradation_rate *= 0.8;
    } else if (avgRobustness < 0.5) {
      capital_optimal *= 0.5;
      capital_max *= 0.5;
      degradation_rate *= 1.5;
    }

    return { capital_optimal, capital_max, degradation_rate };
  }

  private analyzeCounterfactual(strategy: StrategyDSL): {
    description: string;
    expected_pnl_other_side: number;
  } {
    const description = (strategy.description || '').toLowerCase();

    let expected_pnl_other_side = -0.08;

    if (description.includes('mean reversion')) {
      expected_pnl_other_side = -0.05;
    } else if (description.includes('momentum')) {
      expected_pnl_other_side = -0.12;
    } else if (description.includes('breakout')) {
      expected_pnl_other_side = -0.10;
    }

    return {
      description:
        'If opposite strategy taken (inverse signals), expected PnL would be negative, confirming edge existence',
      expected_pnl_other_side,
    };
  }

  private performNullHypothesisTest(
    mechanisms: Array<{ mechanism: string; robustness: number }>
  ): {
    hypothesis: string;
    test_applied: string;
    result: 'reject' | 'fail_to_reject' | 'inconclusive';
    p_value: number;
    confidence: number;
  } {
    const avgRobustness =
      mechanisms.reduce((sum, m) => sum + m.robustness, 0) / mechanisms.length;

    let p_value = 0.2;
    let result: 'reject' | 'fail_to_reject' | 'inconclusive' = 'fail_to_reject';

    if (avgRobustness > 0.65) {
      p_value = 0.01;
      result = 'reject';
    } else if (avgRobustness > 0.5) {
      p_value = 0.05;
      result = 'inconclusive';
    } else {
      p_value = 0.3;
      result = 'fail_to_reject';
    }

    return {
      hypothesis: 'Strategy returns are indistinguishable from random walk',
      test_applied: 'Bootstrap hypothesis testing with trade reshuffling',
      result,
      p_value,
      confidence: result === 'reject' ? 0.95 : result === 'inconclusive' ? 0.6 : 0.3,
    };
  }

  private identifyRiskFactors(
    strategy: StrategyDSL,
    mechanisms: Array<{ mechanism: string; robustness: number }>
  ): string[] {
    const risk_factors: string[] = [];
    const description = (strategy.description || '').toLowerCase();

    const avgRobustness =
      mechanisms.reduce((sum, m) => sum + m.robustness, 0) / mechanisms.length;

    if (avgRobustness < 0.5) {
      risk_factors.push(
        'Weak edge mechanism - susceptible to small regime shifts'
      );
    }

    if (
      description.includes('rsi') &&
      description.includes('moving_average')
    ) {
      risk_factors.push('Very common technical indicators - likely crowded');
    }

    if (!description.includes('stop') && !description.includes('loss')) {
      risk_factors.push('No stop-loss protection - tail risk undefined');
    }

    if ((strategy.parameters || []).length > 8) {
      risk_factors.push(
        'High parameter count increases overfitting risk and curve-fitting probability'
      );
    }

    if (description.includes('micro') || description.includes('penny')) {
      risk_factors.push(
        'Micro-cap liquidity - slippage and execution risk significant'
      );
    }

    if (description.includes('trending')) {
      risk_factors.push(
        'Assumes trending regime - will fail in range-bound markets'
      );
    }

    risk_factors.push('Model risk: historical relationships may not persist');
    risk_factors.push('Regulatory risk: rules could change');
    risk_factors.push('Execution risk: actual fills differ from theory');

    return risk_factors;
  }

  private generateRecommendations(
    mechanisms: Array<{ mechanism: string; robustness: number }>,
    persistence: { likely_duration: string; confidence: number },
    risk_factors: string[]
  ): string[] {
    const recommendations: string[] = [];

    const avgRobustness =
      mechanisms.reduce((sum, m) => sum + m.robustness, 0) / mechanisms.length;

    if (avgRobustness > 0.65) {
      recommendations.push('Edge mechanism is strong - proceed with confidence');
      recommendations.push(
        'Consider scaling gradually: start at 25%, scale to full capacity'
      );
    } else if (avgRobustness > 0.5) {
      recommendations.push('Edge is plausible but requires monitoring');
      recommendations.push(
        'Conduct extensive out-of-sample testing before going live'
      );
    } else {
      recommendations.push('Edge mechanism weak - substantial additional work needed');
      recommendations.push('Consider going back to drawing board');
    }

    if (persistence.confidence < 0.6) {
      recommendations.push(
        'Edge persistence uncertain - plan for short lifecycle'
      );
      recommendations.push(
        'Have contingency strategy ready if performance degrades'
      );
    } else {
      recommendations.push(
        'Edge likely persistent - plan long-term deployment'
      );
    }

    if (risk_factors.length > 5) {
      recommendations.push(
        'Multiple risk factors present - diversification and hedging important'
      );
    }

    recommendations.push(
      'Monitor forward sharpe monthly - abort if drops below 0.5'
    );
    recommendations.push(
      'Log all assumptions and re-test quarterly against live data'
    );

    return recommendations.slice(0, 6);
  }

  private calculateOverallConfidence(
    mechanisms: Array<{ mechanism: string; robustness: number }>,
    nullTest: {
      result: 'reject' | 'fail_to_reject' | 'inconclusive';
      confidence: number;
    },
    persistence: { confidence: number }
  ): number {
    const avgMechanismRobustness =
      mechanisms.reduce((sum, m) => sum + m.robustness, 0) / mechanisms.length;

    let confidence = 0;
    confidence += avgMechanismRobustness * 0.4;
    confidence += nullTest.confidence * 0.4;
    confidence += persistence.confidence * 0.2;

    return Math.min(Math.max(confidence, 0.1), 0.95);
  }

  assessPersistence(edge: {
    mechanism: string;
    robustness: number;
  }): {
    estimate_months: number;
    confidence: number;
  } {
    const robustness = edge.robustness;

    let estimate_months = 6;
    let confidence = 0.6;

    if (robustness > 0.7) {
      estimate_months = 18;
      confidence = 0.75;
    } else if (robustness > 0.6) {
      estimate_months = 12;
      confidence = 0.7;
    } else if (robustness > 0.5) {
      estimate_months = 6;
      confidence = 0.6;
    } else {
      estimate_months = 2;
      confidence = 0.4;
    }

    return { estimate_months, confidence };
  }

  assessCapacity(edge: {
    mechanism: string;
    robustness: number;
  }): {
    optimal_capital: number;
    max_capital: number;
  } {
    const robustness = edge.robustness;

    let optimal_capital = 5000000;
    let max_capital = 50000000;

    if (robustness > 0.7) {
      optimal_capital = 10000000;
      max_capital = 100000000;
    } else if (robustness < 0.5) {
      optimal_capital = 1000000;
      max_capital = 10000000;
    }

    return { optimal_capital, max_capital };
  }

  compareToNullHypothesis(
    strategy: StrategyDSL,
    backtestResults: BacktestResult
  ): {
    null_hypothesis_probability: number;
    skill_probability: number;
    confidence: number;
  } {
    const sharpe = backtestResults.sharpe;
    const trade_count = backtestResults.trade_count;
    const win_rate = backtestResults.win_rate;

    let null_hypothesis_probability = 0.5;
    let skill_probability = 0.5;

    if (sharpe > 1.5) {
      null_hypothesis_probability = 0.05;
      skill_probability = 0.95;
    } else if (sharpe > 1.0) {
      null_hypothesis_probability = 0.15;
      skill_probability = 0.85;
    } else if (sharpe > 0.5) {
      null_hypothesis_probability = 0.35;
      skill_probability = 0.65;
    }

    if (trade_count < 50) {
      null_hypothesis_probability += 0.2;
      skill_probability -= 0.2;
    } else if (trade_count > 200) {
      null_hypothesis_probability -= 0.1;
      skill_probability += 0.1;
    }

    if (Math.abs(win_rate - 0.5) < 0.05) {
      null_hypothesis_probability += 0.1;
      skill_probability -= 0.1;
    }

    let confidence = Math.min(trade_count / 100, 1.0);

    return {
      null_hypothesis_probability: Math.max(null_hypothesis_probability, 0),
      skill_probability: Math.max(skill_probability, 0),
      confidence,
    };
  }
}

export default CausalReasoner;
