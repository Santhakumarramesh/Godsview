// Alpaca real-time WebSocket stream manager
// Connects to wss://stream.data.alpaca.markets/v1beta3/crypto/us
// Streams live trade ticks + quotes → aggregates into candles → broadcasts to SSE clients

import WebSocket from "ws";
import { logger } from "./logger.js";
import { orderBookManager } from "./market/orderbook";
import { orderBookRecorder } from "./market/orderbook_recorder";
import { fromAlpacaSlash, isCryptoSymbol, normalizeMarketSymbol, toAlpacaSlash } from "./market/symbols";

const WS_URL = "wss://stream.data.alpaca.markets/v1beta3/crypto/us";
const KEY_ID = process.env.ALPACA_API_KEY ?? "";
const SECRET_KEY = process.env.ALPACA_SECRET_KEY ?? "";
const DEFAULT_STREAM_SYMBOLS = ["BTCUSD", "ETHUSD", "SOLUSD", "AVAXUSD", "DOGEUSD", "ADAUSD"];

const TF_MS: Record<string, number> = {
  "1Min": 60_000, "5Min": 300_000, "15Min": 900_000, "1Hour": 3_600_000, "1Day": 86_400_000,
};

export type LiveCandle = { time: number; open: number; high: number; low: number; close: number; volume: number };
export type TickPayload = { type: "tick"; symbol: string; price: number; timestamp: string; candle: LiveCandle };
export type TickListener = (payload: TickPayload) => void;

function candleBucket(tsMs: number, tf: string): number {
  const ms = TF_MS[tf] ?? 300_000;
  return Math.floor(tsMs / ms) * (ms / 1000);
}

class AlpacaStreamManager {
  private ws: WebSocket | null = null;
  private authenticated = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wsRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private stopped = false;
  private closedIntentionally = false; // prevent double reconnect from close + error

  // Listeners: "BTCUSD:5Min" → Set<listener>
  private listeners = new Map<string, Set<TickListener>>();
  // Live candle state: "BTCUSD:5Min" → LiveCandle
  private candles = new Map<string, LiveCandle>();
  // Last trade ts per symbol to deduplicate
  private lastTradeTs = new Map<string, string>();
  // Last quote ts per symbol to deduplicate
  private lastQuoteTs = new Map<string, string>();

  // Fallback polling (used if WebSocket auth fails)
  private pollingMode = false;
  private pollTimers = new Map<string, ReturnType<typeof setInterval>>();
  private lastTrade = new Map<string, { price: number; ts: string }>();
  private pollInFlight = new Set<string>();
  private readonly FALLBACK_POLL_MS = (() => {
    const parsed = Number.parseInt(process.env.ALPACA_FALLBACK_POLL_MS ?? "2000", 10);
    if (!Number.isFinite(parsed)) return 2000;
    return Math.max(1000, Math.min(parsed, 15_000));
  })();

  // Status tracking
  private wsConnectedAt: number | null = null;
  private ticksReceived = 0;
  private quotesReceived = 0;

  status() {
    return {
      pollingMode: this.pollingMode,
      authenticated: this.authenticated,
      wsState: this.ws ? this.ws.readyState : -1,
      wsConnectedAt: this.wsConnectedAt,
      ticksReceived: this.ticksReceived,
      quotesReceived: this.quotesReceived,
      listenersCount: this.listeners.size,
      symbols: [...this.listeners.keys()],
    };
  }

