/**
 * smc_engine.ts — Smart Money Concepts (SMC) Engine
 *
 * Unified TypeScript implementation of all ICT/SMC price action primitives:
 *   - Swing High/Low detection (pivot-based)
 *   - Market Structure: BOS (Break of Structure) + CHoCH (Change of Character)
 *   - Order Blocks (institutional footprint zones)
 *   - Fair Value Gaps (3-candle imbalance zones)
 *   - Displacement (strong directional intent moves)
 *   - Liquidity Pools (equal highs/lows — stop clusters)
 *
 * All functions are pure (no I/O, no side effects) and operate on
 * simple OHLCV bar arrays compatible with AlpacaBar shape.
 *
 * Reference implementations: godsview-openbb/app/analysis/{structure,order_blocks,fvg,sweep,liquidity}.py
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SMCBar {
  Timestamp: string;
  Open: number;
  High: number;
  Low: number;
  Close: number;
  Volume: number;
}

export interface SwingPoint {
  index: number;
  ts: string;
  price: number;
  kind: "high" | "low";
}

export type StructureTrend = "bullish" | "bearish" | "range";
export type BOSDirection = "bullish" | "bearish" | "none";

export interface StructureState {
  trend: StructureTrend;
  trendReturn20: number;
  /** Break of Structure detected */
  bos: boolean;
  /** Change of Character (BOS against prevailing trend) */
  choch: boolean;
  bosDirection: BOSDirection;
  swingHighs: SwingPoint[];
  swingLows: SwingPoint[];
  /** Price level that invalidates current structure thesis */
  invalidation: number | null;
  /** 0-1 overall structure quality */
  structureScore: number;
  /** Most recent HH/HL or LH/LL pattern */
  pattern: "HH_HL" | "LH_LL" | "mixed" | "insufficient";
}

export interface OrderBlock {
  index: number;
  ts: string;
  side: "bullish" | "bearish";
  low: number;
  high: number;
  mid: number;
  /** 0-1 strength based on volume and body ratio */
  strength: number;
  /** Whether price has returned to this zone */
  tested: boolean;
  /** Whether the OB zone has been fully broken */
  broken: boolean;
}

export interface FairValueGap {
  index: number;
  ts: string;
  side: "bullish" | "bearish";
  low: number;
  high: number;
  sizePct: number;
  /** Whether gap has been partially or fully filled */
  filled: boolean;
  fillPct: number;
}

export interface DisplacementEvent {
  startIndex: number;
  endIndex: number;
  direction: "up" | "down";
  /** Total move in price units */
  magnitude: number;
  /** Move as % of starting price */
  magnitudePct: number;
  /** Number of consecutive directional bars */
  barCount: number;
  /** Average range compared to lookback average */
  rangeMultiple: number;
}

export interface LiquidityPool {
  price: number;
  kind: "equal_highs" | "equal_lows";
  /** Number of touches at this level */
  touches: number;
  firstIndex: number;
  lastIndex: number;
  /** Whether this pool has been swept (price went through then reversed) */
  swept: boolean;
}

export interface SMCState {
  symbol: string;
  structure: StructureState;
  orderBlocks: OrderBlock[];
  fairValueGaps: FairValueGap[];
  displacements: DisplacementEvent[];
  liquidityPools: LiquidityPool[];
  /** Active (untested) order blocks */
  activeOBs: OrderBlock[];
  /** Unfilled fair value gaps */
  unfilledFVGs: FairValueGap[];
  /** Nearest liquidity targets above and below current price */
  nearestLiquidityAbove: LiquidityPool | null;
  nearestLiquidityBelow: LiquidityPool | null;
  /** Computed SMC confluence score 0-1 */
  confluenceScore: number;
  computedAt: string;
}

// ── Swing Detection ────────────────────────────────────────────────────────────

/**
 * Detect swing highs and lows using pivot-based method.
 * A swing high is a bar whose High is greater than the highs of `left` bars before
 * and `right` bars after. Inverse for swing lows.
 */
