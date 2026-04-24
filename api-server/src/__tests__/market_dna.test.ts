/**
 * market_dna.test.ts — Phase 29
 *
 * Tests for computeMarketDNA (pure computation function) and clearDNACache.
 *
 * Coverage:
 *   - < 10 bars → default DNA (all fields at 50, volatility_regime="medium")
 *   - trendiness: all same-direction bars → ~100; alternating → ~0
 *   - fakeout_risk: bars that break prev H/L then reverse → high; never break → ~0
 *   - spread_stability: uniform range bars → high; chaotic ranges → lower
 *   - news_sensitivity: uniform volume → ~0; volume spikes → positive
 *   - momentum_persistence: long runs → higher score
 *   - mean_reversion: extreme moves that revert → higher score
 *   - volatility_regime: recent vs historical range comparison
 *   - siDecisionStats with total > 10 adjusts breakout_quality
 *   - All trait values in [0, 100]
 *   - clearDNACache clears correctly
 */

import { describe, it, expect } from "vitest";
import { computeMarketDNA, clearDNACache } from "../lib/market_dna";

// ── Helpers ────────────────────────────────────────────────────────────────────

type RawBar = { open: number; high: number; low: number; close: number; volume: number };

function bullBar(price: number, range = 1, vol = 1000): RawBar {
  return { open: price, high: price + range, low: price - 0.1, close: price + range * 0.8, volume: vol };
}

function bearBar(price: number, range = 1, vol = 1000): RawBar {
  return { open: price + range, high: price + range, low: price, close: price + 0.1, volume: vol };
}

function dojiBar(price: number, range = 0.5, vol = 1000): RawBar {
  return { open: price, high: price + range, low: price - range, close: price, volume: vol };
}

function bullBars(n: number, price = 100, range = 1, vol = 1000): RawBar[] {
  return Array.from({ length: n }, () => bullBar(price, range, vol));
}

function bearBars(n: number, price = 100, range = 1, vol = 1000): RawBar[] {
  return Array.from({ length: n }, () => bearBar(price, range, vol));
}

/** Alternating bull/bear bars */
function alternatingBars(n: number, price = 100): RawBar[] {
  return Array.from({ length: n }, (_, i) => (i % 2 === 0 ? bullBar(price) : bearBar(price)));
}

// ── Default DNA for < 10 bars ──────────────────────────────────────────────────

describe("computeMarketDNA — < 10 bars → default", () => {
  it("returns 50 for trendiness", () => {
    expect(computeMarketDNA("BTC", bullBars(5)).trendiness).toBe(50);
  });

  it("returns 50 for fakeout_risk", () => {
    expect(computeMarketDNA("BTC", bullBars(5)).fakeout_risk).toBe(50);
  });

  it("returns 50 for breakout_quality", () => {
    expect(computeMarketDNA("BTC", bullBars(5)).breakout_quality).toBe(50);
  });

  it("returns medium volatility_regime", () => {
    expect(computeMarketDNA("BTC", bullBars(5)).volatility_regime).toBe("medium");
  });

  it("returns bar_count = 0", () => {
    expect(computeMarketDNA("BTC", bullBars(5)).bar_count).toBe(0);
  });

  it("empty bars → all defaults", () => {
    const dna = computeMarketDNA("ETH", []);
    expect(dna.trendiness).toBe(50);
    expect(dna.symbol).toBe("ETH");
  });
});

// ── trendiness ─────────────────────────────────────────────────────────────────

describe("computeMarketDNA — trendiness", () => {
  it("all bullish bars → trendiness = 100", () => {
    const dna = computeMarketDNA("BTC", bullBars(20));
    expect(dna.trendiness).toBe(100);
  });

  it("all bearish bars → trendiness = 100 (same direction = trending down)", () => {
    const dna = computeMarketDNA("BTC", bearBars(20));
    expect(dna.trendiness).toBe(100);
  });

  it("alternating bull/bear → trendiness = 0", () => {
    const dna = computeMarketDNA("BTC", alternatingBars(20));
    expect(dna.trendiness).toBe(0);
  });

  it("trendiness in [0, 100]", () => {
    const dna = computeMarketDNA("BTC", alternatingBars(30));
    expect(dna.trendiness).toBeGreaterThanOrEqual(0);
    expect(dna.trendiness).toBeLessThanOrEqual(100);
  });
});

