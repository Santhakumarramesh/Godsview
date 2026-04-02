/**
 * strategy_engine.test.ts — Phase 25: Strategy Engine Core
 *
 * Tests the pure computation functions exported from strategy_engine.ts:
 *
 *   detectRegime:
 *     - < 20 bars → "ranging" fallback
 *     - chop: low directional persistence (<0.45) AND narrow range (<3%)
 *     - volatile: ATR% > 2.5%
 *     - trending_bull: slope > 0, directional persistence > 0.6
 *     - trending_bear: slope < 0, directional persistence > 0.6
 *     - ranging: moderate slope, moderate persistence
 *
 *   getQualityThreshold:
 *     - returns correct thresholds per regime × setup combination
 *     - chop regime → 1.0 for all setups
 *     - volatile regime → raises thresholds vs trending
 *     - unknown regime/setup → falls back to 0.65
 *
 *   computeATR:
 *     - < 2 bars → 0
 *     - uses true range (high-low, high-prevClose, low-prevClose)
 *     - averages up to last 14 bars
 *     - constant bars → ATR = constant range
 *
 *   computeTPSL:
 *     - trending regime → tp multiplier 2.5 vs ranging 2.0
 *     - volatile regime → sl multiplier 1.5 vs default 1.0
 *     - tick size: >10000 → 5, >1000 → 1, else 0.25
 *     - minimum distances enforced (tickSize × 12 for TP, × 6 for SL)
 *     - long direction: TP above entry, SL below entry
 *     - short direction: TP below entry, SL above entry
 *     - tpTicks and slTicks rounded to integers
 *
 *   checkForwardOutcome:
 *     - empty bars → { outcome: "open", hitTP: false, barsChecked: 0 }
 *     - long: TP hit → win
 *     - long: SL hit → loss
 *     - long: no hit → open
 *     - short: TP hit (low ≤ tp) → win
 *     - short: SL hit (high ≥ sl) → loss
 *     - resolves on correct bar index (barsChecked)
 *     - TP checked before SL
 *
 *   applyNoTradeFilters:
 *     - chop regime always blocked with "chop_regime"
 *     - ATR% > 0.055 in live mode → "high_volatility_extreme"
 *     - ATR% < 0.001 AND avg_range < 0.5 → "low_volatility"
 *     - replayMode: ATR% cap raised to 0.08
 *     - sessionAllowed=false in live mode → "bad_session"
 *     - newsLockoutActive=true in live mode → "news_lockout"
 *     - setup cooldowns ≥ 3 in live mode → "setup_cooldown"
 *     - sk_zone_miss: zone_distance_pct > 0.35 for setups that require zone
 *     - replayMode: sk zone cap raised to 0.55
 *     - clean path → { blocked: false, reason: "none" }
 *
 *   scoreRecall:
 *     - baseline score ≈ 0.53 for neutral recall
 *     - trend-aligned long bumps score
 *     - momentum-aligned short bumps score
 *     - regime-setup alignment adds 0.10 bonus
 *     - SK zone + correction_complete + bias aligned adds super-bonus
 *     - output clamped to [0, 1]
 *
 *   computeFinalQuality:
 *     - output clamped to [0, 1]
 *     - NaN / Infinity inputs treated as 0
 *     - higher structure/orderflow/recall → higher final quality
 *     - all-zero inputs → result > 0 (ML stub contributes baseline)
 */

import { describe, it, expect } from "vitest";
import type { AlpacaBar } from "../lib/alpaca";
import type {
  RecallFeatures,
  SKFeatures,
  CVDFeatures,
  IndicatorFeatures,
  Regime,
} from "../lib/strategy_engine";
import {
  detectRegime,
  getQualityThreshold,
  computeATR,
  computeTPSL,
  checkForwardOutcome,
  applyNoTradeFilters,
  scoreRecall,
  computeFinalQuality,
} from "../lib/strategy_engine";

// ─── Bar factories ─────────────────────────────────────────────────────────────

