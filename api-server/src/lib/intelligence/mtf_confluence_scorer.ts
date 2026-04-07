/**
 * Phase 101 — MTF Confluence Scorer for MCP Pipeline
 *
 * Wraps the existing brain_mtf_confluence into a scorer that integrates
 * with the MCP enrichment layer. For each signal, computes alignment
 * across 5 timeframes and returns a weighted confluence score.
 *
 * Integration: injected into MCPProcessor as an additional scoring dimension.
 * Returns both a composite alignment score (0-1) and per-timeframe breakdown.
 *
 * Key Logic:
 * - Weights higher timeframes more (1D=0.15, 1H=0.30, 15m=0.25, 5m=0.20, 1m=0.10)
 * - Agreement of 4-5 TFs → "strong_confirm" (+0.2 boost)
 * - Agreement of 3 TFs → "moderate_confirm" (+0.1 boost)
 * - Agreement of 2 TFs → "weak_confirm" (0 boost)
 * - <2 TFs agree → "conflict" (-0.2 boost)
 * - <3 TFs with data → "insufficient_data" (-0.1 boost)
 */

// ── Types & Interfaces ─────────────────────────────────────────────────────

export type Timeframe = "1m" | "5m" | "15m" | "1h" | "1d";

export interface TimeframeBreakdown {
  timeframe: Timeframe;
  trend: "bullish" | "bearish" | "neutral";
  momentum: number;           // -1 to +1 (RSI-normalized)
  volumeConfirmed: boolean;   // above 20-bar avg volume
  alignedWithSignal: boolean; // matches signal direction
  weight: number;             // contribution weight (0-1)
  contribution: number;       // weighted contribution to score
}

export interface MTFConfluenceScore {
  signalId: string;
  symbol: string;
  direction: "long" | "short";
  alignmentScore: number;       // 0-1 composite (≥0.65 is actionable)
  agreementCount: number;       // how many TFs agree with direction
  totalTimeframes: number;      // how many TFs analyzed
  strongTimeframes: Timeframe[]; // TFs with score > 0.7
  conflictTimeframes: Timeframe[]; // TFs opposing direction
  compressed: boolean;          // squeeze detected on 2+ TFs
  breakdown: TimeframeBreakdown[];
  recommendation: "strong_confirm" | "moderate_confirm" | "weak_confirm" | "conflict" | "insufficient_data";
  boostFactor: number;          // -0.3 to +0.3, added to MCP confirmation score
  timestamp: number;
}

export interface ReplayBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StandardSignal {
  id: string;
  symbol: string;
  direction: "long" | "short";
  price: number;
  timestamp: number;
  type: string;
}

export interface MTFConfluenceScorerConfig {
  minBarsPerTimeframe?: number;
  minAgreementForConfirm?: number;
  compressionThresholdATR?: number;
  volumeThreshold?: number;
  timeframeWeights?: Record<Timeframe, number>;
}

export interface ScorerStats {
  totalSignalsScored: number;
  recommendationCounts: Record<string, number>;
  avgAlignmentScore: number;
  avgBoostFactor: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: Required<MTFConfluenceScorerConfig> = {
  minBarsPerTimeframe: 20,
  minAgreementForConfirm: 3,
  compressionThresholdATR: 0.5,
  volumeThreshold: 1.0,
  timeframeWeights: {
    "1d": 0.15,
    "1h": 0.30,
    "15m": 0.25,
    "5m": 0.20,
    "1m": 0.10,
  },
};

const TF_PERIODS: Record<Timeframe, number> = {
  "1m": 30,
  "5m": 24,
  "15m": 20,
  "1h": 24,
  "1d": 20,
};

const EMA_PERIODS = {
  fast: 9,
  slow: 21,
};

const RSI_PERIOD = 14;
const ATR_PERIOD = 14;

// ── Helper Functions: Pure Math ────────────────────────────────────────────

/**
 * Compute Exponential Moving Average
 */
function computeEMA(closes: number[], period: number): number[] {
  if (closes.length < period) return [];

  const ema: number[] = [];
  const k = 2 / (period + 1);

  // SMA for first period
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += closes[i];
  }
  ema[period - 1] = sum / period;

  // EMA for remaining
  for (let i = period; i < closes.length; i++) {
    ema[i] = closes[i] * k + ema[i - 1] * (1 - k);
  }

  return ema;
}

/**
 * Compute Relative Strength Index
 * Returns -1 to +1 (normalized from 0-100 RSI)
 */
function computeRSI(closes: number[], period: number = RSI_PERIOD): number {
  if (closes.length < period + 1) return 0;

  let gains = 0;
  let losses = 0;

  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return avgGain > 0 ? 1 : 0;

  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);

  // Normalize to -1 to +1
  return (rsi - 50) / 50;
}

