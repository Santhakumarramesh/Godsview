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
import { normalizeMarketSymbol, toAlpacaSlash } from "./symbols";
import { orderBookRecorder } from "./orderbook_recorder";
import { logger as _logger } from "../logger";
import { sanitizeUpstreamErrorBody } from "../error_body_sanitizer";

const ALPACA_DATA_URL = "data.alpaca.markets";
const KEY_ID          = process.env.ALPACA_API_KEY    ?? "";
const SECRET_KEY      = process.env.ALPACA_SECRET_KEY ?? "";
const logger = _logger.child({ module: "orderbook" });
const DEFAULT_AUTH_FAILURE_COOLDOWN_MS = 60_000;
const parsedAuthCooldownMs = Number.parseInt(
  process.env.ORDERBOOK_AUTH_FAILURE_COOLDOWN_MS
    ?? process.env.ALPACA_AUTH_FAILURE_COOLDOWN_MS
    ?? String(DEFAULT_AUTH_FAILURE_COOLDOWN_MS),
  10,
);
const AUTH_FAILURE_COOLDOWN_MS =
  Number.isFinite(parsedAuthCooldownMs) && parsedAuthCooldownMs > 0
    ? parsedAuthCooldownMs
    : DEFAULT_AUTH_FAILURE_COOLDOWN_MS;
const AUTH_WARN_COOLDOWN_MS = 30_000;

let authFailureState: {
  untilMs: number;
  status: number | null;
  message: string | null;
  occurredAt: string | null;
  count: number;
} = {
  untilMs: 0,
  status: null,
  message: null,
  occurredAt: null,
  count: 0,
};
let _lastAuthWarnMs = 0;

// ── Helpers ────────────────────────────────────────────────────────────────

/** Parse Alpaca's raw level array [{p, s}] → PriceLevel[] */
function parseLevels(raw: Array<{ p: number; s: number }>): PriceLevel[] {
  return raw.map((r) => ({ price: r.p, size: r.s }));
}

function compactBodySnippet(body: string, maxLen = 180): string {
  return sanitizeUpstreamErrorBody(body, { maxLen });
}

export class OrderbookApiError extends Error {
  readonly status: number;
  readonly bodySnippet: string;
  readonly authFailure: boolean;
  readonly retryable: boolean;

  constructor(
    status: number,
    body: string,
    options?: { authFailure?: boolean; retryable?: boolean; prefix?: string },
  ) {
    const bodySnippet = compactBodySnippet(body);
    const prefix =
      options?.prefix ??
      (status > 0 ? `Orderbook API ${status}` : "Orderbook API network error");
    super(`${prefix}: ${bodySnippet}`);
    this.name = "OrderbookApiError";
    this.status = status;
    this.bodySnippet = bodySnippet;
    this.authFailure = Boolean(options?.authFailure);
    this.retryable = Boolean(options?.retryable);
  }
}

export function isOrderbookAuthFailureError(err: unknown): boolean {
  return err instanceof OrderbookApiError && err.authFailure;
}

function markAuthFailure(status: number, body: string): void {
  authFailureState = {
    untilMs: Date.now() + AUTH_FAILURE_COOLDOWN_MS,
    status,
    message: compactBodySnippet(body),
    occurredAt: new Date().toISOString(),
    count: authFailureState.count + 1,
  };
}

function clearAuthFailure(): void {
  authFailureState = {
    untilMs: 0,
    status: null,
    message: null,
    occurredAt: null,
    count: 0,
  };
}

function logAuthDegraded(context: string, symbol: string, err: Error): void {
  const now = Date.now();
  if (now - _lastAuthWarnMs >= AUTH_WARN_COOLDOWN_MS) {
    _lastAuthWarnMs = now;
    logger.warn({ symbol, err: err.message }, `[orderbook] auth unavailable during ${context}`);
    return;
  }
  logger.debug({ symbol, err: err.message }, `[orderbook] auth unavailable during ${context}`);
}

export function getOrderbookAuthFailureState(): {
  active: boolean;
  remainingMs: number;
  cooldownMs: number;
  status: number | null;
  message: string | null;
  occurredAt: string | null;
  count: number;
} {
  const remainingMs = Math.max(0, authFailureState.untilMs - Date.now());
  return {
    active: remainingMs > 0,
    remainingMs,
    cooldownMs: AUTH_FAILURE_COOLDOWN_MS,
    status: authFailureState.status,
    message: authFailureState.message,
    occurredAt: authFailureState.occurredAt,
    count: authFailureState.count,
  };
}

export function _resetOrderbookAuthFailureStateForTests(): void {
  clearAuthFailure();
  _lastAuthWarnMs = 0;
}

