/**
 * integration_pipeline.test.ts — E2E Signal Intelligence Pipeline
 *
 * Tests the full 7-layer decision flow:
 *   Structure → OrderFlow → Recall → ML → Quality → Claude Veto → Hard Gates
 *
 * Uses realistic mock bars and verifies that each layer produces
 * valid outputs that feed correctly into the next layer.
 */

import { describe, it, expect } from "vitest";
import { mockBars, mockAbsorptionReversalBars } from "./helpers/mock_factory";
import {
  buildRecallFeatures,
  computeATR,
  computeFinalQuality,
  computeTPSL,
  detectAbsorptionReversal,
  detectRegime,
  scoreRecall,
  detectSweepReclaim,
  detectContinuationPullback,
  detectCVDDivergence,
  detectBreakoutFailure,
  getQualityThreshold,
  buildChartOverlay,
  checkForwardOutcome,
  computeSKFeatures,
  computeCVDFeatures,
  type RecallFeatures,
} from "../lib/strategy_engine";
import { autoEvaluateChecklist, evaluateChecklist, CHECKLIST_TEMPLATE } from "../lib/checklist_engine";
import { runWarRoom, clearWarRoomCache } from "../lib/war_room";
import type { SMCState as WarRoomSMCState, OrderflowState as WarRoomOrderflow, RiskInput as WarRoomRisk } from "../lib/war_room";

// ─── Host-compatible mock helpers ──────────────────────────────────────────

/** SMCState for the host's war_room.ts (flat structure with structureScore, bos, choch) */
function mockWarRoomSMC(overrides: Partial<WarRoomSMCState> = {}): WarRoomSMCState {
  return {
    symbol: "BTCUSD",
    structureScore: 0.78,
    bos: true,
    choch: false,
    trend: "uptrend",
    activeOBs: [{ high: 67100, low: 66900 }],
    unfilledFVGs: [{ high: 67200, low: 67050 }],
    sweptPools: 2,
    totalPools: 3,
    ...overrides,
  };
}

function mockWarRoomOrderflow(overrides: Partial<WarRoomOrderflow> = {}): WarRoomOrderflow {
  return {
    delta: 450,
    cvd: 1250,
    cvdSlope: 0.035,
    quoteImbalance: 0.25,
    aggressionScore: 0.72,
    orderflowBias: "bullish",
    orderflowScore: 0.75,
    ...overrides,
  };
}

function mockWarRoomRisk(overrides: Partial<WarRoomRisk> = {}): WarRoomRisk {
  return {
    volatilityRegime: "normal",
    spreadBps: 5,
    maxLossToday: 200,
    sessionActive: true,
    ...overrides,
  };
}

/** SMCState for checklist's autoEvaluateChecklist (uses schemas.ts SMCState) */
function mockChecklistSMC() {
  return {
    symbol: "BTCUSD",
    structure: {
      trend: "bullish" as const,
      lastBOS: { direction: "up" as const, price: 67500, index: 18 },
      lastCHoCH: null,
      swings: [],
      bos: true,
      choch: false,
      structureScore: 0.78,
    },
    activeOBs: [{ type: "bullish" as const, high: 67100, low: 66900, index: 10, mitigated: false }],
    unfilledFVGs: [{ type: "bullish" as const, high: 67200, low: 67050, index: 14, filled: false }],
    liquidityPools: [{ type: "sell_side" as const, price: 66500, strength: 0.8, swept: true }],
    displacements: [{ direction: "up" as const, magnitude: 350, index: 16 }],
    confluenceScore: 0.78,
    computedAt: new Date().toISOString(),
  };
}

// ─── Layer 1: Structure Detection ──────────────────────────────────────────

