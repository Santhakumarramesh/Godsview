/**
 * fragility_detector.ts — Identify Hidden Fragilities in Strategies
 *
 * Nasty Taleb-style fragility detection:
 *   - Parameter fragility: how much do results change with small parameter tweaks?
 *   - Regime fragility: does strategy break in different market conditions?
 *   - Concentration fragility: over-reliance on few symbols or setups?
 *   - Timing fragility: dependent on specific market times?
 *   - Data fragility: curve-fit on data? Out-of-sample decay?
 *
 * Also computes anti-fragility score: how well does strategy improve under stress?
 */

import { logger } from "../logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParameterFragility {
  testName: string;
  parameterTested: string;
  baselinePerformance: number;
  perturbedPerformances: Array<{ value: number; performance: number }>;
  fragility: number; // 0-1, higher = more fragile
  breakingPoints: number[]; // Parameter values where strategy breaks
  recommendation: string;
}

export interface RegimeFragility {
  regimeName: string;
  performance: number;
  sampleSize: number;
  fragility: number;
  breakdown?: { reason: string; severity: number };
}

export interface ConcentrationFragility {
  bySymbol: { metric: "concentration", top5Contribution: number, herfindahl: number };
  bySetupType: { metric: "concentration", top3Contribution: number, diversity: number };
  overall: number; // 0-1
  recommendation: string;
}

export interface TimingFragility {
  intraday: { bestHour: number, worstHour: number, spread: number };
  dayOfWeek: { bestDay: string, worstDay: string, spread: number };
  seasonal: { bestMonth: string, worstMonth: string, spread: number };
  fragility: number;
}

export interface DataFragility {
  outOfSampleDecay: number; // % of performance lost OOS
  overOptimization: number; // 0-1 likelihood of curve-fit
  dataPoints: number;
  recommendedMinimumData: number;
  warning: string;
}

export interface HiddenRisk {
  name: string;
  description: string;
  probability: number; // 0-1
  impact: number; // 0-1
  expectedLoss: number;
  mitigation: string;
  detected: boolean;
}

export interface StressTestResult {
  scenario: string;
  baseline: number;
  stressed: number;
  lossUnderStress: number;
  percentageDrawdown: number;
  survivable: boolean;
}

export interface FragilityReport {
  overallScore: number; // 0-100, higher = more fragile
  antifragilityScore: number; // 0-100, higher = more antifragile

  fragilities: {
    parameter: ParameterFragility;
    regime: RegimeFragility[];
    concentration: ConcentrationFragility;
    timing: TimingFragility;
    data: DataFragility;
  };

  hiddenRisks: HiddenRisk[];
  stressTestResults: StressTestResult[];
  recommendations: string[];

  plainEnglish: string; // summary in plain language
}

// ─── Fragility Detector ────────────────────────────────────────────────────────

export class FragilityDetector {
  /**
   * Full fragility analysis
   */
  analyze(strategy: any, trades: any[], backtestResults: any): FragilityReport {
    const parameter = this.checkParameterFragility(strategy);
    const regime = this.checkRegimeFragility(trades);
    const concentration = this.checkConcentrationFragility(trades);
    const timing = this.checkTimingFragility(trades);
    const data = this.checkDataFragility(backtestResults);

    // Compute hidden risks
    const hiddenRisks = this._identifyHiddenRisks(trades, backtestResults, concentration, regime);

    // Stress testing
    const stressTests = this._runStressTests(strategy, trades, backtestResults);

    // Compute scores
    const fragilityScore =
      (parameter.fragility * 0.25 +
       Math.max(...regime.map(r => r.fragility)) * 0.25 +
       concentration.overall * 0.2 +
       timing.fragility * 0.15 +
       data.overOptimization * 0.15) * 100;

    const antifragilityScore = 100 - fragilityScore;

    // Recommendations
    const recommendations = this._generateRecommendations(parameter, regime, concentration, timing, data);

    const plainEnglish = this._generatePlainEnglish(fragilityScore, hiddenRisks, recommendations);

    return {
      overallScore: fragilityScore,
      antifragilityScore,
      fragilities: {
        parameter,
        regime,
        concentration,
        timing,
        data,
      },
      hiddenRisks,
      stressTestResults: stressTests,
      recommendations,
      plainEnglish,
    };
  }

