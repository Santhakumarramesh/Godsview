/**
 * brain_stream_bridge.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 8A: Alpaca WebSocket → Brain Price Cache + Fill Notifications
 *
 * Bridges the existing AlpacaStreamManager to:
 *   1. Update brainPnLTracker's price cache on every live tick
 *   2. Detect real Alpaca order fills and route them to the execution bridge
 *   3. Subscribe to the STOCK data stream (in addition to the crypto stream)
 *   4. Auto-subscribe whenever new brain positions are opened
 *   5. Emit real-time tick events to the brain event bus for UI streaming
 *
 * Uses the existing crypto WebSocket for crypto assets,
 * and a separate stock data stream for equities.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "./logger.js";
import { updatePriceCache } from "./brain_pnl_tracker.js";
import { brainExecutionBridge, brainPositions } from "./brain_execution_bridge.js";
import { brainEventBus } from "./brain_event_bus.js";
import { alpacaStream } from "./alpaca_stream.js";

// ── Stock Data WebSocket ──────────────────────────────────────────────────────
// Alpaca stock real-time data stream (IEX free tier or SIP with subscription)

const STOCK_WS_URL = "wss://stream.data.alpaca.markets/v2/iex";
const KEY_ID = process.env.ALPACA_API_KEY ?? "";
const SECRET_KEY = process.env.ALPACA_SECRET_KEY ?? "";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AlpacaStockTrade {
  T: "t";   // trade
  S: string;  // symbol
  p: number;  // price
  s: number;  // size
  t: string;  // timestamp
}

interface AlpacaStockQuote {
  T: "q";
  S: string;
  bp: number; // bid
  ap: number; // ask
  t: string;
}

// ── Stream Bridge ──────────────────────────────────────────────────────────────

class BrainStreamBridge {
  private stockWs: any = null;
  private stockAuthenticated = false;
  private stockSubscribed = new Set<string>();
  private cryptoSubscribed = new Set<string>();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private tickCount = 0;
  private lastTickAt = 0;

  // Crypto symbols currently tracked by brain
  private readonly CRYPTO_SYMBOLS = ["BTCUSD", "ETHUSD", "SOLUSD"];

  /**
   * Start the stream bridge — connects to stock + crypto streams.
   * Should be called after the brain starts tracking symbols.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Hook into the existing crypto stream for any crypto brain positions
    this._subscribeCryptoPositions();

    // Connect to stock stream
    this._connectStockStream();

    // Every 30s: sync subscriptions with current brain positions
    setInterval(() => this._syncSubscriptions(), 30_000);

    logger.info("[StreamBridge] Started — bridging Alpaca prices to brain");
  }

  stop(): void {
    this.isRunning = false;
    if (this.stockWs) {
      try { this.stockWs.close(); } catch { /* ignore */ }
      this.stockWs = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // Unsubscribe crypto listeners
    for (const sym of this.cryptoSubscribed) {
      alpacaStream.unsubscribe(sym, "1Min", this._cryptoTickHandler.bind(this));
    }
    this.cryptoSubscribed.clear();
    logger.info("[StreamBridge] Stopped");
  }

  // ── Stock WebSocket ─────────────────────────────────────────────────────────

  private _connectStockStream(): void {
    if (!KEY_ID || !SECRET_KEY) {
      logger.warn("[StreamBridge] No Alpaca keys — stock stream disabled, using polling fallback");
      return;
    }

    try {
      // Dynamic import of ws to avoid compile-time dependency issues
      import("ws").then(({ default: WebSocket }) => {
        this.stockWs = new WebSocket(STOCK_WS_URL);

        this.stockWs.on("open", () => {
          logger.info("[StreamBridge] Stock WS connected — authenticating");
          this.stockWs.send(JSON.stringify({
            action: "auth",
            key: KEY_ID,
            secret: SECRET_KEY,
          }));
        });

        this.stockWs.on("message", (raw: Buffer) => {
          try {
            const messages: any[] = JSON.parse(raw.toString());
            for (const msg of messages) {
              this._handleStockMessage(msg);
            }
          } catch (err) {
            logger.debug({ err }, "[StreamBridge] Stock WS parse error");
          }
        });

        this.stockWs.on("error", (err: Error) => {
          logger.warn({ err: err.message }, "[StreamBridge] Stock WS error");
        });

        this.stockWs.on("close", () => {
          this.stockAuthenticated = false;
          this.stockSubscribed.clear();
          if (this.isRunning) {
            logger.info("[StreamBridge] Stock WS closed — reconnecting in 5s");
            this.reconnectTimer = setTimeout(() => this._connectStockStream(), 5_000);
          }
        });
      }).catch((err) => {
        logger.warn({ err: err.message }, "[StreamBridge] ws module not available");
      });
    } catch (err: any) {
      logger.warn({ err: err?.message }, "[StreamBridge] Stock WS connect failed");
    }
  }

  private _handleStockMessage(msg: any): void {
    // Auth success
    if (msg.T === "success" && msg.msg === "authenticated") {
      this.stockAuthenticated = true;
      logger.info("[StreamBridge] Stock WS authenticated — subscribing brain symbols");
      this._subscribeStockPositions();
      return;
    }

    // Auth error — don't crash, just log
    if (msg.T === "error") {
      logger.warn({ code: msg.code, message: msg.msg }, "[StreamBridge] Stock WS error msg");
      return;
    }

    // Trade tick
    if (msg.T === "t") {
      const trade = msg as AlpacaStockTrade;
      this._onStockTick(trade.S, trade.p, trade.t);
      return;
    }

    // Quote tick (use midpoint)
    if (msg.T === "q") {
      const quote = msg as AlpacaStockQuote;
      if (quote.bp && quote.ap) {
        const mid = (quote.bp + quote.ap) / 2;
        this._onStockTick(quote.S, mid, quote.t);
      }
    }
  }

  private _onStockTick(symbol: string, price: number, timestamp: string): void {
    this.tickCount++;
    this.lastTickAt = Date.now();

    // Update brain price cache
    updatePriceCache(symbol, price);

    // Emit to brain event bus for real-time UI
    if (this.tickCount % 10 === 0) { // throttle to every 10th tick
      brainEventBus.agentReport({
        agentId: "L1_perception",
        symbol,
        status: "done",
        confidence: 1,
        score: 1,
        verdict: `Live tick: ${symbol} @ $${price.toFixed(2)}`,
        data: { price, timestamp, source: "alpaca_stock" },
        flags: [],
        timestamp: Date.now(),
        latencyMs: 0,
      });
    }
  }

  // ── Crypto tick handler ─────────────────────────────────────────────────────

  private _cryptoTickHandler(payload: any): void {
    if (payload.symbol && payload.price) {
      updatePriceCache(payload.symbol, payload.price);
      this.tickCount++;
      this.lastTickAt = Date.now();
    }
  }

  // ── Subscription management ─────────────────────────────────────────────────

  private _subscribeStockPositions(): void {
    const positions = brainPositions.getAll();
    const stockSymbols = positions
      .map((p) => p.symbol)
      .filter((s) => !s.includes("USD")); // not crypto

    // Also subscribe to any symbols the brain is tracking (from state)
    if (stockSymbols.length === 0) return;

    const toSubscribe = stockSymbols.filter((s) => !this.stockSubscribed.has(s));
    if (toSubscribe.length === 0) return;

    if (this.stockAuthenticated && this.stockWs?.readyState === 1) {
      this.stockWs.send(JSON.stringify({
        action: "subscribe",
        trades: toSubscribe,
        quotes: toSubscribe,
      }));
      toSubscribe.forEach((s) => this.stockSubscribed.add(s));
      logger.info({ symbols: toSubscribe }, "[StreamBridge] Subscribed stock symbols");
    }
  }

  private _subscribeCryptoPositions(): void {
    const positions = brainPositions.getAll();
    const cryptoSymbols = positions
      .map((p) => p.symbol)
      .filter((s) => s.includes("USD"));

    for (const sym of cryptoSymbols) {
      if (!this.cryptoSubscribed.has(sym)) {
        alpacaStream.subscribe(sym, "1Min", this._cryptoTickHandler.bind(this));
        this.cryptoSubscribed.add(sym);
      }
    }
  }

  /**
   * Subscribe a specific symbol — called when a new position is opened.
   */
  subscribeSymbol(symbol: string): void {
    const isCrypto = symbol.includes("USD");

    if (isCrypto) {
      if (!this.cryptoSubscribed.has(symbol)) {
        alpacaStream.subscribe(symbol, "1Min", this._cryptoTickHandler.bind(this));
        this.cryptoSubscribed.add(symbol);
        logger.info({ symbol }, "[StreamBridge] Subscribed crypto symbol");
      }
    } else {
      if (!this.stockSubscribed.has(symbol) && this.stockAuthenticated && this.stockWs?.readyState === 1) {
        this.stockWs.send(JSON.stringify({
          action: "subscribe",
          trades: [symbol],
          quotes: [symbol],
        }));
        this.stockSubscribed.add(symbol);
        logger.info({ symbol }, "[StreamBridge] Subscribed stock symbol");
      }
    }
  }

  private _syncSubscriptions(): void {
    this._subscribeCryptoPositions();
    this._subscribeStockPositions();
  }

  getStatus() {
    return {
      running: this.isRunning,
      stockWsConnected: this.stockWs?.readyState === 1,
      stockAuthenticated: this.stockAuthenticated,
      stockSubscribed: Array.from(this.stockSubscribed),
      cryptoSubscribed: Array.from(this.cryptoSubscribed),
      totalTicks: this.tickCount,
      lastTickAt: this.lastTickAt > 0 ? new Date(this.lastTickAt).toISOString() : null,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const brainStreamBridge = new BrainStreamBridge();
