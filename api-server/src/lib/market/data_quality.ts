/**
 * data_quality.ts — Market Data Quality Engine
 *
 * Analyzes OHLCV bars for data integrity issues:
 * - Gap detection (missing candles)
 * - Stale data detection (unchanged prices)
 * - Volume anomalies (abnormal trading activity)
 * - OHLC validity (high >= low, close in range)
 * - Assigns quality score 0-100 to each bar
 *
 * Generates detailed quality reports for diagnosis and monitoring.
 */

import { NormalizedBar } from "./normalized_schema";

/**
 * Quality issue categories
 */
export type QualityIssueSeverity = "info" | "warning" | "error";

export interface QualityIssue {
  severity: QualityIssueSeverity;
  code: string;
  message: string;
  value?: number | string;
}

/**
 * Quality analysis result for a single bar
 */
export interface BarQualityAnalysis {
  symbol: string;
  timestamp: string;
  score: number; // 0-100
  issues: QualityIssue[];
  isValid: boolean; // score >= 70
  metrics: {
    ohlcValidity: boolean;
    volumenonzero: boolean;
    priceReasonable: boolean;
  };
}

/**
 * Quality report for a series of bars
 */
export interface QualityReport {
  symbol: string;
  periodStart: string;
  periodEnd: string;
  barCount: number;
  averageQualityScore: number;
  validBarCount: number;
  validityRate: number; // percentage 0-100
  issues: {
    gapCount: number;
    staleCount: number;
    volumeAnomaliesCount: number;
    ohlcInvalidCount: number;
  };
  generatedAt: string;
}

/**
 * Configuration for quality analysis
 */
export interface QualityConfig {
  stalePriceThresholdMs: number; // how long before data is "stale"
  minVolumePerBar: number; // minimum acceptable volume
  volumeAnomalyMultiplier: number; // 3x = 300% of rolling average
  expectedBarIntervalMs: number; // e.g., 60000 for 1-minute bars
  allowableGapMs: number; // max acceptable gap before alerting
}

/**
 * Default quality configuration
 */
const DEFAULT_CONFIG: QualityConfig = {
  stalePriceThresholdMs: 300_000, // 5 minutes
  minVolumePerBar: 0,
  volumeAnomalyMultiplier: 3.0,
  expectedBarIntervalMs: 60_000, // 1 minute
  allowableGapMs: 120_000, // allow up to 2 minute gap
};

/**
 * Validate OHLC invariants: high >= low, close within range
 */
function validateOhlc(bar: NormalizedBar): { valid: boolean; issues: QualityIssue[] } {
  const issues: QualityIssue[] = [];

  if (bar.high < bar.low) {
    issues.push({
      severity: "error",
      code: "OHLC_HIGH_LT_LOW",
      message: `High (${bar.high}) is less than low (${bar.low})`,
    });
  }

  if (bar.close > bar.high) {
    issues.push({
      severity: "error",
      code: "OHLC_CLOSE_GT_HIGH",
      message: `Close (${bar.close}) exceeds high (${bar.high})`,
      value: bar.close - bar.high,
    });
  }

  if (bar.close < bar.low) {
    issues.push({
      severity: "error",
      code: "OHLC_CLOSE_LT_LOW",
      message: `Close (${bar.close}) is below low (${bar.low})`,
      value: bar.low - bar.close,
    });
  }

  if (bar.open > bar.high || bar.open < bar.low) {
    issues.push({
      severity: "error",
      code: "OHLC_OPEN_OUT_OF_RANGE",
      message: `Open (${bar.open}) is outside [${bar.low}, ${bar.high}]`,
    });
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Check if volume is reasonable (non-zero and not suspiciously small)
 */
function validateVolume(bar: NormalizedBar, config: QualityConfig): QualityIssue[] {
  const issues: QualityIssue[] = [];

  if (bar.volume < 0) {
    issues.push({
      severity: "error",
      code: "VOLUME_NEGATIVE",
      message: `Volume is negative: ${bar.volume}`,
    });
  }

  if (bar.volume === 0) {
    issues.push({
      severity: "warning",
      code: "VOLUME_ZERO",
      message: "Volume is zero",
    });
  }

  if (bar.volume < config.minVolumePerBar && bar.volume > 0) {
    issues.push({
      severity: "info",
      code: "VOLUME_BELOW_MINIMUM",
      message: `Volume ${bar.volume} below minimum ${config.minVolumePerBar}`,
    });
  }

  return issues;
}

/**
 * Detect gaps in timestamp sequence (missing candles)
 */
function detectGaps(
  bars: NormalizedBar[],
  config: QualityConfig,
): Array<{ barIndex: number; prevBar: NormalizedBar; currentBar: NormalizedBar; gapMs: number }> {
  const gaps: Array<{
    barIndex: number;
    prevBar: NormalizedBar;
    currentBar: NormalizedBar;
    gapMs: number;
  }> = [];

  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1];
    const current = bars[i];

    const prevTime = new Date(prev.timestamp).getTime();
    const currentTime = new Date(current.timestamp).getTime();
    const expectedGap = config.expectedBarIntervalMs;
    const actualGap = currentTime - prevTime;

    if (actualGap > expectedGap + config.allowableGapMs) {
      gaps.push({ barIndex: i, prevBar: prev, currentBar: current, gapMs: actualGap });
    }
  }

  return gaps;
}

/**
 * Detect stale (unchanging) price data
 */