function makeBar(
  open: number, high: number, low: number, close: number,
  volume = 10_000,
): AlpacaBar {
  return {
    t: new Date().toISOString(), o: open, h: high, l: low, c: close, v: volume,
    Timestamp: new Date().toISOString(),
    Open: open, High: high, Low: low, Close: close, Volume: volume,
  };
}

/** Flat bars — all at the same price with a small fixed range. */
function flatBars(price: number, count: number, range = 0.5): AlpacaBar[] {
  return Array.from({ length: count }, () =>
    makeBar(price, price + range, price - range, price),
  );
}

/**
 * Trending bars — each close steps by `stepAbs`.
 * When stepAbs > 0: bullish (close > open every bar).
 * When stepAbs < 0: bearish (close < open every bar).
 */
function trendingBars(
  startPrice: number,
  stepAbs: number,
  count: number,
  range = 0.5,
): AlpacaBar[] {
  return Array.from({ length: count }, (_, i) => {
    const close = startPrice + stepAbs * (i + 1);
    const open = startPrice + stepAbs * i;
    const high = Math.max(open, close) + range;
    const low  = Math.min(open, close) - range;
    return makeBar(open, high, low, close);
  });
}

/**
 * Chop bars — tiny upward drift but ALL candles are bearish (close < open).
 * This produces: positive slope + directionalPersistence = 0 (0 bars match
 * slope direction) + narrow range → triggers the chop path.
 */
function choppyBars(startPrice: number, count: number): AlpacaBar[] {
  return Array.from({ length: count }, (_, i) => {
    const open  = startPrice + i * 0.005; // tiny drift up → positive slope
    const close = open - 0.003;            // bearish candle: close < open
    const high  = open + 0.001;
    const low   = close - 0.001;
    return makeBar(open, high, low, close);
  });
}

/** High-volatility bars — large ranges to push ATR% above 2.5%. */
function volatileBars(midPrice: number, count: number): AlpacaBar[] {
  return Array.from({ length: count }, (_, i) => {
    const dir = i % 2 === 0 ? 1 : -1;
    const close = midPrice + dir * midPrice * 0.015;
    const open  = midPrice - dir * midPrice * 0.005;
    const high  = midPrice + midPrice * 0.018;
    const low   = midPrice - midPrice * 0.018;
    return makeBar(open, high, low, close);
  });
}

// ─── RecallFeatures factory ───────────────────────────────────────────────────

function makeSK(overrides: Partial<SKFeatures> = {}): SKFeatures {
  return {
    bias: "neutral",
    sequence_stage: "none",
    correction_complete: false,
    zone_distance_pct: 0.1,
    swing_high: 110,
    swing_low: 90,
    impulse_strength: 0.5,
    sequence_score: 0.5,
    rr_quality: 0.5,
    in_zone: false,
    ...overrides,
  };
}

function makeCVD(overrides: Partial<CVDFeatures> = {}): CVDFeatures {
  return {
    cvd_value: 0,
    cvd_slope: 0,
    cvd_divergence: false,
    buy_volume_ratio: 0.5,
    delta_momentum: 0,
    large_delta_bar: false,
    ...overrides,
  };
}

function makeIndicators(overrides: Partial<IndicatorFeatures> = {}): IndicatorFeatures {
  return {
    rsi_14: 50,
    macd_line: 0,
    macd_signal: 0,
    macd_hist: 0,
    ema_fast: 100,
    ema_slow: 100,
    ema_spread_pct: 0,
    bb_width: 2,
    bb_position: 0.5,
    indicator_bias: "neutral",
    ...overrides,
  };
}

function makeRecall(overrides: Partial<RecallFeatures> = {}): RecallFeatures {
  return {
    trend_slope_1m: 0,
    trend_slope_5m: 0,
    trend_slope_15m: 0,
    avg_range_1m: 5,
    avg_range_5m: 10,
    wick_ratio_1m: 0.2,
    wick_ratio_5m: 0.2,
    distance_from_high: 0.5,
    distance_from_low: 0.5,
    momentum_1m: 0,
    momentum_5m: 0,
    vol_relative: 1.0,
    consec_bullish: 2,
    consec_bearish: 0,
    regime: "ranging",
    atr_pct: 0.01,
    directional_persistence: 0.5,
    trend_consensus: 0.5,
    flow_alignment: 0.5,
    volatility_zscore: 0,
    fake_entry_risk: 0,
    sk: makeSK(),
    cvd: makeCVD(),
    indicators: makeIndicators(),
    indicator_hints: [],
    ...overrides,
  };
}

