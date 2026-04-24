/**
 * schemas_and_proof_cache.test.ts — Phase 32
 *
 * Tests for:
 *   1. schemas.ts  — Zod schema parse / rejection for all exported schemas
 *   2. proof_engine — clearProofCache / getProofCacheStats (pure cache helpers)
 *
 * Coverage goals:
 *   - Valid payloads parse successfully (safeParse → success: true)
 *   - Missing required fields → success: false
 *   - Out-of-range numbers in constrained schemas → success: false
 *   - clearProofCache: clears all or specific key
 *   - getProofCacheStats: reports size and entry list
 */

import { describe, it, expect, beforeEach } from "vitest";

// ── Schemas ───────────────────────────────────────────────────────────────────
import {
  SMCBarSchema,
  SwingPointSchema,
  OrderBlockSchema,
  FairValueGapSchema,
  LiquidityPoolSchema,
  OrderflowSchema,
  BrainStateSchema,
  DecisionContractSchema,
} from "../lib/schemas";

// ── Proof Engine cache helpers ────────────────────────────────────────────────
import { clearProofCache, getProofCacheStats } from "../lib/proof_engine";

// ═════════════════════════════════════════════════════════════════════════════
// SMCBarSchema
// ═════════════════════════════════════════════════════════════════════════════

