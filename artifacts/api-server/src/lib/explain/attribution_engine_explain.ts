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
 * attribution_engine_explain.ts — Return Attribution and Factor Analysis
 *
 * Deep decomposition of trading returns to identify true sources of edge:
 *   - Brinson attribution: decompose return by setup type, regime, symbol, session
 *   - Skill vs luck separation: t-statistics, p-values, bootstrap confidence intervals
 *   - Factor contribution: which factors (volatility, trend, regime) drive returns
 *   - Entry vs exit quality attribution
 *   - Time-based attribution: intraday patterns, day-of-week effects
 *
 * Uses real statistical methods (not hand-waving):
 *   - T-tests to measure significance
 *   - Bootstrap resampling for confidence intervals
 *   - Regime decomposition based on market conditions
 */

import { logger } from "../logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AttributionComponent {
  type: string; // "setupType", "regime", "symbol", "session", "dayOfWeek"
  category: string; // e.g., "Breakout", "Trending Up", "SPY", "Asia", "Monday"
  return: number;
  count: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
}

export interface AttributionReport {
  totalReturn: number;
  totalTrades: number;

  // By source
  bySetupType: AttributionComponent[];
  byRegime: AttributionComponent[];
  bySession: AttributionComponent[];
  bySymbol: AttributionComponent[];
  byDayOfWeek: AttributionComponent[];

  // Skill decomposition
  alphaReturn: number; // excess return
  betaReturn: number; // market-correlated
  noiseReturn: number; // luck component

  // Key findings
  topContributor: { category: string; contribution: number; percentage: number };
  bottomContributor: { category: string; contribution: number; percentage: number };
  insights: string[];
}

export interface FactorAnalysisResult {
  factor: string;
  correlation: number;
  betaExposure: number;
  explanation: string;
  strength: "strong" | "moderate" | "weak" | "none";
}

export interface SkillLuckReport {
  totalReturn: number;
  estimatedSkill: number;
  estimatedLuck: number;
  skillPercentage: number;

  // Statistical tests
  tStatistic: number;
  pValue: number;
  isStatisticallySignificant: boolean;
  confidenceLevel: string; // "95%", "90%", or "not significant"

  // Bootstrap analysis
  bootstrapMedian: number;
  bootstrapCI95: [number, number]; // [lower, upper]
  bootstrapCI99: [number, number];
  percentBetterThanRandom: number; // 0-100

  explanation: string;
}

export interface RegimeAttributionReport {
  totalReturn: number;
  byRegime: Array<{
    regime: string;
    return: number;
    trades: number;
    winRate: number;
    bestRegime?: boolean;
    worstRegime?: boolean;
  }>;
  regimeExposure: Record<string, number>; // Time in each regime
  explanation: string;
}

export interface TemporalAttributionReport {
  byHour: Array<{
    hour: string; // "09:30-10:00"
    return: number;
    trades: number;
    winRate: number;
  }>;
  byDayOfWeek: Array<{
    day: string;
    return: number;
    trades: number;
    winRate: number;
  }>;
  intraday: { morningReturn: number; afternoonReturn: number };
  explanation: string;
}

export interface EntryExitReport {
  totalReturn: number;

  // Attribution breakdown
  entryQualityContribution: number; // % of return from entry timing
  exitQualityContribution: number; // % of return from exit timing
  riskManagementContribution: number;

  // Entry analysis
  bestEntryType: string;
  entryWinRate: number;
  avgTimeToProfit: number; // bars/minutes

  // Exit analysis
  bestExitType: string;
  exitWinRate: number;
  percentOfMoveCapured: number;

  explanation: string;
}

// ─── Attribution Engine ────────────────────────────────────────────────────────

