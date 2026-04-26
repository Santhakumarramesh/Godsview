import type { AlpacaBar } from "./alpaca";
import { predictWinProbability } from "./ml_model";
import { DEFAULT_SETUPS, SETUP_CATALOG, computeFinalQualityScore } from "@workspace/strategy-core";
import type { SetupType } from "@workspace/strategy-core";
import type { MacroBiasResult } from "./macro_bias_engine";
import type { SentimentResult } from "./sentiment_engine";

// ─── Types ────────────────────────────────────────────────────────────────────

export type { SetupType };

export type Regime = "trending_bull" | "trending_bear" | "ranging" | "volatile" | "chop";

export type SKBias = "bull" | "bear" | "neutral";

/** SK Trading System — Market Structure Features */
export type SKFeatures = {
  bias: SKBias;                  // higher-timeframe directional bias
  sequence_stage: "impulse" | "correction" | "completion" | "none";
  correction_complete: boolean;  // corrective move appears to be finishing
  zone_distance_pct: number;     // % distance to nearest SK structural zone
  swing_high: number;            // nearest significant swing high
  swing_low: number;             // nearest significant swing low
  impulse_strength: number;      // 0–1 strength of the last impulsive leg
  sequence_score: number;        // 0–1 overall SK setup quality
  rr_quality: number;            // 0–1 estimated R:R potential from current price
  in_zone: boolean;              // price is within an actionable SK zone
};

/** Cumulative Volume Delta — estimated from OHLCV */
export type CVDFeatures = {
  cvd_value: number;             // raw estimated CVD over window
  cvd_slope: number;             // positive = buying pressure growing
  cvd_divergence: boolean;       // price vs CVD diverging
  buy_volume_ratio: number;      // estimated % of volume that is buying
  delta_momentum: number;        // rate of CVD change
  large_delta_bar: boolean;      // last bar has outsized delta
};

export type IndicatorFeatures = {
  rsi_14: number;
  macd_line: number;
  macd_signal: number;
  macd_hist: number;
  ema_fast: number;
  ema_slow: number;
  ema_spread_pct: number;
  bb_width: number;
  bb_position: number;
  indicator_bias: "bull" | "bear" | "neutral";
};

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
  trend_consensus: number;
  flow_alignment: number;
  volatility_zscore: number;
  fake_entry_risk: number;
  sk: SKFeatures;
  cvd: CVDFeatures;
  indicators: IndicatorFeatures;
  indicator_hints: string[];
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
  | "bad_session"
  | "news_lockout"
  | "sk_zone_miss"
  | "sk_bias_conflict"
  | "cvd_not_ready"
  | "macro_bias_block"
  | "sentiment_crowding_block"
  | "none";

export type SetupCooldowns = Record<string, number>;

/** Normalized chart overlay event emitted per detection */
export type ChartOverlayEvent = {
  ts: string;
  instrument: string;
  setup_type: SetupType;
  direction: "long" | "short";
  decision_type: "TRADE" | "REJECTED" | "PASS";
  scores: {
    structure: number;
    order_flow: number;
    recall: number;
    final: number;
    sk_sequence: number;
    cvd_slope: number;
  };
  entry_price: number;
  sl_price: number;
  tp_price: number;
  labels: string[];
  regime: Regime;
  sk_bias: SKBias;
  meets_threshold: boolean;
  reason: string;
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function slope(bars: AlpacaBar[]): number {
  if (bars.length < 2) return 0;
  return ((bars[bars.length - 1]?.Close ?? 0) - (bars[0]?.Close ?? 0)) / ((bars[0]?.Close) ?? 1);
}

function avgRange(bars: AlpacaBar[]): number {
  if (bars.length === 0) return 0;
  return bars.reduce((s, b) => s + ((b.High ?? 0) - (b.Low ?? 0)), 0) / bars.length;
}

function wickRatio(bars: AlpacaBar[]): number {
  if (bars.length === 0) return 0;
  const ratios = bars.map((b) => {
    const body = Math.abs((b.Close ?? 0) - (b.Open ?? 0));
    const range = (b.High ?? 0) - (b.Low ?? 0);
    return range > 0 ? (range - body) / range : 0;
  });
  return ratios.reduce((s, r) => s + r, 0) / ratios.length;
}

function avgVolume(bars: AlpacaBar[]): number {
  if (bars.length === 0) return 1;
  return bars.reduce((s, b) => s + ((b.Volume) ?? 0), 0) / bars.length;
}

function clamp(val: number): number {
  return Math.max(0, Math.min(1, val));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(Math.max(variance, 0));
}

function closesOf(bars: AlpacaBar[]): number[] {
  return bars.map((bar) => Number(bar.Close)).filter((value) => Number.isFinite(value));
}

function computeEMASeries(values: number[], period: number): number[] {
  if (values.length === 0 || period <= 0) return [];
  const smoothing = 2 / (period + 1);
  const result: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    const prev = result[i - 1];
    result.push((values[i] - prev) * smoothing + prev);
  }
  return result;
}

function computeEMA(values: number[], period: number): number {
  const series = computeEMASeries(values, period);
  return series.length > 0 ? series[series.length - 1] : 0;
}

