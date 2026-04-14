/**
 * orderbook_l2/index.ts — Phase 88: Order Book L2 Aggregator
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. PriceLevel          — bid/ask price-level state.
 *   2. OrderBookL2         — multi-symbol L2 book with snapshot/update.
 *   3. ImbalanceCalculator — bid/ask imbalance + top-N depth metrics.
 *   4. SpreadAnalyzer      — bid-ask spread, microprice, mid-price.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "../logger.js";

// ── Price Levels ───────────────────────────────────────────────────────────

export interface PriceLevel {
  price: number;
  size: number;
  orderCount: number;
  updatedAt: number;
}

export interface BookSide {
  levels: Map<number, PriceLevel>; // keyed by price
}

export interface BookSnapshot {
  symbol: string;
  bids: PriceLevel[];   // sorted desc
  asks: PriceLevel[];   // sorted asc
  bestBid?: number;
  bestAsk?: number;
  spread?: number;
  midPrice?: number;
  capturedAt: number;
}

// ── L2 Book ────────────────────────────────────────────────────────────────

export class OrderBookL2 {
  private readonly books = new Map<string, { bids: BookSide; asks: BookSide; lastUpdate: number }>();

  apply(symbol: string, side: "bid" | "ask", price: number, size: number, orderCount = 1): void {
    let book = this.books.get(symbol);
    if (!book) {
      book = {
        bids: { levels: new Map() },
        asks: { levels: new Map() },
        lastUpdate: Date.now(),
      };
      this.books.set(symbol, book);
    }
    const target = side === "bid" ? book.bids : book.asks;
    if (size <= 0) {
      target.levels.delete(price);
    } else {
      target.levels.set(price, { price, size, orderCount, updatedAt: Date.now() });
    }
    book.lastUpdate = Date.now();
  }

  applyBatch(symbol: string, updates: Array<{ side: "bid" | "ask"; price: number; size: number; orderCount?: number }>): void {
    for (const u of updates) this.apply(symbol, u.side, u.price, u.size, u.orderCount);
  }

  snapshot(symbol: string, depth = 20): BookSnapshot {
    const book = this.books.get(symbol);
    if (!book) {
      return { symbol, bids: [], asks: [], capturedAt: Date.now() };
    }
    const bids = Array.from(book.bids.levels.values()).sort((a, b) => b.price - a.price).slice(0, depth);
    const asks = Array.from(book.asks.levels.values()).sort((a, b) => a.price - b.price).slice(0, depth);
    const bestBid = bids[0]?.price;
    const bestAsk = asks[0]?.price;
    const spread = bestBid !== undefined && bestAsk !== undefined ? bestAsk - bestBid : undefined;
    const midPrice = bestBid !== undefined && bestAsk !== undefined ? (bestBid + bestAsk) / 2 : undefined;
    return { symbol, bids, asks, bestBid, bestAsk, spread, midPrice, capturedAt: Date.now() };
  }

  symbols(): string[] {
    return Array.from(this.books.keys());
  }

  clear(symbol: string): boolean {
    return this.books.delete(symbol);
  }
}

// ── Imbalance ──────────────────────────────────────────────────────────────

export interface ImbalanceMetrics {
  symbol: string;
  topNBidVolume: number;
  topNAskVolume: number;
  imbalanceRatio: number;     // (bid - ask) / (bid + ask), positive = bid heavy
  bidPressure: number;         // bid / (bid+ask)
  bookDepth: number;           // total volume in top N
  asymmetric: boolean;         // |imbalance| > 0.3
}

export class ImbalanceCalculator {
  constructor(private readonly book: OrderBookL2) {}

  compute(symbol: string, n = 5): ImbalanceMetrics {
    const snap = this.book.snapshot(symbol, n);
    const bidVol = snap.bids.reduce((s, l) => s + l.size, 0);
    const askVol = snap.asks.reduce((s, l) => s + l.size, 0);
    const total = bidVol + askVol;
    const imbalanceRatio = total > 0 ? (bidVol - askVol) / total : 0;
    return {
      symbol,
      topNBidVolume: bidVol,
      topNAskVolume: askVol,
      imbalanceRatio,
      bidPressure: total > 0 ? bidVol / total : 0,
      bookDepth: total,
      asymmetric: Math.abs(imbalanceRatio) > 0.3,
    };
  }
}

// ── Spread / Microprice ────────────────────────────────────────────────────

export interface SpreadMetrics {
  symbol: string;
  bestBid?: number;
  bestAsk?: number;
  spread?: number;
  spreadBps?: number;
  midPrice?: number;
  microprice?: number;
}

export class SpreadAnalyzer {
  constructor(private readonly book: OrderBookL2) {}

  compute(symbol: string): SpreadMetrics {
    const snap = this.book.snapshot(symbol, 1);
    const bestBid = snap.bestBid;
    const bestAsk = snap.bestAsk;
    if (bestBid === undefined || bestAsk === undefined) {
      return { symbol };
    }
    const spread = bestAsk - bestBid;
    const midPrice = (bestBid + bestAsk) / 2;
    const spreadBps = midPrice > 0 ? (spread / midPrice) * 10_000 : 0;
    // Microprice = (bidSize * askPrice + askSize * bidPrice) / (bidSize + askSize)
    const bidSize = snap.bids[0]?.size ?? 0;
    const askSize = snap.asks[0]?.size ?? 0;
    const microprice = bidSize + askSize > 0
      ? (bidSize * bestAsk + askSize * bestBid) / (bidSize + askSize)
      : undefined;
    return { symbol, bestBid, bestAsk, spread, spreadBps, midPrice, microprice };
  }
}

// ── Singletons ─────────────────────────────────────────────────────────────

export const orderBookL2 = new OrderBookL2();
export const imbalanceCalculator = new ImbalanceCalculator(orderBookL2);
export const spreadAnalyzer = new SpreadAnalyzer(orderBookL2);

logger.info("[OrderBookL2] Module initialized");
