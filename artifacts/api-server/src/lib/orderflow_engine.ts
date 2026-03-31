/**
 * orderflow_engine.ts — Enhanced Order Flow Engine
 *
 * Comprehensive order flow analysis combining:
 *   - Delta (buy vol - sell vol) estimation from OHLCV
 *   - Cumulative Volume Delta (CVD) with slope/momentum
 *   - Quote imbalance from live orderbook
 *   - Absorption detection (large delta + no price movement)
 *   - Sweep event detection from orderbook + price
 *   - Per-candle orderflow packet for Brain Focus Mode
 *
 * Extends the existing CVD engine from strategy_engine.ts and
 * liquidity map from market/liquidityMap.ts with event-level detection.
 */

import type { OrderBookSnapshot, PriceLevel } from "./market/types";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface OrderflowBar {
  Timestamp: string;
  Open: number;
  High: number;
  Low: number;
  Close: number;
  Volume: number;
}

export interface OrderflowState {
  /** Net buying - selling volume for most recent bar */
  delta: number;
  /** Cumulative volume delta over the analysis window */
  cvd: number;
  /** Slope of CVD (positive = growing buy pressure) */
  cvdSlope: number;
  /** (bidSize - askSize) / (bidSize + askSize) from orderbook */
  quoteImbalance: number;
  /** Estimated spread in basis points */
  spreadBps: number;
  /** 0-1 how aggressively one side is trading */
  aggressionScore: number;
  /** Overall buy/sell bias */
  orderflowBias: "bullish" | "bearish" | "neutral";
  /** 0-1 composite orderflow quality score */
  orderflowScore: number;
  /** Buy volume ratio 0-1 */
  buyVolumeRatio: number;
  /** Whether last bar had outsized delta */
  largeDeltaBar: boolean;
  /** Price vs CVD divergence detected */
  divergence: boolean;
}

export interface LiquidityMapState {
  /** Strongest bid concentration price */
  strongestBidLevel: number | null;
  /** Strongest ask concentration price */
  strongestAskLevel: number | null;
  /** Total resting liquidity above current price (normalized) */
  liquidityAbove: number;
  /** Total resting liquidity below current price (normalized) */
  liquidityBelow: number;
  /** Thin zone detected — price likely to move fast through */
  thinZoneDetected: boolean;
  /** Liquidity pull/stack event: large order placed or removed */
  pullStackEvent: boolean;
  /** 0-1 overall liquidity quality */
  liquidityScore: number;
}

export type MicrostructureEventType =
  | "absorption_bid"
  | "absorption_ask"
  | "buy_side_sweep"
  | "sell_side_sweep"
  | "thin_liquidity_break"
  | "delta_spike"
  | "none";

export interface MicrostructureEvent {
  ts: string;
  eventType: MicrostructureEventType;
  /** 0-1 intensity of the event */
  intensity: number;
  /** Human description */
  description: string;
}

export interface CandleOrderflowPacket {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  delta: number;
  cvdChange: number;
  spreadAvg: number;
  buyVolume: number;
  sellVolume: number;
  imbalance: number;
  /** Detected microstructure events for this candle */
  events: MicrostructureEvent[];
}

// ── Delta & CVD Estimation ─────────────────────────────────────────────────────

/**
 * Estimate buying volume from OHLCV using candle direction + close position.
 * 60% candle direction pressure + 40% close ratio.
 */
function estimateBuyVolume(bar: OrderflowBar): number {
  const range = bar.High - bar.Low;
  const closeRatio = range > 0 ? (bar.Close - bar.Low) / range : 0.5;
  const candleBull = bar.Close >= bar.Open;
  const candleBody = range > 0 ? Math.abs(bar.Close - bar.Open) / range : 0;
  const domPressure = candleBull
    ? 0.5 + candleBody * 0.4
    : 0.5 - candleBody * 0.4;
  const blended = domPressure * 0.60 + closeRatio * 0.40;
  return bar.Volume * blended;
}

function estimateSellVolume(bar: OrderflowBar): number {
  return bar.Volume - estimateBuyVolume(bar);
}

/**
 * Compute full orderflow state from bars + optional orderbook snapshot.
 */
