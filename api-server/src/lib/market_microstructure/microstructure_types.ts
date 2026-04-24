import type { LiquidityZone, OrderBookSnapshot, PriceLevel } from "../market/types";

export interface NormalizedOrderBookLevel extends PriceLevel {
  cumulative_size: number;
  notional_usd: number;
}

export interface NormalizedOrderBook {
  symbol: string;
  timestamp: string;
  received_at: number;
  source: OrderBookSnapshot["source"];
  depth: number;
  best_bid: number | null;
  best_ask: number | null;
  mid_price: number | null;
  spread: number | null;
  spread_bps: number | null;
  bid_levels: NormalizedOrderBookLevel[];
  ask_levels: NormalizedOrderBookLevel[];
  total_bid_size: number;
  total_ask_size: number;
  total_bid_notional: number;
  total_ask_notional: number;
  snapshot: OrderBookSnapshot;
}

export type PressureBias = "buy" | "sell" | "neutral";

export interface ImbalanceMetrics {
  top_levels: number;
  touch_imbalance: number;
  depth_imbalance: number;
  weighted_imbalance: number;
  top_bid_volume: number;
  top_ask_volume: number;
  score: number;
  bias: PressureBias;
}

export type AbsorptionState = "bid_absorption" | "ask_absorption" | "none";

export interface AbsorptionMetrics {
  state: AbsorptionState;
  score: number;
  confidence: number;
  persistence: number;
  mid_drift_bps: number;
  spread_bps: number;
  reason: string;
}

export type HeatmapZoneType = "absorption" | "aggression" | "vacuum" | "rotation";

export interface HeatmapZone {
  price_start: number;
  price_end: number;
  side: LiquidityZone["side"];
  strength: number;
  intensity: number;
  distance_bps: number;
  type: HeatmapZoneType;
}

export interface LiquidityHeatmapSnapshot {
  generated_at: string;
  bucket_pct: number;
  top_n: number;
  zone_score: number;
  zones: HeatmapZone[];
}

export interface TapePrint {
  price: number;
  size: number;
  notional_usd: number;
  timestamp: string;
  side: "buy" | "sell";
  aggressor: boolean;
}

export interface TapeSummary {
  generated_at: string;
  window_sec: number;
  print_count: number;
  buy_volume: number;
  sell_volume: number;
  buy_notional: number;
  sell_notional: number;
  delta_volume: number;
  delta_notional: number;
  normalized_delta: number;
  burst_score: number;
  score: number;
  bias: PressureBias;
  prints: TapePrint[];
}

export type MicrostructureVerdict =
  | "high_conviction_long"
  | "high_conviction_short"
  | "tradable_long"
  | "tradable_short"
  | "neutral"
  | "avoid";

export interface MicrostructureCompositeScore {
  score: number;
  confidence: number;
  quality: "high" | "medium" | "low";
  direction: "long" | "short" | "flat";
  verdict: MicrostructureVerdict;
  reasons: string[];
  components: {
    imbalance: number;
    absorption: number;
    liquidity: number;
    tape: number;
    spread_quality: number;
  };
}

export type MicrostructureEventType =
  | "imbalance_shift"
  | "bid_absorption"
  | "ask_absorption"
  | "liquidity_vacuum"
  | "aggressive_tape"
  | "score_spike";

export interface MicrostructureEventRecord {
  id: string;
  symbol: string;
  type: MicrostructureEventType;
  direction: "long" | "short" | "neutral";
  strength: number;
  detail: string;
  metadata: Record<string, unknown>;
  timestamp: string;
}

export interface MicrostructureCurrentSnapshot {
  symbol: string;
  generated_at: string;
  orderbook: NormalizedOrderBook;
  imbalance: ImbalanceMetrics;
  absorption: AbsorptionMetrics;
  heatmap: LiquidityHeatmapSnapshot;
  tape: TapeSummary;
  score: MicrostructureCompositeScore;
}