function computeRSI(values: number[], period = 14): number {
  if (values.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function computeMACD(values: number[]): { line: number; signal: number; hist: number } {
  if (values.length < 2) return { line: 0, signal: 0, hist: 0 };
  const fast = computeEMASeries(values, 12);
  const slow = computeEMASeries(values, 26);
  if (fast.length === 0 || slow.length === 0) return { line: 0, signal: 0, hist: 0 };

  const macdSeries = values.map((_, index) => fast[index] - slow[index]);
  const signalSeries = computeEMASeries(macdSeries, 9);
  const line = macdSeries[macdSeries.length - 1] ?? 0;
  const signal = signalSeries[signalSeries.length - 1] ?? 0;

  return {
    line,
    signal,
    hist: line - signal,
  };
}

function computeBollinger(values: number[]): { width: number; position: number } {
  if (values.length < 20) return { width: 0, position: 0.5 };
  const window = values.slice(-20);
  const mean = average(window);
  const variance = average(window.map((value) => (value - mean) ** 2));
  const stdev = Math.sqrt(Math.max(variance, 0));
  const upper = mean + stdev * 2;
  const lower = mean - stdev * 2;
  const last = window[window.length - 1] ?? mean;
  const width = mean !== 0 ? (upper - lower) / Math.abs(mean) : 0;
  const denominator = upper - lower;
  const position = denominator > 0 ? clamp((last - lower) / denominator) : 0.5;
  return { width, position };
}

function sanitizeIndicatorHints(indicatorHints: string[]): string[] {
  const canonical = new Set<string>();
  for (const rawHint of indicatorHints) {
    const base = rawHint
      .toLowerCase()
      .replace(/@.*$/, "")
      .replace(/\([^)]*\)/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!base) continue;
    if (base.includes("macd")) canonical.add("macd");
    else if (base.includes("rsi")) canonical.add("rsi");
    else if (base.includes("bollinger") || base === "bb" || base.startsWith("bb_")) canonical.add("bollinger");
    else if (base.includes("ema") || base.includes("moving_average")) canonical.add("ema");
    else if (base.includes("stoch")) canonical.add("stoch");
    else if (base.includes("supertrend")) canonical.add("supertrend");
    else canonical.add(base);
  }
  return Array.from(canonical);
}

function computeIndicatorFeatures(
  bars1m: AlpacaBar[],
  indicatorHints: string[]
): { indicators: IndicatorFeatures; normalizedHints: string[] } {
  const closes = closesOf(bars1m);
  const rsi = computeRSI(closes, 14);
  const emaFast = computeEMA(closes, 12);
  const emaSlow = computeEMA(closes, 26);
  const macd = computeMACD(closes);
  const bollinger = computeBollinger(closes);
  const lastClose = closes[closes.length - 1] ?? 0;
  const emaSpreadPct = lastClose > 0 ? (emaFast - emaSlow) / lastClose : 0;
  const normalizedHints = sanitizeIndicatorHints(indicatorHints);

  let indicatorScore = 0;
  indicatorScore += rsi > 55 ? 1 : rsi < 45 ? -1 : 0;
  indicatorScore += macd.hist > 0 ? 1 : macd.hist < 0 ? -1 : 0;
  indicatorScore += emaSpreadPct > 0 ? 1 : emaSpreadPct < 0 ? -1 : 0;
  indicatorScore += bollinger.position > 0.55 ? 1 : bollinger.position < 0.45 ? -1 : 0;

  if (normalizedHints.includes("rsi")) indicatorScore += rsi > 52 ? 0.5 : rsi < 48 ? -0.5 : 0;
  if (normalizedHints.includes("macd")) indicatorScore += macd.hist > 0 ? 0.5 : macd.hist < 0 ? -0.5 : 0;
  if (normalizedHints.includes("ema")) indicatorScore += emaSpreadPct > 0 ? 0.4 : emaSpreadPct < 0 ? -0.4 : 0;
  if (normalizedHints.includes("bollinger")) indicatorScore += bollinger.position > 0.55 ? 0.3 : bollinger.position < 0.45 ? -0.3 : 0;

  const indicator_bias: IndicatorFeatures["indicator_bias"] =
    indicatorScore > 0.75 ? "bull" : indicatorScore < -0.75 ? "bear" : "neutral";

  return {
    indicators: {
      rsi_14: rsi,
      macd_line: macd.line,
      macd_signal: macd.signal,
      macd_hist: macd.hist,
      ema_fast: emaFast,
      ema_slow: emaSlow,
      ema_spread_pct: emaSpreadPct,
      bb_width: bollinger.width,
      bb_position: bollinger.position,
      indicator_bias,
    },
    normalizedHints,
  };
}

function countConsec(bars: AlpacaBar[], dir: "bull" | "bear"): number {
  let count = 0;
  for (let i = bars.length - 1; i >= 0; i--) {
    const isBull = (bars[i]?.Close ?? 0) > (bars[i]?.Open ?? 0);
    if ((dir === "bull" && isBull) || (dir === "bear" && !isBull)) count++;
    else break;
  }
  return count;
}

/** Estimate per-bar buying volume — 60% candle direction pressure + 40% close ratio.
 *  Candle direction gives ~50% more variance than raw close-ratio in replay data.
 *  Equivalent to the bid_wt_pressure / ask_wt_pressure DOM blend. */
function estimateBuyVolume(bar: AlpacaBar): number {
  const range = (bar.High ?? 0) - (bar.Low ?? 0);
  const closeRatio = range > 0 ? ((bar.Close ?? 0) - (bar.Low ?? 0)) / range : 0.5;
  const candleBull = (bar.Close ?? 0) >= (bar.Open ?? 0);
  const candleBody = range > 0 ? Math.abs((bar.Close ?? 0) - (bar.Open ?? 0)) / range : 0;
  // DOM pressure proxy: strong bull candle = high buy pressure, regardless of exact close position
  const domPressure = candleBull
    ? 0.5 + candleBody * 0.4            // bull candle: 0.50 → 0.90 based on body size
    : 0.5 - candleBody * 0.4;           // bear candle: 0.10 → 0.50 based on body size
  // 60% DOM pressure + 40% close ratio blend
  const blended = domPressure * 0.60 + closeRatio * 0.40;
  return ((bar.Volume ?? 0) * blended);
}

/** Estimate per-bar selling volume */
function estimateSellVolume(bar: AlpacaBar): number {
  return bar.Volume - estimateBuyVolume(bar);
}

// ─── Swing High / Low Detection ───────────────────────────────────────────────

function findSwingHigh(bars: AlpacaBar[], lookback = 20): number {
  const window = bars.slice(-Math.min(lookback, bars.length));
  return Math.max(...window.map((b) => (b.High ?? 0)));
}

function findSwingLow(bars: AlpacaBar[], lookback = 20): number {
  const window = bars.slice(-Math.min(lookback, bars.length));
  return Math.min(...window.map((b) => (b.Low ?? 0)));
}

/** Find significant swing highs/lows using pivot point method */
function findPivots(bars: AlpacaBar[], n = 3): { highs: number[]; lows: number[] } {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = n; i < bars.length - n; i++) {
    const isHigh = bars.slice(i - n, i + n + 1).every((b, j) => j === n || (b.High ?? 0) <= (bars[i]?.High ?? 0));
    const isLow = bars.slice(i - n, i + n + 1).every((b, j) => j === n || (b.Low ?? 0) >= (bars[i]?.Low ?? 0));
    if (isHigh) highs.push((bars[i]?.High ?? 0));
    if (isLow) lows.push((bars[i]?.Low ?? 0));
  }
  return { highs, lows };
}

// ─── SK Trading System — Structure Engine ────────────────────────────────────
// Based on the SK System philosophy: trade at the END of corrective moves
// into structural zones, keeping stops tight and maximizing R:R.
// Reference: https://sktradingsystem.framer.website/sksystem

export function computeSKFeatures(bars1m: AlpacaBar[], bars5m: AlpacaBar[]): SKFeatures {
  if (bars5m.length < 15) {
    return {
      bias: "neutral", sequence_stage: "none", correction_complete: false,
      zone_distance_pct: 1, swing_high: 0, swing_low: 0, impulse_strength: 0,
      sequence_score: 0, rr_quality: 0, in_zone: false,
    };
  }

  const last30_5m = bars5m.slice(-30);
  const last15_5m = bars5m.slice(-15);
  const lastClose = bars5m[bars5m.length - 1]?.Close ?? 0;

  // ── HTF Bias: Higher High / Higher Low vs Lower High / Lower Low ──────────
  const { highs: pivotHighs, lows: pivotLows } = findPivots(last30_5m, 3);

  let bias: SKBias = "neutral";
  if (pivotHighs.length >= 2 && pivotLows.length >= 2) {
    const hhPattern = pivotHighs[pivotHighs.length - 1] > pivotHighs[pivotHighs.length - 2];
    const hlPattern = pivotLows[pivotLows.length - 1] > pivotLows[pivotLows.length - 2];
    const lhPattern = pivotHighs[pivotHighs.length - 1] < pivotHighs[pivotHighs.length - 2];
    const llPattern = pivotLows[pivotLows.length - 1] < pivotLows[pivotLows.length - 2];
    if (hhPattern && hlPattern) bias = "bull";
    else if (lhPattern && llPattern) bias = "bear";
  } else {
    // Fallback: simple 5m slope
    const s = slope(last30_5m);
    if (s > 0.005) bias = "bull";
    else if (s < -0.005) bias = "bear";
  }

  // ── Swing Structure Zones ─────────────────────────────────────────────────
  const swingHigh = findSwingHigh(last30_5m, 30);
  const swingLow = findSwingLow(last30_5m, 30);
  const midZone = (swingHigh + swingLow) / 2;
  const structureRange = swingHigh - swingLow;

  // SK zone: areas near swing extremes (within 15% of structure range)
  const zoneThreshold = structureRange * 0.15;
  const nearHigh = Math.abs(lastClose - swingHigh) < zoneThreshold;
  const nearLow = Math.abs(lastClose - swingLow) < zoneThreshold;
  const in_zone = nearHigh || nearLow;
  const zone_distance_pct = structureRange > 0
    ? Math.min(Math.abs(lastClose - swingHigh), Math.abs(lastClose - swingLow)) / structureRange
    : 1;

  // ── Sequence Detection: Impulse → Correction → Completion ────────────────
  // Impulse: 3+ consecutive directional bars with above-avg range
  const avgR = avgRange(last15_5m);
  let impulseLen = 0;
  let impulseDir: "up" | "down" | null = null;
  for (let i = last15_5m.length - 1; i >= 0; i--) {
    const b = last15_5m[i];
    const range = (b?.High ?? 0) - (b?.Low ?? 0);
    const isUp = (b?.Close ?? 0) > (b?.Open ?? 0);
    if (i === last15_5m.length - 1) {
      impulseDir = isUp ? "up" : "down";
    }
    if (
      (impulseDir === "up" && isUp && range >= avgR * 0.8) ||
      (impulseDir === "down" && !isUp && range >= avgR * 0.8)
    ) {
      impulseLen++;
    } else {
      break;
    }
  }

  const impulse_strength = clamp(impulseLen / 5);

  // Corrective phase: after an impulse, look for counter-move (2-5 bars, smaller)
  const recentBars = last15_5m.slice(-8);
  let corrLen = 0;
  let postImpulse = false;
  for (let i = recentBars.length - 1; i >= 0; i--) {
    const b = recentBars[i];
    const range = (b?.High ?? 0) - (b?.Low ?? 0);
    const isOpposite =
      impulseDir === "up"
        ? (b?.Close ?? 0) < (b?.Open ?? 0)
        : (b?.Close ?? 0) > (b?.Open ?? 0);
    if (isOpposite && range < avgR * 1.2) {
      corrLen++;
      if (corrLen >= 2) postImpulse = true;
    } else if (corrLen > 0) break;
  }

  // Completion: correction ending — last 1-2 bars slowing down (smaller range)
  const lastBar = last15_5m[last15_5m.length - 1];
  const prevBar = last15_5m[last15_5m.length - 2];
  const corrSlowing = lastBar && prevBar &&
    ((lastBar?.High ?? 0) - (lastBar?.Low ?? 0)) < ((prevBar?.High ?? 0) - (prevBar?.Low ?? 0)) * 0.75;
  const correctionComplete = postImpulse && corrSlowing && corrLen >= 2 && corrLen <= 6;

  let sequence_stage: SKFeatures["sequence_stage"] = "none";
  if (impulseLen >= 3 && !postImpulse) sequence_stage = "impulse";
  else if (postImpulse && !correctionComplete) sequence_stage = "correction";
  else if (correctionComplete) sequence_stage = "completion";

  // ── R:R Quality from SK Zone ──────────────────────────────────────────────
  // If near low and bias is bull: potential move = lastClose → swingHigh, risk = to swingLow
  const potentialReward = nearLow
    ? swingHigh - lastClose
    : lastClose - swingLow;
  const potentialRisk = nearLow
    ? lastClose - swingLow
    : swingHigh - lastClose;
  const rr = potentialRisk > 0 ? potentialReward / potentialRisk : 0;
  const rr_quality = clamp(rr / 4); // normalize: 4:1 R:R = perfect score

  // ── Sequence Score ────────────────────────────────────────────────────────
  const sequence_score = clamp(
    (in_zone ? 0.3 : 0) +
    (correctionComplete ? 0.3 : postImpulse ? 0.15 : 0) +
    (impulse_strength * 0.2) +
    (rr_quality * 0.2)
  );

  return {
    bias,
    sequence_stage,
    correction_complete: correctionComplete,
    zone_distance_pct,
    swing_high: swingHigh,
    swing_low: swingLow,
    impulse_strength,
    sequence_score,
    rr_quality,
    in_zone,
  };
}

