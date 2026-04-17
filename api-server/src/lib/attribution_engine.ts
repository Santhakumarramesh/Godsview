/**
 * attribution_engine.ts — Per-Gate PnL Attribution + Win-Rate Analysis
 *
 * Answers the core question of the YoungTraderWealth feedback loop:
 *   "Did the macro bias gate / sentiment gate / other filters actually
 *    improve trading outcomes, or did they block profitable setups?"
 *
 * Attribution model:
 *   For every BLOCKED entry with a known outcome (we track what the price did
 *   after the block), compute:
 *     - "Saved": block prevented a loss (price moved against intended direction)
 *     - "Missed": block prevented a win (price moved in intended direction)
 *
 *   For every PASSED entry:
 *     - Track actual win/loss rate segmented by macro conviction + crowding level
 *
 * Key outputs:
 *   - Per-gate attribution table: { gate, blocks, saves, misses, saveRate, netEdge }
 *   - Performance delta: passed trades with macro tailwind vs headwind
 *   - Crowding filter effectiveness: trades aligned vs against institutional edge
 *   - Overall: would we have been better off without each gate?
 */

import type { TradeJournalEntry, JournalDecision } from "./trade_journal";
import { listJournalEntries } from "./trade_journal";
import type { NoTradeReason } from "./strategy_engine";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GateAttribution {
  /** Which gate / block reason */
  gate: string;
  /** Total times this gate fired */
  blocks: number;
  /** Blocks that saved from a loss (the trade would have lost) */
  saves: number;
  /** Blocks that caused a missed win (the trade would have won) */
  misses: number;
  /** Saves / (saves + misses) — 0.5 = random, >0.5 = gate is adding value */
  saveRate: number;
  /**
   * Net edge score: saveRate - 0.5 normalised.
   * Positive = gate is helpful (blocking more losers than winners).
   * Negative = gate is hurting (blocking more winners than losers).
   */
  netEdge: number;
  /** Average PnL% of the setups that were blocked (if outcome known) */
  avgBlockedPnlPct: number;
}

export interface MacroConvictionPerformance {
  conviction: string;
  direction:  string;
  trades:     number;
  wins:       number;
  losses:     number;
  winRate:    number;
  avgPnlPct:  number;
}

export interface SentimentPerformance {
  crowdingLevel:    string;
  institutionalEdge: string;
  aligned:          boolean;   // was the trade aligned with institutional edge (contrarian)?
  trades:           number;
  wins:             number;
  winRate:          number;
  avgPnlPct:        number;
}

