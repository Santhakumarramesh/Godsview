import { EventEmitter } from 'events';

interface BacktestAssumption {
  id: string;
  category: 'fees' | 'slippage' | 'latency' | 'liquidity' | 'data' | 'execution' | 'market_structure';
  name: string;
  value: string;
  isRealistic: boolean;
  impactEstimate: 'negligible' | 'minor' | 'moderate' | 'severe';
  description: string;
  paperComparison?: { backtestValue: string; paperValue: string; deviation: number };
}

interface CredibilityReport {
  backtestId: string;
  strategy: string;
  assumptions: BacktestAssumption[];
  credibilityScore: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  warnings: string[];
  promotable: boolean;
  gatingIssues: string[];
}

interface BacktestConfig {
  feeModel?: string;
  fees?: number;
  slippage?: number;
  slippageModel?: string;
  spreadBps?: number;
  latencyMs?: number;
  partialFillsEnabled?: boolean;
  marketImpactEnabled?: boolean;
  sessionHoursEnforced?: boolean;
  haltSimulation?: boolean;
  survivorshipBiasControl?: boolean;
  walkForwardEnabled?: boolean;
  lookAheadCheck?: boolean;
  benchmarkComparison?: string;
  minTrades?: number;
  timePeriodYears?: number;
  riskFreeComparison?: boolean;
  maxDrawdownCheck?: boolean;
  positionSizingMatches?: boolean;
  overnightGapsModeled?: boolean;
  dividendAdjustment?: boolean;
  commissionStructure?: string;
}

interface BacktestResults {
  totalTrades: number;
  timePeriodYears: number;
  returnPercent: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  avgTrade: number;
}

interface PaperResults {
  returnPercent: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  avgTrade: number;
}

export class AssumptionTracker extends EventEmitter {
  private reports: Map<string, CredibilityReport> = new Map();
  private mockBacktests: Map<string, { config: BacktestConfig; results: BacktestResults }> = new Map();

  constructor() {
    super();
    this._initializeMockBacktests();
  }

  private _initializeMockBacktests(): void {
    // No mock backtests — real backtests are added via assessBacktest() from actual runs
  }

  assessBacktest(backtestId: string, config: BacktestConfig, results: BacktestResults): CredibilityReport {
    const assumptions = this._buildAssumptions(config);
    const credibilityScore = this._calculateCredibilityScore(assumptions, results, config);
    const grade = this._assignGrade(credibilityScore);
    const warnings = this._generateWarnings(assumptions, results, config);
    const gatingIssues = this._identifyGatingIssues(assumptions, credibilityScore);
    const promotable = credibilityScore >= 60 && gatingIssues.length === 0;

    const report: CredibilityReport = {
      backtestId,
      strategy: `strategy_${backtestId}`,
      assumptions,
      credibilityScore,
      grade,
      warnings,
      promotable,
      gatingIssues,
    };

    this.reports.set(backtestId, report);

    this.emit('assessment:complete', { backtestId, grade, score: credibilityScore });

    if (credibilityScore < 60) {
      this.emit('credibility:low', { backtestId, score: credibilityScore });
    }

    if (!promotable) {
      this.emit('promotion:blocked', { backtestId, issues: gatingIssues });
    }

    const unrealisticAssumptions = assumptions.filter((a) => !a.isRealistic && a.impactEstimate === 'severe');
    if (unrealisticAssumptions.length > 0) {
      this.emit('assumption:unrealistic', { backtestId, assumptions: unrealisticAssumptions });
    }

    return report;
  }

