/**
 * bar_grammar.ts — Sequential Bar-Grammar Labeler
 *
 * Classifies OHLCV bars in sequence, labeling each bar with its structural role
 * relative to the running swing context. Designed for historical replay and
 * streaming ingestion — processes bars in order without look-ahead.
 *
 * Labels:
 *   HH  Higher High   — swing high above previous swing high (bullish continuation)
 *   HL  Higher Low    — swing low above previous swing low   (bullish structure)
 *   LH  Lower High    — swing high below previous swing high (bearish continuation)
 *   LL  Lower Low     — swing low below previous swing low   (bearish structure)
 *   neutral           — bar inside range, no new swing confirmed
 *
 * Events (fired at most once per bar):
 *   BOS_UP    Break of Structure upward  — close > last confirmed swing high
 *   BOS_DOWN  Break of Structure down    — close < last confirmed swing low
 *   CHoCH_UP  Change of Character up     — BOS_UP in a prevailing bearish bias
 *   CHoCH_DOWN Change of Character down  — BOS_DOWN in a prevailing bullish bias
 *
 * All functions are pure — no I/O, no side effects.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export type BarLabel = "HH" | "HL" | "LH" | "LL" | "neutral";
export type StructureEvent = "BOS_UP" | "BOS_DOWN" | "CHoCH_UP" | "CHoCH_DOWN" | null;
export type MarketBias = "bullish" | "bearish" | "neutral";

export interface RawBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface GrammarBar extends RawBar {
  index: number;
  label: BarLabel;
  event: StructureEvent;
  bias: MarketBias;
  lastSwingHigh: number | null;
  lastSwingLow: number | null;
}

export interface GrammarState {
  bias: MarketBias;
  lastSwingHigh: number | null;
  lastSwingLow: number | null;
  swingHighHistory: number[];
  swingLowHistory: number[];
  bosCount: number;
  chochCount: number;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Label an array of bars with structural grammar.
 * Returns a GrammarBar for each input bar, in order.
 * Optionally return a trailing GrammarState for continuation streaming.
 */
export function labelBars(
  bars: RawBar[],
  initialState?: GrammarState,
): { labeled: GrammarBar[]; state: GrammarState } {
  const state: GrammarState = initialState
    ? { ...initialState, swingHighHistory: [...initialState.swingHighHistory], swingLowHistory: [...initialState.swingLowHistory] }
    : {
        bias: "neutral",
        lastSwingHigh: null,
        lastSwingLow: null,
        swingHighHistory: [],
        swingLowHistory: [],
        bosCount: 0,
        chochCount: 0,
      };

  const labeled: GrammarBar[] = [];

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const { label, event } = classifyBar(bar, state, i);

    // Update state for next bar
    applyBarToState(bar, label, event, state);

    labeled.push({
      ...bar,
      index: i,
      label,
      event,
      bias: state.bias,
      lastSwingHigh: state.lastSwingHigh,
      lastSwingLow: state.lastSwingLow,
    });
  }

  return { labeled, state };
}

/**
 * Classify a single bar against current state (pure, no mutation).
 */
export function classifyBar(
  bar: RawBar,
  state: GrammarState,
  _index = 0,
): { label: BarLabel; event: StructureEvent } {
  const { lastSwingHigh, lastSwingLow, bias } = state;

  let label: BarLabel = "neutral";
  let event: StructureEvent = null;

  // Determine label based on swing context
  const makeNewSwingHigh = lastSwingHigh !== null && bar.high > lastSwingHigh;
  const makeNewSwingLow = lastSwingLow !== null && bar.low < lastSwingLow;
  const higherLow = lastSwingLow !== null && bar.low > lastSwingLow && !makeNewSwingLow;
  const lowerHigh = lastSwingHigh !== null && bar.high < lastSwingHigh && !makeNewSwingHigh;

  // Primary label: check high first, then low
  if (makeNewSwingHigh) {
    // Higher High
    label = "HH";
  } else if (makeNewSwingLow) {
    // Lower Low
    label = "LL";
  } else if (lastSwingHigh === null && lastSwingLow === null) {
    // First bar sets the initial swing context
    label = "neutral";
  } else if (higherLow && !makeNewSwingHigh) {
    label = "HL";
  } else if (lowerHigh && !makeNewSwingLow) {
    label = "LH";
  }

  // BOS / CHoCH detection (based on close, not high/low)
  if (lastSwingHigh !== null && bar.close > lastSwingHigh) {
    // Break above last swing high
    event = bias === "bearish" ? "CHoCH_UP" : "BOS_UP";
  } else if (lastSwingLow !== null && bar.close < lastSwingLow) {
    // Break below last swing low
    event = bias === "bullish" ? "CHoCH_DOWN" : "BOS_DOWN";
  }

  return { label, event };
}

/**
 * Create a fresh GrammarState from the first bar (bootstraps swing context).
 */
