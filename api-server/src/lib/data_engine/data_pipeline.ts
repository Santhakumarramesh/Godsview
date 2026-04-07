/**
 * Phase 93 — Multi-Source Data Pipeline
 *
 * Orchestrates data ingestion from multiple sources:
 * - Alpaca (price bars, quotes, trades)
 * - Order book (L2 via WebSocket)
 * - Macro (FRED, VIX, DXY)
 * - Sentiment (news, social)
 *
 * Normalizes, aligns, and delivers data to the brain layers.
 */
import { EventEmitter } from "events";
import { OrderBookManager, type OrderBookState, type OrderBookMetrics } from "./order_book_manager.js";
import { VolumeDeltaCalculator, type VolumeDeltaBar, type ImbalanceAlert, type TradeTickInput } from "./volume_delta_calculator.js";

export interface DataSourceConfig {
  name: string;
  type: "price" | "orderbook" | "macro" | "sentiment" | "fundamental";
  enabled: boolean;
  pollIntervalMs?: number;
  wsUrl?: string;
}

export interface AlignedMarketSnapshot {
  symbol: string;
  ts: Date;
  // Price data
  price: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number;
  // Order book metrics
  orderBook: {
    midpoint: number;
    spread: number;
    spreadBps: number;
    imbalanceRatio: number;
    microPressure: number;
    bidDepth: number;
    askDepth: number;
  } | null;
  // Volume delta
  volumeDelta: {
    delta: number;
    cumulativeDelta: number;
    deltaPercent: number;
    aggressiveBuyPct: number;
    aggressiveSellPct: number;
  } | null;
  // Macro context
  macro: {
    vix: number | null;
    dxy: number | null;
    us10y: number | null;
    spyChange: number | null;
  };
  // Sentiment
  sentiment: {
    newsScore: number;
    socialScore: number;
    overallSentiment: "bullish" | "bearish" | "neutral";
  };
  // Data quality
  dataQuality: {
    sourcesActive: number;
    sourcesTotal: number;
    staleness: Record<string, number>; // ms since last update per source
    overallScore: number; // 0-1
  };
}

export interface PipelineConfig {
  symbols: string[];
  dataSources: DataSourceConfig[];
  snapshotIntervalMs: number;
  maxStalenessMs: number;
}

const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  symbols: [],
  dataSources: [
    { name: "alpaca_bars", type: "price", enabled: true, pollIntervalMs: 1000 },
    { name: "alpaca_quotes", type: "price", enabled: true },
    { name: "order_book", type: "orderbook", enabled: true },
    { name: "fred_macro", type: "macro", enabled: true, pollIntervalMs: 300_000 },
    { name: "news_sentiment", type: "sentiment", enabled: true, pollIntervalMs: 60_000 },
  ],
  snapshotIntervalMs: 1000,
  maxStalenessMs: 30_000,
};

/**
 * DataPipeline — orchestrates all data sources into unified snapshots
 *
 * Events:
 * - 'snapshot': (symbol, snapshot: AlignedMarketSnapshot)
 * - 'alert': (alert: ImbalanceAlert)
 * - 'source:connected': (sourceName)
 * - 'source:disconnected': (sourceName)
 * - 'quality:degraded': (symbol, score)
 */
export class DataPipeline extends EventEmitter {
  private config: PipelineConfig;
  private orderBookManager: OrderBookManager;
  private deltaCalculators: Map<string, VolumeDeltaCalculator> = new Map();
  private latestPrices: Map<string, { price: number; open: number; high: number; low: number; close: number; volume: number; vwap: number; ts: Date }> = new Map();
  private latestMacro: { vix: number | null; dxy: number | null; us10y: number | null; spyChange: number | null } = { vix: null, dxy: null, us10y: null, spyChange: null };
  private latestSentiment: Map<string, { newsScore: number; socialScore: number; ts: Date }> = new Map();
  private sourceLastUpdate: Map<string, Date> = new Map();
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  constructor(config: Partial<PipelineConfig> = {}) {
    super();
    this.config = { ...DEFAULT_PIPELINE_CONFIG, ...config };
    this.orderBookManager = new OrderBookManager({ symbols: this.config.symbols });
  }

  /** Start all data feeds */
  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // Initialize delta calculators per symbol
    for (const symbol of this.config.symbols) {
      this.deltaCalculators.set(symbol, new VolumeDeltaCalculator(symbol));
    }

    // Connect order book
    const obSource = this.config.dataSources.find((s) => s.name === "order_book");
    if (obSource?.enabled) {
      this.orderBookManager.on("metrics", (_symbol: string, metrics: OrderBookMetrics) => {
        this.sourceLastUpdate.set("order_book", new Date());
      });
      this.orderBookManager.on("update", (symbol: string, _state: OrderBookState) => {
        this.sourceLastUpdate.set(`order_book:${symbol}`, new Date());
      });
      await this.orderBookManager.connect();
      this.emit("source:connected", "order_book");
    }

