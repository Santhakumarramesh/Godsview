import type { ImbalanceMetrics, NormalizedOrderBook, PressureBias } from "./microstructure_types";

export interface ImbalanceParams {
  top_levels?: number;
}

function clamp(value: number, min = -1, max = 1): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(min, Math.min(max, value));
}

function toScore(value: number): number {
  return Math.max(0, Math.min(1, (value + 1) / 2));
}

function getBias(weightedImbalance: number): PressureBias {
  if (weightedImbalance >= 0.12) return "buy";
  if (weightedImbalance <= -0.12) return "sell";
  return "neutral";
}

export function computeImbalanceMetrics(
  orderbook: NormalizedOrderBook,
  params: ImbalanceParams = {},
): ImbalanceMetrics {
  const topLevels = Math.max(2, Math.min(30, Math.round(params.top_levels ?? 10)));

  const topBids = orderbook.bid_levels.slice(0, topLevels);
  const topAsks = orderbook.ask_levels.slice(0, topLevels);

  const topBidVolume = topBids.reduce((sum, l) => sum + l.size, 0);
  const topAskVolume = topAsks.reduce((sum, l) => sum + l.size, 0);
  const touchBid = topBids[0]?.size ?? 0;
  const touchAsk = topAsks[0]?.size ?? 0;

  const depthDenominator = topBidVolume + topAskVolume;
  const touchDenominator = touchBid + touchAsk;

  const depthImbalance = depthDenominator > 0 ? (topBidVolume - topAskVolume) / depthDenominator : 0;
  const touchImbalance = touchDenominator > 0 ? (touchBid - touchAsk) / touchDenominator : 0;

  const weightedBid = topBids.reduce((sum, level, index) => sum + level.size / (index + 1), 0);
  const weightedAsk = topAsks.reduce((sum, level, index) => sum + level.size / (index + 1), 0);
  const weightedDenominator = weightedBid + weightedAsk;
  const weightedImbalance = weightedDenominator > 0 ? (weightedBid - weightedAsk) / weightedDenominator : 0;

  const composite = clamp(depthImbalance * 0.35 + touchImbalance * 0.25 + weightedImbalance * 0.4);

  return {
    top_levels: topLevels,
    touch_imbalance: Number(clamp(touchImbalance).toFixed(6)),
    depth_imbalance: Number(clamp(depthImbalance).toFixed(6)),
    weighted_imbalance: Number(clamp(weightedImbalance).toFixed(6)),
    top_bid_volume: Number(topBidVolume.toFixed(6)),
    top_ask_volume: Number(topAskVolume.toFixed(6)),
    score: Number(toScore(composite).toFixed(6)),
    bias: getBias(weightedImbalance),
  };
}
