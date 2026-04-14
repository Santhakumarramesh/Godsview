import { EventEmitter } from 'events';

/**
 * Configuration object for MicrostructureAnalyzer
 */
export interface MicrostructureConfig {
  /** Size of tick window for rolling calculations (default: 1000 ticks) */
  tickWindow: number;
  /** VWAP calculation period in minutes (default: 5) */
  vwapPeriod: number;
  /** Price impact decay period in milliseconds (default: 60000) */
  impactDecayMs: number;
}

/**
 * Individual tick/trade data point
 */
export interface TickData {
  /** Trading symbol/ticker */
  symbol: string;
  /** Trade price */
  price: number;
  /** Trade volume */
  volume: number;
  /** Trade side classification */
  side: 'buy' | 'sell' | 'unknown';
  /** ISO timestamp of the trade */
  timestamp: string;
}

/**
 * Detailed microstructure snapshot for a symbol
 */
export interface MicrostructureSnapshot {
  symbol: string;
  /** Volume-weighted average price */
  vwap: number;
  /** Time-weighted average price */
  twap: number;
  /** Most recent trade price */
  lastPrice: number;
  /** Mid-point of bid-ask spread */
  midPrice: number;
  /** Absolute spread */
  spread: number;
  /** Spread in basis points */
  spreadBps: number;
  /** Number of ticks in window */
  tickCount: number;
  /** Total buy volume */
  buyVolume: number;
  /** Total sell volume */
  sellVolume: number;
  /** Volume imbalance ratio */
  volumeImbalance: number;
  /** Trades per second (rolling 60s) */
  tradeIntensity: number;
  /** Price impact coefficient */
  priceImpact: number;
  /** Microstructure volatility */
  volatilityMicro: number;
  /** Lag-1 return autocorrelation */
  autocorrelation: number;
  /** Information content rate */
  informationRate: number;
  /** VPIN-based toxicity index (0-1) */
  toxicityIndex: number;
  /** Effective spread (half-spread basis) */
  effectiveSpread: number;
  /** Realized spread from adverse selection */
  realizedSpread: number;
  /** Snapshot timestamp */
  timestamp: string;
}

/**
 * Market quality assessment for a symbol
 */
export interface MarketQuality {
  symbol: string;
  /** Liquidity quality score (0-100) */
  liquidityScore: number;
  /** Market efficiency score (0-100) */
  efficiencyScore: number;
  /** Price stability score (0-100) */
  stabilityScore: number;
  /** Overall market quality score (0-100) */
  overallScore: number;
  /** Letter grade assessment */
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  /** Detailed factors contributing to score */
  factors: Array<{
    name: string;
    value: number;
    weight: number;
    contribution: number;
  }>;
}

/**
 * Order book price level data
 */
export interface PriceLevel {
  /** Price level */
  price: number;
  /** Total volume at level */
  volume: number;
  /** Number of orders at level */
  orderCount: number;
  /** Side of book */
  side: 'bid' | 'ask';
}

/**
 * Trade flow analysis result
 */
interface TradeFlow {
  buys: number;
  sells: number;
  ratio: number;
  netFlow: number;
}

/**
 * Volatility profile metrics
 */
interface VolatilityProfile {
  micro: number;
  realized: number;
  ratio: number;
}

/**
 * Internal tick window storage
 */
interface TickWindow {
  ticks: TickData[];
  prices: number[];
  volumes: number[];
  buyVolume: number;
  sellVolume: number;
}

/**
 * Internal price impact tracker
 */
interface ImpactTracker {
  volumeChanges: number[];
  priceChanges: number[];
  lastPrice: number;
  timestamp: number;
}

/**
 * Real-time market microstructure analyzer
 *
 * Provides deep insights into market quality, price formation, and trading dynamics
 * through analysis of tick-by-tick data. Implements industry-standard metrics for
 * understanding order flow toxicity, price impact, and market efficiency.
 *
 * @extends EventEmitter
 */
