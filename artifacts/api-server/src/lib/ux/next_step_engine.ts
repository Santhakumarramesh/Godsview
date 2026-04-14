/**
 * NextStepEngine - Always tells the user exactly what to do next
 * Provides actionable, prioritized recommendations based on pipeline state
 */

export interface NextStepRecommendation {
  action: string;
  reasoning: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  effort_estimate: 'quick' | 'moderate' | 'intensive';
  expected_impact: 'transformative' | 'significant' | 'moderate' | 'minimal';
  alternatives: Array<{
    action: string;
    reasoning: string;
    effort: 'quick' | 'moderate' | 'intensive';
    impact: 'transformative' | 'significant' | 'moderate' | 'minimal';
  }>;
}

export interface Experiment {
  name: string;
  description: string;
  hypothesis: string;
  expectedOutcome: string;
  estimatedDuration: string;
  successCriteria: string[];
  riskLevel: 'low' | 'medium' | 'high';
}

export interface PivotIdea {
  name: string;
  reason: string;
  howToAdapt: string;
  expectedImpactOnRejectionCause: string;
  effortRequired: 'quick' | 'moderate' | 'intensive';
}

export interface ActionItem {
  number: number;
  action: string;
  description: string;
  ownerResponsibility: string;
  estimatedTime: string;
  expectedOutcome: string;
  blockedBy?: string | number;
  unblocks?: Array<string | number>;
  priority: 'critical' | 'high' | 'medium' | 'low';
}

export interface ActionChecklist {
  strategyName: string;
  stage: string;
  items: ActionItem[];
  totalEstimatedTime: string;
  criticalPath: number[];
}

export interface PipelineState {
  strategyId: string;
  stage:
    | 'rejected'
    | 'screening'
    | 'backtesting'
    | 'critique'
    | 'approved'
    | 'shadow'
    | 'live'
    | 'degrading';
  critiques?: Array<{
    category: string;
    severity: 'critical' | 'warning' | 'info';
    message: string;
    suggestedFix?: string;
  }>;
  backtest?: {
    sharpe: number;
    totalReturn: number;
    maxDrawdown: number;
  };
  shadowMetrics?: {
    daysShadowing: number;
    shadowPnL: number;
    backestCorrelation: number;
    driftScore: number;
  };
  liveMetrics?: {
    livePnL: number;
    expectedPnL: number;
    performanceDecay: number;
    daysSinceDeploy: number;
  };
}

export class NextStepEngine {
  getNextStep(pipelineState: PipelineState): NextStepRecommendation {
    switch (pipelineState.stage) {
      case 'rejected':
        return this.nextStepAfterRejection(pipelineState);
      case 'screening':
        return this.nextStepAfterScreening(pipelineState);
      case 'backtesting':
        return this.nextStepAfterBacktest(pipelineState);
      case 'critique':
        return this.nextStepAfterCritique(pipelineState);
      case 'approved':
        return this.nextStepAfterApproval(pipelineState);
      case 'shadow':
        return this.nextStepInShadow(pipelineState);
      case 'live':
        return this.nextStepInLive(pipelineState);
      case 'degrading':
        return this.nextStepWhenDegrading(pipelineState);
      default:
        return {
          action: 'Review pipeline status',
          reasoning: 'Pipeline state is unknown',
          priority: 'high',
          effort_estimate: 'quick',
          expected_impact: 'minimal',
          alternatives: [],
        };
    }
  }

  private nextStepAfterRejection(
    pipelineState: PipelineState
  ): NextStepRecommendation {
    return {
      action: 'Decide: iterate or pivot',
      reasoning:
        'Strategy was rejected. Choose whether to fix this idea or pursue a new direction.',
      priority: 'critical',
      effort_estimate: 'moderate',
      expected_impact: 'transformative',
      alternatives: [
        {
          action: 'Analyze rejection reasons in detail',
          reasoning: 'Understand exactly why it failed before deciding next steps',
          effort: 'quick',
          impact: 'significant',
        },
        {
          action: 'Generate pivot ideas based on what was close to working',
          reasoning: 'May be faster to adapt than rebuild from scratch',
          effort: 'moderate',
          impact: 'significant',
        },
      ],
    };
  }

