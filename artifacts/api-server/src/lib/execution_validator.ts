import { Database } from "better-sqlite3";
import {
  executionValidations,
  slippageDistributions,
  executionDriftEvents,
  type ExecutionValidation,
  type SlippageDistribution,
  type ExecutionDriftEvent,
} from "../schema/execution_validation.js";
import { eq, and, gte, lte, desc, sql } from "@workspace/db";

// ============================================================================
// Types
// ============================================================================

export interface Order {
  uuid: string;
  strategyId: string;
  symbol: string;
  side: "buy" | "sell";
  expectedPrice: number;
  expectedQty: number;
  timestamp: Date;
}

export interface Fill {
  orderUuid: string;
  actualPrice: number;
  actualQty: number;
  venue: string;
  timestamp: Date;
}

export interface ExecutionValidationRecord {
  orderUuid: string;
  strategyId: string;
  symbol: string;
  side: "buy" | "sell";
  expectedPrice: number;
  actualPrice: number;
  expectedQty: number;
  actualQty: number;
  slippageBps: number;
  latencyMs: number;
  fillQualityScore: number;
  venue: string;
  validatedAt: Date;
  metadata: Record<string, unknown>;
}

export interface SlippageStats {
  strategyId: string;
  symbol: string;
  sampleCount: number;
  meanSlippageBps: number;
  medianSlippageBps: number;
  p95SlippageBps: number;
  p99SlippageBps: number;
  stdDevBps: number;
  favorablePct: number;
  periodStart: Date;
  periodEnd: Date;
}

export interface DriftEvent {
  strategyId: string;
  driftType:
    | "slippage_spike"
    | "latency_spike"
    | "fill_rate_drop"
    | "venue_degradation";
  severity: "info" | "warning" | "critical";
  observedValue: number;
  expectedRangeLow: number;
  expectedRangeHigh: number;
  details: Record<string, unknown>;
  detectedAt: Date;
}

export type DriftStatus = "clean" | "warning" | "critical";

export interface ExecutionReport {
  strategyId: string;
  reportedAt: Date;
  periodStart: Date;
  periodEnd: Date;
  totalFills: number;
  averageSlippageBps: number;
  p95SlippageBps: number;
  p99SlippageBps: number;
  averageLatencyMs: number;
  fillCompletionRate: number;
  driftStatus: DriftStatus;
  recentDriftEvents: DriftEvent[];
  backtestAssumedSlippageBps: number;
  backtestVsLiveDivergence: number;
  fillQualityScore: number;
  venues: Record<string, number>;
  symbols: Record<string, SlippageStats>;
}

// ============================================================================
// ExecutionValidator
// ============================================================================

export class ExecutionValidator {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Validates a fill against expected order parameters.
   * Computes slippage, latency, and fill quality score.
   */
  validateFill(order: Order, fill: Fill): ExecutionValidationRecord {
    const latencyMs = Math.round(
      fill.timestamp.getTime() - order.timestamp.getTime()
    );

    const slippageBps = this.computeSlippage(order, fill);
    const fillCompleteness =
      Math.min(fill.actualQty, order.expectedQty) / order.expectedQty;

    // Fill quality score = weighted combination
    // Slippage: 40%, Latency: 30%, Completeness: 30%
    const slippageScore = Math.max(0, 1 - Math.abs(slippageBps) / 100);
    const latencyScore = Math.max(0, 1 - latencyMs / 5000);
    const completenessScore = fillCompleteness;

    const fillQualityScore =
      slippageScore * 0.4 + latencyScore * 0.3 + completenessScore * 0.3;

    const validation: ExecutionValidationRecord = {
      orderUuid: order.uuid,
      strategyId: order.strategyId,
      symbol: order.symbol,
      side: order.side,
      expectedPrice: order.expectedPrice,
      actualPrice: fill.actualPrice,
      expectedQty: order.expectedQty,
      actualQty: fill.actualQty,
      slippageBps,
      latencyMs,
      fillQualityScore: Math.max(0, Math.min(1, fillQualityScore)),
      venue: fill.venue,
      validatedAt: new Date(),
      metadata: {
        slippageBreakdown: {
          slippageBps,
          slippageScore,
        },
        latencyBreakdown: {
          latencyMs,
          latencyScore,
        },
        completenessBreakdown: {
          fillCompleteness,
          completenessScore,
        },
      },
    };

    return validation;
  }

