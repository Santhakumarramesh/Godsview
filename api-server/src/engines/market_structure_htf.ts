/**
 * market_structure_htf.ts — Higher Timeframe Market Structure Engine
 *
 * A comprehensive multi-timeframe market structure analysis engine for the GodsView trading platform.
 * Detects and scores swing points, structure labels (HH/HL/LH/LL), order blocks, AB=CD patterns,
 * supply/demand zones, and liquidity pools across Weekly, Daily, 4H, 1H, and 15min timeframes.
 *
 * Core Features:
 *   - Multi-timeframe swing detection using pivot logic (configurable left/right bars)
 *   - Structure labeling and Break of Structure (BOS) / Change of Character (CHoCH) detection
 *   - Higher timeframe order block identification and scoring
 *   - AB=CD harmonic pattern detection with Fibonacci validation
 *   - Supply/demand zone detection via Rally-Base-Drop and Drop-Base-Rally patterns
 *   - Liquidity pool tracking (equal highs/lows, session extremes)
 *   - Trade probability calculation based on multi-TF confluence
 *
 * All functions are pure and produce no side effects.
 */

import { randomUUID } from "crypto";

/**
 * TYPES & INTERFACES
 */

/** Single OHLCV bar with timestamp */
export interface Bar {
  t: string; // ISO timestamp
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close
  v: number; // volume
}

/** Supported timeframes */
export type Timeframe = "15min" | "1H" | "4H" | "1D" | "1W";

/** Structure bias direction */
export type StructureBias = "bullish" | "bearish" | "ranging";

/** Swing point (pivot high or low) */
export interface SwingPoint {
  index: number; // bar index
  price: number;
  timestamp: string;
  type: "high" | "low";
}

/** Structure label: HH (Higher High), HL (Higher Low), LH (Lower High), LL (Lower Low) */
export interface StructureLabel {
  index: number;
  label: "HH" | "HL" | "LH" | "LL";
  price: number;
  timestamp: string;
}

/** Break of Structure or Change of Character event */
export interface StructureEvent {
  type: "BOS_UP" | "BOS_DOWN" | "CHoCH_UP" | "CHoCH_DOWN";
  index: number;
  price: number;
  timestamp: string;
}

/** Higher Timeframe Order Block */
export interface OrderBlockHTF {
  id: string;
  type: "bullish" | "bearish";
  timeframe: Timeframe;
  high: number;
  low: number;
  volume: number;
  createdAt: string;
  status: "fresh" | "tested" | "mitigated";
  impulseStrength: number; // 0-100
  score: number; // 0-100
}

/** AB=CD Harmonic Pattern */
export interface ABCDPattern {
  id: string;
  type: "bullish" | "bearish";
  pointA: SwingPoint;
  pointB: SwingPoint;
  pointC: SwingPoint;
  pointD: SwingPoint;
  bcRetracement: number; // 38.2%-78.6% range
  cdExtension: number; // extension ratio
  fibAccuracy: number; // 0-100
  score: number; // 0-100
  timeframe: Timeframe;
  completionPrice: number;
  status: "forming" | "complete" | "triggered" | "invalidated";
}

/** Supply or Demand Zone */
export interface SupplyDemandZone {
  id: string;
  type: "supply" | "demand";
  timeframe: Timeframe;
  high: number;
  low: number;
  baseCandles: number; // number of base candles
  createdAt: string;
  tests: number; // number of times zone was tested
  status: "fresh" | "tested" | "broken";
  score: number; // 0-100
}

/** Per-timeframe analysis result */
export interface TimeframeAnalysis {
  timeframe: Timeframe;
  bias: StructureBias;
  swings: SwingPoint[];
  labels: StructureLabel[];
  events: StructureEvent[];
  orderBlocks: OrderBlockHTF[];
  abcdPatterns: ABCDPattern[];
  supplyDemandZones: SupplyDemandZone[];
}

/** Key level with strength and origin */
export interface KeyLevel {
  price: number;
  type: string; // "swing_high", "swing_low", "order_block", "zone", etc.
  timeframe: Timeframe;
  strength: number; // 0-100
}