// ─── CVD Engine — Cumulative Volume Delta ─────────────────────────────────────
// Estimates buying vs selling pressure from OHLCV without tick data.
// Higher-accuracy approximation: uses close position within bar range.

export function computeCVDFeatures(bars: AlpacaBar[]): CVDFeatures {
  if (bars.length < 10) {
    return {
      cvd_value: 0, cvd_slope: 0, cvd_divergence: false,
      buy_volume_ratio: 0.5, delta_momentum: 0, large_delta_bar: false,
    };
  }

  const window = bars.slice(-30);
  const deltas: number[] = window.map((b) => estimateBuyVolume(b) - estimateSellVolume(b));

  // Cumulative sum
  let cumulative = 0;
  const cvdSeries = deltas.map((d) => (cumulative += d));

  const cvd_value = cvdSeries[cvdSeries.length - 1];
  const cvd_slope = slope(
    cvdSeries.map((value, index) => ({
      t: String(index),
      o: value,
      h: value,
      l: value,
      c: value,
      v: 0,
      Timestamp: String(index),
      Open: value,
      High: value,
      Low: value,
      Close: value,
      Volume: 0,
    }))
  );

  // Price slope vs CVD slope — divergence detection
  const priceSlope = slope(window);
  const cvdDivergence =
    (priceSlope > 0.001 && cvd_slope < -0.001) || // price rising, CVD falling = bearish divergence
    (priceSlope < -0.001 && cvd_slope > 0.001);    // price falling, CVD rising = bullish divergence

  const totalVol = window.reduce((s, b) => s + ((b.Volume) ?? 0), 0);
  const buyVol = window.reduce((s, b) => s + estimateBuyVolume(b), 0);
  const buy_volume_ratio = totalVol > 0 ? buyVol / totalVol : 0.5;

  // Delta momentum: recent 5 bar CVD slope vs full window
  const recentDeltas = deltas.slice(-5);
  let recentCum = 0;
  const recentCVD = recentDeltas.map((d) => (recentCum += d));
  const delta_momentum = recentCVD.length >= 2
    ? (recentCVD[recentCVD.length - 1] - recentCVD[0]) / (Math.abs(cvd_value) || 1)
    : 0;

  // Large delta bar: last bar's delta is 2x avg
  const lastDelta = Math.abs(deltas[deltas.length - 1]);
  const avgDelta = deltas.reduce((s, d) => s + Math.abs(d), 0) / deltas.length;
  const large_delta_bar = avgDelta > 0 && lastDelta > avgDelta * 2;

  return {
    cvd_value,
    cvd_slope,
    cvd_divergence: cvdDivergence,
    buy_volume_ratio,
    delta_momentum,
    large_delta_bar,
  };
}

// ─── Regime Detection ─────────────────────────────────────────────────────────

export function detectRegime(bars: AlpacaBar[]): Regime {
  if (bars.length < 20) return "ranging";

  const last20 = bars.slice(-20);
  const closes = last20.map((b) => (b.Close ?? 0));
  const high = Math.max(...last20.map((b) => (b.High ?? 0)));
  const low = Math.min(...last20.map((b) => (b.Low ?? 0)));
  const atr = avgRange(last20);
  const midPrice = (high + low) / 2;

  const overallSlope = slope(last20);
  const directionMatches = last20.filter((b) =>
    overallSlope > 0 ? (b?.Close ?? 0) > (b?.Open ?? 0) : (b?.Close ?? 0) < (b?.Open ?? 0)
  ).length;
  const directionalPersistence = directionMatches / last20.length;
  const rangeAsPct = midPrice > 0 ? (high - low) / midPrice : 0;

  if (directionalPersistence < 0.45 && rangeAsPct < 0.03) return "chop";

  const avgClose = closes.reduce((s, c) => s + c, 0) / closes.length;
  const atrPct = avgClose > 0 ? atr / avgClose : 0;
  if (atrPct > 0.025) return "volatile";

  if (directionalPersistence > 0.6 && Math.abs(overallSlope) > 0.008) {
    return overallSlope > 0 ? "trending_bull" : "trending_bear";
  }

  return "ranging";
}

// ─── No-Trade Filters ─────────────────────────────────────────────────────────

/** Options for no-trade filter application.
 *  replayMode: true disables strict intraday filters that only make sense in live execution.
 *  Equivalent to the RiskConfig replay overrides from the Python pipeline (CALIB_LO, max_spread_atr=99). */
export type NoTradeFilterOptions = {
  cooldowns?: SetupCooldowns;
  replayMode?: boolean;
  sessionAllowed?: boolean;
  newsLockoutActive?: boolean;
  /** Optional macro-bias context — enables macro_bias_block gate */
  macroBias?: MacroBiasResult;
  /** Optional sentiment context — enables sentiment_crowding_block gate */
  sentiment?: SentimentResult;
};