  /**
   * Computes slippage in basis points.
   * For buys: (actual - expected) / expected * 10000
   * For sells: (expected - actual) / expected * 10000
   * Positive = favorable, Negative = unfavorable
   */
  private computeSlippage(order: Order, fill: Fill): number {
    if (order.side === "buy") {
      return ((order.expectedPrice - fill.actualPrice) / order.expectedPrice) *
        10000 <
        0
        ? Math.max(
            -10000,
            ((order.expectedPrice - fill.actualPrice) /
              order.expectedPrice) *
              10000
          )
        : Math.min(
            10000,
            ((order.expectedPrice - fill.actualPrice) /
              order.expectedPrice) *
              10000
          );
    } else {
      return ((fill.actualPrice - order.expectedPrice) /
        order.expectedPrice) *
        10000 <
        0
        ? Math.max(
            -10000,
            ((fill.actualPrice - order.expectedPrice) /
              order.expectedPrice) *
              10000
          )
        : Math.min(
            10000,
            ((fill.actualPrice - order.expectedPrice) /
              order.expectedPrice) *
              10000
          );
    }
  }
}

// ============================================================================
// SlippageAnalyzer
// ============================================================================

export class SlippageAnalyzer {
  private db: Database;
  private rollingWindows: Map<
    string,
    { timestamp: Date; slippageBps: number }[]
  > = new Map();

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Records a slippage observation in the rolling window (24-hour memory).
   */
  recordSlippage(
    strategyId: string,
    symbol: string,
    slippageBps: number
  ): void {
    const key = `${strategyId}:${symbol}`;
    if (!this.rollingWindows.has(key)) {
      this.rollingWindows.set(key, []);
    }

    const window = this.rollingWindows.get(key)!;
    const now = new Date();
    window.push({ timestamp: now, slippageBps });

    // Remove entries older than 24 hours
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    while (window.length > 0 && window[0].timestamp < cutoff) {
      window.shift();
    }
  }

  /**
   * Computes slippage distribution statistics for a period.
   */
  computeDistribution(
    strategyId: string,
    symbol: string,
    periodDays: number = 7
  ): SlippageStats | null {
    const periodEnd = new Date();
    const periodStart = new Date(
      periodEnd.getTime() - periodDays * 24 * 60 * 60 * 1000
    );

    // Query from database
    const query = `
      SELECT slippage_bps FROM execution_validations
      WHERE strategy_id = ? AND symbol = ?
        AND validated_at >= ? AND validated_at < ?
      ORDER BY slippage_bps ASC
    `;

    const stmt = this.db.prepare(query);
    const rows = stmt.all(
      strategyId,
      symbol,
      periodStart.toISOString(),
      periodEnd.toISOString()
    ) as { slippage_bps: number }[];

    if (rows.length === 0) {
      return null;
    }

    const slippages = rows.map((r) => r.slippage_bps);
    const mean = slippages.reduce((a, b) => a + b, 0) / slippages.length;
    const median = this.percentile(slippages, 50);
    const p95 = this.percentile(slippages, 95);
    const p99 = this.percentile(slippages, 99);

    const variance =
      slippages.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) /
      slippages.length;
    const stdDev = Math.sqrt(variance);

    const favorableCount = slippages.filter((s) => s > 0).length;
    const favorablePct = (favorableCount / slippages.length) * 100;

