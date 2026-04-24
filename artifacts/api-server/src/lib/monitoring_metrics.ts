import { logger } from './logger';

/**
 * Time window for metrics aggregation (in milliseconds)
 */
const METRICS_WINDOW_MS = 60000; // 1 minute

/**
 * Metric snapshot containing aggregated data over a time window
 */
export interface MetricSnapshot {
  name: string;
  type: 'counter' | 'gauge' | 'histogram';
  value: number;
  count: number;
  min?: number;
  max?: number;
  avg?: number;
  p95?: number;
  p99?: number;
  timestamp: number;
}

/**
 * System metrics summary for monitoring
 */
export interface SystemMetricsSummary {
  signalsPerMinute: number;
  tradesPerDay: number;
  dailyPnL: number;
  avgLatencyMs: number;
  errorRate: number;
  timestamp: number;
}

/**
 * SLO objective definition
 */
export interface SLOObjective {
  name: string;
  target: number;
  actual: number;
  met: boolean;
  description: string;
}

/**
 * Internal metric data storage
 */
interface InternalMetric {
  type: 'counter' | 'gauge' | 'histogram';
  values: number[];
  timestamp: number;
  windowStart: number;
}

/**
 * MetricsCollector: In-memory metrics collection with time window support
 */
export class MetricsCollector {
  private metrics = new Map<string, InternalMetric>();
  private customMetrics = new Set<string>();

  /**
   * Increment a counter metric
   */
  increment(metric: string, value: number = 1): void {
    this._updateMetric(metric, 'counter', value);
  }

  /**
   * Set a gauge metric (instantaneous value)
   */
  gauge(metric: string, value: number): void {
    this._updateMetric(metric, 'gauge', value);
  }

  /**
   * Record a histogram value (latency, distribution)
   */
  histogram(metric: string, value: number): void {
    this._updateMetric(metric, 'histogram', value);
  }

  /**
   * Get all metrics with snapshots
   */
  getMetrics(): Record<string, MetricSnapshot> {
    const result: Record<string, MetricSnapshot> = {};

    for (const [name, internal] of this.metrics.entries()) {
      const snapshot = this._computeSnapshot(name, internal);
      result[name] = snapshot;
    }

    return result;
  }

  /**
   * Get a summary of system metrics
   */
  getSummary(): SystemMetricsSummary {
    const metrics = this.getMetrics();

    return {
      signalsPerMinute: metrics['signals_per_minute']?.value || 0,
      tradesPerDay: metrics['trades_per_day']?.value || 0,
      dailyPnL: metrics['daily_pnl']?.value || 0,
      avgLatencyMs: metrics['avg_latency_ms']?.avg || 0,
      errorRate: metrics['error_rate']?.value || 0,
      timestamp: Date.now(),
    };
  }

  /**
   * Register a custom metric name for tracking
   */
  registerCustomMetric(metricName: string): void {
    this.customMetrics.add(metricName);
    logger.debug(`Custom metric registered: ${metricName}`);
  }

  /**
   * Reset all metrics (useful for testing)
   */
  reset(): void {
    this.metrics.clear();
    logger.debug('All metrics reset');
  }

  /**
   * Internal: Update a metric with value
   */
  private _updateMetric(
    metric: string,
    type: 'counter' | 'gauge' | 'histogram',
    value: number
  ): void {
    const now = Date.now();
    let internal = this.metrics.get(metric);

    if (!internal) {
      internal = {
        type,
        values: [],
        timestamp: now,
        windowStart: now,
      };
      this.metrics.set(metric, internal);
    }

    // Reset if window expired
    if (now - internal.windowStart > METRICS_WINDOW_MS) {
      internal.values = [];
      internal.windowStart = now;
    }

    internal.values.push(value);
    internal.timestamp = now;
  }

  /**
   * Internal: Compute snapshot from internal metric
   */
  private _computeSnapshot(
    name: string,
    internal: InternalMetric
  ): MetricSnapshot {
    const values = internal.values;
    const count = values.length;

    let value = 0;
    let min: number | undefined;
    let max: number | undefined;
    let avg: number | undefined;
    let p95: number | undefined;
    let p99: number | undefined;

    if (count > 0) {
      if (internal.type === 'counter') {
        value = values.reduce((a, b) => a + b, 0);
      } else if (internal.type === 'gauge') {
        value = values[values.length - 1];
      } else if (internal.type === 'histogram') {
        const sorted = [...values].sort((a, b) => a - b);
        min = sorted[0];
        max = sorted[count - 1];
        avg = values.reduce((a, b) => a + b, 0) / count;
        p95 = sorted[Math.floor(count * 0.95)];
        p99 = sorted[Math.floor(count * 0.99)];
        value = avg;
      }
    }

    return {
      name,
      type: internal.type,
      value,
      count,
      min,
      max,
      avg,
      p95,
      p99,
      timestamp: internal.timestamp,
    };
  }
}

/**
 * Global metrics instance
 */
export const metrics = new MetricsCollector();

/**
 * Track operation latency
 */
export function trackLatency(operation: string, durationMs: number): void {
  const metricName = `latency_${operation}_ms`;
  metrics.histogram(metricName, durationMs);

  if (durationMs > 5000) {
    logger.warn(`Slow operation: ${operation} took ${durationMs}ms`);
  }
}

/**
 * Track operation errors
 */
export function trackError(operation: string, error: string): void {
  const metricName = `errors_${operation}`;
  metrics.increment(metricName);

  logger.error(`Error in ${operation}: ${error}`);
}

/**
 * Get SLO status
 */
export function getSLOStatus(): { met: boolean; objectives: SLOObjective[] } {
  const summary = metrics.getSummary();

  const objectives: SLOObjective[] = [
    {
      name: 'Average Latency',
      target: 100,
      actual: summary.avgLatencyMs,
      met: summary.avgLatencyMs <= 100,
      description: 'Average API latency should be under 100ms',
    },
    {
      name: 'Error Rate',
      target: 1,
      actual: summary.errorRate,
      met: summary.errorRate < 1,
      description: 'Error rate should be under 1%',
    },
    {
      name: 'Trades Per Day',
      target: 1,
      actual: summary.tradesPerDay,
      met: summary.tradesPerDay >= 1,
      description: 'Should execute at least 1 trade per day',
    },
  ];

  const met = objectives.every((obj) => obj.met);

  logger.debug('SLO status evaluated', {
    met,
    objectives: objectives.map((o) => ({ name: o.name, met: o.met })),
  });

  return { met, objectives };
}
