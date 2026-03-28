import type { AlpacaBar } from "./alpaca";

export type SetupType = "absorption_reversal" | "sweep_reclaim" | "continuation_pullback";

export type RecallFeatures = {
  trend_slope_1m: number;
  trend_slope_5m: number;
  trend_slope_15m: number;
  avg_range_1m: number;
  avg_range_5m: number;
  wick_ratio_1m: number;
  wick_ratio_5m: number;
  distance_from_high: number;
  distance_from_low: number;
  momentum_1m: number;
  momentum_5m: number;
  vol_relative: number;
  consec_bullish: number;
  consec_bearish: number;
};

export type SetupCandidate = {
  bar_time: string;
  symbol: string;
  setup_type: SetupType;
  structure_score: number;
  order_flow_score: number;
  recall_score: number;
  final_quality: number;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  direction: "long" | "short";
  recall_features: RecallFeatures;
};

function slope(bars: AlpacaBar[]): number {
  if (bars.length < 2) return 0;
  const first = bars[0].Close;
  const last = bars[bars.length - 1].Close;
  return (last - first) / first;
}

function avgRange(bars: AlpacaBar[]): number {
  if (bars.length === 0) return 0;
  return bars.reduce((s, b) => s + (b.High - b.Low), 0) / bars.length;
}

function wickRatio(bars: AlpacaBar[]): number {
  if (bars.length === 0) return 0;
  const ratios = bars.map((b) => {
    const body = Math.abs(b.Close - b.Open);
    const totalRange = b.High - b.Low;
    return totalRange > 0 ? (totalRange - body) / totalRange : 0;
  });
  return ratios.reduce((s, r) => s + r, 0) / ratios.length;
}

function avgVolume(bars: AlpacaBar[]): number {
  if (bars.length === 0) return 1;
  return bars.reduce((s, b) => s + b.Volume, 0) / bars.length;
}

export function buildRecallFeatures(
  bars1m: AlpacaBar[],
  bars5m: AlpacaBar[]
): RecallFeatures {
  const last20_1m = bars1m.slice(-20);
  const last20_5m = bars5m.slice(-20);
  const high = Math.max(...last20_1m.map((b) => b.High));
  const low = Math.min(...last20_1m.map((b) => b.Low));
  const lastClose = last20_1m[last20_1m.length - 1]?.Close ?? 0;
  const avgVol1m = avgVolume(last20_1m.slice(0, -1));
  const lastVol = last20_1m[last20_1m.length - 1]?.Volume ?? 0;

  return {
    trend_slope_1m: slope(last20_1m),
    trend_slope_5m: slope(last20_5m),
    trend_slope_15m: slope(bars5m.slice(-6)),
    avg_range_1m: avgRange(last20_1m),
    avg_range_5m: avgRange(last20_5m),
    wick_ratio_1m: wickRatio(last20_1m),
    wick_ratio_5m: wickRatio(last20_5m),
    distance_from_high: high > 0 ? (high - lastClose) / high : 0,
    distance_from_low: lastClose > 0 && low > 0 ? (lastClose - low) / lastClose : 0,
    momentum_1m: last20_1m.length >= 5 ? slope(last20_1m.slice(-5)) : 0,
    momentum_5m: last20_5m.length >= 5 ? slope(last20_5m.slice(-5)) : 0,
    vol_relative: avgVol1m > 0 ? lastVol / avgVol1m : 1,
    consec_bullish: countConsec(last20_1m, "bull"),
    consec_bearish: countConsec(last20_1m, "bear"),
  };
}

function countConsec(bars: AlpacaBar[], dir: "bull" | "bear"): number {
  let count = 0;
  for (let i = bars.length - 1; i >= 0; i--) {
    const isBull = bars[i].Close > bars[i].Open;
    if ((dir === "bull" && isBull) || (dir === "bear" && !isBull)) {
      count++;
    } else break;
  }
  return count;
}

function clamp(val: number): number {
  return Math.max(0, Math.min(1, val));
}

