/**
 * Data Quality Routes
 * - GET /health    — Overall data feed health summary
 * - GET /feeds     — Per-symbol feed status (fresh/stale/dead)
 * - GET /quality   — Data quality scores
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  DataFeedMonitor,
  computeDataQualityScore,
  isDataFresh,
  isPriceSane,
  isVolumeNormal,
  type DataQualityInput,
} from "../lib/data_quality";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Global feed monitor instance
const feedMonitor = new DataFeedMonitor(30000, 60000);

// Store for recent price/volume data (keyed by symbol)
const priceHistory: Map<string, number[]> = new Map();
const volumeHistory: Map<string, number> = new Map();

const MAX_PRICE_HISTORY = 10;

/**
 * Record market data for monitoring
 * Call this from market data routes to track feed freshness
 */
export function recordMarketData(
  symbol: string,
  price: number,
  volume: number
): void {
  // Record feed activity
  feedMonitor.recordUpdate(symbol, Date.now());

  // Track price history
  if (!priceHistory.has(symbol)) {
    priceHistory.set(symbol, []);
  }
  const prices = priceHistory.get(symbol)!;
  prices.push(price);
  if (prices.length > MAX_PRICE_HISTORY) {
    prices.shift();
  }

  // Track average volume
  volumeHistory.set(symbol, volume);
}

/**
 * Get data quality input for a symbol
 */
function getQualityInput(
  symbol: string,
  timestamp: number,
  price: number,
  volume: number
): DataQualityInput {
  const recentPrices = priceHistory.get(symbol) ?? [];
  const avgVolume = volumeHistory.get(symbol) ?? volume;

  return {
    timestamp,
    price,
    volume,
    recentPrices,
    avgVolume,
  };
}

// ── Health Summary ──────────────────────────────────────────────

router.get("/health", (_req: Request, res: Response) => {
  const allFeeds = feedMonitor.getAllStatus();
  const freshFeeds = allFeeds.filter((f) => !f.isStale).length;
  const staleFeeds = allFeeds.filter((f) => f.isStale && f.isAlive).length;
  const deadFeeds = allFeeds.filter((f) => !f.isAlive).length;

  const alerts = feedMonitor.checkAndAlert();

  const overallHealth =
    deadFeeds === 0 && staleFeeds <= 2
      ? "healthy"
      : deadFeeds > 0
        ? "critical"
        : "degraded";

  res.json({
    timestamp: Date.now(),
    health: overallHealth,
    feeds: {
      tracked: feedMonitor.getTrackedSymbolCount(),
      fresh: freshFeeds,
      stale: staleFeeds,
      dead: deadFeeds,
    },
    recentAlerts: {
      newStale: alerts.staleCount,
      newDead: alerts.deadCount,
    },
  });
});

// ── Per-Symbol Feed Status ──────────────────────────────────────

router.get("/feeds", (_req: Request, res: Response) => {
  const allFeeds = feedMonitor.getAllStatus();

  const grouped = {
    fresh: allFeeds.filter((f) => !f.isStale),
    stale: allFeeds.filter((f) => f.isStale && f.isAlive),
    dead: allFeeds.filter((f) => !f.isAlive),
  };

  res.json({
    timestamp: Date.now(),
    summary: {
      fresh: grouped.fresh.length,
      stale: grouped.stale.length,
      dead: grouped.dead.length,
    },
    feeds: grouped,
  });
});

// ── Data Quality Scores ─────────────────────────────────────────

router.get("/quality", (_req: Request, res: Response) => {
  const scores: Record<
    string,
    { score: number; freshness: boolean; price: boolean; volume: boolean }
  > = {};

  for (const [symbol, prices] of priceHistory.entries()) {
    if (prices.length === 0) continue;

    const lastPrice = prices[prices.length - 1];
    const avgVolume = volumeHistory.get(symbol) ?? 0;
    const timestamp = feedMonitor.getSymbolStatus(symbol).lastSeenMs;

    const qualityInput = getQualityInput(symbol, timestamp, lastPrice, avgVolume);
    const qualityResult = computeDataQualityScore(qualityInput);

    const freshCheck = isDataFresh(timestamp, 30000);
    const priceCheck = isPriceSane(lastPrice, prices);
    const volumeCheck = isVolumeNormal(avgVolume, avgVolume);

    scores[symbol] = {
      score: qualityResult.score,
      freshness: freshCheck,
      price: priceCheck.valid,
      volume: volumeCheck.normal,
    };
  }

  const avgScore =
    Object.values(scores).length > 0
      ? Math.round(
          Object.values(scores).reduce((sum, s) => sum + s.score, 0) /
            Object.values(scores).length
        )
      : 100;

  res.json({
    timestamp: Date.now(),
    overall: avgScore,
    bySymbol: scores,
  });
});

/**
 * Export feed monitor for external integration
 * (Use recordMarketData function above to update it)
 */
export function getFeedMonitor() {
  return feedMonitor;
}

export default router;
