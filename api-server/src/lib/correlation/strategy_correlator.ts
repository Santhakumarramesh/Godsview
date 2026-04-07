import { EventEmitter } from 'events';

/**
 * Represents a correlation matrix for strategy pairs
 */
export interface CorrelationMatrix {
  strategies: string[];
  matrix: number[][];
  computed_at: string;
}

/**
 * Represents a correlated pair of strategies with risk assessment
 */
export interface CorrelationPair {
  strategy_a: string;
  strategy_b: string;
  correlation: number;
  risk_level: 'safe' | 'moderate' | 'dangerous';
  recommendation: string;
}

/**
 * Portfolio concentration and diversification metrics
 */
export interface ConcentrationMetrics {
  hhi: number;
  topWeight: number;
  effectiveStrategies: number;
  diversificationScore: number;
}

/**
 * Configuration for StrategyCorrelator
 */
export interface CorrelatorConfig {
  windowSize?: number;
  dangerThreshold?: number;
  updateIntervalMs?: number;
}

/**
 * Internal structure to track strategy returns
 */
interface StrategyReturnData {
  strategyId: string;
  returns: number[];
  lastUpdated: Date;
}

/**
 * StrategyCorrelator - Tracks and analyzes correlation between multiple trading strategies
 *
 * This class maintains rolling windows of returns for each strategy and computes
 * Pearson correlation coefficients to identify dangerous correlations that amplify
 * portfolio risk. It emits events when dangerous correlations are detected.
 *
 * @example
 * const correlator = new StrategyCorrelator({
 *   windowSize: 50,
 *   dangerThreshold: 0.7,
 *   updateIntervalMs: 60000
 * });
 *
 * correlator.addReturns('strategy_a', [0.01, -0.005, 0.015]);
 * correlator.addReturns('strategy_b', [0.012, -0.004, 0.016]);
 *
 * const matrix = correlator.computeCorrelationMatrix();
 * const dangerous = correlator.getDangerousPairs();
 */
export class StrategyCorrelator extends EventEmitter {
  private config: Required<CorrelatorConfig>;
  private strategyReturns: Map<string, StrategyReturnData> = new Map();
  private lastComputeTime: Date = new Date();
  private updateTimer: NodeJS.Timeout | null = null;

  /**
   * Creates a new StrategyCorrelator instance
   *
   * @param config Configuration options
   * @param config.windowSize - Rolling window size for return tracking (default: 50)
   * @param config.dangerThreshold - Correlation threshold above which pairs are dangerous (default: 0.7)
   * @param config.updateIntervalMs - Interval for periodic correlation updates (default: 60000)
   */
  constructor(config: CorrelatorConfig = {}) {
    super();
    this.config = {
      windowSize: config.windowSize ?? 50,
      dangerThreshold: config.dangerThreshold ?? 0.7,
      updateIntervalMs: config.updateIntervalMs ?? 60000,
    };
    this.startPeriodicUpdates();
  }

  /**
   * Adds returns for a specific strategy
   *
   * Returns are stored in a rolling window. When the window is exceeded,
   * oldest returns are discarded.
   *
   * @param strategyId - Unique identifier for the strategy
   * @param returns - Array of returns (typically daily or per-trade)
   */
  public addReturns(strategyId: string, returns: number[]): void {
    if (!Array.isArray(returns) || returns.length === 0) {
      return;
    }

    // Validate returns are numbers
    if (!returns.every((r) => typeof r === 'number' && !isNaN(r))) {
      throw new Error(`Invalid returns for strategy ${strategyId}: all values must be finite numbers`);
    }

    let data = this.strategyReturns.get(strategyId);

    if (!data) {
      data = {
        strategyId,
        returns: [],
        lastUpdated: new Date(),
      };
      this.strategyReturns.set(strategyId, data);
    }

    // Append new returns
    data.returns.push(...returns);

    // Maintain rolling window size
    if (data.returns.length > this.config.windowSize) {
      data.returns = data.returns.slice(-this.config.windowSize);
    }

    data.lastUpdated = new Date();

    // Compute correlation and check for dangers
    this.checkForDangerousPairs();
  }