    return {
      strategyId,
      symbol,
      sampleCount: slippages.length,
      meanSlippageBps: mean,
      medianSlippageBps: median,
      p95SlippageBps: p95,
      p99SlippageBps: p99,
      stdDevBps: stdDev,
      favorablePct,
      periodStart,
      periodEnd,
    };
  }

  /**
   * Checks if slippage is within acceptable bounds.
   */
  isSlippageAcceptable(
    strategyId: string,
    threshold: number = 10
  ): boolean {
    const query = `
      SELECT AVG(CAST(p95_slippage_bps AS FLOAT)) as avg_p95
      FROM slippage_distributions
      WHERE strategy_id = ?
        AND computed_at >= ?
      LIMIT 100
    `;

    const stmt = this.db.prepare(query);
    const result = stmt.get(
      strategyId,
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    ) as { avg_p95: number | null };

    if (!result || result.avg_p95 === null) {
      return true;
    }

    return result.avg_p95 <= threshold;
  }

  /**
   * Compares assumed slippage from backtest vs actual live slippage.
   */
  compareBacktestVsLive(
    strategyId: string,
    backtestAssumedSlippageBps: number
  ): { divergence: number; status: "aligned" | "diverging" } {
    const query = `
      SELECT AVG(CAST(mean_slippage_bps AS FLOAT)) as avg_live
      FROM slippage_distributions
      WHERE strategy_id = ?
        AND computed_at >= ?
      LIMIT 100
    `;

    const stmt = this.db.prepare(query);
    const result = stmt.get(
      strategyId,
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    ) as { avg_live: number | null };

    const liveSlippageBps = result?.avg_live ?? 0;
    const divergence =
      Math.abs(liveSlippageBps - backtestAssumedSlippageBps) /
      Math.max(1, Math.abs(backtestAssumedSlippageBps));

    return {
      divergence: divergence * 100,
      status: divergence > 0.2 ? "diverging" : "aligned",
    };
  }

  /**
   * Helper: compute percentile from sorted array.
   */
  private percentile(arr: number[], p: number): number {
    const index = (p / 100) * (arr.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index % 1;

    if (lower === upper) {
      return arr[lower];
    }

    return arr[lower] * (1 - weight) + arr[upper] * weight;
  }
}

// ============================================================================
// ExecutionDriftDetector
// ============================================================================

export class ExecutionDriftDetector {
  private db: Database;
  private strategyMetrics: Map<
    string,
    {
      slippages: number[];
      latencies: number[];
      fillRates: number[];
      lastUpdated: Date;
    }
  > = new Map();

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Records execution metrics for drift detection.
   */
  recordMetrics(
    strategyId: string,
    slippageBps: number,
    latencyMs: number,
    fillRate: number
  ): void {
    if (!this.strategyMetrics.has(strategyId)) {
      this.strategyMetrics.set(strategyId, {
        slippages: [],
        latencies: [],
        fillRates: [],
        lastUpdated: new Date(),
      });
    }

    const metrics = this.strategyMetrics.get(strategyId)!;
    metrics.slippages.push(slippageBps);
    metrics.latencies.push(latencyMs);
    metrics.fillRates.push(fillRate);
    metrics.lastUpdated = new Date();

    // Keep only last 100 samples
    if (metrics.slippages.length > 100) {
      metrics.slippages.shift();
      metrics.latencies.shift();
      metrics.fillRates.shift();
    }
  }

  /**
   * Detects various types of execution drift.
   */
  detectDrift(strategyId: string): DriftEvent[] {
    const events: DriftEvent[] = [];

    const metrics = this.strategyMetrics.get(strategyId);
    if (!metrics || metrics.slippages.length < 10) {
      return events;
    }

    // Slippage spike detection
    const slippageEvents = this.detectSlippageSpike(strategyId, metrics);
    events.push(...slippageEvents);

    // Latency spike detection
    const latencyEvents = this.detectLatencySpike(strategyId, metrics);
    events.push(...latencyEvents);

    // Fill rate drop detection
    const fillRateEvents = this.detectFillRateDrop(strategyId, metrics);
    events.push(...fillRateEvents);

    return events;
  }

  /**
   * Detects slippage spikes (> 2 stddev from mean).
   */
  private detectSlippageSpike(
    strategyId: string,
    metrics: {
      slippages: number[];
      latencies: number[];
      fillRates: number[];
      lastUpdated: Date;
    }
  ): DriftEvent[] {
    const events: DriftEvent[] = [];
    const slippages = metrics.slippages;

    if (slippages.length < 10) {
      return events;
    }

    const mean =
      slippages.reduce((a, b) => a + b, 0) / slippages.length;
    const variance =
      slippages.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) /
      slippages.length;
    const stdDev = Math.sqrt(variance);

    const recent = slippages.slice(-5);
    const recentMean =
      recent.reduce((a, b) => a + b, 0) / recent.length;