  private nextStepAfterScreening(
    pipelineState: PipelineState
  ): NextStepRecommendation {
    return {
      action: 'Run historical backtest',
      reasoning:
        'Strategy passed initial concept checks. Now test performance on historical data.',
      priority: 'high',
      effort_estimate: 'moderate',
      expected_impact: 'significant',
      alternatives: [
        {
          action: 'Refine parameters before backtesting',
          reasoning: 'Optimize inputs to maximize backtest results',
          effort: 'intensive',
          impact: 'significant',
        },
        {
          action: 'Expand universe of test symbols',
          reasoning: 'Test on more assets to improve statistical confidence',
          effort: 'quick',
          impact: 'moderate',
        },
      ],
    };
  }

  private nextStepAfterBacktest(
    pipelineState: PipelineState
  ): NextStepRecommendation {
    if (!pipelineState.backtest) {
      return {
        action: 'Review backtest results',
        reasoning: 'Backtest data is missing',
        priority: 'high',
        effort_estimate: 'quick',
        expected_impact: 'minimal',
        alternatives: [],
      };
    }

    const sharpe = pipelineState.backtest.sharpe;
    const returns = pipelineState.backtest.totalReturn;
    const drawdown = Math.abs(pipelineState.backtest.maxDrawdown);

    if (sharpe > 1.5 && returns > 15) {
      return {
        action: 'Proceed to live critique and stress testing',
        reasoning: `Strong backtest results (Sharpe: ${sharpe.toFixed(2)}, Return: ${returns.toFixed(1)}%). Strategy shows promise. Critique will identify any hidden issues.`,
        priority: 'high',
        effort_estimate: 'moderate',
        expected_impact: 'significant',
        alternatives: [
          {
            action: 'Refine parameters further',
            reasoning: 'Push Sharpe ratio even higher before deployment',
            effort: 'intensive',
            impact: 'moderate',
          },
          {
            action: 'Walk-forward test on unseen data',
            reasoning: 'Check for over-fitting before committing to critique',
            effort: 'moderate',
            impact: 'significant',
          },
        ],
      };
    } else if (sharpe > 0.8 && returns > 8) {
      return {
        action: 'Consider parameter adjustments, then critique',
        reasoning: `Backtest results are acceptable (Sharpe: ${sharpe.toFixed(2)}, Return: ${returns.toFixed(1)}%) but could be stronger. Small tweaks might materially improve performance.`,
        priority: 'high',
        effort_estimate: 'moderate',
        expected_impact: 'moderate',
        alternatives: [
          {
            action: 'Proceed directly to critique without optimization',
            reasoning: 'Results are good enough; further optimization risks over-fitting',
            effort: 'quick',
            impact: 'minimal',
          },
          {
            action: 'Test on alternative universes or time periods',
            reasoning: 'Expand testing to check robustness',
            effort: 'moderate',
            impact: 'moderate',
          },
        ],
      };
    } else {
      return {
        action: 'Redesign strategy or abandon',
        reasoning: `Backtest results are weak (Sharpe: ${sharpe.toFixed(2)}, Return: ${returns.toFixed(1)}%). Edge does not justify complexity. Consider starting over.`,
        priority: 'critical',
        effort_estimate: 'intensive',
        expected_impact: 'transformative',
        alternatives: [
          {
            action: 'Identify what went wrong and fix it',
            reasoning: 'Maybe one critical parameter is off',
            effort: 'moderate',
            impact: 'significant',
          },
          {
            action: 'Reduce complexity and retry',
            reasoning: 'Simple strategies often work better than complex ones',
            effort: 'moderate',
            impact: 'moderate',
          },
        ],
      };
    }
  }

