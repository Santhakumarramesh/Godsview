/**
 * historical_replay.ts — Historical Bar Replay Engine
 *
 * Processes a sequence of historical OHLCV bars through the full
 * GodsView analysis pipeline in chronological order:
 *
 *   1. Bar-grammar labeling     (HH/HL/LH/LL, BOS, CHoCH)
 *   2. SMC state computation    (swing detection, OBs, FVGs, displacement)
 *   3. Setup identification     (aligned grammar + SMC confluences)
 *   4. Outcome tracking         (per-setup P&L, win-rate, R-multiple)
 *
 * Designed for backtesting and regime analysis.
 * All functions are pure — no I/O, no side effects.
 */

import {
  labelBars,
  computeGrammarSummary,
  type RawBar,
  type GrammarBar,
  type GrammarState,
} from "./bar_grammar";

import {
  analyzeStructure,
  detectOrderBlocks,
  detectFVG,
  detectDisplacement,
  type SMCBar,
  type StructureState,
  type OrderBlock,
  type FairValueGap,
  type DisplacementEvent,
} from "./smc_engine";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ReplayBar extends RawBar {
  /** Sequential index within the replay session */
  replayIndex: number;
  /** Bar-grammar label */
  label: GrammarBar["label"];
  /** Structural event fired at this bar */
  event: GrammarBar["event"];
  /** Running market bias at this bar */
  bias: GrammarBar["bias"];
  /** Last confirmed swing high price at this bar */
  lastSwingHigh: number | null;
  /** Last confirmed swing low price at this bar */
  lastSwingLow: number | null;
}

export interface SetupCandidate {
  /** Index of the trigger bar */
  barIndex: number;
  timestamp: string;
  direction: "long" | "short";
  /** Entry price (close of trigger bar) */
  entryPrice: number;
  /** Stop loss (lastSwingLow for long, lastSwingHigh for short) */
  stopPrice: number;
  /** Risk in price units */
  riskPoints: number;
  /** Confidence 0–1 based on confluent signals */
  confidence: number;
  /** What triggered this setup */
  triggers: string[];
}

export interface SetupOutcome {
  setup: SetupCandidate;
  /** Whether the trade hit TP before SL */
  won: boolean;
  /** Actual price at exit */
  exitPrice: number;
  exitBarIndex: number;
  /** R-multiple achieved (positive = win, negative = loss) */
  rMultiple: number;
  /** Bars held */
  barsHeld: number;
}

export interface ReplayReport {
  symbol: string;
  totalBars: number;
  labeledBars: ReplayBar[];
  grammarSummary: ReturnType<typeof computeGrammarSummary>;
  finalState: GrammarState;
  /** SMC state computed at the end of the replay window */
  smcStructure: StructureState;
  activeOrderBlocks: OrderBlock[];
  unfilledFVGs: FairValueGap[];
  recentDisplacements: DisplacementEvent[];
  /** Setups identified during replay */
  setupCandidates: SetupCandidate[];
  /** Outcomes for setups that resolved within the bar series */
  outcomes: SetupOutcome[];
  /** Win rate 0–1 (resolved setups only) */
  winRate: number;
  /** Average R-multiple (resolved setups only) */
  avgRMultiple: number;
  /** Expectancy = winRate * avgWin - lossRate * avgLoss */
  expectancy: number;
  /** P&L in R-multiples across all resolved outcomes */
  totalR: number;
  computedAt: string;
}

