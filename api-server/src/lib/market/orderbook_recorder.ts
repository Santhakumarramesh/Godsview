import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { logger } from "../logger";
import { normalizeMarketSymbol } from "./symbols";
import type { OrderBookSnapshot, PriceLevel } from "./types";

export type TradeTickSource = "ws_trade" | "poll_trade";

export interface TradeTickRecord {
  symbol: string;
  price: number;
  size: number;
  timestamp: string;
  receivedAt: number;
  source: TradeTickSource;
}

export interface OrderBookFrame {
  symbol: string;
  timestamp: string;
  receivedAt: number;
  source: OrderBookSnapshot["source"];
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  bids: PriceLevel[];
  asks: PriceLevel[];
}

export interface OrderBookReplayWindow {
  symbol: string;
  start: string;
  end: string;
  durationMs: number;
  stats: {
    rawFrames: number;
    rawTicks: number;
    emittedFrames: number;
    emittedTicks: number;
    frameCompressionRatio: number;
    tickCompressionRatio: number;
    downsampleMs: number | null;
  };
  frames: OrderBookFrame[];
  ticks: TradeTickRecord[];
}

export interface RecorderStatus {
  maxAgeMs: number;
  frameDepth: number;
  maxFramesPerSymbol: number;
  maxTicksPerSymbol: number;
  persistenceEnabled: boolean;
  symbols: Array<{
    symbol: string;
    frameCount: number;
    tickCount: number;
    oldestFrameAt: number | null;
    newestFrameAt: number | null;
    oldestTickAt: number | null;
    newestTickAt: number | null;
  }>;
}

type ReplayRequest = {
  symbol: string;
  startMs: number;
  endMs: number;
  downsampleMs?: number;
  maxFrames: number;
  maxTicks: number;
  includeTicks: boolean;
};

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function cloneLevels(levels: PriceLevel[], depth: number): PriceLevel[] {
  return levels.slice(0, depth).map((l) => ({ price: l.price, size: l.size }));
}

function evenlySample<T>(items: T[], maxItems: number): T[] {
  if (maxItems <= 0) return [];
  if (items.length <= maxItems) return items;
  if (maxItems === 1) return [items[items.length - 1]!];

  const sampled: T[] = [];
  const step = (items.length - 1) / (maxItems - 1);
  for (let i = 0; i < maxItems; i++) {
    const idx = Math.round(i * step);
    sampled.push(items[idx]!);
  }
  return sampled;
}

function downsampleFramesByBucket(
  frames: OrderBookFrame[],
  startMs: number,
  bucketMs: number,
): OrderBookFrame[] {
  if (frames.length <= 2 || bucketMs <= 1) return frames;

  const byBucket = new Map<number, OrderBookFrame>();
  for (const frame of frames) {
    const bucket = Math.floor((frame.receivedAt - startMs) / bucketMs);
    byBucket.set(bucket, frame);
  }

  const sampled = [...byBucket.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, frame]) => frame);

  if (!sampled.length) return sampled;
  const first = frames[0]!;
  const last = frames[frames.length - 1]!;
  if (sampled[0] !== first) sampled.unshift(first);
  if (sampled[sampled.length - 1] !== last) sampled.push(last);
  return sampled;
}

class OrderBookRecorder {
  private readonly framesBySymbol = new Map<string, OrderBookFrame[]>();
  private readonly ticksBySymbol = new Map<string, TradeTickRecord[]>();
  private readonly maxAgeMs = envInt("ORDERBOOK_RECORDER_MAX_AGE_MS", 24 * 60 * 60 * 1000, 60_000, 14 * 24 * 60 * 60 * 1000);
  private readonly frameDepth = envInt("ORDERBOOK_REPLAY_LEVEL_DEPTH", 30, 5, 100);
  private readonly maxFramesPerSymbol = envInt("ORDERBOOK_RECORDER_MAX_FRAMES_PER_SYMBOL", 150_000, 5_000, 2_000_000);
  private readonly maxTicksPerSymbol = envInt("ORDERBOOK_RECORDER_MAX_TICKS_PER_SYMBOL", 300_000, 5_000, 4_000_000);
  private readonly persistDir = (process.env.ORDERBOOK_RECORDER_PERSIST_DIR ?? "").trim();
  private readonly persistenceEnabled = this.persistDir.length > 0;

  private persistReady = false;
  private persistQueue: Promise<void> = Promise.resolve();

  recordSnapshot(snapshot: OrderBookSnapshot): void {
    const symbol = normalizeMarketSymbol(snapshot.symbol);
    const asks = cloneLevels(snapshot.asks, this.frameDepth);
    const bids = cloneLevels(snapshot.bids, this.frameDepth);
    const bestAsk = asks[0]?.price ?? null;
    const bestBid = bids[0]?.price ?? null;
    const spread = bestAsk !== null && bestBid !== null ? bestAsk - bestBid : null;

    const frame: OrderBookFrame = {
      symbol,
      timestamp: snapshot.timestamp,
      receivedAt: snapshot.receivedAt,
      source: snapshot.source,
      bestAsk,
      bestBid,
      spread,
      asks,
      bids,
    };

    const buffer = this.ensureFrameBuffer(symbol);
    const previous = buffer[buffer.length - 1];
    if (
      previous &&
      previous.timestamp === frame.timestamp &&
      previous.bestAsk === frame.bestAsk &&
      previous.bestBid === frame.bestBid &&
      previous.asks[0]?.size === frame.asks[0]?.size &&
      previous.bids[0]?.size === frame.bids[0]?.size
    ) {
      return;
    }

    buffer.push(frame);
    this.trimByTimeAndCount(buffer, this.maxFramesPerSymbol);

    this.queuePersist("frames", symbol, frame);
  }

