/**
 * strategy_cache_unit.test.ts — Phase 66
 *
 * Tests getStrategySnapshot, refreshStrategyCache, and getStrategyOverlay.
 * Mocks getBars to provide realistic bar data without hitting Alpaca.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Generate test bars ────────────────────────────────────────────────────────

function makeBar(close: number, i: number, base = 84000) {
  const open = close + (Math.random() - 0.5) * 200;
  return {
    t: new Date(Date.now() - (200 - i) * 60_000).toISOString(),
    o: open, h: Math.max(open, close) + 50, l: Math.min(open, close) - 50, c: close, v: 800_000,
    Open: open, High: Math.max(open, close) + 50, Low: Math.min(open, close) - 50,
    Close: close, Volume: 800_000,
    Timestamp: new Date(Date.now() - (200 - i) * 60_000).toISOString(),
    VWAP: close,
  };
}

function makeTrendingBars(count = 200, startPrice = 83000, slope = 4) {
  return Array.from({ length: count }, (_, i) => makeBar(startPrice + i * slope, i));
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../lib/alpaca", () => ({
  getBars: vi.fn().mockResolvedValue(makeTrendingBars()),
}));

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  },
}));

vi.mock("@workspace/db", () => {
  const limitMock = vi.fn().mockResolvedValue([]);
  const orderByMock = vi.fn(() => ({ limit: limitMock }));
  const whereMock = vi.fn(() => ({ orderBy: orderByMock }));
  const fromMock = vi.fn(() => ({ where: whereMock }));
  const selectMock = vi.fn(() => ({ from: fromMock }));
  return {
    db: { select: selectMock },
    siDecisionsTable: new Proxy({} as any, { get: (_t, p) => String(p) }),
  };
});

import { getBars } from "../lib/alpaca";
import {
  getStrategySnapshot,
  refreshStrategyCache,
  getStrategyOverlay,
  type LiveStrategySnapshot,
} from "../lib/strategy_cache";

// ── getStrategySnapshot ───────────────────────────────────────────────────────

describe("getStrategySnapshot", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(getBars).mockResolvedValue(makeTrendingBars());
    // Force cache invalidation by refreshing
    await refreshStrategyCache("BTCUSD");
  });

  it("returns a LiveStrategySnapshot shaped object", async () => {
    const snap = await getStrategySnapshot("BTCUSD");
    expect(snap).toBeDefined();
    expect(snap).toHaveProperty("computed_at");
    expect(snap).toHaveProperty("regime");
    expect(snap).toHaveProperty("c4_score");
    expect(snap).toHaveProperty("sk");
    expect(snap).toHaveProperty("cvd");
    expect(snap).toHaveProperty("indicators");
  });

  it("computed_at is a valid ISO string", async () => {
    const snap = await getStrategySnapshot("BTCUSD");
    expect(() => new Date(snap.computed_at)).not.toThrow();
    expect(new Date(snap.computed_at).getTime()).toBeGreaterThan(0);
  });

  it("regime is a valid Regime value", async () => {
    const snap = await getStrategySnapshot("BTCUSD");
    const validRegimes = ["trending_bull", "trending_bear", "ranging", "volatile", "chop"];
    expect(validRegimes).toContain(snap.regime);
  });

  it("c4_score is between 0 and 100", async () => {
    const snap = await getStrategySnapshot("BTCUSD");
    expect(snap.c4_score).toBeGreaterThanOrEqual(0);
    expect(snap.c4_score).toBeLessThanOrEqual(100);
  });

  it("position_bias is Long/Short/Neutral", async () => {
    const snap = await getStrategySnapshot("BTCUSD");
    expect(["Long", "Short", "Neutral"]).toContain(snap.position_bias);
  });

  it("atr_pct is positive", async () => {
    const snap = await getStrategySnapshot("BTCUSD");
    expect(snap.atr_pct).toBeGreaterThan(0);
  });

  it("detected_setups is an array", async () => {
    const snap = await getStrategySnapshot("BTCUSD");
    expect(Array.isArray(snap.detected_setups)).toBe(true);
  });

  it("each detected setup has required fields", async () => {
    const snap = await getStrategySnapshot("BTCUSD");
    for (const s of snap.detected_setups) {
      expect(s).toHaveProperty("type");
      expect(s).toHaveProperty("direction");
      expect(s).toHaveProperty("quality");
      expect(s).toHaveProperty("meets_threshold");
    }
  });

  it("ob_zones is an array of zone objects", async () => {
    const snap = await getStrategySnapshot("BTCUSD");
    expect(Array.isArray(snap.ob_zones)).toBe(true);
    for (const z of snap.ob_zones) {
      expect(z).toHaveProperty("side");
      expect(z).toHaveProperty("low");
      expect(z).toHaveProperty("high");
      expect(["bullish", "bearish"]).toContain(z.side);
    }
  });

  it("returns cached result on second call", async () => {
    await getStrategySnapshot("BTCUSD");
    const callsBefore = vi.mocked(getBars).mock.calls.length;
    await getStrategySnapshot("BTCUSD");
    // No additional getBars call — cache served
    expect(vi.mocked(getBars).mock.calls.length).toBe(callsBefore);
  });
});

describe("getStrategySnapshot — error state", () => {
  it("returns snapshot with error field when getBars throws", async () => {
    vi.mocked(getBars).mockRejectedValue(new Error("Alpaca unavailable"));
    const snap = await refreshStrategyCache("ETHUSD");
    expect(snap).toBeDefined();
    expect(snap.error).toBeTruthy();
    expect(typeof snap.error).toBe("string");
  });
});

// ── refreshStrategyCache ──────────────────────────────────────────────────────

describe("refreshStrategyCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getBars).mockResolvedValue(makeTrendingBars());
  });

  it("forces re-computation (getBars is called again)", async () => {
    await getStrategySnapshot("BTCUSD");
    const before = vi.mocked(getBars).mock.calls.length;
    await refreshStrategyCache("BTCUSD");
    expect(vi.mocked(getBars).mock.calls.length).toBeGreaterThan(before);
  });

  it("returns a valid snapshot after refresh", async () => {
    const snap = await refreshStrategyCache("BTCUSD");
    expect(snap).toHaveProperty("computed_at");
    expect(snap).toHaveProperty("regime");
  });
});

// ── getStrategyOverlay ────────────────────────────────────────────────────────

describe("getStrategyOverlay", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(getBars).mockResolvedValue(makeTrendingBars());
    await refreshStrategyCache("BTCUSD");
  });

  it("returns expected overlay keys", async () => {
    const overlay = await getStrategyOverlay("BTCUSD");
    const expectedKeys = [
      "regime", "regime_confidence", "c4_score", "active_obs",
      "sk_quality", "position_bias", "bias_confidence",
    ];
    for (const key of expectedKeys) {
      expect(overlay).toHaveProperty(key);
    }
  });

  it("regime_confidence is 0-100", async () => {
    const overlay = await getStrategyOverlay("BTCUSD");
    expect(overlay.regime_confidence).toBeGreaterThanOrEqual(0);
    expect(overlay.regime_confidence).toBeLessThanOrEqual(100);
  });

  it("c4_score is 0-100", async () => {
    const overlay = await getStrategyOverlay("BTCUSD");
    expect(overlay.c4_score).toBeGreaterThanOrEqual(0);
    expect(overlay.c4_score).toBeLessThanOrEqual(100);
  });

  it("sk_quality is Strong|Moderate|Weak", async () => {
    const overlay = await getStrategyOverlay("BTCUSD");
    expect(["Strong", "Moderate", "Weak"]).toContain(overlay.sk_quality);
  });

  it("active_obs is non-negative integer", async () => {
    const overlay = await getStrategyOverlay("BTCUSD");
    expect(overlay.active_obs).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(overlay.active_obs)).toBe(true);
  });
});
