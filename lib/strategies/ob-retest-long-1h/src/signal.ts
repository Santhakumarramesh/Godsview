import type { Bar, OrderBlock1H, LongSignal } from "./types";

/**
 * Build a long signal at the confirmation bar.
 *
 *   timestamp = bars[signalIndex].Timestamp
 *   entry     = Close[signalIndex]                       (market on confirmation close)
 *   stop      = obLow - stopBufferATR * atrAtSignal
 *   target    = entry + takeProfitR * (entry - stop)
 *   invalidation.obLow      = ob.obLow
 *   invalidation.expireAt   = bars[bosIndex + maxRetestBars].Timestamp (clamped to last bar)
 */
export function buildLongSignal(
  bars: Bar[],
  ob: OrderBlock1H,
  signalIndex: number,
  atrAtSignal: number,
  cfg: { stopBufferATR: number; takeProfitR: number; maxRetestBars: number },
): LongSignal {
  const entry = bars[signalIndex]!.Close;
  const stop = ob.obLow - cfg.stopBufferATR * atrAtSignal;
  const risk = entry - stop;
  const target = entry + cfg.takeProfitR * risk;
  const expireIdx = Math.min(ob.bosIndex + cfg.maxRetestBars, bars.length - 1);
  return {
    kind: "long",
    timestamp: bars[signalIndex]!.Timestamp,
    entry,
    stop,
    target,
    invalidation: {
      obLow: ob.obLow,
      expireAt: bars[expireIdx]!.Timestamp,
    },
  };
}
