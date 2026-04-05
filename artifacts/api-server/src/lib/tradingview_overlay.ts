/**
 * tradingview_overlay.ts — TradingView MCP Overlay (Phase 53)
 *
 * Generates chart overlay schemas for TradingView-compatible rendering:
 *   - Structure levels (support/resistance)
 *   - Order blocks (supply/demand zones)
 *   - Position overlays (entry, stops, targets)
 *   - Signal markers (buy/sell arrows)
 *   - Indicator overlays (custom lines/zones)
 *   - HTF market structure integration
 */

import { logger } from "./logger.js";
import {
  analyzeTimeframe,
  analyzeMultiTimeframe,
  type Bar as HTFBar,
  type Timeframe as HTFTimeframe,
  type OrderBlockHTF,
  type ABCDPattern,
  type MultiTimeframeStructure,
  type SupplyDemandZone,
} from "../engines/market_structure_htf.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type OverlayType = "structure" | "orderblock" | "position" | "signal" | "indicator" | "zone";

export interface OverlayColor {
  r: number; g: number; b: number; a: number;
}

export interface StructureLevel {
  id: string;
  type: "support" | "resistance";
  price: number;
  strength: number; // 1-5
  touches: number;
  firstSeen: string;
  lastTested: string;
  broken: boolean;
}

export interface OrderBlock {
  id: string;
  type: "supply" | "demand";
  high: number;
  low: number;
  volume: number;
  timeframe: string;
  createdAt: string;
  mitigated: boolean;
}

export interface PositionOverlay {
  id: string;
  symbol: string;
  direction: "long" | "short";
  entryPrice: number;
  currentStop: number;
  targets: { price: number; label: string; hit: boolean }[];
  quantity: number;
  unrealizedPnl: number;
  openedAt: string;
}

export interface SignalMarker {
  id: string;
  symbol: string;
  type: "buy" | "sell" | "alert" | "info";
  price: number;
  timestamp: string;
  label: string;
  confidence: number;
  source: string;
}

export interface IndicatorLine {
  id: string;
  name: string;
  values: { time: string; value: number }[];
  color: OverlayColor;
  lineWidth: number;
  style: "solid" | "dashed" | "dotted";
}

export interface ChartOverlay {
  symbol: string;
  timeframe: string;
  structures: StructureLevel[];
  orderBlocks: OrderBlock[];
  positions: PositionOverlay[];
  signals: SignalMarker[];
  indicators: IndicatorLine[];
  generatedAt: string;
}

export interface OverlaySnapshot {
  totalOverlaysGenerated: number;
  activeSymbols: string[];
  structureLevels: number;
  orderBlocks: number;
  activePositions: number;
  recentSignals: number;
}

// ─── State ────────────────────────────────────────────────────────────────────

const overlayCache = new Map<string, ChartOverlay>();
let totalGenerated = 0;
const MAX_CACHE = 50;

// ─── Color Helpers ────────────────────────────────────────────────────────────

const COLORS = {
  support: { r: 34, g: 197, b: 94, a: 0.8 },    // green
  resistance: { r: 239, g: 68, b: 68, a: 0.8 },  // red
  demand: { r: 59, g: 130, b: 246, a: 0.4 },      // blue zone
  supply: { r: 249, g: 115, b: 22, a: 0.4 },      // orange zone
  buySignal: { r: 34, g: 197, b: 94, a: 1 },
  sellSignal: { r: 239, g: 68, b: 68, a: 1 },
  stopLine: { r: 239, g: 68, b: 68, a: 0.6 },
  targetLine: { r: 34, g: 197, b: 94, a: 0.6 },
};

// ─── Renderers ────────────────────────────────────────────────────────────────

export function renderStructureLevels(params: {
  symbol: string;
  currentPrice: number;
  levels?: { price: number; type?: "support" | "resistance"; strength?: number; touches?: number }[];
}): StructureLevel[] {
  const { symbol, currentPrice, levels = [] } = params;
  const now = new Date().toISOString();

  if (levels.length > 0) {
    return levels.map((l, i) => ({
      id: `struct_${symbol}_${i}`,
      type: l.type ?? (l.price < currentPrice ? "support" : "resistance"),
      price: l.price,
      strength: l.strength ?? 3,
      touches: l.touches ?? 1,
      firstSeen: now,
      lastTested: now,
      broken: false,
    }));
  }

  // Auto-generate based on price
  const step = currentPrice * 0.02;
  return [
    { id: `struct_${symbol}_s1`, type: "support" as const, price: parseFloat((currentPrice - step).toFixed(2)), strength: 3, touches: 2, firstSeen: now, lastTested: now, broken: false },
    { id: `struct_${symbol}_s2`, type: "support" as const, price: parseFloat((currentPrice - step * 2.5).toFixed(2)), strength: 4, touches: 3, firstSeen: now, lastTested: now, broken: false },
    { id: `struct_${symbol}_r1`, type: "resistance" as const, price: parseFloat((currentPrice + step).toFixed(2)), strength: 3, touches: 1, firstSeen: now, lastTested: now, broken: false },
    { id: `struct_${symbol}_r2`, type: "resistance" as const, price: parseFloat((currentPrice + step * 2).toFixed(2)), strength: 5, touches: 4, firstSeen: now, lastTested: now, broken: false },
  ];
}

