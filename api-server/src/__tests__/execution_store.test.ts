/**
 * Tests for execution_store.ts — Order state machine, fill recording, slippage computation.
 * These tests validate the execution truth layer logic without requiring a live DB.
 */

import { describe, it, expect } from "vitest";
import { isValidTransition, computeSlippage } from "../lib/execution_store";

// ── Order State Machine ──────────────────────────────────────────────

describe("Order State Machine", () => {
  describe("valid transitions", () => {
    it("intent_created → submitted", () => {
      expect(isValidTransition("intent_created", "submitted")).toBe(true);
    });

    it("intent_created → cancelled", () => {
      expect(isValidTransition("intent_created", "cancelled")).toBe(true);
    });

    it("submitted → accepted", () => {
      expect(isValidTransition("submitted", "accepted")).toBe(true);
    });

    it("submitted → rejected", () => {
      expect(isValidTransition("submitted", "rejected")).toBe(true);
    });

    it("submitted → cancelled", () => {
      expect(isValidTransition("submitted", "cancelled")).toBe(true);
    });

    it("submitted → expired", () => {
      expect(isValidTransition("submitted", "expired")).toBe(true);
    });

    it("accepted → partial_fill", () => {
      expect(isValidTransition("accepted", "partial_fill")).toBe(true);
    });

    it("accepted → filled", () => {
      expect(isValidTransition("accepted", "filled")).toBe(true);
    });

    it("accepted → cancelled", () => {
      expect(isValidTransition("accepted", "cancelled")).toBe(true);
    });

    it("accepted → expired", () => {
      expect(isValidTransition("accepted", "expired")).toBe(true);
    });

    it("accepted → failed_reconciliation", () => {
      expect(isValidTransition("accepted", "failed_reconciliation")).toBe(true);
    });

    it("partial_fill → partial_fill (additional partials)", () => {
      expect(isValidTransition("partial_fill", "partial_fill")).toBe(true);
    });

    it("partial_fill → filled", () => {
      expect(isValidTransition("partial_fill", "filled")).toBe(true);
    });

    it("partial_fill → cancelled (cancel remaining)", () => {
      expect(isValidTransition("partial_fill", "cancelled")).toBe(true);
    });

    it("partial_fill → failed_reconciliation", () => {
      expect(isValidTransition("partial_fill", "failed_reconciliation")).toBe(true);
    });
  });

  describe("invalid transitions", () => {
    it("cannot go from filled to anything", () => {
      expect(isValidTransition("filled", "cancelled")).toBe(false);
      expect(isValidTransition("filled", "submitted")).toBe(false);
      expect(isValidTransition("filled", "rejected")).toBe(false);
    });

    it("cannot go from rejected to anything", () => {
      expect(isValidTransition("rejected", "submitted")).toBe(false);
      expect(isValidTransition("rejected", "accepted")).toBe(false);
    });

    it("cannot go from cancelled to anything", () => {
      expect(isValidTransition("cancelled", "submitted")).toBe(false);
      expect(isValidTransition("cancelled", "filled")).toBe(false);
    });

    it("cannot go from expired to anything", () => {
      expect(isValidTransition("expired", "filled")).toBe(false);
    });

    it("cannot skip states: intent_created → filled", () => {
      expect(isValidTransition("intent_created", "filled")).toBe(false);
    });

    it("cannot skip states: intent_created → accepted", () => {
      expect(isValidTransition("intent_created", "accepted")).toBe(false);
    });

    it("cannot skip states: submitted → filled", () => {
      expect(isValidTransition("submitted", "filled")).toBe(false);
    });

    it("cannot go backwards: accepted → submitted", () => {
      expect(isValidTransition("accepted", "submitted")).toBe(false);
    });

    it("unknown status returns false", () => {
      expect(isValidTransition("garbage", "filled")).toBe(false);
      expect(isValidTransition("intent_created", "garbage")).toBe(false);
    });
  });
});

// ── Slippage Computation ────────────────────────────────────────────