export function computeOrderflowState(
  bars: OrderflowBar[],
  orderbook?: OrderBookSnapshot | null,
): OrderflowState {
  const defaultState: OrderflowState = {
    delta: 0,
    cvd: 0,
    cvdSlope: 0,
    quoteImbalance: 0,
    spreadBps: 0,
    aggressionScore: 0,
    orderflowBias: "neutral",
    orderflowScore: 0,
    buyVolumeRatio: 0.5,
    largeDeltaBar: false,
    divergence: false,
  };

  if (bars.length < 10) return defaultState;

  const window = bars.slice(-30);
  const n = window.length;

  // Compute per-bar deltas and CVD
  const deltas = window.map((b) => estimateBuyVolume(b) - estimateSellVolume(b));
  let cumulative = 0;
  const cvdSeries = deltas.map((d) => (cumulative += d));

  const cvd = cvdSeries[cvdSeries.length - 1];
  const delta = deltas[deltas.length - 1];

  // CVD slope: linear regression over recent 10 bars
  const recentCVD = cvdSeries.slice(-10);
  const cvdSlope = linearSlope(recentCVD);

  // Buy volume ratio
  const totalVol = window.reduce((s, b) => s + b.Volume, 0);
  const buyVol = window.reduce((s, b) => s + estimateBuyVolume(b), 0);
  const buyVolumeRatio = totalVol > 0 ? buyVol / totalVol : 0.5;

  // Large delta bar: last bar's |delta| > 2× average
  const avgDelta = deltas.reduce((s, d) => s + Math.abs(d), 0) / n;
  const largeDeltaBar = avgDelta > 0 && Math.abs(delta) > avgDelta * 2;

  // Price vs CVD divergence
  const priceSlope = linearSlope(window.slice(-10).map((b) => b.Close));
  const divergence =
    (priceSlope > 0.0005 && cvdSlope < -0.0005) ||
    (priceSlope < -0.0005 && cvdSlope > 0.0005);

  // Orderbook-derived metrics
  let quoteImbalance = 0;
  let spreadBps = 0;
  if (orderbook && orderbook.bids.length > 0 && orderbook.asks.length > 0) {
    const depth = 10;
    const topBids = orderbook.bids.slice(0, depth);
    const topAsks = orderbook.asks.slice(0, depth);
    const bidVol = topBids.reduce((s, l) => s + l.size, 0);
    const askVol = topAsks.reduce((s, l) => s + l.size, 0);
    const totalBookVol = bidVol + askVol;
    quoteImbalance = totalBookVol > 0 ? (bidVol - askVol) / totalBookVol : 0;

    const bestBid = topBids[0].price;
    const bestAsk = topAsks[0].price;
    const mid = (bestBid + bestAsk) / 2;
    spreadBps = mid > 0 ? ((bestAsk - bestBid) / mid) * 10000 : 0;
  }

  // Aggression score: how strongly one side is dominating
  const aggressionScore = Math.min(
    1,
    Math.abs(buyVolumeRatio - 0.5) * 4 * 0.5 +
    Math.abs(quoteImbalance) * 0.3 +
    (largeDeltaBar ? 0.2 : 0),
  );

  // Bias
  const biasScore =
    (buyVolumeRatio - 0.5) * 0.4 +
    quoteImbalance * 0.3 +
    Math.sign(cvdSlope) * 0.3;
  const orderflowBias: OrderflowState["orderflowBias"] =
    biasScore > 0.1 ? "bullish" : biasScore < -0.1 ? "bearish" : "neutral";

  // Composite score
  const orderflowScore = Math.max(
    0,
    Math.min(
      1,
      0.3 +
        aggressionScore * 0.3 +
        (1 - Math.abs(quoteImbalance)) * 0.1 + // tight book = good
        (spreadBps > 0 ? Math.max(0, 1 - spreadBps / 30) * 0.15 : 0.15) +
        (divergence ? 0.15 : 0),
    ),
  );

  return {
    delta: Math.round(delta),
    cvd: Math.round(cvd),
    cvdSlope: round4(cvdSlope),
    quoteImbalance: round4(quoteImbalance),
    spreadBps: round2(spreadBps),
    aggressionScore: round4(aggressionScore),
    orderflowBias,
    orderflowScore: round4(orderflowScore),
    buyVolumeRatio: round4(buyVolumeRatio),
    largeDeltaBar,
    divergence,
  };
}

// ── Liquidity Map State ────────────────────────────────────────────────────────

/**
 * Compute liquidity map state from a live orderbook snapshot.
 * Identifies where the heaviest resting orders are, and whether
 * there are thin zones that price could break through quickly.
 */
