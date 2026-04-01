/**
 * types.ts — Shared typed contracts for order book and market microstructure
 *
 * All prices are in USD. All sizes are in base-asset units (BTC, ETH, etc).
 * Bid levels are sorted descending (highest bid first).
 * Ask levels are sorted ascending (lowest ask first).
 */

/** A single price level in the order book */
export interface PriceLevel {
  price: number;
  size:  number;
}

/** Full order book snapshot for a single symbol */
export interface OrderBookSnapshot {
  symbol:    string;
  /** Ask levels — ascending order, lowest ask first */
  asks:      PriceLevel[];
  /** Bid levels — descending order, highest bid first */
  bids:      PriceLevel[];
  /** ISO timestamp from Alpaca */
  timestamp: string;
  /** Milliseconds since epoch when we received this snapshot */
  receivedAt: number;
  /** Whether this came from REST polling or live WS */
  source:    "rest" | "ws";
}

/** Incremental depth update from the live WS feed */
export interface OrderBookUpdate {
  symbol:    string;
  /** Ask levels to merge/replace (empty = no change) */
  asks:      PriceLevel[];
  /** Bid levels to merge/replace (empty = no change) */
  bids:      PriceLevel[];
  timestamp: string;
}

/** Aggregated liquidity zone — a price cluster with meaningful size */
export interface LiquidityZone {
  /** Centre price of the cluster bucket */
  price:     number;
  /** Lower bound of this bucket */
  priceMin:  number;
  /** Upper bound of this bucket */
  priceMax:  number;
  /** Total size resting in this zone */
  size:      number;
  side:      "bid" | "ask";
  /**
   * Normalised strength 0–1 relative to the max zone in this snapshot.
   * Used for heatmap intensity in Phase 4.
   */
  strength:  number;
}

/** Top-level microstructure metrics for a symbol */
export interface MicrostructureSnapshot {
  symbol:         string;
  timestamp:      string;
  /** Best ask */
  bestAsk:        number;
  /** Best bid */
  bestBid:        number;
  /** bestAsk - bestBid */
  spread:         number;
  /** Spread expressed as basis points (spread / mid * 10000) */
  spreadBps:      number;
  /** Mid-point */
  mid:            number;
  /**
   * Bid-ask imbalance: (bidVolume - askVolume) / (bidVolume + askVolume)
   * Ranges from -1 (all ask) to +1 (all bid).
   * Uses top N levels only (default: 10).
   */
  imbalance:      number;
  /** Cumulative bid size in top-N levels */
  topBidVolume:   number;
  /** Cumulative ask size in top-N levels */
  topAskVolume:   number;
  /**
   * True if bids are absorbing — imbalance > 0.3, spread tight.
   * Used by reversal scoring in Phase 5.
   */
  absorbingBid:   boolean;
  absorbingAsk:   boolean;
  /** Current order book snapshot on which these metrics are based */
  snapshot:       OrderBookSnapshot;
}

/** Listener callback for real-time order book updates */
export type OrderBookListener = (snapshot: OrderBookSnapshot) => void;
