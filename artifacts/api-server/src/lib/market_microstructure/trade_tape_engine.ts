import { orderBookRecorder } from "../market/orderbook_recorder";
import type { PressureBias, TapePrint, TapeSummary } from "./microstructure_types";
import { normalizeMicrostructureSymbol } from "./orderbook_ingestor";

export interface TapeParams {
  window_sec?: number;
  max_prints?: number;
}

function clamp(value: number, min = 0, max = 1): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * p)));
  return sorted[index] ?? 0;
}

function toBias(normalizedDelta: number): PressureBias {
  if (normalizedDelta >= 0.12) return "buy";
  if (normalizedDelta <= -0.12) return "sell";
  return "neutral";
}

export function buildTradeTapeSummary(symbolInput: string, params: TapeParams = {}): TapeSummary {
  const symbol = normalizeMicrostructureSymbol(symbolInput);
  const windowSec = Math.max(10, Math.min(900, Math.round(params.window_sec ?? 120)));
  const maxPrints = Math.max(20, Math.min(500, Math.round(params.max_prints ?? 120)));
  const endMs = Date.now();
  const startMs = endMs - windowSec * 1000;

  const replay = orderBookRecorder.getReplayWindow({
    symbol,
    startMs,
    endMs,
    downsampleMs: undefined,
    maxFrames: 10,
    maxTicks: Math.max(maxPrints * 4, 500),
    includeTicks: true,
  });

  const ticks = replay.ticks;
  const sizes = ticks.map((t) => t.size);
  const largePrintThreshold = percentile(sizes, 0.75);

  const prints: TapePrint[] = [];
  let previousPrice: number | null = null;
  let previousSide: TapePrint["side"] = "buy";

  let buyVolume = 0;
  let sellVolume = 0;
  let buyNotional = 0;
  let sellNotional = 0;
  let largeAggressiveCount = 0;

  for (const tick of ticks) {
    const price = Number(tick.price);
    const size = Number(tick.size);
    if (!Number.isFinite(price) || !Number.isFinite(size) || size <= 0) continue;

    let side: TapePrint["side"];
    if (previousPrice === null) {
      side = previousSide;
    } else if (price > previousPrice) {
      side = "buy";
    } else if (price < previousPrice) {
      side = "sell";
    } else {
      side = previousSide;
    }

    const notional = price * size;
    const aggressor = size >= largePrintThreshold && largePrintThreshold > 0;

    if (side === "buy") {
      buyVolume += size;
      buyNotional += notional;
    } else {
      sellVolume += size;
      sellNotional += notional;
    }

    if (aggressor) largeAggressiveCount += 1;

    prints.push({
      price: round(price, 8),
      size: round(size, 8),
      notional_usd: round(notional, 6),
      timestamp: tick.timestamp,
      side,
      aggressor,
    });

    previousPrice = price;
    previousSide = side;
  }

  const emitted = prints.slice(-maxPrints);
  const totalVolume = buyVolume + sellVolume;
  const totalNotional = buyNotional + sellNotional;

  const deltaVolume = buyVolume - sellVolume;
  const deltaNotional = buyNotional - sellNotional;
  const normalizedDelta = totalVolume > 0 ? deltaVolume / totalVolume : 0;

  const expectedLargePerMinute = (ticks.length / Math.max(1, windowSec)) * 60 * 0.25;
  const burstScore = expectedLargePerMinute > 0
    ? clamp(largeAggressiveCount / expectedLargePerMinute, 0, 2) / 2
    : 0;

  const score = clamp(
    Math.abs(normalizedDelta) * 0.55 +
    burstScore * 0.35 +
    (totalNotional > 0 ? 0.1 : 0),
  );

  return {
    generated_at: new Date().toISOString(),
    window_sec: windowSec,
    print_count: emitted.length,
    buy_volume: round(buyVolume, 8),
    sell_volume: round(sellVolume, 8),
    buy_notional: round(buyNotional, 6),
    sell_notional: round(sellNotional, 6),
    delta_volume: round(deltaVolume, 8),
    delta_notional: round(deltaNotional, 6),
    normalized_delta: round(normalizedDelta, 6),
    burst_score: round(burstScore, 6),
    score: round(score, 6),
    bias: toBias(normalizedDelta),
    prints: emitted,
  };
}
