import { EventEmitter } from 'events';

/**
 * Configuration for the sentiment aggregator
 */
export interface AggregatorConfig {
  /** Time-decay half-life in milliseconds (default: 3600000 = 1 hour) */
  decayHalfLifeMs?: number;
  /** Minimum number of distinct sources required for full confidence (default: 2) */
  minSourcesForConfidence?: number;
  /** Interval in milliseconds for updating aggregated sentiments (default: 30000 = 30s) */
  updateIntervalMs?: number;
}

/**
 * A single sentiment signal from an external source
 */
export interface SentimentSignal {
  /** Unique identifier for this signal */
  id: string;
  /** Source of the sentiment signal */
  source: 'news' | 'social' | 'analyst' | 'insider' | 'options_flow';
  /** Stock symbol (e.g., "AAPL") */
  symbol: string;
  /** Sentiment score from -1 (very bearish) to +1 (very bullish) */
  sentiment: number;
  /** Confidence level of this signal (0-1) */
  confidence: number;
  /** Optional headline or summary text */
  headline?: string;
  /** Optional URL reference */
  url?: string;
  /** Optional author or source name */
  author?: string;
  /** ISO timestamp when signal was created */
  timestamp: string;
  /** Additional metadata */
  metadata: Record<string, unknown>;
}

/**
 * Source breakdown entry in aggregated sentiment
 */
interface SourceBreakdown {
  /** Name of the source */
  source: string;
  /** Number of signals from this source */
  count: number;
  /** Average sentiment from this source */
  avgSentiment: number;
  /** Latest signal timestamp from this source */
  latestTimestamp: string;
}

/**
 * Aggregated sentiment for a single symbol
 */
export interface AggregatedSentiment {
  /** Stock symbol */
  symbol: string;
  /** Composite sentiment score (-1 to +1) */
  composite: number;
  /** Overall confidence in this aggregate (0-1) */
  confidence: number;
  /** Sentiment direction classification */
  direction: 'bullish' | 'bearish' | 'neutral';
  /** Strength of the sentiment signal */
  strength: 'strong' | 'moderate' | 'weak';
  /** Breakdown by source */
  sources: SourceBreakdown[];
  /** Total number of signals aggregated */
  signalCount: number;
  /** Trend direction based on historical momentum */
  trendDirection: 'improving' | 'deteriorating' | 'stable';
  /** Momentum value indicating rate of change */
  momentum: number;
  /** ISO timestamp of last update */
  lastUpdated: string;
}

/**
 * Snapshot of market-wide sentiment
 */
export interface SentimentSnapshot {
  /** Current aggregated sentiments by symbol */
  symbols: Record<string, AggregatedSentiment>;
  /** Top N most bullish symbols */
  mostBullish: Array<{ symbol: string; score: number }>;
  /** Top N most bearish symbols */
  mostBearish: Array<{ symbol: string; score: number }>;
  /** Symbols with biggest sentiment shifts */
  biggestShifts: Array<{
    symbol: string;
    delta: number;
    direction: 'up' | 'down';
  }>;
  /** Overall market sentiment average */
  overallMarketSentiment: number;
  /** ISO timestamp of snapshot */
  timestamp: string;
}

/**
 * Internal structure tracking sentiment history per symbol
 */
interface SymbolHistory {
  signals: SentimentSignal[];
  aggregates: Array<{ timestamp: string; composite: number }>;
  lastComposite: number;
}

/**
 * Sentiment Aggregator - Fuses signals from multiple sources into unified scores
 *
 * This aggregator implements:
 * - Time-decay weighting (exponential decay with configurable half-life)
 * - Source-weighted averaging (news=0.30, analyst=0.25, options_flow=0.20, social=0.15, insider=0.10)
 * - Confidence calculation based on signal count and source agreement
 * - Momentum calculation comparing current to 1-hour-ago composite
 * - Rolling history tracking (last 100 snapshots per symbol)
 *
 * @example
 * ```ts
 * const aggregator = new SentimentAggregator({
 *   decayHalfLifeMs: 3600000,
 *   minSourcesForConfidence: 2
 * });
 *
 * aggregator.ingest({
 *   id: 'signal-1',
 *   source: 'news',
 *   symbol: 'AAPL',
 *   sentiment: 0.7,
 *   confidence: 0.9,
 *   headline: 'Apple beats Q1 earnings',
 *   timestamp: new Date().toISOString(),
 *   metadata: {}
 * });
 *
 * const sentiment = aggregator.getSymbolSentiment('AAPL');
 * aggregator.on('sentiment:extreme', (data) => {
 *   console.log('Extreme sentiment detected:', data);
 * });
 * ```
 */
