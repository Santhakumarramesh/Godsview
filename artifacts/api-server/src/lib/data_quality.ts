/**
 * Market Data Quality Validation Module
 * - Timestamp freshness validation
 * - Price sanity bounds checking
 * - Volume anomaly detection
 * - Feed staleness monitoring
 * - Overall data quality scoring (0-100)
 */

import { logger } from "./logger";

// ── Freshness Validation ────────────────────────────────────────

export function isDataFresh(timestamp: number, maxAgeMs: number): boolean {
  const ageMs = Date.now() - timestamp;
  return ageMs <= maxAgeMs && ageMs >= 0;
}

// ── Price Sanity ────────────────────────────────────────────────

export interface PriceSanityResult {
  valid: boolean;
  reason?: string;
}

export function isPriceSane(
  price: number,
  recentPrices: number[]
): PriceSanityResult {
  if (price <= 0) {
    return { valid: false, reason: "Price is zero or negative" };
  }
  if (recentPrices.length < 2) return { valid: true };

  const avgPrice = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
  const variance =
    recentPrices.reduce((sum, p) => sum + Math.pow(p - avgPrice, 2), 0) /
    recentPrices.length;
  const stdDev = Math.sqrt(variance);
  const zScore = Math.abs(price - avgPrice) / (stdDev || 1);

  if (zScore > 5) {
    return {
      valid: false,
      reason: `Price deviation: z-score=${zScore.toFixed(2)} (>5)`,
    };
  }
  return { valid: true };
}

// ── Volume Anomaly ──────────────────────────────────────────────

export interface VolumeAnomalyResult {
  normal: boolean;
  ratio: number;
}

export function isVolumeNormal(
  volume: number,
  avgVolume: number
): VolumeAnomalyResult {
  if (avgVolume <= 0) return { normal: true, ratio: 1.0 };
  const ratio = volume / avgVolume;
  return { normal: ratio <= 3.0, ratio };
}

// ── Feed Staleness Monitor ──────────────────────────────────────

export interface SymbolFeedStatus {
  symbol: string;
  lastSeenMs: number;
  staleIntervalMs: number;
  isStale: boolean;
  isAlive: boolean;
}

export class DataFeedMonitor {
  private lastSeen: Map<string, number> = new Map();
  private warned: Set<string> = new Set();

  constructor(
    private staleMs = 30000,
    private deadMs = 60000
  ) {}

  recordUpdate(symbol: string, timestamp: number = Date.now()): void {
    this.lastSeen.set(symbol, timestamp);
    if (this.warned.has(symbol)) {
      this.warned.delete(symbol);
      logger.info({ symbol }, "Feed resumed");
    }
  }

  getSymbolStatus(symbol: string): SymbolFeedStatus {
    const lastSeen = this.lastSeen.get(symbol) ?? 0;
    const staleIntervalMs = Date.now() - lastSeen;
    return {
      symbol,
      lastSeenMs: lastSeen,
      staleIntervalMs,
      isStale: staleIntervalMs > this.staleMs,
      isAlive: staleIntervalMs <= this.deadMs,
    };
  }

  getAllStatus(): SymbolFeedStatus[] {
    return Array.from(this.lastSeen.keys()).map((symbol) =>
      this.getSymbolStatus(symbol)
    );
  }

  checkAndAlert(): { staleCount: number; deadCount: number } {
    let staleCount = 0,
      deadCount = 0;
    for (const status of this.getAllStatus()) {
      if (status.isAlive && status.isStale && !this.warned.has(status.symbol)) {
        this.warned.add(status.symbol);
        logger.warn({ symbol: status.symbol }, "Feed stale");
        staleCount++;
      } else if (!status.isAlive && !this.warned.has(status.symbol)) {
        this.warned.add(status.symbol);
        logger.error({ symbol: status.symbol }, "Feed dead");
        deadCount++;
      }
    }
    return { staleCount, deadCount };
  }

  getTrackedSymbolCount(): number {
    return this.lastSeen.size;
  }

  reset(symbol?: string): void {
    if (symbol) {
      this.lastSeen.delete(symbol);
      this.warned.delete(symbol);
    } else {
      this.lastSeen.clear();
      this.warned.clear();
    }
  }
}

// ── Data Quality Score ──────────────────────────────────────────

export interface DataQualityScoreResult {
  score: number;
  issues: string[];
}

export interface DataQualityInput {
  timestamp: number;
  price: number;
  volume: number;
  recentPrices: number[];
  avgVolume: number;
}

export function computeDataQualityScore(
  data: DataQualityInput
): DataQualityScoreResult {
  let score = 100;
  const issues: string[] = [];

  if (!isDataFresh(data.timestamp, 30000)) {
    score -= 20;
    issues.push("Data older than 30 seconds");
  }

  const priceCheck = isPriceSane(data.price, data.recentPrices);
  if (!priceCheck.valid) {
    score -= 25;
    issues.push(priceCheck.reason ?? "Price sanity failed");
  }

  const volCheck = isVolumeNormal(data.volume, data.avgVolume);
  if (!volCheck.normal && volCheck.ratio > 3.0) {
    score -= 15;
    issues.push(`Volume spike: ${volCheck.ratio.toFixed(1)}x avg`);
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    issues,
  };
}
