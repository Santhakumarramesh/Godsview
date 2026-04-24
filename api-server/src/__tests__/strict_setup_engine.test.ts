/**
 * strict_setup_engine.test.ts — Phase 28
 *
 * Tests for evaluateStrictSweepReclaim:
 *   - Symbol validation (supported / unsupported)
 *   - Insufficient bars guard
 *   - Bull sweep detection (sweepBar low break + lower wick + reclaim)
 *   - Bear sweep detection (sweepBar high break + upper wick + reject)
 *   - Session detection (Asian, London, NY, NY-overlap)
 *   - Asian session blocked by default
 *   - News lockout gating
 *   - Stale bar detection (nowMs far ahead)
 *   - Regime detection (ranging, volatile, trend_bull, trend_bear)
 *   - Orderbook: unavailable, fresh, liquidity, spread gates
 *   - Confidence score and expected win probability ranges
 *   - tradeAllowed requires all gates to pass
 *   - computeATR14 / diagnostics fields populated
 */

import { describe, it, expect } from "vitest";
import { evaluateStrictSweepReclaim } from "../lib/strict_setup_engine";
import type { AlpacaBar } from "../lib/alpaca";
import type { OrderBookSnapshot } from "../lib/market/types";

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Build an AlpacaBar at a specific UTC timestamp string */
function aBar(
  open: number,
  high: number,
  low: number,
  close: number,
  timestampMs: number,
  volume = 1_000,
): AlpacaBar {
  const ts = new Date(timestampMs).toISOString();
  return {
    t: ts,
    o: open,
    h: high,
    l: low,
    c: close,
    v: volume,
    Timestamp: ts,
    Open: open,
    High: high,
    Low: low,
    Close: close,
    Volume: volume,
  };
}

/** Build N flat bars starting at baseMs, stepping by 60_000 ms */
function flatBarsAt(
  price: number,
  count: number,
  baseMs: number,
  spread = 0.5,
): AlpacaBar[] {
  return Array.from({ length: count }, (_, i) =>
    aBar(price, price + spread, price - spread * 0.2, price, baseMs + i * 60_000),
  );
}

/**
 * Build a standard bull-sweep scenario:
 *   - lookbackWindow (20 bars) where every Low >= floorPrice
 *   - sweepBar: Low < floorPrice, lower wick ratio >= 0.6
 *   - reclaimBar: bullish, Close > floorPrice, timestamped at nowMs
 */
function makeBullSweepBars(
  floorPrice: number,
  nowMs: number,
): { bars: AlpacaBar[]; reclaimMs: number } {
  const lookbackBaseMs = nowMs - 22 * 60_000;
  const lookback = flatBarsAt(floorPrice + 1, 20, lookbackBaseMs);

  // sweepBar: breaks below floor with big wick
  const sweepMs = nowMs - 2 * 60_000;
  const sweepBar = aBar(
    floorPrice + 0.5,  // open above floor
    floorPrice + 1.0,  // high
    floorPrice - 2.0,  // low BELOW floor → sweep
    floorPrice + 0.4,  // close near top → big lower wick
    sweepMs,
  );
  // sweepRange = (floorPrice+1) - (floorPrice-2) = 3.0
  // lowerWick = min(open, close) - low = (floorPrice+0.4) - (floorPrice-2) = 2.4
  // lowerWickRatio = 2.4 / 3.0 = 0.8 >= 0.35 ✓

  // reclaimBar: bullish, close above floor
  const reclaimMs = nowMs;
  const reclaimBar = aBar(
    floorPrice + 0.3,  // open
    floorPrice + 1.5,  // high
    floorPrice + 0.2,  // low
    floorPrice + 1.2,  // close > floor ✓ and close > open ✓
    reclaimMs,
  );

  return { bars: [...lookback, sweepBar, reclaimBar], reclaimMs };
}

/**
 * Build a standard bear-sweep scenario:
 *   - lookbackWindow where every High <= ceilPrice
 *   - sweepBar: High > ceilPrice, upper wick ratio >= 0.6
 *   - reclaimBar: bearish, Close < ceilPrice
 */