export function renderOrderBlocks(params: {
  symbol: string;
  currentPrice: number;
  blocks?: { high: number; low: number; type?: "supply" | "demand"; volume?: number }[];
}): OrderBlock[] {
  const { symbol, currentPrice, blocks = [] } = params;
  const now = new Date().toISOString();

  if (blocks.length > 0) {
    return blocks.map((b, i) => ({
      id: `ob_${symbol}_${i}`,
      type: b.type ?? (b.high < currentPrice ? "demand" : "supply"),
      high: b.high, low: b.low,
      volume: b.volume ?? 0,
      timeframe: "1D",
      createdAt: now,
      mitigated: false,
    }));
  }

  const atrEst = currentPrice * 0.015;
  return [
    { id: `ob_${symbol}_d1`, type: "demand" as const, high: parseFloat((currentPrice - atrEst * 2).toFixed(2)), low: parseFloat((currentPrice - atrEst * 3).toFixed(2)), volume: 0, timeframe: "1D", createdAt: now, mitigated: false },
    { id: `ob_${symbol}_s1`, type: "supply" as const, high: parseFloat((currentPrice + atrEst * 3).toFixed(2)), low: parseFloat((currentPrice + atrEst * 2).toFixed(2)), volume: 0, timeframe: "1D", createdAt: now, mitigated: false },
  ];
}

export function renderPositionOverlay(params: {
  symbol: string;
  direction: "long" | "short";
  entryPrice: number;
  currentStop: number;
  targets: { price: number; label: string; hit?: boolean }[];
  quantity?: number;
  unrealizedPnl?: number;
}): PositionOverlay {
  const { symbol, direction, entryPrice, currentStop, targets, quantity = 0, unrealizedPnl = 0 } = params;
  return {
    id: `pos_${symbol}_${Date.now()}`,
    symbol, direction, entryPrice, currentStop,
    targets: targets.map((t) => ({ ...t, hit: t.hit ?? false })),
    quantity, unrealizedPnl,
    openedAt: new Date().toISOString(),
  };
}

export function renderSignalMarkers(params: {
  symbol: string;
  signals: { type: "buy" | "sell" | "alert" | "info"; price: number; label: string; confidence?: number; source?: string }[];
}): SignalMarker[] {
  const { symbol, signals } = params;
  return signals.map((s, i) => ({
    id: `sig_${symbol}_${i}_${Date.now()}`,
    symbol,
    type: s.type,
    price: s.price,
    timestamp: new Date().toISOString(),
    label: s.label,
    confidence: s.confidence ?? 0.5,
    source: s.source ?? "godsview",
  }));
}

// ─── Full Overlay Generator ───────────────────────────────────────────────────

