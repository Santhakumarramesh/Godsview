/**
 * CognitiveLoadReducer - Reduce information overload
 * Provides multi-level detail views to match user context and expertise
 */

export type DetailLevel = 'GLANCE' | 'SUMMARY' | 'DETAILED' | 'EXPERT';

export interface Finding {
  category: string;
  title: string;
  description: string;
  metric?: string;
  value?: number;
  threshold?: number;
  impact: 'critical' | 'high' | 'medium' | 'low';
  actionable?: boolean;
}

export interface SimplifiedView {
  level: DetailLevel;
  headline: string;
  keyPoints: string[];
  recommendation: string;
  trafficLight: 'green' | 'yellow' | 'red';
  detailSections: Array<{
    title: string;
    content: string;
    expandable: boolean;
  }>;
  rawDataAvailable: boolean;
}

export interface QuickCard {
  strategyName: string;
  status: string;
  mainMetric: {
    label: string;
    value: number;
    unit: string;
    trend?: 'up' | 'down' | 'stable';
  };
  secondaryMetrics: Array<{
    label: string;
    value: number;
    unit: string;
  }>;
  recommendation: string;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface UserProfile {
  role: 'trader' | 'portfolio_manager' | 'risk_manager' | 'researcher' | 'executive';
  expertise:
    | 'novice'
    | 'intermediate'
    | 'advanced'
    | 'expert';
  preferredDetailLevel?: DetailLevel;
}

export interface AnalysisContext {
  purpose: 'decision' | 'monitoring' | 'review' | 'audit';
  timeConstraint: 'urgent' | 'normal' | 'thorough';
  criticalOnly?: boolean;
}

export class CognitiveLoadReducer {
  simplify(fullAnalysis: Record<string, any>): SimplifiedView {
    return {
      level: 'SUMMARY',
      headline:
        fullAnalysis.headline || 'Strategy Analysis',
      keyPoints: this.extractKeyPoints(fullAnalysis),
      recommendation:
        fullAnalysis.recommendation || 'Review detailed results',
      trafficLight: this.determineTrafficLight(fullAnalysis),
      detailSections: this.createDetailSections(fullAnalysis),
      rawDataAvailable: !!fullAnalysis.rawData,
    };
  }

  private extractKeyPoints(analysis: Record<string, any>): string[] {
    const points: string[] = [];

    if (analysis.total_return !== undefined) {
      points.push(`Total Return: ${analysis.total_return}%`);
    }

    if (analysis.sharpe_ratio !== undefined) {
      points.push(`Sharpe Ratio: ${analysis.sharpe_ratio.toFixed(2)}`);
    }

    if (analysis.max_drawdown !== undefined) {
      points.push(`Max Drawdown: ${analysis.max_drawdown}%`);
    }

    if (analysis.win_rate !== undefined) {
      points.push(`Win Rate: ${analysis.win_rate}%`);
    }

    if (analysis.trades_total !== undefined) {
      points.push(`Total Trades: ${analysis.trades_total}`);
    }

    if (analysis.outperformance !== undefined) {
      points.push(`vs Benchmark: ${analysis.outperformance > 0 ? '+' : ''}${analysis.outperformance}%`);
    }

    return points.length > 0
      ? points
      : ['Strategy passed all checks', 'Ready for next stage'];
  }

  private determineTrafficLight(analysis: Record<string, any>): 'green' | 'yellow' | 'red' {
    let redFlags = 0;
    let yellowFlags = 0;

    if (analysis.status === 'rejected') return 'red';
    if (analysis.max_drawdown && analysis.max_drawdown > 30) redFlags++;
    if (analysis.sharpe_ratio && analysis.sharpe_ratio < 0.5) redFlags++;
    if (analysis.success_rate && analysis.success_rate < 40) redFlags++;

    if (analysis.max_drawdown && analysis.max_drawdown > 20) yellowFlags++;
    if (analysis.sharpe_ratio && analysis.sharpe_ratio < 1.0) yellowFlags++;
    if (analysis.trades_total && analysis.trades_total < 10) yellowFlags++;

    if (redFlags > 0) return 'red';
    if (yellowFlags > 1) return 'yellow';
    return 'green';
  }

