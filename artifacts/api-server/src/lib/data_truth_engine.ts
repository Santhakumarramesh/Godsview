export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: Date;
}

export interface DataQualityReport {
  symbol: string;
  timeframe: string;
  qualityScore: number;
  freshnessScore: number;
  completenessScore: number;
  consistencyScore: number;
  gapCount: number;
  staleBarCount: number;
  totalBars: number;
  gaps: GapDetail[];
  staleIndices: number[];
  scoredAt: Date;
}

export interface GapDetail {
  startTime: Date;
  endTime: Date;
  expectedBars: number;
}

export interface FeedHealthStatus {
  feedName: string;
  status: 'healthy' | 'degraded' | 'stale' | 'dead';
  lastTickAt: Date | null;
  avgLatencyMs: number;
  gapEvents24h: number;
  uptime24hPct: number;
  checkedAt: Date;
}

export interface ConsistencyReport {
  symbol: string;
  timeframe: string;
  sourceA: string;
  sourceB: string;
  divergenceScore: number;
  priceAlignmentOk: boolean;
  volumeAlignmentOk: boolean;
  timestampAlignmentOk: boolean;
  details: {
    maxPriceDivergence: number;
    maxVolumeDivergence: number;
    timestampMisalignments: number;
  };
  checkedAt: Date;
}

export interface DataTruthVerdict {
  symbol: string;
  timeframe: string;
  verdict: 'pass' | 'warn' | 'fail';
  reason: string;
  qualityScore: number;
  mode: 'backtest' | 'paper' | 'live';
}

interface QualityScorerConfig {
  freshnessThresholdMs?: number;
  staleBarsThresholdMs?: number;
  minBarsForCompletion?: number;
}

interface FeedHealthConfig {
  staleThresholdMs?: number;
  latencySampleWindow?: number;
}

interface CrossSourceValidatorConfig {
  priceDivergenceThreshold?: number;
  volumeDivergenceThreshold?: number;
  toleranceMs?: number;
}

interface DataTruthGateConfig {
  liveMode: {
    qualityMin: number;
    warnThreshold: number;
  };
  paperMode: {
    qualityMin: number;
    warnThreshold: number;
  };
  backtestMode: {
    qualityMin: number;
    warnThreshold: number;
  };
}

export class DataQualityScorer {
  private config: QualityScorerConfig;

  constructor(config: QualityScorerConfig = {}) {
    this.config = {
      freshnessThresholdMs: config.freshnessThresholdMs ?? 300000, // 5 minutes
      staleBarsThresholdMs: config.staleBarsThresholdMs ?? 600000, // 10 minutes
      minBarsForCompletion: config.minBarsForCompletion ?? 10,
    };
  }

  scoreCandles(symbol: string, timeframe: string, candles: Candle[]): DataQualityReport {
    const now = new Date();
    const gapCount = this.detectGaps(candles, timeframe);
    const gaps = this.findGapDetails(candles, timeframe);
    const staleIndices = this.findStaleCandles(candles, now);
    const staleBarCount = staleIndices.length;

    const freshnessScore = this.computeFreshnessScore(candles, now);
    const completenessScore = this.computeCompletenessScore(candles, timeframe);
    const consistencyScore = this.computeConsistencyScore(candles);

    // Weighted combination: consistency (40%), completeness (30%), freshness (30%)
    const qualityScore =
      consistencyScore * 0.4 +
      completenessScore * 0.3 +
      freshnessScore * 0.3;

    return {
      symbol,
      timeframe,
      qualityScore: Math.max(0, Math.min(1, qualityScore)),
      freshnessScore: Math.max(0, Math.min(1, freshnessScore)),
      completenessScore: Math.max(0, Math.min(1, completenessScore)),
      consistencyScore: Math.max(0, Math.min(1, consistencyScore)),
      gapCount,
      staleBarCount,
      totalBars: candles.length,
      gaps,
      staleIndices,
      scoredAt: now,
    };
  }

