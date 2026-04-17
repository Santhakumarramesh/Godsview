import { EventEmitter } from 'events';

/**
 * Configuration for risk metrics calculation
 */
export interface MetricsConfig {
  /** Annual risk-free rate (default: 0.05 for 5%) */
  riskFreeRate?: number;
  /** Trading periods per year (default: 252 for trading days) */
  periodsPerYear?: number;
  /** Confidence level for VaR calculations (default: 0.95 for 95%) */
  confidenceLevel?: number;
}

/**
 * Comprehensive risk-adjusted performance metrics
 */
export interface RiskAdjustedMetrics {
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  informationRatio: number;
  treynorRatio: number;
  omegaRatio: number;
  maxDrawdown: number;
  avgDrawdown: number;
  ulcerIndex: number;
  valueAtRisk: number;
  conditionalVaR: number;
  tailRatio: number;
  gainToPainRatio: number;
  commonSenseRatio: number;
  kellyFraction: number;
}

/**
 * Distribution characteristics of returns
 */
export interface ReturnDistribution {
  mean: number;
  median: number;
  stdDev: number;
  skewness: number;
  kurtosis: number;
  min: number;
  max: number;
  percentiles: Record<string, number>;
}

/**
 * Monte Carlo simulation results
 */
export interface MonteCarloResult {
  simulations: number;
  medianEndEquity: number;
  p5EndEquity: number;
  p95EndEquity: number;
  probabilityOfRuin: number;
  medianMaxDrawdown: number;
  confidenceBand: {
    lower: number[];
    median: number[];
    upper: number[];
  };
}

/**
 * Equity curve point with drawdown
 */
interface EquityCurvePoint {
  period: number;
  equity: number;
  drawdown: number;
}

/**
 * RiskMetricsCalculator: Comprehensive risk-adjusted performance metrics engine
 * Extends EventEmitter to emit events on metrics calculation and risk breaches
 */
export class RiskMetricsCalculator extends EventEmitter {
  private returns: number[] = [];
  private config: Required<MetricsConfig>;

  /**
   * Initialize calculator with configuration
   */
  constructor(config: MetricsConfig = {}) {
    super();
    this.config = {
      riskFreeRate: config.riskFreeRate ?? 0.05,
      periodsPerYear: config.periodsPerYear ?? 252,
      confidenceLevel: config.confidenceLevel ?? 0.95,
    };
  }

  /**
   * Add a single return value
   */
  addReturn(r: number): void {
    this.returns.push(r);
  }

  /**
   * Add multiple returns in bulk
   */
  addReturns(returns: number[]): void {
    this.returns.push(...returns);
  }

  /**
   * Calculate all risk-adjusted metrics
   */
  calculate(): RiskAdjustedMetrics {
    if (this.returns.length < 2) {
      throw new Error('At least 2 returns required for metrics calculation');
    }

    const meanReturn = this._mean(this.returns);
    const stdDev = this._stdDev(this.returns);
    const downsideDev = this._downsideDeviation(this.returns);
    const { maxDD, avgDD } = this._maxDrawdown(this.returns);
    const sortedReturns = [...this.returns].sort((a, b) => a - b);
    const varValue = this._historicalVaR(sortedReturns);
    const cvarValue = this._conditionalVaR(sortedReturns);
    const annualizedReturn = meanReturn * this.config.periodsPerYear;
    const annualizedVol = stdDev * Math.sqrt(this.config.periodsPerYear);
    const riskFreeAnnual = this.config.riskFreeRate;

    // Sharpe Ratio: (return - risk-free) / volatility
    const sharpe =
      annualizedVol > 0 ? (annualizedReturn - riskFreeAnnual) / annualizedVol : 0;

    // Sortino Ratio: (return - risk-free) / downside volatility
    const annualizedDownsideDev = downsideDev * Math.sqrt(this.config.periodsPerYear);
    const sortino =
      annualizedDownsideDev > 0
        ? (annualizedReturn - riskFreeAnnual) / annualizedDownsideDev
        : 0;

    // Calmar Ratio: annual return / max drawdown
    const calmar = Math.abs(maxDD) > 0 ? annualizedReturn / Math.abs(maxDD) : 0;

    // Information Ratio: (return - benchmark) / tracking error
    // Approximated as sharpe-like with excess return / vol
    const informationRatio = sharpe * 0.8; // simplified approximation

    // Treynor Ratio: (return - risk-free) / beta
    // Simplified: use vol as proxy for beta
    const treynor =
      annualizedVol > 0 ? (annualizedReturn - riskFreeAnnual) / annualizedVol : 0;

    // Omega Ratio: probability-weighted ratio of gains to losses
    const omegaRatio = this._calculateOmegaRatio(this.returns);

    // Ulcer Index: measure of downside volatility
    const ulcerIdx = this._ulcerIndex(this.returns);

    // Tail Ratio: up/down tail relationship
    const tailRatio = this._tailRatio(this.returns);

    // Gain to Pain Ratio: cumulative gains / |cumulative losses|
    const { gainToPain, commonSense } = this._gainAndPainRatios(this.returns);

    // Kelly Fraction: f* = (p*b - q) / b (simplified with win rate)
    const kellyFrac = this._kellyFraction(this.returns);

    const metrics: RiskAdjustedMetrics = {
      sharpeRatio: sharpe,
      sortinoRatio: sortino,
      calmarRatio: calmar,
      informationRatio,
      treynorRatio: treynor,
      omegaRatio: omegaRatio,
      maxDrawdown: maxDD,
      avgDrawdown: avgDD,
      ulcerIndex: ulcerIdx,
      valueAtRisk: varValue,
      conditionalVaR: cvarValue,
      tailRatio,
      gainToPainRatio: gainToPain,
      commonSenseRatio: commonSense,
      kellyFraction: kellyFrac,
    };

    this.emit('metrics:calculated', metrics);

    // Check for VaR breach (return below VaR threshold)
    if (this.returns.length > 0) {
      const lastReturn = this.returns[this.returns.length - 1];
      if (lastReturn < varValue) {
        this.emit('var:breached', { lastReturn, varValue, exceedance: varValue - lastReturn });
      }
    }

    return metrics;
  }