export function createInitialState(firstBar: RawBar): GrammarState {
  return {
    bias: "neutral",
    lastSwingHigh: firstBar.high,
    lastSwingLow: firstBar.low,
    swingHighHistory: [firstBar.high],
    swingLowHistory: [firstBar.low],
    bosCount: 0,
    chochCount: 0,
  };
}

/**
 * Compute summary statistics from a labeled bar series.
 */
export function computeGrammarSummary(labeled: GrammarBar[]): {
  hhCount: number;
  hlCount: number;
  lhCount: number;
  llCount: number;
  neutralCount: number;
  bosUpCount: number;
  bosDownCount: number;
  chochUpCount: number;
  chochDownCount: number;
  structureBias: MarketBias;
  bullishBars: number;
  bearishBars: number;
} {
  let hhCount = 0, hlCount = 0, lhCount = 0, llCount = 0, neutralCount = 0;
  let bosUpCount = 0, bosDownCount = 0, chochUpCount = 0, chochDownCount = 0;
  let bullishBars = 0, bearishBars = 0;

  for (const bar of labeled) {
    switch (bar.label) {
      case "HH": hhCount++; break;
      case "HL": hlCount++; break;
      case "LH": lhCount++; break;
      case "LL": llCount++; break;
      default: neutralCount++; break;
    }
    switch (bar.event) {
      case "BOS_UP": bosUpCount++; break;
      case "BOS_DOWN": bosDownCount++; break;
      case "CHoCH_UP": chochUpCount++; break;
      case "CHoCH_DOWN": chochDownCount++; break;
    }
    if (bar.close > bar.open) bullishBars++;
    else if (bar.close < bar.open) bearishBars++;
  }

  const bullishSignals = hhCount + hlCount + bosUpCount + chochUpCount;
  const bearishSignals = lhCount + llCount + bosDownCount + chochDownCount;
  const structureBias: MarketBias =
    bullishSignals > bearishSignals
      ? "bullish"
      : bearishSignals > bullishSignals
      ? "bearish"
      : "neutral";

  return {
    hhCount, hlCount, lhCount, llCount, neutralCount,
    bosUpCount, bosDownCount, chochUpCount, chochDownCount,
    structureBias, bullishBars, bearishBars,
  };
}

/**
 * Extract swing pivots from a labeled bar series.
 */
export function extractSwingPivots(labeled: GrammarBar[]): {
  highs: Array<{ index: number; price: number; timestamp: string }>;
  lows: Array<{ index: number; price: number; timestamp: string }>;
} {
  const highs: Array<{ index: number; price: number; timestamp: string }> = [];
  const lows: Array<{ index: number; price: number; timestamp: string }> = [];

  for (const bar of labeled) {
    if (bar.label === "HH" || bar.label === "LH") {
      highs.push({ index: bar.index, price: bar.high, timestamp: bar.timestamp });
    }
    if (bar.label === "LL" || bar.label === "HL") {
      lows.push({ index: bar.index, price: bar.low, timestamp: bar.timestamp });
    }
  }

  return { highs, lows };
}

/**
 * Detect a clean bullish market structure (sequence of HH + HL).
 * Returns true if the last N structural bars are HH/HL only.
 */
export function isBullishStructure(labeled: GrammarBar[], lookback = 6): boolean {
  const structural = labeled.filter((b) => b.label !== "neutral");
  const recent = structural.slice(-lookback);
  if (recent.length < 2) return false;
  return recent.every((b) => b.label === "HH" || b.label === "HL");
}

/**
 * Detect a clean bearish market structure (sequence of LH + LL).
 */
export function isBearishStructure(labeled: GrammarBar[], lookback = 6): boolean {
  const structural = labeled.filter((b) => b.label !== "neutral");
  const recent = structural.slice(-lookback);
  if (recent.length < 2) return false;
  return recent.every((b) => b.label === "LH" || b.label === "LL");
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function applyBarToState(
  bar: RawBar,
  label: BarLabel,
  event: StructureEvent,
  state: GrammarState,
): void {
  // Update swing references
  if (state.lastSwingHigh === null || bar.high > state.lastSwingHigh) {
    state.lastSwingHigh = bar.high;
    state.swingHighHistory.push(bar.high);
  }
  if (state.lastSwingLow === null || bar.low < state.lastSwingLow) {
    state.lastSwingLow = bar.low;
    state.swingLowHistory.push(bar.low);
  }

  // Update bias from BOS/CHoCH
  if (event === "BOS_UP" || event === "CHoCH_UP") {
    state.bias = "bullish";
    state.bosCount++;
    if (event === "CHoCH_UP") state.chochCount++;
  } else if (event === "BOS_DOWN" || event === "CHoCH_DOWN") {
    state.bias = "bearish";
    state.bosCount++;
    if (event === "CHoCH_DOWN") state.chochCount++;
  }
}