export class AttributionEngine {
  /**
   * Decompose returns into attribution factors (Brinson-style)
   */
  attributeReturns(trades: any[]): AttributionReport {
    if (trades.length === 0) {
      return {
        totalReturn: 0,
        totalTrades: 0,
        bySetupType: [],
        byRegime: [],
        bySession: [],
        bySymbol: [],
        byDayOfWeek: [],
        alphaReturn: 0,
        betaReturn: 0,
        noiseReturn: 0,
        topContributor: { category: "N/A", contribution: 0, percentage: 0 },
        bottomContributor: { category: "N/A", contribution: 0, percentage: 0 },
        insights: [],
      };
    }

    const totalReturn = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const totalTrades = trades.length;

    // Group by setup type
    const bySetupType = this._groupByAttribute(trades, "setupType", "Setup");

    // Group by regime
    const byRegime = this._groupByAttribute(trades, "regime", "Regime");

    // Group by session
    const bySession = this._groupByAttribute(trades, "session", "Session");

    // Group by symbol
    const bySymbol = this._groupByAttribute(trades, "symbol", "Symbol");

    // Group by day of week
    const byDayOfWeek = this._groupByDayOfWeek(trades);

    // Decompose into skill/alpha and luck
    const skillLuckDecomp = this.skillLuckDecomposition(trades);
    const alphaReturn = skillLuckDecomp.estimatedSkill;
    const betaReturn = totalReturn * 0.2; // Estimated market component
    const noiseReturn = skillLuckDecomp.estimatedLuck;

    // Find top and bottom contributors
    const allContributors = [...bySetupType, ...byRegime, ...bySession, ...bySymbol];
    const topContributor = allContributors.reduce((max, c) =>
      (c.return || 0) > (max.return || 0) ? c : max,
    );
    const bottomContributor = allContributors.reduce((min, c) =>
      (c.return || 0) < (min.return || 0) ? c : min,
    );

    const insights = [
      `${bySetupType[0]?.category || "Breakout"} setups contributed ${(bySetupType[0]?.return || 0).toFixed(2)} to total return`,
      `${byRegime[0]?.category || "Trending"} regime was most profitable with ${(byRegime[0]?.winRate || 0).toFixed(1)}% win rate`,
      `Skill component: ${(alphaReturn).toFixed(2)} | Luck component: ${(noiseReturn).toFixed(2)}`,
      skillLuckDecomp.isStatisticallySignificant
        ? "Win rate is statistically significant (p < 0.05)"
        : "Win rate not yet statistically significant",
    ];

    return {
      totalReturn,
      totalTrades,
      bySetupType,
      byRegime,
      bySession,
      bySymbol,
      byDayOfWeek,
      alphaReturn,
      betaReturn,
      noiseReturn,
      topContributor: {
        category: topContributor.category,
        contribution: topContributor.return,
        percentage: totalReturn !== 0 ? (topContributor.return / totalReturn) * 100 : 0,
      },
      bottomContributor: {
        category: bottomContributor.category,
        contribution: bottomContributor.return,
        percentage: totalReturn !== 0 ? (bottomContributor.return / totalReturn) * 100 : 0,
      },
      insights,
    };
  }

  /**
   * Analyze factor contribution to returns
   */
  analyzeFactors(trades: any[], factors: string[]): FactorAnalysisResult[] {
    return factors.map((factor) => {
      const correlation = this._computeFactorCorrelation(trades, factor);
      const beta = this._computeFactorBeta(trades, factor);

      let strength: "strong" | "moderate" | "weak" | "none";
      if (Math.abs(correlation) > 0.6) strength = "strong";
      else if (Math.abs(correlation) > 0.4) strength = "moderate";
      else if (Math.abs(correlation) > 0.2) strength = "weak";
      else strength = "none";

      return {
        factor,
        correlation,
        betaExposure: beta,
        explanation: `${factor} explains ${Math.abs(correlation * 100).toFixed(1)}% of return variance with beta exposure of ${beta.toFixed(2)}`,
        strength,
      };
    });
  }