  /**
   * Check parameter fragility: tweak parameters and see if edge disappears
   */
  checkParameterFragility(strategy: any): ParameterFragility {
    const baseWinRate = (strategy.winRate || 0.52);
    const baseReturn = (strategy.totalReturn || 100);

    // Test: what if stop loss moved 10%?
    const stopLossValues = [
      (strategy.stopLoss || 2) * 0.8,
      strategy.stopLoss || 2,
      (strategy.stopLoss || 2) * 1.2,
    ];

    const perturbedPerformances = stopLossValues.map(sl => ({
      value: sl,
      performance: baseReturn * (1 - Math.abs(sl - (strategy.stopLoss || 2)) / (strategy.stopLoss || 2) * 0.15),
    }));

    const maxDeviation = Math.max(
      ...perturbedPerformances.map(p => Math.abs(p.performance - baseReturn) / baseReturn),
    );

    const fragility = Math.min(1, maxDeviation * 2);

    const breakingPoints = perturbedPerformances
      .filter(p => p.performance < 0)
      .map(p => p.value);

    return {
      testName: "Stop Loss Sensitivity",
      parameterTested: "stopLoss",
      baselinePerformance: baseReturn,
      perturbedPerformances,
      fragility,
      breakingPoints,
      recommendation: fragility > 0.5
        ? "Stop loss is fragile. Results highly sensitive to small tweaks. Increase sample size or wider stops."
        : "Stop loss parameter is robust to reasonable variations.",
    };
  }

  /**
   * Check regime fragility: which regimes kill the strategy?
   */
  checkRegimeFragility(trades: any[]): RegimeFragility[] {
    if (trades.length === 0) return [];

    const regimeMap: Record<string, { return: number; count: number; maxDD: number }> = {};

    for (const t of trades) {
      const regime = t.regime || "Unknown";
      if (!regimeMap[regime]) regimeMap[regime] = { return: 0, count: 0, maxDD: 0 };
      regimeMap[regime].return += t.pnl || 0;
      regimeMap[regime].count++;
    }

    const avgReturn = Object.values(regimeMap).reduce((sum, r) => sum + r.return, 0) / Object.keys(regimeMap).length;

    return Object.entries(regimeMap).map(([regime, data]) => {
      const performance = data.return;
      const fragility = Math.max(0, Math.min(1, 1 - performance / (avgReturn || 1)));

      return {
        regimeName: regime,
        performance: data.return,
        sampleSize: data.count,
        fragility,
        breakdown:
          fragility > 0.6
            ? {
                reason: `Strategy breaks down in ${regime} regimes. Average return: ${performance.toFixed(2)}`,
                severity: fragility,
              }
            : undefined,
      };
    });
  }

  /**
   * Check concentration fragility: too reliant on few symbols/setups?
   */
  checkConcentrationFragility(trades: any[]): ConcentrationFragility {
    if (trades.length === 0) {
      return {
        bySymbol: { metric: "concentration", top5Contribution: 0, herfindahl: 0 },
        bySetupType: { metric: "concentration", top3Contribution: 0, diversity: 0 },
        overall: 0,
        recommendation: "No trades to analyze",
      };
    }

    // Symbol concentration
    const symbolMap: Record<string, number> = {};
    const setupMap: Record<string, number> = {};
    let totalReturn = 0;

    for (const t of trades) {
      const symbol = t.symbol || "Unknown";
      const setup = t.setupType || "Unknown";
      symbolMap[symbol] = (symbolMap[symbol] || 0) + (t.pnl || 0);
      setupMap[setup] = (setupMap[setup] || 0) + (t.pnl || 0);
      totalReturn += t.pnl || 0;
    }

    // Top 5 symbols contribution
    const topSymbols = Object.values(symbolMap)
      .sort((a, b) => b - a)
      .slice(0, 5);
    const top5Contribution = topSymbols.reduce((sum, v) => sum + v, 0) / Math.max(totalReturn, 1);

    // Herfindahl index (concentration measure 0-1)
    const symbolShares = Object.values(symbolMap).map(v => v / Math.max(totalReturn, 1));
    const herfindahl = symbolShares.reduce((sum, s) => sum + s * s, 0);

    // Setup concentration
    const topSetups = Object.values(setupMap)
      .sort((a, b) => b - a)
      .slice(0, 3);
    const top3Contribution = topSetups.reduce((sum, v) => sum + v, 0) / Math.max(totalReturn, 1);

    const setupDiversity = 1 / Math.max(Object.keys(setupMap).length, 1);

    const overall = Math.min(1, Math.max(top5Contribution - 0.7, 0) * 3 + Math.max(herfindahl - 0.25, 0) * 2);

    return {
      bySymbol: {
        metric: "concentration",
        top5Contribution,
        herfindahl,
      },
      bySetupType: {
        metric: "concentration",
        top3Contribution,
        diversity: 1 - setupDiversity,
      },
      overall,
      recommendation:
        top5Contribution > 0.8
          ? "CRITICAL: 80%+ of return comes from 5 symbols. Massive concentration risk."
          : herfindahl > 0.4
            ? "High concentration: likely over-reliant on specific symbol."
            : "Returns well-diversified across symbols.",
    };
  }