function makeBearSweepBars(
  ceilPrice: number,
  nowMs: number,
): { bars: AlpacaBar[]; reclaimMs: number } {
  const lookbackBaseMs = nowMs - 22 * 60_000;
  const lookback = flatBarsAt(ceilPrice - 1, 20, lookbackBaseMs, 0.3);

  const sweepMs = nowMs - 2 * 60_000;
  const sweepBar = aBar(
    ceilPrice - 0.5,  // open
    ceilPrice + 2.0,  // high ABOVE ceiling → sweep
    ceilPrice - 1.0,  // low
    ceilPrice - 0.4,  // close near bottom → big upper wick
    sweepMs,
  );
  // sweepRange = 3.0, upperWick = high - max(open,close) = (ceil+2) - (ceil-0.4) = 2.4
  // upperWickRatio = 2.4/3.0 = 0.8 >= 0.35 ✓

  const reclaimMs = nowMs;
  const reclaimBar = aBar(
    ceilPrice - 0.3,
    ceilPrice - 0.2,
    ceilPrice - 1.5,
    ceilPrice - 1.2,  // close < ceil ✓ and close < open ✓
    reclaimMs,
  );

  return { bars: [...lookback, sweepBar, reclaimBar], reclaimMs };
}

/** Standard good orderbook at price ~100 */
function goodBook(price: number, nowMs: number): OrderBookSnapshot {
  const halfSpread = price * 0.0001; // 2 bps
  return {
    symbol: "BTCUSD",
    bids: Array.from({ length: 10 }, (_, i) => ({
      price: price - halfSpread - i * price * 0.0001,
      size: 500,
    })),
    asks: Array.from({ length: 10 }, (_, i) => ({
      price: price + halfSpread + i * price * 0.0001,
      size: 500,
    })),
    timestamp: new Date(nowMs).toISOString(),
    receivedAt: nowMs,
    source: "rest",
  };
}

// Base timestamp at UTC 14:30 = NY session
const BASE_NOW_MS = new Date("2025-01-15T14:30:00Z").getTime();
const FLOOR = 100;

// ── Symbol validation ──────────────────────────────────────────────────────────

describe("symbol validation", () => {
  it("BTCUSD is supported", () => {
    const { bars } = makeBullSweepBars(FLOOR, BASE_NOW_MS);
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, null, {
      nowMs: BASE_NOW_MS,
      requireOrderbook: false,
    });
    expect(result.supported).toBe(true);
    expect(result.blockedReasons).not.toContain("symbol_not_supported");
  });

  it("ETHUSD is supported", () => {
    const { bars } = makeBullSweepBars(FLOOR, BASE_NOW_MS);
    const result = evaluateStrictSweepReclaim("ETHUSD", bars, null, {
      nowMs: BASE_NOW_MS,
      requireOrderbook: false,
    });
    expect(result.supported).toBe(true);
  });

  it("unsupported symbol → supported=false, blocked with symbol_not_supported", () => {
    const { bars } = makeBullSweepBars(FLOOR, BASE_NOW_MS);
    const result = evaluateStrictSweepReclaim("SPYUSD", bars, null, {
      nowMs: BASE_NOW_MS,
    });
    expect(result.supported).toBe(false);
    expect(result.detected).toBe(false);
    expect(result.tradeAllowed).toBe(false);
    expect(result.blockedReasons).toContain("symbol_not_supported");
  });

  it("unsupported symbol returns null for confidence and win probability", () => {
    const result = evaluateStrictSweepReclaim("XYZUSD", [], null);
    expect(result.confidenceScore).toBeNull();
    expect(result.expectedWinProbability).toBeNull();
  });
});

// ── Insufficient bars ──────────────────────────────────────────────────────────

describe("insufficient bars", () => {
  it("empty bars → blocked with insufficient_bars", () => {
    const result = evaluateStrictSweepReclaim("BTCUSD", [], null);
    expect(result.blockedReasons).toContain("insufficient_bars");
    expect(result.detected).toBe(false);
  });

  it("fewer bars than minLookbackBars + 2 → insufficient_bars", () => {
    // default minLookbackBars=20, needs >= 22 bars
    const bars = flatBarsAt(100, 15, BASE_NOW_MS - 15 * 60_000);
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, null);
    expect(result.blockedReasons).toContain("insufficient_bars");
  });

  it("exactly minLookbackBars+2 bars → no insufficient_bars", () => {
    const { bars } = makeBullSweepBars(FLOOR, BASE_NOW_MS);
    // bars has 22 entries = 20 lookback + sweep + reclaim
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, null, {
      nowMs: BASE_NOW_MS,
      requireOrderbook: false,
    });
    expect(result.blockedReasons).not.toContain("insufficient_bars");
  });
});

