/**
 * orderbook.ts — Order book state manager (Phase 3)
 *
 * Architecture:
 *  - REST polling (every 5 s) via Alpaca's /v1beta3/crypto/us/latest/orderbooks
 *    provides full snapshots. This is the PRIMARY data source.
 *  - WebSocket orderbook subscription ("o" messages) provides incremental
 *    updates between polls. Enabled when the main alpaca_stream WS is ready.
 *  - Subscribers (SSE clients) receive every snapshot/update in real-time.
 *
 * Limitations (documented per Phase 3 spec):
 *  - Alpaca's order book depth is limited (~20-50 levels per side for paper accts).
 *  - WS orderbook updates require a separate subscription action.
 *  - This is a read-only view — no order insertion/modification.
 */

import https from "https";
import type { OrderBookSnapshot, OrderBookListener, PriceLevel } from "./types";

const ALPACA_DATA_URL = "data.alpaca.markets";
const KEY_ID          = process.env.ALPACA_API_KEY    ?? "";
const SECRET_KEY      = process.env.ALPACA_SECRET_KEY ?? "";

// ── Helpers ────────────────────────────────────────────────────────────────

function toAlpacaSlash(sym: string): string {
  if (sym === "BTCUSD") return "BTC/USD";
  if (sym === "ETHUSD") return "ETH/USD";
  return sym;
}

/** Parse Alpaca's raw level array [{p, s}] → PriceLevel[] */
function parseLevels(raw: Array<{ p: number; s: number }>): PriceLevel[] {
  return raw.map((r) => ({ price: r.p, size: r.s }));
}

// ── Manager class ──────────────────────────────────────────────────────────

class OrderBookManager {
  /** Current snapshot per symbol */
  private snapshots  = new Map<string, OrderBookSnapshot>();
  /** SSE subscribers per symbol */
  private listeners  = new Map<string, Set<OrderBookListener>>();
  /** REST poll timers per symbol */
  private pollTimers = new Map<string, ReturnType<typeof setInterval>>();

  /** Poll interval in ms */
  private readonly POLL_MS = 5_000;

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Subscribe to live order book updates for a symbol.
   * Starts REST polling on first subscriber; sends cached snapshot immediately.
   */
  subscribe(symbol: string, listener: OrderBookListener): void {
    if (!this.listeners.has(symbol)) this.listeners.set(symbol, new Set());
    this.listeners.get(symbol)!.add(listener);

    // Send cached snapshot immediately if available
    const cached = this.snapshots.get(symbol);
    if (cached) {
      try { listener(cached); } catch { /* ignore */ }
    }

    // Start polling if not already running
    this.ensurePoll(symbol);
  }

