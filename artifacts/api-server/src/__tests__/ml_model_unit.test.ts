/**
 * ml_model_unit.test.ts — Phase 59
 *
 * Unit tests for the ML model layer (lib/ml_model.ts):
 *
 *   predictWinProbability  — heuristic fallback (untrained model)
 *   getModelStatus         — initial "warning" state before training
 *
 * The model is NOT trained in these tests; all predictions fall
 * through to the heuristic code path, which is pure math with no
 * external dependencies.
 *
 * Dependencies mocked:
 *   @workspace/db   — db, accuracyResultsTable (model training skipped)
 *   drizzle-orm     — no-op operators
 */

import { describe, it, expect, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  and:       vi.fn((...args: unknown[]) => args),
  or:        vi.fn((...args: unknown[]) => args),
  gte:       vi.fn(() => null),
  lte:       vi.fn(() => null),
  eq:        vi.fn(() => null),
  ne:        vi.fn(() => null),
  isNotNull: vi.fn(() => null),
  isNull:    vi.fn(() => null),
  desc:      vi.fn(() => null),
  asc:       vi.fn(() => null),
  sql:       Object.assign(vi.fn(() => ""), { raw: vi.fn((s: string) => s) }),
  inArray:   vi.fn(() => null),
  count:     vi.fn(() => 0),
}));

vi.mock("@workspace/db", () => {
  const chain: any = {};
  chain.select    = vi.fn().mockReturnValue(chain);
  chain.from      = vi.fn().mockReturnValue(chain);
  chain.where     = vi.fn().mockReturnValue(chain);
  chain.orderBy   = vi.fn().mockReturnValue(chain);
  chain.limit     = vi.fn().mockResolvedValue([]);
  chain.then      = (resolve: (v: unknown) => void) => Promise.resolve([]).then(resolve);
  const db = new Proxy({} as any, {
    get(_t, key) {
      if (key === "select")  return (..._args: any[]) => chain;
      if (key === "execute") return vi.fn().mockResolvedValue(undefined);
      return undefined;
    },
  });
  return {
    db,
    accuracyResultsTable: new Proxy({ tableName: "accuracy_results" } as any, {
      get(t, p) { return t[p] ?? String(p); },
    }),
  };
});

// ── Import AFTER mocks ────────────────────────────────────────────────────────
import { predictWinProbability, getModelStatus } from "../lib/ml_model";

// ─────────────────────────────────────────────────────────────────────────────
// getModelStatus — untrained state
// ─────────────────────────────────────────────────────────────────────────────

describe("getModelStatus (untrained)", () => {
  it("returns status warning or error when untrained", () => {
    const s = getModelStatus();
    expect(["warning", "error"]).toContain(s.status);
  });

  it("returns a non-empty message string", () => {
    const s = getModelStatus();
    expect(typeof s.message).toBe("string");
    expect(s.message.length).toBeGreaterThan(0);
  });

  it("meta is null when untrained", () => {
    const s = getModelStatus();
    expect(s.meta).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// predictWinProbability — heuristic path
// ─────────────────────────────────────────────────────────────────────────────

describe("predictWinProbability (heuristic fallback)", () => {
  const baseInput = {
    structure_score:  0.75,
    order_flow_score: 0.70,
    recall_score:     0.65,
    final_quality:    0.72,
    setup_type:       "sweep_reclaim",
    regime:           "trending",
  };

  it("returns an object with probability, confidence, source", () => {
    const result = predictWinProbability(baseInput);
    expect(result).toHaveProperty("probability");
    expect(result).toHaveProperty("confidence");
    expect(result).toHaveProperty("source");
  });

  it("probability is between 0.01 and 0.99", () => {
    const result = predictWinProbability(baseInput);
    expect(result.probability).toBeGreaterThanOrEqual(0.01);
    expect(result.probability).toBeLessThanOrEqual(0.99);
  });

  it("source is heuristic when untrained", () => {
    const result = predictWinProbability(baseInput);
    expect(result.source).toBe("heuristic");
  });

  it("higher recall_score gives higher probability", () => {
    const low  = predictWinProbability({ ...baseInput, recall_score: 0.20 });
    const high = predictWinProbability({ ...baseInput, recall_score: 0.90 });
    expect(high.probability).toBeGreaterThan(low.probability);
  });

  it("probability is finite and numeric", () => {
    const result = predictWinProbability(baseInput);
    expect(Number.isFinite(result.probability)).toBe(true);
  });

  it("handles edge case: all zeros input", () => {
    const result = predictWinProbability({
      structure_score: 0, order_flow_score: 0,
      recall_score: 0, final_quality: 0,
      setup_type: "absorption_reversal", regime: "ranging",
    });
    expect(result.probability).toBeGreaterThanOrEqual(0.01);
    expect(result.probability).toBeLessThanOrEqual(0.99);
  });

  it("handles edge case: all ones input", () => {
    const result = predictWinProbability({
      structure_score: 1, order_flow_score: 1,
      recall_score: 1, final_quality: 1,
      setup_type: "sweep_reclaim", regime: "trending",
    });
    expect(result.probability).toBeGreaterThanOrEqual(0.01);
    expect(result.probability).toBeLessThanOrEqual(0.99);
  });

  it("accepts optional direction param", () => {
    const result = predictWinProbability({ ...baseInput, direction: "long" });
    expect(result).toHaveProperty("probability");
  });

  it("confidence is 0 in heuristic mode", () => {
    const result = predictWinProbability(baseInput);
    expect(result.confidence).toBe(0);
  });
});
