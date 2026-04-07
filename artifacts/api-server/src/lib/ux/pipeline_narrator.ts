/**
 * PipelineNarrator - Translates pipeline steps into clear plain English
 * Provides human-readable explanations for every stage of strategy evaluation
 */

export interface PipelineStep {
  id: string;
  name: string;
  stage: number;
  timestamp: number;
  input: any;
  output: any;
  duration: number;
}

export interface StepResult {
  success: boolean;
  data: any;
  error?: string;
  warnings: string[];
  metrics: Record<string, number>;
}

export interface ConfidenceIndicator {
  level: 'HIGH' | 'MEDIUM' | 'LOW';
  reasoning: string;
  score: number;
}

export interface NarrativeBlock {
  headline: string;
  body: string;
  confidence: ConfidenceIndicator;
  nextStep: string;
  actionNeeded: boolean;
  actionDescription?: string;
}

export interface KeyFinding {
  category: 'strength' | 'weakness' | 'risk' | 'opportunity';
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
}

export interface FullNarrative {
  executiveSummary: string;
  keyFindings: KeyFinding[];
  overallRecommendation: {
    action: 'proceed' | 'improve' | 'reject';
    reasoning: string;
    confidence: number;
  };
  comparison?: {
    similarPastStrategies: string;
    differentiators: string;
  };
  timeline: string;
}

export interface EarlyScreenResult {
  rejected: boolean;
  reasons: string[];
  failedCriteria: Array<{
    criterion: string;
    threshold: number;
    actual: number;
    required: string;
  }>;
}

export interface PipelineState {
  strategyId: string;
  steps: Array<{
    name: string;
    status: 'completed' | 'failed' | 'skipped';
    result: StepResult;
  }>;
  timestamp: number;
  overallStatus: 'completed' | 'failed' | 'in_progress';
}

export interface ImprovementNarrative {
  summary: string;
  improvements: Array<{
    metric: string;
    before: number;
    after: number;
    percentChange: number;
    explanation: string;
  }>;
  worsenedAreas: Array<{
    metric: string;
    before: number;
    after: number;
    percentChange: number;
    explanation: string;
  }>;
  netAssessment: string;
}

export interface ComparisonNarrative {
  strategyAName: string;
  strategyBName: string;
  dimensionComparisons: Array<{
    dimension: string;
    strategyA: {
      value: string;
      numeric?: number;
    };
    strategyB: {
      value: string;
      numeric?: number;
    };
    winner: 'A' | 'B' | 'tie';
    explanation: string;
  }>;
  recommendation: string;
}

export interface DiffNarrative {
  summary: string;
  improvements: Array<{
    aspect: string;
    change: string;
    reason: string;
  }>;
  regressions: Array<{
    aspect: string;
    change: string;
    reason: string;
  }>;
  overallTrend: 'improving' | 'degrading' | 'stable';
}