function detectStaleData(
  bars: NormalizedBar[],
  config: QualityConfig,
): Array<{ barIndex: number; bar: NormalizedBar }> {
  const stale: Array<{ barIndex: number; bar: NormalizedBar }> = [];

  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1];
    const current = bars[i];

    // Check if OHLC haven't changed at all
    if (
      prev.open === current.open &&
      prev.high === current.high &&
      prev.low === current.low &&
      prev.close === current.close
    ) {
      const prevTime = new Date(prev.timestamp).getTime();
      const currentTime = new Date(current.timestamp).getTime();

      if (currentTime - prevTime > config.stalePriceThresholdMs) {
        stale.push({ barIndex: i, bar: current });
      }
    }
  }

  return stale;
}

/**
 * Detect volume anomalies using rolling average
 */
function detectVolumeAnomalies(
  bars: NormalizedBar[],
  config: QualityConfig,
  windowSize: number = 20,
): Array<{ barIndex: number; bar: NormalizedBar; ratio: number }> {
  const anomalies: Array<{ barIndex: number; bar: NormalizedBar; ratio: number }> = [];

  for (let i = Math.max(windowSize, 1); i < bars.length; i++) {
    const window = bars.slice(i - windowSize, i);
    const avgVolume =
      window.reduce((sum, b) => sum + b.volume, 0) / window.length;

    const current = bars[i];
    const ratio = avgVolume > 0 ? current.volume / avgVolume : 1;

    if (ratio > config.volumeAnomalyMultiplier) {
      anomalies.push({ barIndex: i, bar: current, ratio });
    }
  }

  return anomalies;
}

/**
 * Analyze a single bar's quality
 */
export function analyzeBarQuality(
  bar: NormalizedBar,
  config: QualityConfig = DEFAULT_CONFIG,
): BarQualityAnalysis {
  const issues: QualityIssue[] = [];

  // OHLC validation
  const ohlcResult = validateOhlc(bar);
  issues.push(...ohlcResult.issues);

  const ohlcValidity = ohlcResult.valid;

  // Volume validation
  const volumeIssues = validateVolume(bar, config);
  issues.push(...volumeIssues);

  const volumenonzero = bar.volume > 0;

  // Check price reasonableness (not NaN, finite)
  let priceReasonable = true;
  if (!Number.isFinite(bar.open) || !Number.isFinite(bar.high) ||
      !Number.isFinite(bar.low) || !Number.isFinite(bar.close)) {
    priceReasonable = false;
    issues.push({
      severity: "error",
      code: "PRICE_NOT_FINITE",
      message: "One or more prices are NaN or infinite",
    });
  }

  // Calculate quality score
  let score = 100;
  for (const issue of issues) {
    if (issue.severity === "error") score -= 25;
    else if (issue.severity === "warning") score -= 10;
    else if (issue.severity === "info") score -= 5;
  }
  score = Math.max(0, Math.min(100, score));

  return {
    symbol: bar.symbol,
    timestamp: bar.timestamp,
    score,
    issues,
    isValid: score >= 70,
    metrics: {
      ohlcValidity,
      volumenonzero,
      priceReasonable,
    },
  };
}

/**
 * Analyze a series of bars and generate a quality report
 */
export function analyzeSeriesQuality(
  bars: NormalizedBar[],
  config: QualityConfig = DEFAULT_CONFIG,
): QualityReport {
  if (bars.length === 0) {
    return {
      symbol: "",
      periodStart: "",
      periodEnd: "",
      barCount: 0,
      averageQualityScore: 0,
      validBarCount: 0,
      validityRate: 0,
      issues: {
        gapCount: 0,
        staleCount: 0,
        volumeAnomaliesCount: 0,
        ohlcInvalidCount: 0,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  // Analyze each bar
  const analyses = bars.map(bar => analyzeBarQuality(bar, config));

  const symbol = bars[0].symbol;
  const periodStart = bars[0].timestamp;
  const periodEnd = bars[bars.length - 1].timestamp;
  const barCount = bars.length;

  // Calculate aggregates
  const totalScore = analyses.reduce((sum, a) => sum + a.score, 0);
  const averageQualityScore = totalScore / barCount;
  const validBarCount = analyses.filter(a => a.isValid).length;
  const validityRate = (validBarCount / barCount) * 100;

  // Count issues
  const gaps = detectGaps(bars, config);
  const stale = detectStaleData(bars, config);
  const volumeAnomalies = detectVolumeAnomalies(bars, config);
  const ohlcInvalid = analyses.filter(a => !a.metrics.ohlcValidity).length;

  return {
    symbol,
    periodStart,
    periodEnd,
    barCount,
    averageQualityScore,
    validBarCount,
    validityRate,
    issues: {
      gapCount: gaps.length,
      staleCount: stale.length,
      volumeAnomaliesCount: volumeAnomalies.length,
      ohlcInvalidCount: ohlcInvalid,
    },
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Generate a human-readable quality report string
 */
export function formatQualityReport(report: QualityReport): string {
  const lines: string[] = [
    "=== DATA QUALITY REPORT ===",
    `Symbol: ${report.symbol}`,
    `Period: ${report.periodStart} → ${report.periodEnd}`,
    `Bars Analyzed: ${report.barCount}`,
    `Average Quality Score: ${report.averageQualityScore.toFixed(1)}/100`,
    `Valid Bars: ${report.validBarCount}/${report.barCount} (${report.validityRate.toFixed(1)}%)`,
    "",
    "Issues Found:",
    `  - Gaps: ${report.issues.gapCount}`,
    `  - Stale Data: ${report.issues.staleCount}`,
    `  - Volume Anomalies: ${report.issues.volumeAnomaliesCount}`,
    `  - OHLC Invalid: ${report.issues.ohlcInvalidCount}`,
    `Generated: ${report.generatedAt}`,
  ];

  return lines.join("\n");
}

/**
 * Export configuration management
 */
export function createQualityConfig(overrides?: Partial<QualityConfig>): QualityConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

export function getDefaultQualityConfig(): QualityConfig {
  return DEFAULT_CONFIG;
}