export interface AttributionReport {
  /** ISO timestamp of report generation */
  generatedAt: string;
  /** Total entries analysed */
  totalEntries: number;
  /** Entries with resolved outcome */
  resolvedEntries: number;
  /** Per-gate attribution */
  gateAttribution: GateAttribution[];
  /** Performance segmented by macro conviction */
  macroConvictionPerformance: MacroConvictionPerformance[];
  /** Performance segmented by sentiment crowding */
  sentimentPerformance: SentimentPerformance[];
  /** Overall: passed trade win rate */
  passedWinRate: number;
  /** Overall: blocked trade "would-have-won" rate (misses / total blocks with outcome) */
  blockedMissRate: number;
  /**
   * Layer effectiveness summary.
   * For each layer: did it help more than it hurt?
   */
  layerSummary: Array<{
    layer: string;
    verdict: "helping" | "hurting" | "neutral" | "insufficient_data";
    detail: string;
  }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ALL_GATES: NoTradeReason[] = [
  "macro_bias_block",
  "sentiment_crowding_block",
  "chop_regime",
  "news_lockout",
  "setup_cooldown",
  "conflicting_flow",
  "sk_zone_miss",
  "sk_bias_conflict",
  "cvd_not_ready",
  "low_volatility",
  "high_volatility_extreme",
  "bad_session",
];

function avgPnl(entries: TradeJournalEntry[]): number {
  const resolved = entries.filter(e => e.pnlPct !== null);
  if (resolved.length === 0) return 0;
  return resolved.reduce((s, e) => s + (e.pnlPct ?? 0), 0) / resolved.length;
}

function winRate(entries: TradeJournalEntry[]): number {
  const resolved = entries.filter(e => e.outcome !== "unknown");
  if (resolved.length === 0) return 0;
  return resolved.filter(e => e.outcome === "win").length / resolved.length;
}

// ─── Gate attribution ─────────────────────────────────────────────────────────

function computeGateAttribution(entries: TradeJournalEntry[]): GateAttribution[] {
  const result: GateAttribution[] = [];

  for (const gate of ALL_GATES) {
    const gateEntries = entries.filter(e => e.decision === "blocked" && e.blockReason === gate);
    if (gateEntries.length === 0) continue;

    const resolved = gateEntries.filter(e => e.outcome !== "unknown");
    // A "save" = the block prevented a LOSS (outcome is "loss" for the setup that was blocked)
    // This means: if the trade HAD been taken it would have lost → the block saved us
    const saves  = resolved.filter(e => e.outcome === "loss").length;
    const misses = resolved.filter(e => e.outcome === "win").length;
    const saveRate = (saves + misses) > 0 ? saves / (saves + misses) : 0.5;

    result.push({
      gate,
      blocks: gateEntries.length,
      saves,
      misses,
      saveRate,
      netEdge: saveRate - 0.5,
      avgBlockedPnlPct: avgPnl(resolved),
    });
  }

  // Sort by number of blocks descending
  return result.sort((a, b) => b.blocks - a.blocks);
}

// ─── Macro conviction performance ─────────────────────────────────────────────

function computeMacroPerformance(entries: TradeJournalEntry[]): MacroConvictionPerformance[] {
  const passed = entries.filter(e => e.decision === "passed");
  const groups = new Map<string, TradeJournalEntry[]>();

  for (const e of passed) {
    const key = `${e.macroBias.conviction}|${e.macroBias.direction}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  return [...groups.entries()].map(([key, grp]) => {
    const [conviction, direction] = key.split("|");
    const resolved = grp.filter(e => e.outcome !== "unknown");
    const wins = resolved.filter(e => e.outcome === "win").length;
    return {
      conviction: conviction ?? "unknown",
      direction:  direction  ?? "unknown",
      trades:     grp.length,
      wins,
      losses:     resolved.filter(e => e.outcome === "loss").length,
      winRate:    resolved.length > 0 ? wins / resolved.length : 0,
      avgPnlPct:  avgPnl(resolved),
    };
  }).sort((a, b) => b.trades - a.trades);
}

// ─── Sentiment performance ────────────────────────────────────────────────────

function computeSentimentPerformance(entries: TradeJournalEntry[]): SentimentPerformance[] {
  const passed = entries.filter(e => e.decision === "passed");
  const groups = new Map<string, TradeJournalEntry[]>();

  for (const e of passed) {
    const key = `${e.sentiment.crowdingLevel}|${e.sentiment.institutionalEdge}|${e.sentiment.aligned}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  return [...groups.entries()].map(([key, grp]) => {
    const [crowding, edge, alignedStr] = key.split("|");
    const resolved = grp.filter(e => e.outcome !== "unknown");
    const wins = resolved.filter(e => e.outcome === "win").length;
    return {
      crowdingLevel:     crowding    ?? "unknown",
      institutionalEdge: edge        ?? "none",
      aligned:           alignedStr  === "true",
      trades:            grp.length,
      wins,
      winRate:           resolved.length > 0 ? wins / resolved.length : 0,
      avgPnlPct:         avgPnl(resolved),
    };
  }).sort((a, b) => b.trades - a.trades);
}

// ─── Layer summary ────────────────────────────────────────────────────────────

function buildLayerSummary(
  gateAttrib: GateAttribution[],
  macroPerf:  MacroConvictionPerformance[],
  sentPerf:   SentimentPerformance[],
): AttributionReport["layerSummary"] {
  const summary: AttributionReport["layerSummary"] = [];

  // Layer 0: Macro Bias
  const macroBiasGate = gateAttrib.find(g => g.gate === "macro_bias_block");
  if (macroBiasGate) {
    const verdict = macroBiasGate.saves + macroBiasGate.misses < 5
      ? "insufficient_data"
      : macroBiasGate.netEdge > 0.1  ? "helping"
      : macroBiasGate.netEdge < -0.1 ? "hurting"
      : "neutral";
    summary.push({
      layer: "Layer 0 — Macro Bias",
      verdict,
      detail: `Blocked ${macroBiasGate.blocks} trades. Save rate: ${(macroBiasGate.saveRate * 100).toFixed(0)}% (${macroBiasGate.saves} saves, ${macroBiasGate.misses} misses).`,
    });
  }

  // Layer 0.5: Sentiment
  const sentimentGate = gateAttrib.find(g => g.gate === "sentiment_crowding_block");
  if (sentimentGate) {
    const verdict = sentimentGate.saves + sentimentGate.misses < 5
      ? "insufficient_data"
      : sentimentGate.netEdge > 0.1  ? "helping"
      : sentimentGate.netEdge < -0.1 ? "hurting"
      : "neutral";
    summary.push({
      layer: "Layer 0.5 — Retail Sentiment",
      verdict,
      detail: `Blocked ${sentimentGate.blocks} trades. Save rate: ${(sentimentGate.saveRate * 100).toFixed(0)}% (${sentimentGate.saves} saves, ${sentimentGate.misses} misses).`,
    });
  }

  // Layer macro tailwind: do high-conviction tailwind trades perform better?
  const tailwindGroup = macroPerf.filter(m => m.conviction === "high" && m.direction !== "flat");
  if (tailwindGroup.length > 0) {
    const avgWR = tailwindGroup.reduce((s, g) => s + g.winRate * g.trades, 0) /
                  Math.max(1, tailwindGroup.reduce((s, g) => s + g.trades, 0));
    const verdict = tailwindGroup.reduce((s, g) => s + g.trades, 0) < 5
      ? "insufficient_data"
      : avgWR > 0.6 ? "helping" : avgWR < 0.45 ? "neutral" : "neutral";
    summary.push({
      layer: "Layer 0 — Macro Tailwind Alignment",
      verdict,
      detail: `High-conviction aligned trades avg win rate: ${(avgWR * 100).toFixed(0)}%.`,
    });
  }

  // Layer sentiment contrarian: do contrarian (institutional) trades win more?
  const contrarianGroup = sentPerf.filter(s => s.aligned && s.institutionalEdge !== "none");
  if (contrarianGroup.length > 0) {
    const avgWR = contrarianGroup.reduce((s, g) => s + g.winRate * g.trades, 0) /
                  Math.max(1, contrarianGroup.reduce((s, g) => s + g.trades, 0));
    const verdict = contrarianGroup.reduce((s, g) => s + g.trades, 0) < 5
      ? "insufficient_data"
      : avgWR > 0.6 ? "helping" : "neutral";
    summary.push({
      layer: "Layer 0.5 — Contrarian (Institutional) Edge",
      verdict,
      detail: `Contrarian institutional-edge trades avg win rate: ${(avgWR * 100).toFixed(0)}%.`,
    });
  }

  return summary;
}

// ─── Main report builder ──────────────────────────────────────────────────────

/**
 * Generate a full attribution report from all (or filtered) journal entries.
 */
export function generateAttributionReport(opts: {
  symbol?: string;
  from?:   string;
  to?:     string;
} = {}): AttributionReport {
  const entries = listJournalEntries({
    symbol: opts.symbol,
    from:   opts.from,
    to:     opts.to,
    limit:  10_000,
  });

  const resolved  = entries.filter(e => e.outcome !== "unknown");
  const passed    = entries.filter(e => e.decision === "passed");
  const blocked   = entries.filter(e => e.decision === "blocked");

  const passedResolved = passed.filter(e => e.outcome !== "unknown");
  const blockedResolved = blocked.filter(e => e.outcome !== "unknown");

  const gateAttrib     = computeGateAttribution(entries);
  const macroPerf      = computeMacroPerformance(entries);
  const sentimentPerf  = computeSentimentPerformance(entries);
  const layerSummary   = buildLayerSummary(gateAttrib, macroPerf, sentimentPerf);

  // Blocked miss rate: what fraction of blocked trades would have won?
  const blockedMissRate = blockedResolved.length > 0
    ? blockedResolved.filter(e => e.outcome === "win").length / blockedResolved.length
    : 0;

  return {
    generatedAt:      new Date().toISOString(),
    totalEntries:     entries.length,
    resolvedEntries:  resolved.length,
    gateAttribution:  gateAttrib,
    macroConvictionPerformance: macroPerf,
    sentimentPerformance:       sentimentPerf,
    passedWinRate:    winRate(passedResolved),
    blockedMissRate,
    layerSummary,
  };
}

/**
 * Quick gate effectiveness check — returns just the save rates for the two
 * YoungTraderWealth gates. Used for dashboard summary cards.
 */
export function getYtwGateSummary(): {
  macroBiasGate:    Omit<GateAttribution, "avgBlockedPnlPct"> | null;
  sentimentGate:    Omit<GateAttribution, "avgBlockedPnlPct"> | null;
} {
  const report = generateAttributionReport();
  const find = (gate: string) => report.gateAttribution.find(g => g.gate === gate) ?? null;
  const mb  = find("macro_bias_block");
  const sg  = find("sentiment_crowding_block");
  return {
    macroBiasGate: mb  ? { ...mb  } : null,
    sentimentGate: sg  ? { ...sg  } : null,
  };
}