export function detectSwings(
  bars: SMCBar[],
  left = 2,
  right = 2,
): { highs: SwingPoint[]; lows: SwingPoint[] } {
  const highs: SwingPoint[] = [];
  const lows: SwingPoint[] = [];

  const start = left;
  const end = bars.length - right;

  for (let i = start; i < end; i++) {
    const h = bars[i].High;
    const l = bars[i].Low;

    // Check swing high
    let isSwingHigh = true;
    for (let j = i - left; j < i; j++) {
      if (bars[j].High >= h) { isSwingHigh = false; break; }
    }
    if (isSwingHigh) {
      for (let j = i + 1; j <= i + right; j++) {
        if (bars[j].High >= h) { isSwingHigh = false; break; }
      }
    }
    if (isSwingHigh) {
      highs.push({ index: i, ts: bars[i].Timestamp, price: h, kind: "high" });
    }

    // Check swing low
    let isSwingLow = true;
    for (let j = i - left; j < i; j++) {
      if (bars[j].Low <= l) { isSwingLow = false; break; }
    }
    if (isSwingLow) {
      for (let j = i + 1; j <= i + right; j++) {
        if (bars[j].Low <= l) { isSwingLow = false; break; }
      }
    }
    if (isSwingLow) {
      lows.push({ index: i, ts: bars[i].Timestamp, price: l, kind: "low" });
    }
  }

  return { highs, lows };
}

// ── Market Structure (BOS / CHoCH) ─────────────────────────────────────────────

/**
 * Analyze market structure from bars.
 * Detects Break of Structure (BOS) and Change of Character (CHoCH).
 *
 * BOS = price closes beyond most recent swing high (bullish) or swing low (bearish)
 * CHoCH = BOS that goes AGAINST the prevailing trend (trend reversal signal)
 */
export function analyzeStructure(bars: SMCBar[]): StructureState {
  if (bars.length < 30) {
    return {
      trend: "range",
      trendReturn20: 0,
      bos: false,
      choch: false,
      bosDirection: "none",
      swingHighs: [],
      swingLows: [],
      invalidation: null,
      structureScore: 0,
      pattern: "insufficient",
    };
  }

  const { highs: swingHighs, lows: swingLows } = detectSwings(bars, 3, 3);

  // Trend from 20-bar return
  const closes = bars.map((b) => b.Close);
  const len = closes.length;
  const trendReturn20 =
    closes[len - 21] > 0 ? closes[len - 1] / closes[len - 21] - 1 : 0;

  let trend: StructureTrend = "range";
  if (trendReturn20 > 0.02) trend = "bullish";
  else if (trendReturn20 < -0.02) trend = "bearish";

  // BOS detection
  const lastClose = closes[len - 1];
  const lastHigh = swingHighs.length > 0 ? swingHighs[swingHighs.length - 1].price : null;
  const lastLow = swingLows.length > 0 ? swingLows[swingLows.length - 1].price : null;

  let bos = false;
  let bosDirection: BOSDirection = "none";

  if (lastHigh !== null && lastClose > lastHigh) {
    bos = true;
    bosDirection = "bullish";
  } else if (lastLow !== null && lastClose < lastLow) {
    bos = true;
    bosDirection = "bearish";
  }

  // CHoCH: BOS against the prevailing trend
  const choch =
    bos &&
    ((trend === "bullish" && bosDirection === "bearish") ||
      (trend === "bearish" && bosDirection === "bullish"));

  // HH/HL vs LH/LL pattern detection
  let pattern: StructureState["pattern"] = "insufficient";
  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    const lastTwoHighs = swingHighs.slice(-2);
    const lastTwoLows = swingLows.slice(-2);
    const hh = lastTwoHighs[1].price > lastTwoHighs[0].price;
    const hl = lastTwoLows[1].price > lastTwoLows[0].price;
    const lh = lastTwoHighs[1].price < lastTwoHighs[0].price;
    const ll = lastTwoLows[1].price < lastTwoLows[0].price;

    if (hh && hl) pattern = "HH_HL";
    else if (lh && ll) pattern = "LH_LL";
    else pattern = "mixed";
  }

  // Structure score
  let score = 0.35;
  if (trend !== "range") score += 0.2;
  if (bos) score += 0.25;
  if (choch) score += 0.1;
  score += Math.min(Math.abs(trendReturn20) * 2.5, 0.1);
  score = Math.max(0, Math.min(1, score));

  // Invalidation level
  let invalidation: number | null = null;
  if (bosDirection === "bullish" && lastLow !== null) {
    invalidation = lastLow;
  } else if (bosDirection === "bearish" && lastHigh !== null) {
    invalidation = lastHigh;
  }

  return {
    trend,
    trendReturn20: round4(trendReturn20),
    bos,
    choch,
    bosDirection,
    swingHighs: swingHighs.slice(-20),
    swingLows: swingLows.slice(-20),
    invalidation,
    structureScore: round4(score),
    pattern,
  };
}

// ── Order Block Detection ──────────────────────────────────────────────────────

/**
 * Detect order blocks: the last opposing candle before a strong displacement.
 *
 * Bullish OB: last bearish candle before 2+ bullish follow-though candles
 *             where next candle closes above the OB's high, with above-avg volume.
 * Bearish OB: last bullish candle before 2+ bearish follow-through candles.
 */