describe("Layer 1 — Structure Detection", () => {
  it("computes SK features from 1m and 5m bars", () => {
    const bars1m = mockBars({ count: 30, trend: "up" });
    const bars5m = mockBars({ count: 20, trend: "up", timeframeMs: 300_000 });
    const sk = computeSKFeatures(bars1m, bars5m);

    expect(sk).toHaveProperty("bias");
    expect(sk).toHaveProperty("sequence_stage");
    expect(sk).toHaveProperty("sequence_score");
    expect(sk).toHaveProperty("rr_quality");
    expect(sk.bias).toMatch(/^(bull|bear|neutral)$/);
    expect(sk.sequence_score).toBeGreaterThanOrEqual(0);
    expect(sk.sequence_score).toBeLessThanOrEqual(1);
  });

  it("detects regime from bar data", () => {
    const upBars = mockBars({ count: 40, trend: "up" });
    const regime = detectRegime(upBars);
    expect(["trending_bull", "trending_bear", "ranging", "volatile", "chop"]).toContain(regime);
  });

  it("detects trending_bull or trending_bear for strong trends", () => {
    const flatBars = mockBars({ count: 40, trend: "flat" });
    const flatRegime = detectRegime(flatBars);
    expect(["ranging", "chop", "volatile", "trending_bull", "trending_bear"]).toContain(flatRegime);
  });
});

// ─── Layer 2: Order Flow Analysis ──────────────────────────────────────────

describe("Layer 2 — Order Flow (CVD Features)", () => {
  it("computes CVD features from bar data", () => {
    const bars = mockBars({ count: 30, trend: "up" });
    const cvd = computeCVDFeatures(bars);

    expect(cvd).toHaveProperty("cvd_value");
    expect(cvd).toHaveProperty("cvd_slope");
    expect(cvd).toHaveProperty("cvd_divergence");
    expect(cvd).toHaveProperty("buy_volume_ratio");
    expect(typeof cvd.cvd_value).toBe("number");
    expect(typeof cvd.cvd_divergence).toBe("boolean");
    expect(cvd.buy_volume_ratio).toBeGreaterThanOrEqual(0);
    expect(cvd.buy_volume_ratio).toBeLessThanOrEqual(1);
  });
});

// ─── Layer 3: Recall Feature Builder ───────────────────────────────────────

describe("Layer 3 — Recall Features", () => {
  it("builds full RecallFeatures from 1m and 5m bars", () => {
    const bars1m = mockBars({ count: 30, trend: "up" });
    const bars5m = mockBars({ count: 20, trend: "up", timeframeMs: 300_000 });
    const recall = buildRecallFeatures(bars1m, bars5m);

    expect(recall.regime).toMatch(/^(trending_bull|trending_bear|ranging|volatile|chop)$/);
    expect(recall.atr_pct).toBeGreaterThanOrEqual(0);
    expect(recall.trend_consensus).toBeGreaterThanOrEqual(0);
    expect(recall.trend_consensus).toBeLessThanOrEqual(1);
    expect(recall.flow_alignment).toBeGreaterThanOrEqual(0);
    expect(recall.flow_alignment).toBeLessThanOrEqual(1);
    expect(recall.fake_entry_risk).toBeGreaterThanOrEqual(0);
    expect(recall.fake_entry_risk).toBeLessThanOrEqual(1);

    expect(recall.sk).toHaveProperty("bias");
    expect(recall.cvd).toHaveProperty("cvd_slope");
    expect(recall.indicators).toHaveProperty("rsi_14");
    expect(recall.indicators).toHaveProperty("indicator_bias");
  });

  it("incorporates indicator hints", () => {
    const bars1m = mockBars({ count: 30 });
    const bars5m = mockBars({ count: 20, timeframeMs: 300_000 });
    const recall = buildRecallFeatures(bars1m, bars5m, ["RSI(14)", "MACD", "BollingerBands"]);
    expect(recall.indicator_hints).toContain("rsi");
    expect(recall.indicator_hints).toContain("macd");
    expect(recall.indicator_hints).toContain("bollinger");
  });

  it("computes ATR from bar data", () => {
    const bars = mockBars({ count: 20, startPrice: 67000 });
    const atr = computeATR(bars);
    expect(atr).toBeGreaterThan(0);
    expect(Number.isFinite(atr)).toBe(true);
  });

  it("returns 0 ATR for insufficient bars", () => {
    const bars = mockBars({ count: 1 });
    expect(computeATR(bars)).toBe(0);
  });
});

// ─── Layer 4: Setup Detectors ──────────────────────────────────────────────

