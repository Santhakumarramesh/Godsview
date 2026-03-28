// Alpaca real-time WebSocket stream manager
// Connects to wss://stream.data.alpaca.markets/v1beta3/crypto/us
// Streams live trade ticks + quotes → aggregates into candles → broadcasts to SSE clients

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
  // Last quote ts per symbol to deduplicate
  private lastQuoteTs = new Map<string, string>();

  // Fallback polling (used if WebSocket auth fails)
  private pollingMode = false;
  private pollTimers = new Map<string, ReturnType<typeof setInterval>>();
  private lastTrade = new Map<string, { price: number; ts: string }>();

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
    console.log("[stream] starting WS connection to Alpaca crypto stream");
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

    console.log(`[stream] subscribe ${key} | authenticated=${this.authenticated} wsState=${this.ws?.readyState} pollingMode=${this.pollingMode}`);

    // If already connected and authenticated, subscribe the new symbol immediately
    if (!this.pollingMode && this.authenticated && this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscribe([toAlpacaSlash(symbol)]);
    } else if (this.pollingMode) {
      this.ensurePolling(symbol);
    } else {
      // WS connecting or not yet authenticated — subscription will be sent after auth
      console.log(`[stream] WS not ready yet, will subscribe ${symbol} after auth`);
    }
  }

  unsubscribe(symbol: string, timeframe: string, listener: TickListener) {
    const key = `${symbol}:${timeframe}`;
    this.listeners.get(key)?.delete(listener);
  }

  private connect() {
    if (this.stopped) return;
    console.log(`[stream] connecting to ${WS_URL}`);
    try {
      const ws = new WebSocket(WS_URL);
      this.ws = ws;

      ws.on("open", () => {
        this.reconnectDelay = 1000;
        this.wsConnectedAt = Date.now();
        console.log("[stream] WS open — sending auth");
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
        console.error("[stream] WS error:", e.message);
        this.scheduleReconnect();
      });
      ws.on("close", (code, reason) => {
        this.authenticated = false;
        console.log(`[stream] WS closed code=${code} reason=${reason?.toString()} — reconnecting`);
        this.scheduleReconnect();
      });
    } catch (e) {
      console.error("[stream] connect error:", e);
      this.scheduleReconnect();
    }
  }

  private handleMessage(msg: Record<string, unknown>) {
    const T = msg.T as string;

    if (T === "success" && msg.msg === "connected") {
      console.log("[stream] connected to Alpaca");
      return;
    }

    if (T === "success" && msg.msg === "authenticated") {
      this.authenticated = true;
      this.pollingMode = false;
      console.log("[stream] authenticated OK");

      // Subscribe to all symbols currently tracked
      const symbols = new Set<string>();
      for (const key of this.listeners.keys()) {
        symbols.add(toAlpacaSlash(key.split(":")[0]));
      }
      if (symbols.size > 0) {
        console.log(`[stream] re-subscribing after auth: ${[...symbols].join(", ")}`);
        this.sendSubscribe([...symbols]);
      } else {
        console.log("[stream] no listeners to subscribe yet");
      }
      return;
    }

    if (T === "subscription") {
      console.log("[stream] subscription confirmed:", JSON.stringify(msg));
      return;
    }

    if (T === "error") {
      const code = msg.code as number;
      const errMsg = msg.msg as string;
      console.error(`[stream] Alpaca error code=${code} msg=${errMsg}`);

      // 406 = connection limit exceeded — this is our second connection attempt from outside; ignore
      if (code === 406) {
        console.warn("[stream] connection limit error — this means a second WS connection was attempted. Ignoring.");
        return;
      }

      // Auth failed — fall back to polling
      console.warn("[stream] auth failed, falling back to REST polling at 500ms");
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

      // Deduplicate trades
      const prevTs = this.lastTradeTs.get(symbol);
      if (prevTs === timestamp) return;
      this.lastTradeTs.set(symbol, timestamp);

      this.ticksReceived++;
      if (this.ticksReceived <= 5 || this.ticksReceived % 100 === 0) {
        console.log(`[stream] TRADE tick #${this.ticksReceived} ${symbol} $${price} @ ${timestamp}`);
      }

      this.broadcastPrice(symbol, price, volume, timestamp);
    }

    if (T === "q") {
      // Quote: { T: "q", S: "BTC/USD", bp: 66700, ap: 66701, bx: "...", ax: "...", t: "..." }
      // Use midpoint as price for zero-latency updates
      const alpacaSym = String(msg.S ?? "");
      const symbol = fromAlpacaSlash(alpacaSym);
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
        console.log(`[stream] QUOTE tick #${this.quotesReceived} ${symbol} mid=$${price.toFixed(2)} @ ${timestamp}`);
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
      console.warn("[stream] sendSubscribe called but WS not open");
      return;
    }
    // Subscribe to both trades AND quotes for minimum latency
    const msg = { action: "subscribe", trades: alpacaSymbols, quotes: alpacaSymbols };
    console.log("[stream] sending subscribe:", JSON.stringify(msg));
    this.ws.send(JSON.stringify(msg));
  }

  private scheduleReconnect() {
    if (this.stopped || this.pollingMode) return;
    if (this.reconnectTimer) return;
    console.log(`[stream] scheduling reconnect in ${this.reconnectDelay}ms`);
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
    console.log(`[stream] starting REST fallback poll for ${symbol} at 500ms`);
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

      this.broadcastPrice(symbol, trade.price, 0, trade.timestamp);
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