export interface ReplayConfig {
  /** Risk:reward target for TP calculation (default 2.0) */
  rrTarget?: number;
  /** Minimum confidence score to include a setup (default 0.5) */
  minConfidence?: number;
  /** SMC bars lookback for structure analysis (default 30) */
  smcLookback?: number;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Run a full historical replay on a bar series.
 *
 * @param symbol   Instrument symbol (informational only)
 * @param bars     Array of OHLCV bars in chronological order
 * @param config   Optional replay configuration
 */
export function runReplay(
  symbol: string,
  bars: RawBar[],
  config: ReplayConfig = {},
): ReplayReport {
  const {
    rrTarget = 2.0,
    minConfidence = 0.5,
    smcLookback = 30,
  } = config;

  if (bars.length === 0) {
    return emptyReport(symbol);
  }

  // ── Step 1: Bar-grammar labeling ──────────────────────────────────────────
  const { labeled: grammarBars, state: finalState } = labelBars(bars);
  const grammarSummary = computeGrammarSummary(grammarBars);

  // Build ReplayBars (add replayIndex to each labeled bar)
  const labeledBars: ReplayBar[] = grammarBars.map((gb, i) => ({
    ...gb,
    replayIndex: i,
  }));

  // ── Step 2: SMC analysis on the full bar series ───────────────────────────
  const smcBars = barsToSMCBars(bars);
  const smcStructure = analyzeStructure(smcBars);
  const allOrderBlocks = detectOrderBlocks(smcBars);
  const allFVGs = detectFVG(smcBars);
  const allDisplacements = detectDisplacement(smcBars);

  const activeOrderBlocks = allOrderBlocks.filter((ob) => !ob.broken && !ob.tested);
  const unfilledFVGs = allFVGs.filter((fvg) => !fvg.filled);
  const recentDisplacements = allDisplacements.filter(
    (d) => d.endIndex >= bars.length - 15,
  );

  // ── Step 3: Setup identification ──────────────────────────────────────────
  const setupCandidates = identifySetups(
    labeledBars,
    smcBars,
    allOrderBlocks,
    allFVGs,
    allDisplacements,
    minConfidence,
    smcLookback,
  );

  // ── Step 4: Outcome tracking ──────────────────────────────────────────────
  const outcomes = resolveOutcomes(labeledBars, setupCandidates, rrTarget);

  // ── Step 5: Performance metrics ──────────────────────────────────────────
  const { winRate, avgRMultiple, expectancy, totalR } = computePerformance(outcomes);

  return {
    symbol,
    totalBars: bars.length,
    labeledBars,
    grammarSummary,
    finalState,
    smcStructure,
    activeOrderBlocks,
    unfilledFVGs,
    recentDisplacements,
    setupCandidates,
    outcomes,
    winRate,
    avgRMultiple,
    expectancy,
    totalR,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Run replays across multiple symbols and aggregate results.
 */
export function runMultiSymbolReplay(
  symbolBars: Record<string, RawBar[]>,
  config: ReplayConfig = {},
): {
  reports: Record<string, ReplayReport>;
  aggregate: {
    totalBars: number;
    totalSetups: number;
    totalOutcomes: number;
    overallWinRate: number;
    overallExpectancy: number;
    symbolCount: number;
  };
} {
  const reports: Record<string, ReplayReport> = {};
  let totalBars = 0;
  let totalSetups = 0;
  let totalOutcomes = 0;
  let wonOutcomes = 0;
  let sumR = 0;

  for (const [symbol, bars] of Object.entries(symbolBars)) {
    const report = runReplay(symbol, bars, config);
    reports[symbol] = report;
    totalBars += report.totalBars;
    totalSetups += report.setupCandidates.length;
    totalOutcomes += report.outcomes.length;
    wonOutcomes += report.outcomes.filter((o) => o.won).length;
    sumR += report.totalR;
  }

  const overallWinRate = totalOutcomes > 0 ? wonOutcomes / totalOutcomes : 0;
  const overallExpectancy = totalOutcomes > 0 ? sumR / totalOutcomes : 0;

  return {
    reports,
    aggregate: {
      totalBars,
      totalSetups,
      totalOutcomes,
      overallWinRate: round4(overallWinRate),
      overallExpectancy: round4(overallExpectancy),
      symbolCount: Object.keys(symbolBars).length,
    },
  };
}

/**
 * Extract bars that match a specific grammar label sequence.
 * Useful for analysing how markets behave after CHoCH or BOS events.
 */
export function extractLabeledSequences(
  report: ReplayReport,
  eventFilter: NonNullable<GrammarBar["event"]>,
  lookforward = 10,
): Array<{ triggerBar: ReplayBar; sequence: ReplayBar[] }> {
  const results: Array<{ triggerBar: ReplayBar; sequence: ReplayBar[] }> = [];

  for (const bar of report.labeledBars) {
    if (bar.event === eventFilter) {
      const start = bar.replayIndex + 1;
      const end = Math.min(start + lookforward, report.labeledBars.length);
      results.push({
        triggerBar: bar,
        sequence: report.labeledBars.slice(start, end),
      });
    }
  }

  return results;
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function barsToSMCBars(bars: RawBar[]): SMCBar[] {
  return bars.map((b, i) => ({
    Timestamp: b.timestamp,
    Open: b.open,
    High: b.high,
    Low: b.low,
    Close: b.close,
    Volume: b.volume,
  }));
}

function identifySetups(
  labeledBars: ReplayBar[],
  smcBars: SMCBar[],
  orderBlocks: OrderBlock[],
  fvgs: FairValueGap[],
  displacements: DisplacementEvent[],
  minConfidence: number,
  lookback: number,
): SetupCandidate[] {
  const setups: SetupCandidate[] = [];
  const activeOBs = orderBlocks.filter((ob) => !ob.broken && !ob.tested);
  const unfilledFVGs = fvgs.filter((f) => !f.filled);

  for (let i = lookback; i < labeledBars.length; i++) {
    const bar = labeledBars[i]!;
    const triggers: string[] = [];
    let confidence = 0;

    // BOS/CHoCH event — primary signal
    if (bar.event === "BOS_UP" || bar.event === "CHoCH_UP") {
      triggers.push(bar.event);
      confidence += bar.event === "CHoCH_UP" ? 0.4 : 0.25;
    } else if (bar.event === "BOS_DOWN" || bar.event === "CHoCH_DOWN") {
      triggers.push(bar.event);
      confidence += bar.event === "CHoCH_DOWN" ? 0.4 : 0.25;
    } else {
      continue; // Only generate setups on structural events
    }

    const direction: "long" | "short" =
      bar.event === "BOS_UP" || bar.event === "CHoCH_UP" ? "long" : "short";

    // Add confluence: nearby active order block in direction
    const nearOBs = activeOBs.filter((ob) => {
      const dist = Math.abs(ob.mid - bar.close) / Math.max(bar.close, 1e-9);
      return ob.side === (direction === "long" ? "bullish" : "bearish") && dist < 0.02;
    });
    if (nearOBs.length > 0) {
      triggers.push("near_OB");
      confidence += 0.2;
    }

    // Add confluence: unfilled FVG in direction
    const nearFVGs = unfilledFVGs.filter((fvg) => {
      const mid = (fvg.low + fvg.high) / 2;
      return (
        fvg.side === (direction === "long" ? "bullish" : "bearish") &&
        Math.abs(mid - bar.close) / Math.max(bar.close, 1e-9) < 0.015
      );
    });
    if (nearFVGs.length > 0) {
      triggers.push("near_FVG");
      confidence += 0.15;
    }

    // Recent displacement in direction
    const recentDisp = displacements.filter(
      (d) =>
        d.endIndex >= i - 5 &&
        d.direction === (direction === "long" ? "up" : "down"),
    );
    if (recentDisp.length > 0) {
      triggers.push("displacement");
      confidence += 0.15;
    }

    // Higher timeframe structure alignment via SMC bias
    const localBars = smcBars.slice(Math.max(0, i - lookback), i + 1);
    if (localBars.length >= 30) {
      const localStructure = analyzeStructure(localBars);
      if (
        (direction === "long" && localStructure.trend === "bullish") ||
        (direction === "short" && localStructure.trend === "bearish")
      ) {
        triggers.push("htf_aligned");
        confidence += 0.1;
      }
    }

    confidence = Math.min(1, confidence);
    if (confidence < minConfidence) continue;

    const stopPrice =
      direction === "long"
        ? bar.lastSwingLow ?? bar.low - bar.low * 0.01
        : bar.lastSwingHigh ?? bar.high + bar.high * 0.01;

    const riskPoints = Math.abs(bar.close - stopPrice);

    setups.push({
      barIndex: i,
      timestamp: bar.timestamp,
      direction,
      entryPrice: bar.close,
      stopPrice,
      riskPoints,
      confidence: round4(confidence),
      triggers,
    });
  }

  return setups;
}

function resolveOutcomes(
  labeledBars: ReplayBar[],
  setups: SetupCandidate[],
  rrTarget: number,
): SetupOutcome[] {
  const outcomes: SetupOutcome[] = [];

  for (const setup of setups) {
    const tp =
      setup.direction === "long"
        ? setup.entryPrice + setup.riskPoints * rrTarget
        : setup.entryPrice - setup.riskPoints * rrTarget;

    for (let j = setup.barIndex + 1; j < labeledBars.length; j++) {
      const bar = labeledBars[j]!;

      let won = false;
      let exitPrice = 0;
      let resolved = false;

      if (setup.direction === "long") {
        if (bar.high >= tp) {
          won = true; exitPrice = tp; resolved = true;
        } else if (bar.low <= setup.stopPrice) {
          won = false; exitPrice = setup.stopPrice; resolved = true;
        }
      } else {
        if (bar.low <= tp) {
          won = true; exitPrice = tp; resolved = true;
        } else if (bar.high >= setup.stopPrice) {
          won = false; exitPrice = setup.stopPrice; resolved = true;
        }
      }

      if (resolved) {
        const pnl = setup.direction === "long"
          ? exitPrice - setup.entryPrice
          : setup.entryPrice - exitPrice;
        const rMultiple = setup.riskPoints > 0 ? round4(pnl / setup.riskPoints) : 0;
        outcomes.push({
          setup, won, exitPrice, exitBarIndex: j,
          rMultiple, barsHeld: j - setup.barIndex,
        });
        break;
      }
    }
  }

  return outcomes;
}

function computePerformance(outcomes: SetupOutcome[]): {
  winRate: number;
  avgRMultiple: number;
  expectancy: number;
  totalR: number;
} {
  if (outcomes.length === 0) {
    return { winRate: 0, avgRMultiple: 0, expectancy: 0, totalR: 0 };
  }

  const wins = outcomes.filter((o) => o.won);
  const losses = outcomes.filter((o) => !o.won);
  const winRate = wins.length / outcomes.length;
  const totalR = outcomes.reduce((s, o) => s + o.rMultiple, 0);
  const avgRMultiple = totalR / outcomes.length;
  const avgWin = wins.length > 0 ? wins.reduce((s, o) => s + o.rMultiple, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, o) => s + o.rMultiple, 0) / losses.length) : 0;
  const expectancy = winRate * avgWin - (1 - winRate) * avgLoss;

  return {
    winRate: round4(winRate),
    avgRMultiple: round4(avgRMultiple),
    expectancy: round4(expectancy),
    totalR: round4(totalR),
  };
}

function emptyReport(symbol: string): ReplayReport {
  return {
    symbol,
    totalBars: 0,
    labeledBars: [],
    grammarSummary: {
      hhCount: 0, hlCount: 0, lhCount: 0, llCount: 0, neutralCount: 0,
      bosUpCount: 0, bosDownCount: 0, chochUpCount: 0, chochDownCount: 0,
      structureBias: "neutral", bullishBars: 0, bearishBars: 0,
    },
    finalState: {
      bias: "neutral", lastSwingHigh: null, lastSwingLow: null,
      swingHighHistory: [], swingLowHistory: [], bosCount: 0, chochCount: 0,
    },
    smcStructure: {
      trend: "range", trendReturn20: 0, bos: false, choch: false,
      bosDirection: "none", swingHighs: [], swingLows: [],
      invalidation: null, structureScore: 0, pattern: "insufficient",
    },
    activeOrderBlocks: [],
    unfilledFVGs: [],
    recentDisplacements: [],
    setupCandidates: [],
    outcomes: [],
    winRate: 0,
    avgRMultiple: 0,
    expectancy: 0,
    totalR: 0,
    computedAt: new Date().toISOString(),
  };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