export function detectAbsorptionReversal(
  bars1m: AlpacaBar[],
  bars5m: AlpacaBar[],
  recall: RecallFeatures
): { detected: boolean; direction: "long" | "short"; structure: number; orderFlow: number } {
  if (bars1m.length < 5) return { detected: false, direction: "long", structure: 0, orderFlow: 0 };

  const last5 = bars1m.slice(-5);
  const lastBar = last5[last5.length - 1];
  const prevBars = last5.slice(0, -1);

  const prevBearish = prevBars.filter((b) => b.Close < b.Open).length;
  const prevBullish = prevBars.filter((b) => b.Close > b.Open).length;
  const lastBullish = lastBar.Close > lastBar.Open;
  const lastBearish = lastBar.Close < lastBar.Open;

  const avgVol = avgVolume(prevBars);
  const volSpike = avgVol > 0 ? lastBar.Volume / avgVol : 1;

  // Bull absorption: prior aggressive selling then bullish absorption bar
  const bullSetup =
    prevBearish >= 3 &&
    lastBullish &&
    volSpike > 1.3 &&
    recall.distance_from_low < 0.015 &&
    recall.wick_ratio_1m > 0.35;

  // Bear absorption: prior aggressive buying then bearish absorption bar
  const bearSetup =
    prevBullish >= 3 &&
    lastBearish &&
    volSpike > 1.3 &&
    recall.distance_from_high < 0.015 &&
    recall.wick_ratio_1m > 0.35;

  if (!bullSetup && !bearSetup) return { detected: false, direction: "long", structure: 0, orderFlow: 0 };

  const direction = bullSetup ? "long" : "short";

  const structure = clamp(
    0.4 +
      (recall.distance_from_low < 0.01 ? 0.2 : 0.1) +
      (recall.wick_ratio_5m > 0.4 ? 0.2 : 0.1) +
      (recall.trend_slope_5m > 0 ? 0.1 : 0)
  );

  const orderFlow = clamp(
    0.3 + Math.min(volSpike - 1, 0.5) + (recall.vol_relative > 1.5 ? 0.15 : 0.05)
  );

  return { detected: true, direction, structure, orderFlow };
}

export function detectSweepReclaim(
  bars1m: AlpacaBar[],
  bars5m: AlpacaBar[],
  recall: RecallFeatures
): { detected: boolean; direction: "long" | "short"; structure: number; orderFlow: number } {
  if (bars1m.length < 10) return { detected: false, direction: "long", structure: 0, orderFlow: 0 };

  const last10 = bars1m.slice(-10);
  const high10 = Math.max(...last10.map((b) => b.High));
  const low10 = Math.min(...last10.map((b) => b.Low));
  const lastBar = last10[last10.length - 1];
  const prevBar = last10[last10.length - 2];

  // Bull sweep: wick poked below key low then reclaimed
  const bullSweep =
    prevBar.Low < low10 * 1.001 &&
    lastBar.Close > prevBar.Low &&
    lastBar.Close > lastBar.Open &&
    recall.momentum_1m > 0;

  // Bear sweep: wick poked above key high then reclaimed
  const bearSweep =
    prevBar.High > high10 * 0.999 &&
    lastBar.Close < prevBar.High &&
    lastBar.Close < lastBar.Open &&
    recall.momentum_1m < 0;

  if (!bullSweep && !bearSweep) return { detected: false, direction: "long", structure: 0, orderFlow: 0 };

  const direction = bullSweep ? "long" : "short";
  const wickSize = bullSweep
    ? (prevBar.Close - prevBar.Low) / (prevBar.High - prevBar.Low + 0.0001)
    : (prevBar.High - prevBar.Close) / (prevBar.High - prevBar.Low + 0.0001);

  const structure = clamp(0.5 + wickSize * 0.3 + (recall.trend_slope_15m * (bullSweep ? 1 : -1) > 0 ? 0.15 : 0));
  const avgVol = avgVolume(last10.slice(0, -1));
  const volSpike = avgVol > 0 ? lastBar.Volume / avgVol : 1;
  const orderFlow = clamp(0.35 + Math.min(volSpike - 1, 0.4) + (recall.vol_relative > 1.2 ? 0.1 : 0));

  return { detected: true, direction, structure, orderFlow };
}

