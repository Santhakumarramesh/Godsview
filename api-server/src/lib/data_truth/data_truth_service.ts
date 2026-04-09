/**
 * Data Truth + Latency Observability Service — Phase 29
 *
 * Tracks:
 * - TimestampChain: Feed, ingest, decision, order, broker ack, fill timestamps
 * - LatencyMetrics: Computed from chain (market data lag, decision latency, routing latency, fill latency)
 * - DataQualityCheck: Stale candles, missing ticks, crossed values, outlier spikes, feed silence
 * - DataTruthScore: Symbol-level data health (0-1), degradation status, quality results, latency metrics
 *
 * All data is in-memory with a _clearAll() for testing.
 */

import { randomUUID } from "crypto";
import { logger } from "../logger";

// ── Types ─────────────────────────────────────────────

/**
 * Timestamp chain tracks a complete decision-to-execution lifecycle
 */
export interface TimestampChain {
  feed_ts?: Date;           // Market data timestamp from feed
  ingest_ts?: Date;         // When data was ingested by system
  decision_ts?: Date;       // When trade decision was made
  order_submit_ts?: Date;   // When order was submitted
  broker_ack_ts?: Date;     // When broker acknowledged order
  fill_ts?: Date;           // When order was filled
}

/**
 * Latency metrics computed from timestamp chain (all in milliseconds)
 */
export interface LatencyMetrics {
  market_data_lag_ms?: number;      // ingest_ts - feed_ts
  decision_latency_ms?: number;     // decision_ts - ingest_ts
  order_routing_latency_ms?: number; // broker_ack_ts - order_submit_ts
  fill_latency_ms?: number;         // fill_ts - broker_ack_ts
}

/**
 * Individual quality check result
 */
export interface QualityCheckResult {
  check_name: "stale_candles" | "missing_ticks" | "crossed_values" | "outlier_spikes" | "feed_silence";
  passed: boolean;
  severity?: "warning" | "error";
  message?: string;
}

/**
 * Data quality check results for a symbol
 */
export interface DataQualityCheck {
  symbol: string;
  checks: QualityCheckResult[];
  all_passed: boolean;
  timestamp: Date;
}

/**
 * Degradation status indicates health of market data
 */
export type DegradationStatus = "healthy" | "degraded" | "critical" | "offline";

/**
 * Data truth score combines quality checks, latency, and historical degradation
 */
export interface DataTruthScore {
  score_id: string;
  symbol: string;
  session_id: string;
  truth_score: number;           // 0-1 score
  degradation_status: DegradationStatus;
  quality_checks: DataQualityCheck;
  latency_metrics: LatencyMetrics;
  timestamp_chain: TimestampChain;
  computed_at: Date;
}

/**
 * Summary of all current truth scores and system health
 */
export interface DataTruthSummary {
  total_symbols: number;
  healthy_count: number;
  degraded_count: number;
  critical_count: number;
  offline_count: number;
  avg_truth_score: number;
  latest_scores: DataTruthScore[];
}

// ── In-Memory Stores ─────────────────────────────────

// timestamp_chain_id -> TimestampChain
const timestampChains = new Map<string, TimestampChain>();

// symbol -> latest DataTruthScore
const truthScoresBySymbol = new Map<string, DataTruthScore>();

// score_id -> DataTruthScore (for history)
const truthScoresById = new Map<string, DataTruthScore>();

// symbol -> [timestamps of quality checks]
const qualityCheckHistory = new Map<string, Date[]>();

// ── Helpers ──────────────────────────────────────────