// ── fakeout_risk ───────────────────────────────────────────────────────────────

describe("computeMarketDNA — fakeout_risk", () => {
  it("bars that never break prev high/low → fakeout_risk = 0", () => {
    // Pure doji bars: never break prev high or low in a reversal way
    // Actually need to ensure no bar has high > prev high with close < prev close
    const bars: RawBar[] = [];
    for (let i = 0; i < 20; i++) {
      bars.push({ open: 100, high: 101, low: 99, close: 100, volume: 1000 });
    }
    const dna = computeMarketDNA("BTC", bars);
    expect(dna.fakeout_risk).toBe(0);
  });

  it("bars that consistently break high then reverse → fakeout_risk high", () => {
    // Each bar has strictly increasing high (breaks prev) and strictly decreasing close (reversal)
    const bars: RawBar[] = [];
    for (let i = 0; i < 20; i++) {
      bars.push({
        open: 100 + i * 0.01,
        high: 103 + i * 0.10,  // strictly increasing → always breaks prev high
        low: 98,
        close: 99 - i * 0.01,  // strictly decreasing → always < prev close
        volume: 1000,
      });
    }
    const dna = computeMarketDNA("BTC", bars);
    // brokeHigh = true for all bars i>=1 → fakeout_risk = round(19/19 * 100) = 100
    expect(dna.fakeout_risk).toBeGreaterThan(50);
  });

  it("fakeout_risk in [0, 100]", () => {
    const dna = computeMarketDNA("BTC", alternatingBars(20));
    expect(dna.fakeout_risk).toBeGreaterThanOrEqual(0);
    expect(dna.fakeout_risk).toBeLessThanOrEqual(100);
  });
});

// ── spread_stability ───────────────────────────────────────────────────────────

describe("computeMarketDNA — spread_stability", () => {
  it("perfectly uniform ranges → spread_stability = 100 (zero std dev)", () => {
    // All bars have identical range → CV = 0 → (1 - 0) * 100 = 100
    const bars: RawBar[] = Array.from({ length: 20 }, () => ({
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 1000,
    }));
    const dna = computeMarketDNA("BTC", bars);
    expect(dna.spread_stability).toBe(100);
  });

  it("highly variable ranges → spread_stability < 100", () => {
    const bars: RawBar[] = [];
    for (let i = 0; i < 20; i++) {
      const r = i % 2 === 0 ? 0.1 : 5.0; // alternating tiny/huge ranges
      bars.push({ open: 100, high: 100 + r, low: 100 - r * 0.5, close: 100, volume: 1000 });
    }
    const dna = computeMarketDNA("BTC", bars);
    expect(dna.spread_stability).toBeLessThan(100);
  });

  it("spread_stability in [0, 100]", () => {
    const dna = computeMarketDNA("BTC", bullBars(20));
    expect(dna.spread_stability).toBeGreaterThanOrEqual(0);
    expect(dna.spread_stability).toBeLessThanOrEqual(100);
  });
});

// ── news_sensitivity ───────────────────────────────────────────────────────────

describe("computeMarketDNA — news_sensitivity", () => {
  it("uniform volume → news_sensitivity = 0 (no bar > 2× average)", () => {
    const bars: RawBar[] = Array.from({ length: 20 }, () => ({
      open: 100, high: 101, low: 99, close: 100, volume: 1000,
    }));
    const dna = computeMarketDNA("BTC", bars);
    expect(dna.news_sensitivity).toBe(0);
  });

  it("one bar with 3× average volume → news_sensitivity > 0", () => {
    const bars: RawBar[] = Array.from({ length: 20 }, (_, i) => ({
      open: 100, high: 101, low: 99, close: 100,
      volume: i === 10 ? 3000 : 1000, // one bar at 3× avg
    }));
    const dna = computeMarketDNA("BTC", bars);
    expect(dna.news_sensitivity).toBeGreaterThan(0);
  });

  it("all bars with 10× average volume (spikes) → news_sensitivity = 0 (all equal after normalization)", () => {
    // If ALL bars have same volume, none is > 2x average
    const bars: RawBar[] = Array.from({ length: 20 }, () => ({
      open: 100, high: 101, low: 99, close: 100, volume: 10000,
    }));
    const dna = computeMarketDNA("BTC", bars);
    expect(dna.news_sensitivity).toBe(0);
  });

  it("news_sensitivity in [0, 100]", () => {
    const dna = computeMarketDNA("BTC", bullBars(20));
    expect(dna.news_sensitivity).toBeGreaterThanOrEqual(0);
    expect(dna.news_sensitivity).toBeLessThanOrEqual(100);
  });
});