// ── Sweep detection ────────────────────────────────────────────────────────────

describe("sweep detection", () => {
  it("bull sweep detected: direction='long'", () => {
    const { bars } = makeBullSweepBars(FLOOR, BASE_NOW_MS);
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, null, {
      nowMs: BASE_NOW_MS,
      requireOrderbook: false,
    });
    expect(result.detected).toBe(true);
    expect(result.direction).toBe("long");
  });

  it("bear sweep detected: direction='short'", () => {
    const { bars } = makeBearSweepBars(FLOOR, BASE_NOW_MS);
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, null, {
      nowMs: BASE_NOW_MS,
      requireOrderbook: false,
    });
    expect(result.detected).toBe(true);
    expect(result.direction).toBe("short");
  });

  it("flat bars with no level breach → not detected", () => {
    const bars = flatBarsAt(100, 25, BASE_NOW_MS - 25 * 60_000);
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, null, {
      nowMs: BASE_NOW_MS,
      requireOrderbook: false,
    });
    expect(result.detected).toBe(false);
    expect(result.blockedReasons).toContain("setup_not_detected");
  });

  it("bull sweep: entryPrice = reclaimBar.Close", () => {
    const { bars } = makeBullSweepBars(FLOOR, BASE_NOW_MS);
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, null, {
      nowMs: BASE_NOW_MS,
      requireOrderbook: false,
    });
    const reclaimClose = bars[bars.length - 1]!.Close;
    expect(result.entryPrice).toBe(reclaimClose);
  });

  it("bull sweep: stopLoss < entryPrice", () => {
    const { bars } = makeBullSweepBars(FLOOR, BASE_NOW_MS);
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, null, {
      nowMs: BASE_NOW_MS,
      requireOrderbook: false,
    });
    expect(result.stopLoss).not.toBeNull();
    expect(result.stopLoss!).toBeLessThan(result.entryPrice!);
  });

  it("bull sweep: takeProfit > entryPrice", () => {
    const { bars } = makeBullSweepBars(FLOOR, BASE_NOW_MS);
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, null, {
      nowMs: BASE_NOW_MS,
      requireOrderbook: false,
    });
    expect(result.takeProfit).not.toBeNull();
    expect(result.takeProfit!).toBeGreaterThan(result.entryPrice!);
  });

  it("bull sweep: riskReward ≈ rrTarget (default 2)", () => {
    const { bars } = makeBullSweepBars(FLOOR, BASE_NOW_MS);
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, null, {
      nowMs: BASE_NOW_MS,
      requireOrderbook: false,
    });
    expect(result.riskReward).toBeCloseTo(2, 0);
  });

  it("bear sweep: stopLoss > entryPrice", () => {
    const { bars } = makeBearSweepBars(FLOOR, BASE_NOW_MS);
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, null, {
      nowMs: BASE_NOW_MS,
      requireOrderbook: false,
    });
    expect(result.stopLoss).not.toBeNull();
    expect(result.stopLoss!).toBeGreaterThan(result.entryPrice!);
  });

  it("diagnostics.sweepWickRatio is populated when detected", () => {
    const { bars } = makeBullSweepBars(FLOOR, BASE_NOW_MS);
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, null, {
      nowMs: BASE_NOW_MS,
      requireOrderbook: false,
    });
    expect(result.diagnostics.sweepWickRatio).not.toBeNull();
    expect(result.diagnostics.sweepWickRatio!).toBeGreaterThanOrEqual(0.35);
  });
});

// ── Session detection ──────────────────────────────────────────────────────────