export function generateChartOverlay(params: {
  symbol: string;
  currentPrice: number;
  timeframe?: string;
  position?: { direction: "long" | "short"; entryPrice: number; currentStop: number; targets: { price: number; label: string }[] };
  signals?: { type: "buy" | "sell" | "alert" | "info"; price: number; label: string; confidence?: number }[];
  structureLevels?: { price: number; type?: "support" | "resistance"; strength?: number }[];
  orderBlocks?: { high: number; low: number; type?: "supply" | "demand" }[];
}): ChartOverlay {
  const { symbol, currentPrice, timeframe = "1D", position, signals = [], structureLevels, orderBlocks } = params;

  const structures = renderStructureLevels({ symbol, currentPrice, levels: structureLevels });
  const blocks = renderOrderBlocks({ symbol, currentPrice, blocks: orderBlocks });
  const positions = position ? [renderPositionOverlay({ symbol, ...position })] : [];
  const signalMarkers = signals.length > 0 ? renderSignalMarkers({ symbol, signals }) : [];

  const overlay: ChartOverlay = {
    symbol, timeframe, structures, orderBlocks: blocks,
    positions, signals: signalMarkers, indicators: [],
    generatedAt: new Date().toISOString(),
  };

  overlayCache.set(symbol, overlay);
  if (overlayCache.size > MAX_CACHE) {
    const oldest = overlayCache.keys().next().value;
    if (oldest) overlayCache.delete(oldest);
  }
  totalGenerated++;

  logger.info({ symbol, structures: structures.length, blocks: blocks.length, signals: signalMarkers.length }, "Chart overlay generated");
  return overlay;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export function getOverlay(symbol: string): ChartOverlay | undefined {
  return overlayCache.get(symbol.toUpperCase());
}

export function getOverlaySnapshot(): OverlaySnapshot {
  const allOverlays = Array.from(overlayCache.values());
  return {
    totalOverlaysGenerated: totalGenerated,
    activeSymbols: Array.from(overlayCache.keys()),
    structureLevels: allOverlays.reduce((s, o) => s + o.structures.length, 0),
    orderBlocks: allOverlays.reduce((s, o) => s + o.orderBlocks.length, 0),
    activePositions: allOverlays.reduce((s, o) => s + o.positions.length, 0),
    recentSignals: allOverlays.reduce((s, o) => s + o.signals.length, 0),
  };
}

export function resetOverlays(): void {
  overlayCache.clear();
  totalGenerated = 0;
  logger.info("TradingView overlay cache reset");
}

// ─── HTF Market Structure Integration ──────────────────────────────────────

// Enhanced overlay that includes HTF market structure data
export interface EnhancedChartOverlay extends ChartOverlay {
  htfBias: "bullish" | "bearish" | "ranging";
  tradeProbability: { long: number; short: number; neutral: number };
  htfOrderBlocks: OrderBlockHTF[];
  abcdPatterns: ABCDPattern[];
  supplyDemandZones: SupplyDemandZone[];
  keyLevels: { price: number; type: string; timeframe: string; strength: number }[];
}

export function generateEnhancedOverlay(
  symbol: string,
  timeframe: string,
  bars: HTFBar[],
  barsByTf?: Partial<Record<HTFTimeframe, HTFBar[]>>,
): EnhancedChartOverlay {
  // Generate base overlay
  const base = generateChartOverlay({
    symbol,
    currentPrice: bars.length > 0 ? bars[bars.length - 1].c : 0,
    timeframe,
  });

  // Single timeframe analysis
  const tf = (timeframe || "1H") as HTFTimeframe;
  const tfAnalysis = analyzeTimeframe(bars, tf);

  // Multi-timeframe if available
  let mtf: MultiTimeframeStructure | null = null;
  if (barsByTf && Object.keys(barsByTf).length > 0) {
    // Fill missing timeframes with empty arrays
    const fullBars: Record<HTFTimeframe, HTFBar[]> = {
      "15min": barsByTf["15min"] || [],
      "1H": barsByTf["1H"] || bars,
      "4H": barsByTf["4H"] || [],
      "1D": barsByTf["1D"] || [],
      "1W": barsByTf["1W"] || [],
    };
    mtf = analyzeMultiTimeframe(fullBars, symbol);
  }

  // Convert HTF order blocks to base overlay format
  const htfStructures: StructureLevel[] = tfAnalysis.orderBlocks.map((ob, i) => ({
    id: ob.id,
    type: ob.type === "bullish" ? ("support" as const) : ("resistance" as const),
    price: ob.type === "bullish" ? ob.low : ob.high,
    strength: Math.min(5, Math.ceil(ob.score * 5)) as 1 | 2 | 3 | 4 | 5,
    touches: ob.status === "tested" ? 1 : 0,
    firstSeen: ob.createdAt,
    lastTested: ob.createdAt,
    broken: ob.status === "mitigated",
  }));

  // Convert supply/demand zones to order block overlay format
  const sdBlocks: OrderBlock[] = tfAnalysis.supplyDemandZones.map((z) => ({
    id: z.id,
    type: z.type as "supply" | "demand",
    high: z.high,
    low: z.low,
    volume: 0,
    timeframe: z.timeframe,
    createdAt: z.createdAt,
    mitigated: z.status === "broken",
  }));

  // Merge with base
  return {
    ...base,
    structures: [...base.structures, ...htfStructures],
    orderBlocks: [...base.orderBlocks, ...sdBlocks],
    htfBias: mtf?.htfBias ?? tfAnalysis.bias,
    tradeProbability: mtf?.tradeProbability ?? { long: 33, short: 33, neutral: 34 },
    htfOrderBlocks: tfAnalysis.orderBlocks,
    abcdPatterns: tfAnalysis.abcdPatterns,
    supplyDemandZones: tfAnalysis.supplyDemandZones,
    keyLevels: mtf?.keyLevels ?? [],
  };
}