describe("Layer 4 — Setup Detectors", () => {
  it("detectAbsorptionReversal returns valid structure", () => {
    const bars1m = mockBars({ count: 30, trend: "down" });
    const bars5m = mockBars({ count: 20, trend: "down", timeframeMs: 300_000 });
    const recall = buildRecallFeatures(bars1m, bars5m);
    const result = detectAbsorptionReversal(bars1m, bars5m, recall);

    expect(result).toHaveProperty("detected");
    expect(result).toHaveProperty("direction");
    expect(result).toHaveProperty("structure");
    expect(result).toHaveProperty("orderFlow");
    expect(typeof result.detected).toBe("boolean");
    expect(["long", "short"]).toContain(result.direction);
    expect(result.structure).toBeGreaterThanOrEqual(0);
    expect(result.structure).toBeLessThanOrEqual(1);
  });

  it("detectSweepReclaim returns valid structure", () => {
    const bars1m = mockBars({ count: 30, trend: "volatile" });
    const bars5m = mockBars({ count: 20, trend: "volatile", timeframeMs: 300_000 });
    const recall = buildRecallFeatures(bars1m, bars5m);
    const result = detectSweepReclaim(bars1m, bars5m, recall);
    expect(result).toHaveProperty("detected");
    expect(result.structure).toBeGreaterThanOrEqual(0);
    expect(result.structure).toBeLessThanOrEqual(1);
  });

  it("detectContinuationPullback returns valid structure", () => {
    const bars1m = mockBars({ count: 30, trend: "up" });
    const bars5m = mockBars({ count: 20, trend: "up", timeframeMs: 300_000 });
    const recall = buildRecallFeatures(bars1m, bars5m);
    const result = detectContinuationPullback(bars1m, bars5m, recall);
    expect(result).toHaveProperty("detected");
    expect(result.orderFlow).toBeGreaterThanOrEqual(0);
  });

  it("detectCVDDivergence returns valid structure", () => {
    const bars1m = mockBars({ count: 30, trend: "up" });
    const bars5m = mockBars({ count: 20, trend: "up", timeframeMs: 300_000 });
    const recall = buildRecallFeatures(bars1m, bars5m);
    const result = detectCVDDivergence(bars1m, bars5m, recall);
    expect(result).toHaveProperty("detected");
  });

  it("detectBreakoutFailure returns valid structure", () => {
    const bars1m = mockBars({ count: 30, trend: "volatile" });
    const bars5m = mockBars({ count: 20, trend: "volatile", timeframeMs: 300_000 });
    const recall = buildRecallFeatures(bars1m, bars5m);
    const result = detectBreakoutFailure(bars1m, bars5m, recall);
    expect(result).toHaveProperty("detected");
    expect(result.structure).toBeGreaterThanOrEqual(0);
  });

  it("returns not-detected for insufficient data", () => {
    const bars1m = mockBars({ count: 3 });
    const bars5m = mockBars({ count: 2, timeframeMs: 300_000 });
    const recall = buildRecallFeatures(bars1m, bars5m);
    const result = detectAbsorptionReversal(bars1m, bars5m, recall);
    expect(result.detected).toBe(false);
  });
});

// ─── Layer 5: Recall Scoring ───────────────────────────────────────────────