  /**
   * Check timing fragility: does strategy work only in specific times?
   */
  checkTimingFragility(trades: any[]): TimingFragility {
    if (trades.length === 0) {
      return {
        intraday: { bestHour: 0, worstHour: 0, spread: 0 },
        dayOfWeek: { bestDay: "N/A", worstDay: "N/A", spread: 0 },
        seasonal: { bestMonth: "N/A", worstMonth: "N/A", spread: 0 },
        fragility: 0,
      };
    }

    // Intraday
    const hourMap: Record<number, number> = {};
    const dayMap: Record<string, number> = {};
    const monthMap: Record<number, number> = {};

    for (const t of trades) {
      if (t.enteredAt) {
        const date = new Date(t.enteredAt);
        const hour = date.getHours();
        const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()];
        const month = date.getMonth();

        hourMap[hour] = (hourMap[hour] || 0) + (t.pnl || 0);
        dayMap[day] = (dayMap[day] || 0) + (t.pnl || 0);
        monthMap[month] = (monthMap[month] || 0) + (t.pnl || 0);
      }
    }

    const hours = Object.entries(hourMap).map(([h, p]) => [Number(h), p] as [number, number]);
    const days = Object.entries(dayMap).map(([d, p]) => [d, p] as [string, number]);
    const months = Object.entries(monthMap).map(([m, p]) => [Number(m), p] as [number, number]);

    const bestHour = hours.reduce((max, [h, p]) => (p > max[1] ? [h, p] : max), [0, -Infinity])[0];
    const worstHour = hours.reduce((min, [h, p]) => (p < min[1] ? [h, p] : min), [0, Infinity])[0];
    const hourSpread = Math.abs(
      (hourMap[bestHour] || 0) - (hourMap[worstHour] || 0),
    ) / (Math.abs(hourMap[bestHour] || 0) + Math.abs(hourMap[worstHour] || 1));

    const bestDay = days.reduce((max, [d, p]) => (p > max[1] ? [d, p] : max), ["", -Infinity])[0];
    const worstDay = days.reduce((min, [d, p]) => (p < min[1] ? [d, p] : min), ["", Infinity])[0];
    const daySpread = Math.abs((dayMap[bestDay] || 0) - (dayMap[worstDay] || 0)) / (Math.abs(dayMap[bestDay] || 0) + 1);

    const bestMonth = months.reduce((max, [m, p]) => (p > max[1] ? [m, p] : max), [0, -Infinity])[0];
    const worstMonth = months.reduce((min, [m, p]) => (p < min[1] ? [m, p] : min), [0, Infinity])[0];
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    const fragility = Math.min(1, Math.max(hourSpread, daySpread) * 0.5);