export class SentimentAggregator extends EventEmitter {
  private config: Required<AggregatorConfig>;
  private history: Map<string, SymbolHistory> = new Map();
  private updateTimer: NodeJS.Timeout | null = null;
  private lastHourSnapshots: Map<string, number> = new Map();

  /**
   * Source weight multipliers for weighted averaging
   */
  private static readonly SOURCE_WEIGHTS: Record<string, number> = {
    news: 0.3,
    analyst: 0.25,
    options_flow: 0.2,
    social: 0.15,
    insider: 0.1,
  };

  /**
   * Creates a new SentimentAggregator instance
   * @param config Configuration options
   */
  constructor(config?: AggregatorConfig) {
    super();
    this.config = {
      decayHalfLifeMs: config?.decayHalfLifeMs ?? 3600000,
      minSourcesForConfidence: config?.minSourcesForConfidence ?? 2,
      updateIntervalMs: config?.updateIntervalMs ?? 30000,
    };
    this.startUpdateLoop();
  }

  /**
   * Ingest a new sentiment signal
   * @param signal The sentiment signal to ingest
   */
  public ingest(signal: SentimentSignal): void {
    if (!this.history.has(signal.symbol)) {
      this.history.set(signal.symbol, {
        signals: [],
        aggregates: [],
        lastComposite: 0,
      });
    }

    const symbolHistory = this.history.get(signal.symbol)!;
    symbolHistory.signals.push(signal);

    // Keep only recent signals (prune older ones)
    const cutoffTime = Date.now() - this.config.decayHalfLifeMs * 3;
    symbolHistory.signals = symbolHistory.signals.filter(
      (s) => new Date(s.timestamp).getTime() > cutoffTime
    );

    this.updateSymbolSentiment(signal.symbol);
  }

  /**
   * Get the current aggregated sentiment for a symbol
   * @param symbol Stock symbol
   * @returns Aggregated sentiment or undefined if no data
   */
  public getSymbolSentiment(symbol: string): AggregatedSentiment | undefined {
    const history = this.history.get(symbol);
    if (!history || history.signals.length === 0) {
      return undefined;
    }

    return this.calculateAggregatedSentiment(symbol, history);
  }

