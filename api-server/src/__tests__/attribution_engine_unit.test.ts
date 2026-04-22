/**
 * attribution_engine_unit.test.ts — Phase 61
 *
 * Unit tests for lib/attribution_engine.ts:
 *
 *   generateAttributionReport — full report from journal entries
 *   getYtwGateSummary         — gate summary wrapper
 *
 * Dependencies mocked:
 *   ../lib/trade_journal — listJournalEntries
 */

import { describe, it, expect, vi } from "vitest";

// ── Helpers ───────────────────────────────────────────────────────────────────

const defaultBias  = { conviction: "high", direction: "long" };
const defaultSent  = { crowdingLevel: "low", institutionalEdge: "buy", aligned: true };
const blockedBias  = { conviction: "low",  direction: "flat" };
const blockedSent  = { crowdingLevel: "high", institutionalEdge: "none", aligned: false };

function makeEntry(overrides: Partial<Record<string, unknown>>) {
  return {
    decision:    "passed",
    outcome:     "win",
    pnlPct:      0.02,
    blockReason: null,
    decidedAt:   "2024-01-15T10:00:00.000Z",
    macroBias:   defaultBias,
    sentiment:   defaultSent,
    ...overrides,
  };
}

/** Representative journal with 4 entries: 2 passed (1 win, 1 loss) + 2 blocked (1 miss, 1 save) */
const MOCK_ENTRIES = [
  makeEntry({ decision: "passed",  outcome: "win",  pnlPct:  0.025 }),
  makeEntry({ decision: "passed",  outcome: "loss", pnlPct: -0.010 }),
  makeEntry({
    decision: "blocked", outcome: "win",  pnlPct: 0.015,
    blockReason: "macro_bias_block",
    macroBias: blockedBias, sentiment: blockedSent,
  }),
  makeEntry({
    decision: "blocked", outcome: "loss", pnlPct: -0.020,
    blockReason: "macro_bias_block",
    macroBias: blockedBias, sentiment: blockedSent,
  }),
];

// ── Mock ──────────────────────────────────────────────────────────────────────

vi.mock("../lib/trade_journal", () => ({
  listJournalEntries: vi.fn(() => MOCK_ENTRIES),
}));

// ── Import AFTER mocks ────────────────────────────────────────────────────────
import {
  generateAttributionReport,
  getYtwGateSummary,
} from "../lib/attribution_engine";

// ─────────────────────────────────────────────────────────────────────────────
// generateAttributionReport — shape
// ─────────────────────────────────────────────────────────────────────────────

