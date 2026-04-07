import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

export interface AnomalyConfig {
  zScoreThreshold?: number;
  ewmaSpan?: number;
  minSamples?: number;
  detectionMethods?: ('z_score' | 'ewma' | 'iqr' | 'isolation' | 'rate_of_change')[];
}

export interface MetricStream {
  name: string;
  values: number[];
  timestamps: string[];
  mean: number;
  stdDev: number;
  ewma: number;
  lastValue: number;
}

export interface Anomaly {
  id: string;
  metricName: string;
  value: number;
  expected: number;
  deviation: number;
  zScore: number;
  method: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  detectedAt: string;
  context: Record<string, unknown>;
}

export interface AnomalyReport {
  totalAnomalies: number;
  bySeverity: Record<string, number>;
  byMetric: Record<string, number>;
  byMethod: Record<string, number>;
  recentAnomalies: Anomaly[];
  systemHealth: number;
  monitoredMetrics: number;
  lastScan: string;
}

export interface DetectionResult {
  isAnomaly: boolean;
  zScore: number;
  method: string;
  confidence: number;
}

export class AnomalyDetector extends EventEmitter {
  private config: Required<AnomalyConfig>;
  private streams: Map<string, MetricStream>;
  private anomalies: Anomaly[];
  private metricThresholds: Map<string, number>;

  constructor(config: AnomalyConfig = {}) {
    super();
    this.config = {
      zScoreThreshold: config.zScoreThreshold ?? 2.5,
      ewmaSpan: config.ewmaSpan ?? 20,
      minSamples: config.minSamples ?? 30,
      detectionMethods: config.detectionMethods ?? [
        'z_score',
        'ewma',
        'iqr',
        'isolation',
        'rate_of_change',
      ],
    };
    this.streams = new Map();
    this.anomalies = [];
    this.metricThresholds = new Map();

    this.initializeMetrics();
  }

  private initializeMetrics(): void {
    const defaultMetrics = [
      'latency',
      'fill_rate',
      'slippage',
      'drawdown',
      'win_rate',
      'pnl',
      'volume',
      'spread',
      'order_reject_rate',
      'position_concentration',
    ];

    defaultMetrics.forEach((metric) => {
      this.streams.set(metric, {
        name: metric,
        values: [],
        timestamps: [],
        mean: 0,
        stdDev: 0,
        ewma: 0,
        lastValue: 0,
      });
    });
  }

  addSample(metricName: string, value: number, timestamp?: string): Anomaly | null {
    const ts = timestamp || new Date().toISOString();
    let stream = this.streams.get(metricName);

    if (!stream) {
      stream = {
        name: metricName,
        values: [],
        timestamps: [],
        mean: 0,
        stdDev: 0,
        ewma: 0,
        lastValue: 0,
      };
      this.streams.set(metricName, stream);
    }

    stream.values.push(value);
    stream.timestamps.push(ts);
    stream.lastValue = value;

    this.updateStreamStats(stream);

    if (stream.values.length < this.config.minSamples) {
      return null;
    }

    const anomaly = this.detectAnomaly(metricName, value, ts);

    if (anomaly) {
      this.anomalies.push(anomaly);
      this.emit('anomaly:detected', anomaly);

      if (anomaly.severity === 'critical') {
        this.emit('anomaly:critical', anomaly);
      }
    }

    return anomaly;
  }

  addSamples(metricName: string, values: number[]): Anomaly[] {
    const detected: Anomaly[] = [];

    values.forEach((value) => {
      const anomaly = this.addSample(metricName, value);
      if (anomaly) {
        detected.push(anomaly);
      }
    });

    return detected;
  }

  getMetricStream(name: string): MetricStream | undefined {
    return this.streams.get(name);
  }

  getAnomalies(filters?: {
    metric?: string;
    severity?: string;
    method?: string;
    limit?: number;
  }): Anomaly[] {
    let results = [...this.anomalies];

    if (filters?.metric) {
      results = results.filter((a) => a.metricName === filters.metric);
    }

    if (filters?.severity) {
      results = results.filter((a) => a.severity === filters.severity);
    }

    if (filters?.method) {
      results = results.filter((a) => a.method === filters.method);
    }

    if (filters?.limit) {
      results = results.slice(-filters.limit);
    }

    return results;
  }

  getReport(): AnomalyReport {
    const bySeverity: Record<string, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };
    const byMetric: Record<string, number> = {};
    const byMethod: Record<string, number> = {};

    this.anomalies.forEach((anomaly) => {
      bySeverity[anomaly.severity]++;
      byMetric[anomaly.metricName] = (byMetric[anomaly.metricName] ?? 0) + 1;
      byMethod[anomaly.method] = (byMethod[anomaly.method] ?? 0) + 1;
    });

    const systemHealth = this.calculateSystemHealth();

