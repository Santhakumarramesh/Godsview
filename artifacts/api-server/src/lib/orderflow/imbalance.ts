/**
 * Orderflow Imbalance Analysis — bid/ask imbalance, absorption, sweeps.
 */

/** Quote-level bid/ask imbalance: -1 (all ask) to +1 (all bid) */
export function quoteImbalance(bidSize: number, askSize: number): number {
  const total = bidSize + askSize;
  if (total <= 0) return 0;
  return (bidSize - askSize) / total;
}

/** Detect absorption: large resting orders absorbing aggressive flow */
export function detectAbsorption(
  bidSize: number,
  askSize: number,
  priceChange: number,
  threshold = 3,
): { absorptionBid: boolean; absorptionAsk: boolean } {
  const ratio = bidSize > 0 ? askSize / bidSize : 999;
  const reverseRatio = askSize > 0 ? bidSize / askSize : 999;

  return {
    // Bid absorption: large bid absorbs selling pressure, price holds
    absorptionBid: reverseRatio > threshold && priceChange >= 0,
    // Ask absorption: large ask absorbs buying pressure, price holds
    absorptionAsk: ratio > threshold && priceChange <= 0,
  };
}

/** Detect liquidity sweep: price briefly touches a level and reverses */
export function detectSweep(
  candles: Array<{ high: number; low: number; close: number; open: number }>,
  lookback = 20,
): boolean {
  if (candles.length < lookback + 1) return false;

  const recent = candles.slice(-lookback - 1);
  const last = recent[recent.length - 1];
  const prior = recent.slice(0, -1);

  const priorHigh = Math.max(...prior.map(c => c.high));
  const priorLow = Math.min(...prior.map(c => c.low));

  // Sweep high: wick above prior high but close below
  const sweepHigh = last.high > priorHigh && last.close < priorHigh;
  // Sweep low: wick below prior low but close above
  const sweepLow = last.low < priorLow && last.close > priorLow;

  return sweepHigh || sweepLow;
}