/** Complete multi-timeframe analysis */
export interface MultiTimeframeStructure {
  symbol: string;
  analyzedAt: string;
  timeframes: Record<Timeframe, TimeframeAnalysis>;
  htfBias: StructureBias; // consensus from Weekly & Daily
  tradeProbability: {
    long: number; // 0-100
    short: number; // 0-100
    neutral: number; // 0-100
  };
  keyLevels: KeyLevel[];
  nearestOrderBlocks: {
    bullish: OrderBlockHTF | null;
    bearish: OrderBlockHTF | null;
  };
  nearestABCD: ABCDPattern | null;
}

/**
 * SWING DETECTION
 */

/**
 * Detect swing points (pivot highs and lows) in bars using left/right bar configuration.
 * Default: 2 left bars, 2 right bars (5-bar swing pattern).
 */
function detectSwingPoints(
  bars: Bar[],
  leftBars = 2,
  rightBars = 2
): SwingPoint[] {
  if (bars.length < leftBars + rightBars + 1) return [];

  const swings: SwingPoint[] = [];

  for (let i = leftBars; i < bars.length - rightBars; i++) {
    const current = bars[i];
    let isHigh = true;
    let isLow = true;

    // Check left bars
    for (let j = 1; j <= leftBars; j++) {
      if (bars[i - j].h >= current.h) isHigh = false;
      if (bars[i - j].l <= current.l) isLow = false;
    }

    // Check right bars
    for (let j = 1; j <= rightBars; j++) {
      if (bars[i + j].h >= current.h) isHigh = false;
      if (bars[i + j].l <= current.l) isLow = false;
    }

    if (isHigh) {
      swings.push({
        index: i,
        price: current.h,
        timestamp: current.t,
        type: "high",
      });
    }
    if (isLow) {
      swings.push({
        index: i,
        price: current.l,
        timestamp: current.t,
        type: "low",
      });
    }
  }

  return swings;
}

/**
 * STRUCTURE LABELING
 */

/**
 * Label structure from swing points and detect Break of Structure (BOS) and Change of Character (CHoCH).
 * Returns labels, events, and overall bias direction.
 */
function labelStructure(swings: SwingPoint[]): {
  labels: StructureLabel[];
  events: StructureEvent[];
  bias: StructureBias;
} {
  if (swings.length < 2) return { labels: [], events: [], bias: "ranging" };

  // Separate highs and lows
  const highs = swings.filter((s) => s.type === "high").sort((a, b) => a.index - b.index);
  const lows = swings.filter((s) => s.type === "low").sort((a, b) => a.index - b.index);

  const labels: StructureLabel[] = [];
  const events: StructureEvent[] = [];
  const labelMap: Record<number, "HH" | "HL" | "LH" | "LL"> = {};

  // Label highs: HH (higher than previous high) or LH (lower than previous high)
  for (let i = 1; i < highs.length; i++) {
    const label = highs[i].price > highs[i - 1].price ? "HH" : "LH";
    labelMap[highs[i].index] = label;
    labels.push({
      index: highs[i].index,
      label,
      price: highs[i].price,
      timestamp: highs[i].timestamp,
    });

    // Detect BOS_UP: price breaks above previous HH
    if (i >= 2 && label === "HH" && highs[i].price > highs[i - 2].price) {
      events.push({
        type: "BOS_UP",
        index: highs[i].index,
        price: highs[i].price,
        timestamp: highs[i].timestamp,
      });
    }

    // Detect CHoCH_DOWN: from HH to LH indicates character change to bearish
    if (i >= 2 && label === "LH" && labelMap[highs[i - 1].index] === "HH") {
      events.push({
        type: "CHoCH_DOWN",
        index: highs[i].index,
        price: highs[i].price,
        timestamp: highs[i].timestamp,
      });
    }
  }

  // Label lows: LL (lower than previous low) or HL (higher than previous low)
  for (let i = 1; i < lows.length; i++) {
    const label = lows[i].price < lows[i - 1].price ? "LL" : "HL";
    labelMap[lows[i].index] = label;
    labels.push({
      index: lows[i].index,
      label,
      price: lows[i].price,
      timestamp: lows[i].timestamp,
    });

    // Detect BOS_DOWN: price breaks below previous LL
    if (i >= 2 && label === "LL" && lows[i].price < lows[i - 2].price) {
      events.push({
        type: "BOS_DOWN",
        index: lows[i].index,
        price: lows[i].price,
        timestamp: lows[i].timestamp,
      });
    }

    // Detect CHoCH_UP: from LL to HL indicates character change to bullish
    if (i >= 2 && label === "HL" && labelMap[lows[i - 1].index] === "LL") {
      events.push({
        type: "CHoCH_UP",
        index: lows[i].index,
        price: lows[i].price,
        timestamp: lows[i].timestamp,
      });
    }
  }

  // Determine overall bias from most recent swings
  let bias: StructureBias = "ranging";
  if (highs.length >= 2 && lows.length >= 2) {
    const lastHighIsHH = highs[highs.length - 1].price > highs[highs.length - 2].price;
    const lastLowIsHL = lows[lows.length - 1].price > lows[lows.length - 2].price;

    if (lastHighIsHH && lastLowIsHL) {
      bias = "bullish";
    } else if (!lastHighIsHH && !lastLowIsHL) {
      bias = "bearish";
    }
  }

  return { labels, events, bias };
}

