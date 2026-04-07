/**
 * Phase 97 — Signal Ingestion Layer
 *
 * Receives raw webhooks from TradingView, validates, normalizes,
 * and queues them for MCP processing. Also handles synthetic signals
 * from internal generators and backtest replays.
 */
import { EventEmitter } from "events";
import {
  TradingViewWebhookSchema,
  StandardSignalSchema,
  type TradingViewWebhook,
  type StandardSignal,
  type MCPPipelineConfig,
} from "./types.js";

export interface IngestionStats {
  totalReceived: number;
  totalAccepted: number;
  totalRejected: number;
  totalExpired: number;
  avgProcessingMs: number;
  bySource: Record<string, number>;
  bySignalType: Record<string, number>;
  bySymbol: Record<string, number>;
  recentErrors: { ts: Date; error: string; payload?: unknown }[];
}

/**
 * SignalIngestion — validates and normalizes incoming signals
 *
 * Events:
 * - 'signal': (signal: StandardSignal) — valid signal ready for processing
 * - 'rejected': (reason: string, payload: unknown) — rejected signal
 * - 'expired': (signal: StandardSignal) — signal expired before processing
 */
export class SignalIngestion extends EventEmitter {
  private config: MCPPipelineConfig;
  private stats: IngestionStats;
  private signalCounter = 0;
  private recentSignals: Map<string, StandardSignal> = new Map();
  private maxRecentSignals = 1000;

  constructor(config: MCPPipelineConfig) {
    super();
    this.config = config;
    this.stats = {
      totalReceived: 0,
      totalAccepted: 0,
      totalRejected: 0,
      totalExpired: 0,
      avgProcessingMs: 0,
      bySource: {},
      bySignalType: {},
      bySymbol: {},
      recentErrors: [],
    };
  }

  /** Ingest a raw TradingView webhook payload */
  ingestTradingView(rawPayload: unknown): StandardSignal | null {
    const startMs = Date.now();
    this.stats.totalReceived++;
    this.stats.bySource["tradingview"] = (this.stats.bySource["tradingview"] ?? 0) + 1;

    // 1. Validate payload
    const parsed = TradingViewWebhookSchema.safeParse(rawPayload);
    if (!parsed.success) {
      const reason = `Validation failed: ${parsed.error.issues.map((i) => i.message).join(", ")}`;
      this.reject(reason, rawPayload);
      return null;
    }

    const webhook = parsed.data;

    // 2. Authenticate
    if (this.config.webhookPassphrase && webhook.passphrase !== this.config.webhookPassphrase) {
      this.reject("Invalid passphrase", rawPayload);
      return null;
    }

    // 3. Check signal age
    const signalAge = (Date.now() / 1000) - webhook.timestamp;
    if (signalAge > this.config.maxSignalAgeSec) {
      this.reject(`Signal too old: ${signalAge.toFixed(0)}s (max ${this.config.maxSignalAgeSec}s)`, rawPayload);
      return null;
    }

    // 4. Check for duplicates (same symbol + signal + timeframe within 60s)
    const dedupeKey = `${webhook.symbol}:${webhook.signal}:${webhook.timeframe}`;
    const existing = this.recentSignals.get(dedupeKey);
    if (existing && Date.now() - existing.receivedAt.getTime() < 60_000) {
      this.reject(`Duplicate signal within 60s: ${dedupeKey}`, rawPayload);
      return null;
    }

    // 5. Normalize to standard format
    const signal = this.normalize(webhook, "tradingview", rawPayload);

    // 6. Track
    this.stats.totalAccepted++;
    this.stats.bySignalType[webhook.signal] = (this.stats.bySignalType[webhook.signal] ?? 0) + 1;
    this.stats.bySymbol[webhook.symbol] = (this.stats.bySymbol[webhook.symbol] ?? 0) + 1;
    this.recentSignals.set(dedupeKey, signal);

    // Prune old signals
    if (this.recentSignals.size > this.maxRecentSignals) {
      const oldest = Array.from(this.recentSignals.entries())
        .sort((a, b) => a[1].receivedAt.getTime() - b[1].receivedAt.getTime())[0];
      if (oldest) this.recentSignals.delete(oldest[0]);
    }

    signal.processingMs = Date.now() - startMs;
    this.updateAvgProcessing(signal.processingMs);
    this.emit("signal", signal);
    return signal;
  }