const PIPELINE_STAGE_NARRATIVES: Record<string, (result: StepResult) => NarrativeBlock> = {
  concept_validation: (result) => ({
    headline: result.success
      ? 'Your strategy concept is valid'
      : 'Strategy concept needs refinement',
    body: result.success
      ? 'The core idea passes logical checks and aligns with market mechanics. The strategy targets a real, exploitable edge based on your parameters.'
      : 'The concept as defined does not align with known market mechanics or has logical inconsistencies. Consider reviewing the core assumptions.',
    confidence: {
      level: result.success ? 'HIGH' : 'MEDIUM',
      reasoning: result.success
        ? 'Validation uses established frameworks'
        : 'Concept-stage risks are inherent',
      score: result.success ? 0.85 : 0.45,
    },
    nextStep: result.success
      ? 'Next: historical data will be tested against this concept'
      : 'Pause here and refine the strategy logic',
    actionNeeded: !result.success,
    actionDescription: result.success
      ? undefined
      : 'Review strategy rules and adjust parameters',
  }),

  data_validation: (result) => ({
    headline: result.success
      ? 'Historical data passed quality checks'
      : 'Data quality issues detected',
    body: result.success
      ? 'All required price, volume, and fundamental data is available, complete, and within expected ranges. No significant gaps or anomalies found.'
      : `Data problems found: ${result.warnings.join(', ')}. These may impact backtest reliability.`,
    confidence: {
      level: result.metrics['missing_percent'] > 5 ? 'MEDIUM' : 'HIGH',
      reasoning:
        result.metrics['missing_percent'] > 5
          ? 'Missing data raises uncertainty'
          : 'Data is complete and clean',
      score: Math.max(0.5, 1 - result.metrics['missing_percent'] / 100),
    },
    nextStep: 'Historical backtest will now run using this validated data',
    actionNeeded: result.warnings.length > 0,
    actionDescription:
      result.warnings.length > 0
        ? 'Consider adjusting date range or symbols'
        : undefined,
  }),

  backtest_single_asset: (result) => ({
    headline: result.success
      ? 'Single-asset backtest shows promise'
      : 'Single-asset backtest did not meet criteria',
    body: result.success
      ? `The strategy generated a ${result.data.total_return}% return over the test period with a Sharpe ratio of ${result.data.sharpe}. Drawdown was ${result.data.max_drawdown}%.`
      : 'Performance metrics fell short of required thresholds. The edge may be weaker than expected or parameters may need tuning.',
    confidence: {
      level: result.metrics['sharpe'] > 1 ? 'HIGH' : 'MEDIUM',
      reasoning:
        result.metrics['sharpe'] > 1
          ? 'Risk-adjusted returns are solid'
          : 'Returns do not justify the risk taken',
      score: Math.min(1, result.metrics['sharpe'] / 2),
    },
    nextStep: result.success
      ? 'Performance will be tested across multiple similar assets'
      : 'Strategy needs parameter adjustment or may need to be abandoned',
    actionNeeded: !result.success,
    actionDescription: result.success ? undefined : 'Adjust entry/exit rules',
  }),

  backtest_multi_asset: (result) => ({
    headline: result.success
      ? 'Strategy generalizes across similar assets'
      : 'Strategy does not generalize well',
    body: result.success
      ? `Consistent performance across ${result.data.assets_tested} similar assets. Average return: ${result.data.avg_return}%. Consistency score: ${result.data.consistency}%.`
      : 'Performance varies significantly across assets, suggesting the edge may be asset-specific or parameters are over-tuned.',
    confidence: {
      level: result.metrics['consistency'] > 70 ? 'HIGH' : 'MEDIUM',
      reasoning:
        result.metrics['consistency'] > 70
          ? 'Results are robust across assets'
          : 'Over-fitting risk is elevated',
      score: result.metrics['consistency'] / 100,
    },
    nextStep:
      'Portfolio diversification effects will now be evaluated in multi-strategy context',
    actionNeeded: result.metrics['consistency'] < 60,
    actionDescription:
      result.metrics['consistency'] < 60
        ? 'Strategy may be too tightly calibrated to specific assets'
        : undefined,
  }),

  regime_analysis: (result) => ({
    headline: result.success
      ? 'Strategy performs across market conditions'
      : 'Strategy performance is regime-dependent',
    body: result.success
      ? `The strategy maintained edge in ${result.data.regimes_passed} of ${result.data.regimes_tested} market regimes. Performance in stress scenarios: ${result.data.stress_performance}%.`
      : 'Strategy only works in specific market conditions. When those conditions change, performance may deteriorate sharply.',
    confidence: {
      level:
        result.metrics['regimes_passed'] / result.metrics['regimes_tested'] >
        0.7
          ? 'HIGH'
          : 'MEDIUM',
      reasoning:
        result.metrics['regimes_passed'] / result.metrics['regimes_tested'] >
        0.7
          ? 'Robust across different markets'
          : 'Fragile to regime shifts',
      score:
        result.metrics['regimes_passed'] / result.metrics['regimes_tested'],
    },
    nextStep:
      'Live regime detection will be required to know when to apply this strategy',
    actionNeeded: true,
    actionDescription: 'Plan how to detect regime shifts in production',
  }),

  correlation_check: (result) => ({
    headline: result.success
      ? 'Portfolio diversification is maintained'
      : 'Correlation with existing strategies is too high',
    body: result.success
      ? `Average correlation with existing portfolio: ${result.data.avg_correlation}. Diversification benefit: ${result.data.diversification_benefit}%.`
      : 'This strategy moves too similarly to existing holdings. Adding it would concentrate rather than diversify risk.',
    confidence: {
      level: result.metrics['avg_correlation'] < 0.5 ? 'HIGH' : 'LOW',
      reasoning:
        result.metrics['avg_correlation'] < 0.5
          ? 'Genuine diversification benefit'
          : 'Redundant with existing strategies',
      score: Math.max(0, 1 - result.metrics['avg_correlation']),
    },
    nextStep: result.success
      ? 'Portfolio construction will optimize allocation'
      : 'This strategy should not be added to the live portfolio',
    actionNeeded: !result.success,
    actionDescription: result.success
      ? undefined
      : 'Consider modifying to target uncorrelated markets',
  }),

  risk_profile_check: (result) => ({
    headline: result.success
      ? 'Risk profile matches portfolio constraints'
      : 'Risk profile exceeds acceptable limits',
    body: result.success
      ? `Expected daily drawdown: ${result.data.expected_daily_dd}%. Maximum drawdown: ${result.data.max_dd}%. Volatility: ${result.data.volatility}%. All within acceptable bounds.`
      : 'This strategy carries more risk than the portfolio is designed to handle. Maximum drawdown or volatility exceeds limits.',
    confidence: {
      level: result.metrics['risk_score'] < 0.6 ? 'HIGH' : 'MEDIUM',
      reasoning:
        result.metrics['risk_score'] < 0.6
          ? 'Risk is well-controlled'
          : 'Risk is moderate to elevated',
      score: 1 - Math.min(1, result.metrics['risk_score']),
    },
    nextStep: result.success
      ? 'Position sizing will be calculated based on this risk profile'
      : 'Risk limits must be adjusted or strategy must be modified',
    actionNeeded: !result.success,
    actionDescription: result.success
      ? undefined
      : 'Reduce leverage or add stop-losses',
  }),

  cost_impact: (result) => ({
    headline: result.success
      ? 'Transaction costs do not eliminate the edge'
      : 'Costs are too high relative to expected returns',
    body: result.success
      ? `Expected costs: ${result.data.total_cost_bps} bps annually. After costs, strategy yields ${result.data.net_return_after_costs}% vs ${result.data.gross_return}% gross.`
      : 'After accounting for commissions, slippage, and market impact, the strategy may not be profitable.',
    confidence: {
      level: result.metrics['cost_ratio'] < 0.3 ? 'HIGH' : 'MEDIUM',
      reasoning:
        result.metrics['cost_ratio'] < 0.3
          ? 'Costs are modest relative to returns'
          : 'Costs consume a large portion of gains',
      score: Math.max(0, 1 - result.metrics['cost_ratio']),
    },
    nextStep: result.success
      ? 'Strategy will move to backtesting with realistic slippage assumptions'
      : 'Strategy may be unprofitable when real-world trading costs are included',
    actionNeeded: !result.success,
    actionDescription: result.success
      ? undefined
      : 'Increase holding periods or reduce turnover',
  }),

  slippage_analysis: (result) => ({
    headline: result.success
      ? 'Realistic slippage assumptions are incorporated'
      : 'Slippage may be underestimated',
    body: result.success
      ? `Historical average slippage: ${result.data.avg_slippage_bps} bps. Worst-case scenario: ${result.data.worst_case_slippage_bps} bps. Strategy remains profitable in both.`
      : 'Slippage appears to exceed historical averages for similar strategies or market conditions.',
    confidence: {
      level: result.metrics['slippage_reliability'] > 0.75 ? 'HIGH' : 'MEDIUM',
      reasoning:
        result.metrics['slippage_reliability'] > 0.75
          ? 'Good historical data supports estimates'
          : 'Slippage estimates are uncertain',
      score: result.metrics['slippage_reliability'],
    },
    nextStep:
      'Final performance metrics will include realistic slippage assumptions',
    actionNeeded: result.metrics['slippage_reliability'] < 0.6,
    actionDescription:
      result.metrics['slippage_reliability'] < 0.6
        ? 'Consider more conservative slippage estimates'
        : undefined,
  }),

  monte_carlo: (result) => ({
    headline: result.success
      ? 'Strategy is robust to market randomness'
      : 'Strategy may be brittle to market variations',
    body: result.success
      ? `Monte Carlo simulations (${result.data.iterations} runs) show ${result.data.success_rate}% remain profitable. 95th percentile drawdown: ${result.data.percentile_95_dd}%.`
      : 'Strategy performance varies widely in simulated market conditions. Outcomes are less certain than backtest suggests.',
    confidence: {
      level: result.metrics['robustness'] > 0.8 ? 'HIGH' : 'MEDIUM',
      reasoning:
        result.metrics['robustness'] > 0.8
          ? 'Consistent performance across scenarios'
          : 'Performance is scenario-dependent',
      score: result.metrics['robustness'],
    },
    nextStep:
      'Strategy passes statistical rigor checks and can proceed to live testing',
    actionNeeded: result.metrics['robustness'] < 0.7,
    actionDescription:
      result.metrics['robustness'] < 0.7
        ? 'Strategy may over-fit to historical data'
        : undefined,
  }),

  liquidity_stress: (result) => ({
    headline: result.success
      ? 'Positions can be scaled to planned size'
      : 'Liquidity constraints limit position size',
    body: result.success
      ? `Target position sizes (${result.data.target_size_pct}% of portfolio) represent ${result.data.market_impact_pct}% of typical daily volume. Execution time: ${result.data.execution_time} minutes.`
      : 'Planned position sizes exceed realistic market liquidity. Positions would face significant market impact.',
    confidence: {
      level: result.metrics['liquidity_score'] > 0.75 ? 'HIGH' : 'MEDIUM',
      reasoning:
        result.metrics['liquidity_score'] > 0.75
          ? 'Adequate liquidity for planned scale'
          : 'Scale limitations apply',
      score: result.metrics['liquidity_score'],
    },
    nextStep: result.success
      ? 'Position sizing will be locked in for deployment'
      : 'Position size targets must be reduced',
    actionNeeded: !result.success,
    actionDescription: result.success
      ? undefined
      : 'Plan for smaller, more gradual position builds',
  }),

  walk_forward: (result) => ({
    headline: result.success
      ? 'Strategy performance remains consistent forward-looking'
      : 'Performance degrades on unseen data',
    body: result.success
      ? `Walk-forward testing across ${result.data.windows} periods shows ${result.data.correlation_to_backtest}% correlation with original backtest. Return stability: ${result.data.return_stability}%.`
      : 'Strategy performs significantly worse on data not seen during optimization. This suggests over-fitting.',
    confidence: {
      level:
        result.metrics['overfit_score'] < 0.3
          ? 'HIGH'
          : result.metrics['overfit_score'] < 0.6
            ? 'MEDIUM'
            : 'LOW',
      reasoning:
        result.metrics['overfit_score'] < 0.3
          ? 'Low over-fitting risk'
          : result.metrics['overfit_score'] < 0.6
            ? 'Moderate over-fitting risk'
            : 'High over-fitting risk',
      score: 1 - Math.min(1, result.metrics['overfit_score']),
    },
    nextStep: result.success
      ? 'Shadow trading can begin immediately'
      : 'Strategy parameters must be re-optimized more conservatively',
    actionNeeded: result.metrics['overfit_score'] > 0.5,
    actionDescription:
      result.metrics['overfit_score'] > 0.5
        ? 'Reduce parameter count or increase training data'
        : undefined,
  }),

  execution_readiness: (result) => ({
    headline: result.success
      ? 'System is ready for live trading'
      : 'Execution infrastructure needs attention',
    body: result.success
      ? `Order router latency: ${result.data.latency_ms}ms. Uptime: ${result.data.uptime_pct}%. Data feed reliability: ${result.data.data_feed_reliability}%. All systems nominal.`
      : 'One or more infrastructure components are not ready: ' +
        result.warnings.join('; '),
    confidence: {
      level: result.metrics['infrastructure_readiness'] > 0.95 ? 'HIGH' : 'MEDIUM',
      reasoning:
        result.metrics['infrastructure_readiness'] > 0.95
          ? 'All systems operational'
          : 'Some infrastructure gaps remain',
      score: result.metrics['infrastructure_readiness'],
    },
    nextStep: result.success
      ? 'Strategy can be deployed to shadow mode'
      : 'Infrastructure must be resolved before deployment',
    actionNeeded: !result.success,
    actionDescription: result.success
      ? undefined
      : 'Address failing infrastructure components',
  }),

  approval_gate: (result) => ({
    headline: result.success
      ? 'Strategy approved for shadow trading'
      : 'Strategy requires additional review',
    body: result.success
      ? 'All pipeline checks have passed. Strategy is approved to enter shadow mode for 30 days of live market testing before any real capital is committed.'
      : 'One or more approval criteria were not met. See specific failures above.',
    confidence: {
      level: 'HIGH',
      reasoning: 'Approval decision is binary',
      score: result.success ? 1 : 0,
    },
    nextStep: result.success
      ? 'Strategy will begin shadow trading immediately'
      : 'Address all issues before resubmitting',
    actionNeeded: true,
    actionDescription: result.success ? 'Deploy to shadow' : 'Fix issues',
  }),

  post_deployment: (result) => ({
    headline: result.success
      ? 'Strategy is performing as expected'
      : 'Strategy performance has degraded',
    body: result.success
      ? `Live PnL: ${result.data.live_pnl}%. Expected: ${result.data.expected_pnl}%. Correlation to backtest: ${result.data.backtest_correlation}%. System healthy.`
      : 'Live performance is significantly below backtest expectations. This may indicate regime change, data issues, or execution problems.',
    confidence: {
      level: result.metrics['live_reliability'] > 0.85 ? 'HIGH' : 'MEDIUM',
      reasoning:
        result.metrics['live_reliability'] > 0.85
          ? 'Live performance matches backtest'
          : 'Live performance differs from expectations',
      score: result.metrics['live_reliability'],
    },
    nextStep: result.success
      ? 'Continue monitoring. Strategy is performing normally.'
      : 'Investigate root cause and consider pausing if issues persist',
    actionNeeded: !result.success,
    actionDescription: result.success ? undefined : 'Investigate performance gap',
  }),
};