export function detectOrderBlocks(bars: SMCBar[], maxBlocks = 50): OrderBlock[] {
  if (bars.length < 8) return [];

  const avgVol = bars.reduce((s, b) => s + b.Volume, 0) / bars.length;
  const blocks: OrderBlock[] = [];
  const lastClose = bars[bars.length - 1].Close;

  for (let i = 2; i < bars.length - 2; i++) {
    const prev = bars[i - 1];
    const bar = bars[i];
    const n1 = bars[i + 1];
    const n2 = bars[i + 2];

    const barRange = Math.max(bar.High - bar.Low, 1e-8);
    const bodySize = Math.abs(bar.Close - bar.Open);
    const bodyRatio = bodySize / barRange;
    const volStrength = avgVol > 0 ? bar.Volume / avgVol : 1;

    // Bullish OB: bearish bar → 2 bullish bars, next candle breaks above
    const bullish =
      bar.Close < bar.Open &&
      n1.Close > n1.Open &&
      n2.Close > n2.Open &&
      n1.Close > bar.High &&
      volStrength > 1.05;

    // Bearish OB: bullish bar → 2 bearish bars, next candle breaks below
    const bearish =
      bar.Close > bar.Open &&
      n1.Close < n1.Open &&
      n2.Close < n2.Open &&
      n1.Close < bar.Low &&
      volStrength > 1.05;

    if (!bullish && !bearish) continue;

    const low = Math.min(bar.Low, prev.Low);
    const high = Math.max(bar.High, prev.High);
    const mid = (low + high) / 2;
    const side = bullish ? "bullish" : "bearish";

    // Check if OB has been tested (price returned to zone)
    let tested = false;
    let broken = false;
    for (let j = i + 3; j < bars.length; j++) {
      if (side === "bullish") {
        if (bars[j].Low <= high && bars[j].Low >= low) tested = true;
        if (bars[j].Close < low) { broken = true; break; }
      } else {
        if (bars[j].High >= low && bars[j].High <= high) tested = true;
        if (bars[j].Close > high) { broken = true; break; }
      }
    }

    blocks.push({
      index: i,
      ts: bar.Timestamp,
      side,
      low: round4(low),
      high: round4(high),
      mid: round4(mid),
      strength: round4(Math.min(1, volStrength * 0.5 + (1 - bodyRatio) * 0.5)),
      tested,
      broken,
    });
  }

  return blocks.slice(-maxBlocks);
}

// ── Fair Value Gap Detection ───────────────────────────────────────────────────

/**
 * Detect Fair Value Gaps (FVG) — 3-candle imbalance zones.
 *
 * Bullish FVG: bar[i].Low > bar[i-2].High (gap up, price moved too fast)
 * Bearish FVG: bar[i].High < bar[i-2].Low (gap down)
 *
 * Also tracks fill status based on subsequent price action.
 */
export function detectFVG(bars: SMCBar[], maxGaps = 100): FairValueGap[] {
  if (bars.length < 5) return [];

  const gaps: FairValueGap[] = [];

  for (let i = 2; i < bars.length; i++) {
    const b0 = bars[i - 2]; // candle before the gap
    const b2 = bars[i]; // candle after the gap

    // Bullish FVG: current low above 2-bars-ago high
    if (b2.Low > b0.High) {
      const low = b0.High;
      const high = b2.Low;
      const gapSize = high - low;

      // Check fill status from subsequent bars
      let maxFill = 0;
      for (let j = i + 1; j < bars.length; j++) {
        const reachDown = high - bars[j].Low;
        if (reachDown > 0) {
          maxFill = Math.max(maxFill, reachDown / gapSize);
        }
      }

      gaps.push({
        index: i,
        ts: bars[i].Timestamp,
        side: "bullish",
        low: round6(low),
        high: round6(high),
        sizePct: round6((high - low) / Math.max(low, 1e-9)),
        filled: maxFill >= 0.95,
        fillPct: round4(Math.min(1, maxFill)),
      });
    }

    // Bearish FVG: current high below 2-bars-ago low
    if (b2.High < b0.Low) {
      const low = b2.High;
      const high = b0.Low;
      const gapSize = high - low;

      let maxFill = 0;
      for (let j = i + 1; j < bars.length; j++) {
        const reachUp = bars[j].High - low;
        if (reachUp > 0) {
          maxFill = Math.max(maxFill, reachUp / gapSize);
        }
      }

      gaps.push({
        index: i,
        ts: bars[i].Timestamp,
        side: "bearish",
        low: round6(low),
        high: round6(high),
        sizePct: round6((high - low) / Math.max(high, 1e-9)),
        filled: maxFill >= 0.95,
        fillPct: round4(Math.min(1, maxFill)),
      });
    }
  }

  return gaps.slice(-maxGaps);
}