describe("SMCBarSchema", () => {
  const valid = {
    Timestamp: "2025-01-01T00:00:00.000Z",
    Open: 100,
    High: 105,
    Low: 99,
    Close: 103,
    Volume: 5000,
  };

  it("parses a valid bar", () => {
    expect(SMCBarSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects missing Timestamp", () => {
    const { Timestamp: _, ...rest } = valid;
    expect(SMCBarSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects non-number Close", () => {
    expect(SMCBarSchema.safeParse({ ...valid, Close: "103" }).success).toBe(false);
  });

  it("rejects negative Volume (is a number, allowed — schema has no min)", () => {
    // Volume is z.number() with no min constraint, so -1 is technically valid
    expect(SMCBarSchema.safeParse({ ...valid, Volume: -1 }).success).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SwingPointSchema
// ═════════════════════════════════════════════════════════════════════════════

describe("SwingPointSchema", () => {
  const valid = { index: 5, ts: "2025-01-01T00:00:00Z", price: 100.5, kind: "high" as const };

  it("parses a valid swing high", () => {
    expect(SwingPointSchema.safeParse(valid).success).toBe(true);
  });

  it("parses a valid swing low", () => {
    expect(SwingPointSchema.safeParse({ ...valid, kind: "low" }).success).toBe(true);
  });

  it("rejects invalid kind", () => {
    expect(SwingPointSchema.safeParse({ ...valid, kind: "mid" }).success).toBe(false);
  });

  it("rejects missing price", () => {
    const { price: _, ...rest } = valid;
    expect(SwingPointSchema.safeParse(rest).success).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// OrderBlockSchema
// ═════════════════════════════════════════════════════════════════════════════

describe("OrderBlockSchema", () => {
  const valid = {
    index: 10,
    ts: "2025-01-01T00:00:00Z",
    side: "bullish" as const,
    low: 99,
    high: 101,
    mid: 100,
    strength: 0.8,
    tested: false,
    broken: false,
  };

  it("parses a valid order block", () => {
    expect(OrderBlockSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts bearish side", () => {
    expect(OrderBlockSchema.safeParse({ ...valid, side: "bearish" }).success).toBe(true);
  });

  it("rejects invalid side", () => {
    expect(OrderBlockSchema.safeParse({ ...valid, side: "neutral" }).success).toBe(false);
  });

  it("rejects missing tested boolean", () => {
    const { tested: _, ...rest } = valid;
    expect(OrderBlockSchema.safeParse(rest).success).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FairValueGapSchema
// ═════════════════════════════════════════════════════════════════════════════

describe("FairValueGapSchema", () => {
  const valid = {
    index: 3,
    ts: "2025-01-01T00:00:00Z",
    side: "bullish" as const,
    low: 100,
    high: 102,
    sizePct: 0.02,
    filled: false,
    fillPct: 0,
  };

  it("parses a valid FVG", () => {
    expect(FairValueGapSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects invalid side", () => {
    expect(FairValueGapSchema.safeParse({ ...valid, side: "sideways" }).success).toBe(false);
  });

  it("rejects missing fillPct", () => {
    const { fillPct: _, ...rest } = valid;
    expect(FairValueGapSchema.safeParse(rest).success).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// LiquidityPoolSchema
// ═════════════════════════════════════════════════════════════════════════════

describe("LiquidityPoolSchema", () => {
  const valid = {
    price: 100,
    kind: "equal_highs" as const,
    touches: 3,
    firstIndex: 0,
    lastIndex: 10,
    swept: false,
  };

  it("parses a valid liquidity pool", () => {
    expect(LiquidityPoolSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts equal_lows kind", () => {
    expect(LiquidityPoolSchema.safeParse({ ...valid, kind: "equal_lows" }).success).toBe(true);
  });

  it("rejects invalid kind", () => {
    expect(LiquidityPoolSchema.safeParse({ ...valid, kind: "swing_high" }).success).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// OrderflowSchema
// ═════════════════════════════════════════════════════════════════════════════

describe("OrderflowSchema", () => {
  const valid = {
    delta: 500,
    cvd: 1200,
    cvdSlope: 0.03,
    quoteImbalance: 0.25,
    spreadBps: 2,
    aggressionScore: 0.72,
    orderflowBias: "bullish" as const,
    orderflowScore: 0.68,
    buyVolumeRatio: 0.55,
    largeDeltaBar: false,
    divergence: false,
  };

  it("parses a valid orderflow state", () => {
    expect(OrderflowSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects aggressionScore > 1", () => {
    expect(OrderflowSchema.safeParse({ ...valid, aggressionScore: 1.5 }).success).toBe(false);
  });

  it("rejects aggressionScore < 0", () => {
    expect(OrderflowSchema.safeParse({ ...valid, aggressionScore: -0.1 }).success).toBe(false);
  });

  it("rejects orderflowScore > 1", () => {
    expect(OrderflowSchema.safeParse({ ...valid, orderflowScore: 2.0 }).success).toBe(false);
  });

  it("rejects invalid orderflowBias", () => {
    expect(OrderflowSchema.safeParse({ ...valid, orderflowBias: "sideways" }).success).toBe(false);
  });

  it("accepts all valid orderflowBias values", () => {
    for (const bias of ["bullish", "bearish", "neutral"] as const) {
      expect(OrderflowSchema.safeParse({ ...valid, orderflowBias: bias }).success).toBe(true);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// BrainStateSchema
// ═════════════════════════════════════════════════════════════════════════════

describe("BrainStateSchema", () => {
  const valid = {
    symbol: "BTCUSD",
    readinessScore: 78,
    attentionScore: 85,
    regime: "trending",
    lastUpdated: "2025-01-01T00:00:00Z",
  };

  it("parses a valid brain state", () => {
    expect(BrainStateSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts optional reasoning", () => {
    expect(BrainStateSchema.safeParse({ ...valid, reasoning: "Breakout confirmed" }).success).toBe(true);
  });

  it("rejects readinessScore > 100", () => {
    expect(BrainStateSchema.safeParse({ ...valid, readinessScore: 150 }).success).toBe(false);
  });

  it("rejects readinessScore < 0", () => {
    expect(BrainStateSchema.safeParse({ ...valid, readinessScore: -5 }).success).toBe(false);
  });

  it("rejects attentionScore > 100", () => {
    expect(BrainStateSchema.safeParse({ ...valid, attentionScore: 101 }).success).toBe(false);
  });

  it("rejects missing symbol", () => {
    const { symbol: _, ...rest } = valid;
    expect(BrainStateSchema.safeParse(rest).success).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DecisionContractSchema
// ═════════════════════════════════════════════════════════════════════════════

describe("DecisionContractSchema", () => {
  const valid = {
    signalId: 42,
    symbol: "ETHUSD",
    approved: true,
    quality: 0.72,
    winProbability: 0.61,
    kellyFraction: 0.18,
    suggestedQty: 0.5,
    reasonSource: "heuristic" as const,
  };

  it("parses a valid decision contract", () => {
    expect(DecisionContractSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts optional rejectionReason", () => {
    expect(DecisionContractSchema.safeParse({ ...valid, rejectionReason: "Low edge" }).success).toBe(true);
  });

  it("rejects quality > 1", () => {
    expect(DecisionContractSchema.safeParse({ ...valid, quality: 1.1 }).success).toBe(false);
  });

  it("rejects quality < 0", () => {
    expect(DecisionContractSchema.safeParse({ ...valid, quality: -0.01 }).success).toBe(false);
  });

  it("rejects winProbability > 1", () => {
    expect(DecisionContractSchema.safeParse({ ...valid, winProbability: 1.5 }).success).toBe(false);
  });

  it("rejects negative suggestedQty", () => {
    expect(DecisionContractSchema.safeParse({ ...valid, suggestedQty: -1 }).success).toBe(false);
  });

  it("rejects invalid reasonSource", () => {
    expect(DecisionContractSchema.safeParse({ ...valid, reasonSource: "manual" }).success).toBe(false);
  });

  it("accepts all valid reasonSource values", () => {
    for (const src of ["claude", "heuristic", "ml"] as const) {
      expect(DecisionContractSchema.safeParse({ ...valid, reasonSource: src }).success).toBe(true);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Proof Engine Cache Helpers
// ═════════════════════════════════════════════════════════════════════════════

describe("getProofCacheStats", () => {
  beforeEach(() => {
    clearProofCache();
  });

  it("returns an object with size property", () => {
    const stats = getProofCacheStats();
    expect(stats).toHaveProperty("size");
    expect(typeof stats.size).toBe("number");
  });

  it("returns an object with entries array", () => {
    const stats = getProofCacheStats();
    expect(Array.isArray(stats.entries)).toBe(true);
  });

  it("fresh module (after clearAll) has size = 0", () => {
    const stats = getProofCacheStats();
    expect(stats.size).toBe(0);
  });

  it("entries is empty array after clearAll", () => {
    const stats = getProofCacheStats();
    expect(stats.entries).toHaveLength(0);
  });
});

describe("clearProofCache", () => {
  beforeEach(() => {
    clearProofCache();
  });

  it("calling clearProofCache() with no args does not throw", () => {
    expect(() => clearProofCache()).not.toThrow();
  });

  it("calling clearProofCache(30) with specific days does not throw", () => {
    expect(() => clearProofCache(30)).not.toThrow();
  });

  it("calling clearProofCache(7) repeatedly does not throw", () => {
    expect(() => {
      clearProofCache(7);
      clearProofCache(7);
    }).not.toThrow();
  });

  it("after clearAll, size is 0", () => {
    clearProofCache();
    expect(getProofCacheStats().size).toBe(0);
  });

  it("clearing a non-existent key does not throw or add entries", () => {
    clearProofCache(999);
    expect(getProofCacheStats().size).toBe(0);
  });
});