  /**
   * Get return distribution characteristics
   */
  getDistribution(): ReturnDistribution {
    if (this.returns.length === 0) {
      throw new Error('No returns available for distribution calculation');
    }

    const mean = this._mean(this.returns);
    const sorted = [...this.returns].sort((a, b) => a - b);
    const median = this._percentile(sorted, 0.5);
    const stdDev = this._stdDev(this.returns);
    const skewness = this._skewness(this.returns);
    const kurtosis = this._kurtosis(this.returns);

    return {
      mean,
      median,
      stdDev,
      skewness,
      kurtosis,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      percentiles: {
        p1: this._percentile(sorted, 0.01),
        p5: this._percentile(sorted, 0.05),
        p10: this._percentile(sorted, 0.1),
        p25: this._percentile(sorted, 0.25),
        p50: this._percentile(sorted, 0.5),
        p75: this._percentile(sorted, 0.75),
        p90: this._percentile(sorted, 0.9),
        p95: this._percentile(sorted, 0.95),
        p99: this._percentile(sorted, 0.99),
      },
    };
  }

  /**
   * Run Monte Carlo simulation with bootstrap resampling
   */
  runMonteCarlo(
    simulations: number = 1000,
    periods: number = 252,
    startEquity: number = 100000
  ): MonteCarloResult {
    if (this.returns.length === 0) {
      throw new Error('No returns available for Monte Carlo simulation');
    }

    const paths: number[][] = [];
    let ruinCount = 0;
    const maxDrawdowns: number[] = [];

    for (let sim = 0; sim < simulations; sim++) {
      const path = [startEquity];
      let equity = startEquity;
      let peakEquity = equity;
      let maxDD = 0;

      for (let period = 0; period < periods; period++) {
        // Bootstrap: randomly sample from historical returns
        const randomIndex = Math.floor(Math.random() * this.returns.length);
        const sampledReturn = this.returns[randomIndex];

        equity *= 1 + sampledReturn;
        path.push(equity);

        peakEquity = Math.max(peakEquity, equity);
        const drawdown = (peakEquity - equity) / peakEquity;
        maxDD = Math.max(maxDD, drawdown);
      }

      paths.push(path);
      maxDrawdowns.push(maxDD);

      if (equity <= 0) {
        ruinCount++;
      }
    }

    // Extract final equities from all paths
    const finalEquities = paths.map((path) => path[path.length - 1]);
    finalEquities.sort((a, b) => a - b);

    const medianIdx = Math.floor(simulations / 2);
    const p5Idx = Math.floor(simulations * 0.05);
    const p95Idx = Math.floor(simulations * 0.95);

    // Build confidence bands
    const confidenceBand = {
      lower: [] as number[],
      median: [] as number[],
      upper: [] as number[],
    };

    for (let period = 0; period <= periods; period++) {
      const periodValues = paths.map((path) => path[period] || path[path.length - 1]);
      periodValues.sort((a, b) => a - b);

      confidenceBand.lower.push(periodValues[p5Idx]);
      confidenceBand.median.push(periodValues[medianIdx]);
      confidenceBand.upper.push(periodValues[p95Idx]);
    }

    return {
      simulations,
      medianEndEquity: finalEquities[medianIdx],
      p5EndEquity: finalEquities[p5Idx],
      p95EndEquity: finalEquities[p95Idx],
      probabilityOfRuin: ruinCount / simulations,
      medianMaxDrawdown: maxDrawdowns.sort((a, b) => a - b)[medianIdx],
      confidenceBand,
    };
  }