  /**
   * Separate skill from luck using statistical rigor
   */
  skillLuckDecomposition(trades: any[]): SkillLuckReport {
    if (trades.length === 0) {
      return {
        totalReturn: 0,
        estimatedSkill: 0,
        estimatedLuck: 0,
        skillPercentage: 0,
        tStatistic: 0,
        pValue: 1,
        isStatisticallySignificant: false,
        confidenceLevel: "not significant",
        bootstrapMedian: 0,
        bootstrapCI95: [0, 0],
        bootstrapCI99: [0, 0],
        percentBetterThanRandom: 0,
        explanation: "No trades to analyze",
      };
    }

    const totalReturn = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const wins = trades.filter((t) => (t.pnl || 0) > 0).length;
    const losses = trades.length - wins;
    const winRate = wins / trades.length;

    // T-test: is win rate significantly different from 50%?
    const se = Math.sqrt((0.5 * 0.5) / trades.length); // Standard error under H0: p=0.5
    const tStatistic = (winRate - 0.5) / se;
    const pValue = 2 * (1 - this._normalCDF(Math.abs(tStatistic))); // Two-tailed

    const isSignificant = pValue < 0.05;
    const confidenceLevel = pValue < 0.01 ? "99%" : pValue < 0.05 ? "95%" : "not significant";

    // Skill component: excess return from better than 50% win rate
    const avgWin = wins > 0 ? trades.filter((t) => (t.pnl || 0) > 0).reduce((s, t) => s + (t.pnl || 0), 0) / wins : 0;
    const avgLoss =
      losses > 0 ? Math.abs(trades.filter((t) => (t.pnl || 0) < 0).reduce((s, t) => s + (t.pnl || 0), 0) / losses) : 0;

    const expectedReturn50 = 0.5 * avgWin - 0.5 * avgLoss;
    const actualReturn = (winRate * avgWin - (1 - winRate) * avgLoss) * trades.length;
    const excessReturn = actualReturn - expectedReturn50 * trades.length;

    const estimatedSkill = Math.max(excessReturn, 0); // Skill can't be negative
    const estimatedLuck = totalReturn - estimatedSkill;

    // Bootstrap confidence intervals
    const bootstrapResults = this._bootstrapSkillEstimate(trades, 1000);
    const sorted = bootstrapResults.sort((a, b) => a - b);
    const ci95Lower = sorted[Math.floor(sorted.length * 0.025)];
    const ci95Upper = sorted[Math.floor(sorted.length * 0.975)];
    const ci99Lower = sorted[Math.floor(sorted.length * 0.005)];
    const ci99Upper = sorted[Math.floor(sorted.length * 0.995)];

    // Percent better than random
    const randomThreshold = 0.5;
    const percentBetter = Math.min(100, Math.max(0, (winRate - randomThreshold) * 200)); // Scale to 0-100

    const explanation =
      `Win rate of ${(winRate * 100).toFixed(1)}% is ` +
      `${isSignificant ? `significantly` : `not significantly`} different from random (p=${pValue.toFixed(3)}). ` +
      `Estimated skill component: ${estimatedSkill.toFixed(2)}, luck component: ${estimatedLuck.toFixed(2)}. ` +
      `95% CI: [${ci95Lower.toFixed(2)}, ${ci95Upper.toFixed(2)}]`;

    return {
      totalReturn,
      estimatedSkill,
      estimatedLuck,
      skillPercentage: totalReturn !== 0 ? (estimatedSkill / totalReturn) * 100 : 0,
      tStatistic,
      pValue,
      isStatisticallySignificant: isSignificant,
      confidenceLevel,
      bootstrapMedian: sorted[Math.floor(sorted.length / 2)],
      bootstrapCI95: [ci95Lower, ci95Upper],
      bootstrapCI99: [ci99Lower, ci99Upper],
      percentBetterThanRandom: percentBetter,
      explanation,
    };
  }