export function parseOrderbookRestResponse(symbol: string, statusCode: number, body: string): OrderBookSnapshot {
  if (statusCode < 200 || statusCode >= 300) {
    const authFailure = statusCode === 401 || statusCode === 403;
    throw new OrderbookApiError(statusCode, body, {
      authFailure,
      retryable: statusCode >= 500,
      prefix: `Orderbook API ${statusCode}`,
    });
  }

  let json: any;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error(`Orderbook API invalid JSON for ${symbol}: ${compactBodySnippet(body)}`);
  }

  const alpacaSym = toAlpacaSlash(symbol);
  const book = json?.orderbooks?.[alpacaSym];
  if (!book) {
    throw new Error(`No orderbook data for ${symbol}`);
  }

  return {
    symbol,
    asks: parseLevels(book.a ?? []).sort((a, b) => a.price - b.price),
    bids: parseLevels(book.b ?? []).sort((a, b) => b.price - a.price),
    timestamp: book.t ?? new Date().toISOString(),
    receivedAt: Date.now(),
    source: "rest",
  };
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
    symbol = normalizeMarketSymbol(symbol);
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
    symbol = normalizeMarketSymbol(symbol);
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
    return this.snapshots.get(normalizeMarketSymbol(symbol)) ?? null;
  }

  /**
   * Fetch a fresh snapshot via REST immediately.
   * Used by GET /api/orderbook/snapshot even without an SSE subscriber.
   */
  async fetchSnapshot(symbol: string): Promise<OrderBookSnapshot> {
    symbol = normalizeMarketSymbol(symbol);
    const snap = await this.restFetch(symbol);
    this.ingestSnapshot(symbol, snap, false);
    return snap;
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  /** Apply a WS orderbook update.
   *  - If no REST snapshot exists yet, treats this as the first full snapshot.
   *  - Otherwise merges incrementally (size=0 means remove that level).
   */
  applyUpdate(symbol: string, asks: PriceLevel[], bids: PriceLevel[], timestamp: string): void {
    symbol = normalizeMarketSymbol(symbol);
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
    this.ingestSnapshot(symbol, updated, true);
  }

  private ensurePoll(symbol: string): void {
    if (this.pollTimers.has(symbol)) return;
    // Immediate first fetch
    this.restFetch(symbol).then((snap) => {
      this.ingestSnapshot(symbol, snap, true);
    }).catch((err) => {
      const normalizedErr = err instanceof Error ? err : new Error(String(err));
      if (isOrderbookAuthFailureError(err)) {
        logAuthDegraded("initial_fetch", symbol, normalizedErr);
        return;
      }
      logger.warn({ symbol, err: normalizedErr.message }, "[orderbook] initial fetch failed");
    });

    const timer = setInterval(async () => {
      try {
        const snap = await this.restFetch(symbol);
        this.ingestSnapshot(symbol, snap, true);
      } catch (err) {
        const normalizedErr = err instanceof Error ? err : new Error(String(err));
        if (isOrderbookAuthFailureError(err)) {
          logAuthDegraded("poll", symbol, normalizedErr);
          return;
        }
        logger.warn({ symbol, err: normalizedErr.message }, "[orderbook] poll fetch failed");
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

  private ingestSnapshot(symbol: string, snap: OrderBookSnapshot, broadcast: boolean): void {
    this.snapshots.set(symbol, snap);
    orderBookRecorder.recordSnapshot(snap);
    if (broadcast) this.broadcast(symbol, snap);
  }

  private restFetch(symbol: string): Promise<OrderBookSnapshot> {
    return new Promise((resolve, reject) => {
      const cooldownRemainingMs = authFailureState.untilMs - Date.now();
      if (cooldownRemainingMs > 0) {
        const status = authFailureState.status ?? 401;
        const detail = authFailureState.message ?? "authorization failed";
        reject(
          new OrderbookApiError(status, `${detail} (cooldown ${cooldownRemainingMs}ms remaining)`, {
            authFailure: true,
            retryable: false,
            prefix: `Orderbook API ${status}`,
          }),
        );
        return;
      }

      const alpacaSym = encodeURIComponent(toAlpacaSlash(symbol));
      const path = `/v1beta3/crypto/us/latest/orderbooks?symbols=${alpacaSym}`;

      const req = https.get(
        { hostname: ALPACA_DATA_URL, path, headers: { "APCA-API-KEY-ID": KEY_ID, "APCA-API-SECRET-KEY": SECRET_KEY } },
        (res) => {
          let body = "";
          const statusCode = Number(res.statusCode ?? 0);
          res.on("data", (chunk) => { body += chunk; });
          res.on("end", () => {
            try {
              const snapshot = parseOrderbookRestResponse(symbol, statusCode, body);
              clearAuthFailure();
              resolve(snapshot);
            } catch (err) {
              if (isOrderbookAuthFailureError(err)) {
                const authErr = err as OrderbookApiError;
                markAuthFailure(authErr.status, authErr.bodySnippet);
              }
              reject(err);
            }
          });
        }
      );
      req.on("error", (err) => {
        reject(new OrderbookApiError(0, err?.message ?? String(err), { retryable: true }));
      });
      req.setTimeout(8_000, () => {
        req.destroy();
        reject(new OrderbookApiError(0, "Orderbook request timeout", { retryable: true }));
      });
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