  private _buildAssumptions(config: BacktestConfig): BacktestAssumption[] {
    const assumptions: BacktestAssumption[] = [];
    let idCounter = 1;

    // Fee Model
    const feeIsRealistic = (config.fees ?? 0) > 0 && (config.fees ?? 0) < 0.01;
    assumptions.push({
      id: `a-${idCounter++}`,
      category: 'fees',
      name: 'Fee Model',
      value: `${config.feeModel}: ${config.fees ?? 0}%`,
      isRealistic: feeIsRealistic,
      impactEstimate: !feeIsRealistic ? 'severe' : 'moderate',
      description: 'Trading fees affect net returns; realistic fees are 0.001-0.005% for equities',
    });

    // Slippage
    const slippageIsRealistic = (config.slippage ?? 0) >= 0.5 && (config.slippage ?? 0) <= 3;
    assumptions.push({
      id: `a-${idCounter++}`,
      category: 'slippage',
      name: 'Slippage Modeling',
      value: `${config.slippageModel}: ${config.slippage ?? 0} bps`,
      isRealistic: slippageIsRealistic,
      impactEstimate: !slippageIsRealistic ? 'severe' : 'moderate',
      description: 'Slippage accounts for difference between expected and actual execution price',
    });

    // Spread
    const spreadIsRealistic = (config.spreadBps ?? 0) > 0.5 && (config.spreadBps ?? 0) <= 5;
    assumptions.push({
      id: `a-${idCounter++}`,
      category: 'market_structure',
      name: 'Bid-Ask Spread Simulation',
      value: `${config.spreadBps ?? 0} bps`,
      isRealistic: spreadIsRealistic,
      impactEstimate: !spreadIsRealistic ? 'moderate' : 'minor',
      description: 'Bid-ask spreads are essential for realistic entry/exit costs',
    });

    // Latency
    const latencyIsRealistic = (config.latencyMs ?? 0) >= 10 && (config.latencyMs ?? 0) <= 500;
    assumptions.push({
      id: `a-${idCounter++}`,
      category: 'latency',
      name: 'Order-to-Fill Latency',
      value: `${config.latencyMs ?? 0} ms`,
      isRealistic: latencyIsRealistic,
      impactEstimate: !latencyIsRealistic ? 'moderate' : 'negligible',
      description: 'Network latency affects execution timing and fill quality',
    });

    // Partial Fills
    assumptions.push({
      id: `a-${idCounter++}`,
      category: 'execution',
      name: 'Partial Fills Enabled',
      value: config.partialFillsEnabled ? 'yes' : 'no',
      isRealistic: config.partialFillsEnabled === true,
      impactEstimate: !config.partialFillsEnabled ? 'moderate' : 'negligible',
      description: 'Large orders may not fill completely at target price',
    });

    // Market Impact
    assumptions.push({
      id: `a-${idCounter++}`,
      category: 'execution',
      name: 'Market Impact Modeling',
      value: config.marketImpactEnabled ? 'enabled' : 'disabled',
      isRealistic: config.marketImpactEnabled === true,
      impactEstimate: !config.marketImpactEnabled ? 'moderate' : 'minor',
      description: 'Large orders influence market price; must be modeled for realistic results',
    });

    // Session Hours
    assumptions.push({
      id: `a-${idCounter++}`,
      category: 'market_structure',
      name: 'Session Hours Enforcement',
      value: config.sessionHoursEnforced ? 'enforced' : 'ignored',
      isRealistic: config.sessionHoursEnforced === true,
      impactEstimate: !config.sessionHoursEnforced ? 'minor' : 'negligible',
      description: 'Out-of-session orders cannot execute in live trading',
    });

    // Halts
    assumptions.push({
      id: `a-${idCounter++}`,
      category: 'market_structure',
      name: 'Market Halts Simulation',
      value: config.haltSimulation ? 'simulated' : 'ignored',
      isRealistic: config.haltSimulation === true,
      impactEstimate: !config.haltSimulation ? 'minor' : 'negligible',
      description: 'Trading halts during circuit breaker events must be modeled',
    });

    // Survivorship Bias
    assumptions.push({
      id: `a-${idCounter++}`,
      category: 'data',
      name: 'Survivorship Bias Control',
      value: config.survivorshipBiasControl ? 'controlled' : 'not_controlled',
      isRealistic: config.survivorshipBiasControl === true,
      impactEstimate: !config.survivorshipBiasControl ? 'severe' : 'negligible',
      description: 'Include delisted/deleveraged instruments to avoid inflated returns',
    });

    // Walk-Forward
    assumptions.push({
      id: `a-${idCounter++}`,
      category: 'data',
      name: 'Walk-Forward Out-of-Sample Validation',
      value: config.walkForwardEnabled ? 'enabled' : 'disabled',
      isRealistic: config.walkForwardEnabled === true,
      impactEstimate: !config.walkForwardEnabled ? 'severe' : 'negligible',
      description: 'Out-of-sample testing prevents overfitting; essential for credibility',
    });

    // Look-Ahead Bias
    assumptions.push({
      id: `a-${idCounter++}`,
      category: 'data',
      name: 'Look-Ahead Bias Check',
      value: config.lookAheadCheck ? 'checked' : 'not_checked',
      isRealistic: config.lookAheadCheck === true,
      impactEstimate: !config.lookAheadCheck ? 'severe' : 'negligible',
      description: 'Verify no future data is used in strategy logic',
    });

    // Benchmark Comparison
    const benchmarkExists = (config.benchmarkComparison ?? 'none') !== 'none';
    assumptions.push({
      id: `a-${idCounter++}`,
      category: 'data',
      name: 'Benchmark Comparison',
      value: config.benchmarkComparison ?? 'none',
      isRealistic: benchmarkExists,
      impactEstimate: !benchmarkExists ? 'moderate' : 'negligible',
      description: 'Alpha must be measured against appropriate benchmark (e.g., SPY, QQQ)',
    });

    // Minimum Trades
    const minTradesOk = (config.minTrades ?? 0) >= 100;
    assumptions.push({
      id: `a-${idCounter++}`,
      category: 'data',
      name: 'Sample Size (Min Trades)',
      value: `${config.minTrades ?? 0} trades`,
      isRealistic: minTradesOk,
      impactEstimate: !minTradesOk ? 'moderate' : 'negligible',
      description: 'Statistical significance requires at least 100 trades; <100 is noise',
    });

    // Time Period
    const timePeriodOk = (config.timePeriodYears ?? 0) >= 1;
    assumptions.push({
      id: `a-${idCounter++}`,
      category: 'data',
      name: 'Time Period Coverage',
      value: `${config.timePeriodYears ?? 0} years`,
      isRealistic: timePeriodOk,
      impactEstimate: !timePeriodOk ? 'severe' : 'negligible',
      description: 'Must span multiple market regimes (bull, bear, sideways) for credibility',
    });

    // Risk-Free Comparison
    assumptions.push({
      id: `a-${idCounter++}`,
      category: 'execution',
      name: 'Risk-Free Rate Comparison',
      value: config.riskFreeComparison ? 'yes' : 'no',
      isRealistic: config.riskFreeComparison === true,
      impactEstimate: !config.riskFreeComparison ? 'minor' : 'negligible',
      description: 'Compare Sharpe ratio to Treasury yields to validate alpha',
    });

    // Drawdown Realism
    assumptions.push({
      id: `a-${idCounter++}`,
      category: 'execution',
      name: 'Max Drawdown Check',
      value: config.maxDrawdownCheck ? 'checked' : 'unchecked',
      isRealistic: config.maxDrawdownCheck === true,
      impactEstimate: !config.maxDrawdownCheck ? 'minor' : 'negligible',
      description: 'Verify drawdown is realistic; >50% raises sustainability questions',
    });

    // Position Sizing
    assumptions.push({
      id: `a-${idCounter++}`,
      category: 'execution',
      name: 'Position Sizing Realism',
      value: config.positionSizingMatches ? 'matches_live' : 'theoretical',
      isRealistic: config.positionSizingMatches === true,
      impactEstimate: !config.positionSizingMatches ? 'moderate' : 'negligible',
      description: 'Position sizes must match actual live trading constraints',
    });

    // Overnight Gaps
    assumptions.push({
      id: `a-${idCounter++}`,
      category: 'market_structure',
      name: 'Overnight Gaps Modeling',
      value: config.overnightGapsModeled ? 'modeled' : 'ignored',
      isRealistic: config.overnightGapsModeled === true,
      impactEstimate: !config.overnightGapsModeled ? 'minor' : 'negligible',
      description: 'Gap risk between close and open must be accounted for',
    });

    // Dividends & Splits
    assumptions.push({
      id: `a-${idCounter++}`,
      category: 'data',
      name: 'Dividend/Split Adjustment',
      value: config.dividendAdjustment ? 'adjusted' : 'not_adjusted',
      isRealistic: config.dividendAdjustment === true,
      impactEstimate: !config.dividendAdjustment ? 'minor' : 'negligible',
      description: 'Historical data must be adjusted for dividends and stock splits',
    });

    // Commission Structure
    const commissionRealistic = (config.commissionStructure ?? 'none') !== 'none';
    assumptions.push({
      id: `a-${idCounter++}`,
      category: 'fees',
      name: 'Commission Structure',
      value: config.commissionStructure ?? 'none',
      isRealistic: commissionRealistic,
      impactEstimate: !commissionRealistic ? 'moderate' : 'negligible',
      description: 'Commission must match actual broker (IB, Robinhood, etc.)',
    });

    return assumptions;
  }