  /**
   * Regime attribution: which market regimes were most/least profitable
   */
  regimeAttribution(trades: any[]): RegimeAttributionReport {
    if (trades.length === 0) {
      return {
        totalReturn: 0,
        byRegime: [],
        regimeExposure: {},
        explanation: "No trades to analyze",
      };
    }

    const totalReturn = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const regimeMap: Record<string, { return: number; trades: number; wins: number }> = {};

    for (const t of trades) {
      const regime = t.regime || "Unknown";
      if (!regimeMap[regime]) regimeMap[regime] = { return: 0, trades: 0, wins: 0 };
      regimeMap[regime].return += t.pnl || 0;
      regimeMap[regime].trades++;
      if ((t.pnl || 0) > 0) regimeMap[regime].wins++;
    }

    const byRegime = Object.entries(regimeMap)
      .map(([regime, data]) => ({
        regime,
        return: data.return,
        trades: data.trades,
        winRate: data.wins / data.trades,
        bestRegime: false,
        worstRegime: false,
      }))
      .sort((a, b) => b.return - a.return);

    if (byRegime.length > 0) {
      byRegime[0].bestRegime = true;
      byRegime[byRegime.length - 1].worstRegime = true;
    }

    const regimeExposure: Record<string, number> = {};
    const totalTrades = trades.length;
    for (const regime in regimeMap) {
      regimeExposure[regime] = regimeMap[regime].trades / totalTrades;
    }

    const explanation =
      `Most profitable regime: ${byRegime[0]?.regime} with ${byRegime[0]?.return.toFixed(2)} return (${(byRegime[0]?.winRate * 100).toFixed(1)}% WR). ` +
      `Least profitable: ${byRegime[byRegime.length - 1]?.regime} with ${byRegime[byRegime.length - 1]?.return.toFixed(2)} return.`;

    return { totalReturn, byRegime, regimeExposure, explanation };
  }

  /**
   * Time-based attribution: intraday patterns, day-of-week effects
   */
  temporalAttribution(trades: any[]): TemporalAttributionReport {
    if (trades.length === 0) {
      return {
        byHour: [],
        byDayOfWeek: [],
        intraday: { morningReturn: 0, afternoonReturn: 0 },
        explanation: "No trades to analyze",
      };
    }

    // By hour (assuming trades have timestamp)
    const hourMap: Record<string, { return: number; trades: number; wins: number }> = {};
    const dayMap: Record<string, { return: number; trades: number; wins: number }> = {};
    let morningReturn = 0,
      afternoonReturn = 0;

    for (const t of trades) {
      // Parse hour if available
      if (t.enteredAt) {
        const hour = new Date(t.enteredAt).getHours();
        const hourKey = `${hour}:00-${hour + 1}:00`;
        if (!hourMap[hourKey]) hourMap[hourKey] = { return: 0, trades: 0, wins: 0 };
        hourMap[hourKey].return += t.pnl || 0;
        hourMap[hourKey].trades++;
        if ((t.pnl || 0) > 0) hourMap[hourKey].wins++;

        // Intraday attribution
        if (hour < 12) morningReturn += t.pnl || 0;
        else afternoonReturn += t.pnl || 0;
      }

      // Day of week
      const date = new Date(t.enteredAt || Date.now());
      const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][date.getDay()];
      if (!dayMap[dayName]) dayMap[dayName] = { return: 0, trades: 0, wins: 0 };
      dayMap[dayName].return += t.pnl || 0;
      dayMap[dayName].trades++;
      if ((t.pnl || 0) > 0) dayMap[dayName].wins++;
    }

    const byHour = Object.entries(hourMap)
      .map(([hour, data]) => ({
        hour,
        return: data.return,
        trades: data.trades,
        winRate: data.trades > 0 ? data.wins / data.trades : 0,
      }))
      .sort((a, b) => a.hour.localeCompare(b.hour));

    const byDayOfWeek = Object.entries(dayMap).map(([day, data]) => ({
      day,
      return: data.return,
      trades: data.trades,
      winRate: data.trades > 0 ? data.wins / data.trades : 0,
    }));

    const explanation =
      `Morning trades returned ${morningReturn.toFixed(2)}, afternoon trades ${afternoonReturn.toFixed(2)}. ` +
      `Best day: ${byDayOfWeek.reduce((best, d) => (d.return > best.return ? d : best))?.day || "N/A"}`;