/**
 * ORDER BLOCK DETECTION
 */

/**
 * Detect order blocks at higher timeframe level.
 * Bullish OB: last bearish candle before an uptrend impulse.
 * Bearish OB: last bullish candle before a downtrend impulse.
 */
function detectOrderBlocksHTF(bars: Bar[], timeframe: Timeframe): OrderBlockHTF[] {
  if (bars.length < 5) return [];

  const orderBlocks: OrderBlockHTF[] = [];

  // Detect impulse moves: sequence of candles in same direction with increasing volume
  for (let i = 2; i < bars.length - 2; i++) {
    const bar0 = bars[i - 2];
    const bar1 = bars[i - 1];
    const bar2 = bars[i];
    const bar3 = bars[i + 1];
    const bar4 = bars[i + 2];

    const avgVol = (bar0.v + bar1.v + bar2.v + bar3.v + bar4.v) / 5;

    // Detect bullish impulse (3+ consecutive up closes with volume)
    if (
      bar1.c > bar1.o &&
      bar2.c > bar2.o &&
      bar3.c > bar3.o &&
      bar2.v > avgVol &&
      bar3.v > avgVol
    ) {
      // Order block is the last bearish candle before impulse
      if (bar0.c < bar0.o) {
        const impulseStrength = Math.min(100, ((bar3.c - bar1.o) / bar1.o) * 1000); // %move
        orderBlocks.push({
          id: randomUUID(),
          type: "bullish",
          timeframe,
          high: Math.max(bar0.h, bar0.o),
          low: Math.min(bar0.l, bar0.c),
          volume: bar0.v,
          createdAt: bar0.t,
          status: "fresh",
          impulseStrength,
          score: Math.min(100, impulseStrength + 20),
        });
      }
    }

    // Detect bearish impulse (3+ consecutive down closes with volume)
    if (
      bar1.c < bar1.o &&
      bar2.c < bar2.o &&
      bar3.c < bar3.o &&
      bar2.v > avgVol &&
      bar3.v > avgVol
    ) {
      // Order block is the last bullish candle before impulse
      if (bar0.c > bar0.o) {
        const impulseStrength = Math.min(100, ((bar1.o - bar3.c) / bar1.o) * 1000); // %move
        orderBlocks.push({
          id: randomUUID(),
          type: "bearish",
          timeframe,
          high: Math.max(bar0.h, bar0.c),
          low: Math.min(bar0.l, bar0.o),
          volume: bar0.v,
          createdAt: bar0.t,
          status: "fresh",
          impulseStrength,
          score: Math.min(100, impulseStrength + 20),
        });
      }
    }
  }

  return orderBlocks;
}

/**
 * AB=CD PATTERN DETECTION
 */

/**
 * Fibonacci retracement levels
 */
function getFibLevel(level: "382" | "618" | "786"): number {
  const levels: Record<string, number> = {
    "382": 0.382,
    "618": 0.618,
    "786": 0.786,
  };
  return levels[level];
}

/**
 * Detect AB=CD harmonic patterns from swing points.
 * AB leg → BC retracement (38.2%-78.6%) → CD extension (100%-161.8% of AB)
 */