describe("session detection", () => {
  it("UTC 14 → ny_overlap session", () => {
    const nowMs = new Date("2025-01-15T14:30:00Z").getTime();
    const { bars } = makeBullSweepBars(FLOOR, nowMs);
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, null, {
      nowMs,
      requireOrderbook: false,
    });
    expect(result.session).toBe("ny_overlap");
  });

  it("UTC 10 → london session", () => {
    const nowMs = new Date("2025-01-15T10:30:00Z").getTime();
    const { bars } = makeBullSweepBars(FLOOR, nowMs);
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, null, {
      nowMs,
      requireOrderbook: false,
    });
    expect(result.session).toBe("london");
  });

  it("UTC 18 → new_york session", () => {
    const nowMs = new Date("2025-01-15T18:00:00Z").getTime();
    const { bars } = makeBullSweepBars(FLOOR, nowMs);
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, null, {
      nowMs,
      requireOrderbook: false,
    });
    expect(result.session).toBe("new_york");
  });

  it("UTC 02 → asian session", () => {
    const nowMs = new Date("2025-01-15T02:00:00Z").getTime();
    const { bars } = makeBullSweepBars(FLOOR, nowMs);
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, null, {
      nowMs,
      requireOrderbook: false,
    });
    expect(result.session).toBe("asian");
  });

  it("asian session blocks by default (allowAsianSession=false)", () => {
    const nowMs = new Date("2025-01-15T02:00:00Z").getTime();
    const { bars } = makeBullSweepBars(FLOOR, nowMs);
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, null, {
      nowMs,
      requireOrderbook: false,
      allowAsianSession: false,
    });
    expect(result.gates.sessionValid).toBe(false);
    expect(result.blockedReasons).toContain("bad_session");
  });

  it("asian session allowed when allowAsianSession=true", () => {
    const nowMs = new Date("2025-01-15T02:00:00Z").getTime();
    const { bars } = makeBullSweepBars(FLOOR, nowMs);
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, null, {
      nowMs,
      requireOrderbook: false,
      allowAsianSession: true,
    });
    expect(result.gates.sessionValid).toBe(true);
  });
});

// ── News lockout ───────────────────────────────────────────────────────────────

describe("news lockout", () => {
  it("newsLockoutActive=false → newsClear=true", () => {
    const { bars } = makeBullSweepBars(FLOOR, BASE_NOW_MS);
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, null, {
      nowMs: BASE_NOW_MS,
      requireOrderbook: false,
      newsLockoutActive: false,
    });
    expect(result.gates.newsClear).toBe(true);
    expect(result.blockedReasons).not.toContain("news_lockout");
  });

  it("newsLockoutActive=true → blocked with news_lockout", () => {
    const { bars } = makeBullSweepBars(FLOOR, BASE_NOW_MS);
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, null, {
      nowMs: BASE_NOW_MS,
      requireOrderbook: false,
      newsLockoutActive: true,
    });
    expect(result.gates.newsClear).toBe(false);
    expect(result.blockedReasons).toContain("news_lockout");
  });
});

// ── Bar freshness ──────────────────────────────────────────────────────────────

describe("bar freshness", () => {
  it("fresh bar (age = 0) → barFresh=true", () => {
    const { bars } = makeBullSweepBars(FLOOR, BASE_NOW_MS);
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, null, {
      nowMs: BASE_NOW_MS,
      requireOrderbook: false,
    });
    expect(result.gates.barFresh).toBe(true);
  });

  it("stale bar (age > maxBarAgeMs) → barFresh=false, blocked with stale_data", () => {
    const { bars } = makeBullSweepBars(FLOOR, BASE_NOW_MS);
    const staleNow = BASE_NOW_MS + 60 * 60_000; // 60 minutes later
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, null, {
      nowMs: staleNow,
      requireOrderbook: false,
      maxBarAgeMs: 3 * 60_000,
    });
    expect(result.gates.barFresh).toBe(false);
    expect(result.blockedReasons).toContain("stale_data");
  });
});

// ── Regime detection ───────────────────────────────────────────────────────────

describe("regime detection", () => {
  it("flat bars → regime=ranging", () => {
    const { bars } = makeBullSweepBars(FLOOR, BASE_NOW_MS);
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, null, {
      nowMs: BASE_NOW_MS,
      requireOrderbook: false,
    });
    expect(result.diagnostics.regime).toBe("ranging");
    expect(result.gates.regimeValid).toBe(true);
  });

  it("extreme volatility → regime=volatile, regimeValid=true", () => {
    // Build bars with high ATR% (> 1.2% per bar)
    const nowMs = BASE_NOW_MS;
    const baseMs = nowMs - 32 * 60_000;
    const bars: AlpacaBar[] = [];
    for (let i = 0; i < 30; i++) {
      const price = 100;
      const ts = new Date(baseMs + i * 60_000).toISOString();
      // Each bar has range = 2 = 2% of 100 → atrPct > 0.012
      bars.push({
        t: ts,
        o: price,
        h: price + 2,
        l: price - 2,
        c: price,
        v: 1000,
        Timestamp: ts,
        Open: price,
        High: price + 2,
        Low: price - 2,
        Close: price,
        Volume: 1000,
      });
    }
    // Append sweep + reclaim based on flat price
    const sweepMs = nowMs - 2 * 60_000;
    const sweepBar = aBar(101, 101.5, 97, 100.8, sweepMs);
    const reclaimMs = nowMs;
    const reclaimBar = aBar(100.5, 102, 100.2, 101.2, reclaimMs);
    bars.push(sweepBar, reclaimBar);

    const result = evaluateStrictSweepReclaim("BTCUSD", bars, null, {
      nowMs,
      requireOrderbook: false,
    });
    expect(result.diagnostics.regime).toBe("volatile");
    expect(result.gates.regimeValid).toBe(true);
  });
});

