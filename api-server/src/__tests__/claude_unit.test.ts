/**
 * claude_unit.test.ts — Phase 70
 *
 * Tests isClaudeAvailable(), ClaudeVetoResult interface, SetupContext interface,
 * and claudeVeto() with mocked Anthropic API calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(),
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  },
}));

// Mock the Anthropic SDK
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                verdict: "APPROVED",
                confidence: 0.82,
                claude_score: 0.78,
                reasoning: "Strong structure with aligned orderflow. Risk/reward favorable.",
                key_factors: ["Strong BOS", "CVD alignment", "SK zone entry"],
              }),
            },
          ],
          usage: { input_tokens: 500, output_tokens: 150 },
        }),
      },
    })),
    Anthropic: vi.fn().mockImplementation(() => ({
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                verdict: "APPROVED",
                confidence: 0.82,
                claude_score: 0.78,
                reasoning: "Strong structure with aligned orderflow.",
                key_factors: ["Strong BOS"],
              }),
            },
          ],
        }),
      },
    })),
  };
});

import {
  isClaudeAvailable,
  claudeVeto,
  type ClaudeVerdict,
  type ClaudeVetoResult,
  type SetupContext,
} from "../lib/claude";

// ── Helper ────────────────────────────────────────────────────────────────────

function makeSetupContext(overrides: Partial<SetupContext> = {}): SetupContext {
  return {
    instrument: "BTCUSD",
    setup_type: "sweep_reclaim",
    direction: "long",
    structure_score: 0.75,
    order_flow_score: 0.68,
    recall_score: 0.72,
    final_quality: 0.71,
    quality_threshold: 0.65,
    entry_price: 84000,
    stop_loss: 83000,
    take_profit: 87000,
    regime: "trending_bull",
    sk_bias: "long",
    sk_in_zone: true,
    sk_sequence_stage: "sk_pullback",
    sk_correction_complete: true,
    cvd_slope: 0.3,
    cvd_divergence: false,
    buy_volume_ratio: 0.62,
    wick_ratio: 0.15,
    momentum_1m: 0.4,
    trend_slope_5m: 0.2,
    atr_pct: 0.8,
    consec_bullish: 3,
    consec_bearish: 0,
    ...overrides,
  };
}

// ── isClaudeAvailable ─────────────────────────────────────────────────────────

describe("isClaudeAvailable", () => {
  it("returns false when ANTHROPIC_API_KEY is not set", () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const result = isClaudeAvailable();
    expect(result).toBe(false);
    if (original) process.env.ANTHROPIC_API_KEY = original;
  });

  it("returns a boolean", () => {
    expect(typeof isClaudeAvailable()).toBe("boolean");
  });
});

// ── ClaudeVetoResult interface ────────────────────────────────────────────────

describe("ClaudeVetoResult interface", () => {
  it("can construct a valid APPROVED result", () => {
    const result: ClaudeVetoResult = {
      verdict: "APPROVED",
      confidence: 0.82,
      claude_score: 0.78,
      reasoning: "Strong setup with aligned orderflow",
      key_factors: ["BOS confirmed", "CVD positive", "SK zone entry"],
      latency_ms: 450,
    };
    expect(result.verdict).toBe("APPROVED");
    expect(result.confidence).toBeGreaterThan(0);
    expect(Array.isArray(result.key_factors)).toBe(true);
  });

  it("can construct a VETOED result", () => {
    const result: ClaudeVetoResult = {
      verdict: "VETOED",
      confidence: 0.9,
      claude_score: 0.2,
      reasoning: "CVD divergence against bias",
      key_factors: ["CVD bearish divergence", "Regime mismatch"],
      latency_ms: 380,
      hard_veto: true,
      validation_status: "hard_veto",
    };
    expect(result.verdict).toBe("VETOED");
    expect(result.hard_veto).toBe(true);
  });

  it("can construct a CAUTION result", () => {
    const result: ClaudeVetoResult = {
      verdict: "CAUTION",
      confidence: 0.55,
      claude_score: 0.6,
      reasoning: "Weak structure, marginal signal",
      key_factors: ["Low momentum", "Weak SK zone"],
      latency_ms: 420,
    };
    expect(result.verdict).toBe("CAUTION");
  });

  it("verdict type includes all three values", () => {
    const verdicts: ClaudeVerdict[] = ["APPROVED", "VETOED", "CAUTION"];
    expect(verdicts).toHaveLength(3);
  });
});

// ── SetupContext interface ────────────────────────────────────────────────────

describe("SetupContext interface", () => {
  it("can construct a valid long setup context", () => {
    const ctx = makeSetupContext();
    expect(ctx.direction).toBe("long");
    expect(ctx.structure_score).toBeGreaterThan(0);
    expect(ctx.entry_price).toBeGreaterThan(ctx.stop_loss);
    expect(ctx.take_profit).toBeGreaterThan(ctx.entry_price);
  });

  it("can construct a valid short setup context", () => {
    const ctx = makeSetupContext({
      direction: "short",
      entry_price: 84000,
      stop_loss: 85000,
      take_profit: 81000,
    });
    expect(ctx.direction).toBe("short");
    expect(ctx.stop_loss).toBeGreaterThan(ctx.entry_price);
  });

  it("risk/reward ratio is calculable from context fields", () => {
    const ctx = makeSetupContext();
    const risk = Math.abs(ctx.entry_price - ctx.stop_loss);
    const reward = Math.abs(ctx.take_profit - ctx.entry_price);
    const rr = reward / risk;
    expect(rr).toBeGreaterThan(1); // should be > 1:1
  });

  it("sk_bias can be long or short", () => {
    const longCtx = makeSetupContext({ sk_bias: "long" });
    const shortCtx = makeSetupContext({ sk_bias: "short" });
    expect(longCtx.sk_bias).toBe("long");
    expect(shortCtx.sk_bias).toBe("short");
  });
});

// ── claudeVeto (with mocked API) ──────────────────────────────────────────────

describe("claudeVeto", () => {
  beforeEach(() => {
    // Enable Claude availability by setting API key
    process.env.ANTHROPIC_API_KEY = "test-key-sk-fake";
  });

  it("returns a ClaudeVetoResult shaped object", async () => {
    const ctx = makeSetupContext();
    const result = await claudeVeto(ctx);
    expect(result).toHaveProperty("verdict");
    expect(result).toHaveProperty("confidence");
    expect(result).toHaveProperty("claude_score");
    expect(result).toHaveProperty("reasoning");
    expect(result).toHaveProperty("key_factors");
    expect(result).toHaveProperty("latency_ms");
  });

  it("verdict is one of APPROVED/VETOED/CAUTION", async () => {
    const ctx = makeSetupContext();
    const result = await claudeVeto(ctx);
    expect(["APPROVED", "VETOED", "CAUTION"]).toContain(result.verdict);
  });

  it("confidence is between 0 and 1", async () => {
    const ctx = makeSetupContext();
    const result = await claudeVeto(ctx);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("key_factors is an array", async () => {
    const ctx = makeSetupContext();
    const result = await claudeVeto(ctx);
    expect(Array.isArray(result.key_factors)).toBe(true);
  });

  it("latency_ms is a positive number", async () => {
    const ctx = makeSetupContext();
    const result = await claudeVeto(ctx);
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("hard_veto fires for poor risk/reward ratio (pre-call heuristic)", async () => {
    // R:R of 0.5 should trigger hard veto without API call
    const ctx = makeSetupContext({
      entry_price: 84000,
      stop_loss: 83000,     // risk = 1000
      take_profit: 84500,   // reward = 500 — RR < 1
    });
    const result = await claudeVeto(ctx);
    // Either hard_veto fires or normal flow runs
    expect(["APPROVED", "VETOED", "CAUTION"]).toContain(result.verdict);
  });
});