  private createDetailSections(
    analysis: Record<string, any>
  ): Array<{
    title: string;
    content: string;
    expandable: boolean;
  }> {
    const sections: Array<{
      title: string;
      content: string;
      expandable: boolean;
    }> = [];

    if (analysis.performance) {
      sections.push({
        title: 'Performance Summary',
        content: `Total Return: ${analysis.total_return}%, Sharpe: ${analysis.sharpe_ratio}, Drawdown: ${analysis.max_drawdown}%`,
        expandable: true,
      });
    }

    if (analysis.critiques && analysis.critiques.length > 0) {
      sections.push({
        title: 'Issues Found',
        content: `${analysis.critiques.length} issues to address`,
        expandable: true,
      });
    }

    if (analysis.strengths && analysis.strengths.length > 0) {
      sections.push({
        title: 'Strengths',
        content: analysis.strengths.join(', '),
        expandable: true,
      });
    }

    return sections;
  }

  getDetailedView(
    fullAnalysis: Record<string, any>,
    level: DetailLevel
  ): SimplifiedView {
    switch (level) {
      case 'GLANCE':
        return this.createGlanceView(fullAnalysis);
      case 'SUMMARY':
        return this.createSummaryView(fullAnalysis);
      case 'DETAILED':
        return this.createDetailedView(fullAnalysis);
      case 'EXPERT':
        return this.createExpertView(fullAnalysis);
      default:
        return this.createSummaryView(fullAnalysis);
    }
  }

  private createGlanceView(fullAnalysis: Record<string, any>): SimplifiedView {
    const isViable =
      fullAnalysis.sharpe_ratio > 0.8 &&
      fullAnalysis.total_return > 5 &&
      fullAnalysis.max_drawdown < 25;

    return {
      level: 'GLANCE',
      headline: isViable ? 'Strategy looks good' : 'Strategy needs work',
      keyPoints: [],
      recommendation: isViable ? 'Proceed' : 'Revise',
      trafficLight: isViable ? 'green' : 'red',
      detailSections: [],
      rawDataAvailable: true,
    };
  }

  private createSummaryView(fullAnalysis: Record<string, any>): SimplifiedView {
    const keyPoints: string[] = [];

    if (fullAnalysis.total_return !== undefined) {
      keyPoints.push(
        `Returned ${fullAnalysis.total_return.toFixed(1)}% annually`
      );
    }

    if (fullAnalysis.sharpe_ratio !== undefined) {
      const sharpeQuality =
        fullAnalysis.sharpe_ratio > 1.5
          ? 'excellent'
          : fullAnalysis.sharpe_ratio > 1
            ? 'strong'
            : fullAnalysis.sharpe_ratio > 0.5
              ? 'moderate'
              : 'weak';
      keyPoints.push(`${sharpeQuality.charAt(0).toUpperCase() + sharpeQuality.slice(1)} risk-adjusted returns (Sharpe: ${fullAnalysis.sharpe_ratio.toFixed(2)})`);
    }

    if (fullAnalysis.max_drawdown !== undefined) {
      keyPoints.push(
        `Worst drawdown: ${Math.abs(fullAnalysis.max_drawdown).toFixed(1)}%`
      );
    }

    if (fullAnalysis.win_rate !== undefined) {
      keyPoints.push(`Wins ${fullAnalysis.win_rate.toFixed(0)}% of trades`);
    }

    if (fullAnalysis.criticisms && fullAnalysis.criticisms.length > 0) {
      keyPoints.push(
        `Caution: ${fullAnalysis.criticisms.length} issue${fullAnalysis.criticisms.length > 1 ? 's' : ''} found`
      );
    }

    const detailSections: Array<{
      title: string;
      content: string;
      expandable: boolean;
    }> = [];

    if (fullAnalysis.strengths && fullAnalysis.strengths.length > 0) {
      detailSections.push({
        title: 'What Works',
        content: fullAnalysis.strengths.slice(0, 3).join('; '),
        expandable: true,
      });
    }

    if (fullAnalysis.criticisms && fullAnalysis.criticisms.length > 0) {
      detailSections.push({
        title: 'Issues to Address',
        content:
          fullAnalysis.criticisms
            .slice(0, 2)
            .map((c: any) => c.title || c)
            .join('; ') + '...',
        expandable: true,
      });
    }

    return {
      level: 'SUMMARY',
      headline: fullAnalysis.headline || 'Strategy Summary',
      keyPoints,
      recommendation:
        fullAnalysis.recommendation || 'See detailed analysis',
      trafficLight: this.determineTrafficLight(fullAnalysis),
      detailSections,
      rawDataAvailable: true,
    };
  }