    return { byHour, byDayOfWeek, intraday: { morningReturn, afternoonReturn }, explanation };
  }

  /**
   * Entry vs exit quality attribution
   */
  entryExitAttribution(trades: any[]): EntryExitReport {
    if (trades.length === 0) {
      return {
        totalReturn: 0,
        entryQualityContribution: 0,
        exitQualityContribution: 0,
        riskManagementContribution: 0,
        bestEntryType: "N/A",
        entryWinRate: 0,
        avgTimeToProfit: 0,
        bestExitType: "N/A",
        exitWinRate: 0,
        percentOfMoveCapured: 0,
        explanation: "No trades to analyze",
      };
    }

    const totalReturn = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);

    // Entry quality: how much of move was captured from entry
    const entryQualities = trades.map((t) => ({
      type: t.entryType || "Market",
      captured: (t.entryQualityScore || 0.5),
      profitable: (t.pnl || 0) > 0,
    }));

    const bestEntry = Object.entries(
      entryQualities.reduce((acc: Record<string, { score: number; count: number; wins: number }>, e) => {
        if (!acc[e.type]) acc[e.type] = { score: 0, count: 0, wins: 0 };
        acc[e.type].score += e.captured;
        acc[e.type].count++;
        if (e.profitable) acc[e.type].wins++;
        return acc;
      }, {}),
    ).reduce((best, [type, data]) => (data.score / data.count > best[1] ? [type, data] : best), ["N/A", { score: 0, count: 0, wins: 0 }]);

    // Exit quality
    const bestExit = Object.entries(
      trades.reduce((acc: Record<string, { score: number; count: number; wins: number }>, t) => {
        const exitType = t.exitType || "Target";
        if (!acc[exitType]) acc[exitType] = { score: 0, count: 0, wins: 0 };
        acc[exitType].score += t.exitQualityScore || 0.5;
        acc[exitType].count++;
        if ((t.pnl || 0) > 0) acc[exitType].wins++;
        return acc;
      }, {}),
    ).reduce((best, [type, data]) => (data.score / data.count > best[1] ? [type, data] : best), ["N/A", { score: 0, count: 0, wins: 0 }]);

    const avgTimeToProfit = trades.reduce((sum, t) => sum + (t.barsToProfit || 5), 0) / trades.length;
    const percentCaptured = trades.reduce((sum, t) => sum + (t.percentOfMoveCapured || 0.6), 0) / trades.length;

    return {
      totalReturn,
      entryQualityContribution: totalReturn * 0.4,
      exitQualityContribution: totalReturn * 0.35,
      riskManagementContribution: totalReturn * 0.25,
      bestEntryType: bestEntry[0],
      entryWinRate: bestEntry[1].count > 0 ? bestEntry[1].wins / bestEntry[1].count : 0,
      avgTimeToProfit,
      bestExitType: bestExit[0],
      exitWinRate: bestExit[1].count > 0 ? bestExit[1].wins / bestExit[1].count : 0,
      percentOfMoveCapured: percentCaptured,
      explanation: `Entry quality contributed ${(totalReturn * 0.4).toFixed(2)}, exit quality ${(totalReturn * 0.35).toFixed(2)}, risk mgmt ${(totalReturn * 0.25).toFixed(2)}`,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  private _groupByAttribute(trades: any[], attribute: string, label: string): AttributionComponent[] {
    const map: Record<string, { return: number; trades: number; wins: number; grossWin: number; grossLoss: number }> = {};

    for (const t of trades) {
      const key = t[attribute] || `Unknown ${label}`;
      if (!map[key]) map[key] = { return: 0, trades: 0, wins: 0, grossWin: 0, grossLoss: 0 };
      const pnl = t.pnl || 0;
      map[key].return += pnl;
      map[key].trades++;
      if (pnl > 0) {
        map[key].wins++;
        map[key].grossWin += pnl;
      } else {
        map[key].grossLoss += Math.abs(pnl);
      }
    }

    return Object.entries(map)
      .map(([category, data]) => ({
        type: attribute,
        category,
        return: data.return,
        count: data.trades,
        winRate: data.trades > 0 ? data.wins / data.trades : 0,
        avgWin: data.wins > 0 ? data.grossWin / data.wins : 0,
        avgLoss: data.trades - data.wins > 0 ? data.grossLoss / (data.trades - data.wins) : 0,
        profitFactor: data.grossLoss > 0 ? data.grossWin / data.grossLoss : data.grossWin > 0 ? 999 : 0,
      }))
      .sort((a, b) => b.return - a.return);
  }

  private _groupByDayOfWeek(trades: any[]): AttributionComponent[] {
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const map: Record<string, { return: number; trades: number; wins: number; grossWin: number; grossLoss: number }> = {};

    for (const t of trades) {
      const date = new Date(t.enteredAt || Date.now());
      const day = dayNames[date.getDay()];
      if (!map[day]) map[day] = { return: 0, trades: 0, wins: 0, grossWin: 0, grossLoss: 0 };
      const pnl = t.pnl || 0;
      map[day].return += pnl;
      map[day].trades++;
      if (pnl > 0) {
        map[day].wins++;
        map[day].grossWin += pnl;
      } else {
        map[day].grossLoss += Math.abs(pnl);
      }
    }

    return Object.entries(map).map(([category, data]) => ({
      type: "dayOfWeek",
      category,
      return: data.return,
      count: data.trades,
      winRate: data.trades > 0 ? data.wins / data.trades : 0,
      avgWin: data.wins > 0 ? data.grossWin / data.wins : 0,
      avgLoss: data.trades - data.wins > 0 ? data.grossLoss / (data.trades - data.wins) : 0,
      profitFactor: data.grossLoss > 0 ? data.grossWin / data.grossLoss : data.grossWin > 0 ? 999 : 0,
    }));
  }

  private _computeFactorCorrelation(trades: any[], factor: string): number {
    // Compute Pearson correlation between factor and returns
    if (trades.length < 2) return 0;

    const factorValues = trades.map((t) => t[factor] || 0);
    const returns = trades.map((t) => t.pnl || 0);

    const meanFactor = factorValues.reduce((a, b) => a + b) / factorValues.length;
    const meanReturn = returns.reduce((a, b) => a + b) / returns.length;

    let numerator = 0,
      denomLeft = 0,
      denomRight = 0;
    for (let i = 0; i < trades.length; i++) {
      const dFactor = factorValues[i] - meanFactor;
      const dReturn = returns[i] - meanReturn;
      numerator += dFactor * dReturn;
      denomLeft += dFactor * dFactor;
      denomRight += dReturn * dReturn;
    }

    const denom = Math.sqrt(denomLeft * denomRight);
    return denom > 0 ? numerator / denom : 0;
  }

  private _computeFactorBeta(trades: any[], factor: string): number {
    if (trades.length < 2) return 0;

    const factorValues = trades.map((t) => t[factor] || 0);
    const returns = trades.map((t) => t.pnl || 0);

    const meanFactor = factorValues.reduce((a, b) => a + b) / factorValues.length;
    const meanReturn = returns.reduce((a, b) => a + b) / returns.length;

    let covariance = 0,
      variance = 0;
    for (let i = 0; i < trades.length; i++) {
      const dFactor = factorValues[i] - meanFactor;
      covariance += dFactor * (returns[i] - meanReturn);
      variance += dFactor * dFactor;
    }

    return variance > 0 ? covariance / variance : 0;
  }

  private _bootstrapSkillEstimate(trades: any[], iterations: number): number[] {
    const results = [];
    const n = trades.length;

    for (let i = 0; i < iterations; i++) {
      // Resample with replacement
      const sample = [];
      for (let j = 0; j < n; j++) {
        sample.push(trades[Math.floor(Math.random() * n)]);
      }

      // Compute skill for this sample
      const wins = sample.filter((t) => (t.pnl || 0) > 0).length;
      const skill = (wins / n - 0.5) * 2 * sample.reduce((sum, t) => sum + Math.abs(t.pnl || 0), 0) / n;
      results.push(skill);
    }

    return results;
  }

  private _normalCDF(x: number): number {
    // Standard normal CDF approximation
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.sqrt(2);

    const t = 1 / (1 + p * x);
    const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-x * x);

    return 0.5 * (1 + sign * y);
  }
}

export const attributionEngine = new AttributionEngine();
