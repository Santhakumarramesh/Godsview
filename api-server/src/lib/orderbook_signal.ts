/**
 * Orderbook Signal Extractor — Converts live orderbook state into
 * numerical features that feed into Super Intelligence scoring.
 *
 * Bridges the gap between "we have a live orderbook" and "SI uses it."
 *
 * Features extracted:
 * 1. Bid/ask imbalance ratio (-1 to +1)
 * 2. Spread as % of mid price
 * 3. Liquidity wall proximity (distance to nearest large level)
 * 4. Depth pressure score (weighted by proximity to mid)
 * 5. Top-of-book size ratio
 */

import type { OrderBookSnapshot, PriceLevel } from "./market/types";

export interface OrderbookFeatures {
  /** Bid/ask imbalance: +1 = all bids, -1 = all asks, 0 = balanced */
  imbalance: number;
  /** Spread as percentage of mid price */
  spread_pct: number;
  /** Distance to nearest liquidity wall (as % of mid) */
  wall_distance_pct: number;
  /** Wall side: "bid" if support wall closer, "ask" if resistance */
  wall_side: "bid" | "ask" | "none";
  /** Depth-weighted pressure: positive = buy pressure */
  depth_pressure: number;
  /** Top-of-book size ratio: bid_size / (bid_size + ask_size) */
  top_of_book_ratio: number;
  /** Composite score (0-1): higher = more bullish orderbook */
  bullish_score: number;
}
const WALL_THRESHOLD_MULTIPLIER = 3; // A level is a "wall" if size > 3× average

/**
 * Extract trading-relevant features from an orderbook snapshot.
 */
export function extractOrderbookFeatures(
  snapshot: OrderBookSnapshot | null | undefined,
): OrderbookFeatures {
  // Default neutral values if no orderbook
  if (!snapshot || !snapshot.bids?.length || !snapshot.asks?.length) {
    return {
      imbalance: 0,
      spread_pct: 0,
      wall_distance_pct: Infinity,
      wall_side: "none",
      depth_pressure: 0,
      top_of_book_ratio: 0.5,
      bullish_score: 0.5,
    };
  }

  const bids = snapshot.bids;
  const asks = snapshot.asks;
  const bestBid = bids[0].price;
  const bestAsk = asks[0].price;
  const mid = (bestBid + bestAsk) / 2;

  // 1. Spread
  const spread_pct = mid > 0 ? (bestAsk - bestBid) / mid : 0;

  // 2. Total volume each side (top 20 levels)
  const bidLevels = bids.slice(0, 20);
  const askLevels = asks.slice(0, 20);  const totalBidSize = bidLevels.reduce((s, l) => s + l.size, 0);
  const totalAskSize = askLevels.reduce((s, l) => s + l.size, 0);
  const totalSize = totalBidSize + totalAskSize;

  // 3. Imbalance (-1 to +1)
  const imbalance = totalSize > 0
    ? (totalBidSize - totalAskSize) / totalSize
    : 0;

  // 4. Top-of-book ratio
  const topBidSize = bids[0].size;
  const topAskSize = asks[0].size;
  const topTotal = topBidSize + topAskSize;
  const top_of_book_ratio = topTotal > 0 ? topBidSize / topTotal : 0.5;

  // 5. Depth-weighted pressure (closer levels weighted more)
  let bidPressure = 0, askPressure = 0;
  for (const level of bidLevels) {
    const dist = Math.abs(mid - level.price) / mid;
    const weight = Math.max(0, 1 - dist * 100); // Decay with distance
    bidPressure += level.size * weight;
  }
  for (const level of askLevels) {
    const dist = Math.abs(level.price - mid) / mid;
    const weight = Math.max(0, 1 - dist * 100);
    askPressure += level.size * weight;
  }
  const totalPressure = bidPressure + askPressure;
  const depth_pressure = totalPressure > 0
    ? (bidPressure - askPressure) / totalPressure
    : 0;
  // 6. Liquidity wall detection
  const allLevels = [...bidLevels, ...askLevels];
  const avgSize = totalSize / allLevels.length;
  const wallThreshold = avgSize * WALL_THRESHOLD_MULTIPLIER;

  let nearestWallDist = Infinity;
  let wall_side: "bid" | "ask" | "none" = "none";

  for (const level of bidLevels) {
    if (level.size >= wallThreshold) {
      const dist = (mid - level.price) / mid;
      if (dist < nearestWallDist) {
        nearestWallDist = dist;
        wall_side = "bid";
      }
      break; // Only care about nearest
    }
  }
  for (const level of askLevels) {
    if (level.size >= wallThreshold) {
      const dist = (level.price - mid) / mid;
      if (dist < nearestWallDist) {
        nearestWallDist = dist;
        wall_side = "ask";
      }
      break;
    }
  }

  // 7. Composite bullish score (0-1)
  // Weighted combination of all signals
  const bullish_score = Math.max(0, Math.min(1,
    0.5 +                           // Neutral base    imbalance * 0.25 +              // Imbalance contributes ±0.25
    depth_pressure * 0.15 +         // Depth pressure contributes ±0.15
    (top_of_book_ratio - 0.5) * 0.1 // Top-of-book contributes ±0.05
  ));

  return {
    imbalance,
    spread_pct,
    wall_distance_pct: nearestWallDist === Infinity ? 999 : nearestWallDist,
    wall_side,
    depth_pressure,
    top_of_book_ratio,
    bullish_score,
  };
}

/**
 * Convert orderbook features into an order_flow adjustment factor.
 * Returns a multiplier (0.8 - 1.2) that can scale the order_flow_score.
 *
 * - Direction-aligned orderbook = boost (up to 1.2×)
 * - Direction-opposed orderbook = penalize (down to 0.8×)
 * - Neutral = 1.0× (no change)
 */
export function orderbookAdjustment(
  features: OrderbookFeatures,
  direction: "long" | "short",
): number {
  // How aligned is the orderbook with our direction?
  const alignment = direction === "long"
    ? features.bullish_score - 0.5  // Positive = bullish alignment
    : 0.5 - features.bullish_score; // Positive = bearish alignment

  // Scale to 0.8 - 1.2 range
  return 1.0 + alignment * 0.4;
}