  recordTradeTick(input: {
    symbol: string;
    price: number;
    size: number;
    timestamp: string;
    source: TradeTickSource;
    receivedAt?: number;
  }): void {
    const symbol = normalizeMarketSymbol(input.symbol);
    const receivedAt = input.receivedAt ?? Date.now();
    const tick: TradeTickRecord = {
      symbol,
      price: input.price,
      size: input.size,
      timestamp: input.timestamp,
      receivedAt,
      source: input.source,
    };

    const buffer = this.ensureTickBuffer(symbol);
    const previous = buffer[buffer.length - 1];
    if (previous && previous.timestamp === tick.timestamp && previous.price === tick.price && previous.size === tick.size) {
      return;
    }

    buffer.push(tick);
    this.trimByTimeAndCount(buffer, this.maxTicksPerSymbol);

    this.queuePersist("ticks", symbol, tick);
  }

  getReplayWindow(request: ReplayRequest): OrderBookReplayWindow {
    const symbol = normalizeMarketSymbol(request.symbol);
    const startMs = request.startMs;
    const endMs = request.endMs;

    const frameBuffer = this.framesBySymbol.get(symbol) ?? [];
    const tickBuffer = this.ticksBySymbol.get(symbol) ?? [];

    const rawFrames = frameBuffer.filter((frame) => frame.receivedAt >= startMs && frame.receivedAt <= endMs);
    const rawTicks = request.includeTicks
      ? tickBuffer.filter((tick) => tick.receivedAt >= startMs && tick.receivedAt <= endMs)
      : [];

    let frames = rawFrames;
    if (request.downsampleMs && request.downsampleMs > 1) {
      frames = downsampleFramesByBucket(frames, startMs, request.downsampleMs);
    }
    frames = evenlySample(frames, request.maxFrames);

    const ticks = evenlySample(rawTicks, request.maxTicks);

    const emittedFrames = frames.length;
    const emittedTicks = ticks.length;
    const frameCompressionRatio = rawFrames.length > 0 ? emittedFrames / rawFrames.length : 1;
    const tickCompressionRatio = rawTicks.length > 0 ? emittedTicks / rawTicks.length : 1;

    return {
      symbol,
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      durationMs: Math.max(0, endMs - startMs),
      stats: {
        rawFrames: rawFrames.length,
        rawTicks: rawTicks.length,
        emittedFrames,
        emittedTicks,
        frameCompressionRatio: Number(frameCompressionRatio.toFixed(6)),
        tickCompressionRatio: Number(tickCompressionRatio.toFixed(6)),
        downsampleMs: request.downsampleMs ?? null,
      },
      frames,
      ticks,
    };
  }

  getStatus(): RecorderStatus {
    const symbols = new Set<string>([
      ...this.framesBySymbol.keys(),
      ...this.ticksBySymbol.keys(),
    ]);

    const rows = [...symbols]
      .sort()
      .map((symbol) => {
        const frames = this.framesBySymbol.get(symbol) ?? [];
        const ticks = this.ticksBySymbol.get(symbol) ?? [];
        return {
          symbol,
          frameCount: frames.length,
          tickCount: ticks.length,
          oldestFrameAt: frames[0]?.receivedAt ?? null,
          newestFrameAt: frames[frames.length - 1]?.receivedAt ?? null,
          oldestTickAt: ticks[0]?.receivedAt ?? null,
          newestTickAt: ticks[ticks.length - 1]?.receivedAt ?? null,
        };
      });

    return {
      maxAgeMs: this.maxAgeMs,
      frameDepth: this.frameDepth,
      maxFramesPerSymbol: this.maxFramesPerSymbol,
      maxTicksPerSymbol: this.maxTicksPerSymbol,
      persistenceEnabled: this.persistenceEnabled,
      symbols: rows,
    };
  }

  private ensureFrameBuffer(symbol: string): OrderBookFrame[] {
    let buffer = this.framesBySymbol.get(symbol);
    if (!buffer) {
      buffer = [];
      this.framesBySymbol.set(symbol, buffer);
    }
    return buffer;
  }

  private ensureTickBuffer(symbol: string): TradeTickRecord[] {
    let buffer = this.ticksBySymbol.get(symbol);
    if (!buffer) {
      buffer = [];
      this.ticksBySymbol.set(symbol, buffer);
    }
    return buffer;
  }

  private trimByTimeAndCount<T extends { receivedAt: number }>(items: T[], maxCount: number): void {
    const cutoff = Date.now() - this.maxAgeMs;
    while (items.length > 0 && items[0]!.receivedAt < cutoff) {
      items.shift();
    }
    while (items.length > maxCount) {
      items.shift();
    }
  }

  private queuePersist(kind: "frames" | "ticks", symbol: string, payload: OrderBookFrame | TradeTickRecord): void {
    if (!this.persistenceEnabled) return;

    this.persistQueue = this.persistQueue
      .then(async () => {
        await this.ensurePersistDir();
        const fileName = `${kind}_${symbol}.jsonl`;
        const filePath = path.join(this.persistDir, fileName);
        await appendFile(filePath, `${JSON.stringify(payload)}\n`, "utf8");
      })
      .catch((err: unknown) => {
        logger.error({ err, symbol, kind }, "orderbook recorder persist failed");
      });
  }

  private async ensurePersistDir(): Promise<void> {
    if (this.persistReady) return;
    await mkdir(this.persistDir, { recursive: true });
    this.persistReady = true;
  }
}

export const orderBookRecorder = new OrderBookRecorder();