    // Start snapshot timer
    this.snapshotTimer = setInterval(() => {
      for (const symbol of this.config.symbols) {
        const snapshot = this.buildSnapshot(symbol);
        this.emit("snapshot", symbol, snapshot);
      }
    }, this.config.snapshotIntervalMs);
  }

  /** Ingest a price bar update */
  updatePrice(symbol: string, bar: { open: number; high: number; low: number; close: number; volume: number; vwap: number }): void {
    this.latestPrices.set(symbol, { ...bar, price: bar.close, ts: new Date() });
    this.sourceLastUpdate.set(`price:${symbol}`, new Date());
  }

  /** Ingest a trade tick */
  processTradeTick(tick: TradeTickInput): void {
    const calc = this.deltaCalculators.get(tick.symbol);
    if (!calc) return;

    const result = calc.processTick(tick);
    for (const alert of result.alerts) {
      this.emit("alert", alert);
    }
    this.sourceLastUpdate.set(`ticks:${tick.symbol}`, new Date());
  }

  /** Ingest order book update */
  updateOrderBook(symbol: string, bids: [number, number][], asks: [number, number][]): void {
    this.orderBookManager.processQuoteUpdate(symbol, bids, asks);
  }

  /** Update macro indicators */
  updateMacro(data: Partial<typeof this.latestMacro>): void {
    Object.assign(this.latestMacro, data);
    this.sourceLastUpdate.set("macro", new Date());
  }

  /** Update sentiment for a symbol */
  updateSentiment(symbol: string, newsScore: number, socialScore: number): void {
    this.latestSentiment.set(symbol, { newsScore, socialScore, ts: new Date() });
    this.sourceLastUpdate.set(`sentiment:${symbol}`, new Date());
  }

  /** Build a unified snapshot for a symbol */
  private buildSnapshot(symbol: string): AlignedMarketSnapshot {
    const now = new Date();
    const price = this.latestPrices.get(symbol);
    const book = this.orderBookManager.getBook(symbol);
    const deltaCalc = this.deltaCalculators.get(symbol);
    const sentiment = this.latestSentiment.get(symbol);

    // Compute data quality
    const sources = ["price", "order_book", "ticks", "macro", "sentiment"];
    const staleness: Record<string, number> = {};
    let activeCount = 0;

    for (const src of sources) {
      const key = src === "macro" ? "macro" : `${src}:${symbol}`;
      const lastUpdate = this.sourceLastUpdate.get(key);
      const staleMs = lastUpdate ? now.getTime() - lastUpdate.getTime() : Infinity;
      staleness[src] = staleMs;
      if (staleMs < this.config.maxStalenessMs) activeCount++;
    }

    const qualityScore = activeCount / sources.length;

    // Get latest volume delta bar
    const completedBars = deltaCalc?.getCompletedBars() ?? [];
    const latestDelta = completedBars.length > 0 ? completedBars[completedBars.length - 1] : null;

    const newsScore = sentiment?.newsScore ?? 0;
    const socialScore = sentiment?.socialScore ?? 0;
    const avgSentiment = (newsScore + socialScore) / 2;

    return {
      symbol,
      ts: now,
      price: price?.price ?? 0,
      open: price?.open ?? 0,
      high: price?.high ?? 0,
      low: price?.low ?? 0,
      close: price?.close ?? 0,
      volume: price?.volume ?? 0,
      vwap: price?.vwap ?? 0,
      orderBook: book ? {
        midpoint: book.midpoint,
        spread: book.spread,
        spreadBps: book.spreadBps,
        imbalanceRatio: book.imbalanceRatio,
        microPressure: 0, // computed from metrics
        bidDepth: book.bidDepth10,
        askDepth: book.askDepth10,
      } : null,
      volumeDelta: latestDelta ? {
        delta: latestDelta.delta,
        cumulativeDelta: latestDelta.cumulativeDelta,
        deltaPercent: latestDelta.deltaPercent,
        aggressiveBuyPct: latestDelta.aggressiveBuyPct,
        aggressiveSellPct: latestDelta.aggressiveSellPct,
      } : null,
      macro: { ...this.latestMacro },
      sentiment: {
        newsScore,
        socialScore,
        overallSentiment: avgSentiment > 0.2 ? "bullish" : avgSentiment < -0.2 ? "bearish" : "neutral",
      },
      dataQuality: {
        sourcesActive: activeCount,
        sourcesTotal: sources.length,
        staleness,
        overallScore: qualityScore,
      },
    };
  }

  /** Get current snapshot without waiting for timer */
  getSnapshot(symbol: string): AlignedMarketSnapshot {
    return this.buildSnapshot(symbol);
  }

  /** Get volume delta calculator for a symbol */
  getDeltaCalculator(symbol: string): VolumeDeltaCalculator | undefined {
    return this.deltaCalculators.get(symbol);
  }

  /** Get order book manager */
  getOrderBookManager(): OrderBookManager {
    return this.orderBookManager;
  }

  /** Add symbols dynamically */
  addSymbols(symbols: string[]): void {
    for (const symbol of symbols) {
      if (!this.config.symbols.includes(symbol)) {
        this.config.symbols.push(symbol);
        this.deltaCalculators.set(symbol, new VolumeDeltaCalculator(symbol));
      }
    }
    this.orderBookManager.addSymbols(symbols);
  }

  /** Stop all feeds */
  async stop(): Promise<void> {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    await this.orderBookManager.disconnect();
    this.isRunning = false;
  }

  get running(): boolean {
    return this.isRunning;
  }
}