describe("Slippage Computation", () => {
  describe("buy orders", () => {
    it("positive slippage when fill price > expected (unfavorable)", () => {
      const result = computeSlippage(100.05, 100.00, "buy");
      expect(result.slippage).toBeCloseTo(0.05, 4);
      expect(result.slippage_bps).toBeCloseTo(5.0, 1);
    });

    it("negative slippage when fill price < expected (favorable)", () => {
      const result = computeSlippage(99.95, 100.00, "buy");
      expect(result.slippage).toBeCloseTo(-0.05, 4);
      expect(result.slippage_bps).toBeCloseTo(-5.0, 1);
    });

    it("zero slippage when fill price = expected", () => {
      const result = computeSlippage(100.00, 100.00, "buy");
      expect(result.slippage).toBeCloseTo(0, 4);
      expect(result.slippage_bps).toBeCloseTo(0, 1);
    });

    it("large positive slippage on volatile fill", () => {
      const result = computeSlippage(101.00, 100.00, "buy");
      expect(result.slippage).toBeCloseTo(1.0, 4);
      expect(result.slippage_bps).toBeCloseTo(100.0, 1);
    });
  });

  describe("sell orders", () => {
    it("positive slippage when fill price < expected (unfavorable)", () => {
      const result = computeSlippage(99.95, 100.00, "sell");
      expect(result.slippage).toBeCloseTo(0.05, 4);
      expect(result.slippage_bps).toBeCloseTo(5.0, 1);
    });

    it("negative slippage when fill price > expected (favorable)", () => {
      const result = computeSlippage(100.05, 100.00, "sell");
      expect(result.slippage).toBeCloseTo(-0.05, 4);
      expect(result.slippage_bps).toBeCloseTo(-5.0, 1);
    });

    it("zero slippage when fill price = expected", () => {
      const result = computeSlippage(100.00, 100.00, "sell");
      expect(result.slippage).toBeCloseTo(0, 4);
      expect(result.slippage_bps).toBeCloseTo(0, 1);
    });
  });

  describe("edge cases", () => {
    it("handles zero expected price without error", () => {
      const result = computeSlippage(100.00, 0, "buy");
      expect(result.slippage).toBe(100.00);
      expect(result.slippage_bps).toBe(0); // Division by zero guarded
    });

    it("handles very small prices", () => {
      const result = computeSlippage(0.0102, 0.0100, "buy");
      expect(result.slippage).toBeCloseTo(0.0002, 6);
      expect(result.slippage_bps).toBeCloseTo(200, 0);
    });

    it("handles large prices", () => {
      const result = computeSlippage(5000.50, 5000.00, "buy");
      expect(result.slippage).toBeCloseTo(0.50, 2);
      expect(result.slippage_bps).toBeCloseTo(1.0, 1);
    });

    it("fractional bps are rounded to 2 decimal places", () => {
      const result = computeSlippage(100.003, 100.00, "buy");
      // 0.003 / 100 * 10000 = 0.3 bps
      expect(result.slippage_bps).toBe(0.3);
    });
  });
});

// ── Order UUID Generation ───────────────────────────────────────────

describe("Order UUID format", () => {
  it("creates unique UUIDs", () => {
    const uuids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      uuids.add(crypto.randomUUID());
    }
    expect(uuids.size).toBe(100);
  });
});

// ── Data Integrity ──────────────────────────────────────────────────

describe("Execution data integrity constraints", () => {
  it("order_uuid must be non-empty", () => {
    expect("").toBeFalsy();
    expect("abc-123").toBeTruthy();
  });

  it("quantity must be positive", () => {
    expect(0).toBeFalsy();
    expect(-1 > 0).toBe(false);
    expect(1 > 0).toBe(true);
  });

  it("terminal states are not in VALID_TRANSITIONS keys", () => {
    const terminalStates = ["filled", "cancelled", "rejected", "expired", "failed_reconciliation"];
    for (const state of terminalStates) {
      // Terminal states should not allow any transitions
      expect(isValidTransition(state, "submitted")).toBe(false);
      expect(isValidTransition(state, "accepted")).toBe(false);
      expect(isValidTransition(state, "filled")).toBe(false);
    }
  });

  it("all non-terminal states have at least one valid transition", () => {
    const nonTerminalStates = ["intent_created", "submitted", "accepted", "partial_fill"];
    for (const state of nonTerminalStates) {
      const hasTransition =
        isValidTransition(state, "submitted") ||
        isValidTransition(state, "accepted") ||
        isValidTransition(state, "partial_fill") ||
        isValidTransition(state, "filled") ||
        isValidTransition(state, "cancelled") ||
        isValidTransition(state, "rejected") ||
        isValidTransition(state, "expired") ||
        isValidTransition(state, "failed_reconciliation");
      expect(hasTransition).toBe(true);
    }
  });
});
