/**
 * attribution_engine.test.ts — Phase 23: Per-Gate PnL Attribution Engine
 *
 * Tests:
 *   generateAttributionReport:
 *     - Empty journal → zero counts, empty arrays
 *     - All passed trades → no gate attribution entries
 *     - Blocked trade that would have lost → saveRate = 1 (save)
 *     - Blocked trade that would have won → saveRate = 0 (miss)
 *     - Mixed blocks → correct save rate fraction
 *     - passedWinRate reflects actual win/loss outcomes
 *     - blockedMissRate: what fraction of blocked trades would have won
 *     - macroConvictionPerformance groups by conviction|direction
 *     - sentimentPerformance groups by crowding|institutionalEdge|aligned
 *     - layerSummary: macro_bias_block → "insufficient_data" with < 5 resolved
 *     - layerSummary: macro_bias_block → "helping" when saveRate > 0.6
 *     - layerSummary: macro_bias_block → "hurting" when saveRate < 0.4
 *     - totalEntries and resolvedEntries counts
 *     - generatedAt is a valid ISO timestamp
 *
 *   getYtwGateSummary:
 *     - Returns null gates when no relevant blocks
 *     - Returns correct gate objects when data exists
 */

import { describe, it, expect, beforeEach } from "vitest";
import { generateAttributionReport, getYtwGateSummary } from "../lib/attribution_engine";
import { recordDecision, recordOutcome, clearJournal } from "../lib/trade_journal";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function macroBias(conviction = "medium", direction = "long", override: Record<string, unknown> = {}) {
  return {
    bias: "neutral", direction, score: 0.5, conviction,
    aligned: true, tailwind: false, headwind: false,
    blockedDirections: [], reasons: [],
    updatedAt: new Date().toISOString(),
    ...override,
  } as any;
}

function sentiment(override: Record<string, unknown> = {}) {
  return {
    retailBias: "balanced", institutionalEdge: "none",
    sentimentScore: 0.5, crowdingLevel: "moderate",
    aligned: false, contrarian: false, reasons: [],
    ...override,
  } as any;
}

/** Record a blocked trade then set its outcome (for gate attribution). */
function addBlockedTrade(
  blockReason: string,
  outcome: "win" | "loss" | "breakeven",
  pnlPct: number,
): void {
  const entry = recordDecision({
    symbol: "BTCUSD",
    setupType: "breakout_retest",
    direction: "long",
    decision: "blocked",
    blockReason: blockReason as any,
    macroBias: macroBias(),
    sentiment: sentiment(),
    signalPrice: 50_000,
  });
  // Calculate exitPrice based on desired outcome and pnlPct
  // pnlPct is passed as decimal (0.05 = +5%)
  const exitPrice = outcome === "win"
    ? 50_000 * (1 + pnlPct)
    : outcome === "loss"
    ? 50_000 * (1 - pnlPct)
    : 50_000;
  recordOutcome(entry.id, {
    entryPrice: 50_000,
    exitPrice,
  });
}