  private _calculateCredibilityScore(
    assumptions: BacktestAssumption[],
    results: BacktestResults,
    config: BacktestConfig
  ): number {
    let score = 100;

    // Deduct for unrealistic assumptions
    for (const assumption of assumptions) {
      if (!assumption.isRealistic) {
        if (assumption.impactEstimate === 'severe') {
          score -= 15;
        } else if (assumption.impactEstimate === 'moderate') {
          score -= 8;
        } else if (assumption.impactEstimate === 'minor') {
          score -= 3;
        }
      }
    }

    // Deduct for extreme returns (likely overfitting)
    if (results.returnPercent > 50) {
      score -= 20;
    } else if (results.returnPercent > 30) {
      score -= 10;
    }

    // Deduct for low Sharpe ratio
    if (results.sharpeRatio < 0.5) {
      score -= 15;
    } else if (results.sharpeRatio < 1.0) {
      score -= 8;
    }

    // Deduct for high drawdown
    if (results.maxDrawdown > 40) {
      score -= 15;
    } else if (results.maxDrawdown > 25) {
      score -= 8;
    }

    // Deduct for low win rate
    if (results.winRate < 0.45) {
      score -= 10;
    }

    // Deduct for small sample size
    if (results.totalTrades < 100) {
      score -= 15;
    } else if (results.totalTrades < 150) {
      score -= 8;
    }

    // Deduct for short time period
    if (results.timePeriodYears < 1) {
      score -= 20;
    } else if (results.timePeriodYears < 2) {
      score -= 10;
    }

    // Bonus for strong fundamentals
    if (results.sharpeRatio > 1.5) {
      score += 5;
    }
    if (results.maxDrawdown < 15) {
      score += 5;
    }

    return Math.max(0, Math.min(100, score));
  }