  /**
   * Get equity curve with drawdown information
   */
  getEquityCurve(startEquity: number = 100000): EquityCurvePoint[] {
    let equity = startEquity;
    let peakEquity = equity;
    const curve: EquityCurvePoint[] = [{ period: 0, equity, drawdown: 0 }];

    for (let i = 0; i < this.returns.length; i++) {
      equity *= 1 + this.returns[i];
      peakEquity = Math.max(peakEquity, equity);
      const drawdown = (peakEquity - equity) / peakEquity;

      curve.push({
        period: i + 1,
        equity,
        drawdown,
      });
    }

    return curve;
  }

  /**
   * Calculate Kelly Fraction from returns distribution
   * Simplified version using win rate and avg win/loss
   */
  getKellyFraction(winRate: number, avgWin: number, avgLoss: number): number {
    return this._kellyFromStats(winRate, avgWin, avgLoss);
  }

  /**
   * Get rolling metrics with specified window size
   */
  getRollingMetrics(
    window: number
  ): { period: number; sharpe: number; sortino: number; volatility: number }[] {
    if (window > this.returns.length) {
      throw new Error('Window size larger than return series');
    }

    const results: { period: number; sharpe: number; sortino: number; volatility: number }[] = [];

    for (let i = window; i <= this.returns.length; i++) {
      const windowReturns = this.returns.slice(i - window, i);
      const mean = this._mean(windowReturns);
      const stdDev = this._stdDev(windowReturns);
      const downsideDev = this._downsideDeviation(windowReturns);

      const annualizedReturn = mean * this.config.periodsPerYear;
      const annualizedVol = stdDev * Math.sqrt(this.config.periodsPerYear);
      const annualizedDownsideDev = downsideDev * Math.sqrt(this.config.periodsPerYear);
      const riskFreeAnnual = this.config.riskFreeRate;

      const sharpe =
        annualizedVol > 0 ? (annualizedReturn - riskFreeAnnual) / annualizedVol : 0;
      const sortino =
        annualizedDownsideDev > 0
          ? (annualizedReturn - riskFreeAnnual) / annualizedDownsideDev
          : 0;

      results.push({
        period: i,
        sharpe,
        sortino,
        volatility: annualizedVol,
      });
    }

    return results;
  }

  /**
   * Reset all stored returns and state
   */
  reset(): void {
    this.returns = [];
  }

  // ============ PRIVATE STATISTICAL HELPERS ============