export function detectContinuationPullback(
  bars1m: AlpacaBar[],
  bars5m: AlpacaBar[],
  recall: RecallFeatures
): { detected: boolean; direction: "long" | "short"; structure: number; orderFlow: number } {
  if (bars1m.length < 10 || bars5m.length < 10) return { detected: false, direction: "long", structure: 0, orderFlow: 0 };

  const trendUp = recall.trend_slope_5m > 0.002 && recall.trend_slope_15m > 0;
  const trendDown = recall.trend_slope_5m < -0.002 && recall.trend_slope_15m < 0;

  if (!trendUp && !trendDown) return { detected: false, direction: "long", structure: 0, orderFlow: 0 };

  const last5_1m = bars1m.slice(-5);
  const lastBar = last5_1m[last5_1m.length - 1];

  // Pullback in trend direction — look for small retracement then resumption
  const bullCont =
    trendUp &&
    recall.consec_bearish >= 2 &&
    lastBar.Close > lastBar.Open &&
    recall.momentum_1m > 0;

  const bearCont =
    trendDown &&
    recall.consec_bullish >= 2 &&
    lastBar.Close < lastBar.Open &&
    recall.momentum_1m < 0;

  if (!bullCont && !bearCont) return { detected: false, direction: "long", structure: 0, orderFlow: 0 };

  const direction = bullCont ? "long" : "short";
  const trendStrength = Math.min(Math.abs(recall.trend_slope_5m) * 100, 0.4);
  const structure = clamp(0.5 + trendStrength + (recall.wick_ratio_1m < 0.3 ? 0.1 : 0));
  const orderFlow = clamp(0.4 + (recall.vol_relative > 1.0 ? 0.15 : 0) + (Math.abs(recall.momentum_1m) > 0.001 ? 0.1 : 0));

  return { detected: true, direction, structure, orderFlow };
}

export function scoreRecall(
  recall: RecallFeatures,
  setup: SetupType,
  direction: "long" | "short"
): number {
  const trendAligned =
    direction === "long"
      ? recall.trend_slope_5m > 0 && recall.trend_slope_15m > 0
      : recall.trend_slope_5m < 0 && recall.trend_slope_15m < 0;

  const momentumAligned =
    direction === "long" ? recall.momentum_1m > 0 : recall.momentum_1m < 0;

  let score = 0.4;
  if (trendAligned) score += 0.2;
  if (momentumAligned) score += 0.15;
  if (recall.vol_relative > 1.2) score += 0.1;
  if (recall.wick_ratio_5m > 0.35) score += 0.1;
  if (setup === "absorption_reversal" && !trendAligned) score += 0.05;

  return clamp(score);
}

export function computeFinalQuality(
  structure: number,
  orderFlow: number,
  recall: number
): number {
  const ml = 0.5 + recall * 0.3;
  const claude = 0.5 + (structure + orderFlow) * 0.25;
  return clamp(0.3 * structure + 0.25 * orderFlow + 0.2 * recall + 0.15 * ml + 0.1 * claude);
}

export function computeTPSL(
  entryPrice: number,
  direction: "long" | "short",
  atr: number
): { takeProfit: number; stopLoss: number; tpTicks: number; slTicks: number } {
  const tpMult = 2.0;
  const slMult = 1.0;
  const tickSize = entryPrice > 10000 ? 5 : entryPrice > 1000 ? 1 : 0.25;
  const tpDist = Math.max(atr * tpMult, tickSize * 12);
  const slDist = Math.max(atr * slMult, tickSize * 6);

  return {
    takeProfit: direction === "long" ? entryPrice + tpDist : entryPrice - tpDist,
    stopLoss: direction === "long" ? entryPrice - slDist : entryPrice + slDist,
    tpTicks: Math.round(tpDist / tickSize),
    slTicks: Math.round(slDist / tickSize),
  };
}

export function computeATR(bars: AlpacaBar[]): number {
  if (bars.length < 2) return 0;
  const ranges = bars.slice(-14).map((b, i, arr) => {
    if (i === 0) return b.High - b.Low;
    const prev = arr[i - 1];
    return Math.max(b.High - b.Low, Math.abs(b.High - prev.Close), Math.abs(b.Low - prev.Close));
  });
  return ranges.reduce((s, r) => s + r, 0) / ranges.length;
}

export function checkForwardOutcome(
  entryPrice: number,
  direction: "long" | "short",
  tp: number,
  sl: number,
  forwardBars: AlpacaBar[]
): { outcome: "win" | "loss" | "open"; hitTP: boolean; barsChecked: number } {
  for (let i = 0; i < forwardBars.length; i++) {
    const bar = forwardBars[i];
    if (direction === "long") {
      if (bar.High >= tp) return { outcome: "win", hitTP: true, barsChecked: i + 1 };
      if (bar.Low <= sl) return { outcome: "loss", hitTP: false, barsChecked: i + 1 };
    } else {
      if (bar.Low <= tp) return { outcome: "win", hitTP: true, barsChecked: i + 1 };
      if (bar.High >= sl) return { outcome: "loss", hitTP: false, barsChecked: i + 1 };
    }
  }
  return { outcome: "open", hitTP: false, barsChecked: forwardBars.length };
}