/**
 * Compute Average True Range
 */
function computeATR(bars: ReplayBar[], period: number = ATR_PERIOD): number {
  if (bars.length < period) return 0;

  let trSum = 0;
  const startIdx = Math.max(0, bars.length - period);

  for (let i = startIdx; i < bars.length; i++) {
    const bar = bars[i];
    const prevClose = i > 0 ? bars[i - 1].close : bar.open;

    const tr = Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - prevClose),
      Math.abs(bar.low - prevClose)
    );
    trSum += tr;
  }

  return trSum / (bars.length - startIdx);
}

/**
 * Compute average volume over last N bars
 */
function computeAvgVolume(bars: ReplayBar[], period: number = 20): number {
  if (bars.length < period) period = bars.length;

  let volSum = 0;
  const startIdx = Math.max(0, bars.length - period);

  for (let i = startIdx; i < bars.length; i++) {
    volSum += bars[i].volume;
  }

  return volSum / (bars.length - startIdx);
}

/**
 * Detect range compression (squeeze) on a timeframe
 */
function detectCompression(
  bars: ReplayBar[],
  compressionThreshold: number = 0.5
): boolean {
  if (bars.length < 20) return false;

  const recentATR = computeATR(bars.slice(-14), 14);
  const avgATR = computeATR(bars.slice(-20), 20);

  if (avgATR === 0) return false;
  return recentATR < avgATR * compressionThreshold;
}

// ── MTFConfluenceScorer Class ──────────────────────────────────────────────

export class MTFConfluenceScorer {
  private config: Required<MTFConfluenceScorerConfig>;
  private stats: ScorerStats = {
    totalSignalsScored: 0,
    recommendationCounts: {
      strong_confirm: 0,
      moderate_confirm: 0,
      weak_confirm: 0,
      conflict: 0,
      insufficient_data: 0,
    },
    avgAlignmentScore: 0,
    avgBoostFactor: 0,
  };