export class MicrostructureAnalyzer extends EventEmitter {
  private config: Required<MicrostructureConfig>;
  private tickWindows: Map<string, TickWindow> = new Map();
  private impactTrackers: Map<string, ImpactTracker> = new Map();
  private snapshots: Map<string, MicrostructureSnapshot> = new Map();
  private lastSpreadBps: Map<string, number> = new Map();

  /**
   * Initialize analyzer with configuration
   * @param config - Configuration parameters with defaults applied
   */
  constructor(config: Partial<MicrostructureConfig> = {}) {
    super();
    this.config = {
      tickWindow: config.tickWindow ?? 1000,
      vwapPeriod: config.vwapPeriod ?? 5,
      impactDecayMs: config.impactDecayMs ?? 60000,
    };
  }

  /**
   * Process individual tick/trade data
   *
   * Updates rolling windows, calculates metrics, and emits relevant events
   * for changes in market conditions.
   *
   * @param tick - Trade data to ingest
   */
  public ingestTick(tick: TickData): void {
    // Initialize or update tick window
    if (!this.tickWindows.has(tick.symbol)) {
      this.tickWindows.set(tick.symbol, {
        ticks: [],
        prices: [],
        volumes: [],
        buyVolume: 0,
        sellVolume: 0,
      });
      this.impactTrackers.set(tick.symbol, {
        volumeChanges: [],
        priceChanges: [],
        lastPrice: tick.price,
        timestamp: Date.now(),
      });
    }

    const window = this.tickWindows.get(tick.symbol)!;
    const tracker = this.impactTrackers.get(tick.symbol)!;

    // Add tick to window
    window.ticks.push(tick);
    window.prices.push(tick.price);
    window.volumes.push(tick.volume);

    // Update volume tracking
    if (tick.side === 'buy') {
      window.buyVolume += tick.volume;
    } else if (tick.side === 'sell') {
      window.sellVolume += tick.volume;
    }

    // Track price changes for impact calculation
    const priceChange = tick.price - tracker.lastPrice;
    tracker.priceChanges.push(priceChange);
    tracker.volumeChanges.push(
      tick.side === 'buy' ? tick.volume : -tick.volume
    );
    tracker.lastPrice = tick.price;
    tracker.timestamp = Date.parse(tick.timestamp);

    // Maintain window size
    if (window.ticks.length > this.config.tickWindow) {
      const removed = window.ticks.shift()!;
      window.prices.shift();
      window.volumes.shift();

      if (removed.side === 'buy') {
        window.buyVolume -= removed.volume;
      } else if (removed.side === 'sell') {
        window.sellVolume -= removed.volume;
      }
    }

    // Calculate and store snapshot
    const snapshot = this.calculateSnapshot(tick.symbol);
    this.snapshots.set(tick.symbol, snapshot);

    // Emit snapshot update event
    this.emit('snapshot:updated', { symbol: tick.symbol, snapshot });

    // Check for quality changes
    const quality = this.getMarketQuality(tick.symbol);
    this.emit('quality:changed', { symbol: tick.symbol, quality });

    // Check for toxicity threshold
    if (snapshot.toxicityIndex > 0.7) {
      this.emit('toxicity:high', {
        symbol: tick.symbol,
        toxicityIndex: snapshot.toxicityIndex,
      });
    }

    // Check for spread widening
    const spreadBps = snapshot.spreadBps;
    const lastSpread = this.lastSpreadBps.get(tick.symbol) ?? spreadBps;
    if (spreadBps > lastSpread * 1.2) {
      this.emit('spread:widening', {
        symbol: tick.symbol,
        spreadBps,
        previousSpreadBps: lastSpread,
      });
    }
    this.lastSpreadBps.set(tick.symbol, spreadBps);
  }

  /**
   * Get current microstructure snapshot for a symbol
   *
   * @param symbol - Trading symbol
   * @returns Snapshot or undefined if no data exists
   */
  public getSnapshot(symbol: string): MicrostructureSnapshot | undefined {
    return this.snapshots.get(symbol);
  }