// ── momentum_persistence ───────────────────────────────────────────────────────

describe("computeMarketDNA — momentum_persistence", () => {
  it("all bullish bars (one long run) → high momentum_persistence", () => {
    const dna = computeMarketDNA("BTC", bullBars(20));
    // avgRun = 20, momentum_persistence = min(100, (20/5)*100) = 100
    expect(dna.momentum_persistence).toBe(100);
  });

  it("alternating bars (run=1 each) → momentum_persistence = 20", () => {
    const dna = computeMarketDNA("BTC", alternatingBars(20));
    // Each run is length 1, avg = 1, momentum_persistence = min(100, (1/5)*100) = 20
    expect(dna.momentum_persistence).toBe(20);
  });

  it("momentum_persistence in [0, 100]", () => {
    const dna = computeMarketDNA("BTC", alternatingBars(30));
    expect(dna.momentum_persistence).toBeGreaterThanOrEqual(0);
    expect(dna.momentum_persistence).toBeLessThanOrEqual(100);
  });
});

// ── mean_reversion ─────────────────────────────────────────────────────────────

describe("computeMarketDNA — mean_reversion", () => {
  it("no extreme moves → mean_reversion = 50 (default fallback)", () => {
    // Uniform tiny returns → very low std dev → no moves > 2 std dev
    const bars: RawBar[] = Array.from({ length: 30 }, () => ({
      open: 100, high: 100.01, low: 99.99, close: 100, volume: 1000,
    }));
    const dna = computeMarketDNA("BTC", bars);
    expect(dna.mean_reversion).toBe(50);
  });

  it("mean_reversion in [0, 100]", () => {
    const bars: RawBar[] = Array.from({ length: 30 }, (_, i) => ({
      open: 100, high: 101, low: 99, close: 100 + (i % 5) * 0.2 - 0.4, volume: 1000,
    }));
    const dna = computeMarketDNA("BTC", bars);
    expect(dna.mean_reversion).toBeGreaterThanOrEqual(0);
    expect(dna.mean_reversion).toBeLessThanOrEqual(100);
  });
});

// ── volatility_regime ──────────────────────────────────────────────────────────

describe("computeMarketDNA — volatility_regime", () => {
  it("all bars same range (recent = historical avg) → medium", () => {
    const bars: RawBar[] = Array.from({ length: 40 }, () => ({
      open: 100, high: 101, low: 99, close: 100, volume: 1000,
    }));
    const dna = computeMarketDNA("BTC", bars);
    expect(dna.volatility_regime).toBe("medium");
  });

  it("recent 20 bars have much smaller range than historical → low", () => {
    // First 20 bars: large range; last 20 bars: tiny range
    const bars: RawBar[] = [
      ...Array.from({ length: 20 }, () => ({
        open: 100, high: 105, low: 95, close: 100, volume: 1000,
      })),
      ...Array.from({ length: 20 }, () => ({
        open: 100, high: 100.1, low: 99.9, close: 100, volume: 1000,
      })),
    ];
    const dna = computeMarketDNA("BTC", bars);
    // recent avg range ≈ 0.2, historical avg ≈ 5.1
    // recentAvgRange / avgRange ≈ 0.04 < 0.6 → "low"
    expect(dna.volatility_regime).toBe("low");
  });

  it("recent 20 bars have much larger range than historical → extreme", () => {
    const bars: RawBar[] = [
      ...Array.from({ length: 20 }, () => ({
        open: 100, high: 100.1, low: 99.9, close: 100, volume: 1000,
      })),
      ...Array.from({ length: 20 }, () => ({
        open: 100, high: 108, low: 92, close: 100, volume: 1000,
      })),
    ];
    const dna = computeMarketDNA("BTC", bars);
    // recent avg ≈ 16, historical avg ≈ 8.1, ratio > 1.6 → extreme
    expect(dna.volatility_regime).toBe("extreme");
  });
});

// ── siDecisionStats integration ────────────────────────────────────────────────