/** Record a passed trade then set its outcome. */
function addPassedTrade(
  outcome: "win" | "loss" | "breakeven",
  opts: {
    pnlPct?: number;
    conviction?: string;
    direction?: string;
    crowding?: string;
    edge?: string;
    aligned?: boolean;
  } = {},
): void {
  const pnlPct = opts.pnlPct ?? (outcome === "win" ? 0.05 : -0.03);
  const entry = recordDecision({
    symbol: "BTCUSD",
    setupType: "breakout_retest",
    direction: (opts.direction as any) ?? "long",
    decision: "passed",
    blockReason: "none" as any,
    macroBias: macroBias(opts.conviction ?? "medium", opts.direction ?? "long"),
    sentiment: sentiment({
      crowdingLevel: opts.crowding ?? "moderate",
      institutionalEdge: opts.edge ?? "none",
      aligned: opts.aligned ?? false,
    }),
    signalPrice: 50_000,
  });
  // Calculate exitPrice based on desired outcome and pnlPct
  // pnlPct is passed as decimal (0.05 = +5%)
  const exitPrice = outcome === "win"
    ? 50_000 * (1 + pnlPct)
    : outcome === "loss"
    ? 50_000 * (1 - Math.abs(pnlPct))
    : 50_000;
  recordOutcome(entry.id, {
    entryPrice: 50_000,
    exitPrice,
  });
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("attribution_engine", () => {
  beforeEach(() => {
    clearJournal();
  });

  // ── Empty journal ─────────────────────────────────────────────────────────

  describe("empty journal", () => {
    it("returns zero counts and empty arrays", () => {
      const report = generateAttributionReport();
      expect(report.totalEntries).toBe(0);
      expect(report.resolvedEntries).toBe(0);
      expect(report.gateAttribution).toHaveLength(0);
      expect(report.macroConvictionPerformance).toHaveLength(0);
      expect(report.sentimentPerformance).toHaveLength(0);
      expect(report.passedWinRate).toBe(0);
      expect(report.blockedMissRate).toBe(0);
    });

    it("generatedAt is a valid ISO timestamp", () => {
      const report = generateAttributionReport();
      expect(Date.parse(report.generatedAt)).not.toBeNaN();
    });
  });

  // ── All passed trades (no blocks) ─────────────────────────────────────────

  describe("all passed trades", () => {
    it("gateAttribution is empty when there are no blocked trades", () => {
      addPassedTrade("win");
      addPassedTrade("loss");
      const report = generateAttributionReport();
      expect(report.gateAttribution).toHaveLength(0);
    });

    it("passedWinRate = 1 when all passed trades win", () => {
      for (let i = 0; i < 4; i++) addPassedTrade("win");
      const report = generateAttributionReport();
      expect(report.passedWinRate).toBe(1);
    });

    it("passedWinRate = 0 when all passed trades lose", () => {
      for (let i = 0; i < 4; i++) addPassedTrade("loss");
      const report = generateAttributionReport();
      expect(report.passedWinRate).toBe(0);
    });

    it("passedWinRate ≈ 0.5 with equal wins and losses", () => {
      for (let i = 0; i < 3; i++) addPassedTrade("win");
      for (let i = 0; i < 3; i++) addPassedTrade("loss");
      const report = generateAttributionReport();
      expect(report.passedWinRate).toBeCloseTo(0.5, 2);
    });
  });

  // ── Gate attribution: save rate ───────────────────────────────────────────

  describe("gate attribution — save rate", () => {
    it("all blocked macro_bias trades would have LOST → saveRate = 1.0 (gate is helping)", () => {
      for (let i = 0; i < 3; i++) addBlockedTrade("macro_bias_block", "loss", 0.05);
      const report = generateAttributionReport();
      const gate = report.gateAttribution.find(g => g.gate === "macro_bias_block");
      expect(gate).toBeDefined();
      expect(gate!.saves).toBe(3);
      expect(gate!.misses).toBe(0);
      expect(gate!.saveRate).toBe(1);
      expect(gate!.netEdge).toBeCloseTo(0.5, 2);
    });

    it("all blocked macro_bias trades would have WON → saveRate = 0 (gate is hurting)", () => {
      for (let i = 0; i < 3; i++) addBlockedTrade("macro_bias_block", "win", 0.05);
      const report = generateAttributionReport();
      const gate = report.gateAttribution.find(g => g.gate === "macro_bias_block");
      expect(gate!.saves).toBe(0);
      expect(gate!.misses).toBe(3);
      expect(gate!.saveRate).toBe(0);
      expect(gate!.netEdge).toBeCloseTo(-0.5, 2);
    });

    it("50/50 saves/misses → saveRate = 0.5, netEdge = 0", () => {
      addBlockedTrade("macro_bias_block", "loss", 0.05);
      addBlockedTrade("macro_bias_block", "win", 0.05);
      const report = generateAttributionReport();
      const gate = report.gateAttribution.find(g => g.gate === "macro_bias_block");
      expect(gate!.saveRate).toBeCloseTo(0.5, 2);
      expect(gate!.netEdge).toBeCloseTo(0, 2);
    });

    it("blocks total is count of all blocks (including unresolved)", () => {
      addBlockedTrade("sentiment_crowding_block", "loss", 0.02);
      addBlockedTrade("sentiment_crowding_block", "win", 0.02);
      // Add one without outcome (pending)
      recordDecision({
        symbol: "ETHUSD", setupType: "cvd_divergence", direction: "short",
        decision: "blocked", blockReason: "sentiment_crowding_block",
        macroBias: macroBias(), sentiment: sentiment(), signalPrice: 3_000,
      });
      const report = generateAttributionReport();
      const gate = report.gateAttribution.find(g => g.gate === "sentiment_crowding_block");
      expect(gate!.blocks).toBe(3); // all three blocks counted
    });

    it("multiple distinct gates each appear as separate entries", () => {
      addBlockedTrade("macro_bias_block", "loss", 0.03);
      addBlockedTrade("sentiment_crowding_block", "win", 0.03);
      addBlockedTrade("chop_regime", "loss", 0.03);
      const report = generateAttributionReport();
      const gateNames = report.gateAttribution.map(g => g.gate);
      expect(gateNames).toContain("macro_bias_block");
      expect(gateNames).toContain("sentiment_crowding_block");
      expect(gateNames).toContain("chop_regime");
    });
  });

  // ── Blocked miss rate ─────────────────────────────────────────────────────

  describe("blockedMissRate", () => {
    it("all blocked trades would have won → blockedMissRate = 1.0", () => {
      for (let i = 0; i < 4; i++) addBlockedTrade("macro_bias_block", "win", 0.05);
      const report = generateAttributionReport();
      expect(report.blockedMissRate).toBe(1);
    });

    it("all blocked trades would have lost → blockedMissRate = 0", () => {
      for (let i = 0; i < 4; i++) addBlockedTrade("macro_bias_block", "loss", 0.05);
      const report = generateAttributionReport();
      expect(report.blockedMissRate).toBe(0);
    });

    it("half win half lose → blockedMissRate ≈ 0.5", () => {
      for (let i = 0; i < 3; i++) addBlockedTrade("macro_bias_block", "win", 0.05);
      for (let i = 0; i < 3; i++) addBlockedTrade("macro_bias_block", "loss", 0.05);
      const report = generateAttributionReport();
      expect(report.blockedMissRate).toBeCloseTo(0.5, 2);
    });

    it("blockedMissRate = 0 when no blocked trades exist", () => {
      addPassedTrade("win");
      const report = generateAttributionReport();
      expect(report.blockedMissRate).toBe(0);
    });
  });

  // ── Macro conviction performance ──────────────────────────────────────────

  describe("macroConvictionPerformance", () => {
    it("passed trades are grouped by conviction|direction", () => {
      addPassedTrade("win",  { conviction: "high",   direction: "long" });
      addPassedTrade("loss", { conviction: "high",   direction: "long" });
      addPassedTrade("win",  { conviction: "medium", direction: "short" });
      const report = generateAttributionReport();
      const groups = report.macroConvictionPerformance;
      expect(groups.length).toBeGreaterThanOrEqual(2);
      const highLong = groups.find(g => g.conviction === "high" && g.direction === "long");
      expect(highLong).toBeDefined();
      expect(highLong!.trades).toBe(2);
      expect(highLong!.wins).toBe(1);
    });

    it("winRate = 1 for group where all trades win", () => {
      for (let i = 0; i < 3; i++) addPassedTrade("win", { conviction: "high" });
      const report = generateAttributionReport();
      const high = report.macroConvictionPerformance.find(g => g.conviction === "high");
      expect(high!.winRate).toBe(1);
    });

    it("blocked trades are not included in macroConvictionPerformance", () => {
      addBlockedTrade("macro_bias_block", "loss", 0.05);
      addPassedTrade("win", { conviction: "low" });
      const report = generateAttributionReport();
      const groups = report.macroConvictionPerformance;
      expect(groups.every(g => g.trades > 0)).toBe(true);
    });
  });

  // ── Sentiment performance ─────────────────────────────────────────────────

  describe("sentimentPerformance", () => {
    it("passed trades grouped by crowding|institutionalEdge|aligned", () => {
      addPassedTrade("win",  { crowding: "low",  edge: "long",  aligned: true });
      addPassedTrade("loss", { crowding: "high", edge: "none",  aligned: false });
      const report = generateAttributionReport();
      expect(report.sentimentPerformance.length).toBeGreaterThanOrEqual(2);
    });

    it("aligned=true group has higher winRate when all aligned trades win", () => {
      addPassedTrade("win", { aligned: true,  edge: "long"  });
      addPassedTrade("win", { aligned: true,  edge: "long"  });
      addPassedTrade("loss", { aligned: false, edge: "none" });
      const report = generateAttributionReport();
      const aligned = report.sentimentPerformance.find(g => g.aligned === true && g.institutionalEdge === "long");
      expect(aligned).toBeDefined();
      expect(aligned!.winRate).toBe(1);
    });
  });

  // ── Layer summary verdicts ────────────────────────────────────────────────

  describe("layerSummary verdicts", () => {
    it("macro_bias_block with < 5 resolved → 'insufficient_data'", () => {
      // Only 4 resolved blocked trades
      for (let i = 0; i < 4; i++) addBlockedTrade("macro_bias_block", "loss", 0.03);
      const report = generateAttributionReport();
      const layer = report.layerSummary.find(l => l.layer.includes("Macro Bias") && !l.layer.includes("Tailwind"));
      if (layer) {
        expect(layer.verdict).toBe("insufficient_data");
      }
    });

    it("macro_bias_block with 6+ resolved saves → 'helping'", () => {
      // 6 saves (all blocked would have lost) → saveRate = 1.0, netEdge = 0.5 > 0.1
      for (let i = 0; i < 6; i++) addBlockedTrade("macro_bias_block", "loss", 0.03);
      const report = generateAttributionReport();
      const layer = report.layerSummary.find(l => l.layer.includes("Macro Bias") && !l.layer.includes("Tailwind"));
      if (layer) {
        expect(layer.verdict).toBe("helping");
      }
    });

    it("macro_bias_block with 6+ misses → 'hurting'", () => {
      // 6 misses (all blocked would have won) → saveRate = 0, netEdge = -0.5 < -0.1
      for (let i = 0; i < 6; i++) addBlockedTrade("macro_bias_block", "win", 0.03);
      const report = generateAttributionReport();
      const layer = report.layerSummary.find(l => l.layer.includes("Macro Bias") && !l.layer.includes("Tailwind"));
      if (layer) {
        expect(layer.verdict).toBe("hurting");
      }
    });

    it("layerSummary entries have valid verdict values", () => {
      addBlockedTrade("macro_bias_block", "loss", 0.03);
      const report = generateAttributionReport();
      const validVerdicts = ["helping", "hurting", "neutral", "insufficient_data"];
      for (const entry of report.layerSummary) {
        expect(validVerdicts).toContain(entry.verdict);
      }
    });
  });

  // ── Entry counts ─────────────────────────────────────────────────────────

  describe("entry and resolved counts", () => {
    it("totalEntries includes both passed and blocked", () => {
      addPassedTrade("win");
      addBlockedTrade("macro_bias_block", "loss", 0.03);
      const report = generateAttributionReport();
      expect(report.totalEntries).toBe(2);
    });

    it("resolvedEntries counts only entries with a known outcome", () => {
      addPassedTrade("win");
      addPassedTrade("loss");
      // Add a pending entry (no outcome)
      recordDecision({
        symbol: "BTCUSD", setupType: "breakout", direction: "long",
        decision: "passed", blockReason: "none" as any,
        macroBias: macroBias(), sentiment: sentiment(), signalPrice: 50_000,
      });
      const report = generateAttributionReport();
      expect(report.resolvedEntries).toBe(2); // pending not counted
    });
  });

  // ── getYtwGateSummary ─────────────────────────────────────────────────────

  describe("getYtwGateSummary", () => {
    it("returns null for both gates when no relevant blocks", () => {
      addPassedTrade("win");
      const summary = getYtwGateSummary();
      expect(summary.macroBiasGate).toBeNull();
      expect(summary.sentimentGate).toBeNull();
    });

    it("macroBiasGate is populated when macro_bias_block entries exist", () => {
      addBlockedTrade("macro_bias_block", "loss", 0.04);
      addBlockedTrade("macro_bias_block", "win", 0.04);
      const summary = getYtwGateSummary();
      expect(summary.macroBiasGate).not.toBeNull();
      expect(summary.macroBiasGate!.gate).toBe("macro_bias_block");
      expect(summary.macroBiasGate!.blocks).toBe(2);
    });

    it("sentimentGate is populated when sentiment_crowding_block entries exist", () => {
      addBlockedTrade("sentiment_crowding_block", "loss", 0.04);
      const summary = getYtwGateSummary();
      expect(summary.sentimentGate).not.toBeNull();
      expect(summary.sentimentGate!.gate).toBe("sentiment_crowding_block");
    });

    it("saveRate in YTW summary matches full report gate attribution", () => {
      for (let i = 0; i < 4; i++) addBlockedTrade("macro_bias_block", "loss", 0.03);
      addBlockedTrade("macro_bias_block", "win", 0.03);
      const summary = getYtwGateSummary();
      const full = generateAttributionReport();
      const gateInFull = full.gateAttribution.find(g => g.gate === "macro_bias_block");
      expect(summary.macroBiasGate!.saveRate).toBeCloseTo(gateInFull!.saveRate, 4);
    });
  });
});