export class PipelineNarrator {
  narrateStep(step: PipelineStep, result: StepResult): NarrativeBlock {
    const stageKey = step.name.toLowerCase().replace(/\s+/g, '_');
    const narrator = PIPELINE_STAGE_NARRATIVES[stageKey];

    if (!narrator) {
      return {
        headline: `Step "${step.name}" completed`,
        body: 'The step executed successfully. Review detailed metrics for specifics.',
        confidence: {
          level: 'MEDIUM',
          reasoning: 'Narrative not specialized for this step',
          score: 0.5,
        },
        nextStep: 'Pipeline continues to next stage',
        actionNeeded: false,
      };
    }

    return narrator(result);
  }

  narrateFullPipeline(results: PipelineState): FullNarrative {
    const completedSteps = results.steps.filter((s) => s.status === 'completed');
    const failedSteps = results.steps.filter((s) => s.status === 'failed');

    const strengths = completedSteps
      .filter((s) => s.result.metrics['quality_score'] > 0.75)
      .map((s) => s.name);

    const weaknesses = completedSteps
      .filter(
        (s) =>
          s.result.metrics['quality_score'] <= 0.75 &&
          s.result.metrics['quality_score'] > 0.4
      )
      .map((s) => s.name);

    const risks = completedSteps
      .filter((s) => s.result.metrics['quality_score'] <= 0.4)
      .map((s) => s.name);

    let executiveSummary = '';
    let recommendation: FullNarrative['overallRecommendation'];

    if (failedSteps.length > 0) {
      executiveSummary = `Strategy failed at ${failedSteps[0].name}. The idea requires significant revision before it can proceed further. ${failedSteps.length} critical checks did not pass.`;
      recommendation = {
        action: 'reject',
        reasoning:
          'One or more mandatory pipeline stages failed. Address failures before resubmitting.',
        confidence: 0,
      };
    } else if (risks.length > 2) {
      executiveSummary = `Strategy passed basic checks but has multiple risk areas: ${risks.join(', ')}. Recommend addressing these before live deployment.`;
      recommendation = {
        action: 'improve',
        reasoning:
          'Strategy is viable but needs refinement in several areas for optimal risk-adjusted returns.',
        confidence: 0.5,
      };
    } else {
      executiveSummary = `Strategy passed all pipeline checks. Core strengths: ${strengths.length > 0 ? strengths.join(', ') : 'solid fundamentals'}. Ready for shadow trading.`;
      recommendation = {
        action: 'proceed',
        reasoning:
          'All mandatory criteria met. Strategy is approved for shadow mode testing.',
        confidence: 0.8,
      };
    }

    const keyFindings: KeyFinding[] = [];

    strengths.forEach((name) => {
      keyFindings.push({
        category: 'strength',
        title: `Strong performance in ${name}`,
        description: `${name} stage showed high-quality results and passed all checks.`,
        impact: 'high',
      });
    });

    weaknesses.forEach((name) => {
      keyFindings.push({
        category: 'weakness',
        title: `Moderate results in ${name}`,
        description: `${name} stage passed checks but metrics were not optimal. Monitor carefully.`,
        impact: 'medium',
      });
    });

    risks.forEach((name) => {
      keyFindings.push({
        category: 'risk',
        title: `Risk flag in ${name}`,
        description: `${name} stage showed concerning metrics. Address before live trading.`,
        impact: 'high',
      });
    });

    return {
      executiveSummary,
      keyFindings,
      overallRecommendation: recommendation,
      timeline:
        'If approved: shadow trading begins immediately. Promotion to live capital possible after 30 days of strong shadow performance.',
    };
  }

