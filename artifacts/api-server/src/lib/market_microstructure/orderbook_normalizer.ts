import type { OrderBookSnapshot, PriceLevel } from "../market/types";
import type { NormalizedOrderBook, NormalizedOrderBookLevel } from "./microstructure_types";

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toNormalizedLevels(levels: PriceLevel[], depth: number): NormalizedOrderBookLevel[] {
  const sliced = levels.slice(0, depth);
  const normalized: NormalizedOrderBookLevel[] = [];
  let cumulative = 0;

  for (const level of sliced) {
    const size = Number.isFinite(level.size) ? Math.max(0, level.size) : 0;
    const price = Number.isFinite(level.price) ? Math.max(0, level.price) : 0;
    cumulative += size;
    normalized.push({
      price: round(price, 8),
      size: round(size, 8),
      cumulative_size: round(cumulative, 8),
      notional_usd: round(price * size, 6),
    });
  }

  return normalized;
}

export function normalizeOrderbookSnapshot(
  snapshot: OrderBookSnapshot,
  depth = 40,
): NormalizedOrderBook {
  const cappedDepth = Math.max(5, Math.min(200, Math.round(depth)));
  const bidLevels = toNormalizedLevels(snapshot.bids, cappedDepth);
  const askLevels = toNormalizedLevels(snapshot.asks, cappedDepth);

  const bestBid = bidLevels[0]?.price ?? null;
  const bestAsk = askLevels[0]?.price ?? null;
  const mid = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : (bestBid ?? bestAsk ?? null);
  const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;
  const spreadBps = spread !== null && mid && mid > 0 ? (spread / mid) * 10_000 : null;

  const totalBidSize = bidLevels.reduce((sum, l) => sum + l.size, 0);
  const totalAskSize = askLevels.reduce((sum, l) => sum + l.size, 0);
  const totalBidNotional = bidLevels.reduce((sum, l) => sum + l.notional_usd, 0);
  const totalAskNotional = askLevels.reduce((sum, l) => sum + l.notional_usd, 0);

  return {
    symbol: snapshot.symbol,
    timestamp: snapshot.timestamp,
    received_at: snapshot.receivedAt,
    source: snapshot.source,
    depth: cappedDepth,
    best_bid: bestBid,
    best_ask: bestAsk,
    mid_price: mid !== null ? round(mid, 8) : null,
    spread: spread !== null ? round(spread, 8) : null,
    spread_bps: spreadBps !== null ? round(spreadBps, 4) : null,
    bid_levels: bidLevels,
    ask_levels: askLevels,
    total_bid_size: round(totalBidSize, 8),
    total_ask_size: round(totalAskSize, 8),
    total_bid_notional: round(totalBidNotional, 6),
    total_ask_notional: round(totalAskNotional, 6),
    snapshot,
  };
}