  private _assignGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
    if (score >= 85) return 'A';
    if (score >= 70) return 'B';
    if (score >= 55) return 'C';
    if (score >= 40) return 'D';
    return 'F';
  }

  private _generateWarnings(
    assumptions: BacktestAssumption[],
    results: BacktestResults,
    config: BacktestConfig
  ): string[] {
    const warnings: string[] = [];

    for (const assumption of assumptions) {
      if (!assumption.isRealistic) {
        warnings.push(`Unrealistic assumption: ${assumption.name} (${assumption.description})`);
      }
    }

    if (results.returnPercent > 50) {
      warnings.push('Returns exceed 50% annually; potential overfitting or look-ahead bias');
    }

    if (results.sharpeRatio < 0.5) {
      warnings.push('Sharpe ratio < 0.5 indicates inconsistent risk-adjusted returns');
    }

    if (results.maxDrawdown > 40) {
      warnings.push('Maximum drawdown > 40% questions strategy sustainability');
    }

    if (results.totalTrades < 100) {
      warnings.push(`Sample size (${results.totalTrades} trades) below statistical significance threshold`);
    }

    if (results.timePeriodYears < 1) {
      warnings.push('Backtest period < 1 year; insufficient market regime coverage');
    }

    if (results.winRate < 0.45) {
      warnings.push(`Win rate (${(results.winRate * 100).toFixed(1)}%) below breakeven threshold`);
    }

    if (results.avgTrade < 0.1) {
      warnings.push('Average trade size very small; execution costs may dominate');
    }

    return warnings;
  }

  private _identifyGatingIssues(assumptions: BacktestAssumption[], score: number): string[] {
    const issues: string[] = [];

    if (score < 60) {
      issues.push(`Credibility score ${score}/100 below promotion threshold of 60`);
    }

    const severeUnrealistic = assumptions.filter((a) => !a.isRealistic && a.impactEstimate === 'severe');
    for (const assumption of severeUnrealistic) {
      issues.push(`Severe assumption violation: ${assumption.name}`);
    }

    return issues;
  }

  getCredibilityReport(backtestId: string): CredibilityReport | null {
    return this.reports.get(backtestId) ?? null;
  }

  compareToPaper(backtestId: string, paperResults: PaperResults): CredibilityReport | null {
    const report = this.reports.get(backtestId);
    if (!report) return null;

    const backtest = this.mockBacktests.get(backtestId);
    if (!backtest) return null;

    const btResults = backtest.results;

    // Calculate deviations
    const returnDev = Math.abs((btResults.returnPercent - paperResults.returnPercent) / Math.abs(paperResults.returnPercent || 1)) * 100;
    const sharpeDev = Math.abs((btResults.sharpeRatio - paperResults.sharpeRatio) / Math.abs(paperResults.sharpeRatio || 1)) * 100;
    const ddDev = Math.abs((btResults.maxDrawdown - paperResults.maxDrawdown) / Math.abs(paperResults.maxDrawdown || 1)) * 100;
    const wrDev = Math.abs((btResults.winRate - paperResults.winRate) / Math.abs(paperResults.winRate || 1)) * 100;

    const deviationThreshold = 20;
    const deviations = [
      { metric: 'return', dev: returnDev, bt: btResults.returnPercent, paper: paperResults.returnPercent },
      { metric: 'sharpe', dev: sharpeDev, bt: btResults.sharpeRatio, paper: paperResults.sharpeRatio },
      { metric: 'drawdown', dev: ddDev, bt: btResults.maxDrawdown, paper: paperResults.maxDrawdown },
      { metric: 'win_rate', dev: wrDev, bt: btResults.winRate, paper: paperResults.winRate },
    ];

    const largeDeviations = deviations.filter((d) => d.dev > deviationThreshold);

    // Update assumptions with paper comparison
    for (const assumption of report.assumptions) {
      for (const dev of deviations) {
        if (assumption.name.toLowerCase().includes(dev.metric)) {
          assumption.paperComparison = {
            backtestValue: dev.bt.toString(),
            paperValue: dev.paper.toString(),
            deviation: dev.dev,
          };
        }
      }
    }

    // Adjust credibility if deviations are large
    if (largeDeviations.length > 0) {
      const deductionPerDeviation = 10;
      const deduction = Math.min(30, largeDeviations.length * deductionPerDeviation);
      report.credibilityScore = Math.max(0, report.credibilityScore - deduction);
      report.grade = this._assignGrade(report.credibilityScore);

      for (const dev of largeDeviations) {
        report.warnings.push(
          `Paper/backtest deviation on ${dev.metric}: ${dev.dev.toFixed(1)}% (BT: ${dev.bt.toFixed(2)}, Paper: ${dev.paper.toFixed(2)})`
        );
      }
    }

    return report;
  }

  isPromotable(backtestId: string): { promotable: boolean; reasons: string[] } {
    const report = this.reports.get(backtestId);
    if (!report) {
      return { promotable: false, reasons: ['Backtest not assessed'] };
    }

    const reasons: string[] = [];

    if (report.credibilityScore < 60) {
      reasons.push(`Score ${report.credibilityScore}/100 below threshold of 60`);
    }

    if (report.gatingIssues.length > 0) {
      reasons.push(...report.gatingIssues);
    }

    return {
      promotable: reasons.length === 0,
      reasons,
    };
  }

  getWarnings(backtestId: string): string[] {
    const report = this.reports.get(backtestId);
    return report?.warnings ?? [];
  }

  getAllReports(): CredibilityReport[] {
    return Array.from(this.reports.values());
  }

  // Helper: Assess a pre-populated mock backtest and return the report
  assessMockBacktest(backtestId: string): CredibilityReport | null {
    const mock = this.mockBacktests.get(backtestId);
    if (!mock) return null;

    return this.assessBacktest(backtestId, mock.config, mock.results);
  }

  // Helper: Get all mock backtest IDs
  getMockBacktestIds(): string[] {
    return Array.from(this.mockBacktests.keys());
  }
}