  constructor(config: MTFConfluenceScorerConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Score a signal across all available timeframes
   */
  scoreSignal(
    signal: StandardSignal,
    barsByTimeframe: Map<string, ReplayBar[]>
  ): MTFConfluenceScore {
    const startTime = Date.now();

    // Validate input
    if (!barsByTimeframe || barsByTimeframe.size === 0) {
      return this.createInsufficientDataScore(signal);
    }

    const breakdown: TimeframeBreakdown[] = [];
    const strongTFs: Timeframe[] = [];
    const conflictTFs: Timeframe[] = [];
    let agreementCount = 0;
    let compressionCount = 0;
    let alignedTFCount = 0;
    let weightedScore = 0;
    let totalWeight = 0;

    // Analyze each timeframe
    const timeframes: Timeframe[] = ["1d", "1h", "15m", "5m", "1m"];

    for (const tf of timeframes) {
      const bars = barsByTimeframe.get(tf);
      if (!bars || bars.length < this.config.minBarsPerTimeframe) {
        continue;
      }

      const tfAnalysis = this.analyzeTimeframe(bars, signal, tf);
      breakdown.push(tfAnalysis);

      // Track agreement
      if (tfAnalysis.alignedWithSignal) {
        agreementCount++;
      } else {
        conflictTFs.push(tf);
      }

      if (tfAnalysis.contribution > 0.7) {
        strongTFs.push(tf);
      }

      if (detectCompression(bars, this.config.compressionThresholdATR)) {
        compressionCount++;
      }

      // Accumulate weighted score
      weightedScore += tfAnalysis.contribution;
      totalWeight += tfAnalysis.weight;
      alignedTFCount += tfAnalysis.alignedWithSignal ? 1 : 0;
    }

    const totalTimeframes = breakdown.length;
    const alignmentScore =
      totalWeight > 0 ? Math.min(1, weightedScore / totalWeight) : 0;

    // Determine recommendation and boost factor
    const { recommendation, boostFactor } = this.determineRecommendation(
      agreementCount,
      totalTimeframes,
      alignmentScore
    );

    const compressed = compressionCount >= 2;

    const score: MTFConfluenceScore = {
      signalId: signal.id,
      symbol: signal.symbol,
      direction: signal.direction,
      alignmentScore,
      agreementCount,
      totalTimeframes,
      strongTimeframes: strongTFs,
      conflictTimeframes: conflictTFs,
      compressed,
      breakdown,
      recommendation,
      boostFactor,
      timestamp: Date.now(),
    };

    // Update stats
    this.updateStats(score);

    return score;
  }

  /**
   * Analyze a single timeframe for trend, momentum, volume
   */
  private analyzeTimeframe(
    bars: ReplayBar[],
    signal: StandardSignal,
    tf: Timeframe
  ): TimeframeBreakdown {
    const weight = this.config.timeframeWeights[tf];
    const closes = bars.map((b) => b.close);

    // Compute indicators
    const ema9 = computeEMA(closes, EMA_PERIODS.fast);
    const ema21 = computeEMA(closes, EMA_PERIODS.slow);
    const rsi = computeRSI(closes, RSI_PERIOD);
    const avgVolume = computeAvgVolume(bars, 20);

    const lastBar = bars[bars.length - 1];
    const currentClose = lastBar.close;

    // Trend determination
    let trend: "bullish" | "bearish" | "neutral" = "neutral";
    if (
      ema9.length > 0 &&
      ema21.length > 0 &&
      currentClose > ema21[ema21.length - 1]
    ) {
      trend = "bullish";
    } else if (
      ema9.length > 0 &&
      ema21.length > 0 &&
      currentClose < ema21[ema21.length - 1]
    ) {
      trend = "bearish";
    }

    // Check alignment with signal
    const alignedWithSignal =
      (signal.direction === "long" && trend === "bullish") ||
      (signal.direction === "short" && trend === "bearish");

    // Volume confirmation
    const volumeConfirmed =
      lastBar.volume >= avgVolume * this.config.volumeThreshold;

    // Compute contribution score
    let contribution = 0;

    // Base contribution from trend alignment
    if (alignedWithSignal) {
      contribution = 0.5;
    } else {
      contribution = 0.2;
    }

    // Add momentum contribution
    const momentumFactor = Math.abs(rsi) * 0.3;
    contribution += momentumFactor;

    // Add volume confirmation bonus
    if (volumeConfirmed) {
      contribution += 0.1;
    }

    // Cap at 1
    contribution = Math.min(1, contribution);

    return {
      timeframe: tf,
      trend,
      momentum: rsi,
      volumeConfirmed,
      alignedWithSignal,
      weight,
      contribution,
    };
  }

  /**
   * Determine recommendation and boost factor based on agreement
   */
  private determineRecommendation(
    agreementCount: number,
    totalTimeframes: number,
    alignmentScore: number
  ): { recommendation: MTFConfluenceScore["recommendation"]; boostFactor: number } {
    // Insufficient data
    if (totalTimeframes < 3) {
      return { recommendation: "insufficient_data", boostFactor: -0.1 };
    }

    // Conflict (minority agreement)
    if (agreementCount < 2) {
      return { recommendation: "conflict", boostFactor: -0.2 };
    }

    // Weak confirm (2 TFs)
    if (agreementCount === 2) {
      return { recommendation: "weak_confirm", boostFactor: 0 };
    }

    // Moderate confirm (3 TFs)
    if (agreementCount === 3) {
      return { recommendation: "moderate_confirm", boostFactor: 0.1 };
    }

    // Strong confirm (4-5 TFs)
    return { recommendation: "strong_confirm", boostFactor: 0.2 };
  }

  /**
   * Create a score for cases with insufficient bar data
   */
  private createInsufficientDataScore(
    signal: StandardSignal
  ): MTFConfluenceScore {
    return {
      signalId: signal.id,
      symbol: signal.symbol,
      direction: signal.direction,
      alignmentScore: 0,
      agreementCount: 0,
      totalTimeframes: 0,
      strongTimeframes: [],
      conflictTimeframes: [],
      compressed: false,
      breakdown: [],
      recommendation: "insufficient_data",
      boostFactor: -0.1,
      timestamp: Date.now(),
    };
  }

  /**
   * Update running statistics
   */
  private updateStats(score: MTFConfluenceScore): void {
    this.stats.totalSignalsScored++;
    this.stats.recommendationCounts[score.recommendation]++;

    // Update rolling averages
    const prevAvgScore = this.stats.avgAlignmentScore;
    const prevAvgBoost = this.stats.avgBoostFactor;
    const n = this.stats.totalSignalsScored;

    this.stats.avgAlignmentScore =
      (prevAvgScore * (n - 1) + score.alignmentScore) / n;
    this.stats.avgBoostFactor =
      (prevAvgBoost * (n - 1) + score.boostFactor) / n;
  }

  /**
   * Get current statistics
   */
  getStats(): ScorerStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics (useful for testing/batch runs)
   */
  resetStats(): void {
    this.stats = {
      totalSignalsScored: 0,
      recommendationCounts: {
        strong_confirm: 0,
        moderate_confirm: 0,
        weak_confirm: 0,
        conflict: 0,
        insufficient_data: 0,
      },
      avgAlignmentScore: 0,
      avgBoostFactor: 0,
    };
  }
}

// ── Exports ────────────────────────────────────────────────────────────────

export {
  computeEMA,
  computeRSI,
  computeATR,
  computeAvgVolume,
  detectCompression,
};