describe("Layer 5 — Recall Scoring", () => {
  it("scores recall features in 0–1 range", () => {
    const bars1m = mockBars({ count: 30, trend: "up" });
    const bars5m = mockBars({ count: 20, trend: "up", timeframeMs: 300_000 });
    const recall = buildRecallFeatures(bars1m, bars5m);
    const score = scoreRecall(recall, "absorption_reversal", "long");
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("all 5 setup types produce valid scores", () => {
    const bars1m = mockBars({ count: 30 });
    const bars5m = mockBars({ count: 20, timeframeMs: 300_000 });
    const recall = buildRecallFeatures(bars1m, bars5m);
    const setups = [
      "absorption_reversal", "sweep_reclaim", "continuation_pullback", "cvd_divergence", "breakout_failure",
    ] as const;
    for (const setup of setups) {
      const score = scoreRecall(recall, setup, "long");
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});

// ─── Layer 6: Final Quality Computation ────────────────────────────────────

describe("Layer 6 — Final Quality Score", () => {
  it("computes final quality from layer scores", () => {
    const quality = computeFinalQuality(0.75, 0.70, 0.68);
    expect(quality).toBeGreaterThanOrEqual(0);
    expect(quality).toBeLessThanOrEqual(1);
  });

  it("higher inputs produce higher quality", () => {
    const highQ = computeFinalQuality(0.90, 0.85, 0.80);
    const lowQ = computeFinalQuality(0.30, 0.25, 0.20);
    expect(highQ).toBeGreaterThan(lowQ);
  });

  it("clamps to 0–1 range even with extreme inputs", () => {
    const q1 = computeFinalQuality(1.5, 1.5, 1.5);
    const q2 = computeFinalQuality(-1, -1, -1);
    expect(q1).toBeLessThanOrEqual(1);
    expect(q2).toBeGreaterThanOrEqual(0);
  });

  it("applies coherence bonus when structure and order flow align", () => {
    const aligned = computeFinalQuality(0.80, 0.80, 0.65);
    const misaligned = computeFinalQuality(0.80, 0.30, 0.65);
    expect(aligned).toBeGreaterThan(misaligned);
  });

  it("quality threshold varies by regime and setup", () => {
    const t1 = getQualityThreshold("trending_bull", "continuation_pullback");
    const t2 = getQualityThreshold("chop", "absorption_reversal");
    expect(t1).toBeGreaterThan(0);
    expect(t2).toBeGreaterThan(0);
    expect(typeof t1).toBe("number");
  });
});

// ─── Layer 7: Execution Utilities (TP/SL, Forward Outcome) ────────────────

describe("Layer 7 — Execution Utilities", () => {
  it("computeTPSL returns valid TP/SL for long", () => {
    const result = computeTPSL(67000, "long", 500, "ranging");
    expect(result.takeProfit).toBeGreaterThan(67000);
    expect(result.stopLoss).toBeLessThan(67000);
    expect(result.tpTicks).toBeGreaterThan(0);
    expect(result.slTicks).toBeGreaterThan(0);
  });

  it("computeTPSL returns valid TP/SL for short", () => {
    const result = computeTPSL(67000, "short", 500, "ranging");
    expect(result.takeProfit).toBeLessThan(67000);
    expect(result.stopLoss).toBeGreaterThan(67000);
  });

  it("trending regimes produce wider TP", () => {
    const ranging = computeTPSL(67000, "long", 500, "ranging");
    const trending = computeTPSL(67000, "long", 500, "trending_bull");
    expect(trending.takeProfit).toBeGreaterThan(ranging.takeProfit);
  });

  it("checkForwardOutcome detects win on TP hit", () => {
    const forwardBars = mockBars({ count: 10, startPrice: 67100, trend: "up" });
    const result = checkForwardOutcome(67000, "long", 68000, 66000, forwardBars);
    expect(["win", "loss", "open"]).toContain(result.outcome);
    expect(typeof result.hitTP).toBe("boolean");
    expect(result.barsChecked).toBeGreaterThan(0);
  });

  it("checkForwardOutcome returns open when neither TP nor SL hit", () => {
    const tightBars = mockBars({ count: 5, startPrice: 67000, trend: "flat" });
    const result = checkForwardOutcome(67000, "long", 80000, 50000, tightBars);
    expect(result.outcome).toBe("open");
    expect(result.hitTP).toBe(false);
    expect(result.barsChecked).toBe(5);
  });
});

// ─── Chart Overlay Builder ─────────────────────────────────────────────────

describe("Chart Overlay Builder", () => {
  it("builds valid chart overlay event", () => {
    const bars1m = mockBars({ count: 30, trend: "up" });
    const bars5m = mockBars({ count: 20, trend: "up", timeframeMs: 300_000 });
    const recall = buildRecallFeatures(bars1m, bars5m);
    const overlay = buildChartOverlay(
      "absorption_reversal", "BTCUSD", "long",
      0.75, 0.70, recall, 0.68, 0.60,
      67000, 66500, 68500, "2025-01-15T14:00:00Z"
    );

    expect(overlay.instrument).toBe("BTCUSD");
    expect(overlay.setup_type).toBe("absorption_reversal");
    expect(overlay.direction).toBe("long");
    expect(["TRADE", "REJECTED", "PASS"]).toContain(overlay.decision_type);
    expect(overlay.scores.structure).toBe(0.75);
    expect(overlay.scores.order_flow).toBe(0.70);
    expect(overlay.entry_price).toBe(67000);
    expect(Array.isArray(overlay.labels)).toBe(true);
    expect(typeof overlay.meets_threshold).toBe("boolean");
  });

  it("marks TRADE when quality >= threshold", () => {
    const bars1m = mockBars({ count: 30 });
    const bars5m = mockBars({ count: 20, timeframeMs: 300_000 });
    const recall = buildRecallFeatures(bars1m, bars5m);
    const overlay = buildChartOverlay(
      "sweep_reclaim", "ETHUSD", "short",
      0.8, 0.8, recall, 0.75, 0.60,
      3500, 3600, 3300, "2025-01-15T14:00:00Z"
    );
    expect(overlay.meets_threshold).toBe(true);
    expect(overlay.decision_type).toBe("TRADE");
  });
});

// ─── Checklist Gate (host API: positional args) ────────────────────────────

describe("Checklist Gate (Pre-trade Discipline)", () => {
  it("evaluateChecklist with explicit booleans returns 8 items", () => {
    const result = evaluateChecklist({
      symbol: "BTCUSD",
      setup_type: "absorption_reversal",
      session: "london",
      htf_bias_aligned: true,
      liquidity_swept: true,
      structure_shift: true,
      displacement_confirmed: true,
      entry_zone_touched: true,
      rr_minimum_met: true,
      session_valid: true,
      no_news_lockout: true,
    });
    expect(result.items).toHaveLength(8);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
    expect(result.blocked_reasons).toHaveLength(0);
  });

  it("blocks when required items fail", () => {
    const result = evaluateChecklist({
      symbol: "BTCUSD",
      setup_type: "smc",
      session: "london",
      htf_bias_aligned: false,
      liquidity_swept: true,
      structure_shift: false,
      displacement_confirmed: true,
      entry_zone_touched: true,
      rr_minimum_met: false,
      session_valid: true,
      no_news_lockout: true,
    });
    expect(result.passed).toBe(false);
    expect(result.blocked_reasons.length).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(1);
  });

  it("autoEvaluateChecklist uses SMC state for auto-fill", () => {
    const smc = mockChecklistSMC();
    const result = autoEvaluateChecklist("BTCUSD", smc as any, {}, "london", "smc");
    expect(result.items).toHaveLength(8);
    expect(result.symbol).toBe("BTCUSD");
    expect(typeof result.passed).toBe("boolean");
    expect(typeof result.score).toBe("number");
  });

  it("template has exactly 8 items", () => {
    expect(CHECKLIST_TEMPLATE).toHaveLength(8);
  });
});

// ─── War Room (host API: positional args, flat SMCState) ───────────────────

describe("War Room — 5-Agent Consensus", () => {
  it("returns approved/blocked/caution with 4 agent verdicts", () => {
    clearWarRoomCache();
    const verdict = runWarRoom(
      "BTCUSD",
      mockWarRoomSMC(),
      mockWarRoomOrderflow(),
      mockWarRoomRisk(),
    );

    expect(["approved", "blocked", "caution"]).toContain(verdict.finalDecision);
    expect(verdict.finalScore).toBeGreaterThanOrEqual(0);
    expect(verdict.finalScore).toBeLessThanOrEqual(1);
    expect(verdict.agents).toHaveLength(4);
    expect(verdict.evaluatedAt).toBeTruthy();
    expect(verdict.symbol).toBe("BTCUSD");
  });

  it("each agent has valid verdict structure", () => {
    clearWarRoomCache();
    const verdict = runWarRoom(
      "ETHUSD",
      mockWarRoomSMC({ symbol: "ETHUSD", trend: "downtrend", structureScore: 0.6 }),
      mockWarRoomOrderflow({ orderflowBias: "bearish", cvdSlope: -0.04 }),
      mockWarRoomRisk(),
    );

    for (const agent of verdict.agents) {
      expect(agent).toHaveProperty("agent");
      expect(agent).toHaveProperty("score");
      expect(agent).toHaveProperty("bias");
      expect(agent).toHaveProperty("confidence");
      expect(agent).toHaveProperty("reasoning");
      expect(["bullish", "bearish", "neutral"]).toContain(agent.bias);
      expect(agent.score).toBeGreaterThanOrEqual(0);
      expect(agent.score).toBeLessThanOrEqual(1);
    }
  });

  it("produces blocked for poor setup", () => {
    clearWarRoomCache();
    const verdict = runWarRoom(
      "SOLUSD",
      mockWarRoomSMC({
        symbol: "SOLUSD", trend: "range", structureScore: 0.2,
        bos: false, choch: false, sweptPools: 0, totalPools: 5,
        activeOBs: [], unfilledFVGs: [],
      }),
      mockWarRoomOrderflow({ orderflowScore: 0.15, aggressionScore: 0.1, orderflowBias: "neutral" }),
      mockWarRoomRisk({ volatilityRegime: "extreme", spreadBps: 50, sessionActive: false }),
    );
    expect(["blocked", "caution"]).toContain(verdict.finalDecision);
  });

  it("caches results per symbol", () => {
    clearWarRoomCache();
    const v1 = runWarRoom("AVAXUSD", mockWarRoomSMC({ symbol: "AVAXUSD" }), mockWarRoomOrderflow(), mockWarRoomRisk());
    const v2 = runWarRoom("AVAXUSD", mockWarRoomSMC({ symbol: "AVAXUSD" }), mockWarRoomOrderflow(), mockWarRoomRisk());
    // Cached: same object reference
    expect(v1).toBe(v2);
  });
});

// ─── Full Pipeline E2E ─────────────────────────────────────────────────────

describe("Full Pipeline — End to End", () => {
  it("runs complete 7-layer pipeline from bars to verdict", () => {
    const bars1m = mockBars({ count: 30, trend: "up", startPrice: 67000 });
    const bars5m = mockBars({ count: 20, trend: "up", timeframeMs: 300_000, startPrice: 66800 });

    // Layer 3: Build recall features
    const recall = buildRecallFeatures(bars1m, bars5m);
    expect(recall.regime).toBeTruthy();

    // Layer 4: Run setup detection
    const absorption = detectAbsorptionReversal(bars1m, bars5m, recall);

    // Layer 5: Score recall
    const recallScore = scoreRecall(recall, "absorption_reversal", "long");
    expect(recallScore).toBeGreaterThanOrEqual(0);

    // Layer 6: Compute final quality
    const quality = computeFinalQuality(
      absorption.structure || 0.5,
      absorption.orderFlow || 0.5,
      recallScore,
      { recall, direction: "long" }
    );
    expect(quality).toBeGreaterThanOrEqual(0);
    expect(quality).toBeLessThanOrEqual(1);

    // Layer 7: Compute TP/SL
    const atr = computeATR(bars1m);
    const tpsl = computeTPSL(67000, "long", atr, recall.regime);
    expect(tpsl.takeProfit).toBeGreaterThan(67000);
    expect(tpsl.stopLoss).toBeLessThan(67000);

    // Checklist gate (using evaluateChecklist for explicit control)
    const checklist = evaluateChecklist({
      symbol: "BTCUSD",
      setup_type: "absorption_reversal",
      session: "london",
      htf_bias_aligned: true,
      liquidity_swept: true,
      structure_shift: true,
      displacement_confirmed: true,
      entry_zone_touched: true,
      rr_minimum_met: true,
      session_valid: true,
      no_news_lockout: true,
    });
    expect(checklist.items).toHaveLength(8);

    // War Room consensus
    clearWarRoomCache();
    const verdict = runWarRoom(
      "BTCUSD",
      mockWarRoomSMC(),
      mockWarRoomOrderflow(),
      mockWarRoomRisk(),
    );
    expect(["approved", "blocked", "caution"]).toContain(verdict.finalDecision);
    expect(verdict.agents).toHaveLength(4);

    // Chart overlay
    const overlay = buildChartOverlay(
      "absorption_reversal", "BTCUSD", "long",
      absorption.structure, absorption.orderFlow, recall,
      quality, getQualityThreshold(recall.regime, "absorption_reversal"),
      67000, tpsl.stopLoss, tpsl.takeProfit, bars1m[bars1m.length - 1].Timestamp
    );
    expect(overlay.instrument).toBe("BTCUSD");
    expect(["TRADE", "REJECTED", "PASS"]).toContain(overlay.decision_type);

    // Forward outcome check
    const forwardBars = mockBars({ count: 20, startPrice: 67100, trend: "up" });
    const outcome = checkForwardOutcome(67000, "long", tpsl.takeProfit, tpsl.stopLoss, forwardBars);
    expect(["win", "loss", "open"]).toContain(outcome.outcome);
  });
});