  /** Remove a subscriber. Stops polling when the last listener leaves. */
  unsubscribe(symbol: string, listener: OrderBookListener): void {
    const set = this.listeners.get(symbol);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) {
      this.listeners.delete(symbol);
      const timer = this.pollTimers.get(symbol);
      if (timer) { clearInterval(timer); this.pollTimers.delete(symbol); }
    }
  }

  /** Return the latest snapshot synchronously (may be null if not yet polled). */
  getSnapshot(symbol: string): OrderBookSnapshot | null {
    return this.snapshots.get(symbol) ?? null;
  }

  /**
   * Fetch a fresh snapshot via REST immediately.
   * Used by GET /api/orderbook/snapshot even without an SSE subscriber.
   */
  async fetchSnapshot(symbol: string): Promise<OrderBookSnapshot> {
    const snap = await this.restFetch(symbol);
    this.snapshots.set(symbol, snap);
    return snap;
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  /** Apply a WS orderbook update.
   *  - If no REST snapshot exists yet, treats this as the first full snapshot.
   *  - Otherwise merges incrementally (size=0 means remove that level).
   */
  applyUpdate(symbol: string, asks: PriceLevel[], bids: PriceLevel[], timestamp: string): void {
    const existing = this.snapshots.get(symbol);

    let mergedAsks: PriceLevel[];
    let mergedBids: PriceLevel[];

    if (!existing) {
      // First update from WS — Alpaca sends a full snapshot on subscribe, use it directly
      mergedAsks = [...asks].sort((a, b) => a.price - b.price);
      mergedBids = [...bids].sort((a, b) => b.price - a.price);
    } else {
      // Incremental merge: size=0 means remove the level
      mergedAsks = mergeLevels(existing.asks, asks, "asc");
      mergedBids = mergeLevels(existing.bids, bids, "desc");
    }

    const updated: OrderBookSnapshot = {
      symbol,
      asks:       mergedAsks,
      bids:       mergedBids,
      timestamp,
      receivedAt: Date.now(),
      source:     "ws",
    };
    this.snapshots.set(symbol, updated);
    this.broadcast(symbol, updated);
  }

  private ensurePoll(symbol: string): void {
    if (this.pollTimers.has(symbol)) return;
    // Immediate first fetch
    this.restFetch(symbol).then((snap) => {
      this.snapshots.set(symbol, snap);
      this.broadcast(symbol, snap);
    }).catch((e) => console.error(`[orderbook] initial fetch error ${symbol}:`, e));

    const timer = setInterval(async () => {
      try {
        const snap = await this.restFetch(symbol);
        this.snapshots.set(symbol, snap);
        this.broadcast(symbol, snap);
      } catch (e) {
        console.error(`[orderbook] poll error ${symbol}:`, e);
      }
    }, this.POLL_MS);

    this.pollTimers.set(symbol, timer);
  }

  private broadcast(symbol: string, snap: OrderBookSnapshot): void {
    const set = this.listeners.get(symbol);
    if (!set) return;
    for (const fn of set) {
      try { fn(snap); } catch { /* ignore */ }
    }
  }

  private restFetch(symbol: string): Promise<OrderBookSnapshot> {
    return new Promise((resolve, reject) => {
      const alpacaSym = encodeURIComponent(toAlpacaSlash(symbol));
      const path = `/v1beta3/crypto/us/latest/orderbooks?symbols=${alpacaSym}`;

      const req = https.get(
        { hostname: ALPACA_DATA_URL, path, headers: { "APCA-API-KEY-ID": KEY_ID, "APCA-API-SECRET-KEY": SECRET_KEY } },
        (res) => {
          let body = "";
          res.on("data", (chunk) => { body += chunk; });
          res.on("end", () => {
            try {
              const json = JSON.parse(body);
              const alpacaSym2 = toAlpacaSlash(symbol);
              const book = json.orderbooks?.[alpacaSym2];
              if (!book) { reject(new Error(`No orderbook data for ${symbol}`)); return; }

              const snap: OrderBookSnapshot = {
                symbol,
                asks:       parseLevels(book.a ?? []).sort((a, b) => a.price - b.price),
                bids:       parseLevels(book.b ?? []).sort((a, b) => b.price - a.price),
                timestamp:  book.t ?? new Date().toISOString(),
                receivedAt: Date.now(),
                source:     "rest",
              };
              resolve(snap);
            } catch (e) { reject(e); }
          });
        }
      );
      req.on("error", reject);
      req.setTimeout(8_000, () => { req.destroy(); reject(new Error("Orderbook request timeout")); });
    });
  }
}

// ── Level merge helper ─────────────────────────────────────────────────────

/**
 * Merge WS incremental levels into the existing book.
 * - size === 0 means remove the level
 * - otherwise, insert or replace
 * Returns sorted: "asc" for asks (lowest first), "desc" for bids (highest first).
 */
function mergeLevels(
  existing: PriceLevel[],
  updates:  PriceLevel[],
  order:    "asc" | "desc",
): PriceLevel[] {
  const map = new Map<number, number>();
  for (const l of existing) map.set(l.price, l.size);
  for (const u of updates) {
    if (u.size === 0) map.delete(u.price);
    else map.set(u.price, u.size);
  }

  const levels: PriceLevel[] = [];
  for (const [price, size] of map) levels.push({ price, size });

  levels.sort(order === "asc"
    ? (a, b) => a.price - b.price
    : (a, b) => b.price - a.price);

  return levels;
}

// ── Singleton export ───────────────────────────────────────────────────────
export const orderBookManager = new OrderBookManager();