  /**
   * Get a snapshot of current market-wide sentiment
   * @returns Sentiment snapshot
   */
  public getSnapshot(): SentimentSnapshot {
    const symbols: Record<string, AggregatedSentiment> = {};
    const sentiments: Array<{ symbol: string; score: number }> = [];

    for (const [symbol, history] of this.history.entries()) {
      if (history.signals.length === 0) continue;

      const agg = this.calculateAggregatedSentiment(symbol, history);
      symbols[symbol] = agg;
      sentiments.push({ symbol, score: agg.composite });
    }

    const sortedByScore = [...sentiments].sort((a, b) => b.score - a.score);
    const mostBullish = sortedByScore.slice(0, 5);
    const mostBearish = sortedByScore.slice(-5).reverse();

    const biggestShifts = this.calculateBiggestShifts(symbols);
    const overallMarketSentiment =
      sentiments.length > 0
        ? sentiments.reduce((sum, s) => sum + s.score, 0) / sentiments.length
        : 0;

    return {
      symbols,
      mostBullish,
      mostBearish,
      biggestShifts,
      overallMarketSentiment,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get historical sentiment data for a symbol
   * @param symbol Stock symbol
   * @param periodMs Time period in milliseconds (default: 1 hour)
   * @returns Array of historical sentiment points
   */
  public getHistory(
    symbol: string,
    periodMs: number = 3600000
  ): Array<{ timestamp: string; composite: number }> {
    const history = this.history.get(symbol);
    if (!history) return [];

    const cutoffTime = Date.now() - periodMs;
    return history.aggregates.filter(
      (point) => new Date(point.timestamp).getTime() > cutoffTime
    );
  }

  /**
   * Get top moving symbols by sentiment
   * @param count Number of top movers to return (default: 5)
   * @returns Top bullish and bearish moving symbols
   */
  public getTopMovers(
    count: number = 5
  ): { bullish: AggregatedSentiment[]; bearish: AggregatedSentiment[] } {
    const aggregates: AggregatedSentiment[] = [];

    for (const [symbol, history] of this.history.entries()) {
      if (history.signals.length === 0) continue;
      aggregates.push(this.calculateAggregatedSentiment(symbol, history));
    }

    const byMomentum = aggregates.sort((a, b) => b.momentum - a.momentum);
    const bullish = byMomentum.filter((a) => a.composite > 0).slice(0, count);
    const bearish = byMomentum
      .filter((a) => a.composite < 0)
      .slice(0, count)
      .reverse();

    return { bullish, bearish };
  }

  /**
   * Reset all aggregated data
   */
  public reset(): void {
    this.history.clear();
    this.lastHourSnapshots.clear();
  }

  /**
   * Cleanup and destroy the aggregator
   */
  public destroy(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
    this.removeAllListeners();
    this.reset();
  }

  /**
   * Calculate time-decay weight for a signal
   * @param signalTime Signal timestamp
   * @returns Weight from 0 to 1
   */
  private calculateDecayWeight(signalTime: string): number {
    const now = Date.now();
    const signalMs = new Date(signalTime).getTime();
    const ageMs = Math.max(0, now - signalMs);

    // Exponential decay: weight = 2^(-ageMs / halfLife)
    const weight = Math.pow(2, -ageMs / this.config.decayHalfLifeMs);
    return Math.max(0, Math.min(1, weight));
  }

  /**
   * Calculate source agreement (how aligned sources are)
   * @param sentiments Array of sentiment values
   * @returns Agreement metric from 0 to 1
   */
  private calculateSourceAgreement(sentiments: number[]): number {
    if (sentiments.length === 0) return 0;
    if (sentiments.length === 1) return 1;

    const mean = sentiments.reduce((a, b) => a + b, 0) / sentiments.length;
    const variance =
      sentiments.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) /
      sentiments.length;
    const stdDev = Math.sqrt(variance);

    // Convert std dev to agreement score (lower variance = higher agreement)
    return Math.max(0, 1 - stdDev);
  }

  /**
   * Calculate aggregated sentiment for a symbol
   * @param symbol Stock symbol
   * @param history Symbol history record
   * @returns Calculated AggregatedSentiment
   */
  private calculateAggregatedSentiment(
    symbol: string,
    history: SymbolHistory
  ): AggregatedSentiment {
    if (history.signals.length === 0) {
      return {
        symbol,
        composite: 0,
        confidence: 0,
        direction: 'neutral',
        strength: 'weak',
        sources: [],
        signalCount: 0,
        trendDirection: 'stable',
        momentum: 0,
        lastUpdated: new Date().toISOString(),
      };
    }

    // Group signals by source
    const bySource = new Map<string, SentimentSignal[]>();
    for (const signal of history.signals) {
      if (!bySource.has(signal.source)) {
        bySource.set(signal.source, []);
      }
      bySource.get(signal.source)!.push(signal);
    }

    // Calculate weighted composite score
    let weightedSum = 0;
    let totalWeight = 0;
    const sourceSentiments: number[] = [];
    const sourceBreakdown: SourceBreakdown[] = [];

    for (const [source, signals] of bySource.entries()) {
      const sourceWeight = SentimentAggregator.SOURCE_WEIGHTS[source] || 0.1;
      let sourceWeightedSum = 0;
      let sourceWeightTotal = 0;

      for (const signal of signals) {
        const decay = this.calculateDecayWeight(signal.timestamp);
        const weight = sourceWeight * decay * signal.confidence;
        sourceWeightedSum += signal.sentiment * weight;
        sourceWeightTotal += weight;
      }

      if (sourceWeightTotal > 0) {
        const avgSentiment = sourceWeightedSum / sourceWeightTotal;
        sourceSentiments.push(avgSentiment);
        weightedSum += sourceWeightedSum;
        totalWeight += sourceWeightTotal;

        const latestSignal = signals.reduce((latest, current) =>
          new Date(current.timestamp) > new Date(latest.timestamp)
            ? current
            : latest
        );

        sourceBreakdown.push({
          source,
          count: signals.length,
          avgSentiment,
          latestTimestamp: latestSignal.timestamp,
        });
      }
    }

    const composite = totalWeight > 0 ? weightedSum / totalWeight : 0;
    const clampedComposite = Math.max(-1, Math.min(1, composite));

    // Calculate confidence
    const sourceCount = bySource.size;
    const sourceAgreement = this.calculateSourceAgreement(sourceSentiments);
    const confidence = Math.min(
      sourceCount / this.config.minSourcesForConfidence,
      1
    ) * sourceAgreement;

    // Determine direction and strength
    const absSentiment = Math.abs(clampedComposite);
    const direction =
      clampedComposite > 0.1
        ? 'bullish'
        : clampedComposite < -0.1
          ? 'bearish'
          : 'neutral';
    const strength =
      absSentiment > 0.6 ? 'strong' : absSentiment > 0.3 ? 'moderate' : 'weak';

    // Calculate momentum
    const lastHourComposite = this.lastHourSnapshots.get(symbol) ?? 0;
    const momentum = clampedComposite - lastHourComposite;

    // Determine trend direction
    let trendDirection: 'improving' | 'deteriorating' | 'stable' = 'stable';
    if (momentum > 0.05) trendDirection = 'improving';
    else if (momentum < -0.05) trendDirection = 'deteriorating';

    const now = new Date().toISOString();

    // Store in history
    history.aggregates.push({ timestamp: now, composite: clampedComposite });
    if (history.aggregates.length > 100) {
      history.aggregates.shift();
    }

    // Store last composite for next momentum calculation
    history.lastComposite = clampedComposite;

    const result: AggregatedSentiment = {
      symbol,
      composite: clampedComposite,
      confidence,
      direction,
      strength,
      sources: sourceBreakdown,
      signalCount: history.signals.length,
      trendDirection,
      momentum,
      lastUpdated: now,
    };

    return result;
  }

  /**
   * Calculate biggest sentiment shifts
   * @param symbols Current symbol sentiments
   * @returns Top sentiment shifts
   */
  private calculateBiggestShifts(
    symbols: Record<string, AggregatedSentiment>
  ): Array<{ symbol: string; delta: number; direction: 'up' | 'down' }> {
    const shifts: Array<{
      symbol: string;
      delta: number;
      direction: 'up' | 'down';
    }> = [];

    for (const [symbol, agg] of Object.entries(symbols)) {
      const history = this.history.get(symbol);
      if (!history || history.aggregates.length < 2) continue;

      const recent = history.aggregates[history.aggregates.length - 1].composite;
      const previous =
        history.aggregates[Math.max(0, history.aggregates.length - 10)]
          .composite;
      const delta = recent - previous;

      if (Math.abs(delta) > 0.05) {
        shifts.push({
          symbol,
          delta: Math.abs(delta),
          direction: delta > 0 ? 'up' : 'down',
        });
      }
    }

    return shifts.sort((a, b) => b.delta - a.delta).slice(0, 5);
  }

  /**
   * Update sentiment for a symbol and emit events
   * @param symbol Stock symbol
   */
  private updateSymbolSentiment(symbol: string): void {
    const history = this.history.get(symbol);
    if (!history) return;

    const current = this.calculateAggregatedSentiment(symbol, history);
    const previous = this.lastHourSnapshots.get(symbol);

    // Emit update event
    this.emit('sentiment:updated', {
      symbol,
      sentiment: current,
      timestamp: current.lastUpdated,
    });

    // Emit shift event if large change
    if (previous !== undefined && Math.abs(current.composite - previous) > 0.2) {
      this.emit('sentiment:shift', {
        symbol,
        previous,
        current: current.composite,
        delta: current.composite - previous,
      });
    }

    // Emit extreme event if high magnitude
    if (Math.abs(current.composite) > 0.8) {
      this.emit('sentiment:extreme', {
        symbol,
        sentiment: current.composite,
        direction: current.composite > 0 ? 'bullish' : 'bearish',
      });
    }
  }

  /**
   * Start the periodic update loop
   */
  private startUpdateLoop(): void {
    this.updateTimer = setInterval(() => {
      for (const symbol of this.history.keys()) {
        const agg = this.getSymbolSentiment(symbol);
        if (agg) {
          this.lastHourSnapshots.set(symbol, agg.composite);
        }
      }
    }, this.config.updateIntervalMs);
  }
}