  private detectGaps(candles: Candle[], timeframe: string): number {
    if (candles.length < 2) return 0;

    const intervalMs = this.timeframeToMs(timeframe);
    let gaps = 0;

    for (let i = 1; i < candles.length; i++) {
      const timeDiff = candles[i].timestamp.getTime() - candles[i - 1].timestamp.getTime();
      if (timeDiff > intervalMs * 1.5) {
        gaps++;
      }
    }

    return gaps;
  }

  private findGapDetails(candles: Candle[], timeframe: string): GapDetail[] {
    if (candles.length < 2) return [];

    const intervalMs = this.timeframeToMs(timeframe);
    const gaps: GapDetail[] = [];

    for (let i = 1; i < candles.length; i++) {
      const timeDiff = candles[i].timestamp.getTime() - candles[i - 1].timestamp.getTime();
      if (timeDiff > intervalMs * 1.5) {
        const expectedBars = Math.floor(timeDiff / intervalMs) - 1;
        gaps.push({
          startTime: candles[i - 1].timestamp,
          endTime: candles[i].timestamp,
          expectedBars,
        });
      }
    }

    return gaps;
  }

  private findStaleCandles(candles: Candle[], now: Date): number[] {
    const staleThreshold = this.config.staleBarsThresholdMs!;
    const staleIndices: number[] = [];

    candles.forEach((candle, idx) => {
      const age = now.getTime() - candle.timestamp.getTime();
      if (age > staleThreshold) {
        staleIndices.push(idx);
      }
    });

    return staleIndices;
  }

  private computeFreshnessScore(candles: Candle[], now: Date): number {
    if (candles.length === 0) return 0;

    const latestCandle = candles[candles.length - 1];
    const ageMs = now.getTime() - latestCandle.timestamp.getTime();
    const thresholdMs = this.config.freshnessThresholdMs!;

    // 1.0 if fresh, decay to 0 over threshold
    return Math.max(0, 1 - ageMs / thresholdMs);
  }

  private computeCompletenessScore(candles: Candle[], timeframe: string): number {
    if (candles.length < this.config.minBarsForCompletion!) return 0.5;

    const intervalMs = this.timeframeToMs(timeframe);
    const firstTime = candles[0].timestamp.getTime();
    const lastTime = candles[candles.length - 1].timestamp.getTime();
    const spanMs = lastTime - firstTime;

    const expectedBars = Math.floor(spanMs / intervalMs) + 1;
    const actualBars = candles.length;

    return Math.min(1, actualBars / expectedBars);
  }

  private computeConsistencyScore(candles: Candle[]): number {
    let score = 1.0;

    // Check for duplicate timestamps
    const timestamps = new Set<number>();
    candles.forEach((candle) => {
      const ts = candle.timestamp.getTime();
      if (timestamps.has(ts)) {
        score -= 0.2; // Penalty for duplicate
      }
      timestamps.add(ts);
    });

    // Check for monotonic increasing timestamps
    for (let i = 1; i < candles.length; i++) {
      if (candles[i].timestamp.getTime() <= candles[i - 1].timestamp.getTime()) {
        score -= 0.1; // Penalty for non-monotonic
      }
    }

    // Check for negative volumes or prices
    candles.forEach((candle) => {
      if (candle.volume < 0 || candle.open < 0 || candle.close < 0) {
        score -= 0.15;
      }
      if (candle.high < candle.low || candle.high < candle.open || candle.high < candle.close) {
        score -= 0.1;
      }
    });

    return Math.max(0, Math.min(1, score));
  }

  private timeframeToMs(timeframe: string): number {
    const match = timeframe.match(/^(\d+)([mhd])$/i);
    if (!match) return 60000; // Default 1 minute

    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    switch (unit) {
      case 'm':
        return value * 60000;
      case 'h':
        return value * 3600000;
      case 'd':
        return value * 86400000;
      default:
        return 60000;
    }
  }
}

export class FeedHealthMonitor {
  private feedState = new Map<string, { lastTickAt: Date; latencies: number[] }>();
  private config: FeedHealthConfig;

  constructor(config: FeedHealthConfig = {}) {
    this.config = {
      staleThresholdMs: config.staleThresholdMs ?? 30000, // 30 seconds
      latencySampleWindow: config.latencySampleWindow ?? 100,
    };
  }