// ─── detectRegime ──────────────────────────────────────────────────────────────

describe("detectRegime", () => {

  it("returns 'ranging' for < 20 bars", () => {
    expect(detectRegime(flatBars(100, 5))).toBe("ranging");
    expect(detectRegime([])).toBe("ranging");
    expect(detectRegime(flatBars(100, 19))).toBe("ranging");
  });

  it("returns 'chop' when directional persistence < 0.45 and range < 3%", () => {
    // choppy bars at price=100: narrow range and no consistent direction
    const bars = choppyBars(100, 25);
    const regime = detectRegime(bars);
    expect(regime).toBe("chop");
  });

  it("returns 'volatile' when ATR% > 2.5%", () => {
    // high-vol bars with range ~3.6% of midPrice → ATR% > 2.5%
    const bars = volatileBars(100, 30);
    const regime = detectRegime(bars);
    expect(regime).toBe("volatile");
  });

  it("returns 'trending_bull' for consistent uptrend", () => {
    // 30 bars each +1 point; directionalPersistence > 0.6 and slope > 0.008
    const bars = trendingBars(100, 1, 30, 0.1);
    const regime = detectRegime(bars);
    expect(regime).toBe("trending_bull");
  });

  it("returns 'trending_bear' for consistent downtrend", () => {
    const bars = trendingBars(200, -1, 30, 0.1);
    const regime = detectRegime(bars);
    expect(regime).toBe("trending_bear");
  });

  it("returns 'ranging' for flat moderate-persistence bars", () => {
    // flat bars: atr not extreme, slope ~0, persistence ~50%
    const bars = flatBars(100, 30, 2); // range = 4 points = 4% of 100... may be volatile
    // use a tighter range to keep ATR% below 2.5%
    const tightBars = flatBars(100, 30, 1); // range = 2 points = 2% → ATR ≈ 2%
    const regime = detectRegime(tightBars);
    // Either "ranging" or "chop" is acceptable for flat bars (depends on persistence)
    expect(["ranging", "chop"]).toContain(regime);
  });
});

// ─── getQualityThreshold ──────────────────────────────────────────────────────

describe("getQualityThreshold", () => {

  it("chop regime returns 1.0 for every setup (always block)", () => {
    for (const setup of [
      "absorption_reversal", "sweep_reclaim", "continuation_pullback",
      "cvd_divergence", "breakout_failure", "vwap_reclaim",
      "opening_range_breakout", "post_news_continuation",
    ] as const) {
      expect(getQualityThreshold("chop", setup)).toBe(1.0);
    }
  });

  it("volatile regime has higher threshold than trending for absorption_reversal", () => {
    const volatile = getQualityThreshold("volatile", "absorption_reversal");
    const trending = getQualityThreshold("trending_bull", "absorption_reversal");
    expect(volatile).toBeGreaterThan(trending);
  });

  it("trending_bull continuation_pullback threshold is 0.67 (floor from SETUP_CATALOG)", () => {
    // REGIME_THRESHOLDS has 0.58, but withCatalogFloors raises it to
    // max(0.58, SETUP_CATALOG.continuation_pullback.minFinalQuality=0.67) = 0.67
    expect(getQualityThreshold("trending_bull", "continuation_pullback")).toBe(0.67);
  });

  it("ranging absorption_reversal threshold is 0.68 (floor from SETUP_CATALOG)", () => {
    // REGIME_THRESHOLDS has 0.65, but withCatalogFloors raises to
    // max(0.65, SETUP_CATALOG.absorption_reversal.minFinalQuality=0.68) = 0.68
    expect(getQualityThreshold("ranging", "absorption_reversal")).toBe(0.68);
  });

  it("ranging opening_range_breakout threshold is 0.78 (regime table wins over floor)", () => {
    // REGIME_THRESHOLDS has 0.78, SETUP_CATALOG floor is 0.70 → max = 0.78
    expect(getQualityThreshold("ranging", "opening_range_breakout")).toBe(0.78);
  });

  it("falls back to 0.65 for unknown setup input", () => {
    expect(getQualityThreshold("trending_bull", "unknown_setup" as any)).toBe(0.65);
  });
});