    const deviation = Math.abs(recentMean - mean) / stdDev;

    if (deviation > 2) {
      const severity =
        deviation > 3 ? "critical" : deviation > 2 ? "warning" : "info";

      events.push({
        strategyId,
        driftType: "slippage_spike",
        severity: severity as "info" | "warning" | "critical",
        observedValue: recentMean,
        expectedRangeLow: mean - 2 * stdDev,
        expectedRangeHigh: mean + 2 * stdDev,
        details: {
          currentMean: recentMean,
          historicalMean: mean,
          stdDev,
          deviation,
        },
        detectedAt: new Date(),
      });
    }

    return events;
  }

  /**
   * Detects latency spikes (> 3x baseline).
   */
  private detectLatencySpike(
    strategyId: string,
    metrics: {
      slippages: number[];
      latencies: number[];
      fillRates: number[];
      lastUpdated: Date;
    }
  ): DriftEvent[] {
    const events: DriftEvent[] = [];
    const latencies = metrics.latencies;

    if (latencies.length < 10) {
      return events;
    }

    const mean =
      latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const recent = latencies.slice(-5);
    const recentMean =
      recent.reduce((a, b) => a + b, 0) / recent.length;

    if (recentMean > mean * 3) {
      events.push({
        strategyId,
        driftType: "latency_spike",
        severity: recentMean > mean * 4 ? "critical" : "warning",
        observedValue: recentMean,
        expectedRangeLow: 0,
        expectedRangeHigh: mean * 3,
        details: {
          currentMean: recentMean,
          historicalMean: mean,
          ratio: recentMean / mean,
        },
        detectedAt: new Date(),
      });
    }

    return events;
  }

  /**
   * Detects fill rate drops (< 90%).
   */
  private detectFillRateDrop(
    strategyId: string,
    metrics: {
      slippages: number[];
      latencies: number[];
      fillRates: number[];
      lastUpdated: Date;
    }
  ): DriftEvent[] {
    const events: DriftEvent[] = [];
    const fillRates = metrics.fillRates;

    if (fillRates.length < 10) {
      return events;
    }

    const recent = fillRates.slice(-10);
    const recentMean =
      recent.reduce((a, b) => a + b, 0) / recent.length;

    if (recentMean < 0.9) {
      events.push({
        strategyId,
        driftType: "fill_rate_drop",
        severity: recentMean < 0.75 ? "critical" : "warning",
        observedValue: recentMean * 100,
        expectedRangeLow: 90,
        expectedRangeHigh: 100,
        details: {
          fillRate: recentMean * 100,
        },
        detectedAt: new Date(),
      });
    }

    return events;
  }

  /**
   * Returns overall drift status for a strategy.
   */
  getDriftStatus(strategyId: string): DriftStatus {
    const query = `
      SELECT MAX(severity) as max_severity
      FROM execution_drift_events
      WHERE strategy_id = ?
        AND detected_at >= ?
      LIMIT 100
    `;

    const stmt = this.db.prepare(query);
    const result = stmt.get(
      strategyId,
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    ) as { max_severity: string | null };

    if (!result || !result.max_severity) {
      return "clean";
    }

    const severity = result.max_severity;
    if (severity === "critical") return "critical";
    if (severity === "warning") return "warning";
    return "clean";
  }
}

// ============================================================================
// ExecutionFeedbackLoop
// ============================================================================

export class ExecutionFeedbackLoop {
  private db: Database;
  private validator: ExecutionValidator;
  private analyzer: SlippageAnalyzer;
  private detector: ExecutionDriftDetector;

  constructor(
    db: Database,
    validator: ExecutionValidator,
    analyzer: SlippageAnalyzer,
    detector: ExecutionDriftDetector
  ) {
    this.db = db;
    this.validator = validator;
    this.analyzer = analyzer;
    this.detector = detector;
  }