  recordTick(feedName: string, latencyMs: number): void {
    if (!this.feedState.has(feedName)) {
      this.feedState.set(feedName, {
        lastTickAt: new Date(),
        latencies: [],
      });
    }

    const state = this.feedState.get(feedName)!;
    state.lastTickAt = new Date();
    state.latencies.push(latencyMs);

    // Keep only recent latencies
    if (state.latencies.length > this.config.latencySampleWindow!) {
      state.latencies.shift();
    }
  }

  getFeedHealth(feedName: string): FeedHealthStatus {
    const state = this.feedState.get(feedName);
    const now = new Date();

    if (!state) {
      return {
        feedName,
        status: 'dead',
        lastTickAt: null,
        avgLatencyMs: 0,
        gapEvents24h: 0,
        uptime24hPct: 0,
        checkedAt: now,
      };
    }

    const lastTickAge = now.getTime() - state.lastTickAt.getTime();
    const isStale = lastTickAge > this.config.staleThresholdMs!;
    const isDead = lastTickAge > 300000; // 5 minutes

    let status: 'healthy' | 'degraded' | 'stale' | 'dead' = 'healthy';
    if (isDead) {
      status = 'dead';
    } else if (isStale) {
      status = 'stale';
    } else if (state.latencies.length > 0) {
      const avgLatency = state.latencies.reduce((a, b) => a + b, 0) / state.latencies.length;
      if (avgLatency > 1000) {
        status = 'degraded';
      }
    }

    const avgLatencyMs = state.latencies.length > 0
      ? state.latencies.reduce((a, b) => a + b, 0) / state.latencies.length
      : 0;

    return {
      feedName,
      status,
      lastTickAt: state.lastTickAt,
      avgLatencyMs,
      gapEvents24h: 0, // Would be computed from historical data
      uptime24hPct: status === 'dead' ? 0 : status === 'stale' ? 50 : 100,
      checkedAt: now,
    };
  }

  getSystemFeedHealth(): FeedHealthStatus {
    const now = new Date();
    const feedNames = Array.from(this.feedState.keys());

    if (feedNames.length === 0) {
      return {
        feedName: 'system',
        status: 'dead',
        lastTickAt: null,
        avgLatencyMs: 0,
        gapEvents24h: 0,
        uptime24hPct: 0,
        checkedAt: now,
      };
    }

    const statuses = feedNames.map((name) => this.getFeedHealth(name));
    const healthyCount = statuses.filter((s) => s.status === 'healthy').length;
    const avgLatency = statuses.reduce((sum, s) => sum + s.avgLatencyMs, 0) / statuses.length;

    let systemStatus: 'healthy' | 'degraded' | 'stale' | 'dead' = 'healthy';
    const healthRatio = healthyCount / statuses.length;

    if (healthRatio < 0.25) {
      systemStatus = 'dead';
    } else if (healthRatio < 0.5) {
      systemStatus = 'stale';
    } else if (healthRatio < 0.75 || avgLatency > 500) {
      systemStatus = 'degraded';
    }

    return {
      feedName: 'system',
      status: systemStatus,
      lastTickAt: statuses.length > 0 ? statuses[0].lastTickAt : null,
      avgLatencyMs: avgLatency,
      gapEvents24h: 0,
      uptime24hPct: (healthyCount / statuses.length) * 100,
      checkedAt: now,
    };
  }
}

export class CrossSourceValidator {
  private config: CrossSourceValidatorConfig;

  constructor(config: CrossSourceValidatorConfig = {}) {
    this.config = {
      priceDivergenceThreshold: config.priceDivergenceThreshold ?? 0.001, // 0.1%
      volumeDivergenceThreshold: config.volumeDivergenceThreshold ?? 0.05, // 5%
      toleranceMs: config.toleranceMs ?? 100,
    };
  }