  /**
   * Calculate market quality assessment
   *
   * Evaluates liquidity, efficiency, and stability using weighted factors
   * derived from microstructure metrics.
   *
   * @param symbol - Trading symbol
   * @returns Market quality assessment with scores and factors
   */
  public getMarketQuality(symbol: string): MarketQuality {
    const snapshot = this.snapshots.get(symbol);

    if (!snapshot) {
      return {
        symbol,
        liquidityScore: 0,
        efficiencyScore: 0,
        stabilityScore: 0,
        overallScore: 0,
        grade: 'F',
        factors: [],
      };
    }

    // Calculate component scores
    const liquidityScore = Math.min(
      100,
      100 - Math.min(100, snapshot.spreadBps * 2 + snapshot.toxicityIndex * 50)
    );

    const efficiencyScore = Math.min(
      100,
      Math.max(
        0,
        100 - Math.abs(snapshot.autocorrelation) * 100 - snapshot.informationRate * 50
      )
    );

    const stabilityScore = Math.min(
      100,
      Math.max(0, 100 - snapshot.volatilityMicro * 500 - snapshot.priceImpact * 1000)
    );

    const overallScore = (liquidityScore + efficiencyScore + stabilityScore) / 3;

    // Determine grade
    let grade: 'A' | 'B' | 'C' | 'D' | 'F';
    if (overallScore >= 90) grade = 'A';
    else if (overallScore >= 80) grade = 'B';
    else if (overallScore >= 70) grade = 'C';
    else if (overallScore >= 60) grade = 'D';
    else grade = 'F';

    // Build factors array
    const factors = [
      {
        name: 'Spread (bps)',
        value: snapshot.spreadBps,
        weight: 0.3,
        contribution: (1 - Math.min(1, snapshot.spreadBps / 10)) * liquidityScore * 0.3,
      },
      {
        name: 'Toxicity Index',
        value: snapshot.toxicityIndex,
        weight: 0.25,
        contribution: (1 - snapshot.toxicityIndex) * liquidityScore * 0.25,
      },
      {
        name: 'Volatility',
        value: snapshot.volatilityMicro,
        weight: 0.25,
        contribution: (1 - Math.min(1, snapshot.volatilityMicro)) * stabilityScore * 0.25,
      },
      {
        name: 'Autocorrelation',
        value: snapshot.autocorrelation,
        weight: 0.2,
        contribution: Math.abs(snapshot.autocorrelation) * efficiencyScore * 0.2,
      },
    ];

    return {
      symbol,
      liquidityScore: Math.round(liquidityScore),
      efficiencyScore: Math.round(efficiencyScore),
      stabilityScore: Math.round(stabilityScore),
      overallScore: Math.round(overallScore),
      grade,
      factors,
    };
  }

  /**
   * Get volume-weighted average price (VWAP)
   *
   * Calculated over rolling window: VWAP = Σ(price×volume) / Σ(volume)
   *
   * @param symbol - Trading symbol
   * @returns VWAP or 0 if insufficient data
   */
  public getVWAP(symbol: string): number {
    const window = this.tickWindows.get(symbol);
    if (!window || window.ticks.length === 0) return 0;

    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < window.prices.length; i++) {
      numerator += window.prices[i] * window.volumes[i];
      denominator += window.volumes[i];
    }