export function applyNoTradeFilters(
  bars: AlpacaBar[],
  recall: RecallFeatures,
  setup: SetupType,
  optionsOrCooldowns: NoTradeFilterOptions | SetupCooldowns = {}
): { blocked: boolean; reason: NoTradeReason } {
  // Handle both legacy (cooldowns object) and new options object
  let cooldowns: SetupCooldowns = {};
  let replayMode = false;
  let sessionAllowed = true;
  let newsLockoutActive = false;
  let macroBias: MacroBiasResult | undefined;
  let sentiment: SentimentResult | undefined;
  if ("replayMode" in optionsOrCooldowns || "cooldowns" in optionsOrCooldowns
      || "macroBias" in optionsOrCooldowns || "sentiment" in optionsOrCooldowns) {
    const opts = optionsOrCooldowns as NoTradeFilterOptions;
    cooldowns = opts.cooldowns ?? {};
    replayMode = opts.replayMode ?? false;
    sessionAllowed = opts.sessionAllowed ?? true;
    newsLockoutActive = opts.newsLockoutActive ?? false;
    macroBias = opts.macroBias;
    sentiment = opts.sentiment;
  } else {
    cooldowns = optionsOrCooldowns as SetupCooldowns;
  }

  // Macro bias gate: only in live mode — block when high-conviction bias opposes direction
  if (!replayMode && macroBias?.conviction === "high") {
    const setupDir: "long" | "short" = recall.trend_slope_5m >= 0 ? "long" : "short";
    if (macroBias.blockedDirections.includes(setupDir)) {
      return { blocked: true, reason: "macro_bias_block" };
    }
  }

  // Sentiment crowding gate: only in live mode — block when crowd is extreme and setup is crowd-aligned
  if (!replayMode && sentiment?.crowdingLevel === "extreme") {
    const setupDir: "long" | "short" = recall.trend_slope_5m >= 0 ? "long" : "short";
    const edgeFadesLong  = sentiment.institutionalEdge === "fade_long"  && setupDir === "long";
    const edgeFadesShort = sentiment.institutionalEdge === "fade_short" && setupDir === "short";
    if (edgeFadesLong || edgeFadesShort) {
      return { blocked: true, reason: "sentiment_crowding_block" };
    }
  }

  // Chop gate: always active — no edge in either mode
  if (recall.regime === "chop") return { blocked: true, reason: "chop_regime" };

  // Volatility bounds: raised for crypto (native high-vol asset)
  // In replay mode, widened further — equivalent to max_spread_atr=99 in Python
  const atrHighCap = replayMode ? 0.08 : 0.055;
  if (recall.atr_pct > atrHighCap) return { blocked: true, reason: "high_volatility_extreme" };
  if (recall.atr_pct < 0.001 && recall.avg_range_1m < 0.5) return { blocked: true, reason: "low_volatility" };

  if (!replayMode && !sessionAllowed) return { blocked: true, reason: "bad_session" };
  if (!replayMode && newsLockoutActive) return { blocked: true, reason: "news_lockout" };

  // Setup cooldown — only in live mode (replay has unlimited concurrent/daily)
  if (!replayMode) {
    const failures = cooldowns[setup] ?? 0;
    if (failures >= 3) return { blocked: true, reason: "setup_cooldown" };
  }

  // Conflicting flow — only in live mode
  if (!replayMode) {
    const trendUp = recall.trend_slope_5m > 0.003;
    const trendDown = recall.trend_slope_5m < -0.003;
    const momentumDown = recall.momentum_1m < -0.003;
    const momentumUp = recall.momentum_1m > 0.003;
    if ((trendUp && momentumDown) || (trendDown && momentumUp)) {
      if (setup === "continuation_pullback") return { blocked: true, reason: "conflicting_flow" };
    }
  }

  // SK zone filter: relaxed in replay mode (0.55 instead of 0.35)
  // Equivalent to the SK zone miss being less strict during historical scan
  const skZoneCap = replayMode ? 0.55 : 0.35;
  const setupDef = SETUP_CATALOG[setup as SetupType] ?? {
    requiresSkZone: false,
    requiresBiasAlignment: false,
    requiresCvdDivergence: false,
    minFinalQuality: 0,
  };
  if (setupDef.requiresSkZone && recall.sk.zone_distance_pct > skZoneCap) {
    return { blocked: true, reason: "sk_zone_miss" };
  }

  // SK bias conflict: enforce for any setup requiring bias alignment in live mode.
  if (!replayMode && setupDef.requiresBiasAlignment && recall.sk.bias !== "neutral" && !recall.sk.correction_complete) {
    const slopeUp = recall.trend_slope_5m > 0;
    if (recall.sk.bias === "bear" && slopeUp) return { blocked: true, reason: "sk_bias_conflict" };
    if (recall.sk.bias === "bull" && !slopeUp) return { blocked: true, reason: "sk_bias_conflict" };
  }

  // CVD divergence gate: only enforce in live mode
  if (!replayMode && setupDef.requiresCvdDivergence && !recall.cvd.cvd_divergence) {
    return { blocked: true, reason: "cvd_not_ready" };
  }

  return { blocked: false, reason: "none" };
}

// ─── Per-Setup Per-Regime Thresholds ─────────────────────────────────────────

function withCatalogFloors(
  thresholds: Record<SetupType, number>,
): Record<SetupType, number> {
  const result = { ...thresholds };
  for (const setup of DEFAULT_SETUPS) {
    result[setup] = Math.max(result[setup], SETUP_CATALOG[setup].minFinalQuality);
  }
  return result;
}

// Regime thresholds with setup-level minimum floors from shared setup catalog.
const REGIME_THRESHOLDS: Record<Regime, Record<SetupType, number>> = {
  trending_bull: withCatalogFloors({
    continuation_pullback: 0.58,
    sweep_reclaim: 0.63,
    absorption_reversal: 0.75,
    cvd_divergence: 0.68,
    breakout_failure: 0.70,
    vwap_reclaim: 0.62,
    opening_range_breakout: 0.66,
    post_news_continuation: 0.72,
  }),
  trending_bear: withCatalogFloors({
    continuation_pullback: 0.58,
    sweep_reclaim: 0.63,
    absorption_reversal: 0.75,
    cvd_divergence: 0.68,
    breakout_failure: 0.70,
    vwap_reclaim: 0.62,
    opening_range_breakout: 0.66,
    post_news_continuation: 0.72,
  }),
  ranging: withCatalogFloors({
    absorption_reversal: 0.65,
    sweep_reclaim: 0.70,
    continuation_pullback: 0.75,
    cvd_divergence: 0.65,
    breakout_failure: 0.67,
    vwap_reclaim: 0.69,
    opening_range_breakout: 0.78,
    post_news_continuation: 0.83,
  }),
  volatile: withCatalogFloors({
    sweep_reclaim: 0.75,
    absorption_reversal: 0.78,
    continuation_pullback: 0.82,
    cvd_divergence: 0.76,
    breakout_failure: 0.78,
    vwap_reclaim: 0.71,
    opening_range_breakout: 0.75,
    post_news_continuation: 0.74,
  }),
  chop: withCatalogFloors({
    absorption_reversal: 1.0,
    sweep_reclaim: 1.0,
    continuation_pullback: 1.0,
    cvd_divergence: 1.0,
    breakout_failure: 1.0,
    vwap_reclaim: 1.0,
    opening_range_breakout: 1.0,
    post_news_continuation: 1.0,
  }),
};

export function getQualityThreshold(regime: Regime, setup: SetupType): number {
  return REGIME_THRESHOLDS[regime]?.[setup] ?? 0.65;
}

// ─── Recall Features Builder ──────────────────────────────────────────────────

export function buildRecallFeatures(
  bars1m: AlpacaBar[],
  bars5m: AlpacaBar[],
  indicatorHints: string[] = []
): RecallFeatures {
  const last20_1m = bars1m.slice(-20);
  const last20_5m = bars5m.slice(-20);
  const trendSlope1m = slope(last20_1m);
  const trendSlope5m = slope(last20_5m);
  const trendSlope15m = slope(bars5m.slice(-6));
  const high = last20_1m.length > 0 ? Math.max(...last20_1m.map((b) => (b.High ?? 0))) : 0;
  const low = last20_1m.length > 0 ? Math.min(...last20_1m.map((b) => (b.Low ?? 0))) : 0;
  const lastClose = last20_1m[last20_1m.length - 1]?.Close ?? 0;
  const avgVol1m = avgVolume(last20_1m.slice(0, -1));
  const lastVol = last20_1m[last20_1m.length - 1]?.Volume ?? 0;
  const atr = computeATR(last20_1m);
  const atrPct = lastClose > 0 ? atr / lastClose : 0;
  const regime = detectRegime(bars1m);

  const directionMatches = last20_1m.filter((b) =>
    trendSlope1m > 0 ? (b?.Close ?? 0) > (b?.Open ?? 0) : (b?.Close ?? 0) < (b?.Open ?? 0)
  ).length;
  const directionalPersistence = directionMatches / (last20_1m.length || 1);

  // SK and CVD features
  const sk = computeSKFeatures(bars1m, bars5m);
  const cvd = computeCVDFeatures(bars1m);
  const { indicators, normalizedHints } = computeIndicatorFeatures(bars1m, indicatorHints);
  const sign1m = Math.sign(trendSlope1m);
  const sign5m = Math.sign(trendSlope5m);
  const sign15m = Math.sign(trendSlope15m);
  const agreementPenalty =
    Math.abs(sign1m - sign5m) +
    Math.abs(sign1m - sign15m) +
    Math.abs(sign5m - sign15m);
  const trendConsensus = clamp((1 - agreementPenalty / 6) * 0.7 + directionalPersistence * 0.3);

  const cvdTrendComponent = clamp((Math.tanh(cvd.cvd_slope * 250) + 1) / 2);
  const cvdVolumeComponent = clamp(cvd.buy_volume_ratio);
  const trendComponent = clamp((Math.tanh(trendSlope5m * 140) + 1) / 2);
  const flowAlignment = clamp(1 - Math.abs((cvdTrendComponent * 0.6 + cvdVolumeComponent * 0.4) - trendComponent));

  const rangeSeries = last20_1m.map((bar) => (bar?.High ?? 0) - (bar?.Low ?? 0));
  const rangeStd = standardDeviation(rangeSeries);
  const latestRange = rangeSeries[rangeSeries.length - 1] ?? 0;
  const avgRangeSeries = average(rangeSeries) || 1;
  const rangeZ = rangeStd > 0 ? Math.abs((latestRange - avgRangeSeries) / rangeStd) : 0;
  const volatilityZscore = clamp(rangeZ / 3);

  const wickNoise = clamp((wickRatio(last20_1m) - 0.25) / 0.55);
  const participationPenalty = clamp((1.05 - (avgVol1m > 0 ? lastVol / avgVol1m : 1)) / 0.8);
  const momentumCompression = clamp(1 - Math.min(Math.abs(last20_1m.length >= 5 ? slope(last20_1m.slice(-5)) : 0) * 240, 1));
  const regimePenalty = regime === "chop" ? 1 : regime === "ranging" ? 0.6 : regime === "volatile" ? 0.45 : 0.25;
  const fakeEntryRisk = clamp(
    wickNoise * 0.35 +
    participationPenalty * 0.2 +
    (1 - trendConsensus) * 0.2 +
    momentumCompression * 0.15 +
    regimePenalty * 0.1
  );

  return {
    trend_slope_1m: trendSlope1m,
    trend_slope_5m: trendSlope5m,
    trend_slope_15m: trendSlope15m,
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
    trend_consensus: trendConsensus,
    flow_alignment: flowAlignment,
    volatility_zscore: volatilityZscore,
    fake_entry_risk: fakeEntryRisk,
    sk,
    cvd,
    indicators,
    indicator_hints: normalizedHints,
  };
}