    return {
      totalAnomalies: this.anomalies.length,
      bySeverity,
      byMetric,
      byMethod,
      recentAnomalies: this.anomalies.slice(-10),
      systemHealth,
      monitoredMetrics: this.streams.size,
      lastScan: new Date().toISOString(),
    };
  }

  scanAll(): Anomaly[] {
    const detected: Anomaly[] = [];

    this.streams.forEach((stream) => {
      if (stream.values.length >= this.config.minSamples) {
        const anomaly = this.detectAnomaly(
          stream.name,
          stream.lastValue,
          stream.timestamps[stream.timestamps.length - 1],
        );

        if (anomaly) {
          detected.push(anomaly);
        }
      }
    });

    return detected;
  }

  getMonitoredMetrics(): string[] {
    return Array.from(this.streams.keys());
  }

  setThreshold(metricName: string, threshold: number): void {
    this.metricThresholds.set(metricName, threshold);
  }

  reset(metricName?: string): void {
    if (metricName) {
      const stream = this.streams.get(metricName);
      if (stream) {
        stream.values = [];
        stream.timestamps = [];
        stream.mean = 0;
        stream.stdDev = 0;
        stream.ewma = 0;
        stream.lastValue = 0;
      }
    } else {
      this.streams.forEach((stream) => {
        stream.values = [];
        stream.timestamps = [];
        stream.mean = 0;
        stream.stdDev = 0;
        stream.ewma = 0;
        stream.lastValue = 0;
      });
      this.anomalies = [];
    }
  }

  private updateStreamStats(stream: MetricStream): void {
    const values = stream.values;

    if (values.length === 0) return;

    stream.mean = values.reduce((a, b) => a + b, 0) / values.length;

    const variance =
      values.reduce((sum, val) => sum + Math.pow(val - stream.mean, 2), 0) /
      values.length;
    stream.stdDev = Math.sqrt(variance);

    const alpha = 2 / (this.config.ewmaSpan + 1);
    stream.ewma = values[0];
    for (let i = 1; i < values.length; i++) {
      stream.ewma = alpha * values[i] + (1 - alpha) * stream.ewma;
    }
  }

  private detectAnomaly(
    metricName: string,
    value: number,
    timestamp: string,
  ): Anomaly | null {
    const stream = this.streams.get(metricName)!;

    const results: { method: string; isAnomaly: boolean; zScore: number; confidence: number }[] =
      [];

    if (this.config.detectionMethods.includes('z_score')) {
      const zScoreResult = this.detectZScore(value, stream);
      results.push({
        method: 'z_score',
        isAnomaly: zScoreResult.isAnomaly,
        zScore: zScoreResult.zScore,
        confidence: zScoreResult.confidence,
      });
    }

    if (this.config.detectionMethods.includes('ewma')) {
      const ewmaResult = this.detectEWMA(value, stream);
      results.push({
        method: 'ewma',
        isAnomaly: ewmaResult.isAnomaly,
        zScore: ewmaResult.zScore,
        confidence: ewmaResult.confidence,
      });
    }

    if (this.config.detectionMethods.includes('iqr')) {
      const iqrResult = this.detectIQR(value, stream);
      results.push({
        method: 'iqr',
        isAnomaly: iqrResult.isAnomaly,
        zScore: iqrResult.zScore,
        confidence: iqrResult.confidence,
      });
    }

    if (this.config.detectionMethods.includes('isolation')) {
      const isolationResult = this.detectIsolation(value, stream);
      results.push({
        method: 'isolation',
        isAnomaly: isolationResult.isAnomaly,
        zScore: isolationResult.zScore,
        confidence: isolationResult.confidence,
      });
    }

    if (this.config.detectionMethods.includes('rate_of_change')) {
      const rocResult = this.detectRateOfChange(value, stream);
      results.push({
        method: 'rate_of_change',
        isAnomaly: rocResult.isAnomaly,
        zScore: rocResult.zScore,
        confidence: rocResult.confidence,
      });
    }

    const detectedResults = results.filter((r) => r.isAnomaly);

    if (detectedResults.length === 0) {
      return null;
    }

    const primaryResult = detectedResults[0];
    const zScore = Math.abs(primaryResult.zScore);
    const severity = this.calculateSeverity(zScore);

    const anomaly: Anomaly = {
      id: randomUUID(),
      metricName,
      value,
      expected: stream.mean,
      deviation: value - stream.mean,
      zScore,
      method: primaryResult.method,
      severity,
      description: this.generateDescription(metricName, value, stream, primaryResult.method),
      detectedAt: timestamp,
      context: {
        mean: stream.mean,
        stdDev: stream.stdDev,
        ewma: stream.ewma,
        methodsTriggered: detectedResults.map((r) => r.method),
      },
    };

    this.emit('metric:baseline-updated', {
      metric: metricName,
      newMean: stream.mean,
      newStdDev: stream.stdDev,
    });

    return anomaly;
  }

  private detectZScore(
    value: number,
    stream: MetricStream,
  ): { isAnomaly: boolean; zScore: number; confidence: number } {
    if (stream.stdDev === 0) {
      return { isAnomaly: false, zScore: 0, confidence: 0 };
    }

    const zScore = (value - stream.mean) / stream.stdDev;
    const isAnomaly = Math.abs(zScore) > this.config.zScoreThreshold;
    const confidence = Math.min(1, Math.abs(zScore) / (this.config.zScoreThreshold * 2));

    return { isAnomaly, zScore, confidence };
  }

  private detectEWMA(
    value: number,
    stream: MetricStream,
  ): { isAnomaly: boolean; zScore: number; confidence: number } {
    const deviation = Math.abs(value - stream.ewma);
    const threshold = this.config.zScoreThreshold * stream.stdDev;

    if (stream.stdDev === 0) {
      return { isAnomaly: false, zScore: 0, confidence: 0 };
    }

    const zScore = deviation / stream.stdDev;
    const isAnomaly = deviation > threshold;
    const confidence = Math.min(1, zScore / (this.config.zScoreThreshold * 2));

    return { isAnomaly, zScore, confidence };
  }

  private detectIQR(
    value: number,
    stream: MetricStream,
  ): { isAnomaly: boolean; zScore: number; confidence: number } {
    const sorted = [...stream.values].sort((a, b) => a - b);
    const q1Idx = Math.floor(sorted.length * 0.25);
    const q3Idx = Math.floor(sorted.length * 0.75);

    const q1 = sorted[q1Idx];
    const q3 = sorted[q3Idx];
    const iqr = q3 - q1;

    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;

    const isAnomaly = value < lowerBound || value > upperBound;

    const zScore = stream.stdDev > 0 ? (value - stream.mean) / stream.stdDev : 0;
    const confidence = isAnomaly ? 0.8 : 0;

    return { isAnomaly, zScore, confidence };
  }

  private detectIsolation(
    value: number,
    stream: MetricStream,
  ): { isAnomaly: boolean; zScore: number; confidence: number } {
    if (stream.values.length < 2) {
      return { isAnomaly: false, zScore: 0, confidence: 0 };
    }

    const distances = stream.values.map((v) => Math.abs(v - value));
    const sortedDistances = distances.sort((a, b) => a - b);

    const nearestDistance = sortedDistances[1];
    const threshold = 3 * stream.stdDev;

    const isAnomaly = nearestDistance > threshold;
    const zScore = stream.stdDev > 0 ? nearestDistance / stream.stdDev : 0;
    const confidence = isAnomaly ? 0.7 : 0;

    return { isAnomaly, zScore, confidence };
  }

  private detectRateOfChange(
    value: number,
    stream: MetricStream,
  ): { isAnomaly: boolean; zScore: number; confidence: number } {
    if (stream.values.length < 2) {
      return { isAnomaly: false, zScore: 0, confidence: 0 };
    }

    const lastValue = stream.values[stream.values.length - 1];
    const delta = Math.abs(value - lastValue);

    const recentValues = stream.values.slice(-Math.min(10, stream.values.length));
    const recentDeltas = [];
    for (let i = 1; i < recentValues.length; i++) {
      recentDeltas.push(Math.abs(recentValues[i] - recentValues[i - 1]));
    }

    const avgDelta = recentDeltas.reduce((a, b) => a + b, 0) / recentDeltas.length || 1;
    const threshold = this.config.zScoreThreshold * avgDelta;

    const isAnomaly = delta > threshold;
    const zScore = delta / (avgDelta || 1);
    const confidence = Math.min(1, zScore / (this.config.zScoreThreshold * 2));

    return { isAnomaly, zScore, confidence };
  }

  private calculateSeverity(
    zScore: number,
  ): 'low' | 'medium' | 'high' | 'critical' {
    if (zScore > 5) return 'critical';
    if (zScore > 4) return 'high';
    if (zScore > 3) return 'medium';
    return 'low';
  }

  private generateDescription(
    metricName: string,
    value: number,
    stream: MetricStream,
    method: string,
  ): string {
    const deviation = value - stream.mean;
    const deviationPct = ((deviation / stream.mean) * 100).toFixed(2);

    return `${method}: ${metricName} deviated ${deviationPct}% from baseline (value: ${value.toFixed(2)}, expected: ${stream.mean.toFixed(2)})`;
  }

  private calculateSystemHealth(): number {
    if (this.anomalies.length === 0) {
      return 100;
    }

    const recentAnomalies = this.anomalies.slice(-100);
    const severityWeights = { low: 1, medium: 3, high: 7, critical: 15 };

    const totalWeight = recentAnomalies.reduce(
      (sum, a) => sum + severityWeights[a.severity],
      0,
    );

    const maxPossibleWeight = 100 * severityWeights.critical;
    const healthScore = Math.max(0, 100 - (totalWeight / maxPossibleWeight) * 100);

    return Math.round(healthScore);
  }
}

export default AnomalyDetector;