  private _mean(values: number[]): number {
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  private _stdDev(values: number[]): number {
    const mean = this._mean(values);
    const squaredDiffs = values.map((val) => Math.pow(val - mean, 2));
    const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
    return Math.sqrt(variance);
  }

  private _downsideDeviation(values: number[]): number {
    const mean = this._mean(values);
    const downsideValues = values.map((val) => Math.min(val - mean, 0));
    const sumSquared = downsideValues.reduce((sum, val) => sum + val * val, 0);
    return Math.sqrt(sumSquared / values.length);
  }

  private _skewness(values: number[]): number {
    const mean = this._mean(values);
    const stdDev = this._stdDev(values);
    const n = values.length;

    if (stdDev === 0) return 0;

    const cubed = values.reduce((sum, val) => sum + Math.pow((val - mean) / stdDev, 3), 0);
    return (cubed / n) * (n / ((n - 1) * (n - 2)));
  }

  private _kurtosis(values: number[]): number {
    const mean = this._mean(values);
    const stdDev = this._stdDev(values);
    const n = values.length;

    if (stdDev === 0) return 0;

    const fourth = values.reduce((sum, val) => sum + Math.pow((val - mean) / stdDev, 4), 0);
    const excess = (fourth / n) * (n / ((n - 1) * (n - 2) * (n - 3))) - 3;
    return excess;
  }

  private _percentile(sortedValues: number[], percentile: number): number {
    const index = percentile * (sortedValues.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index % 1;

    if (lower === upper) {
      return sortedValues[lower];
    }

    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
  }

  private _historicalVaR(sortedReturns: number[]): number {
    const index = Math.ceil((1 - this.config.confidenceLevel) * sortedReturns.length) - 1;
    return sortedReturns[Math.max(0, index)];
  }

  private _conditionalVaR(sortedReturns: number[]): number {
    const varIndex = Math.ceil((1 - this.config.confidenceLevel) * sortedReturns.length) - 1;
    const tailReturns = sortedReturns.slice(0, Math.max(1, varIndex + 1));
    return this._mean(tailReturns);
  }

  private _maxDrawdown(returns: number[]): { maxDD: number; avgDD: number } {
    let peak = 0;
    let maxDD = 0;
    let cumulativeEquity = 1;
    const drawdowns: number[] = [];

    for (const r of returns) {
      cumulativeEquity *= 1 + r;
      peak = Math.max(peak, cumulativeEquity);
      const dd = (peak - cumulativeEquity) / peak;
      maxDD = Math.max(maxDD, dd);
      if (dd > 0) {
        drawdowns.push(dd);
      }
    }

    const avgDD = drawdowns.length > 0 ? this._mean(drawdowns) : 0;
    return { maxDD: -maxDD, avgDD: -avgDD };
  }

  private _calculateOmegaRatio(returns: number[]): number {
    const mean = this._mean(returns);
    let gainSum = 0;
    let lossSum = 0;

    for (const r of returns) {
      if (r > mean) {
        gainSum += r - mean;
      } else if (r < mean) {
        lossSum += Math.abs(r - mean);
      }
    }

    return lossSum > 0 ? gainSum / lossSum : 0;
  }

  private _ulcerIndex(returns: number[]): number {
    let peak = 0;
    let cumulativeEquity = 1;
    const rSquared: number[] = [];

    for (const r of returns) {
      cumulativeEquity *= 1 + r;
      peak = Math.max(peak, cumulativeEquity);
      const r_value = ((peak - cumulativeEquity) / peak) * 100;
      rSquared.push(r_value * r_value);
    }

    const mean = rSquared.reduce((sum, val) => sum + val, 0) / rSquared.length;
    return Math.sqrt(mean);
  }

  private _tailRatio(returns: number[]): number {
    const sorted = [...returns].sort((a, b) => a - b);
    const n = sorted.length;
    const tail5pIdx = Math.floor(n * 0.05);

    const upTail = sorted.slice(Math.ceil(n * 0.95)).reduce((sum, val) => sum + Math.abs(val), 0);
    const downTail = sorted.slice(0, tail5pIdx).reduce((sum, val) => sum + Math.abs(val), 0);

    return downTail > 0 ? upTail / downTail : 0;
  }

  private _gainAndPainRatios(returns: number[]): { gainToPain: number; commonSense: number } {
    let cumulativeGain = 0;
    let cumulativeLoss = 0;

    for (const r of returns) {
      if (r > 0) {
        cumulativeGain += r;
      } else {
        cumulativeLoss += Math.abs(r);
      }
    }

    const gainToPain = cumulativeLoss > 0 ? cumulativeGain / cumulativeLoss : 0;
    const commonSense =
      cumulativeLoss > 0 ? (cumulativeGain - cumulativeLoss) / cumulativeLoss : 0;

    return { gainToPain, commonSense };
  }

  private _kellyFraction(returns: number[]): number {
    const winCount = returns.filter((r) => r > 0).length;
    const lossCount = returns.filter((r) => r < 0).length;
    const totalTrades = returns.length;

    if (totalTrades === 0 || winCount === 0 || lossCount === 0) {
      return 0;
    }

    const p = winCount / totalTrades;
    const q = lossCount / totalTrades;

    const avgWin = returns.filter((r) => r > 0).reduce((sum, r) => sum + r, 0) / winCount;
    const avgLoss =
      Math.abs(returns.filter((r) => r < 0).reduce((sum, r) => sum + r, 0)) / lossCount;

    if (avgLoss === 0) return 0;

    const b = avgWin / avgLoss;
    const f = (p * b - q) / b;

    return Math.max(0, Math.min(f, 0.25)); // Cap at 25%
  }

  private _kellyFromStats(winRate: number, avgWin: number, avgLoss: number): number {
    if (avgLoss === 0 || winRate <= 0 || winRate >= 1) {
      return 0;
    }

    const p = winRate;
    const q = 1 - winRate;
    const b = avgWin / avgLoss;
    const f = (p * b - q) / b;

    return Math.max(0, Math.min(f, 0.25));
  }
}