function generateScoreId(): string {
  return `dt_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/**
 * Compute latency metrics from a timestamp chain
 */
export function computeLatencyMetrics(chain: TimestampChain): LatencyMetrics {
  const metrics: LatencyMetrics = {};

  if (chain.feed_ts && chain.ingest_ts) {
    metrics.market_data_lag_ms = chain.ingest_ts.getTime() - chain.feed_ts.getTime();
  }

  if (chain.ingest_ts && chain.decision_ts) {
    metrics.decision_latency_ms = chain.decision_ts.getTime() - chain.ingest_ts.getTime();
  }

  if (chain.order_submit_ts && chain.broker_ack_ts) {
    metrics.order_routing_latency_ms = chain.broker_ack_ts.getTime() - chain.order_submit_ts.getTime();
  }

  if (chain.broker_ack_ts && chain.fill_ts) {
    metrics.fill_latency_ms = chain.fill_ts.getTime() - chain.broker_ack_ts.getTime();
  }

  return metrics;
}

/**
 * Run quality checks on market data candles
 */
export function runQualityChecks(
  symbol: string,
  candles: Array<{ open: number; high: number; low: number; close: number; volume: number; timestamp: Date }>
): DataQualityCheck {
  const checks: QualityCheckResult[] = [];

  // Check 1: Stale candles (candle timestamp > 5 minutes old)
  const staleThreshold = 5 * 60 * 1000; // 5 minutes
  const now = new Date();
  const hasStale =
    candles.length > 0 &&
    now.getTime() - Math.max(...candles.map((c) => c.timestamp.getTime())) > staleThreshold;

  checks.push({
    check_name: "stale_candles",
    passed: !hasStale,
    severity: hasStale ? "warning" : undefined,
    message: hasStale ? "Latest candle is older than 5 minutes" : undefined,
  });

  // Check 2: Missing ticks (gaps in timestamp sequence)
  let hasMissingTicks = false;
  if (candles.length > 1) {
    for (let i = 1; i < candles.length; i++) {
      const gap = candles[i].timestamp.getTime() - candles[i - 1].timestamp.getTime();
      // Assume 1-min candles; gap > 1.5 min = missing
      if (gap > 90 * 1000) {
        hasMissingTicks = true;
        break;
      }
    }
  }

  checks.push({
    check_name: "missing_ticks",
    passed: !hasMissingTicks,
    severity: hasMissingTicks ? "warning" : undefined,
    message: hasMissingTicks ? "Detected gaps in candle timestamps" : undefined,
  });

  // Check 3: Crossed values (high < low or low > high)
  let hasCrossed = false;
  for (const candle of candles) {
    if (candle.high < candle.low) {
      hasCrossed = true;
      break;
    }
  }

  checks.push({
    check_name: "crossed_values",
    passed: !hasCrossed,
    severity: hasCrossed ? "error" : undefined,
    message: hasCrossed ? "Found candles with high < low" : undefined,
  });

  // Check 4: Outlier spikes (close price > 20% different from open)
  let hasOutliers = false;
  for (const candle of candles) {
    const priceChange = Math.abs(candle.close - candle.open) / candle.open;
    if (priceChange > 0.2) {
      // More than 20% move in one candle
      hasOutliers = true;
      break;
    }
  }

  checks.push({
    check_name: "outlier_spikes",
    passed: !hasOutliers,
    severity: hasOutliers ? "warning" : undefined,
    message: hasOutliers ? "Detected price movement > 20% in single candle" : undefined,
  });

  // Check 5: Feed silence (no new candles in > 5 minutes)
  const feedSilent = candles.length === 0 || now.getTime() - Math.max(...candles.map((c) => c.timestamp.getTime())) > staleThreshold;

  checks.push({
    check_name: "feed_silence",
    passed: !feedSilent,
    severity: feedSilent ? "error" : undefined,
    message: feedSilent ? "No market data received in the last 5 minutes" : undefined,
  });

  const result: DataQualityCheck = {
    symbol,
    checks,
    all_passed: checks.every((c) => c.passed),
    timestamp: now,
  };

  // Record quality check history
  if (!qualityCheckHistory.has(symbol)) {
    qualityCheckHistory.set(symbol, []);
  }
  qualityCheckHistory.get(symbol)!.push(now);

  return result;
}

/**
 * Compute overall truth score for a symbol based on quality and latency
 */
export function computeTruthScore(
  symbol: string,
  session_id: string,
  qualityCheck: DataQualityCheck,
  latencies: LatencyMetrics,
  timestampChain: TimestampChain
): DataTruthScore {
  let score = 1.0; // Start at perfect

  // Quality checks: each failed check reduces score by 0.15
  const failedChecks = qualityCheck.checks.filter((c) => !c.passed);
  score -= failedChecks.length * 0.15;

  // Latency penalties
  if (latencies.market_data_lag_ms) {
    // Penalize if lag > 100ms
    if (latencies.market_data_lag_ms > 100) {
      score -= 0.05;
    }
  }

  if (latencies.decision_latency_ms) {
    // Penalize if decision takes > 50ms
    if (latencies.decision_latency_ms > 50) {
      score -= 0.05;
    }
  }

  if (latencies.order_routing_latency_ms) {
    // Penalize if routing > 200ms
    if (latencies.order_routing_latency_ms > 200) {
      score -= 0.1;
    }
  }

  // Clamp score to [0, 1]
  score = Math.max(0, Math.min(1, score));

  // Determine degradation status
  let degradationStatus: DegradationStatus;
  if (score >= 0.8) {
    degradationStatus = "healthy";
  } else if (score >= 0.6) {
    degradationStatus = "degraded";
  } else if (score >= 0.3) {
    degradationStatus = "critical";
  } else {
    degradationStatus = "offline";
  }

  // Check for feed silence from quality checks
  const feedSilentCheck = qualityCheck.checks.find((c) => c.check_name === "feed_silence");
  if (feedSilentCheck && !feedSilentCheck.passed) {
    degradationStatus = "offline";
  }

  const scoreObj: DataTruthScore = {
    score_id: generateScoreId(),
    symbol,
    session_id,
    truth_score: score,
    degradation_status: degradationStatus,
    quality_checks: qualityCheck,
    latency_metrics: latencies,
    timestamp_chain: timestampChain,
    computed_at: new Date(),
  };

  truthScoresById.set(scoreObj.score_id, scoreObj);
  truthScoresBySymbol.set(symbol, scoreObj);

  logger.info(`Truth score computed for ${symbol}: ${score.toFixed(3)} (${degradationStatus})`);

  return scoreObj;
}

/**
 * Record a timestamp in a chain (creates or updates)
 */
export function recordTimestampChain(chainId: string, updates: Partial<TimestampChain>): TimestampChain {
  const existing = timestampChains.get(chainId) || {};
  const updated = { ...existing, ...updates };
  timestampChains.set(chainId, updated);
  return updated;
}

/**
 * Get a timestamp chain by ID
 */
export function getTimestampChain(chainId: string): TimestampChain | undefined {
  return timestampChains.get(chainId);
}

/**
 * Get the latest truth score for a symbol
 */
export function getTruthScore(symbol: string): DataTruthScore | undefined {
  return truthScoresBySymbol.get(symbol);
}

/**
 * Get truth scores for multiple symbols
 */
export function getTruthScoresBySymbol(symbols: string[]): Map<string, DataTruthScore> {
  const result = new Map<string, DataTruthScore>();
  for (const symbol of symbols) {
    const score = truthScoresBySymbol.get(symbol);
    if (score) {
      result.set(symbol, score);
    }
  }
  return result;
}

/**
 * Get latest truth scores (all symbols, most recent)
 */
export function getLatestTruthScores(limit: number = 100): DataTruthScore[] {
  return Array.from(truthScoresBySymbol.values())
    .sort((a, b) => b.computed_at.getTime() - a.computed_at.getTime())
    .slice(0, limit);
}

/**
 * Get symbols with degraded data health
 */
export function getDegradedSymbols(): string[] {
  const degraded: string[] = [];
  for (const [symbol, score] of truthScoresBySymbol.entries()) {
    if (score.degradation_status !== "healthy") {
      degraded.push(symbol);
    }
  }
  return degraded;
}

/**
 * Generate a summary of data truth across all symbols
 */
export function getDataTruthSummary(): DataTruthSummary {
  const allScores = Array.from(truthScoresBySymbol.values());

  let healthy = 0;
  let degraded = 0;
  let critical = 0;
  let offline = 0;

  for (const score of allScores) {
    switch (score.degradation_status) {
      case "healthy":
        healthy++;
        break;
      case "degraded":
        degraded++;
        break;
      case "critical":
        critical++;
        break;
      case "offline":
        offline++;
        break;
    }
  }

  const avgScore =
    allScores.length > 0
      ? allScores.reduce((sum, s) => sum + s.truth_score, 0) / allScores.length
      : 1.0;

  return {
    total_symbols: allScores.length,
    healthy_count: healthy,
    degraded_count: degraded,
    critical_count: critical,
    offline_count: offline,
    avg_truth_score: avgScore,
    latest_scores: allScores.slice(0, 20),
  };
}

/**
 * Clear all data (for testing)
 */
export function _clearAll(): void {
  timestampChains.clear();
  truthScoresBySymbol.clear();
  truthScoresById.clear();
  qualityCheckHistory.clear();
  logger.debug("Data truth service cleared");
}