  private nextStepAfterCritique(
    pipelineState: PipelineState
  ): NextStepRecommendation {
    if (!pipelineState.critiques || pipelineState.critiques.length === 0) {
      return {
        action: 'Proceed to shadow deployment',
        reasoning:
          'No critical issues found. Strategy is ready for live testing.',
        priority: 'high',
        effort_estimate: 'quick',
        expected_impact: 'significant',
        alternatives: [],
      };
    }

    const criticalIssues = pipelineState.critiques.filter(
      (c) => c.severity === 'critical'
    );
    const warnings = pipelineState.critiques.filter(
      (c) => c.severity === 'warning'
    );

    if (criticalIssues.length > 0) {
      const issues = criticalIssues
        .map((i) => `${i.category}: ${i.message}`)
        .join('; ');
      return {
        action: `Fix critical issues: ${criticalIssues[0].category}`,
        reasoning: `${criticalIssues.length} critical issues block approval. Must address before proceeding: ${issues}`,
        priority: 'critical',
        effort_estimate: 'intensive',
        expected_impact: 'transformative',
        alternatives: [
          {
            action: 'Get approval to proceed despite issues',
            reasoning: 'Issues may be manageable with close monitoring',
            effort: 'quick',
            impact: 'minimal',
          },
          {
            action: 'Abandon strategy if issues are unfixable',
            reasoning: 'Some strategies have fundamental flaws',
            effort: 'quick',
            impact: 'minimal',
          },
        ],
      };
    } else {
      const warningList = warnings.map((w) => w.category).join(', ');
      return {
        action: `Address ${warnings.length} warnings, then deploy to shadow`,
        reasoning: `Warnings found (${warningList}) but no blockers. Recommended to fix before shadow, but not required.`,
        priority: 'medium',
        effort_estimate: 'moderate',
        expected_impact: 'moderate',
        alternatives: [
          {
            action: 'Proceed to shadow immediately with warnings',
            reasoning: 'Shadow mode will show if warnings matter in practice',
            effort: 'quick',
            impact: 'minimal',
          },
          {
            action: 'Fix warnings first for cleaner deployment',
            reasoning: 'Better safe than sorry with real capital',
            effort: 'moderate',
            impact: 'moderate',
          },
        ],
      };
    }
  }

  private nextStepAfterApproval(
    pipelineState: PipelineState
  ): NextStepRecommendation {
    return {
      action: 'Deploy to shadow mode',
      reasoning:
        'All checks passed. Begin 30 days of shadow trading to validate performance on live markets without risking capital.',
      priority: 'high',
      effort_estimate: 'quick',
      expected_impact: 'significant',
      alternatives: [
        {
          action: 'Schedule shadow deployment for specific date',
          reasoning: 'Coordinate with portfolio management and ops team',
          effort: 'quick',
          impact: 'minimal',
        },
        {
          action: 'Run final infrastructure readiness check',
          reasoning: 'Ensure all systems are truly ready before live signal generation',
          effort: 'quick',
          impact: 'moderate',
        },
      ],
    };
  }

  private nextStepInShadow(
    pipelineState: PipelineState
  ): NextStepRecommendation {
    if (!pipelineState.shadowMetrics) {
      return {
        action: 'Wait for shadow metrics to accumulate',
        reasoning: 'Shadow mode is running. Data collection in progress.',
        priority: 'low',
        effort_estimate: 'quick',
        expected_impact: 'minimal',
        alternatives: [],
      };
    }

    const daysShadowing = pipelineState.shadowMetrics.daysShadowing;
    const correlation = pipelineState.shadowMetrics.backestCorrelation;
    const driftScore = pipelineState.shadowMetrics.driftScore;

    if (daysShadowing < 14) {
      return {
        action: `Continue shadow monitoring (${daysShadowing}/30 days)`,
        reasoning:
          'Insufficient data yet. Shadow must run for full evaluation window.',
        priority: 'medium',
        effort_estimate: 'quick',
        expected_impact: 'minimal',
        alternatives: [
          {
            action: 'Check shadow signals weekly',
            reasoning: 'Monitor for obvious issues even before 30 days',
            effort: 'quick',
            impact: 'moderate',
          },
        ],
      };
    } else if (driftScore > 0.3 || correlation < 0.6) {
      return {
        action: 'Investigate performance divergence from backtest',
        reasoning: `Shadow is drifting significantly from expectations (drift: ${(driftScore * 100).toFixed(1)}%, correlation: ${(correlation * 100).toFixed(1)}%). Understand root cause before promotion.`,
        priority: 'high',
        effort_estimate: 'moderate',
        expected_impact: 'significant',
        alternatives: [
          {
            action: 'Extend shadow period to gather more data',
            reasoning: 'More data may reveal if drift is normal or problematic',
            effort: 'quick',
            impact: 'moderate',
          },
          {
            action: 'Roll back and refine strategy',
            reasoning: 'Divergence suggests backtest assumptions were wrong',
            effort: 'intensive',
            impact: 'transformative',
          },
        ],
      };
    } else if (daysShadowing >= 30) {
      return {
        action: 'Promote to live trading',
        reasoning:
          '30 days shadow period complete with good correlation to backtest. Strategy is ready for real capital.',
        priority: 'high',
        effort_estimate: 'quick',
        expected_impact: 'transformative',
        alternatives: [
          {
            action: 'Extend shadow for additional validation',
            reasoning: 'More confidence before committing real capital',
            effort: 'quick',
            impact: 'moderate',
          },
          {
            action: 'Deploy with reduced position size initially',
            reasoning: 'Gradual ramp-up reduces risk of unforeseen issues',
            effort: 'quick',
            impact: 'moderate',
          },
        ],
      };
    } else {
      return {
        action: `Continue shadow (${daysShadowing}/30 days expected)`,
        reasoning:
          'Shadow is on track. Performance aligns with expectations. Proceed with plan.',
        priority: 'medium',
        effort_estimate: 'quick',
        expected_impact: 'minimal',
        alternatives: [],
      };
    }
  }