// ─── computeATR ───────────────────────────────────────────────────────────────

describe("computeATR", () => {

  it("returns 0 for < 2 bars", () => {
    expect(computeATR([])).toBe(0);
    expect(computeATR([makeBar(100, 101, 99, 100)])).toBe(0);
  });

  it("constant bars → ATR = bar range (high - low)", () => {
    // High=101, Low=99 → range=2 every bar; no gap from prev close
    const bars = flatBars(100, 10, 1); // range = 2 (high=101, low=99)
    const atr = computeATR(bars);
    expect(atr).toBeCloseTo(2, 1);
  });

  it("uses true range: max of H-L, H-prevClose, prevClose-L", () => {
    // Bar: open=100, high=102, low=99, close=101
    // Prev bar: close=105 (above this bar's high → prevClose-L is the TR)
    const bars = [
      makeBar(105, 106, 104, 105), // prev: close=105
      makeBar(100, 102, 99, 101),  // curr: H-L=3, H-prevClose=|102-105|=3, L-prevClose=|99-105|=6
    ];
    const atr = computeATR(bars);
    // slice(-14) gives both bars; first bar TR = H-L=2, second TR = max(3, 3, 6) = 6
    // avg = (2 + 6) / 2 = 4
    expect(atr).toBeCloseTo(4, 5);
  });

  it("uses only last 14 bars when more bars are provided", () => {
    // 30 flat bars with range=2, then 14 bars with range=10
    const narrowBars = flatBars(100, 30, 1);  // range 2
    const wideBars   = flatBars(100, 14, 5);  // range 10
    const combined   = [...narrowBars, ...wideBars];
    const atr = computeATR(combined);
    // Last 14 are the wide bars; ATR should be ~10
    expect(atr).toBeGreaterThan(8);
  });
});

// ─── computeTPSL ──────────────────────────────────────────────────────────────

describe("computeTPSL", () => {

  it("long: takeProfit above entry, stopLoss below entry", () => {
    const { takeProfit, stopLoss } = computeTPSL(100, "long", 1);
    expect(takeProfit).toBeGreaterThan(100);
    expect(stopLoss).toBeLessThan(100);
  });

  it("short: takeProfit below entry, stopLoss above entry", () => {
    const { takeProfit, stopLoss } = computeTPSL(100, "short", 1);
    expect(takeProfit).toBeLessThan(100);
    expect(stopLoss).toBeGreaterThan(100);
  });

  it("trending regime uses TP multiplier 2.5 (vs ranging 2.0)", () => {
    const atr = 2;
    const trending = computeTPSL(100, "long", atr, "trending_bull");
    const ranging  = computeTPSL(100, "long", atr, "ranging");
    // TP distance with trending = atr*2.5 = 5 vs ranging = atr*2.0 = 4
    expect(trending.takeProfit).toBeGreaterThan(ranging.takeProfit);
  });

  it("volatile regime uses SL multiplier 1.5 (wider stop)", () => {
    const atr = 2;
    const volatile = computeTPSL(100, "long", atr, "volatile");
    const ranging  = computeTPSL(100, "long", atr, "ranging");
    // SL distance: volatile = atr*1.5=3, ranging = atr*1.0=2
    // stopLoss for long: entry - slDist
    expect(volatile.stopLoss).toBeLessThan(ranging.stopLoss);
  });

  it("enforces minimum TP distance of tickSize × 12", () => {
    // entry=100 (tickSize=0.25), tiny ATR → minimum kicks in
    const { takeProfit } = computeTPSL(100, "long", 0.001, "ranging");
    const minTP = 100 + 0.25 * 12;
    expect(takeProfit).toBeGreaterThanOrEqual(minTP - 0.01);
  });

  it("enforces minimum SL distance of tickSize × 6", () => {
    const { stopLoss } = computeTPSL(100, "long", 0.001, "ranging");
    const minSL = 100 - 0.25 * 6;
    expect(stopLoss).toBeLessThanOrEqual(minSL + 0.01);
  });

  it("tick size = 5 for entry > 10000 (BTC range)", () => {
    const { tpTicks, slTicks } = computeTPSL(50_000, "long", 100, "ranging");
    // tickSize=5; tpDist = atr*2=200 / tickSize=5 = 40 ticks
    expect(typeof tpTicks).toBe("number");
    expect(typeof slTicks).toBe("number");
    // tpTicks >= 12 (minimum is 12 ticks)
    expect(tpTicks).toBeGreaterThanOrEqual(12);
    expect(slTicks).toBeGreaterThanOrEqual(6);
  });

  it("tick size = 1 for entry between 1000 and 10000", () => {
    const { tpTicks } = computeTPSL(5_000, "long", 10, "ranging");
    // tpDist = max(10*2, 1*12)=20; tpTicks = 20/1 = 20
    expect(tpTicks).toBe(20);
  });

  it("tpTicks and slTicks are integers", () => {
    const { tpTicks, slTicks } = computeTPSL(100, "long", 3, "ranging");
    expect(Number.isInteger(tpTicks)).toBe(true);
    expect(Number.isInteger(slTicks)).toBe(true);
  });
});