  validateConsistency(
    symbol: string,
    timeframe: string,
    sourceA: string,
    candlesA: Candle[],
    sourceB: string,
    candlesB: Candle[]
  ): ConsistencyReport {
    const now = new Date();

    if (candlesA.length === 0 || candlesB.length === 0) {
      return {
        symbol,
        timeframe,
        sourceA,
        sourceB,
        divergenceScore: candlesA.length !== candlesB.length ? 1.0 : 0.5,
        priceAlignmentOk: false,
        volumeAlignmentOk: false,
        timestampAlignmentOk: false,
        details: {
          maxPriceDivergence: 0,
          maxVolumeDivergence: 0,
          timestampMisalignments: 0,
        },
        checkedAt: now,
      };
    }

    let maxPriceDivergence = 0;
    let maxVolumeDivergence = 0;
    let timestampMisalignments = 0;

    const minLen = Math.min(candlesA.length, candlesB.length);

    for (let i = 0; i < minLen; i++) {
      const candleA = candlesA[i];
      const candleB = candlesB[i];

      // Check timestamp alignment
      const timeDiff = Math.abs(candleA.timestamp.getTime() - candleB.timestamp.getTime());
      if (timeDiff > this.config.toleranceMs!) {
        timestampMisalignments++;
      }

      // Check price divergence (using close price)
      const priceDiff = Math.abs(candleA.close - candleB.close);
      const priceRef = Math.max(Math.abs(candleA.close), Math.abs(candleB.close));
      const priceDivergence = priceRef > 0 ? priceDiff / priceRef : 0;
      maxPriceDivergence = Math.max(maxPriceDivergence, priceDivergence);

      // Check volume divergence
      const volumeDiff = Math.abs(candleA.volume - candleB.volume);
      const volumeRef = Math.max(candleA.volume, candleB.volume);
      const volumeDivergence = volumeRef > 0 ? volumeDiff / volumeRef : 0;
      maxVolumeDivergence = Math.max(maxVolumeDivergence, volumeDivergence);
    }

    const priceAlignmentOk = maxPriceDivergence <= this.config.priceDivergenceThreshold!;
    const volumeAlignmentOk = maxVolumeDivergence <= this.config.volumeDivergenceThreshold!;
    const timestampAlignmentOk = timestampMisalignments === 0;

    // Compute composite divergence score
    const divergenceScore = Math.min(1, maxPriceDivergence * 100 + maxVolumeDivergence * 10);

    return {
      symbol,
      timeframe,
      sourceA,
      sourceB,
      divergenceScore,
      priceAlignmentOk,
      volumeAlignmentOk,
      timestampAlignmentOk,
      details: {
        maxPriceDivergence,
        maxVolumeDivergence,
        timestampMisalignments,
      },
      checkedAt: now,
    };
  }
}

const DEFAULT_GATE_CONFIG: DataTruthGateConfig = {
  liveMode: {
    qualityMin: 0.6,
    warnThreshold: 0.8,
  },
  paperMode: {
    qualityMin: 0.5,
    warnThreshold: 0.7,
  },
  backtestMode: {
    qualityMin: 0.3,
    warnThreshold: 0.6,
  },
};

export function dataTruthGate(
  symbol: string,
  timeframe: string,
  qualityScore: number,
  mode: 'backtest' | 'paper' | 'live',
  config: DataTruthGateConfig = DEFAULT_GATE_CONFIG
): DataTruthVerdict {
  const modeConfig = config[`${mode}Mode` as keyof DataTruthGateConfig] as {
    qualityMin: number;
    warnThreshold: number;
  };

  let verdict: 'pass' | 'warn' | 'fail';
  let reason: string;

  if (qualityScore >= modeConfig.warnThreshold) {
    verdict = 'pass';
    reason = `Quality score ${qualityScore.toFixed(3)} exceeds ${mode} mode threshold ${modeConfig.warnThreshold}`;
  } else if (qualityScore >= modeConfig.qualityMin) {
    verdict = 'warn';
    reason = `Quality score ${qualityScore.toFixed(3)} in warning range for ${mode} mode (${modeConfig.qualityMin}-${modeConfig.warnThreshold})`;
  } else {
    verdict = 'fail';
    reason = `Quality score ${qualityScore.toFixed(3)} below minimum ${modeConfig.qualityMin} for ${mode} mode`;
  }

  return {
    symbol,
    timeframe,
    verdict,
    reason,
    qualityScore,
    mode,
  };
}