  start() {
    if (this.ws || this.stopped) return;
    logger.info("[stream] starting WS connection to Alpaca crypto stream");
    this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.wsRetryTimer) clearTimeout(this.wsRetryTimer);
    this.closedIntentionally = true;
    this.ws?.close();
    this.ws = null;
    for (const t of this.pollTimers.values()) clearInterval(t);
    this.pollTimers.clear();
  }

  /** Subscribe to orderbook WS updates for a symbol (no listener needed — goes to orderBookManager) */
  subscribeOrderbook(symbol: string) {
    const normalizedSymbol = normalizeMarketSymbol(symbol);
    if (!isCryptoSymbol(normalizedSymbol)) return;
    const alpacaSym = toAlpacaSlash(normalizedSymbol);
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.authenticated) {
      // Will be sent automatically after auth via the default symbols set below
      return;
    }
    this.ws.send(JSON.stringify({ action: "subscribe", orderbooks: [alpacaSym] }));
    logger.debug({ symbol: alpacaSym }, "[stream] orderbook subscribe sent");
  }

  subscribe(symbol: string, timeframe: string, listener: TickListener) {
    const normalizedSymbol = normalizeMarketSymbol(symbol);
    if (!isCryptoSymbol(normalizedSymbol)) {
      logger.warn({ symbol }, "[stream] ignored non-crypto subscription request");
      return;
    }
    const key = `${normalizedSymbol}:${timeframe}`;
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key)!.add(listener);

    logger.info({ key, authenticated: this.authenticated, wsState: this.ws?.readyState, pollingMode: this.pollingMode }, "[stream] subscribe");

    // If already connected and authenticated, subscribe the new symbol immediately
    if (!this.pollingMode && this.authenticated && this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscribe([toAlpacaSlash(normalizedSymbol)]);
    } else if (this.pollingMode) {
      this.ensurePolling(normalizedSymbol);
    } else {
      // WS connecting or not yet authenticated — subscription will be sent after auth
      logger.debug({ symbol }, "[stream] WS not ready yet, will subscribe after auth");
    }
  }

  unsubscribe(symbol: string, timeframe: string, listener: TickListener) {
    const normalizedSymbol = normalizeMarketSymbol(symbol);
    const key = `${normalizedSymbol}:${timeframe}`;
    const set = this.listeners.get(key);
    if (!set) return;

    set.delete(listener);
    if (set.size === 0) {
      this.listeners.delete(key);
    }

    if (!this.hasAnyListenerForSymbol(normalizedSymbol)) {
      const pollTimer = this.pollTimers.get(normalizedSymbol);
      if (pollTimer) {
        clearInterval(pollTimer);
        this.pollTimers.delete(normalizedSymbol);
      }
      this.lastTrade.delete(normalizedSymbol);
      this.pollInFlight.delete(normalizedSymbol);
    }
  }

  private connect() {
    if (this.stopped) return;
    this.closedIntentionally = false;
    logger.info({ url: WS_URL }, "[stream] connecting");
    try {
      const ws = new WebSocket(WS_URL);
      this.ws = ws;

      ws.on("open", () => {
        this.reconnectDelay = 1000;
        this.wsConnectedAt = Date.now();
        logger.info("[stream] WS open — sending auth");
        ws.send(JSON.stringify({ action: "auth", key: KEY_ID, secret: SECRET_KEY }));
      });

      ws.on("message", (raw) => {
        try {
          const msgs = JSON.parse(raw.toString()) as Array<Record<string, unknown>>;
          for (const msg of msgs) {
            this.handleMessage(msg);
          }
        } catch { /* ignore */ }
      });

      ws.on("error", (e) => {
        logger.error({ err: e.message }, "[stream] WS error");
        if (!this.closedIntentionally) this.scheduleReconnect();
      });
      ws.on("close", (code, reason) => {
        this.authenticated = false;
        if (this.closedIntentionally) {
          logger.debug({ code }, "[stream] WS closed (intentional close, reconnect already scheduled)");
          return;
        }
        logger.info({ code, reason: reason?.toString() }, "[stream] WS closed — reconnecting");
        this.scheduleReconnect();
      });
    } catch (e) {
      logger.error({ err: e }, "[stream] connect error");
      this.scheduleReconnect();
    }
  }

  private handleMessage(msg: Record<string, unknown>) {
    const T = msg.T as string;

    if (T === "success" && msg.msg === "connected") {
      logger.info("[stream] connected to Alpaca");
      return;
    }

    if (T === "success" && msg.msg === "authenticated") {
      this.authenticated = true;
      this.pollingMode = false;
      logger.info("[stream] authenticated OK");

      // Always subscribe to default crypto symbols for orderbooks, trades & quotes
      const defaultSymbols = DEFAULT_STREAM_SYMBOLS.map((symbol) => toAlpacaSlash(symbol));
      const listenerSymbols = new Set<string>();
      for (const key of this.listeners.keys()) {
        const symbol = normalizeMarketSymbol(key.split(":")[0]);
        if (isCryptoSymbol(symbol)) {
          listenerSymbols.add(toAlpacaSlash(symbol));
        }
      }
      const allSymbols = [...new Set([...defaultSymbols, ...listenerSymbols])];
      logger.info({ symbols: allSymbols }, "[stream] subscribing after auth");
      this.sendSubscribe(allSymbols);
      return;
    }

    if (T === "subscription") {
      logger.info({ subscription: msg }, "[stream] subscription confirmed");
      return;
    }

    if (T === "error") {
      const code = msg.code as number;
      const errMsg = msg.msg as string;
      logger.error({ code, msg: errMsg }, "[stream] Alpaca error");

      // 406 = connection limit exceeded — old container still holds the WS slot.
      // Close this WS and schedule a reconnect; the old container will shut down soon.
      if (code === 406) {
        logger.warn("[stream] connection limit error — closing WS and scheduling reconnect (old container will release slot)");
        this.closedIntentionally = true;
        this.ws?.close();
        this.ws = null;
        this.authenticated = false;
        this.scheduleReconnect();
        return;
      }

      // 404 = auth timeout — typically happens after a 406 delay.  Retriable.
      if (code === 404) {
        logger.warn("[stream] auth timeout — closing WS and scheduling reconnect");
        this.closedIntentionally = true;
        this.ws?.close();
        this.ws = null;
        this.authenticated = false;
        this.scheduleReconnect();
        return;
      }

      // Other auth errors — fall back to REST polling but schedule periodic WS retry
      logger.warn({ code, pollMs: this.FALLBACK_POLL_MS }, "[stream] auth failed, falling back to REST polling");
      this.pollingMode = true;
      this.closedIntentionally = true;
      this.ws?.close();
      this.ws = null;
      this.startFallbackPolling();
      this.scheduleWsRetry();
      return;
    }

    if (T === "t") {
      // Trade tick: { T: "t", S: "BTC/USD", p: 66700.5, s: 0.001, t: "..." }
      const alpacaSym = String(msg.S ?? "");
      const symbol = normalizeMarketSymbol(fromAlpacaSlash(alpacaSym));
      const price = Number(msg.p ?? 0);
      const volume = Number(msg.s ?? 0);
      const timestamp = String(msg.t ?? "");

      if (!symbol || !price) return;

      // Deduplicate trades
      const prevTs = this.lastTradeTs.get(symbol);
      if (prevTs === timestamp) return;
      this.lastTradeTs.set(symbol, timestamp);

      this.ticksReceived++;
      if (this.ticksReceived <= 5 || this.ticksReceived % 100 === 0) {
        logger.info(`[stream] TRADE tick #${this.ticksReceived} ${symbol} $${price} @ ${timestamp}`);
      }

      orderBookRecorder.recordTradeTick({
        symbol,
        price,
        size: volume,
        timestamp,
        source: "ws_trade",
      });

      this.broadcastPrice(symbol, price, volume, timestamp);
    }

    if (T === "o") {
      // Orderbook update: { T: "o", S: "BTC/USD", t: "...", b: [{p,s}...], a: [{p,s}...] }
      // Forward to orderBookManager so SSE clients receive WS-speed order book updates
      try {
        const alpacaSym = String(msg.S ?? "");
        const symbol    = normalizeMarketSymbol(fromAlpacaSlash(alpacaSym));
        const bids = ((msg.b ?? []) as Array<{ p: number; s: number }>).map((l) => ({ price: l.p, size: l.s }));
        const asks = ((msg.a ?? []) as Array<{ p: number; s: number }>).map((l) => ({ price: l.p, size: l.s }));
        const timestamp = String(msg.t ?? new Date().toISOString());
        orderBookManager.applyUpdate(symbol, asks, bids, timestamp);
      } catch { /* ignore */ }
      return;
    }

    if (T === "q") {
      // Quote: { T: "q", S: "BTC/USD", bp: 66700, ap: 66701, bx: "...", ax: "...", t: "..." }
      // Use midpoint as price for zero-latency updates
      const alpacaSym = String(msg.S ?? "");
      const symbol = normalizeMarketSymbol(fromAlpacaSlash(alpacaSym));
      const bp = Number(msg.bp ?? 0);
      const ap = Number(msg.ap ?? 0);
      const timestamp = String(msg.t ?? "");

      if (!symbol || (!bp && !ap)) return;
      const price = bp && ap ? (bp + ap) / 2 : bp || ap;

      // Deduplicate
      const prevTs = this.lastQuoteTs.get(symbol);
      if (prevTs === timestamp) return;
      this.lastQuoteTs.set(symbol, timestamp);

      this.quotesReceived++;
      if (this.quotesReceived <= 3 || this.quotesReceived % 200 === 0) {
        logger.info(`[stream] QUOTE tick #${this.quotesReceived} ${symbol} mid=$${price.toFixed(2)} @ ${timestamp}`);
      }

      this.broadcastPrice(symbol, price, 0, timestamp);
    }
  }

  private broadcastPrice(symbol: string, price: number, volume: number, timestamp: string) {
    const tMs = new Date(timestamp).getTime();

    for (const [key, listeners] of this.listeners) {
      const [keySym, keyTf] = key.split(":");
      if (keySym !== symbol || !listeners.size) continue;

      const bucket = candleBucket(tMs, keyTf);
      const existing = this.candles.get(key);

      let candle: LiveCandle;
      if (!existing || existing.time !== bucket) {
        candle = { time: bucket, open: price, high: price, low: price, close: price, volume };
      } else {
        candle = {
          ...existing,
          high: Math.max(existing.high, price),
          low: Math.min(existing.low, price),
          close: price,
          volume: existing.volume + volume,
        };
      }
      this.candles.set(key, candle);

      const payload: TickPayload = { type: "tick", symbol, price, timestamp, candle };
      for (const fn of listeners) {
        try { fn(payload); } catch { /* ignore */ }
      }
    }
  }

  private sendSubscribe(alpacaSymbols: string[]) {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      logger.warn("[stream] sendSubscribe called but WS not open");
      return;
    }
    // Subscribe to trades, quotes AND orderbooks on the same single connection
    const msg = {
      action:     "subscribe",
      trades:     alpacaSymbols,
      quotes:     alpacaSymbols,
      orderbooks: alpacaSymbols,
    };
    logger.info({ msg }, "[stream] sending subscribe");
    this.ws.send(JSON.stringify(msg));
  }

  private scheduleReconnect() {
    if (this.stopped || this.pollingMode) return;
    if (this.reconnectTimer) return;
    logger.info({ delayMs: this.reconnectDelay }, "[stream] scheduling reconnect");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ws = null;
      this.authenticated = false;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
  }

  /** Periodically retry WS from polling mode (every 60s) */
  private scheduleWsRetry() {
    if (this.wsRetryTimer || this.stopped) return;
    const WS_RETRY_MS = 60_000;
    logger.info({ retryInSec: WS_RETRY_MS / 1000 }, "[stream] will retry WS connection");
    this.wsRetryTimer = setTimeout(() => {
      this.wsRetryTimer = null;
      if (this.stopped || !this.pollingMode) return;
      logger.info("[stream] attempting WS reconnect from polling mode");
      this.pollingMode = false;
      this.reconnectDelay = 1000;
      // Stop fallback polling — will restart if WS fails again
      for (const t of this.pollTimers.values()) clearInterval(t);
      this.pollTimers.clear();
      this.connect();
    }, WS_RETRY_MS);
  }

  // ── Fallback: poll REST when WebSocket auth fails ────────────────────────
  private startFallbackPolling() {
    const symbols = new Set<string>();
    for (const key of this.listeners.keys()) {
      const symbol = normalizeMarketSymbol(key.split(":")[0]);
      if (isCryptoSymbol(symbol)) symbols.add(symbol);
    }
    for (const sym of symbols) this.ensurePolling(sym);
  }

  private ensurePolling(symbol: string) {
    if (!this.pollingMode || this.pollTimers.has(symbol)) return;
    logger.info({ symbol, pollMs: this.FALLBACK_POLL_MS }, "[stream] starting REST fallback poll");
    const timer = setInterval(() => this.pollSymbol(symbol), this.FALLBACK_POLL_MS);
    this.pollTimers.set(symbol, timer);
  }

  private async pollSymbol(symbol: string) {
    if (this.pollInFlight.has(symbol)) return;
    this.pollInFlight.add(symbol);
    try {
      const { getLatestTrade } = await import("./alpaca.js");
      const trade = await getLatestTrade(normalizeMarketSymbol(symbol));
      if (!trade) return;

      const prev = this.lastTrade.get(symbol);
      if (prev && prev.ts === trade.timestamp) return;
      this.lastTrade.set(symbol, { price: trade.price, ts: trade.timestamp });

      orderBookRecorder.recordTradeTick({
        symbol,
        price: trade.price,
        size: 0,
        timestamp: trade.timestamp,
        source: "poll_trade",
      });

      this.broadcastPrice(symbol, trade.price, 0, trade.timestamp);
    } catch { /* silent */ }
    finally {
      this.pollInFlight.delete(symbol);
    }
  }

  private hasAnyListenerForSymbol(symbol: string): boolean {
    for (const key of this.listeners.keys()) {
      if (key.startsWith(`${symbol}:`)) return true;
    }
    return false;
  }
}

export const alpacaStream = new AlpacaStreamManager();