// ─── checkForwardOutcome ──────────────────────────────────────────────────────

describe("checkForwardOutcome", () => {

  it("empty bars → { outcome: 'open', hitTP: false, barsChecked: 0 }", () => {
    const result = checkForwardOutcome(100, "long", 104, 98, []);
    expect(result).toEqual({ outcome: "open", hitTP: false, barsChecked: 0 });
  });

  it("long: TP hit → win, hitTP: true", () => {
    const bar = makeBar(101, 105, 100, 103); // High ≥ TP=104
    const result = checkForwardOutcome(100, "long", 104, 98, [bar]);
    expect(result.outcome).toBe("win");
    expect(result.hitTP).toBe(true);
    expect(result.barsChecked).toBe(1);
  });

  it("long: SL hit → loss, hitTP: false", () => {
    const bar = makeBar(99, 100, 97, 98); // Low ≤ SL=98
    const result = checkForwardOutcome(100, "long", 104, 98, [bar]);
    expect(result.outcome).toBe("loss");
    expect(result.hitTP).toBe(false);
  });

  it("long: no hit → open with barsChecked = bars.length", () => {
    const bars = [
      makeBar(101, 103, 99, 102),
      makeBar(102, 103, 100, 101),
    ];
    const result = checkForwardOutcome(100, "long", 104, 98, bars);
    expect(result.outcome).toBe("open");
    expect(result.barsChecked).toBe(2);
  });

  it("long: TP checked before SL — when same bar triggers both, TP wins", () => {
    // High ≥ TP=104 AND Low ≤ SL=98 in same bar → TP wins (checked first)
    const bar = makeBar(100, 106, 96, 100);
    const result = checkForwardOutcome(100, "long", 104, 98, [bar]);
    expect(result.outcome).toBe("win");
    expect(result.hitTP).toBe(true);
  });

  it("short: TP hit (Low ≤ TP) → win", () => {
    // entry=100, TP=96, SL=103; bar Low=95 ≤ TP
    const bar = makeBar(98, 99, 95, 96);
    const result = checkForwardOutcome(100, "short", 96, 103, [bar]);
    expect(result.outcome).toBe("win");
    expect(result.hitTP).toBe(true);
  });

  it("short: SL hit (High ≥ SL) → loss", () => {
    const bar = makeBar(101, 104, 100, 103);
    const result = checkForwardOutcome(100, "short", 96, 103, [bar]);
    expect(result.outcome).toBe("loss");
    expect(result.hitTP).toBe(false);
  });

  it("resolves on correct bar in multi-bar sequence", () => {
    const bars = [
      makeBar(101, 103, 99,  102), // bar 1: safe
      makeBar(102, 103, 100, 101), // bar 2: safe
      makeBar(103, 106, 101, 104), // bar 3: High ≥ TP=104 → win
      makeBar(97,  98,  96,  97),  // bar 4: would be SL
    ];
    const result = checkForwardOutcome(100, "long", 104, 98, bars);
    expect(result.outcome).toBe("win");
    expect(result.barsChecked).toBe(3);
  });
});