  private createDetailedView(fullAnalysis: Record<string, any>): SimplifiedView {
    const detailSections: Array<{
      title: string;
      content: string;
      expandable: boolean;
    }> = [];

    const performanceMetrics = [
      'total_return',
      'sharpe_ratio',
      'sortino_ratio',
      'max_drawdown',
      'win_rate',
      'avg_winning_trade',
      'avg_losing_trade',
    ];

    let performanceContent = '';
    for (const metric of performanceMetrics) {
      if (metric in fullAnalysis) {
        performanceContent += `${metric}: ${fullAnalysis[metric]}\n`;
      }
    }

    if (performanceContent) {
      detailSections.push({
        title: 'Performance Metrics',
        content: performanceContent,
        expandable: false,
      });
    }

    if (
      fullAnalysis.criticisms &&
      Array.isArray(fullAnalysis.criticisms) &&
      fullAnalysis.criticisms.length > 0
    ) {
      const criticalItems = fullAnalysis.criticisms.filter(
        (c: any) => c.severity === 'critical'
      );
      const warningItems = fullAnalysis.criticisms.filter(
        (c: any) => c.severity === 'warning'
      );

      if (criticalItems.length > 0) {
        detailSections.push({
          title: 'Critical Issues',
          content: criticalItems.map((c: any) => `• ${c.title}: ${c.description}`).join('\n'),
          expandable: true,
        });
      }

      if (warningItems.length > 0) {
        detailSections.push({
          title: 'Warnings',
          content: warningItems.map((c: any) => `• ${c.title}: ${c.description}`).join('\n'),
          expandable: true,
        });
      }
    }

    if (fullAnalysis.regime_analysis) {
      detailSections.push({
        title: 'Regime Analysis',
        content: `Tested in ${fullAnalysis.regime_analysis.regimes_tested} regimes. Passed: ${fullAnalysis.regime_analysis.regimes_passed}. Performance in stress: ${fullAnalysis.regime_analysis.stress_performance}%`,
        expandable: true,
      });
    }

    if (fullAnalysis.backtest_vs_paper) {
      detailSections.push({
        title: 'Backtest vs Paper',
        content: `Backtest Sharpe: ${fullAnalysis.backtest_vs_paper.backtest_sharpe}, Paper Sharpe: ${fullAnalysis.backtest_vs_paper.paper_sharpe}, Correlation: ${fullAnalysis.backtest_vs_paper.correlation}`,
        expandable: true,
      });
    }

    return {
      level: 'DETAILED',
      headline: fullAnalysis.headline || 'Full Analysis',
      keyPoints: this.extractKeyPoints(fullAnalysis),
      recommendation:
        fullAnalysis.recommendation || 'Review all sections',
      trafficLight: this.determineTrafficLight(fullAnalysis),
      detailSections,
      rawDataAvailable: true,
    };
  }

  private createExpertView(fullAnalysis: Record<string, any>): SimplifiedView {
    return {
      level: 'EXPERT',
      headline: 'Complete Analysis Data',
      keyPoints: [],
      recommendation: 'Raw data available for expert review',
      trafficLight: this.determineTrafficLight(fullAnalysis),
      detailSections: [
        {
          title: 'Raw Analysis Object',
          content: JSON.stringify(fullAnalysis, null, 2),
          expandable: false,
        },
      ],
      rawDataAvailable: true,
    };
  }