// ── Orderbook gates ────────────────────────────────────────────────────────────

describe("orderbook gates", () => {
  it("null orderbook with requireOrderbook=true → blocked with orderbook_unavailable", () => {
    const { bars } = makeBullSweepBars(FLOOR, BASE_NOW_MS);
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, null, {
      nowMs: BASE_NOW_MS,
      requireOrderbook: true,
    });
    expect(result.gates.orderbookAvailable).toBe(false);
    expect(result.blockedReasons).toContain("orderbook_unavailable");
  });

  it("null orderbook with requireOrderbook=false → no orderbook_unavailable block", () => {
    const { bars } = makeBullSweepBars(FLOOR, BASE_NOW_MS);
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, null, {
      nowMs: BASE_NOW_MS,
      requireOrderbook: false,
    });
    expect(result.blockedReasons).not.toContain("orderbook_unavailable");
  });

  it("stale orderbook → blocked with stale_data", () => {
    const { bars } = makeBullSweepBars(FLOOR, BASE_NOW_MS);
    const staleBook: OrderBookSnapshot = {
      ...goodBook(FLOOR, BASE_NOW_MS - 60_000), // 60s old
      receivedAt: BASE_NOW_MS - 60_000,
    };
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, staleBook, {
      nowMs: BASE_NOW_MS,
      maxOrderbookAgeMs: 10_000,
      requireOrderbook: true,
    });
    expect(result.gates.orderbookFresh).toBe(false);
    expect(result.blockedReasons).toContain("stale_data");
  });

  it("good orderbook: orderbookAvailable=true, orderbookFresh=true, liquidityValid=true, spreadValid=true", () => {
    const { bars } = makeBullSweepBars(FLOOR, BASE_NOW_MS);
    const book = goodBook(FLOOR, BASE_NOW_MS);
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, book, {
      nowMs: BASE_NOW_MS,
      requireOrderbook: true,
    });
    expect(result.gates.orderbookAvailable).toBe(true);
    expect(result.gates.orderbookFresh).toBe(true);
    expect(result.gates.liquidityValid).toBe(true);
    expect(result.gates.spreadValid).toBe(true);
  });

  it("wide spread → spreadValid=false, blocked with spread_too_wide", () => {
    const { bars } = makeBullSweepBars(FLOOR, BASE_NOW_MS);
    // spread = 5 units on price 100 → 500 bps >> maxSpreadBps (15)
    const wideSpreadBook: OrderBookSnapshot = {
      symbol: "BTCUSD",
      bids: [{ price: 97.5, size: 1000 }],
      asks: [{ price: 102.5, size: 1000 }],
      timestamp: new Date(BASE_NOW_MS).toISOString(),
      receivedAt: BASE_NOW_MS,
      source: "rest",
    };
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, wideSpreadBook, {
      nowMs: BASE_NOW_MS,
      requireOrderbook: true,
    });
    expect(result.gates.spreadValid).toBe(false);
    expect(result.blockedReasons).toContain("spread_too_wide");
  });

  it("low liquidity book → liquidityValid=false, blocked with low_liquidity", () => {
    const { bars } = makeBullSweepBars(FLOOR, BASE_NOW_MS);
    // Very tiny book: topSize * mid ≈ 2 * 100 = 200 << 200_000 threshold
    const tinyBook: OrderBookSnapshot = {
      symbol: "BTCUSD",
      bids: [{ price: 99.99, size: 1 }],
      asks: [{ price: 100.01, size: 1 }],
      timestamp: new Date(BASE_NOW_MS).toISOString(),
      receivedAt: BASE_NOW_MS,
      source: "rest",
    };
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, tinyBook, {
      nowMs: BASE_NOW_MS,
      requireOrderbook: true,
    });
    expect(result.gates.liquidityValid).toBe(false);
    expect(result.blockedReasons).toContain("low_liquidity");
  });
});