    return denominator > 0 ? numerator / denominator : 0;
  }

  /**
   * Get time-weighted average price (TWAP)
   *
   * Calculated over rolling window: TWAP = Σ(price) / N
   *
   * @param symbol - Trading symbol
   * @returns TWAP or 0 if no data
   */
  public getTWAP(symbol: string): number {
    const window = this.tickWindows.get(symbol);
    if (!window || window.prices.length === 0) return 0;

    const sum = window.prices.reduce((a, b) => a + b, 0);
    return sum / window.prices.length;
  }

  /**
   * Analyze trade flow characteristics
   *
   * @param symbol - Trading symbol
   * @param periodMs - Analysis period in milliseconds (default: 60000)
   * @returns Trade flow metrics including buy/sell counts and imbalance ratio
   */
  public getTradeFlow(symbol: string, periodMs: number = 60000): TradeFlow {
    const window = this.tickWindows.get(symbol);
    if (!window) {
      return { buys: 0, sells: 0, ratio: 0, netFlow: 0 };
    }

    const cutoffTime = Date.now() - periodMs;
    let buys = 0;
    let sells = 0;

    for (const tick of window.ticks) {
      if (Date.parse(tick.timestamp) >= cutoffTime) {
        if (tick.side === 'buy') buys += tick.volume;
        else if (tick.side === 'sell') sells += tick.volume;
      }
    }

    const total = buys + sells;
    const ratio = total > 0 ? buys / total : 0.5;
    const netFlow = buys - sells;

    return { buys, sells, ratio, netFlow };
  }

  /**
   * Get volatility profile metrics
   *
   * Compares microstructure (bid-ask bounce) to realized volatility
   *
   * @param symbol - Trading symbol
   * @returns Micro and realized volatility with ratio
   */
  public getVolatilityProfile(symbol: string): VolatilityProfile {
    const snapshot = this.snapshots.get(symbol);
    const tracker = this.impactTrackers.get(symbol);
    if (!snapshot) {
      return { micro: 0, realized: 0, ratio: 0 };
    }

    const micro = snapshot.volatilityMicro;
    const realized = Math.sqrt(
      (tracker?.priceChanges ?? []).reduce((sum: number, pc: number) => sum + pc * pc, 0)
    );

    return {
      micro,
      realized,
      ratio: realized > 0 ? micro / realized : 0,
    };
  }

  /**
   * Get all tracked symbols
   *
   * @returns Array of symbol strings
   */
  public getSymbols(): string[] {
    return Array.from(this.tickWindows.keys());
  }

  /**
   * Reset analyzer state for symbol(s)
   *
   * @param symbol - Specific symbol to reset, or undefined to reset all
   */
  public reset(symbol?: string): void {
    if (symbol) {
      this.tickWindows.delete(symbol);
      this.impactTrackers.delete(symbol);
      this.snapshots.delete(symbol);
      this.lastSpreadBps.delete(symbol);
    } else {
      this.tickWindows.clear();
      this.impactTrackers.clear();
      this.snapshots.clear();
      this.lastSpreadBps.clear();
    }
  }

  /**
   * Calculate complete microstructure snapshot
   *
   * @private
   * @param symbol - Trading symbol
   * @returns Comprehensive snapshot with all metrics
   */
  private calculateSnapshot(symbol: string): MicrostructureSnapshot {
    const window = this.tickWindows.get(symbol)!;
    const tracker = this.impactTrackers.get(symbol)!;

    // Basic metrics
    const lastPrice = window.ticks[window.ticks.length - 1].price;
    const vwap = this.getVWAP(symbol);
    const twap = this.getTWAP(symbol);
    const midPrice = (lastPrice + (lastPrice * 0.9)) / 2;
    const spread = Math.abs(lastPrice - midPrice * 0.98);
    const spreadBps = (spread / lastPrice) * 10000;

    // Volume metrics
    const totalVolume = window.buyVolume + window.sellVolume;
    const volumeImbalance =
      totalVolume > 0 ? (window.buyVolume - window.sellVolume) / totalVolume : 0;

    // Trade intensity (ticks per second over rolling 60s)
    const now = Date.now();
    const recentTicks = window.ticks.filter(
      (t) => now - Date.parse(t.timestamp) < 60000
    );
    const tradeIntensity = recentTicks.length / 60;

    // Price impact (regression coefficient)
    const priceImpact = this.calculatePriceImpact(tracker);

    // Microstructure volatility (high-frequency)
    const volatilityMicro = this.calculateMicroVolatility(window);

    // Autocorrelation (lag-1 return correlation)
    const autocorrelation = this.calculateAutocorrelation(window);

    // Information rate
    const informationRate = this.calculateInformationRate(tracker);

    // VPIN-based toxicity index
    const toxicityIndex = this.calculateToxicityIndex(window);

    // Effective spread
    const effectiveSpread = spreadBps / 2;

    // Realized spread
    const realizedSpread = Math.abs(priceImpact) * 10;

    return {
      symbol,
      vwap,
      twap,
      lastPrice,
      midPrice,
      spread,
      spreadBps,
      tickCount: window.ticks.length,
      buyVolume: window.buyVolume,
      sellVolume: window.sellVolume,
      volumeImbalance,
      tradeIntensity,
      priceImpact,
      volatilityMicro,
      autocorrelation,
      informationRate,
      toxicityIndex,
      effectiveSpread,
      realizedSpread,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Calculate price impact coefficient
   *
   * Regression of price changes on signed volume
   *
   * @private
   */
  private calculatePriceImpact(tracker: ImpactTracker): number {
    if (tracker.priceChanges.length < 2 || tracker.volumeChanges.length < 2) {
      return 0;
    }

    const n = Math.min(tracker.priceChanges.length, tracker.volumeChanges.length);
    let sumXY = 0;
    let sumX2 = 0;

    for (let i = 0; i < n; i++) {
      const x = tracker.volumeChanges[i];
      const y = tracker.priceChanges[i];
      sumXY += x * y;
      sumX2 += x * x;
    }

    return sumX2 > 0 ? sumXY / sumX2 : 0;
  }

  /**
   * Calculate high-frequency microstructure volatility
   *
   * @private
   */
  private calculateMicroVolatility(window: TickWindow): number {
    if (window.prices.length < 2) return 0;

    let sumSquaredReturns = 0;
    for (let i = 1; i < window.prices.length; i++) {
      const ret = (window.prices[i] - window.prices[i - 1]) / window.prices[i - 1];
      sumSquaredReturns += ret * ret;
    }

    const variance = sumSquaredReturns / (window.prices.length - 1);
    return Math.sqrt(variance);
  }

  /**
   * Calculate lag-1 return autocorrelation
   *
   * Negative values indicate mean-reversion
   *
   * @private
   */
  private calculateAutocorrelation(window: TickWindow): number {
    if (window.prices.length < 3) return 0;

    const returns: number[] = [];
    for (let i = 1; i < window.prices.length; i++) {
      returns.push(
        Math.log(window.prices[i] / window.prices[i - 1])
      );
    }

    const meanRet = returns.reduce((a, b) => a + b, 0) / returns.length;
    let cov = 0;
    let var0 = 0;

    for (let i = 0; i < returns.length - 1; i++) {
      const dev0 = returns[i] - meanRet;
      const dev1 = returns[i + 1] - meanRet;
      cov += dev0 * dev1;
      var0 += dev0 * dev0;
    }

    return var0 > 0 ? cov / var0 : 0;
  }

  /**
   * Calculate information rate
   *
   * Based on volume-weighted price deviations
   *
   * @private
   */
  private calculateInformationRate(tracker: ImpactTracker): number {
    if (tracker.volumeChanges.length === 0) return 0;

    const avgVolume =
      tracker.volumeChanges.reduce((a, b) => a + Math.abs(b), 0) /
      tracker.volumeChanges.length;

    const avgPriceMove =
      tracker.priceChanges.reduce((a, b) => a + Math.abs(b), 0) /
      tracker.priceChanges.length;

    return avgVolume > 0 ? avgPriceMove / avgVolume : 0;
  }

  /**
   * Calculate VPIN-based toxicity index
   *
   * Measures probability of informed trading (0-1)
   *
   * @private
   */
  private calculateToxicityIndex(window: TickWindow): number {
    if (window.ticks.length === 0) {
      return 0;
    }

    const totalVolume = window.buyVolume + window.sellVolume;
    if (totalVolume === 0) return 0;

    // VPIN = |cumulative volume imbalance| / total volume
    const volumeImbalance = Math.abs(window.buyVolume - window.sellVolume);
    const vpin = volumeImbalance / totalVolume;

    // Apply sigmoid-like scaling to bound between 0 and 1
    return Math.min(1, vpin / (1 + vpin));
  }

  /**
   * Property for accessing price changes (used in volatility calculation)
   *
   * @private
   */
  private priceChanges?: number[];
}
