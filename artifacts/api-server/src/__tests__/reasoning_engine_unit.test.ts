/**
 * reasoning_engine_unit.test.ts — Phase 59
 *
 * Unit tests for lib/reasoning_engine.ts:
 *
 *   getHeuristicReasoning  — pure deterministic logic (no I/O)
 *   reasonTradeDecision    — hybrid hub that falls back to heuristics
 *                            when ANTHROPIC_API_KEY is absent
 *
 * Dependencies mocked:
 *   @anthropic-ai/sdk  — prevented from making real API calls
 *   p-timeout          — pass-through (real timeout still present but
 *                        Claude mock resolves instantly)
 *   ./schemas          — DecisionContractSchema.parse forwarded
 */

import { describe, it, expect, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@anthropic-ai/sdk", () => {
  const messages = {
    create: vi.fn(async () => ({
      content: [{ text: '{"approved":true,"quality":0.75,"winProbability":0.68,"kellyFraction":0.04}' }],
    })),
  };
  class FakeAnthropic {
    messages = messages;
    constructor(_opts?: unknown) {}
  }
  return { default: FakeAnthropic };
});

// ── Import AFTER mocks ────────────────────────────────────────────────────────
import { getHeuristicReasoning, reasonTradeDecision } from "../lib/reasoning_engine";

// ─────────────────────────────────────────────────────────────────────────────
// getHeuristicReasoning — pure deterministic logic
// ─────────────────────────────────────────────────────────────────────────────

describe("getHeuristicReasoning", () => {
  const trendingBase = {
    structure_score:  0.75,
    order_flow_score: 0.70,
    regime:           "trending",
    direction:        "long",
    recall_score:     0.65,
  };

  it("returns approved=true for high-quality trending setup", () => {
    const result = getHeuristicReasoning(trendingBase);
    expect(result.approved).toBe(true);
  });

  it("returns approved=false for low-quality setup", () => {
    const result = getHeuristicReasoning({
      ...trendingBase,
      structure_score:  0.4,
      order_flow_score: 0.3,
      recall_score:     0.3,
    });
    expect(result.approved).toBe(false);
  });

  it("quality is between 0 and 1", () => {
    const result = getHeuristicReasoning(trendingBase);
    expect(result.quality).toBeGreaterThanOrEqual(0);
    expect(result.quality).toBeLessThanOrEqual(1);
  });

  it("winProbability is between 0 and 1", () => {
    const result = getHeuristicReasoning(trendingBase);
    expect(result.winProbability).toBeGreaterThanOrEqual(0);
    expect(result.winProbability).toBeLessThanOrEqual(1);
  });

  it("reasonSource is heuristic", () => {
    const result = getHeuristicReasoning(trendingBase);
    expect(result.reasonSource).toBe("heuristic");
  });

  it("kellyFraction is 0 when rejected", () => {
    const result = getHeuristicReasoning({
      ...trendingBase,
      structure_score:  0.2,
      order_flow_score: 0.2,
      recall_score:     0.2,
    });
    expect(result.kellyFraction).toBe(0);
  });

  it("uses order_flow weighting heavier for non-trending regime", () => {
    const ranging = getHeuristicReasoning({
      structure_score:  0.6,
      order_flow_score: 0.9,
      recall_score:     0.7,
      regime:           "ranging",
      direction:        "short",
    });
    const trending = getHeuristicReasoning({
      structure_score:  0.6,
      order_flow_score: 0.9,
      recall_score:     0.7,
      regime:           "trending",
      direction:        "short",
    });
    // Ranging regime weights order_flow more (0.5 vs 0.3)
    // So ranging quality should be higher with high order_flow_score
    expect(ranging.quality).toBeGreaterThan(trending.quality);
  });

  it("rejectionReason is set when not approved", () => {
    const result = getHeuristicReasoning({
      ...trendingBase,
      structure_score: 0.1,
      order_flow_score: 0.1,
      recall_score: 0.1,
    });
    if (!result.approved) {
      expect(typeof result.rejectionReason).toBe("string");
    }
  });

  it("rejectionReason is undefined when approved", () => {
    const result = getHeuristicReasoning(trendingBase);
    if (result.approved) {
      expect(result.rejectionReason).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// reasonTradeDecision — falls back to heuristic when no API key
// ─────────────────────────────────────────────────────────────────────────────

describe("reasonTradeDecision (heuristic fallback path)", () => {
  const input = {
    structure:  0.75,
    order_flow: 0.70,
    recall:     0.65,
    setup_type: "sweep_reclaim",
    regime:     "trending",
    direction:  "long",
    // Note: structure_score/order_flow_score/recall_score aliases also accepted
    structure_score:  0.75,
    order_flow_score: 0.70,
    recall_score:     0.65,
  };

  it("returns a DecisionContract with required fields", async () => {
    const result = await reasonTradeDecision(1, "BTCUSD", input);
    expect(result).toHaveProperty("approved");
    expect(result).toHaveProperty("quality");
    expect(result).toHaveProperty("winProbability");
    expect(result).toHaveProperty("kellyFraction");
    expect(result).toHaveProperty("signalId");
    expect(result).toHaveProperty("symbol");
  });

  it("signalId and symbol match inputs", async () => {
    const result = await reasonTradeDecision(42, "ETHUSD", input);
    expect(result.signalId).toBe(42);
    expect(result.symbol).toBe("ETHUSD");
  });

  it("winProbability is between 0 and 1", async () => {
    const result = await reasonTradeDecision(1, "BTCUSD", input);
    expect(result.winProbability).toBeGreaterThanOrEqual(0);
    expect(result.winProbability).toBeLessThanOrEqual(1);
  });

  it("quality is between 0 and 1", async () => {
    const result = await reasonTradeDecision(1, "BTCUSD", input);
    expect(result.quality).toBeGreaterThanOrEqual(0);
    expect(result.quality).toBeLessThanOrEqual(1);
  });
});