  autoSelectLevel(
    userProfile: UserProfile,
    context: AnalysisContext
  ): DetailLevel {
    if (context.timeConstraint === 'urgent') {
      return 'GLANCE';
    }

    if (context.criticalOnly) {
      return 'SUMMARY';
    }

    switch (userProfile.role) {
      case 'executive':
        return context.timeConstraint === 'thorough' ? 'SUMMARY' : 'GLANCE';
      case 'portfolio_manager':
        return context.timeConstraint === 'thorough'
          ? 'DETAILED'
          : 'SUMMARY';
      case 'trader':
        return context.timeConstraint === 'thorough'
          ? 'DETAILED'
          : 'SUMMARY';
      case 'risk_manager':
        return 'DETAILED';
      case 'researcher':
        return userProfile.expertise === 'expert' ? 'EXPERT' : 'DETAILED';
      default:
        return 'SUMMARY';
    }
  }

  highlightOnly(
    analysis: Record<string, any>,
    topN: number = 5
  ): SimplifiedView {
    const findings: Finding[] = this.extractFindings(analysis);

    findings.sort((a, b) => {
      const impactOrder = { critical: 3, high: 2, medium: 1, low: 0 };
      return impactOrder[b.impact] - impactOrder[a.impact];
    });

    const topFindings = findings.slice(0, topN);

    return {
      level: 'SUMMARY',
      headline: `Top ${topN} Findings`,
      keyPoints: topFindings.map((f) => `${f.title}: ${f.description}`),
      recommendation: topFindings
        .filter((f) => f.actionable)
        .map((f) => f.description)
        .join('. '),
      trafficLight: topFindings.some((f) => f.impact === 'critical')
        ? 'red'
        : topFindings.some((f) => f.impact === 'high')
          ? 'yellow'
          : 'green',
      detailSections: topFindings.map((f) => ({
        title: f.title,
        content: f.description,
        expandable: false,
      })),
      rawDataAvailable: true,
    };
  }

  private extractFindings(analysis: Record<string, any>): Finding[] {
    const findings: Finding[] = [];

    if (analysis.sharpe_ratio !== undefined) {
      let impact: Finding['impact'] = 'low';
      if (analysis.sharpe_ratio > 1.5) impact = 'high';
      else if (analysis.sharpe_ratio > 1) impact = 'medium';
      else if (analysis.sharpe_ratio < 0.5) impact = 'critical';

      findings.push({
        category: 'Returns',
        title: 'Risk-Adjusted Returns',
        description: `Sharpe ratio of ${analysis.sharpe_ratio.toFixed(2)} indicates ${analysis.sharpe_ratio > 1 ? 'strong' : 'weak'} risk-adjusted returns`,
        metric: 'sharpe_ratio',
        value: analysis.sharpe_ratio,
        impact,
        actionable: analysis.sharpe_ratio < 0.8,
      });
    }

    if (analysis.max_drawdown !== undefined) {
      let impact: Finding['impact'] = 'low';
      if (Math.abs(analysis.max_drawdown) > 30) impact = 'critical';
      else if (Math.abs(analysis.max_drawdown) > 20) impact = 'high';
      else if (Math.abs(analysis.max_drawdown) > 15) impact = 'medium';

      findings.push({
        category: 'Risk',
        title: 'Maximum Drawdown',
        description: `Worst loss experienced was ${Math.abs(analysis.max_drawdown).toFixed(1)}%`,
        metric: 'max_drawdown',
        value: analysis.max_drawdown,
        impact,
        actionable: Math.abs(analysis.max_drawdown) > 25,
      });
    }

    if (analysis.criticisms && Array.isArray(analysis.criticisms)) {
      for (const criticism of analysis.criticisms.slice(0, 3)) {
        const severity = criticism.severity || 'medium';
        findings.push({
          category: 'Issues',
          title: criticism.title || 'Issue Found',
          description: criticism.description || criticism.message,
          impact: (severity as any) || 'medium',
          actionable: true,
        });
      }
    }

    if (analysis.outperformance !== undefined) {
      const impact =
        analysis.outperformance > 5
          ? 'high'
          : analysis.outperformance > 0
            ? 'medium'
            : 'low';

      findings.push({
        category: 'Performance',
        title: 'vs Benchmark',
        description: `${analysis.outperformance > 0 ? 'Outperformed' : 'Underperformed'} benchmark by ${Math.abs(analysis.outperformance).toFixed(1)}%`,
        metric: 'outperformance',
        value: analysis.outperformance,
        impact,
      });
    }

    return findings;
  }

