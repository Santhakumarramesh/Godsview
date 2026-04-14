/**
 * Phase 103 — Order Flow L2 Engine
 * =================================
 * Ingests level-2 order book snapshots and trade prints, computes
 * real-time microstructure features used by the multi-agent system:
 *   - Liquidity walls (large resting size relative to the book)
 *   - Absorption (heavy aggression with no price move)
 *   - Imbalance (bid vs ask size)
 *   - Cumulative delta (signed taker volume)
 */

export interface BookLevel {
  price: number;
  size: number;
}

export interface OrderBookSnapshot {
  symbol: string;
  ts: number;
  bids: BookLevel[]; // sorted desc by price (best first)
  asks: BookLevel[]; // sorted asc by price (best first)
}

export interface TradePrint {
  symbol: string;
  ts: number;
  price: number;
  size: number;
  /** "buy" = aggressor bought (lifted ask); "sell" = aggressor sold. */
  aggressor: "buy" | "sell";
}

export interface LiquidityWall {
  side: "bid" | "ask";
  price: number;
  size: number;
  /** Multiplier vs avg level size, e.g. 5x = 5 */
  ratio: number;
}

export interface OrderFlowState {
  symbol: string;
  ts: number;
  best_bid: number;
  best_ask: number;
  spread: number;
  imbalance: number;        // (bid - ask) / (bid + ask), [-1..1]
  cumulative_delta: number; // signed taker volume since start
  walls: LiquidityWall[];
  absorption: {
    detected: boolean;
    side?: "bid" | "ask";
    aggressor_volume?: number;
    price_move_bps?: number;
  };
  /** Continuation probability from heuristic ensemble. */
  continuation_probability: number;
}

export class OrderFlowL2Engine {
  private cumulativeDelta = new Map<string, number>();
  private lastSnap = new Map<string, OrderBookSnapshot>();
  private rolling = new Map<string, TradePrint[]>();
  private readonly WINDOW_MS = 5_000;
  private readonly WALL_RATIO = 4;

  ingestBook(snap: OrderBookSnapshot): void {
    this.lastSnap.set(snap.symbol, snap);
  }

  ingestTrade(t: TradePrint): void {
    const cur = this.cumulativeDelta.get(t.symbol) ?? 0;
    this.cumulativeDelta.set(
      t.symbol,
      cur + (t.aggressor === "buy" ? t.size : -t.size),
    );
    let arr = this.rolling.get(t.symbol);
    if (!arr) {
      arr = [];
      this.rolling.set(t.symbol, arr);
    }
    arr.push(t);
    const cutoff = t.ts - this.WINDOW_MS;
    while (arr.length && arr[0]!.ts < cutoff) arr.shift();
  }

  computeState(symbol: string): OrderFlowState | undefined {
    const snap = this.lastSnap.get(symbol);
    if (!snap || !snap.bids.length || !snap.asks.length) return undefined;

    const bestBid = snap.bids[0]!.price;
    const bestAsk = snap.asks[0]!.price;
    const spread = bestAsk - bestBid;

    const bidSize = snap.bids.slice(0, 10).reduce((a, l) => a + l.size, 0);
    const askSize = snap.asks.slice(0, 10).reduce((a, l) => a + l.size, 0);
    const imbalance =
      bidSize + askSize > 0 ? (bidSize - askSize) / (bidSize + askSize) : 0;

    const walls = this.detectWalls(snap);
    const absorption = this.detectAbsorption(symbol, snap);
    const cumDelta = this.cumulativeDelta.get(symbol) ?? 0;

    const continuation = this.continuationScore(imbalance, absorption, cumDelta);

    return {
      symbol,
      ts: snap.ts,
      best_bid: bestBid,
      best_ask: bestAsk,
      spread,
      imbalance,
      cumulative_delta: cumDelta,
      walls,
      absorption,
      continuation_probability: continuation,
    };
  }

  reset(): void {
    this.cumulativeDelta.clear();
    this.lastSnap.clear();
    this.rolling.clear();
  }

  private detectWalls(snap: OrderBookSnapshot): LiquidityWall[] {
    const out: LiquidityWall[] = [];
    const collect = (side: "bid" | "ask", levels: BookLevel[]) => {
      if (levels.length < 3) return;
      const top = levels.slice(0, 20);
      const avg = top.reduce((a, l) => a + l.size, 0) / top.length;
      for (const l of top) {
        const ratio = l.size / Math.max(avg, 1);
        if (ratio >= this.WALL_RATIO)
          out.push({ side, price: l.price, size: l.size, ratio });
      }
    };
    collect("bid", snap.bids);
    collect("ask", snap.asks);
    return out.sort((a, b) => b.ratio - a.ratio).slice(0, 6);
  }

  private detectAbsorption(
    symbol: string,
    snap: OrderBookSnapshot,
  ): OrderFlowState["absorption"] {
    const trades = this.rolling.get(symbol);
    if (!trades || trades.length < 5) return { detected: false };
    const buyVol = trades
      .filter((t) => t.aggressor === "buy")
      .reduce((a, t) => a + t.size, 0);
    const sellVol = trades
      .filter((t) => t.aggressor === "sell")
      .reduce((a, t) => a + t.size, 0);
    const dominant = buyVol > sellVol ? "buy" : "sell";
    const dominantVol = Math.max(buyVol, sellVol);

    const first = trades[0]!.price;
    const last = trades[trades.length - 1]!.price;
    const moveBps = first > 0 ? (Math.abs(last - first) / first) * 10_000 : 0;

    // Big aggression but tiny price move == absorption
    const ref = (snap.bids[0]!.price + snap.asks[0]!.price) / 2;
    const threshold = Math.max(20, ref * 0.0001 * 5); // adaptive
    const detected = dominantVol > threshold && moveBps < 5;

    return {
      detected,
      side: dominant === "buy" ? "ask" : "bid",
      aggressor_volume: dominantVol,
      price_move_bps: moveBps,
    };
  }

  private continuationScore(
    imbalance: number,
    absorption: OrderFlowState["absorption"],
    cumDelta: number,
  ): number {
    let s = 0.5;
    s += imbalance * 0.25;
    if (absorption.detected) s -= 0.2; // absorption usually = exhaustion
    s += Math.tanh(cumDelta / 10000) * 0.15;
    return Math.max(0, Math.min(1, s));
  }
}

let SINGLETON: OrderFlowL2Engine | undefined;
export function getOrderFlowL2(): OrderFlowL2Engine {
  if (!SINGLETON) SINGLETON = new OrderFlowL2Engine();
  return SINGLETON;
}