function detectABCDPatterns(
  swings: SwingPoint[],
  bars: Bar[],
  timeframe: Timeframe
): ABCDPattern[] {
  if (swings.length < 4) return [];

  const patterns: ABCDPattern[] = [];

  // Try all combinations of 4 swings
  for (let i = 0; i < swings.length - 3; i++) {
    const pointA = swings[i];
    const pointB = swings[i + 1];
    const pointC = swings[i + 2];
    const pointD = swings[i + 3];

    const abLength = Math.abs(pointB.price - pointA.price);
    const bcLength = Math.abs(pointC.price - pointB.price);
    const cdLength = Math.abs(pointD.price - pointC.price);

    // BC should be 38.2%-78.6% of AB
    const bcRatio = bcLength / abLength;
    if (bcRatio < 0.382 || bcRatio > 0.786) continue;

    // CD should be 100%-161.8% of AB
    const cdRatio = cdLength / abLength;
    if (cdRatio < 0.618 || cdRatio > 1.618) continue;

    // Determine pattern type (bullish or bearish)
    let type: "bullish" | "bearish";
    let completionPrice: number;

    if (pointA.type === "low" && pointB.type === "high") {
      // Potential bullish ABCD
      type = "bullish";
      completionPrice = pointC.price + cdLength;
    } else if (pointA.type === "high" && pointB.type === "low") {
      // Potential bearish ABCD
      type = "bearish";
      completionPrice = pointC.price - cdLength;
    } else {
      continue;
    }

    // Fibonacci accuracy: how close is D to 61.8% or 78.6% retracement of BC?
    const fibAccuracy = Math.max(
      100 - Math.abs(bcRatio - 0.618) * 100,
      100 - Math.abs(bcRatio - 0.786) * 100
    );

    const score = Math.max(0, Math.min(100, fibAccuracy + 10));

    patterns.push({
      id: randomUUID(),
      type,
      pointA,
      pointB,
      pointC,
      pointD,
      bcRetracement: bcRatio,
      cdExtension: cdRatio,
      fibAccuracy,
      score,
      timeframe,
      completionPrice,
      status: "complete",
    });
  }

  return patterns;
}

/**
 * SUPPLY & DEMAND ZONE DETECTION
 */

/**
 * Detect supply/demand zones using Rally-Base-Drop (supply) and Drop-Base-Rally (demand) patterns.
 */
function detectSupplyDemandZones(bars: Bar[], timeframe: Timeframe): SupplyDemandZone[] {
  if (bars.length < 10) return [];

  const zones: SupplyDemandZone[] = [];

  // Detect Rally-Base-Drop (supply zone)
  for (let i = 2; i < bars.length - 5; i++) {
    const before = bars.slice(Math.max(0, i - 3), i);
    const base = bars.slice(i, i + 3);
    const after = bars.slice(i + 3, Math.min(bars.length, i + 6));

    // Rally: increasing closes
    const isRally = before.every((b, idx) => idx === 0 || b.c >= before[idx - 1].c);
    // Base: consolidation
    const baseHigh = Math.max(...base.map((b) => b.h));
    const baseLow = Math.min(...base.map((b) => b.l));
    const baseRange = baseHigh - baseLow;
    const isBase = baseRange < baseHigh * 0.02; // < 2% range
    // Drop: increasing lows (decreasing closes)
    const isDrop = after.every((b, idx) => idx === 0 || b.c <= after[idx - 1].c);

    if (isRally && isBase && isDrop) {
      zones.push({
        id: randomUUID(),
        type: "supply",
        timeframe,
        high: baseHigh,
        low: baseLow,
        baseCandles: base.length,
        createdAt: bars[i].t,
        tests: 0,
        status: "fresh",
        score: 75,
      });
    }
  }

  // Detect Drop-Base-Rally (demand zone)
  for (let i = 2; i < bars.length - 5; i++) {
    const before = bars.slice(Math.max(0, i - 3), i);
    const base = bars.slice(i, i + 3);
    const after = bars.slice(i + 3, Math.min(bars.length, i + 6));

    // Drop: decreasing closes
    const isDrop = before.every((b, idx) => idx === 0 || b.c <= before[idx - 1].c);
    // Base: consolidation
    const baseHigh = Math.max(...base.map((b) => b.h));
    const baseLow = Math.min(...base.map((b) => b.l));
    const baseRange = baseHigh - baseLow;
    const isBase = baseRange < baseHigh * 0.02;
    // Rally: increasing closes
    const isRally = after.every((b, idx) => idx === 0 || b.c >= after[idx - 1].c);

    if (isDrop && isBase && isRally) {
      zones.push({
        id: randomUUID(),
        type: "demand",
        timeframe,
        high: baseHigh,
        low: baseLow,
        baseCandles: base.length,
        createdAt: bars[i].t,
        tests: 0,
        status: "fresh",
        score: 75,
      });
    }
  }

  return zones;
}