  groupByTheme(findings: Finding[]): Record<string, Finding[]> {
    const grouped: Record<string, Finding[]> = {};

    for (const finding of findings) {
      if (!grouped[finding.category]) {
        grouped[finding.category] = [];
      }
      grouped[finding.category].push(finding);
    }

    return grouped;
  }

  progressiveDisclosure(
    analysis: Record<string, any>
  ): SimplifiedView {
    const sections: Array<{
      title: string;
      content: string;
      expandable: boolean;
    }> = [];

    sections.push({
      title: 'Overview',
      content:
        analysis.headline ||
        'Strategy Analysis Overview. Click to see key metrics.',
      expandable: true,
    });

    if (analysis.key_metrics) {
      sections.push({
        title: 'Key Metrics',
        content: Object.entries(analysis.key_metrics)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', '),
        expandable: true,
      });
    }

    if (analysis.performance) {
      sections.push({
        title: 'Performance Analysis',
        content: 'Detailed performance breakdown available.',
        expandable: true,
      });
    }

    if (analysis.risk) {
      sections.push({
        title: 'Risk Analysis',
        content: 'Complete risk assessment and limits.',
        expandable: true,
      });
    }

    if (analysis.criticisms && analysis.criticisms.length > 0) {
      sections.push({
        title: 'Issues and Recommendations',
        content: `${analysis.criticisms.length} items to review.`,
        expandable: true,
      });
    }

    if (analysis.raw_data) {
      sections.push({
        title: 'Raw Data Export',
        content: 'Complete dataset available for download.',
        expandable: true,
      });
    }

    return {
      level: 'DETAILED',
      headline: analysis.headline || 'Progressive Disclosure',
      keyPoints: this.extractKeyPoints(analysis),
      recommendation: analysis.recommendation || 'Click sections to expand',
      trafficLight: this.determineTrafficLight(analysis),
      detailSections: sections,
      rawDataAvailable: true,
    };
  }

  generateQuickCard(strategy: Record<string, any>): QuickCard {
    const status =
      strategy.status === 'approved'
        ? 'Ready for Shadow'
        : strategy.status === 'shadow'
          ? 'Shadowing'
          : strategy.status === 'live'
            ? 'Live Trading'
            : strategy.status || 'In Review';

    let mainMetricLabel = 'Return';
    let mainMetricValue = strategy.total_return || 0;
    let mainMetricUnit = '%';

    if (strategy.sharpe_ratio > 0 && strategy.sharpe_ratio <= 5) {
      mainMetricLabel = 'Sharpe Ratio';
      mainMetricValue = strategy.sharpe_ratio;
      mainMetricUnit = '';
    }

    const secondaryMetrics = [];

    if (strategy.total_return !== undefined) {
      secondaryMetrics.push({
        label: 'Total Return',
        value: strategy.total_return,
        unit: '%',
      });
    }

    if (strategy.max_drawdown !== undefined) {
      secondaryMetrics.push({
        label: 'Max DD',
        value: Math.abs(strategy.max_drawdown),
        unit: '%',
      });
    }

    if (strategy.win_rate !== undefined) {
      secondaryMetrics.push({
        label: 'Win Rate',
        value: strategy.win_rate,
        unit: '%',
      });
    }

    let riskLevel: 'low' | 'medium' | 'high' = 'medium';
    if (strategy.max_drawdown && Math.abs(strategy.max_drawdown) > 25) {
      riskLevel = 'high';
    } else if (strategy.max_drawdown && Math.abs(strategy.max_drawdown) < 10) {
      riskLevel = 'low';
    }

    return {
      strategyName: strategy.name || strategy.id || 'Strategy',
      status,
      mainMetric: {
        label: mainMetricLabel,
        value: mainMetricValue,
        unit: mainMetricUnit,
        trend: strategy.trend,
      },
      secondaryMetrics,
      recommendation:
        strategy.recommendation || 'See full analysis for details',
      riskLevel,
    };
  }
}