  /**
   * Computes the Pearson correlation matrix for all tracked strategies
   *
   * The correlation matrix is symmetric and has 1.0 on the diagonal.
   * Correlation values range from -1 (perfect negative) to +1 (perfect positive).
   *
   * @returns CorrelationMatrix with strategies array and NxN correlation matrix
   */
  public computeCorrelationMatrix(): CorrelationMatrix {
    const strategies = Array.from(this.strategyReturns.keys()).sort();
    const n = strategies.length;
    const matrix: number[][] = Array(n)
      .fill(null)
      .map(() => Array(n).fill(0));

    // Populate diagonal with 1.0 (perfect correlation with self)
    for (let i = 0; i < n; i++) {
      matrix[i][i] = 1.0;
    }

    // Compute Pearson correlations for all pairs
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const corr = this.computePearsonCorrelation(
          strategies[i],
          strategies[j]
        );
        matrix[i][j] = corr;
        matrix[j][i] = corr; // Symmetric matrix
      }
    }

    this.lastComputeTime = new Date();
    this.emit('correlation:updated', {
      timestamp: this.lastComputeTime.toISOString(),
      strategies,
      pairCount: (n * (n - 1)) / 2,
    });

    return {
      strategies,
      matrix,
      computed_at: this.lastComputeTime.toISOString(),
    };
  }

  /**
   * Computes Pearson correlation coefficient between two strategies
   *
   * Uses the formula: corr(X,Y) = cov(X,Y) / (std(X) * std(Y))
   * Returns NaN if either series has zero variance.
   *
   * @param strategyIdA - First strategy identifier
   * @param strategyIdB - Second strategy identifier
   * @returns Correlation coefficient between -1 and 1, or NaN if computation fails
   */
  private computePearsonCorrelation(strategyIdA: string, strategyIdB: string): number {
    const dataA = this.strategyReturns.get(strategyIdA)?.returns ?? [];
    const dataB = this.strategyReturns.get(strategyIdB)?.returns ?? [];

    if (dataA.length === 0 || dataB.length === 0) {
      return NaN;
    }

    // Use minimum length to align series
    const n = Math.min(dataA.length, dataB.length);
    if (n < 2) {
      return NaN;
    }

    const seriesA = dataA.slice(-n);
    const seriesB = dataB.slice(-n);

    // Calculate means
    const meanA = seriesA.reduce((sum, val) => sum + val, 0) / n;
    const meanB = seriesB.reduce((sum, val) => sum + val, 0) / n;

    // Calculate deviations and products
    let sumProductDeviations = 0;
    let sumSqDeviationA = 0;
    let sumSqDeviationB = 0;

    for (let i = 0; i < n; i++) {
      const devA = seriesA[i] - meanA;
      const devB = seriesB[i] - meanB;

      sumProductDeviations += devA * devB;
      sumSqDeviationA += devA * devA;
      sumSqDeviationB += devB * devB;
    }

    // Avoid division by zero
    if (sumSqDeviationA === 0 || sumSqDeviationB === 0) {
      return NaN;
    }

    const correlation = sumProductDeviations / Math.sqrt(sumSqDeviationA * sumSqDeviationB);
    return Math.min(1, Math.max(-1, correlation)); // Clamp to [-1, 1]
  }

  /**
   * Identifies strategy pairs with dangerous correlation levels
   *
   * Dangerous pairs are those with absolute correlation above the configured
   * danger threshold, indicating they move together and amplify portfolio risk.
   *
   * @returns Array of CorrelationPair objects above danger threshold, sorted by correlation
   */
  public getDangerousPairs(): CorrelationPair[] {
    const matrix = this.computeCorrelationMatrix();
    const dangerous: CorrelationPair[] = [];

    for (let i = 0; i < matrix.strategies.length; i++) {
      for (let j = i + 1; j < matrix.strategies.length; j++) {
        const correlation = Math.abs(matrix.matrix[i][j]);

        if (correlation > this.config.dangerThreshold) {
          const pair: CorrelationPair = {
            strategy_a: matrix.strategies[i],
            strategy_b: matrix.strategies[j],
            correlation: matrix.matrix[i][j],
            risk_level: this.assessRiskLevel(correlation),
            recommendation: this.generateRecommendation(
              matrix.strategies[i],
              matrix.strategies[j],
              matrix.matrix[i][j]
            ),
          };
          dangerous.push(pair);
        }
      }
    }

    // Sort by absolute correlation (highest first)
    dangerous.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
    return dangerous;
  }

  /**
   * Assesses risk level based on correlation magnitude
   *
   * @param absoluteCorrelation - Absolute value of correlation coefficient
   * @returns Risk level classification
   */
  private assessRiskLevel(absoluteCorrelation: number): 'safe' | 'moderate' | 'dangerous' {
    if (absoluteCorrelation < 0.5) {
      return 'safe';
    } else if (absoluteCorrelation < 0.8) {
      return 'moderate';
    }
    return 'dangerous';
  }

  /**
   * Generates a diversification recommendation for a correlated pair
   *
   * @param strategyA - First strategy identifier
   * @param strategyB - Second strategy identifier
   * @param correlation - Correlation coefficient between strategies
   * @returns Recommendation string for portfolio adjustment
   */
  private generateRecommendation(strategyA: string, strategyB: string, correlation: number): string {
    const absCorr = Math.abs(correlation);

    if (absCorr > 0.9) {
      return `Consider replacing one of these strategies or significantly reducing their combined portfolio weight. Correlation of ${correlation.toFixed(3)} indicates they respond identically to market conditions.`;
    } else if (absCorr > 0.75) {
      return `Reduce the weight of ${strategyA} or ${strategyB} to limit portfolio concentration. Consider adding uncorrelated strategies.`;
    } else {
      return `Monitor this pair closely. If correlation persists, consider rebalancing to increase diversification.`;
    }
  }

  /**
   * Calculates portfolio concentration metrics
   *
   * The Herfindahl-Hirschman Index (HHI) measures market concentration.
   * Values closer to 0 indicate diversification; values closer to 1 indicate concentration.
   *
   * @returns ConcentrationMetrics including HHI, top weight, and effective number of strategies
   */
  public getPortfolioConcentration(): ConcentrationMetrics {
    const strategies = Array.from(this.strategyReturns.keys());

    if (strategies.length === 0) {
      return {
        hhi: 0,
        topWeight: 0,
        effectiveStrategies: 0,
        diversificationScore: 1,
      };
    }

    // Calculate volatility-weighted concentration
    const volatilities = strategies.map((id) => {
      const returns = this.strategyReturns.get(id)?.returns ?? [];
      return this.calculateStandardDeviation(returns);
    });

    const totalVol = volatilities.reduce((sum, vol) => sum + vol, 0);
    if (totalVol === 0) {
      const equal = 1 / strategies.length;
      const weights = Array(strategies.length).fill(equal);
      return this.calculateConcentrationMetrics(weights);
    }

    const weights = volatilities.map((vol) => vol / totalVol);
    return this.calculateConcentrationMetrics(weights);
  }

  /**
   * Calculates standard deviation of returns
   *
   * @param returns - Array of return values
   * @returns Standard deviation, or 0 if insufficient data
   */
  private calculateStandardDeviation(returns: number[]): number {
    if (returns.length < 2) {
      return 0;
    }

    const mean = returns.reduce((sum, val) => sum + val, 0) / returns.length;
    const squaredDiffs = returns.map((val) => Math.pow(val - mean, 2));
    const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / (returns.length - 1);

    return Math.sqrt(Math.max(0, variance)); // Guard against floating point errors
  }

  /**
   * Calculates concentration metrics from strategy weights
   *
   * @param weights - Array of portfolio weights (should sum to 1)
   * @returns ConcentrationMetrics object
   */
  private calculateConcentrationMetrics(weights: number[]): ConcentrationMetrics {
    // Herfindahl-Hirschman Index: sum of squared weights
    const hhi = weights.reduce((sum, w) => sum + w * w, 0);

    // Effective number of strategies (inverse HHI)
    const effectiveStrategies = 1 / hhi;

    // Top weight
    const topWeight = Math.max(...weights, 0);

    // Diversification score: 1 = perfectly diversified, 0 = fully concentrated
    const maxStrategies = weights.length;
    const diversificationScore = (maxStrategies - effectiveStrategies) / (maxStrategies - 1);

    return {
      hhi: parseFloat(hhi.toFixed(4)),
      topWeight: parseFloat(topWeight.toFixed(4)),
      effectiveStrategies: parseFloat(effectiveStrategies.toFixed(2)),
      diversificationScore: parseFloat(Math.max(0, diversificationScore).toFixed(4)),
    };
  }

  /**
   * Checks for dangerous correlation pairs and emits events if found
   *
   * @private
   */
  private checkForDangerousPairs(): void {
    const dangerous = this.getDangerousPairs();

    if (dangerous.length > 0) {
      this.emit('correlation:danger', {
        timestamp: new Date().toISOString(),
        dangerous_pairs: dangerous,
        count: dangerous.length,
      });
    }
  }

  /**
   * Starts periodic correlation updates based on configured interval
   *
   * @private
   */
  private startPeriodicUpdates(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
    }

    this.updateTimer = setInterval(() => {
      if (this.strategyReturns.size > 1) {
        this.computeCorrelationMatrix();
      }
    }, this.config.updateIntervalMs);
  }

  /**
   * Resets all tracked strategy data
   *
   * Clears all returns history and correlation data. Useful for testing
   * or when starting a new analysis period.
   */
  public reset(): void {
    this.strategyReturns.clear();
    this.lastComputeTime = new Date();
    this.emit('correlation:reset', {
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Gets the number of tracked strategies
   *
   * @returns Number of strategies with return data
   */
  public getStrategyCount(): number {
    return this.strategyReturns.size;
  }

  /**
   * Gets return data for a specific strategy
   *
   * @param strategyId - Strategy identifier
   * @returns Array of returns, or empty array if strategy not found
   */
  public getReturns(strategyId: string): number[] {
    return [...(this.strategyReturns.get(strategyId)?.returns ?? [])];
  }

  /**
   * Gets all tracked strategy identifiers
   *
   * @returns Array of strategy IDs, sorted alphabetically
   */
  public getStrategyIds(): string[] {
    return Array.from(this.strategyReturns.keys()).sort();
  }

  /**
   * Gets the timestamp of the last correlation computation
   *
   * @returns ISO 8601 timestamp string
   */
  public getLastComputeTime(): string {
    return this.lastComputeTime.toISOString();
  }

  /**
   * Cleans up resources and stops periodic updates
   *
   * Call this when done with the correlator to prevent memory leaks.
   */
  public destroy(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
    this.strategyReturns.clear();
    this.removeAllListeners();
  }
}

export default StrategyCorrelator;