  /** Ingest a signal from internal strategy generator */
  ingestInternal(
    symbol: string,
    direction: "long" | "short" | "none",
    signalType: string,
    timeframe: string,
    price: number,
    stopLoss?: number,
    takeProfit?: number,
    strategyName?: string,
  ): StandardSignal {
    this.stats.totalReceived++;
    this.stats.totalAccepted++;
    this.stats.bySource["internal"] = (this.stats.bySource["internal"] ?? 0) + 1;

    const signal = this.normalize({
      symbol,
      signal: signalType as TradingViewWebhook["signal"],
      timeframe: timeframe as TradingViewWebhook["timeframe"],
      price,
      timestamp: Math.floor(Date.now() / 1000),
      direction,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      strategy_name: strategyName,
    }, "internal", null);

    this.emit("signal", signal);
    return signal;
  }

  /** Ingest a signal for backtest replay */
  ingestBacktest(
    symbol: string,
    direction: "long" | "short" | "none",
    signalType: string,
    timeframe: string,
    price: number,
    timestamp: Date,
    stopLoss?: number,
    takeProfit?: number,
    strategyName?: string,
  ): StandardSignal {
    this.stats.totalReceived++;
    this.stats.totalAccepted++;
    this.stats.bySource["backtest"] = (this.stats.bySource["backtest"] ?? 0) + 1;

    const signal = this.normalize({
      symbol,
      signal: signalType as TradingViewWebhook["signal"],
      timeframe: timeframe as TradingViewWebhook["timeframe"],
      price,
      timestamp: Math.floor(timestamp.getTime() / 1000),
      direction,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      strategy_name: strategyName,
    }, "backtest", null);

    signal.timestamp = timestamp;
    return signal;
  }

  /** Normalize webhook → StandardSignal */
  private normalize(
    webhook: TradingViewWebhook,
    source: StandardSignal["source"],
    rawPayload: unknown,
  ): StandardSignal {
    this.signalCounter++;
    const id = `sig_${source}_${Date.now()}_${this.signalCounter}`;

    return {
      id,
      source,
      rawPayload,
      symbol: webhook.symbol.toUpperCase(),
      direction: webhook.direction === "neutral" ? "none" : webhook.direction,
      signalType: webhook.signal,
      timeframe: webhook.timeframe,
      price: webhook.price,
      stopLoss: webhook.stop_loss ?? null,
      takeProfit: webhook.take_profit ?? null,
      timestamp: new Date(webhook.timestamp * 1000),
      strategyName: webhook.strategy_name ?? null,
      status: "received",
      receivedAt: new Date(),
      processingMs: 0,
    };
  }

  private reject(reason: string, payload: unknown): void {
    this.stats.totalRejected++;
    this.stats.recentErrors.push({ ts: new Date(), error: reason, payload });
    if (this.stats.recentErrors.length > 100) this.stats.recentErrors.shift();
    this.emit("rejected", reason, payload);
  }

  private updateAvgProcessing(ms: number): void {
    const total = this.stats.totalAccepted;
    this.stats.avgProcessingMs =
      (this.stats.avgProcessingMs * (total - 1) + ms) / total;
  }

  /** Get ingestion statistics */
  getStats(): IngestionStats {
    return { ...this.stats };
  }

  /** Get a signal by ID */
  getSignal(id: string): StandardSignal | undefined {
    for (const signal of this.recentSignals.values()) {
      if (signal.id === id) return signal;
    }
    return undefined;
  }

  /** Update config */
  updateConfig(config: Partial<MCPPipelineConfig>): void {
    Object.assign(this.config, config);
  }
}