  private nextStepInLive(
    pipelineState: PipelineState
  ): NextStepRecommendation {
    if (!pipelineState.liveMetrics) {
      return {
        action: 'Monitor daily',
        reasoning: 'Strategy is live. Daily monitoring required.',
        priority: 'high',
        effort_estimate: 'quick',
        expected_impact: 'moderate',
        alternatives: [],
      };
    }

    const performanceDecay = pipelineState.liveMetrics.performanceDecay;

    if (performanceDecay > 0.5) {
      return {
        action: 'Daily monitoring. Performance within expected range.',
        reasoning: `Live PnL is within ${(performanceDecay * 100).toFixed(1)}% of expectations. Strategy performing well.`,
        priority: 'medium',
        effort_estimate: 'quick',
        expected_impact: 'minimal',
        alternatives: [
          {
            action: 'Increase position size',
            reasoning: 'Strategy is proving itself. Scale up to maximize returns.',
            effort: 'quick',
            impact: 'significant',
          },
          {
            action: 'Replicate strategy for new asset class',
            reasoning: 'Success may transfer to related markets',
            effort: 'moderate',
            impact: 'moderate',
          },
        ],
      };
    } else {
      return {
        action: 'Investigate performance degradation',
        reasoning: `Live performance is significantly below backtest (decay: ${(performanceDecay * 100).toFixed(1)}%). Root cause analysis required.`,
        priority: 'high',
        effort_estimate: 'moderate',
        expected_impact: 'significant',
        alternatives: [
          {
            action: 'Reduce position size while investigating',
            reasoning: 'Limit losses while determining the issue',
            effort: 'quick',
            impact: 'significant',
          },
          {
            action: 'Pause strategy and review',
            reasoning: 'Stop trading until confident in cause and fix',
            effort: 'quick',
            impact: 'transformative',
          },
        ],
      };
    }
  }

  private nextStepWhenDegrading(
    pipelineState: PipelineState
  ): NextStepRecommendation {
    return {
      action: 'Downgrade to defensive mode and reduce position size',
      reasoning:
        'Strategy performance is declining. Reduce exposure to limit further losses.',
      priority: 'critical',
      effort_estimate: 'quick',
      expected_impact: 'transformative',
      alternatives: [
        {
          action: 'Pause strategy immediately',
          reasoning: 'Stop all trading until issue is resolved',
          effort: 'quick',
          impact: 'transformative',
        },
        {
          action: 'Investigate root cause of degradation',
          reasoning: 'Understand why performance is declining',
          effort: 'moderate',
          impact: 'significant',
        },
      ],
    };
  }

