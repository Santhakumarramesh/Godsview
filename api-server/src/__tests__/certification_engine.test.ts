/**
 * Tests for certification_engine.ts — Gate evaluation, evidence packets, tier requirements.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateBacktestGate,
  evaluateWalkForwardGate,
  evaluateStressGate,
  evaluateShadowGate,
  evaluateAlignmentGate,
  evaluateSlippageGate,
  evaluateExecutionQualityGate,
  buildEvidencePacket,
  TIER_REQUIREMENTS,
  type TargetTier,
} from "../lib/certification_engine";

// ── Backtest Gate ──────────────────────────────────────────────

describe("evaluateBacktestGate", () => {
  const reqs = TIER_REQUIREMENTS.paper_approved;

  it("passes when all criteria met", () => {
    const result = evaluateBacktestGate(reqs, 1.0, 0.60, 100);
    expect(result.passed).toBe(true);
    expect(result.gate).toBe("backtest");
  });

  it("fails when Sharpe too low", () => {
    const result = evaluateBacktestGate(reqs, 0.2, 0.60, 100);
    expect(result.passed).toBe(false);
    expect(result.details).toContain("Sharpe");
  });

  it("fails when win rate too low", () => {
    const result = evaluateBacktestGate(reqs, 1.0, 0.30, 100);
    expect(result.passed).toBe(false);
    expect(result.details).toContain("WR");
  });

  it("fails when trade count too low", () => {
    const result = evaluateBacktestGate(reqs, 1.0, 0.60, 10);
    expect(result.passed).toBe(false);
    expect(result.details).toContain("trades");
  });

  it("fails multiple criteria simultaneously", () => {
    const result = evaluateBacktestGate(reqs, 0.1, 0.20, 5);
    expect(result.passed).toBe(false);
  });

  it("boundary: exactly at minimum values passes", () => {
    const result = evaluateBacktestGate(
      reqs,
      reqs.min_backtest_sharpe,
      reqs.min_backtest_win_rate,
      reqs.min_backtest_trades,
    );
    expect(result.passed).toBe(true);
  });
});

// ── Walk-Forward Gate ──────────────────────────────────────────

describe("evaluateWalkForwardGate", () => {
  it("passes at required rate", () => {
    const result = evaluateWalkForwardGate(TIER_REQUIREMENTS.paper_approved, 0.70);
    expect(result.passed).toBe(true);
  });

  it("fails below required rate", () => {
    const result = evaluateWalkForwardGate(TIER_REQUIREMENTS.paper_approved, 0.40);
    expect(result.passed).toBe(false);
  });

  it("higher tiers need higher pass rates", () => {
    expect(TIER_REQUIREMENTS.autonomous_candidate.min_walkforward_pass_rate)
      .toBeGreaterThan(TIER_REQUIREMENTS.paper_approved.min_walkforward_pass_rate);
  });
});

// ── Stress Test Gate ──────────────────────────────────────────

describe("evaluateStressGate", () => {
  it("passes when survival rate meets threshold", () => {
    const result = evaluateStressGate(TIER_REQUIREMENTS.live_assisted, 0.75);
    expect(result.passed).toBe(true);
  });

  it("fails when survival rate below threshold", () => {
    const result = evaluateStressGate(TIER_REQUIREMENTS.live_assisted, 0.40);
    expect(result.passed).toBe(false);
  });
});

// ── Shadow Gate ────────────────────────────────────────────────

describe("evaluateShadowGate", () => {
  it("auto-passes for paper_approved (no paper requirement)", () => {
    const result = evaluateShadowGate(TIER_REQUIREMENTS.paper_approved, 0, 0, 0);
    expect(result.passed).toBe(true);
  });

  it("passes for live_assisted with sufficient paper evidence", () => {
    const result = evaluateShadowGate(TIER_REQUIREMENTS.live_assisted, 50, 0.55, 100);
    expect(result.passed).toBe(true);
  });

  it("fails for live_assisted with insufficient trades", () => {
    const result = evaluateShadowGate(TIER_REQUIREMENTS.live_assisted, 10, 0.55, 100);
    expect(result.passed).toBe(false);
  });

  it("fails for negative PnL", () => {
    const result = evaluateShadowGate(TIER_REQUIREMENTS.live_assisted, 50, 0.55, -50);
    expect(result.passed).toBe(false);
    expect(result.details).toContain("PnL");
  });
});

// ── Alignment Gate ─────────────────────────────────────────────

describe("evaluateAlignmentGate", () => {
  it("auto-passes for paper_approved (no alignment requirement)", () => {
    const result = evaluateAlignmentGate(TIER_REQUIREMENTS.paper_approved, 0);
    expect(result.passed).toBe(true);
  });

  it("passes for live_assisted with good alignment", () => {
    const result = evaluateAlignmentGate(TIER_REQUIREMENTS.live_assisted, 0.75);
    expect(result.passed).toBe(true);
  });

  it("fails for autonomous with poor alignment", () => {
    const result = evaluateAlignmentGate(TIER_REQUIREMENTS.autonomous_candidate, 0.50);
    expect(result.passed).toBe(false);
  });
});

// ── Slippage Gate ──────────────────────────────────────────────

describe("evaluateSlippageGate", () => {
  it("passes when slippage within bounds", () => {
    const result = evaluateSlippageGate(TIER_REQUIREMENTS.live_assisted, 10);
    expect(result.passed).toBe(true);
  });

  it("fails when slippage too high", () => {
    const result = evaluateSlippageGate(TIER_REQUIREMENTS.live_assisted, 25);
    expect(result.passed).toBe(false);
  });

  it("autonomous has tighter slippage bounds", () => {
    expect(TIER_REQUIREMENTS.autonomous_candidate.max_slippage_bps)
      .toBeLessThan(TIER_REQUIREMENTS.paper_approved.max_slippage_bps);
  });
});

// ── Execution Quality Gate ─────────────────────────────────────

describe("evaluateExecutionQualityGate", () => {
  it("passes with good latency and fill rate", () => {
    const result = evaluateExecutionQualityGate(TIER_REQUIREMENTS.live_assisted, 500, 0.95);
    expect(result.passed).toBe(true);
  });

  it("fails with high latency", () => {
    const result = evaluateExecutionQualityGate(TIER_REQUIREMENTS.live_assisted, 10000, 0.95);
    expect(result.passed).toBe(false);
  });

  it("fails with low fill rate", () => {
    const result = evaluateExecutionQualityGate(TIER_REQUIREMENTS.live_assisted, 500, 0.80);
    expect(result.passed).toBe(false);
  });
});

// ── Evidence Packet ────────────────────────────────────────────

describe("buildEvidencePacket", () => {
  const goodInputs = {
    backtest_sharpe: 1.5,
    backtest_win_rate: 0.60,
    backtest_trade_count: 200,
    walkforward_pass_rate: 0.80,
    stress_survival_rate: 0.75,
    paper_trade_count: 50,
    paper_win_rate: 0.55,
    paper_pnl: 500,
    alignment_score: 0.80,
    avg_slippage_bps: 5,
    avg_latency_ms: 200,
    fill_rate: 0.98,
  };

  it("certifies paper_approved with good inputs", () => {
    const packet = buildEvidencePacket("strat_1", "paper_approved", goodInputs);
    expect(packet.all_gates_passed).toBe(true);
    expect(packet.strategy_id).toBe("strat_1");
    expect(packet.target_tier).toBe("paper_approved");
    expect(packet.gates.length).toBe(7);
    expect(packet.summary).toContain("All 7 gates passed");
  });

  it("certifies live_assisted with good inputs", () => {
    const packet = buildEvidencePacket("strat_2", "live_assisted", goodInputs);
    expect(packet.all_gates_passed).toBe(true);
  });

  it("rejects with poor backtest", () => {
    const packet = buildEvidencePacket("strat_3", "paper_approved", {
      ...goodInputs,
      backtest_sharpe: 0.1,
      backtest_win_rate: 0.30,
    });
    expect(packet.all_gates_passed).toBe(false);
    expect(packet.summary).toContain("Failed");
    expect(packet.summary).toContain("backtest");
  });

  it("rejects autonomous with insufficient paper trades", () => {
    const packet = buildEvidencePacket("strat_4", "autonomous_candidate", {
      ...goodInputs,
      paper_trade_count: 20,  // needs 100
    });
    expect(packet.all_gates_passed).toBe(false);
    const shadowGate = packet.gates.find(g => g.gate === "shadow");
    expect(shadowGate?.passed).toBe(false);
  });

  it("includes all metrics in packet", () => {
    const packet = buildEvidencePacket("strat_5", "paper_approved", goodInputs);
    expect(packet.metrics.backtest_sharpe).toBe(1.5);
    expect(packet.metrics.backtest_win_rate).toBe(0.60);
    expect(packet.metrics.paper_trade_count).toBe(50);
  });

  it("each gate has gate name, passed flag, and details", () => {
    const packet = buildEvidencePacket("strat_6", "paper_approved", goodInputs);
    for (const gate of packet.gates) {
      expect(gate).toHaveProperty("gate");
      expect(gate).toHaveProperty("passed");
      expect(gate).toHaveProperty("details");
      expect(typeof gate.gate).toBe("string");
      expect(typeof gate.passed).toBe("boolean");
      expect(typeof gate.details).toBe("string");
    }
  });
});

// ── Tier Requirements ──────────────────────────────────────────

describe("TIER_REQUIREMENTS", () => {
  const tiers: TargetTier[] = ["paper_approved", "live_assisted", "autonomous_candidate"];

  it("defines requirements for all three tiers", () => {
    for (const tier of tiers) {
      expect(TIER_REQUIREMENTS[tier]).toBeDefined();
    }
  });

  it("requirements get stricter for higher tiers", () => {
    expect(TIER_REQUIREMENTS.autonomous_candidate.min_backtest_sharpe)
      .toBeGreaterThan(TIER_REQUIREMENTS.live_assisted.min_backtest_sharpe);
    expect(TIER_REQUIREMENTS.live_assisted.min_backtest_sharpe)
      .toBeGreaterThan(TIER_REQUIREMENTS.paper_approved.min_backtest_sharpe);
  });

  it("paper trades increase for higher tiers", () => {
    expect(TIER_REQUIREMENTS.autonomous_candidate.min_paper_trades)
      .toBeGreaterThan(TIER_REQUIREMENTS.live_assisted.min_paper_trades);
    expect(TIER_REQUIREMENTS.live_assisted.min_paper_trades)
      .toBeGreaterThan(TIER_REQUIREMENTS.paper_approved.min_paper_trades);
  });

  it("slippage tolerance decreases for higher tiers", () => {
    expect(TIER_REQUIREMENTS.autonomous_candidate.max_slippage_bps)
      .toBeLessThan(TIER_REQUIREMENTS.live_assisted.max_slippage_bps);
    expect(TIER_REQUIREMENTS.live_assisted.max_slippage_bps)
      .toBeLessThan(TIER_REQUIREMENTS.paper_approved.max_slippage_bps);
  });

  it("all numeric values are positive", () => {
    for (const tier of tiers) {
      const reqs = TIER_REQUIREMENTS[tier];
      expect(reqs.min_backtest_sharpe).toBeGreaterThan(0);
      expect(reqs.min_backtest_win_rate).toBeGreaterThan(0);
      expect(reqs.min_backtest_trades).toBeGreaterThan(0);
      expect(reqs.max_slippage_bps).toBeGreaterThan(0);
      expect(reqs.max_execution_latency_ms).toBeGreaterThan(0);
    }
  });
});
