import type { AlpacaBar } from "./alpaca";

export type SetupType = "absorption_reversal" | "sweep_reclaim" | "continuation_pullback";
export type Regime = "trending_bull" | "trending_bear" | "ranging" | "volatile" | "chop";

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
  regime: Regime;
  atr_pct: number;
  directional_persistence: number;
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

export type NoTradeReason =
  | "chop_regime"
  | "setup_cooldown"
  | "low_volatility"
  | "high_volatility_extreme"
  | "conflicting_flow"
  | "none";

export type SetupCooldowns = Record<string, number>; // setup_type → consecutive_failures

// ─── Utility ─────────────────────────────────────────────────────────────────

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

function clamp(val: number): number {
  return Math.max(0, Math.min(1, val));
}

function countConsec(bars: AlpacaBar[], dir: "bull" | "bear"): number {
  let count = 0;
  for (let i = bars.length - 1; i >= 0; i--) {
    const isBull = bars[i].Close > bars[i].Open;
    if ((dir === "bull" && isBull) || (dir === "bear" && !isBull)) count++;
    else break;
  }
  return count;
}

// ─── Regime Detection ────────────────────────────────────────────────────────

export function detectRegime(bars: AlpacaBar[]): Regime {
  if (bars.length < 20) return "ranging";

  const last20 = bars.slice(-20);
  const closes = last20.map((b) => b.Close);
  const high = Math.max(...last20.map((b) => b.High));
  const low = Math.min(...last20.map((b) => b.Low));
  const atr = avgRange(last20);
  const midPrice = (high + low) / 2;

  // Directional persistence: how many bars moved in same direction as overall trend
  const overallSlope = slope(last20);
  const directionMatches = last20.filter((b) =>
    overallSlope > 0 ? b.Close > b.Open : b.Close < b.Open
  ).length;
  const directionalPersistence = directionMatches / last20.length;

  // Range as % of price — volatility measure
  const rangeAsPct = midPrice > 0 ? (high - low) / midPrice : 0;

  // Chop: high range oscillation, low directional persistence
  if (directionalPersistence < 0.45 && rangeAsPct < 0.03) return "chop";

  // Volatile: very wide bars, large ATR
  const avgClose = closes.reduce((s, c) => s + c, 0) / closes.length;
  const atrPct = avgClose > 0 ? atr / avgClose : 0;
  if (atrPct > 0.025) return "volatile";

  // Trending: strong directional persistence + slope
  if (directionalPersistence > 0.6 && Math.abs(overallSlope) > 0.008) {
    return overallSlope > 0 ? "trending_bull" : "trending_bear";
  }

  return "ranging";
}

// ─── No-Trade Filters ────────────────────────────────────────────────────────

export function applyNoTradeFilters(
  bars: AlpacaBar[],
  recall: RecallFeatures,
  setup: SetupType,
  cooldowns: SetupCooldowns = {}
): { blocked: boolean; reason: NoTradeReason } {
  // Block all trading in chop regime
  if (recall.regime === "chop") {
    return { blocked: true, reason: "chop_regime" };
  }

  // Block in extreme volatile conditions (ATR > 3% of price)
  if (recall.atr_pct > 0.035) {
    return { blocked: true, reason: "high_volatility_extreme" };
  }

  // Block if extremely low volatility (market asleep)
  if (recall.atr_pct < 0.001 && recall.avg_range_1m < 0.5) {
    return { blocked: true, reason: "low_volatility" };
  }

  // Setup cooldown: block if this setup has failed 3+ consecutive times
  const failures = cooldowns[setup] ?? 0;
  if (failures >= 3) {
    return { blocked: true, reason: "setup_cooldown" };
  }

  // Conflicting flow: trend and momentum pointing opposite directions strongly
  const trendUp = recall.trend_slope_5m > 0.003;
  const trendDown = recall.trend_slope_5m < -0.003;
  const momentumDown = recall.momentum_1m < -0.003;
  const momentumUp = recall.momentum_1m > 0.003;
  if ((trendUp && momentumDown) || (trendDown && momentumUp)) {
    if (setup === "continuation_pullback") {
      return { blocked: true, reason: "conflicting_flow" };
    }
  }

  return { blocked: false, reason: "none" };
}

// ─── Per-Setup, Per-Regime Thresholds ────────────────────────────────────────

