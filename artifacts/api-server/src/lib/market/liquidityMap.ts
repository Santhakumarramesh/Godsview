/**
 * liquidityMap.ts — Liquidity zone detection from order book snapshots
 *
 * Phase 3: pure functions that transform raw PriceLevel arrays into
 * structured LiquidityZone arrays and MicrostructureSnapshot.
 *
 * No I/O — all functions are synchronous and side-effect free.
 */

import type { OrderBookSnapshot, LiquidityZone, MicrostructureSnapshot, PriceLevel } from "./types";

// ── Liquidity Zone Detection ───────────────────────────────────────────────

export interface LiquidityZoneParams {
  /**
   * Bucket size as a percentage of mid price (default 0.1 = 0.1%).
   * Levels within this band are merged into one zone.
   */
  bucketPct?:    number;
  /** Only return zones with size >= minSize. Default 0. */
  minSize?:      number;
  /** Max levels to process per side. Default 50. */
  maxLevels?:    number;
  /** Number of top zones to return per side. Default 20. */
  topN?:         number;
}

/**
 * Cluster order book levels into meaningful liquidity zones.
 * Returns ask zones (ascending) and bid zones (descending), both normalised by strength.
 */
export function computeLiquidityZones(
  snapshot: OrderBookSnapshot,
  params:   LiquidityZoneParams = {},
): { bids: LiquidityZone[]; asks: LiquidityZone[] } {
  const {
    bucketPct  = 0.1,
    minSize    = 0,
    maxLevels  = 50,
    topN       = 20,
  } = params;

  const mid = getMid(snapshot);
  if (!mid) return { bids: [], asks: [] };

  const bucket = mid * (bucketPct / 100);

  function clusterLevels(levels: PriceLevel[], side: "bid" | "ask"): LiquidityZone[] {
    const sliced = levels.slice(0, maxLevels);
    const clusters = new Map<number, { total: number; priceMin: number; priceMax: number }>();

    for (const level of sliced) {
      const bucketKey = Math.round(level.price / bucket) * bucket;
      const existing  = clusters.get(bucketKey);
      if (existing) {
        existing.total   += level.size;
        existing.priceMin = Math.min(existing.priceMin, level.price);
        existing.priceMax = Math.max(existing.priceMax, level.price);
      } else {
        clusters.set(bucketKey, { total: level.size, priceMin: level.price, priceMax: level.price });
      }
    }

    let maxSize = 0;
    for (const v of clusters.values()) if (v.total > maxSize) maxSize = v.total;

    const zones: LiquidityZone[] = [];
    for (const [price, c] of clusters) {
      if (c.total < minSize) continue;
      zones.push({
        price,
        priceMin:  c.priceMin,
        priceMax:  c.priceMax,
        size:      Math.round(c.total * 1e8) / 1e8,
        side,
        strength:  maxSize > 0 ? c.total / maxSize : 0,
      });
    }

    // Sort: bids descending (best bid first), asks ascending (best ask first)
    if (side === "bid") zones.sort((a, b) => b.price - a.price);
    else zones.sort((a, b) => a.price - b.price);

    return zones.slice(0, topN);
  }

  return {
    bids: clusterLevels(snapshot.bids, "bid"),
    asks: clusterLevels(snapshot.asks, "ask"),
  };
}

// ── Microstructure Metrics ─────────────────────────────────────────────────

/** Number of top levels used for imbalance calculation */
const IMBALANCE_DEPTH = 10;

/** Threshold for declaring "absorbing" activity */
const ABSORB_THRESHOLD = 0.3;

/**
 * Derive microstructure metrics from a raw snapshot.
 * These are used by Phase 5 reversal detection and Phase 4 heatmap intensity.
 */
export function computeMicrostructure(snapshot: OrderBookSnapshot): MicrostructureSnapshot {
  const bestAsk     = snapshot.asks[0]?.price ?? 0;
  const bestBid     = snapshot.bids[0]?.price ?? 0;
  const spread      = bestAsk - bestBid;
  const mid         = bestAsk && bestBid ? (bestAsk + bestBid) / 2 : bestAsk || bestBid;
  const spreadBps   = mid > 0 ? (spread / mid) * 10_000 : 0;

  const topBids     = snapshot.bids.slice(0, IMBALANCE_DEPTH);
  const topAsks     = snapshot.asks.slice(0, IMBALANCE_DEPTH);
  const topBidVol   = topBids.reduce((s, l) => s + l.size, 0);
  const topAskVol   = topAsks.reduce((s, l) => s + l.size, 0);
  const totalVol    = topBidVol + topAskVol;
  const imbalance   = totalVol > 0 ? (topBidVol - topAskVol) / totalVol : 0;

  return {
    symbol:       snapshot.symbol,
    timestamp:    snapshot.timestamp,
    bestAsk,
    bestBid,
    spread:       Math.round(spread * 100) / 100,
    spreadBps:    Math.round(spreadBps * 10) / 10,
    mid:          Math.round(mid * 100) / 100,
    imbalance:    Math.round(imbalance * 1000) / 1000,
    topBidVolume: Math.round(topBidVol * 1e6) / 1e6,
    topAskVolume: Math.round(topAskVol * 1e6) / 1e6,
    absorbingBid: imbalance >  ABSORB_THRESHOLD,
    absorbingAsk: imbalance < -ABSORB_THRESHOLD,
    snapshot,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getMid(snapshot: OrderBookSnapshot): number | null {
  const bestAsk = snapshot.asks[0]?.price;
  const bestBid = snapshot.bids[0]?.price;
  if (bestAsk && bestBid) return (bestAsk + bestBid) / 2;
  return bestAsk ?? bestBid ?? null;
}

/**
 * Compute cumulative depth at each level (ladder-style).
 * Useful for Phase 4 depth chart rendering.
 */
export function computeDepthCurve(
  levels: PriceLevel[],
  maxLevels = 25,
): Array<{ price: number; size: number; cumulativeSize: number }> {
  const sliced = levels.slice(0, maxLevels);
  let cum = 0;
  return sliced.map((l) => {
    cum += l.size;
    return { price: l.price, size: l.size, cumulativeSize: Math.round(cum * 1e6) / 1e6 };
  });
}