  suggestExperiments(strategy: Record<string, any>): Experiment[] {
    const experiments: Experiment[] = [];

    experiments.push({
      name: 'Parameter sensitivity analysis',
      description: 'Test how sensitive strategy is to key parameter changes',
      hypothesis:
        'Small parameter adjustments will improve risk-adjusted returns',
      expectedOutcome:
        'Identify which parameters have highest impact on performance',
      estimatedDuration: '3-5 days',
      successCriteria: ['Identify 2-3 high-impact parameters', 'Improve Sharpe ratio by 0.1+'],
      riskLevel: 'low',
    });

    experiments.push({
      name: 'Asset universe expansion',
      description: 'Test strategy on broader set of related assets',
      hypothesis:
        'Strategy edge is not asset-specific and works across similar instruments',
      expectedOutcome: 'Confirm generalizability or identify asset-specific tuning needs',
      estimatedDuration: '2-3 days',
      successCriteria: ['80%+ of test assets show positive Sharpe', 'Results consistent across sectors'],
      riskLevel: 'low',
    });

    experiments.push({
      name: 'Time period robustness test',
      description: 'Test strategy on different historical periods',
      hypothesis: 'Strategy works consistently regardless of time period tested',
      expectedOutcome: 'Confirm strategy is not over-fitted to recent data',
      estimatedDuration: '2-3 days',
      successCriteria: ['Performance is stable across periods', 'No systematic degradation in older data'],
      riskLevel: 'low',
    });

    experiments.push({
      name: 'Leverage optimization',
      description: 'Find optimal leverage to maximize risk-adjusted returns',
      hypothesis: 'Current leverage is suboptimal',
      expectedOutcome: 'New leverage targets that improve Sharpe ratio by 0.2+',
      estimatedDuration: '1-2 days',
      successCriteria: ['Sharpe ratio increases without exceeding risk limits', 'Drawdown remains acceptable'],
      riskLevel: 'medium',
    });

    experiments.push({
      name: 'Stop-loss and take-profit optimization',
      description: 'Test different exit rules',
      hypothesis: 'Current exits leave money on table or expose too much to tail risk',
      expectedOutcome: 'Better-optimized exit rules that improve reward-to-risk ratio',
      estimatedDuration: '3-5 days',
      successCriteria: ['Win rate increases', 'Average losing trade size decreases'],
      riskLevel: 'low',
    });

    experiments.push({
      name: 'Diversification across timeframes',
      description: 'Combine strategy signals at multiple timeframes',
      hypothesis: 'Multi-timeframe approach reduces false signals',
      expectedOutcome: 'Higher Sharpe ratio with fewer but higher-quality trades',
      estimatedDuration: '5-7 days',
      successCriteria: ['Trade frequency decreases by 30%+', 'Win rate stays constant or improves'],
      riskLevel: 'medium',
    });

    return experiments;
  }

  suggestAlternatives(rejectedStrategy: Record<string, any>): PivotIdea[] {
    const pivots: PivotIdea[] = [];

    pivots.push({
      name: 'Reverse the signal',
      reason: 'If strategy is generating losing trades, opposite positions might win',
      howToAdapt: 'Flip all entry and exit rules',
      expectedImpactOnRejectionCause: 'May fix fundamental directional bias',
      effortRequired: 'quick',
    });

    pivots.push({
      name: 'Shift timeframe',
      reason: 'If daily timeframe does not work, maybe hourly or weekly would',
      howToAdapt: 'Compress or expand all signals and holding periods by factor of 5-10x',
      expectedImpactOnRejectionCause: 'May align better with market microstructure',
      effortRequired: 'moderate',
    });

    pivots.push({
      name: 'Change universe to leading indicators',
      reason: 'If trailing indicators do not work, leading indicators might predict better',
      howToAdapt: 'Replace lagging technical indicators with forward-looking alternatives',
      expectedImpactOnRejectionCause: 'May capture moves earlier with better entry timing',
      effortRequired: 'moderate',
    });

    pivots.push({
      name: 'Add regime filter',
      reason: 'Strategy may only work in specific market regimes',
      howToAdapt: 'Add volatility, trend, or correlation regime check before entering trades',
      expectedImpactOnRejectionCause: 'Reduces losses in unfavorable regimes',
      effortRequired: 'moderate',
    });

    pivots.push({
      name: 'Combine with complementary strategy',
      reason: 'Strategy weakness may be covered by different edge',
      howToAdapt: 'Keep this strategy but only trade when secondary strategy also signals',
      expectedImpactOnRejectionCause: 'Increases hit rate and consistency',
      effortRequired: 'intensive',
    });

    pivots.push({
      name: 'Reduce frequency, increase sizing',
      reason: 'High-frequency, small-size approach may hit costs; low-frequency, large-size may work',
      howToAdapt: 'Hold positions 5-10x longer, reduce daily trade targets',
      expectedImpactOnRejectionCause: 'Reduces transaction costs as percentage of profit',
      effortRequired: 'quick',
    });

    return pivots;
  }