const REGIME_THRESHOLDS: Record<Regime, Record<SetupType, number>> = {
  trending_bull: {
    continuation_pullback: 0.55,
    sweep_reclaim: 0.60,
    absorption_reversal: 0.72,
  },
  trending_bear: {
    continuation_pullback: 0.55,
    sweep_reclaim: 0.60,
    absorption_reversal: 0.72,
  },
  ranging: {
    absorption_reversal: 0.60,
    sweep_reclaim: 0.65,
    continuation_pullback: 0.70,
  },
  volatile: {
    sweep_reclaim: 0.70,
    absorption_reversal: 0.75,
    continuation_pullback: 0.78,
  },
  chop: {
    absorption_reversal: 1.0,
    sweep_reclaim: 1.0,
    continuation_pullback: 1.0,
  },
};

export function getQualityThreshold(regime: Regime, setup: SetupType): number {
  return REGIME_THRESHOLDS[regime]?.[setup] ?? 0.65;
}

// ─── Recall Features ─────────────────────────────────────────────────────────

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
  const atr = computeATR(last20_1m);
  const atrPct = lastClose > 0 ? atr / lastClose : 0;

  const regime = detectRegime(bars1m);

  const directionMatches = last20_1m.filter((b) =>
    slope(last20_1m) > 0 ? b.Close > b.Open : b.Close < b.Open
  ).length;
  const directionalPersistence = directionMatches / (last20_1m.length || 1);

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
    regime,
    atr_pct: atrPct,
    directional_persistence: directionalPersistence,
  };
}

// ─── Setup Detectors ─────────────────────────────────────────────────────────

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

  const bullSetup =
    prevBearish >= 3 &&
    lastBullish &&
    volSpike > 1.3 &&
    recall.distance_from_low < 0.015 &&
    recall.wick_ratio_1m > 0.35;

  const bearSetup =
    prevBullish >= 3 &&
    lastBearish &&
    volSpike > 1.3 &&
    recall.distance_from_high < 0.015 &&
    recall.wick_ratio_1m > 0.35;

  if (!bullSetup && !bearSetup) return { detected: false, direction: "long", structure: 0, orderFlow: 0 };

  const direction = bullSetup ? "long" : "short";

  // Regime alignment bonus: absorption works best in ranging/volatile
  const regimeBonus =
    recall.regime === "ranging" ? 0.15 :
    recall.regime === "volatile" ? 0.05 :
    recall.regime === "chop" ? -0.2 : 0;

  const structure = clamp(
    0.4 +
    (recall.distance_from_low < 0.01 ? 0.2 : 0.1) +
    (recall.wick_ratio_5m > 0.4 ? 0.2 : 0.1) +
    (recall.trend_slope_5m > 0 ? 0.1 : 0) +
    regimeBonus
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

  const bullSweep =
    prevBar.Low < low10 * 1.001 &&
    lastBar.Close > prevBar.Low &&
    lastBar.Close > lastBar.Open &&
    recall.momentum_1m > 0;

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

  // Sweep reclaim works in all regimes except chop; bonus in ranging
  const regimeBonus =
    recall.regime === "ranging" ? 0.1 :
    recall.regime === "volatile" ? 0.08 :
    recall.regime === "chop" ? -0.25 : 0.05;

  const structure = clamp(
    0.5 + wickSize * 0.3 +
    (recall.trend_slope_15m * (bullSweep ? 1 : -1) > 0 ? 0.15 : 0) +
    regimeBonus
  );
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

  // Continuation only makes sense in trending regimes
  const regimeBonus =
    recall.regime === "trending_bull" || recall.regime === "trending_bear" ? 0.15 :
    recall.regime === "ranging" ? -0.1 :
    recall.regime === "chop" ? -0.3 : 0;

  const structure = clamp(
    0.5 + trendStrength +
    (recall.wick_ratio_1m < 0.3 ? 0.1 : 0) +
    regimeBonus
  );
  const orderFlow = clamp(
    0.4 +
    (recall.vol_relative > 1.0 ? 0.15 : 0) +
    (Math.abs(recall.momentum_1m) > 0.001 ? 0.1 : 0)
  );

  return { detected: true, direction, structure, orderFlow };
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

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

  // Regime alignment bonus
  if (
    (setup === "continuation_pullback" && (recall.regime === "trending_bull" || recall.regime === "trending_bear")) ||
    (setup === "absorption_reversal" && recall.regime === "ranging") ||
    (setup === "sweep_reclaim" && (recall.regime === "ranging" || recall.regime === "volatile"))
  ) {
    score += 0.1;
  }

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

// ─── Execution ───────────────────────────────────────────────────────────────

export function computeTPSL(
  entryPrice: number,
  direction: "long" | "short",
  atr: number,
  regime: Regime = "ranging"
): { takeProfit: number; stopLoss: number; tpTicks: number; slTicks: number } {
  // Tighter targets in ranging, wider in trending
  const tpMult = regime === "trending_bull" || regime === "trending_bear" ? 2.5 : 2.0;
  const slMult = regime === "volatile" ? 1.5 : 1.0;
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
