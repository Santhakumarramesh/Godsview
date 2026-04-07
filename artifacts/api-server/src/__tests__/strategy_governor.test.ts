/**
 * Strategy Governor Tests — Policy-driven lifecycle governance.
 */
import { describe, it, expect } from "vitest";
import { StrategyGovernor } from "../lib/governance/strategy_governor";

describe("StrategyGovernor", () => {
  const governor = new StrategyGovernor();

  describe("evaluatePromotion", () => {
    it("allows draft→parsed with no evidence required", () => {
      const result = governor.evaluatePromotion("draft", "parsed", {});
      expect(result.allowed).toBe(true);
      expect(result.missingEvidence).toHaveLength(0);
    });

    it("blocks parsed→backtested without sufficient evidence", () => {
      const result = governor.evaluatePromotion("parsed", "backtested", {});
      expect(result.allowed).toBe(false);
      expect(result.missingEvidence.length).toBeGreaterThan(0);
    });

    it("allows parsed→backtested with good evidence", () => {
      const result = governor.evaluatePromotion("parsed", "backtested", {
        backtestSharpe: 1.5,
        backtestWinRate: 0.58,
        backtestSampleSize: 300,
        backtestMaxDrawdown: -0.15,
      });
      expect(result.allowed).toBe(true);
      expect(result.missingEvidence).toHaveLength(0);
    });

    it("blocks backtested→stress_tested with poor OOS performance", () => {
      const result = governor.evaluatePromotion("backtested", "stress_tested", {
        walkForwardOosSharpe: 0.1,
        walkForwardOosWinRate: 0.25,
        walkForwardDegradation: 0.40,
      });
      expect(result.allowed).toBe(false);
      expect(result.missingEvidence.length).toBeGreaterThan(0);
    });

    it("requires operator approval for paper→live_assisted", () => {
      const result = governor.evaluatePromotion("paper_approved", "live_assisted_approved", {
        paperWinRate: 0.55,
        paperSampleSize: 100,
        paperDurationDays: 21,
        calibrationDrift: 0.05,
        operatorApproved: true,
      });
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(true);
    });

    it("allows safety demotions without evidence", () => {
      const result = governor.evaluatePromotion("paper_approved", "paused", {});
      expect(result.allowed).toBe(true);
    });

    it("allows retirement transition", () => {
      const result = governor.evaluatePromotion("live_assisted_approved", "retired", {});
      expect(result.allowed).toBe(true);
    });

    it("blocks undefined promotion paths", () => {
      const result = governor.evaluatePromotion("draft", "autonomous_approved", {});
      expect(result.allowed).toBe(false);
    });

    it("allows demotion (backward movement)", () => {
      const result = governor.evaluatePromotion("stress_tested", "parsed", {});
      expect(result.allowed).toBe(true);
    });
  });

  describe("evaluateRetirement", () => {
    it("suggests retirement for stale strategy", () => {
      const result = governor.evaluateRetirement({
        calibrationDrift: 0.05,
        recentWinRate: 0.50,
        daysSinceLastTrade: 100,
        consecutiveLosses: 2,
        maxDrawdown: -0.10,
      });
      expect(result.shouldRetire).toBe(true);
      expect(result.severity).toBe("suggestion");
    });

    it("forces retirement on critical drift", () => {
      const result = governor.evaluateRetirement({
        calibrationDrift: 0.30,
        recentWinRate: 0.35,
        daysSinceLastTrade: 5,
        consecutiveLosses: 3,
        maxDrawdown: -0.15,
      });
      expect(result.shouldRetire).toBe(true);
      expect(result.severity).toBe("forced");
    });

    it("forces retirement on consecutive losses", () => {
      const result = governor.evaluateRetirement({
        calibrationDrift: 0.02,
        recentWinRate: 0.30,
        daysSinceLastTrade: 1,
        consecutiveLosses: 12,
        maxDrawdown: -0.20,
      });
      expect(result.shouldRetire).toBe(true);
      expect(result.severity).toBe("forced");
    });

    it("does not retire healthy strategy", () => {
      const result = governor.evaluateRetirement({
        calibrationDrift: 0.02,
        recentWinRate: 0.55,
        daysSinceLastTrade: 1,
        consecutiveLosses: 1,
        maxDrawdown: -0.08,
      });
      expect(result.shouldRetire).toBe(false);
    });
  });

  describe("getValidTransitions", () => {
    it("returns valid transitions from draft", () => {
      const transitions = governor.getValidTransitions("draft");
      expect(transitions.some(t => t.to === "parsed")).toBe(true);
      expect(transitions.some(t => t.to === "paused")).toBe(true);
    });

    it("includes safety transitions for any status", () => {
      const transitions = governor.getValidTransitions("backtested");
      expect(transitions.some(t => t.to === "paused")).toBe(true);
      expect(transitions.some(t => t.to === "degraded")).toBe(true);
      expect(transitions.some(t => t.to === "retired")).toBe(true);
    });
  });

  describe("getEvidenceTemplate", () => {
    it("returns required evidence for parsed→backtested", () => {
      const template = governor.getEvidenceTemplate("parsed", "backtested");
      expect(template.length).toBeGreaterThan(0);
      expect(template.some(r => r.field === "backtestSharpe")).toBe(true);
    });

    it("returns empty for unknown transition", () => {
      const template = governor.getEvidenceTemplate("draft", "autonomous_approved");
      expect(template).toHaveLength(0);
    });
  });
});
