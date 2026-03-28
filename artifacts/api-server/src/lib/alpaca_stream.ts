// Alpaca real-time WebSocket stream manager
// Connects to wss://stream.data.alpaca.markets/v1beta3/crypto/us
// Streams live trade ticks → aggregates into candles → broadcasts to SSE clients

import WebSocket from "ws";

const WS_URL = "wss://stream.data.alpaca.markets/v1beta3/crypto/us";
const KEY_ID = process.env.ALPACA_API_KEY ?? "";
const SECRET_KEY = process.env.ALPACA_SECRET_KEY ?? "";

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
  private reconnectDelay = 1000;
  private stopped = false;

  // Listeners: "BTCUSD:5Min" → Set<listener>
  private listeners = new Map<string, Set<TickListener>>();
  // Live candle state: "BTCUSD:5Min" → LiveCandle
  private candles = new Map<string, LiveCandle>();
  // Last trade ts per symbol to deduplicate
  private lastTradeTs = new Map<string, string>();

  // Fallback polling (used if WebSocket auth fails)
  private pollingMode = false;
  private pollTimers = new Map<string, ReturnType<typeof setInterval>>();
  private lastTrade = new Map<string, { price: number; ts: string }>();

  start() {
    if (this.ws || this.stopped) return;
    this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    for (const t of this.pollTimers.values()) clearInterval(t);
    this.pollTimers.clear();
  }

  subscribe(symbol: string, timeframe: string, listener: TickListener) {
    const key = `${symbol}:${timeframe}`;
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key)!.add(listener);

    // If already connected, subscribe the new symbol
    if (!this.pollingMode && this.authenticated && this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscribe([toAlpacaSlash(symbol)]);
    } else if (this.pollingMode) {
      this.ensurePolling(symbol);
    }
  }

  unsubscribe(symbol: string, timeframe: string, listener: TickListener) {
    const key = `${symbol}:${timeframe}`;
    this.listeners.get(key)?.delete(listener);
  }

  private connect() {
    if (this.stopped) return;
    try {
      const ws = new WebSocket(WS_URL);
      this.ws = ws;

      ws.on("open", () => {
        this.reconnectDelay = 1000;
        // Auth
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

      ws.on("error", () => this.scheduleReconnect());
      ws.on("close", () => { this.authenticated = false; this.scheduleReconnect(); });
    } catch {
      this.scheduleReconnect();
    }
  }

  private handleMessage(msg: Record<string, unknown>) {
    const T = msg.T as string;

    if (T === "success" && msg.msg === "connected") return;

    if (T === "success" && msg.msg === "authenticated") {
      this.authenticated = true;
      this.pollingMode = false;
      // Subscribe to all symbols currently tracked
      const symbols = new Set<string>();
      for (const key of this.listeners.keys()) {
        symbols.add(toAlpacaSlash(key.split(":")[0]));
      }
      if (symbols.size > 0) this.sendSubscribe([...symbols]);
      return;
    }

    if (T === "error") {
      // Auth failed (e.g., broker key) — fall back to polling
      this.pollingMode = true;
      this.ws?.close();
      this.ws = null;
      this.startFallbackPolling();
      return;
    }

    if (T === "t") {
      // Trade tick: { T: "t", S: "BTC/USD", p: 66700.5, s: 0.001, t: "..." }
      const alpacaSym = String(msg.S ?? "");
      const symbol = fromAlpacaSlash(alpacaSym);
      const price = Number(msg.p ?? 0);
      const volume = Number(msg.s ?? 0);
      const timestamp = String(msg.t ?? "");

      if (!symbol || !price) return;

      // Deduplicate
      const prevTs = this.lastTradeTs.get(symbol);
      if (prevTs === timestamp) return;
      this.lastTradeTs.set(symbol, timestamp);

      const tMs = new Date(timestamp).getTime();

      // Update candle for each subscribed timeframe of this symbol
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
  }

  private sendSubscribe(alpacaSymbols: string[]) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ action: "subscribe", trades: alpacaSymbols }));
  }

  private scheduleReconnect() {
    if (this.stopped || this.pollingMode) return;
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ws = null;
      this.authenticated = false;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
  }

  // ── Fallback: poll REST every 500ms when WebSocket auth fails ────────────
  private startFallbackPolling() {
    const symbols = new Set<string>();
    for (const key of this.listeners.keys()) symbols.add(key.split(":")[0]);
    for (const sym of symbols) this.ensurePolling(sym);
  }

  private ensurePolling(symbol: string) {
    if (!this.pollingMode || this.pollTimers.has(symbol)) return;
    const timer = setInterval(() => this.pollSymbol(symbol), 500);
    this.pollTimers.set(symbol, timer);
  }

  private async pollSymbol(symbol: string) {
    try {
      const { getLatestTrade } = await import("./alpaca.js");
      const trade = await getLatestTrade(toAlpacaSlash(symbol));
      if (!trade) return;

      const prev = this.lastTrade.get(symbol);
      if (prev && prev.ts === trade.timestamp) return;
      this.lastTrade.set(symbol, { price: trade.price, ts: trade.timestamp });

      const tMs = new Date(trade.timestamp).getTime();

      for (const [key, listeners] of this.listeners) {
        const [keySym, keyTf] = key.split(":");
        if (keySym !== symbol || !listeners.size) continue;

        const bucket = candleBucket(tMs, keyTf);
        const existing = this.candles.get(key);
        let candle: LiveCandle;
        if (!existing || existing.time !== bucket) {
          candle = { time: bucket, open: trade.price, high: trade.price, low: trade.price, close: trade.price, volume: 0 };
        } else {
          candle = { ...existing, high: Math.max(existing.high, trade.price), low: Math.min(existing.low, trade.price), close: trade.price };
        }
        this.candles.set(key, candle);

        const payload: TickPayload = { type: "tick", symbol, price: trade.price, timestamp: trade.timestamp, candle };
        for (const fn of listeners) {
          try { fn(payload); } catch { /* ignore */ }
        }
      }
    } catch { /* silent */ }
  }
}

function toAlpacaSlash(sym: string): string {
  if (sym === "BTCUSD") return "BTC/USD";
  if (sym === "ETHUSD") return "ETH/USD";
  return sym;
}

function fromAlpacaSlash(sym: string): string {
  if (sym === "BTC/USD") return "BTCUSD";
  if (sym === "ETH/USD") return "ETHUSD";
  return sym.replace("/", "");
}

export const alpacaStream = new AlpacaStreamManager();