// ── Displacement Detection ─────────────────────────────────────────────────────

/**
 * Detect displacement events: strong, fast directional moves showing
 * institutional intent.
 *
 * A displacement is 3+ consecutive bars in the same direction where each
 * bar's range is above-average — showing strong commitment, not just drift.
 */
export function detectDisplacement(
  bars: SMCBar[],
  minBars = 3,
  minRangeMultiple = 1.2,
): DisplacementEvent[] {
  if (bars.length < minBars + 10) return [];

  // Compute average range for normalization
  const ranges = bars.map((b) => b.High - b.Low);
  const avgRange = ranges.reduce((s, r) => s + r, 0) / ranges.length;
  if (avgRange < 1e-8) return [];

  const events: DisplacementEvent[] = [];
  let i = 0;

  while (i < bars.length) {
    const dir = bars[i].Close >= bars[i].Open ? "up" : "down";
    let runLen = 1;
    let totalRangeMultiple = ranges[i] / avgRange;

    // Extend consecutive same-direction bars
    for (let j = i + 1; j < bars.length; j++) {
      const jDir = bars[j].Close >= bars[j].Open ? "up" : "down";
      const jRangeMultiple = ranges[j] / avgRange;
      if (jDir === dir && jRangeMultiple >= minRangeMultiple * 0.7) {
        runLen++;
        totalRangeMultiple += jRangeMultiple;
      } else {
        break;
      }
    }

    const avgMultiple = totalRangeMultiple / runLen;

    if (runLen >= minBars && avgMultiple >= minRangeMultiple) {
      const endIdx = i + runLen - 1;
      const startPrice = bars[i].Open;
      const endPrice = bars[endIdx].Close;
      const magnitude = Math.abs(endPrice - startPrice);

      events.push({
        startIndex: i,
        endIndex: endIdx,
        direction: dir,
        magnitude: round4(magnitude),
        magnitudePct: round6(magnitude / Math.max(startPrice, 1e-9)),
        barCount: runLen,
        rangeMultiple: round4(avgMultiple),
      });
    }

    i += Math.max(runLen, 1);
  }

  return events;
}

// ── Liquidity Pool Detection ───────────────────────────────────────────────────

/**
 * Detect liquidity pools: clusters of equal highs or equal lows that
 * represent stop-loss clusters and liquidity targets.
 *
 * Uses tolerance-based matching to find price levels that have been touched
 * multiple times, creating a target for smart money sweeps.
 */
export function detectLiquidityPools(
  bars: SMCBar[],
  tolerancePct = 0.0015,
): LiquidityPool[] {
  if (bars.length < 10) return [];

  // Build level clusters
  const highLevels = new Map<number, { touches: number; firstIdx: number; lastIdx: number }>();
  const lowLevels = new Map<number, { touches: number; firstIdx: number; lastIdx: number }>();

  // Group nearby highs together
  const highPrices: Array<{ price: number; index: number }> = bars.map((b, i) => ({
    price: b.High,
    index: i,
  }));
  const lowPrices: Array<{ price: number; index: number }> = bars.map((b, i) => ({
    price: b.Low,
    index: i,
  }));

  function clusterLevels(
    prices: Array<{ price: number; index: number }>,
    kind: "equal_highs" | "equal_lows",
  ): LiquidityPool[] {
    const pools: LiquidityPool[] = [];
    const used = new Set<number>();

    for (let i = 0; i < prices.length; i++) {
      if (used.has(i)) continue;

      const cluster: number[] = [i];
      const basePrice = prices[i].price;

      for (let j = i + 1; j < prices.length; j++) {
        if (used.has(j)) continue;
        if (Math.abs(prices[j].price - basePrice) / Math.max(basePrice, 1e-9) <= tolerancePct) {
          cluster.push(j);
        }
      }

      if (cluster.length >= 2) {
        const avgPrice =
          cluster.reduce((s, idx) => s + prices[idx].price, 0) / cluster.length;
        const firstIndex = Math.min(...cluster.map((idx) => prices[idx].index));
        const lastIndex = Math.max(...cluster.map((idx) => prices[idx].index));

        // Check if swept: price went through this level then reversed
        let swept = false;
        const lastClose = bars[bars.length - 1].Close;
        if (kind === "equal_highs") {
          // Swept if price went above then closed back below
          const wentAbove = bars.some(
            (b, bi) => bi > lastIndex && b.High > avgPrice * (1 + tolerancePct),
          );
          swept = wentAbove && lastClose < avgPrice;
        } else {
          const wentBelow = bars.some(
            (b, bi) => bi > lastIndex && b.Low < avgPrice * (1 - tolerancePct),
          );
          swept = wentBelow && lastClose > avgPrice;
        }

        pools.push({
          price: round4(avgPrice),
          kind,
          touches: cluster.length,
          firstIndex,
          lastIndex,
          swept,
        });

        for (const idx of cluster) used.add(idx);
      }
    }

    return pools;
  }

  const equalHighs = clusterLevels(highPrices, "equal_highs");
  const equalLows = clusterLevels(lowPrices, "equal_lows");

  return [...equalHighs, ...equalLows].sort((a, b) => a.price - b.price);
}