  narrateRejection(rejection: EarlyScreenResult): string {
    if (!rejection.rejected) {
      return 'Strategy passed screening. No rejection to explain.';
    }

    const reasons = rejection.reasons.join(' ');
    const failedCriteria = rejection.failedCriteria
      .map(
        (c) =>
          `${c.criterion}: needed ${c.required} but got ${c.actual} (threshold: ${c.threshold})`
      )
      .join('; ');

    const viabilityPaths = rejection.failedCriteria
      .map((c) => {
        const gap = c.threshold - c.actual;
        if (gap <= 0) return null;
        const percentGap = ((gap / Math.abs(c.actual)) * 100).toFixed(1);
        return `To fix "${c.criterion}": improve by ${percentGap}% (absolute gap: ${gap.toFixed(2)})`;
      })
      .filter(Boolean);

    return (
      `Strategy rejected: ${reasons}. ` +
      `Failed criteria: ${failedCriteria}. ` +
      `To make this strategy viable: ${viabilityPaths.length > 0 ? viabilityPaths.join(' ') : 'reconsider core assumptions'}.`
    );
  }

  narrateImprovement(
    before: Record<string, any>,
    after: Record<string, any>
  ): ImprovementNarrative {
    const improvements: ImprovementNarrative['improvements'] = [];
    const worsenedAreas: ImprovementNarrative['worsenedAreas'] = [];

    for (const key of Object.keys(after)) {
      if (!(key in before) || typeof before[key] !== 'number') continue;

      const beforeVal = before[key];
      const afterVal = after[key];
      const percentChange = ((afterVal - beforeVal) / Math.abs(beforeVal)) * 100;

      if (percentChange > 1) {
        improvements.push({
          metric: key,
          before: beforeVal,
          after: afterVal,
          percentChange,
          explanation: `${key} improved by ${percentChange.toFixed(1)}%`,
        });
      } else if (percentChange < -1) {
        worsenedAreas.push({
          metric: key,
          before: beforeVal,
          after: afterVal,
          percentChange,
          explanation: `${key} declined by ${Math.abs(percentChange).toFixed(1)}%`,
        });
      }
    }

    const improvedCount = improvements.length;
    const worsenedCount = worsenedAreas.length;

    let netAssessment = '';
    if (improvedCount > worsenedCount * 2) {
      netAssessment =
        'Overall improvement. The changes were positive. Strategy became stronger.';
    } else if (worsenedCount > improvedCount * 2) {
      netAssessment =
        'Overall degradation. The changes made the strategy weaker. Consider reverting.';
    } else {
      netAssessment =
        'Mixed results. Some metrics improved while others declined. Assess trade-offs carefully.';
    }

    return {
      summary: `${improvedCount} metrics improved, ${worsenedCount} worsened. ${netAssessment}`,
      improvements,
      worsenedAreas,
      netAssessment,
    };
  }