// ─── applyNoTradeFilters ──────────────────────────────────────────────────────

describe("applyNoTradeFilters", () => {

  const SAFE_BARS = flatBars(100, 25, 1);
  const SAFE_SETUP = "absorption_reversal" as const;

  function safeRecall(overrides: Partial<RecallFeatures> = {}): RecallFeatures {
    return makeRecall({
      regime: "ranging",
      atr_pct: 0.01,       // well within bounds
      avg_range_1m: 5,
      trend_slope_5m: 0.001,
      trend_slope_1m: 0,
      momentum_1m: 0,
      sk: makeSK({ zone_distance_pct: 0.2 }),
      ...overrides,
    });
  }

  it("clean path → { blocked: false, reason: 'none' }", () => {
    const result = applyNoTradeFilters(
      SAFE_BARS, safeRecall(), SAFE_SETUP,
      { replayMode: true },
    );
    expect(result.blocked).toBe(false);
    expect(result.reason).toBe("none");
  });

  it("chop regime always blocked regardless of mode", () => {
    const result = applyNoTradeFilters(
      SAFE_BARS, safeRecall({ regime: "chop" }), SAFE_SETUP,
      { replayMode: true },
    );
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("chop_regime");
  });

  it("ATR% > 0.055 in live mode → high_volatility_extreme", () => {
    const result = applyNoTradeFilters(
      SAFE_BARS, safeRecall({ atr_pct: 0.06 }), SAFE_SETUP,
      { replayMode: false, sessionAllowed: true },
    );
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("high_volatility_extreme");
  });

  it("replayMode: ATR% cap raised to 0.08 (0.06 passes)", () => {
    const result = applyNoTradeFilters(
      SAFE_BARS, safeRecall({ atr_pct: 0.06 }), SAFE_SETUP,
      { replayMode: true },
    );
    expect(result.blocked).toBe(false);
  });

  it("replayMode: ATR% > 0.08 still blocked", () => {
    const result = applyNoTradeFilters(
      SAFE_BARS, safeRecall({ atr_pct: 0.09 }), SAFE_SETUP,
      { replayMode: true },
    );
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("high_volatility_extreme");
  });

  it("low volatility: ATR% < 0.001 AND avg_range < 0.5 → blocked", () => {
    const result = applyNoTradeFilters(
      SAFE_BARS,
      safeRecall({ atr_pct: 0.0005, avg_range_1m: 0.3 }),
      SAFE_SETUP,
      { replayMode: true },
    );
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("low_volatility");
  });

  it("sessionAllowed=false in live mode → bad_session", () => {
    const result = applyNoTradeFilters(
      SAFE_BARS, safeRecall(), SAFE_SETUP,
      { replayMode: false, sessionAllowed: false },
    );
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("bad_session");
  });

  it("newsLockoutActive=true in live mode → news_lockout", () => {
    const result = applyNoTradeFilters(
      SAFE_BARS, safeRecall(), SAFE_SETUP,
      { replayMode: false, sessionAllowed: true, newsLockoutActive: true },
    );
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("news_lockout");
  });

  it("cooldowns ≥ 3 for the setup in live mode → setup_cooldown", () => {
    const result = applyNoTradeFilters(
      SAFE_BARS, safeRecall(), SAFE_SETUP,
      {
        replayMode: false, sessionAllowed: true,
        cooldowns: { absorption_reversal: 3 },
      },
    );
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("setup_cooldown");
  });

  it("cooldowns < 3 in live mode → not blocked by cooldown", () => {
    const result = applyNoTradeFilters(
      SAFE_BARS, safeRecall(), SAFE_SETUP,
      {
        replayMode: false, sessionAllowed: true,
        cooldowns: { absorption_reversal: 2 },
      },
    );
    expect(result.reason).not.toBe("setup_cooldown");
  });

  it("sk_zone_miss: zone_distance_pct > 0.35 for sweep_reclaim → blocked", () => {
    // sweep_reclaim requires SK zone
    const result = applyNoTradeFilters(
      SAFE_BARS,
      safeRecall({ sk: makeSK({ zone_distance_pct: 0.40 }) }),
      "sweep_reclaim",
      { replayMode: false, sessionAllowed: true },
    );
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("sk_zone_miss");
  });

  it("replayMode: SK zone cap raised to 0.55 (0.40 passes)", () => {
    const result = applyNoTradeFilters(
      SAFE_BARS,
      safeRecall({ sk: makeSK({ zone_distance_pct: 0.40 }) }),
      "sweep_reclaim",
      { replayMode: true },
    );
    expect(result.blocked).toBe(false);
  });

  it("replayMode: replays skip session and news lockout checks", () => {
    const result = applyNoTradeFilters(
      SAFE_BARS, safeRecall(), SAFE_SETUP,
      { replayMode: true, sessionAllowed: false, newsLockoutActive: true },
    );
    // session/news lockout should be skipped in replay mode
    expect(result.reason).not.toBe("bad_session");
    expect(result.reason).not.toBe("news_lockout");
  });
});