// ── Combined SMC State ─────────────────────────────────────────────────────────

/**
 * Compute full SMC state for a symbol from multi-timeframe bars.
 * Uses 1m bars for fine-grained detection and 5m bars for structure context.
 */
export function computeSMCState(
  symbol: string,
  bars1m: SMCBar[],
  bars5m: SMCBar[],
): SMCState {
  // Use 5m for structure (higher timeframe bias) and 1m for entries
  const structure = analyzeStructure(bars5m.length >= 30 ? bars5m : bars1m);
  const orderBlocks = detectOrderBlocks(bars1m);
  const fairValueGaps = detectFVG(bars1m);
  const displacements = detectDisplacement(bars1m);
  const liquidityPools = detectLiquidityPools(bars5m.length >= 30 ? bars5m : bars1m);

  // Filter active (untested, unbroken) order blocks
  const activeOBs = orderBlocks.filter((ob) => !ob.broken && !ob.tested);

  // Filter unfilled FVGs
  const unfilledFVGs = fairValueGaps.filter((fvg) => !fvg.filled);

  // Find nearest liquidity targets
  const currentPrice = bars1m.length > 0 ? bars1m[bars1m.length - 1].Close : 0;
  const unsweptPools = liquidityPools.filter((p) => !p.swept);
  const poolsAbove = unsweptPools
    .filter((p) => p.price > currentPrice)
    .sort((a, b) => a.price - b.price);
  const poolsBelow = unsweptPools
    .filter((p) => p.price < currentPrice)
    .sort((a, b) => b.price - a.price);

  // Confluence score: how many SMC elements align
  let confluenceScore = 0;
  const weights = { structure: 0.30, obs: 0.25, fvgs: 0.20, displacement: 0.15, liquidity: 0.10 };

  // Structure contribution
  confluenceScore += structure.structureScore * weights.structure;

  // Active OBs near price contribute more
  const nearOBs = activeOBs.filter(
    (ob) =>
      Math.abs(ob.mid - currentPrice) / Math.max(currentPrice, 1e-9) < 0.02,
  );
  confluenceScore += Math.min(nearOBs.length / 3, 1) * weights.obs;

  // Unfilled FVGs near price
  const nearFVGs = unfilledFVGs.filter(
    (fvg) =>
      Math.abs((fvg.low + fvg.high) / 2 - currentPrice) /
        Math.max(currentPrice, 1e-9) <
      0.02,
  );
  confluenceScore += Math.min(nearFVGs.length / 2, 1) * weights.fvgs;

  // Recent displacement
  const recentDisplacements = displacements.filter(
    (d) => d.endIndex >= bars1m.length - 10,
  );
  confluenceScore +=
    Math.min(recentDisplacements.length, 1) * weights.displacement;

  // Liquidity targets
  const hasNearbyLiquidity =
    (poolsAbove.length > 0 &&
      (poolsAbove[0].price - currentPrice) / currentPrice < 0.01) ||
    (poolsBelow.length > 0 &&
      (currentPrice - poolsBelow[0].price) / currentPrice < 0.01);
  confluenceScore += (hasNearbyLiquidity ? 1 : 0.3) * weights.liquidity;

  return {
    symbol,
    structure,
    orderBlocks,
    fairValueGaps,
    displacements,
    liquidityPools,
    activeOBs,
    unfilledFVGs,
    nearestLiquidityAbove: poolsAbove[0] ?? null,
    nearestLiquidityBelow: poolsBelow[0] ?? null,
    confluenceScore: round4(Math.max(0, Math.min(1, confluenceScore))),
    computedAt: new Date().toISOString(),
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function round6(n: number): number {
  return Math.round(n * 1000000) / 1000000;
}