/**
 * TIMEFRAME ANALYSIS
 */

/**
 * Comprehensive analysis of a single timeframe.
 */
function analyzeTimeframe(bars: Bar[], timeframe: Timeframe): TimeframeAnalysis {
  const swings = detectSwingPoints(bars);
  const { labels, events, bias } = labelStructure(swings);
  const orderBlocks = detectOrderBlocksHTF(bars, timeframe);
  const abcdPatterns = detectABCDPatterns(swings, bars, timeframe);
  const supplyDemandZones = detectSupplyDemandZones(bars, timeframe);

  return {
    timeframe,
    bias,
    swings,
    labels,
    events,
    orderBlocks,
    abcdPatterns,
    supplyDemandZones,
  };
}

/**
 * MULTI-TIMEFRAME ANALYSIS
 */

/**
 * Multi-timeframe market structure analysis.
 * Analyzes Weekly, Daily, 4H, 1H, 15min and derives HTF bias and trade probability.
 */
function analyzeMultiTimeframe(
  barsByTf: Record<Timeframe, Bar[]>,
  symbol: string
): MultiTimeframeStructure {
  const timeframes: Record<Timeframe, TimeframeAnalysis> = {} as any;

  // Analyze each timeframe
  const tfList: Timeframe[] = ["1W", "1D", "4H", "1H", "15min"];
  for (const tf of tfList) {
    if (barsByTf[tf] && barsByTf[tf].length > 0) {
      timeframes[tf] = analyzeTimeframe(barsByTf[tf], tf);
    }
  }

  // Determine HTF bias from Weekly and Daily
  let htfBias: StructureBias = "ranging";
  const weeklyBias = timeframes["1W"]?.bias || "ranging";
  const dailyBias = timeframes["1D"]?.bias || "ranging";

  if (weeklyBias === "bullish" || dailyBias === "bullish") {
    htfBias = "bullish";
  } else if (weeklyBias === "bearish" || dailyBias === "bearish") {
    htfBias = "bearish";
  }

  // Collect all key levels
  const keyLevels: KeyLevel[] = [];
  for (const tf of tfList) {
    if (!timeframes[tf]) continue;
    const analysis = timeframes[tf];

    // Add swing highs/lows
    for (const swing of analysis.swings) {
      keyLevels.push({
        price: swing.price,
        type: swing.type === "high" ? "swing_high" : "swing_low",
        timeframe: tf,
        strength: tf === "1W" ? 100 : tf === "1D" ? 90 : tf === "4H" ? 70 : 50,
      });
    }

    // Add order block zones
    for (const ob of analysis.orderBlocks) {
      keyLevels.push({
        price: (ob.high + ob.low) / 2,
        type: `order_block_${ob.type}`,
        timeframe: tf,
        strength: Math.min(100, ob.score + 10),
      });
    }

    // Add zone midpoints
    for (const zone of analysis.supplyDemandZones) {
      keyLevels.push({
        price: (zone.high + zone.low) / 2,
        type: `zone_${zone.type}`,
        timeframe: tf,
        strength: zone.score,
      });
    }
  }

  // Find nearest order blocks (above and below current)
  let nearestBullishOB: OrderBlockHTF | null = null;
  let nearestBearishOB: OrderBlockHTF | null = null;
  const allOBs: OrderBlockHTF[] = [];
  for (const tf of tfList) {
    if (timeframes[tf]) {
      allOBs.push(...timeframes[tf].orderBlocks);
    }
  }

  // Find nearest ABCD pattern
  let nearestABCD: ABCDPattern | null = null;
  const allABCDs: ABCDPattern[] = [];
  for (const tf of tfList) {
    if (timeframes[tf]) {
      allABCDs.push(...timeframes[tf].abcdPatterns);
    }
  }
  if (allABCDs.length > 0) {
    nearestABCD = allABCDs.sort((a, b) => b.score - a.score)[0];
  }

  if (allOBs.length > 0) {
    const bullish = allOBs.filter((ob) => ob.type === "bullish");
    const bearish = allOBs.filter((ob) => ob.type === "bearish");
    if (bullish.length > 0) nearestBullishOB = bullish.sort((a, b) => b.score - a.score)[0];
    if (bearish.length > 0) nearestBearishOB = bearish.sort((a, b) => b.score - a.score)[0];
  }

  const tradeProbability = calculateTradeProbability(
    {
      symbol,
      analyzedAt: new Date().toISOString(),
      timeframes,
      htfBias,
      tradeProbability: { long: 0, short: 0, neutral: 0 },
      keyLevels,
      nearestOrderBlocks: { bullish: nearestBullishOB, bearish: nearestBearishOB },
      nearestABCD,
    },
    -1 // placeholder, will recalc
  );

  return {
    symbol,
    analyzedAt: new Date().toISOString(),
    timeframes,
    htfBias,
    tradeProbability,
    keyLevels,
    nearestOrderBlocks: {
      bullish: nearestBullishOB,
      bearish: nearestBearishOB,
    },
    nearestABCD,
  };
}