export function computeLiquidityMapState(
  orderbook: OrderBookSnapshot | null,
): LiquidityMapState {
  const defaultState: LiquidityMapState = {
    strongestBidLevel: null,
    strongestAskLevel: null,
    liquidityAbove: 0,
    liquidityBelow: 0,
    thinZoneDetected: false,
    pullStackEvent: false,
    liquidityScore: 0,
  };

  if (!orderbook || orderbook.bids.length === 0 || orderbook.asks.length === 0) {
    return defaultState;
  }

  const depth = 20;
  const bids = orderbook.bids.slice(0, depth);
  const asks = orderbook.asks.slice(0, depth);

  const bestBid = bids[0].price;
  const bestAsk = asks[0].price;
  const mid = (bestBid + bestAsk) / 2;

  // Find strongest bid and ask levels
  let maxBidSize = 0;
  let strongestBidLevel: number | null = null;
  for (const level of bids) {
    if (level.size > maxBidSize) {
      maxBidSize = level.size;
      strongestBidLevel = level.price;
    }
  }

  let maxAskSize = 0;
  let strongestAskLevel: number | null = null;
  for (const level of asks) {
    if (level.size > maxAskSize) {
      maxAskSize = level.size;
      strongestAskLevel = level.price;
    }
  }

  // Total liquidity above and below mid
  const totalBidSize = bids.reduce((s, l) => s + l.size, 0);
  const totalAskSize = asks.reduce((s, l) => s + l.size, 0);
  const totalSize = totalBidSize + totalAskSize;

  const liquidityBelow = totalSize > 0 ? totalBidSize / totalSize : 0;
  const liquidityAbove = totalSize > 0 ? totalAskSize / totalSize : 0;

  // Thin zone detection: any gap > 2× average level spacing
  const avgBidSpacing =
    bids.length >= 2 ? (bids[0].price - bids[bids.length - 1].price) / (bids.length - 1) : 0;
  const avgAskSpacing =
    asks.length >= 2 ? (asks[asks.length - 1].price - asks[0].price) / (asks.length - 1) : 0;

  let thinZoneDetected = false;
  for (let i = 1; i < bids.length; i++) {
    if (bids[i - 1].price - bids[i].price > avgBidSpacing * 3) {
      thinZoneDetected = true;
      break;
    }
  }
  if (!thinZoneDetected) {
    for (let i = 1; i < asks.length; i++) {
      if (asks[i].price - asks[i - 1].price > avgAskSpacing * 3) {
        thinZoneDetected = true;
        break;
      }
    }
  }

  // Pull/stack: very large size at best bid or ask (>5× average)
  const avgLevelSize = totalSize / (bids.length + asks.length);
  const pullStackEvent =
    (bids[0].size > avgLevelSize * 5) || (asks[0].size > avgLevelSize * 5);

  // Liquidity score: higher = better execution conditions
  const spread = bestAsk - bestBid;
  const spreadPct = mid > 0 ? spread / mid : 0;
  const depthQuality = Math.min(1, totalSize / (avgLevelSize * 40 || 1));
  const liquidityScore = Math.max(
    0,
    Math.min(
      1,
      (1 - Math.min(spreadPct * 200, 1)) * 0.4 +
        depthQuality * 0.3 +
        (thinZoneDetected ? 0 : 0.15) +
        (pullStackEvent ? 0.15 : 0),
    ),
  );

  return {
    strongestBidLevel,
    strongestAskLevel,
    liquidityAbove: round4(liquidityAbove),
    liquidityBelow: round4(liquidityBelow),
    thinZoneDetected,
    pullStackEvent,
    liquidityScore: round4(liquidityScore),
  };
}

// ── Absorption Detection ───────────────────────────────────────────────────────

/**
 * Detect absorption: price hits a level with heavy volume but doesn't move.
 * This indicates resting orders are absorbing aggressive flow.
 *
 * Detection: high |delta| + low price change = absorption.
 */
export function detectAbsorption(
  bars: OrderflowBar[],
  orderbook?: OrderBookSnapshot | null,
): MicrostructureEvent[] {
  if (bars.length < 5) return [];

  const events: MicrostructureEvent[] = [];
  const window = bars.slice(-10);

  // Average range and delta for baseline
  const avgRange =
    window.reduce((s, b) => s + (b.High - b.Low), 0) / window.length;
  const deltas = window.map((b) => estimateBuyVolume(b) - estimateSellVolume(b));
  const avgAbsDelta =
    deltas.reduce((s, d) => s + Math.abs(d), 0) / deltas.length;

  for (let i = Math.max(0, window.length - 3); i < window.length; i++) {
    const bar = window[i];
    const range = bar.High - bar.Low;
    const d = deltas[i];

    // Absorption: high volume (large delta) but small range
    if (
      Math.abs(d) > avgAbsDelta * 1.5 &&
      range < avgRange * 0.6
    ) {
      const isBidAbsorption = d > 0; // Buying pressure absorbed → bearish signal
      events.push({
        ts: bar.Timestamp,
        eventType: isBidAbsorption ? "absorption_bid" : "absorption_ask",
        intensity: round4(
          Math.min(1, (Math.abs(d) / avgAbsDelta - 1) * 0.5),
        ),
        description: isBidAbsorption
          ? "Heavy buying absorbed at resistance — potential exhaustion"
          : "Heavy selling absorbed at support — potential reversal",
      });
    }

    // Delta spike without absorption (large move + large delta)
    if (Math.abs(d) > avgAbsDelta * 2.5 && range > avgRange) {
      events.push({
        ts: bar.Timestamp,
        eventType: "delta_spike",
        intensity: round4(
          Math.min(1, (Math.abs(d) / avgAbsDelta - 2) * 0.3),
        ),
        description: d > 0
          ? "Strong buying delta spike — aggressive buyers"
          : "Strong selling delta spike — aggressive sellers",
      });
    }
  }

  return events;
}