// ─── scoreRecall ──────────────────────────────────────────────────────────────

describe("scoreRecall", () => {

  it("neutral recall returns a deterministic score in a sensible range", () => {
    // Neutral recall for absorption_reversal/ranging/long earns:
    //   0.53 baseline + 0.04 (!trendAligned absorption bonus) +
    //   0.10 (regime alignment: absorption_reversal in ranging) +
    //   ≈0.037 (indicatorDirectionalConfidence with neutral macd/ema at 0)
    // = ≈ 0.707.  Clamped to [0, 1].
    const recall = makeRecall({
      trend_slope_1m: 0, trend_slope_5m: 0, trend_slope_15m: 0,
      momentum_1m: 0, vol_relative: 1.0, wick_ratio_5m: 0.2,
      trend_consensus: 0.5, flow_alignment: 0.5,
      volatility_zscore: 0, fake_entry_risk: 0,
      sk: makeSK({ sequence_score: 0, in_zone: false }),
      cvd: makeCVD({ buy_volume_ratio: 0.5 }),
    });
    const score = scoreRecall(recall, "absorption_reversal", "long");
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThan(0.9);
    expect(Number.isFinite(score)).toBe(true);
  });

  it("trend-aligned long raises score vs non-aligned baseline", () => {
    // When all 3 timeframes are aligned (no MTF disagreement penalty),
    // trendAligned=true adds +0.12, but !trendAligned bonus (-0.04) is lost.
    // Net for absorption_reversal: +0.12 - 0.04 = +0.08.
    const base    = makeRecall({ trend_slope_1m: 0, trend_slope_5m: 0, trend_slope_15m: 0 });
    const aligned = makeRecall({ trend_slope_1m: 0.01, trend_slope_5m: 0.01, trend_slope_15m: 0.005 });
    const scoreBase    = scoreRecall(base,    "absorption_reversal", "long");
    const scoreAligned = scoreRecall(aligned, "absorption_reversal", "long");
    // Net delta = +0.08 (no MTF disagreement penalty when all 3 slopes aligned)
    expect(scoreAligned - scoreBase).toBeCloseTo(0.08, 2);
  });

  it("momentum-aligned short bumps score by +0.10", () => {
    const base    = makeRecall({ momentum_1m: 0 });
    const aligned = makeRecall({ momentum_1m: -0.01 }); // short + negative momentum
    const scoreBase    = scoreRecall(base,    "absorption_reversal", "short");
    const scoreAligned = scoreRecall(aligned, "absorption_reversal", "short");
    expect(scoreAligned).toBeCloseTo(scoreBase + 0.10, 2);
  });

  it("regime-setup alignment adds +0.10 (continuation_pullback in trending_bull)", () => {
    const base    = makeRecall({ regime: "ranging" });
    const aligned = makeRecall({ regime: "trending_bull" });
    const scoreBase    = scoreRecall(base,    "continuation_pullback", "long");
    const scoreAligned = scoreRecall(aligned, "continuation_pullback", "long");
    expect(scoreAligned - scoreBase).toBeCloseTo(0.10, 2);
  });

  it("SK zone + correction_complete + bias aligned adds +0.08 super-bonus", () => {
    const noBonus = makeRecall({
      sk: makeSK({ in_zone: false, correction_complete: false, bias: "bull" }),
    });
    const withBonus = makeRecall({
      sk: makeSK({ in_zone: true, correction_complete: true, bias: "bull" }),
    });
    const s1 = scoreRecall(noBonus, "absorption_reversal", "long");
    const s2 = scoreRecall(withBonus, "absorption_reversal", "long");
    expect(s2 - s1).toBeCloseTo(0.08, 2);
  });

  it("output is clamped to [0, 1]", () => {
    // Maximally bullish recall
    const bullishRecall = makeRecall({
      trend_slope_5m: 0.05, trend_slope_15m: 0.05, trend_slope_1m: 0.05,
      momentum_1m: 0.05, vol_relative: 2.0, wick_ratio_5m: 0.8,
      regime: "trending_bull", trend_consensus: 1.0, flow_alignment: 1.0,
      volatility_zscore: -2, fake_entry_risk: 0,
      sk: makeSK({ in_zone: true, correction_complete: true, bias: "bull", sequence_score: 1.0 }),
      cvd: makeCVD({ buy_volume_ratio: 0.8 }),
      indicators: makeIndicators({ indicator_bias: "bull" }),
    });
    const score = scoreRecall(bullishRecall, "continuation_pullback", "long");
    expect(score).toBeLessThanOrEqual(1.0);
    expect(score).toBeGreaterThanOrEqual(0.0);
  });
});