  generateActionChecklist(pipelineResult: PipelineState): ActionChecklist {
    const items: ActionItem[] = [];
    let checklistStage = pipelineResult.stage;

    if (pipelineResult.stage === 'rejected') {
      items.push({
        number: 1,
        action: 'Document rejection reasons',
        description: 'Create clear record of why strategy failed',
        ownerResponsibility: 'Strategy Author',
        estimatedTime: '30 minutes',
        expectedOutcome: 'Clear understanding of failure modes',
        priority: 'high',
      });

      items.push({
        number: 2,
        action: 'Generate pivot ideas',
        description: 'Use NextStepEngine.suggestAlternatives to find adaptations',
        ownerResponsibility: 'Strategy Author',
        estimatedTime: '2 hours',
        expectedOutcome: '5-10 concrete pivot ideas to explore',
        priority: 'high',
      });

      items.push({
        number: 3,
        action: 'Pick highest-potential pivot',
        description: 'Rank pivots by effort vs. likelihood of success',
        ownerResponsibility: 'Strategy Author + Quant Manager',
        estimatedTime: '1 hour',
        expectedOutcome: 'Clear decision on next direction',
        priority: 'high',
      });

      items.push({
        number: 4,
        action: 'Restart pipeline with adapted strategy',
        description: 'Begin new submission with updated rules',
        ownerResponsibility: 'Strategy Author',
        estimatedTime: 'Varies',
        expectedOutcome: 'New pipeline submission ready',
        priority: 'high',
        unblocks: [5],
      });
    } else if (pipelineResult.stage === 'backtesting') {
      items.push({
        number: 1,
        action: 'Review backtest results thoroughly',
        description: 'Examine performance metrics, drawdowns, win rates, etc.',
        ownerResponsibility: 'Strategy Author',
        estimatedTime: '2 hours',
        expectedOutcome: 'Deep understanding of backtest behavior',
        priority: 'high',
      });

      items.push({
        number: 2,
        action: 'Decide: iterate or proceed to critique',
        description:
          'If strong results (Sharpe > 1.0), proceed. If weak, iterate parameters.',
        ownerResponsibility: 'Quant Manager',
        estimatedTime: '30 minutes',
        expectedOutcome: 'Clear decision path forward',
        priority: 'high',
      });

      items.push({
        number: 3,
        action: 'Run walk-forward test if iterating',
        description: 'Test on unseen data to check for over-fitting',
        ownerResponsibility: 'Backtest Engineer',
        estimatedTime: '4 hours',
        expectedOutcome: 'Confidence that strategy is not over-optimized',
        priority: 'high',
        blockedBy: 2,
      });

      items.push({
        number: 4,
        action: 'Submit to critique stage',
        description: 'Move approved backtest results to human review',
        ownerResponsibility: 'Pipeline Manager',
        estimatedTime: '30 minutes',
        expectedOutcome: 'Strategy in critique queue',
        priority: 'medium',
        blockedBy: 2,
      });
    } else if (pipelineResult.stage === 'critique') {
      items.push({
        number: 1,
        action: 'Assign to senior quant reviewer',
        description: 'Route to appropriate expert for domain',
        ownerResponsibility: 'Pipeline Manager',
        estimatedTime: '30 minutes',
        expectedOutcome: 'Critic assigned, review scheduled',
        priority: 'high',
      });

      items.push({
        number: 2,
        action: 'Conduct live critique session',
        description:
          'Senior quant walks through strategy logic, assumptions, risks',
        ownerResponsibility: 'Senior Quant',
        estimatedTime: '2-3 hours',
        expectedOutcome: 'Documented findings and recommendations',
        priority: 'high',
        blockedBy: 1,
      });

      items.push({
        number: 3,
        action: 'Address critical issues if any',
        description: 'Fix blockers identified in critique',
        ownerResponsibility: 'Strategy Author',
        estimatedTime: 'Varies',
        expectedOutcome: 'Issues resolved or documented as acceptable risks',
        priority: 'critical',
        blockedBy: 2,
      });

      items.push({
        number: 4,
        action: 'Seek final approval',
        description: 'Get go-ahead for shadow deployment',
        ownerResponsibility: 'Quant Manager',
        estimatedTime: '1 hour',
        expectedOutcome: 'Approval decision documented',
        priority: 'high',
        blockedBy: 3,
      });
    } else if (pipelineResult.stage === 'shadow') {
      items.push({
        number: 1,
        action: 'Configure shadow parameters',
        description: 'Set simulation window, starting capital, position sizing',
        ownerResponsibility: 'Infra Engineer',
        estimatedTime: '1 hour',
        expectedOutcome: 'Shadow mode ready to launch',
        priority: 'high',
      });

      items.push({
        number: 2,
        action: 'Launch shadow trading',
        description: 'Begin live signal generation and tracking',
        ownerResponsibility: 'Trading Ops',
        estimatedTime: '30 minutes',
        expectedOutcome: 'Shadow signals generated and logged',
        priority: 'high',
        blockedBy: 1,
      });

      items.push({
        number: 3,
        action: 'Daily monitoring of shadow performance',
        description: 'Track PnL, signal count, fills vs predictions',
        ownerResponsibility: 'Trading Ops',
        estimatedTime: '15 minutes daily',
        expectedOutcome: 'Early warning of major divergence from expectations',
        priority: 'high',
        blockedBy: 2,
      });

      items.push({
        number: 4,
        action: 'Weekly performance review',
        description: 'Detailed analysis of shadow performance vs backtest',
        ownerResponsibility: 'Quant Manager',
        estimatedTime: '2 hours weekly',
        expectedOutcome: 'Documented assessment of promotion readiness',
        priority: 'medium',
        blockedBy: 2,
      });

      items.push({
        number: 5,
        action: 'Promote to live after 30 days if on track',
        description: 'Authorize real capital deployment',
        ownerResponsibility: 'Risk Manager',
        estimatedTime: '1 hour',
        expectedOutcome: 'Live deployment authorized',
        priority: 'high',
        blockedBy: 4,
      });
    } else if (pipelineResult.stage === 'live') {
      items.push({
        number: 1,
        action: 'Monitor daily performance',
        description: 'Review PnL, Greeks, execution quality',
        ownerResponsibility: 'Trading Ops',
        estimatedTime: '30 minutes daily',
        expectedOutcome: 'Early detection of problems',
        priority: 'critical',
      });

      items.push({
        number: 2,
        action: 'Weekly performance review',
        description:
          'Compare live results to backtest and shadow performance',
        ownerResponsibility: 'Quant Manager',
        estimatedTime: '2 hours weekly',
        expectedOutcome: 'Documentation of strategy health',
        priority: 'high',
      });

      items.push({
        number: 3,
        action: 'Monthly risk review',
        description: 'Assess drawdown, correlation, leverage utilization',
        ownerResponsibility: 'Risk Manager',
        estimatedTime: '2 hours monthly',
        expectedOutcome: 'Confirmation that risk is within limits',
        priority: 'high',
      });

      items.push({
        number: 4,
        action: 'Scale position if performing well',
        description: 'Increase allocation to maximize returns',
        ownerResponsibility: 'Portfolio Manager',
        estimatedTime: '1 hour',
        expectedOutcome: 'Position size adjusted',
        priority: 'medium',
      });
    }

    const criticalPathItems = items
      .filter((i) => i.priority === 'critical')
      .map((i) => i.number);

    return {
      strategyName: pipelineResult.strategyId,
      stage: checklistStage,
      items,
      totalEstimatedTime: this.estimateTotalTime(items),
      criticalPath: criticalPathItems,
    };
  }

  private estimateTotalTime(items: ActionItem[]): string {
    const timeMap: Record<string, number> = {
      '15 minutes': 0.25,
      '30 minutes': 0.5,
      '1 hour': 1,
      '2 hours': 2,
      '3 hours': 3,
      '1-2 days': 4,
      '2-3 days': 5,
      '3-5 days': 8,
      '5-7 days': 12,
      '4 hours': 4,
      'Varies': 0,
    };

    let totalHours = 0;
    for (const item of items) {
      const timeStr = item.estimatedTime;
      const hours = timeMap[timeStr] || 2;
      totalHours += hours;
    }

    if (totalHours <= 4) {
      return Math.ceil(totalHours) + ' hours';
    } else if (totalHours <= 24) {
      return Math.ceil(totalHours / 4) + ' to ' + Math.ceil(totalHours / 2) + ' days';
    } else {
      return Math.ceil(totalHours / 8) + ' to ' + Math.ceil(totalHours / 4) + ' weeks';
    }
  }
}