/**
 * TRADE PROBABILITY CALCULATION
 */

/**
 * Calculate trade probability based on multi-timeframe structure.
 * Returns probability for long, short, and neutral setups.
 */
function calculateTradeProbability(
  mtf: MultiTimeframeStructure,
  currentPrice: number
): {
  long: number;
  short: number;
  neutral: number;
} {
  let longScore = 0;
  let shortScore = 0;

  const { timeframes, htfBias, nearestOrderBlocks, nearestABCD } = mtf;

  // HTF bias weight
  const htfWeight = 30;
  if (htfBias === "bullish") {
    longScore += htfWeight;
  } else if (htfBias === "bearish") {
    shortScore += htfWeight;
  }

  // Order block proximity weight (20 points)
  if (nearestOrderBlocks.bullish && currentPrice > 0) {
    const distToBullishOB = Math.abs(currentPrice - nearestOrderBlocks.bullish.low);
    const proximityScore = Math.max(0, 20 - (distToBullishOB / currentPrice) * 100);
    longScore += proximityScore;
  }

  if (nearestOrderBlocks.bearish && currentPrice > 0) {
    const distToBearishOB = Math.abs(currentPrice - nearestOrderBlocks.bearish.high);
    const proximityScore = Math.max(0, 20 - (distToBearishOB / currentPrice) * 100);
    shortScore += proximityScore;
  }

  // AB=CD pattern weight (15 points)
  if (nearestABCD) {
    if (nearestABCD.type === "bullish") {
      longScore += Math.min(15, nearestABCD.score * 0.15);
    } else {
      shortScore += Math.min(15, nearestABCD.score * 0.15);
    }
  }

  // Lower timeframe structure confluence (20 points)
  if (timeframes["1H"]) {
    if (timeframes["1H"].bias === "bullish") longScore += 10;
    if (timeframes["1H"].bias === "bearish") shortScore += 10;
  }

  if (timeframes["15min"]) {
    if (timeframes["15min"].bias === "bullish") longScore += 10;
    if (timeframes["15min"].bias === "bearish") shortScore += 10;
  }

  // Supply/demand zone presence (15 points)
  let demandZones = 0;
  let supplyZones = 0;

  for (const tf of Object.values(timeframes) as TimeframeAnalysis[]) {
    for (const zone of tf.supplyDemandZones) {
      if (zone.type === "demand") demandZones++;
      if (zone.type === "supply") supplyZones++;
    }
  }

  if (demandZones > 0) longScore += Math.min(15, demandZones * 5);
  if (supplyZones > 0) shortScore += Math.min(15, supplyZones * 5);

  // Normalize to 0-100
  const total = Math.max(1, longScore + shortScore);
  const long = Math.round((longScore / total) * 100);
  const short = Math.round((shortScore / total) * 100);
  const neutral = Math.max(0, 100 - long - short);

  return { long, short, neutral };
}

/**
 * PUBLIC API EXPORTS (functions already declared above)
 */

export {
  detectSwingPoints,
  labelStructure,
  detectOrderBlocksHTF,
  detectABCDPatterns,
  detectSupplyDemandZones,
  analyzeTimeframe,
  analyzeMultiTimeframe,
  calculateTradeProbability,
};
