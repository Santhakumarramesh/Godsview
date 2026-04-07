/**
 * Candle Orderflow Packet — combines candle data with orderflow intelligence.
 * This is the per-candle intelligence payload that feeds the brain.
 */
import type { CandleOrderflowPacket } from "@workspace/common-types";
import type { CandleEvent } from "@workspace/common-types";
import { quoteImbalance, detectAbsorption, detectSweep } from "./imbalance";

/**
 * Build orderflow packet from candle + quote context.
 * In absence of real L2 data, derives what it can from price action.
 */
export function buildCandlePacket(
  candle: CandleEvent,
  context: {
    bidSize?: number;
    askSize?: number;
    prevCandles?: CandleEvent[];
    cumulativeDelta?: number;
  } = {},
): CandleOrderflowPacket {
  const bidSize = context.bidSize ?? 0;
  const askSize = context.askSize ?? 0;
  const priceChange = candle.close - candle.open;

  const imbalance = quoteImbalance(bidSize, askSize);
  const { absorptionBid, absorptionAsk } = detectAbsorption(bidSize, askSize, priceChange);

  const prevCandles = context.prevCandles ?? [];
  const allCandles = [...prevCandles, candle] as Array<{ high: number; low: number; close: number; open: number }>;
  const sweepFlag = detectSweep(allCandles);

  // Estimate spread from candle range (rough approximation without L2)
  const range = candle.high - candle.low;
  const spreadEst = range * 0.05; // ~5% of range as typical spread

  return {
    symbol: candle.symbol,
    ts: candle.ts,
    delta: priceChange > 0 ? candle.volume * 0.6 : -candle.volume * 0.6, // estimate
    cvd: (context.cumulativeDelta ?? 0) + (priceChange > 0 ? candle.volume * 0.6 : -candle.volume * 0.6),
    spreadAvg: spreadEst,
    spreadMax: spreadEst * 2,
    topBid: bidSize > 0 ? candle.close - spreadEst : null,
    topAsk: askSize > 0 ? candle.close + spreadEst : null,
    liquidityAbove: candle.high * 1.002, // estimate nearest resistance
    liquidityBelow: candle.low * 0.998,   // estimate nearest support
    absorptionBid,
    absorptionAsk,
    sweepFlag,
    imbalance,
  };
}