  narrateComparison(
    strategyA: Record<string, any>,
    strategyB: Record<string, any>,
    nameA: string = 'Strategy A',
    nameB: string = 'Strategy B'
  ): ComparisonNarrative {
    const dimensions = [
      { key: 'total_return', label: 'Total Return', unit: '%' },
      { key: 'sharpe_ratio', label: 'Sharpe Ratio', unit: '' },
      { key: 'max_drawdown', label: 'Max Drawdown', unit: '%' },
      { key: 'win_rate', label: 'Win Rate', unit: '%' },
      { key: 'avg_trade_duration', label: 'Avg Trade Duration', unit: 'days' },
    ];

    const dimensionComparisons = dimensions
      .filter((d) => d.key in strategyA && d.key in strategyB)
      .map((d) => {
        const valA = strategyA[d.key];
        const valB = strategyB[d.key];

        let winner: 'A' | 'B' | 'tie' = 'tie';
        let explanation = `${d.label} is equivalent.`;

        if (d.key === 'max_drawdown') {
          if (valA < valB) {
            winner = 'A';
            explanation = `${nameA} has lower maximum drawdown (${valA}% vs ${valB}%).`;
          } else if (valB < valA) {
            winner = 'B';
            explanation = `${nameB} has lower maximum drawdown (${valB}% vs ${valA}%).`;
          }
        } else {
          if (valA > valB) {
            winner = 'A';
            explanation = `${nameA} has higher ${d.label.toLowerCase()} (${valA}${d.unit} vs ${valB}${d.unit}).`;
          } else if (valB > valA) {
            winner = 'B';
            explanation = `${nameB} has higher ${d.label.toLowerCase()} (${valB}${d.unit} vs ${valA}${d.unit}).`;
          }
        }

        return {
          dimension: d.label,
          strategyA: { value: `${valA}${d.unit}`, numeric: valA },
          strategyB: { value: `${valB}${d.unit}`, numeric: valB },
          winner,
          explanation,
        };
      });

    const aWins = dimensionComparisons.filter((d) => d.winner === 'A').length;
    const bWins = dimensionComparisons.filter((d) => d.winner === 'B').length;

    let recommendation = '';
    if (aWins > bWins) {
      recommendation = `${nameA} is superior across most dimensions. Prefer this strategy.`;
    } else if (bWins > aWins) {
      recommendation = `${nameB} is superior across most dimensions. Prefer this strategy.`;
    } else {
      recommendation = `Both strategies have merits. Choose based on specific portfolio needs or risk tolerance.`;
    }

    return {
      strategyAName: nameA,
      strategyBName: nameB,
      dimensionComparisons,
      recommendation,
    };
  }