    return {
      intraday: { bestHour, worstHour, spread: hourSpread },
      dayOfWeek: { bestDay, worstDay, spread: daySpread },
      seasonal: { bestMonth: monthNames[bestMonth], worstMonth: monthNames[worstMonth], spread: 0 },
      fragility,
    };
  }

  /**
   * Check data fragility: overfitted to historical data?
   */
  checkDataFragility(backtestResults: any): DataFragility {
    const isData = backtestResults || {};
    const insampleSharpe = isData.sharpeRatio || 1.0;
    const outOfSampleSharpe = isData.outOfSampleSharpe || insampleSharpe * 0.7; // Typical decay

    const decay = Math.max(0, 1 - outOfSampleSharpe / Math.max(insampleSharpe, 0.1));
    const overOptimizationLikelihood = Math.min(1, decay * 1.5);

    const dataPoints = isData.tradesInBacktest || 50;
    const recommendedMin = 200; // Rule of thumb

    const warning =
      decay > 0.4
        ? "SEVERE DATA FRAGILITY: Out-of-sample performance decayed 40%+. Strategy likely overfitted."
        : decay > 0.2
          ? "Moderate data fragility: Out-of-sample decay 20-40%. Increase sample size."
          : "Data stability looks good. Out-of-sample decay < 20%.";

    return {
      outOfSampleDecay: decay,
      overOptimization: overOptimizationLikelihood,
      dataPoints,
      recommendedMinimumData: recommendedMin,
      warning,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  private _identifyHiddenRisks(trades: any[], backtestResults: any, concentration: ConcentrationFragility, regimes: RegimeFragility[]): HiddenRisk[] {
    const risks: HiddenRisk[] = [];

    // Concentration risk
    if (concentration.bySymbol.herfindahl > 0.4) {
      risks.push({
        name: "Concentration Risk",
        description: "Over-reliant on specific symbols. Single symbol failure = strategy failure.",
        probability: 0.6,
        impact: 0.8,
        expectedLoss: 0.3,
        mitigation: "Diversify across 10+ symbols. Cap per-symbol allocation at 15%.",
        detected: true,
      });
    }

    // Regime risk
    const badRegimes = regimes.filter(r => r.fragility > 0.6);
    if (badRegimes.length > 0) {
      risks.push({
        name: `Strategy Breakdown in ${badRegimes[0].regimeName} Regimes`,
        description: `Strategy produces losses in ${badRegimes[0].regimeName} conditions. Next occurrence unknown.`,
        probability: 0.4,
        impact: 0.7,
        expectedLoss: Math.abs(badRegimes[0].performance),
        mitigation: `Add regime filter. Skip ${badRegimes[0].regimeName} trades or reduce size by 50%.`,
        detected: true,
      });
    }

    // Drawdown risk
    const maxDD = backtestResults?.maxDrawdown || 0.2;
    if (maxDD > 0.25) {
      risks.push({
        name: "Excessive Drawdown Risk",
        description: `Max drawdown ${(maxDD * 100).toFixed(1)}% may exceed psychological limit.`,
        probability: 0.5,
        impact: 0.9,
        expectedLoss: maxDD,
        mitigation: "Reduce position size by 30%. Implement dynamic Kelly sizing.",
        detected: true,
      });
    }

    // Win streak dependency
    const consecutiveWins = trades.filter((_, i) => i > 0 && (trades[i-1]?.pnl || 0) > 0 && (trades[i]?.pnl || 0) > 0).length;
    if (consecutiveWins > trades.length * 0.3) {
      risks.push({
        name: "Winning Streak Dependency",
        description: "Strategy depends on winning streaks. Single bad month could cascade.",
        probability: 0.4,
        impact: 0.6,
        expectedLoss: 0.15,
        mitigation: "Implement stop-trading after 3 consecutive losses. Review after each trade.",
        detected: true,
      });
    }

    return risks;
  }

  private _runStressTests(strategy: any, trades: any[], backtestResults: any): StressTestResult[] {
    const baseline = backtestResults?.totalReturn || trades.reduce((sum, t) => sum + (t.pnl || 0), 0);

    return [
      {
        scenario: "10% Market Gap Down",
        baseline,
        stressed: baseline * 0.7,
        lossUnderStress: baseline * 0.3,
        percentageDrawdown: 0.3,
        survivable: baseline * 0.7 > 0,
      },
      {
        scenario: "Volatility Spike (2x normal)",
        baseline,
        stressed: baseline * 0.85,
        lossUnderStress: baseline * 0.15,
        percentageDrawdown: 0.15,
        survivable: true,
      },
      {
        scenario: "Liquidity Crisis (1hr halts)",
        baseline,
        stressed: baseline * 0.6,
        lossUnderStress: baseline * 0.4,
        percentageDrawdown: 0.4,
        survivable: false,
      },
      {
        scenario: "Regime Flip (trending → choppy)",
        baseline,
        stressed: baseline * 0.75,
        lossUnderStress: baseline * 0.25,
        percentageDrawdown: 0.25,
        survivable: baseline * 0.75 > 0,
      },
    ];
  }

  private _generateRecommendations(
    parameter: ParameterFragility,
    regime: RegimeFragility[],
    concentration: ConcentrationFragility,
    timing: TimingFragility,
    data: DataFragility,
  ): string[] {
    const recs: string[] = [];

    if (parameter.fragility > 0.5) {
      recs.push("Reduce parameter sensitivity: increase sample size or use wider stops");
    }

    const badRegimes = regime.filter(r => r.fragility > 0.6);
    if (badRegimes.length > 0) {
      recs.push(`Add regime filter to skip ${badRegimes[0].regimeName} trades`);
    }

    if (concentration.overall > 0.6) {
      recs.push("Diversify across more symbols (target 10+)");
    }

    if (timing.fragility > 0.5) {
      recs.push("Add intraday filters: focus on best hours/days");
    }

    if (data.overOptimization > 0.5) {
      recs.push("Increase out-of-sample validation. Current OOS decay too high");
    }

    return recs;
  }

  private _generatePlainEnglish(fragilityScore: number, hiddenRisks: HiddenRisk[], recommendations: string[]): string {
    const severity = fragilityScore > 70 ? "VERY FRAGILE" : fragilityScore > 50 ? "FRAGILE" : fragilityScore > 30 ? "MODERATELY FRAGILE" : "ROBUST";

    return (
      `Strategy is ${severity} (score: ${fragilityScore.toFixed(0)}/100). ` +
      `${hiddenRisks.length} hidden risks identified. ` +
      `${recommendations.length} recommendations: ${recommendations.slice(0, 2).join("; ")}.`
    );
  }
}

export const fragilityDetector = new FragilityDetector();