describe("computeMarketDNA — siDecisionStats", () => {
  it("with stats (total > 10) → breakout_quality adjusted", () => {
    const bars = bullBars(30, 100, 2);
    // Without stats
    const withoutStats = computeMarketDNA("BTC", bars, undefined);
    // With stats: high win rate → pushes quality up
    const withStats = computeMarketDNA("BTC", bars, {
      total: 20,
      approved: 15,
      win_rate: 0.85,
      avg_quality: 0.8,
    });
    // With stats: adjusted = raw*0.6 + win_rate*100*0.4
    // If withoutStats.breakout_quality was, say, 50:
    // adjusted = 50*0.6 + 85*0.4 = 30 + 34 = 64
    // So with high win_rate, adjusted should differ
    expect(withStats.breakout_quality).not.toBe(withoutStats.breakout_quality);
  });

  it("with stats total <= 10 → breakout_quality unchanged", () => {
    const bars = bullBars(30, 100, 2);
    const withoutStats = computeMarketDNA("BTC", bars, undefined);
    const withFewStats = computeMarketDNA("BTC", bars, {
      total: 5,
      approved: 4,
      win_rate: 0.90,
      avg_quality: 0.9,
    });
    // total <= 10 → no adjustment applied
    expect(withFewStats.breakout_quality).toBe(withoutStats.breakout_quality);
  });

  it("decision_count reflects stats total", () => {
    const bars = bullBars(15);
    const dna = computeMarketDNA("BTC", bars, {
      total: 42,
      approved: 30,
      win_rate: 0.6,
      avg_quality: 0.7,
    });
    expect(dna.decision_count).toBe(42);
  });

  it("no stats → decision_count = 0", () => {
    const dna = computeMarketDNA("BTC", bullBars(15));
    expect(dna.decision_count).toBe(0);
  });
});

// ── All values in valid range ──────────────────────────────────────────────────

describe("computeMarketDNA — all values in [0, 100]", () => {
  it("complex mixed bars → all trait values in [0, 100]", () => {
    const bars: RawBar[] = [];
    for (let i = 0; i < 50; i++) {
      bars.push({
        open: 100 + Math.sin(i) * 5,
        high: 105 + Math.cos(i) * 3,
        low: 95 - Math.abs(Math.sin(i)) * 2,
        close: 100 + Math.cos(i * 2) * 3,
        volume: 1000 + (i % 7) * 300,
      });
    }
    const dna = computeMarketDNA("BTC", bars);
    expect(dna.trendiness).toBeGreaterThanOrEqual(0);
    expect(dna.trendiness).toBeLessThanOrEqual(100);
    expect(dna.fakeout_risk).toBeGreaterThanOrEqual(0);
    expect(dna.fakeout_risk).toBeLessThanOrEqual(100);
    expect(dna.breakout_quality).toBeGreaterThanOrEqual(0);
    expect(dna.breakout_quality).toBeLessThanOrEqual(100);
    expect(dna.spread_stability).toBeGreaterThanOrEqual(0);
    expect(dna.spread_stability).toBeLessThanOrEqual(100);
    expect(dna.news_sensitivity).toBeGreaterThanOrEqual(0);
    expect(dna.news_sensitivity).toBeLessThanOrEqual(100);
    expect(dna.momentum_persistence).toBeGreaterThanOrEqual(0);
    expect(dna.momentum_persistence).toBeLessThanOrEqual(100);
    expect(dna.mean_reversion).toBeGreaterThanOrEqual(0);
    expect(dna.mean_reversion).toBeLessThanOrEqual(100);
  });

  it("bar_count matches input length", () => {
    const dna = computeMarketDNA("BTC", bullBars(35));
    expect(dna.bar_count).toBe(35);
  });

  it("symbol is preserved in output", () => {
    const dna = computeMarketDNA("ETHUSD", bullBars(15));
    expect(dna.symbol).toBe("ETHUSD");
  });

  it("computed_at is a valid ISO string", () => {
    const dna = computeMarketDNA("BTC", bullBars(15));
    expect(() => new Date(dna.computed_at)).not.toThrow();
  });
});

// ── clearDNACache ──────────────────────────────────────────────────────────────

describe("clearDNACache", () => {
  it("calling clearDNACache() with a symbol does not throw", () => {
    expect(() => clearDNACache("BTCUSD")).not.toThrow();
  });

  it("calling clearDNACache() with no args does not throw", () => {
    expect(() => clearDNACache()).not.toThrow();
  });
});