// ── Confidence and win probability ────────────────────────────────────────────

describe("confidence score and win probability", () => {
  it("detected with no orderbook → confidenceScore in [0, 1]", () => {
    const { bars } = makeBullSweepBars(FLOOR, BASE_NOW_MS);
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, null, {
      nowMs: BASE_NOW_MS,
      requireOrderbook: false,
    });
    expect(result.confidenceScore).not.toBeNull();
    expect(result.confidenceScore!).toBeGreaterThanOrEqual(0);
    expect(result.confidenceScore!).toBeLessThanOrEqual(1);
  });

  it("expectedWinProbability in [0.38, 0.85] for detected setup", () => {
    const { bars } = makeBullSweepBars(FLOOR, BASE_NOW_MS);
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, null, {
      nowMs: BASE_NOW_MS,
      requireOrderbook: false,
    });
    expect(result.expectedWinProbability).not.toBeNull();
    expect(result.expectedWinProbability!).toBeGreaterThanOrEqual(0.38);
    expect(result.expectedWinProbability!).toBeLessThanOrEqual(0.85);
  });

  it("not detected → confidenceScore=null, expectedWinProbability=null", () => {
    const bars = flatBarsAt(100, 25, BASE_NOW_MS - 25 * 60_000);
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, null, {
      nowMs: BASE_NOW_MS,
      requireOrderbook: false,
    });
    expect(result.confidenceScore).toBeNull();
    expect(result.expectedWinProbability).toBeNull();
  });
});

// ── tradeAllowed ───────────────────────────────────────────────────────────────

describe("tradeAllowed", () => {
  it("tradeAllowed=false when not detected", () => {
    const bars = flatBarsAt(100, 25, BASE_NOW_MS - 25 * 60_000);
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, null, {
      nowMs: BASE_NOW_MS,
      requireOrderbook: false,
    });
    expect(result.tradeAllowed).toBe(false);
  });

  it("tradeAllowed=false when news lockout active even if detected", () => {
    const { bars } = makeBullSweepBars(FLOOR, BASE_NOW_MS);
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, null, {
      nowMs: BASE_NOW_MS,
      requireOrderbook: false,
      newsLockoutActive: true,
    });
    expect(result.tradeAllowed).toBe(false);
  });

  it("tradeAllowed=false when Asian session and not allowed", () => {
    const nowMs = new Date("2025-01-15T02:00:00Z").getTime();
    const { bars } = makeBullSweepBars(FLOOR, nowMs);
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, null, {
      nowMs,
      requireOrderbook: false,
      allowAsianSession: false,
    });
    expect(result.tradeAllowed).toBe(false);
  });
});

// ── Output structure ───────────────────────────────────────────────────────────

describe("output structure", () => {
  it("result always has setup='sweep_reclaim_v1'", () => {
    const result = evaluateStrictSweepReclaim("BTCUSD", [], null);
    expect(result.setup).toBe("sweep_reclaim_v1");
  });

  it("result always has gates object with all 8 boolean fields", () => {
    const { bars } = makeBullSweepBars(FLOOR, BASE_NOW_MS);
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, null, {
      nowMs: BASE_NOW_MS,
      requireOrderbook: false,
    });
    expect(result.gates).toHaveProperty("barFresh");
    expect(result.gates).toHaveProperty("sessionValid");
    expect(result.gates).toHaveProperty("regimeValid");
    expect(result.gates).toHaveProperty("newsClear");
    expect(result.gates).toHaveProperty("orderbookAvailable");
    expect(result.gates).toHaveProperty("orderbookFresh");
    expect(result.gates).toHaveProperty("liquidityValid");
    expect(result.gates).toHaveProperty("spreadValid");
    for (const val of Object.values(result.gates)) {
      expect(typeof val).toBe("boolean");
    }
  });

  it("diagnostics populated for detected setup", () => {
    const { bars } = makeBullSweepBars(FLOOR, BASE_NOW_MS);
    const result = evaluateStrictSweepReclaim("BTCUSD", bars, null, {
      nowMs: BASE_NOW_MS,
      requireOrderbook: false,
    });
    expect(result.diagnostics.lookbackHigh).toBeGreaterThan(0);
    expect(result.diagnostics.lookbackLow).toBeGreaterThan(0);
    expect(result.diagnostics.atr14).not.toBeNull();
    expect(result.diagnostics.atr14!).toBeGreaterThan(0);
  });
});