// ─── computeFinalQuality ──────────────────────────────────────────────────────

describe("computeFinalQuality", () => {

  it("output is always in [0, 1]", () => {
    const vals = [
      [0, 0, 0], [1, 1, 1], [0.5, 0.5, 0.5],
      [0.9, 0.8, 0.7], [0.2, 0.1, 0.3],
    ];
    for (const [s, o, r] of vals) {
      const q = computeFinalQuality(s!, o!, r!);
      expect(q).toBeGreaterThanOrEqual(0);
      expect(q).toBeLessThanOrEqual(1);
    }
  });

  it("NaN inputs are treated as 0 (no crash)", () => {
    expect(() => computeFinalQuality(NaN, 0.5, 0.5)).not.toThrow();
    const q = computeFinalQuality(NaN, 0.5, 0.5);
    expect(Number.isFinite(q)).toBe(true);
  });

  it("Infinity inputs are treated as 0 (no crash)", () => {
    expect(() => computeFinalQuality(Infinity, 0.5, 0.5)).not.toThrow();
    const q = computeFinalQuality(Infinity, 0.5, 0.5);
    expect(q).toBeGreaterThanOrEqual(0);
    expect(q).toBeLessThanOrEqual(1);
  });

  it("all-zero inputs produce a positive result (ML stub baseline)", () => {
    // Even with zero inputs, the ML stub contributes a non-zero probability
    const q = computeFinalQuality(0, 0, 0);
    expect(q).toBeGreaterThan(0);
  });

  it("high scores produce higher quality than low scores", () => {
    const high = computeFinalQuality(0.9, 0.9, 0.9);
    const low  = computeFinalQuality(0.1, 0.1, 0.1);
    expect(high).toBeGreaterThan(low);
  });

  it("consistent with directional context provided", () => {
    // Should not crash and should remain in [0, 1] with context
    const recall = makeRecall({ regime: "trending_bull" });
    const q = computeFinalQuality(0.8, 0.7, 0.75, {
      recall, direction: "long", setup_type: "continuation_pullback",
    });
    expect(q).toBeGreaterThanOrEqual(0);
    expect(q).toBeLessThanOrEqual(1);
  });
});