  diffExplainer(oldVersion: Record<string, any>, newVersion: Record<string, any>): DiffNarrative {
    const improvements: DiffNarrative['improvements'] = [];
    const regressions: DiffNarrative['regressions'] = [];

    for (const key of Object.keys(newVersion)) {
      if (!(key in oldVersion)) continue;

      const oldVal = oldVersion[key];
      const newVal = newVersion[key];

      if (typeof oldVal !== 'number' || typeof newVal !== 'number') continue;

      const change = newVal - oldVal;
      const percentChange = (change / Math.abs(oldVal)) * 100;

      if (change > 0) {
        improvements.push({
          aspect: key,
          change: `${change > 0 ? '+' : ''}${change.toFixed(2)} (${percentChange.toFixed(1)}%)`,
          reason: `${key} was improved in this version`,
        });
      } else if (change < 0) {
        regressions.push({
          aspect: key,
          change: `${change.toFixed(2)} (${percentChange.toFixed(1)}%)`,
          reason: `${key} decreased in this version`,
        });
      }
    }

    const improvementSummary =
      improvements.length > 0
        ? improvements.map((i) => `${i.aspect} improved`).join(', ')
        : 'no improvements';

    const regressionSummary =
      regressions.length > 0
        ? regressions.map((r) => `${r.aspect} declined`).join(', ')
        : 'no regressions';

    let overallTrend: DiffNarrative['overallTrend'];
    if (improvements.length > regressions.length * 2) {
      overallTrend = 'improving';
    } else if (regressions.length > improvements.length * 2) {
      overallTrend = 'degrading';
    } else {
      overallTrend = 'stable';
    }

    return {
      summary: `Since last version: ${improvementSummary}. ${regressionSummary}. Overall trend: ${overallTrend}.`,
      improvements,
      regressions,
      overallTrend,
    };
  }
}