// ─── Setup Detectors ──────────────────────────────────────────────────────────

export function detectAbsorptionReversal(
  bars1m: AlpacaBar[],
  bars5m: AlpacaBar[],
  recall: RecallFeatures
): { detected: boolean; direction: "long" | "short"; structure: number; orderFlow: number } {
  if (bars1m.length < 5) return { detected: false, direction: "long", structure: 0, orderFlow: 0 };

  const last5 = bars1m.slice(-5);
  const lastBar = last5[last5.length - 1];
  const prevBars = last5.slice(0, -1);

  const prevBearish = prevBars.filter((b) => (b?.Close ?? 0) < (b?.Open ?? 0)).length;
  const prevBullish = prevBars.filter((b) => (b?.Close ?? 0) > (b?.Open ?? 0)).length;
  const lastBullish = (lastBar?.Close ?? 0) > (lastBar?.Open ?? 0);
  const lastBearish = (lastBar?.Close ?? 0) < (lastBar?.Open ?? 0);

  const avgVol = avgVolume(prevBars);
  const volSpike = avgVol > 0 ? ((lastBar?.Volume ?? 0) / avgVol) : 1;

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

  // SK alignment: absorption reversals work best AT SK zones where correction is completing
  const skBonus =
    recall.sk.in_zone && recall.sk.correction_complete ? 0.20 :
    recall.sk.in_zone ? 0.10 :
    recall.sk.zone_distance_pct < 0.2 ? 0.05 : 0;

  // SK bias alignment
  const skBiasAligned =
    (direction === "long" && recall.sk.bias === "bull") ||
    (direction === "short" && recall.sk.bias === "bear");
  const skBiasBonus = skBiasAligned ? 0.08 : recall.sk.bias === "neutral" ? 0 : -0.05;

  const regimeBonus =
    recall.regime === "ranging" ? 0.12 :
    recall.regime === "volatile" ? 0.05 :
    recall.regime === "chop" ? -0.2 : 0;

  const structure = clamp(
    0.4 +
    (recall.distance_from_low < 0.01 ? 0.15 : 0.08) +
    (recall.wick_ratio_5m > 0.4 ? 0.15 : 0.08) +
    (recall.trend_slope_5m > 0 ? 0.08 : 0) +
    regimeBonus + skBonus + skBiasBonus
  );

  // CVD order flow confirmation
  const cvdConfirm =
    direction === "long"
      ? recall.cvd.cvd_slope > 0 || recall.cvd.buy_volume_ratio > 0.55
      : recall.cvd.cvd_slope < 0 || recall.cvd.buy_volume_ratio < 0.45;
  const cvdBonus = cvdConfirm ? 0.12 : 0;

  const orderFlow = clamp(
    0.3 + Math.min(volSpike - 1, 0.5) +
    (recall.vol_relative > 1.5 ? 0.12 : 0.04) +
    cvdBonus
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
  const high10 = Math.max(...last10.map((b) => (b?.High ?? 0)));
  const low10 = Math.min(...last10.map((b) => (b?.Low ?? 0)));
  const lastBar = last10[last10.length - 1];
  const prevBar = last10[last10.length - 2];

  // Sweep: price briefly breaks a level then quickly reclaims it
  const bullSweep =
    (prevBar?.Low ?? 0) < low10 * 1.001 &&
    (lastBar?.Close ?? 0) > (prevBar?.Low ?? 0) &&
    (lastBar?.Close ?? 0) > (lastBar?.Open ?? 0) &&
    recall.momentum_1m > 0;

  const bearSweep =
    (prevBar?.High ?? 0) > high10 * 0.999 &&
    (lastBar?.Close ?? 0) < (prevBar?.High ?? 0) &&
    (lastBar?.Close ?? 0) < (lastBar?.Open ?? 0) &&
    recall.momentum_1m < 0;

  if (!bullSweep && !bearSweep) return { detected: false, direction: "long", structure: 0, orderFlow: 0 };

  const direction = bullSweep ? "long" : "short";
  const wickSize = bullSweep
    ? ((prevBar?.Close ?? 0) - (prevBar?.Low ?? 0)) / (((prevBar?.High ?? 0) - (prevBar?.Low ?? 0)) + 0.0001)
    : ((prevBar?.High ?? 0) - (prevBar?.Close ?? 0)) / (((prevBar?.High ?? 0) - (prevBar?.Low ?? 0)) + 0.0001);

  // SK alignment: sweeps are most powerful when they sweep an SK structural zone
  const skZoneSweep = recall.sk.in_zone;
  const skBonus =
    skZoneSweep && recall.sk.correction_complete ? 0.18 :
    skZoneSweep ? 0.10 : 0;

  const skBiasAligned =
    (direction === "long" && recall.sk.bias === "bull") ||
    (direction === "short" && recall.sk.bias === "bear");
  const skBiasBonus = skBiasAligned ? 0.08 : recall.sk.bias === "neutral" ? 0 : -0.05;

  const regimeBonus =
    recall.regime === "ranging" ? 0.10 :
    recall.regime === "volatile" ? 0.08 :
    recall.regime === "chop" ? -0.25 : 0.05;

  const structure = clamp(
    0.5 + wickSize * 0.25 +
    (recall.trend_slope_15m * (bullSweep ? 1 : -1) > 0 ? 0.12 : 0) +
    regimeBonus + skBonus + skBiasBonus
  );

  const avgVol = avgVolume(last10.slice(0, -1));
  const volSpike = avgVol > 0 ? ((lastBar?.Volume ?? 0) / avgVol) : 1;

  // CVD confirmation: sweep reclaim should show delta flip
  const cvdFlip =
    direction === "long"
      ? recall.cvd.cvd_slope > 0 && recall.cvd.large_delta_bar
      : recall.cvd.cvd_slope < 0 && recall.cvd.large_delta_bar;
  const cvdBonus = cvdFlip ? 0.15 : recall.cvd.cvd_divergence ? 0.08 : 0;

  const orderFlow = clamp(
    0.35 + Math.min(volSpike - 1, 0.40) +
    (recall.vol_relative > 1.2 ? 0.08 : 0) +
    cvdBonus
  );

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
    (lastBar?.Close ?? 0) > (lastBar?.Open ?? 0) &&
    recall.momentum_1m > 0;

  const bearCont =
    trendDown &&
    recall.consec_bullish >= 2 &&
    (lastBar?.Close ?? 0) < (lastBar?.Open ?? 0) &&
    recall.momentum_1m < 0;

  if (!bullCont && !bearCont) return { detected: false, direction: "long", structure: 0, orderFlow: 0 };

  const direction = bullCont ? "long" : "short";
  const trendStrength = Math.min(Math.abs(recall.trend_slope_5m) * 100, 0.40);

  // SK: continuation is BEST when it aligns with SK bias AND
  // the correction is completing within the SK sequence
  const skAligned =
    (direction === "long" && recall.sk.bias === "bull") ||
    (direction === "short" && recall.sk.bias === "bear");
  const skSeqBonus =
    skAligned && recall.sk.correction_complete ? 0.25 :
    skAligned && recall.sk.sequence_stage === "correction" ? 0.15 :
    skAligned ? 0.08 : -0.05;

  const regimeBonus =
    recall.regime === "trending_bull" || recall.regime === "trending_bear" ? 0.15 :
    recall.regime === "ranging" ? -0.10 :
    recall.regime === "chop" ? -0.30 : 0;

  const structure = clamp(
    0.5 + trendStrength +
    (recall.wick_ratio_1m < 0.3 ? 0.08 : 0) +
    regimeBonus + skSeqBonus
  );

  // CVD: delta should confirm continuation direction
  const cvdAligned =
    direction === "long" ? recall.cvd.cvd_slope > 0 : recall.cvd.cvd_slope < 0;
  const cvdBonus = cvdAligned ? 0.12 : recall.cvd.cvd_divergence ? -0.08 : 0;

  const orderFlow = clamp(
    0.40 +
    (recall.vol_relative > 1.0 ? 0.12 : 0) +
    (Math.abs(recall.momentum_1m) > 0.001 ? 0.10 : 0) +
    cvdBonus
  );

  return { detected: true, direction, structure, orderFlow };
}

/** CVD Divergence — price and volume delta disagree, signaling reversal */
export function detectCVDDivergence(
  bars1m: AlpacaBar[],
  bars5m: AlpacaBar[],
  recall: RecallFeatures
): { detected: boolean; direction: "long" | "short"; structure: number; orderFlow: number } {
  if (bars1m.length < 15) return { detected: false, direction: "long", structure: 0, orderFlow: 0 };

  // Requires confirmed CVD divergence from the CVD engine
  if (!recall.cvd.cvd_divergence) return { detected: false, direction: "long", structure: 0, orderFlow: 0 };

  const last10 = bars1m.slice(-10);
  const priceSlope = slope(last10);
  const cvd = recall.cvd;

  // Bullish divergence: price falling but CVD rising (buying pressure hidden)
  const bullDiv = priceSlope < -0.001 && (cvd?.cvd_slope ?? 0) > 0;
  // Bearish divergence: price rising but CVD falling (selling pressure hidden)
  const bearDiv = priceSlope > 0.001 && (cvd?.cvd_slope ?? 0) < 0;

  if (!bullDiv && !bearDiv) return { detected: false, direction: "long", structure: 0, orderFlow: 0 };

  const direction = bullDiv ? "long" : "short";

  // SK alignment: CVD divergence is most powerful at SK structural zones
  const skZoneBonus = recall.sk.in_zone ? 0.18 : 0;
  const skBiasAligned =
    (direction === "long" && recall.sk.bias === "bull") ||
    (direction === "short" && recall.sk.bias === "bear");
  const skBiasBonus = skBiasAligned ? 0.10 : recall.sk.bias === "neutral" ? 0 : -0.05;

  const regimeBonus =
    recall.regime === "ranging" ? 0.12 :
    recall.regime === "volatile" ? 0.08 :
    recall.regime === "chop" ? -0.20 : 0.05;

  const structure = clamp(
    0.45 +
    (Math.abs(priceSlope) * 30) +
    skZoneBonus + skBiasBonus + regimeBonus
  );

  // Order flow: magnitude of CVD divergence + volume
  const deltaStrength = clamp(Math.abs(cvd.delta_momentum));
  const orderFlow = clamp(
    0.40 +
    deltaStrength * 0.30 +
    (cvd.large_delta_bar ? 0.12 : 0) +
    (cvd.buy_volume_ratio > 0.60 && bullDiv ? 0.10 : 0) +
    (cvd.buy_volume_ratio < 0.40 && bearDiv ? 0.10 : 0)
  );

  return { detected: true, direction, structure, orderFlow };
}

/** Breakout Failure — false breakout beyond SK structural zone, price snaps back */
export function detectBreakoutFailure(
  bars1m: AlpacaBar[],
  bars5m: AlpacaBar[],
  recall: RecallFeatures
): { detected: boolean; direction: "long" | "short"; structure: number; orderFlow: number } {
  if (bars1m.length < 12) return { detected: false, direction: "long", structure: 0, orderFlow: 0 };

  const last12 = bars1m.slice(-12);
  const lastBar = last12[last12.length - 1];
  const prevBar = last12[last12.length - 2];

  // Need to be near an SK structural zone for breakout failure to be valid
  if (!recall.sk.in_zone) return { detected: false, direction: "long", structure: 0, orderFlow: 0 };

  const swingHigh = recall.sk.swing_high;
  const swingLow = recall.sk.swing_low;
  const breakPct = 0.003; // 0.3% beyond level = fake breakout territory

  // Bullish breakout failure: price briefly went below swingLow then snapped back above
  const bullBOF =
    (prevBar?.Low ?? 0) < swingLow * (1 - breakPct) &&
    (lastBar?.Close ?? 0) > swingLow &&
    (lastBar?.Close ?? 0) > (lastBar?.Open ?? 0) &&
    recall.wick_ratio_1m > 0.40;

  // Bearish breakout failure: price briefly went above swingHigh then snapped back below
  const bearBOF =
    (prevBar?.High ?? 0) > swingHigh * (1 + breakPct) &&
    (lastBar?.Close ?? 0) < swingHigh &&
    (lastBar?.Close ?? 0) < (lastBar?.Open ?? 0) &&
    recall.wick_ratio_1m > 0.40;

  if (!bullBOF && !bearBOF) return { detected: false, direction: "long", structure: 0, orderFlow: 0 };

  const direction = bullBOF ? "long" : "short";

  // The breakout failure is an SK core concept: false break at a zone
  const skBonus =
    recall.sk.correction_complete ? 0.20 :
    recall.sk.sequence_stage === "correction" ? 0.12 : 0.05;

  const skBiasAligned =
    (direction === "long" && recall.sk.bias !== "bear") ||
    (direction === "short" && recall.sk.bias !== "bull");
  const skBiasBonus = skBiasAligned ? 0.10 : -0.10;

  const regimeBonus =
    recall.regime === "ranging" ? 0.15 :
    recall.regime === "volatile" ? 0.05 :
    recall.regime === "chop" ? -0.20 : 0;

  const structure = clamp(
    0.50 +
    (recall.wick_ratio_1m > 0.50 ? 0.10 : 0.05) +
    skBonus + skBiasBonus + regimeBonus
  );

  // Volume on the snap-back bar is key
  const avgVol = avgVolume(last12.slice(0, -1));
  const volSpike = avgVol > 0 ? ((lastBar?.Volume ?? 0) / avgVol) : 1;

  // CVD: a breakout failure should show delta reversal
  const cvdReversed =
    direction === "long"
      ? recall.cvd.cvd_slope > 0 || recall.cvd.buy_volume_ratio > 0.55
      : recall.cvd.cvd_slope < 0 || recall.cvd.buy_volume_ratio < 0.45;
  const cvdBonus = cvdReversed ? 0.12 : 0;

  const orderFlow = clamp(
    0.35 + Math.min(volSpike - 1, 0.40) +
    (recall.vol_relative > 1.3 ? 0.10 : 0) +
    cvdBonus
  );

  return { detected: true, direction, structure, orderFlow };
}

function computeRollingVWAP(bars: AlpacaBar[]): number {
  if (!bars.length) return 0;
  const recent = bars.slice(-40);
  let weightedPrice = 0;
  let totalVol = 0;
  for (const bar of recent) {
    const v = Number((bar as any).Volume ?? 0);
    const barVwap = Number((bar as any).VWAP ?? 0);
    const price = Number.isFinite(barVwap) && barVwap > 0 ? barVwap : (((bar?.High ?? 0) + (bar?.Low ?? 0) + (bar?.Close ?? 0)) / 3);
    weightedPrice += price * Math.max(v, 1);
    totalVol += Math.max(v, 1);
  }
  return totalVol > 0 ? weightedPrice / totalVol : ((recent[recent.length - 1]?.Close) ?? 0);
}

/** VWAP reclaim/value setup: cross through session value with flow confirmation */
export function detectVWAPReclaim(
  bars1m: AlpacaBar[],
  bars5m: AlpacaBar[],
  recall: RecallFeatures
): { detected: boolean; direction: "long" | "short"; structure: number; orderFlow: number } {
  if (bars1m.length < 12) return { detected: false, direction: "long", structure: 0, orderFlow: 0 };

  const recent = bars1m.slice(-12);
  const prev = recent[recent.length - 2];
  const last = recent[recent.length - 1];
  const vwap = computeRollingVWAP(recent);
  if (!Number.isFinite(vwap) || vwap <= 0) return { detected: false, direction: "long", structure: 0, orderFlow: 0 };

  const longReclaim =
    (prev?.Close ?? 0) <= vwap &&
    (last?.Close ?? 0) > vwap &&
    (last?.Close ?? 0) > (last?.Open ?? 0) &&
    recall.momentum_1m > 0;
  const shortReclaim =
    (prev?.Close ?? 0) >= vwap &&
    (last?.Close ?? 0) < vwap &&
    (last?.Close ?? 0) < (last?.Open ?? 0) &&
    recall.momentum_1m < 0;

  if (!longReclaim && !shortReclaim) return { detected: false, direction: "long", structure: 0, orderFlow: 0 };

  const direction = longReclaim ? "long" : "short";
  const priceDist = Math.abs((last?.Close ?? 0) - vwap) / Math.max(vwap, 1);
  const skBiasAligned =
    (direction === "long" && recall.sk.bias !== "bear") ||
    (direction === "short" && recall.sk.bias !== "bull");
  const structure = clamp(
    0.48 +
    (priceDist < 0.004 ? 0.14 : 0.08) +
    (recall.regime === "ranging" ? 0.08 : 0) +
    (recall.regime === "chop" ? -0.15 : 0) +
    (skBiasAligned ? 0.08 : -0.05) +
    recall.sk.sequence_score * 0.1
  );

  const cvdAligned =
    direction === "long"
      ? recall.cvd.cvd_slope > 0 || recall.cvd.buy_volume_ratio > 0.52
      : recall.cvd.cvd_slope < 0 || recall.cvd.buy_volume_ratio < 0.48;
  const orderFlow = clamp(
    0.42 +
    (cvdAligned ? 0.16 : -0.05) +
    (recall.vol_relative > 1.1 ? 0.1 : 0.03) +
    (Math.abs(recall.cvd.delta_momentum) > 0.08 ? 0.08 : 0.02)
  );

  return { detected: true, direction, structure, orderFlow };
}

/** Opening range breakout setup (intraday expansion) */
export function detectOpeningRangeBreakout(
  bars1m: AlpacaBar[],
  bars5m: AlpacaBar[],
  recall: RecallFeatures
): { detected: boolean; direction: "long" | "short"; structure: number; orderFlow: number } {
  if (bars1m.length < 40) return { detected: false, direction: "long", structure: 0, orderFlow: 0 };

  const latest = bars1m[bars1m.length - 1];
  const prev = bars1m[bars1m.length - 2];
  const latestTs = new Date((latest?.Timestamp as string) ?? "");
  const dayStartUtc = Date.UTC(latestTs.getUTCFullYear(), latestTs.getUTCMonth(), latestTs.getUTCDate(), 13, 30, 0, 0); // NY open proxy
  const openWindowEnd = dayStartUtc + 30 * 60 * 1000;

  let openingBars = bars1m.filter((bar) => {
    const t = Date.parse((bar?.Timestamp as string) ?? "");
    return Number.isFinite(t) && t >= dayStartUtc && t < openWindowEnd;
  });

  if (openingBars.length < 8) {
    // Fallback when market/session bars are sparse (crypto or off-session replay)
    openingBars = bars1m.slice(-30);
  }

  const rangeHigh = Math.max(...openingBars.map((bar) => (bar?.High ?? 0)));
  const rangeLow = Math.min(...openingBars.map((bar) => (bar?.Low ?? 0)));
  const rangeWidthPct = (rangeHigh - rangeLow) / Math.max(rangeHigh, 1);
  if (rangeWidthPct < 0.0015) return { detected: false, direction: "long", structure: 0, orderFlow: 0 };

  const brokeUp = (latest?.Close ?? 0) > rangeHigh && (prev?.Close ?? 0) <= rangeHigh;
  const brokeDown = (latest?.Close ?? 0) < rangeLow && (prev?.Close ?? 0) >= rangeLow;
  if (!brokeUp && !brokeDown) return { detected: false, direction: "long", structure: 0, orderFlow: 0 };

  const direction: "long" | "short" = brokeUp ? "long" : "short";
  const trendAligned =
    (direction === "long" && recall.trend_slope_5m > 0) ||
    (direction === "short" && recall.trend_slope_5m < 0);
  const structure = clamp(
    0.5 +
    (recall.regime === "volatile" ? 0.15 : 0.05) +
    (trendAligned ? 0.12 : -0.06) +
    clamp(rangeWidthPct * 12) * 0.12 +
    clamp(recall.directional_persistence) * 0.1
  );

  const cvdAligned =
    direction === "long"
      ? recall.cvd.cvd_slope > 0 && recall.cvd.buy_volume_ratio > 0.52
      : recall.cvd.cvd_slope < 0 && recall.cvd.buy_volume_ratio < 0.48;
  const orderFlow = clamp(
    0.44 +
    (cvdAligned ? 0.16 : -0.07) +
    (recall.vol_relative > 1.2 ? 0.12 : 0.04) +
    (recall.cvd.large_delta_bar ? 0.08 : 0.02)
  );

  return { detected: true, direction, structure, orderFlow };
}

/** Post-news continuation setup (event-like volatility expansion continuation) */
export function detectPostNewsContinuation(
  bars1m: AlpacaBar[],
  bars5m: AlpacaBar[],
  recall: RecallFeatures
): { detected: boolean; direction: "long" | "short"; structure: number; orderFlow: number } {
  if (bars1m.length < 16) return { detected: false, direction: "long", structure: 0, orderFlow: 0 };
  if (!(recall.regime === "volatile" || recall.regime === "trending_bull" || recall.regime === "trending_bear")) {
    return { detected: false, direction: "long", structure: 0, orderFlow: 0 };
  }
  if (recall.atr_pct < 0.004) return { detected: false, direction: "long", structure: 0, orderFlow: 0 };

  const last5 = bars1m.slice(-5);
  const directionalBars = last5.filter((bar) => (bar?.Close ?? 0) > (bar?.Open ?? 0)).length;
  const trendUp = recall.trend_slope_5m > 0 && recall.trend_slope_15m > -0.001;
  const trendDown = recall.trend_slope_5m < 0 && recall.trend_slope_15m < 0.001;

  const longSetup =
    trendUp &&
    directionalBars >= 3 &&
    recall.directional_persistence > 0.55 &&
    recall.vol_relative > 1.15;
  const shortSetup =
    trendDown &&
    directionalBars <= 2 &&
    recall.directional_persistence > 0.55 &&
    recall.vol_relative > 1.15;

  if (!longSetup && !shortSetup) return { detected: false, direction: "long", structure: 0, orderFlow: 0 };

  const direction: "long" | "short" = longSetup ? "long" : "short";
  const structure = clamp(
    0.52 +
    clamp(Math.abs(recall.trend_slope_5m) * 120) * 0.15 +
    clamp(recall.directional_persistence) * 0.12 +
    (recall.volatility_zscore > 0.35 ? 0.08 : 0.03) +
    (recall.sk.sequence_stage === "impulse" ? 0.07 : 0)
  );

  const cvdAligned =
    direction === "long"
      ? recall.cvd.cvd_slope > 0 && recall.cvd.buy_volume_ratio > 0.54
      : recall.cvd.cvd_slope < 0 && recall.cvd.buy_volume_ratio < 0.46;
  const orderFlow = clamp(
    0.45 +
    (cvdAligned ? 0.18 : -0.08) +
    (Math.abs(recall.cvd.delta_momentum) > 0.12 ? 0.1 : 0.04) +
    (recall.cvd.large_delta_bar ? 0.08 : 0.02)
  );

  return { detected: true, direction, structure, orderFlow };
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

function indicatorDirectionalConfidence(
  recall: RecallFeatures,
  direction: "long" | "short"
): number {
  const hints = new Set(recall.indicator_hints);
  let weighted = 0;
  let total = 0;

  const scoreSignal = (weight: number, bull: boolean, bear: boolean) => {
    total += weight;
    if ((direction === "long" && bull) || (direction === "short" && bear)) {
      weighted += weight;
    } else if ((direction === "long" && bear) || (direction === "short" && bull)) {
      weighted -= weight * 0.7;
    }
  };

  scoreSignal(hints.has("rsi") ? 1.5 : 1, recall.indicators.rsi_14 >= 52, recall.indicators.rsi_14 <= 48);
  scoreSignal(hints.has("macd") ? 1.5 : 1, recall.indicators.macd_hist >= 0, recall.indicators.macd_hist <= 0);
  scoreSignal(hints.has("ema") ? 1.4 : 1, recall.indicators.ema_spread_pct >= 0, recall.indicators.ema_spread_pct <= 0);
  scoreSignal(hints.has("bollinger") ? 1.2 : 0.8, recall.indicators.bb_position >= 0.52, recall.indicators.bb_position <= 0.48);

  if (total === 0) return 0.5;
  const normalized = weighted / total; // roughly -1..1
  return clamp((normalized + 1) / 2);
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

  // CALIB_LO raised 0.40 → 0.55: setup detectors already filtered for quality,
  // so the baseline should sit comfortably above the 0.50 stub threshold.
  // This is equivalent to the Python pipeline's CALIB_LO=0.55 fix.
  let score = 0.53;
  if (trendAligned) score += 0.12;
  if (momentumAligned) score += 0.10;
  if (recall.vol_relative > 1.2) score += 0.07;
  if (recall.wick_ratio_5m > 0.35) score += 0.06;
  if (setup === "absorption_reversal" && !trendAligned) score += 0.04;
  score += (recall.trend_consensus - 0.5) * 0.14;
  score += (recall.flow_alignment - 0.5) * 0.10;

  // Regime alignment
  if (
    (setup === "continuation_pullback" && (recall.regime === "trending_bull" || recall.regime === "trending_bear")) ||
    (setup === "absorption_reversal" && recall.regime === "ranging") ||
    (setup === "sweep_reclaim" && (recall.regime === "ranging" || recall.regime === "volatile")) ||
    (setup === "cvd_divergence" && recall.regime === "ranging") ||
    (setup === "breakout_failure" && recall.regime === "ranging") ||
    (setup === "vwap_reclaim" && (recall.regime === "ranging" || recall.regime === "trending_bull" || recall.regime === "trending_bear")) ||
    (setup === "opening_range_breakout" && (recall.regime === "volatile" || recall.regime === "trending_bull" || recall.regime === "trending_bear")) ||
    (setup === "post_news_continuation" && (recall.regime === "volatile" || recall.regime === "trending_bull" || recall.regime === "trending_bear"))
  ) {
    score += 0.10;
  }

  // SK sequence score bonus
  score += recall.sk.sequence_score * 0.12;

  // CVD alignment bonus
  const cvdAligned =
    direction === "long" ? recall.cvd.buy_volume_ratio > 0.52 : recall.cvd.buy_volume_ratio < 0.48;
  if (cvdAligned) score += 0.06;

  // Indicator alignment and hint-aware confirmation
  const indicatorConfidence = indicatorDirectionalConfidence(recall, direction);
  score += (indicatorConfidence - 0.5) * 0.14;

  if (recall.indicators.indicator_bias !== "neutral") {
    const indicatorBiasAligned =
      (direction === "long" && recall.indicators.indicator_bias === "bull") ||
      (direction === "short" && recall.indicators.indicator_bias === "bear");
    score += indicatorBiasAligned ? 0.04 : -0.04;
  }

  // Setup-specific indicator context
  const rsi = recall.indicators.rsi_14;
  if (setup === "continuation_pullback") {
    if ((direction === "long" && rsi >= 50) || (direction === "short" && rsi <= 50)) score += 0.03;
  } else if (setup === "vwap_reclaim") {
    if ((direction === "long" && recall.indicators.bb_position <= 0.55) || (direction === "short" && recall.indicators.bb_position >= 0.45)) score += 0.03;
  } else if (setup === "opening_range_breakout" || setup === "post_news_continuation") {
    if ((direction === "long" && recall.indicators.macd_hist >= 0) || (direction === "short" && recall.indicators.macd_hist <= 0)) score += 0.03;
  } else if (setup === "absorption_reversal" || setup === "sweep_reclaim" || setup === "breakout_failure") {
    if ((direction === "long" && rsi <= 45) || (direction === "short" && rsi >= 55)) score += 0.03;
  }

  const fakeEntryPenaltyWeight = setup === "continuation_pullback" ? 0.18 : 0.14;
  score -= recall.fake_entry_risk * fakeEntryPenaltyWeight;
  score -= recall.volatility_zscore * 0.07;

  // v2: Multi-timeframe trend disagreement penalty
  const tf1m = Math.sign(recall.trend_slope_1m);
  const tf5m = Math.sign(recall.trend_slope_5m);
  const tf15m = Math.sign(recall.trend_slope_15m);
  const tfDisagreement = (tf1m !== tf5m ? 1 : 0) + (tf5m !== tf15m ? 1 : 0) + (tf1m !== tf15m ? 1 : 0);
  if (tfDisagreement >= 2) score -= 0.06;

  // v2: SK zone + bias alignment super-bonus
  if (recall.sk.in_zone && recall.sk.correction_complete) {
    const biasAligned =
      (direction === "long" && recall.sk.bias === "bull") ||
      (direction === "short" && recall.sk.bias === "bear");
    if (biasAligned) score += 0.08;
  }

  return clamp(score);
}

export function computeFinalQuality(
  structure: number,
  orderFlow: number,
  recall: number,
  context?: { recall?: RecallFeatures; direction?: "long" | "short"; setup_type?: SetupType }
): number {
  const safeStructure = clamp(Number.isFinite(structure) ? structure : 0);
  const safeOrderFlow = clamp(Number.isFinite(orderFlow) ? orderFlow : 0);
  const safeRecall = clamp(Number.isFinite(recall) ? recall : 0);

  // Layer 4: ML Model — trained logistic regression (falls back to heuristic if untrained)
  const mlPred = predictWinProbability({
    structure_score: safeStructure,
    order_flow_score: safeOrderFlow,
    recall_score: safeRecall,
    final_quality: 0.30 * safeStructure + 0.25 * safeOrderFlow + 0.20 * safeRecall, // pre-ML estimate
    setup_type: context?.setup_type ?? "absorption_reversal",
    regime: context?.recall?.regime ?? "ranging",
    direction: context?.direction,
  });
  const ml = clamp(mlPred.probability);
  const claude = clamp(0.52 + (safeStructure + safeOrderFlow) * 0.22);
  return clamp(
    computeFinalQualityScore({
      structure: safeStructure,
      orderflow: safeOrderFlow,
      recall: safeRecall,
      ml,
      claude,
    }),
  );
}

// ─── Chart Overlay Events ─────────────────────────────────────────────────────
// Normalized payload for future chart rendering / WebSocket emission

export function buildChartOverlay(
  setup: SetupType,
  instrument: string,
  direction: "long" | "short",
  structure: number,
  orderFlow: number,
  recall: RecallFeatures,
  finalQuality: number,
  threshold: number,
  entry: number,
  sl: number,
  tp: number,
  barTime: string
): ChartOverlayEvent {
  const meetsThreshold = finalQuality >= threshold;
  const labels: string[] = [];

  if (recall.sk.in_zone) labels.push("sk_zone");
  if (recall.sk.correction_complete) labels.push("sk_completion");
  if (recall.cvd.cvd_divergence) labels.push("cvd_div");
  if (recall.cvd.large_delta_bar) labels.push("delta_spike");
  if (recall.regime === "chop") labels.push("chop");
  if (recall.atr_pct > 0.025) labels.push("high_vol");
  if (meetsThreshold) labels.push("risk_ok");
  else labels.push("below_threshold");

  return {
    ts: barTime,
    instrument,
    setup_type: setup,
    direction,
    decision_type: meetsThreshold ? "TRADE" : finalQuality > 0.45 ? "REJECTED" : "PASS",
    scores: {
      structure,
      order_flow: orderFlow,
      recall: scoreRecall(recall, setup, direction),
      final: finalQuality,
      sk_sequence: recall.sk.sequence_score,
      cvd_slope: recall.cvd.cvd_slope,
    },
    entry_price: entry,
    sl_price: sl,
    tp_price: tp,
    labels,
    regime: recall.regime,
    sk_bias: recall.sk.bias,
    meets_threshold: meetsThreshold,
    reason: meetsThreshold ? "approved" : `quality_${finalQuality.toFixed(2)}_below_${threshold.toFixed(2)}`,
  };
}

// ─── Execution Utilities ──────────────────────────────────────────────────────

export function computeTPSL(
  entryPrice: number,
  direction: "long" | "short",
  atr: number,
  regime: Regime = "ranging"
): { takeProfit: number; stopLoss: number; tpTicks: number; slTicks: number } {
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
    if (i === 0) return (b?.High ?? 0) - (b?.Low ?? 0);
    const prev = arr[i - 1];
    return Math.max((b?.High ?? 0) - (b?.Low ?? 0), Math.abs((b?.High ?? 0) - (prev?.Close ?? 0)), Math.abs((b?.Low ?? 0) - (prev?.Close ?? 0)));
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
      if ((bar?.High ?? 0) >= tp) return { outcome: "win", hitTP: true, barsChecked: i + 1 };
      if ((bar?.Low ?? 0) <= sl) return { outcome: "loss", hitTP: false, barsChecked: i + 1 };
    } else {
      if ((bar?.Low ?? 0) <= tp) return { outcome: "win", hitTP: true, barsChecked: i + 1 };
      if ((bar?.High ?? 0) >= sl) return { outcome: "loss", hitTP: false, barsChecked: i + 1 };
    }
  }
  return { outcome: "open", hitTP: false, barsChecked: forwardBars.length };
}