describe("generateAttributionReport — shape", () => {
  it("returns an object with all required top-level fields", () => {
    const r = generateAttributionReport();
    const fields = [
      "generatedAt", "totalEntries", "resolvedEntries",
      "gateAttribution", "macroConvictionPerformance",
      "sentimentPerformance", "passedWinRate", "blockedMissRate",
      "layerSummary",
    ];
    for (const f of fields) {
      expect(r).toHaveProperty(f);
    }
  });

  it("generatedAt is a valid ISO string", () => {
    const { generatedAt } = generateAttributionReport();
    expect(() => new Date(generatedAt)).not.toThrow();
  });

  it("gateAttribution is an array", () => {
    expect(Array.isArray(generateAttributionReport().gateAttribution)).toBe(true);
  });

  it("macroConvictionPerformance is an array", () => {
    expect(Array.isArray(generateAttributionReport().macroConvictionPerformance)).toBe(true);
  });

  it("layerSummary is an array", () => {
    expect(Array.isArray(generateAttributionReport().layerSummary)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// generateAttributionReport — counts
// ─────────────────────────────────────────────────────────────────────────────

describe("generateAttributionReport — counts", () => {
  it("totalEntries matches mock data length", () => {
    expect(generateAttributionReport().totalEntries).toBe(MOCK_ENTRIES.length);
  });

  it("resolvedEntries counts entries with non-unknown outcome", () => {
    // All 4 mock entries have outcome win or loss (none are unknown)
    expect(generateAttributionReport().resolvedEntries).toBe(4);
  });

  it("passedWinRate is between 0 and 1", () => {
    const { passedWinRate } = generateAttributionReport();
    expect(passedWinRate).toBeGreaterThanOrEqual(0);
    expect(passedWinRate).toBeLessThanOrEqual(1);
  });

  it("passedWinRate is 0.5 for 1 win, 1 loss among passed entries", () => {
    expect(generateAttributionReport().passedWinRate).toBeCloseTo(0.5, 5);
  });

  it("blockedMissRate is between 0 and 1", () => {
    const { blockedMissRate } = generateAttributionReport();
    expect(blockedMissRate).toBeGreaterThanOrEqual(0);
    expect(blockedMissRate).toBeLessThanOrEqual(1);
  });

  it("blockedMissRate is 0.5 for 1 miss, 1 save (macro_bias_block)", () => {
    // 1 blocked-win (miss) out of 2 resolved blocked trades
    expect(generateAttributionReport().blockedMissRate).toBeCloseTo(0.5, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// generateAttributionReport — gate attribution
// ─────────────────────────────────────────────────────────────────────────────

describe("generateAttributionReport — gate attribution", () => {
  it("includes macro_bias_block gate in gateAttribution", () => {
    const { gateAttribution } = generateAttributionReport();
    const gate = gateAttribution.find(g => g.gate === "macro_bias_block");
    expect(gate).toBeDefined();
  });

  it("macro_bias_block has blocks=2", () => {
    const { gateAttribution } = generateAttributionReport();
    const gate = gateAttribution.find(g => g.gate === "macro_bias_block")!;
    expect(gate.blocks).toBe(2);
  });

  it("macro_bias_block saves=1 misses=1", () => {
    const { gateAttribution } = generateAttributionReport();
    const gate = gateAttribution.find(g => g.gate === "macro_bias_block")!;
    expect(gate.saves).toBe(1);
    expect(gate.misses).toBe(1);
  });

  it("macro_bias_block saveRate=0.5", () => {
    const { gateAttribution } = generateAttributionReport();
    const gate = gateAttribution.find(g => g.gate === "macro_bias_block")!;
    expect(gate.saveRate).toBeCloseTo(0.5, 5);
  });

  it("netEdge = saveRate − 0.5", () => {
    const { gateAttribution } = generateAttributionReport();
    for (const g of gateAttribution) {
      expect(g.netEdge).toBeCloseTo(g.saveRate - 0.5, 5);
    }
  });

  it("gate entry has all required fields", () => {
    const { gateAttribution } = generateAttributionReport();
    const gate = gateAttribution[0]!;
    const fields = ["gate", "blocks", "saves", "misses", "saveRate", "netEdge", "avgBlockedPnlPct"];
    for (const f of fields) {
      expect(gate).toHaveProperty(f);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// generateAttributionReport — empty data
// ─────────────────────────────────────────────────────────────────────────────

describe("generateAttributionReport — empty journal", () => {
  it("handles empty journal gracefully", async () => {
    const { listJournalEntries } = await import("../lib/trade_journal") as any;
    listJournalEntries.mockReturnValueOnce([]);

    const r = generateAttributionReport();
    expect(r.totalEntries).toBe(0);
    expect(r.resolvedEntries).toBe(0);
    expect(r.passedWinRate).toBe(0);
    expect(r.blockedMissRate).toBe(0);
    expect(r.gateAttribution).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getYtwGateSummary
// ─────────────────────────────────────────────────────────────────────────────

describe("getYtwGateSummary", () => {
  it("returns macroBiasGate and sentimentGate fields", async () => {
    const { listJournalEntries } = await import("../lib/trade_journal") as any;
    listJournalEntries.mockReturnValueOnce(MOCK_ENTRIES);

    const summary = getYtwGateSummary();
    expect(summary).toHaveProperty("macroBiasGate");
    expect(summary).toHaveProperty("sentimentGate");
  });

  it("macroBiasGate is populated when macro_bias_block entries exist", async () => {
    const { listJournalEntries } = await import("../lib/trade_journal") as any;
    listJournalEntries.mockReturnValueOnce(MOCK_ENTRIES);

    const summary = getYtwGateSummary();
    expect(summary.macroBiasGate).not.toBeNull();
    expect(summary.macroBiasGate?.gate).toBe("macro_bias_block");
  });

  it("sentimentGate is null when no sentiment_crowding_block entries exist", async () => {
    const { listJournalEntries } = await import("../lib/trade_journal") as any;
    listJournalEntries.mockReturnValueOnce(MOCK_ENTRIES);

    const summary = getYtwGateSummary();
    // MOCK_ENTRIES has no sentiment_crowding_block → null
    expect(summary.sentimentGate).toBeNull();
  });
});