// ── Sweep Event Detection ──────────────────────────────────────────────────────

/**
 * Detect sweep events: price quickly runs through a known level then reverses.
 *
 * Uses recent swing highs/lows as "known levels" and checks if price
 * broke through then reversed within 2-3 bars.
 */
export function detectSweepEvent(
  bars: OrderflowBar[],
): MicrostructureEvent[] {
  if (bars.length < 15) return [];

  const events: MicrostructureEvent[] = [];
  const lookback = bars.slice(-20);
  const pivot = lookback.slice(0, -3);
  const recent = lookback.slice(-3);

  const prevHigh = Math.max(...pivot.map((b) => b.High));
  const prevLow = Math.min(...pivot.map((b) => b.Low));
  const recentHigh = Math.max(...recent.map((b) => b.High));
  const recentLow = Math.min(...recent.map((b) => b.Low));
  const lastClose = recent[recent.length - 1].Close;

  // Buy-side sweep: price went above previous highs then closed back below
  if (recentHigh > prevHigh && lastClose < prevHigh) {
    events.push({
      ts: recent[recent.length - 1].Timestamp,
      eventType: "buy_side_sweep",
      intensity: round4(
        Math.min(1, (recentHigh - prevHigh) / Math.max(prevHigh * 0.005, 1e-9)),
      ),
      description: `Buy-side liquidity swept at ${prevHigh.toFixed(2)} — price rejected back below`,
    });
  }

  // Sell-side sweep: price went below previous lows then closed back above
  if (recentLow < prevLow && lastClose > prevLow) {
    events.push({
      ts: recent[recent.length - 1].Timestamp,
      eventType: "sell_side_sweep",
      intensity: round4(
        Math.min(1, (prevLow - recentLow) / Math.max(prevLow * 0.005, 1e-9)),
      ),
      description: `Sell-side liquidity swept at ${prevLow.toFixed(2)} — price rejected back above`,
    });
  }

  return events;
}

// ── Candle Orderflow Packet ────────────────────────────────────────────────────

/**
 * Build a per-candle orderflow packet summarizing microstructure
 * for the Brain Focus Mode candle inspector.
 */
export function buildCandlePackets(
  bars: OrderflowBar[],
  orderbook?: OrderBookSnapshot | null,
  count = 20,
): CandleOrderflowPacket[] {
  const recentBars = bars.slice(-count);
  if (recentBars.length === 0) return [];

  // Pre-compute running CVD
  let runningCVD = 0;
  const cvdValues: number[] = [];
  for (const bar of recentBars) {
    const buyVol = estimateBuyVolume(bar);
    const sellVol = estimateSellVolume(bar);
    runningCVD += buyVol - sellVol;
    cvdValues.push(runningCVD);
  }

  const packets: CandleOrderflowPacket[] = [];
  const absorptionEvents = detectAbsorption(bars, orderbook);
  const sweepEvents = detectSweepEvent(bars);
  const allEvents = [...absorptionEvents, ...sweepEvents];

  for (let i = 0; i < recentBars.length; i++) {
    const bar = recentBars[i];
    const buyVol = estimateBuyVolume(bar);
    const sellVol = estimateSellVolume(bar);
    const delta = buyVol - sellVol;
    const cvdChange = i > 0 ? cvdValues[i] - cvdValues[i - 1] : cvdValues[i];

    // Spread estimate from bar range vs body
    const range = bar.High - bar.Low;
    const mid = (bar.High + bar.Low) / 2;
    const spreadAvg = mid > 0 ? (range * 0.1) / mid * 10000 : 0; // rough estimate

    // Imbalance for this bar
    const imbalance = bar.Volume > 0 ? (buyVol - sellVol) / bar.Volume : 0;

    // Events for this candle timestamp
    const candleEvents = allEvents.filter((e) => e.ts === bar.Timestamp);

    packets.push({
      ts: bar.Timestamp,
      open: bar.Open,
      high: bar.High,
      low: bar.Low,
      close: bar.Close,
      volume: bar.Volume,
      delta: Math.round(delta),
      cvdChange: Math.round(cvdChange),
      spreadAvg: round2(spreadAvg),
      buyVolume: Math.round(buyVol),
      sellVolume: Math.round(sellVol),
      imbalance: round4(imbalance),
      events: candleEvents,
    });
  }

  return packets;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function linearSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  // Normalize to avoid numerical issues
  const first = values[0];
  const last = values[n - 1];
  if (Math.abs(first) < 1e-12) return last > 0 ? 1 : last < 0 ? -1 : 0;
  return (last - first) / Math.abs(first);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