  /**
   * Gets comprehensive execution quality report for a strategy.
   */
  getExecutionReport(
    strategyId: string,
    backtestAssumedSlippageBps: number = 0
  ): ExecutionReport {
    const periodEnd = new Date();
    const periodStart = new Date(
      periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000
    );

    // Get all fills in period
    const query = `
      SELECT
        symbol,
        side,
        slippage_bps,
        latency_ms,
        fill_quality_score,
        venue,
        expected_qty,
        actual_qty
      FROM execution_validations
      WHERE strategy_id = ?
        AND validated_at >= ?
        AND validated_at < ?
      ORDER BY validated_at DESC
    `;

    const stmt = this.db.prepare(query);
    const fills = stmt.all(
      strategyId,
      periodStart.toISOString(),
      periodEnd.toISOString()
    ) as Array<{
      symbol: string;
      side: string;
      slippage_bps: number;
      latency_ms: number;
      fill_quality_score: number;
      venue: string;
      expected_qty: number;
      actual_qty: number;
    }>;

    const totalFills = fills.length;
    const averageSlippageBps =
      fills.length > 0
        ? fills.reduce((sum, f) => sum + f.slippage_bps, 0) / fills.length
        : 0;
    const p95SlippageBps =
      fills.length > 0
        ? this.percentile(
            fills.map((f) => f.slippage_bps),
            95
          )
        : 0;
    const p99SlippageBps =
      fills.length > 0
        ? this.percentile(
            fills.map((f) => f.slippage_bps),
            99
          )
        : 0;
    const averageLatencyMs =
      fills.length > 0
        ? fills.reduce((sum, f) => sum + f.latency_ms, 0) / fills.length
        : 0;
    const fillCompletionRate =
      fills.length > 0
        ? fills.reduce(
            (sum, f) =>
              sum +
              Math.min(f.actual_qty, f.expected_qty) / f.expected_qty,
            0
          ) / fills.length
        : 0;
    const fillQualityScore =
      fills.length > 0
        ? fills.reduce((sum, f) => sum + f.fill_quality_score, 0) /
          fills.length
        : 0;

    // Get recent drift events
    const driftQuery = `
      SELECT
        drift_type,
        severity,
        observed_value,
        expected_range_low,
        expected_range_high,
        details,
        detected_at
      FROM execution_drift_events
      WHERE strategy_id = ?
        AND detected_at >= ?
      ORDER BY detected_at DESC
      LIMIT 20
    `;

    const driftStmt = this.db.prepare(driftQuery);
    const driftRows = driftStmt.all(
      strategyId,
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    ) as Array<{
      drift_type: string;
      severity: string;
      observed_value: number;
      expected_range_low: number;
      expected_range_high: number;
      details: Record<string, unknown>;
      detected_at: string;
    }>;

    const recentDriftEvents = driftRows.map((r) => ({
      strategyId,
      driftType: r.drift_type as DriftEvent["driftType"],
      severity: r.severity as "info" | "warning" | "critical",
      observedValue: r.observed_value,
      expectedRangeLow: r.expected_range_low,
      expectedRangeHigh: r.expected_range_high,
      details: r.details,
      detectedAt: new Date(r.detected_at),
    }));

    // Backtest vs live comparison
    const comparison = this.analyzer.compareBacktestVsLive(
      strategyId,
      backtestAssumedSlippageBps
    );

    // Aggregate by venue and symbol
    const venues: Record<string, number> = {};
    const symbols: Record<string, SlippageStats> = {};

    for (const fill of fills) {
      venues[fill.venue] = (venues[fill.venue] ?? 0) + 1;
    }

    const uniqueSymbols = [...new Set(fills.map((f) => f.symbol))];
    for (const symbol of uniqueSymbols) {
      const dist = this.analyzer.computeDistribution(strategyId, symbol, 7);
      if (dist) {
        symbols[symbol] = dist;
      }
    }

    return {
      strategyId,
      reportedAt: new Date(),
      periodStart,
      periodEnd,
      totalFills,
      averageSlippageBps,
      p95SlippageBps,
      p99SlippageBps,
      averageLatencyMs,
      fillCompletionRate,
      driftStatus: this.detector.getDriftStatus(strategyId),
      recentDriftEvents,
      backtestAssumedSlippageBps,
      backtestVsLiveDivergence: comparison.divergence,
      fillQualityScore,
      venues,
      symbols,
    };
  }

  /**
   * Helper: compute percentile from array.
   */
  private percentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index % 1;

    if (lower === upper) {
      return sorted[lower];
    }

    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }
}
