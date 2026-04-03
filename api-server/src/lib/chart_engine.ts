/**
 * chart_engine.ts — GodsView Chart Plotting Agent (L8)
 *
 * The Chart Plotting Agent captures an annotated visual snapshot of every
 * setup at the exact moment of confirmation. It thinks visually like a
 * professional trader reviewing a chart: candles, structure, flow, context —
 * all on one frame with every key element marked.
 *
 * What it generates for each confirmation:
 *   - Full OHLCV candlestick chart (50 bars before + 20 bars after)
 *   - Order Block rectangles (bullish=blue, bearish=red)
 *   - FVG zones (shaded gaps between wicks)
 *   - BOS / CHoCH arrows at structural breaks
 *   - Entry / Stop Loss / Take Profit horizontal lines
 *   - Orderflow delta bars below the chart (green/red histogram)
 *   - Regime label + trend strength badge
 *   - Confirmation timestamp banner
 *   - All supporting analysis reasons listed as annotations
 *
 * Output: SVG string (self-contained, embeddable, saveable as .svg or .html)
 *         + structured ChartSnapshot metadata for database storage
 *
 * Design philosophy:
 *   - Every chart must be readable in < 2 seconds (like a Bloomberg terminal)
 *   - Color-coded so direction is obvious at a glance
 *   - Annotations are timestamped and evidence-linked (not vague)
 *   - Snapshots are immutable — what the agent SAW at that moment, frozen
 */

import type { SetupConfirmation, OHLCVBar } from "./backtest_engine";

// ── Chart Configuration ────────────────────────────────────────────────────

const CHART_CONFIG = {
  width: 1200,
  height: 700,
  padding: { top: 60, right: 120, bottom: 160, left: 70 },
  candleArea: { heightRatio: 0.68 },   // 68% of inner height for price
  deltaArea: { heightRatio: 0.20 },    // 20% for delta histogram
  infoArea: { heightRatio: 0.12 },     // 12% for text panel
  lookback: 50,                         // bars before confirmation
  forward: 20,                          // bars after confirmation
  colors: {
    background: "#0d0d14",
    grid: "#1a1a2e",
    bullCandle: "#00e676",
    bearCandle: "#ff1744",
    wickColor: "#888",
    bullOB: "rgba(0,230,118,0.18)",
    bearOB: "rgba(255,23,68,0.18)",
    fvg: "rgba(255,214,0,0.10)",
    bos: "#00ccff",
    choch: "#ff9800",
    entry: "#00e676",
    stopLoss: "#ff1744",
    takeProfit: "#ffd700",
    bullDelta: "#00e676",
    bearDelta: "#ff1744",
    confirmBar: "rgba(255,214,0,0.25)",
    text: "#e0e0e0",
    subtext: "#888",
    longBadge: "#00e676",
    shortBadge: "#ff1744",
    regime: "#7c83fd",
  },
};

// ── Chart Data Types ───────────────────────────────────────────────────────

export interface ChartAnnotation {
  type: "ob" | "fvg" | "bos" | "choch" | "entry" | "sl" | "tp" | "confirm" | "text";
  label: string;
  price?: number;
  barStart?: number;
  barEnd?: number;
  priceHigh?: number;
  priceLow?: number;
  direction?: "bullish" | "bearish";
  color?: string;
}

export interface ChartSnapshot {
  /** Unique confirmation ID this snapshot belongs to */
  confirmationId: string;
  symbol: string;
  /** When the snapshot was generated */
  generatedAt: string;
  /** Exact confirmation time (bar close) */
  confirmedAt: string;
  direction: "long" | "short";
  setupType: string;
  /** Entry / SL / TP prices */
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  /** Regime at confirmation */
  regime: string;
  /** All supporting evidence captured */
  supportingEvidence: string[];
  /** Orderflow bias at confirmation */
  orderflowBias: string;
  /** MTF aligned? */
  mtfAligned: boolean;
  /** Confirmation score 0-1 */
  confirmationScore: number;
  /** Full SVG chart as a string */
  svgChart: string;
  /** Bars used for the chart (serialized) */
  bars: OHLCVBar[];
  /** Annotations layered on the chart */
  annotations: ChartAnnotation[];
}

// ── Price Scaling Helpers ─────────────────────────────────────────────────

function buildPriceScale(
  bars: OHLCVBar[],
  entryPrice: number,
  stopLoss: number,
  takeProfit: number,
  chartTop: number,
  chartHeight: number,
): (price: number) => number {
  const allPrices = [
    ...bars.map((b) => b.High),
    ...bars.map((b) => b.Low),
    entryPrice, stopLoss, takeProfit,
  ];
  const minPrice = Math.min(...allPrices);
  const maxPrice = Math.max(...allPrices);
  const pad = (maxPrice - minPrice) * 0.05;
  const lo = minPrice - pad;
  const hi = maxPrice + pad;
  return (price: number) => chartTop + chartHeight - ((price - lo) / (hi - lo)) * chartHeight;
}

function buildBarScale(
  totalBars: number,
  chartLeft: number,
  chartWidth: number,
): { x: (i: number) => number; candleWidth: number } {
  const candleWidth = Math.max(4, Math.floor(chartWidth / totalBars) - 1);
  const x = (i: number) => chartLeft + i * (chartWidth / totalBars) + (chartWidth / totalBars - candleWidth) / 2;
  return { x, candleWidth };
}

function buildDeltaScale(
  deltas: number[],
  deltaTop: number,
  deltaHeight: number,
): (delta: number) => { y: number; h: number } {
  const maxAbs = Math.max(1, ...deltas.map(Math.abs));
  const mid = deltaTop + deltaHeight / 2;
  return (delta: number) => {
    const h = Math.abs(delta / maxAbs) * (deltaHeight / 2);
    const y = delta >= 0 ? mid - h : mid;
    return { y, h };
  };
}

// ── SVG Primitives ─────────────────────────────────────────────────────────

function svgRect(x: number, y: number, w: number, h: number, fill: string, stroke = "none", sw = 1, rx = 0): string {
  return `<rect x="${r(x)}" y="${r(y)}" width="${r(Math.max(1, w))}" height="${r(Math.max(0.5, h))}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" rx="${rx}"/>`;
}

function svgLine(x1: number, y1: number, x2: number, y2: number, stroke: string, sw = 1, dash = ""): string {
  const d = dash ? ` stroke-dasharray="${dash}"` : "";
  return `<line x1="${r(x1)}" y1="${r(y1)}" x2="${r(x2)}" y2="${r(y2)}" stroke="${stroke}" stroke-width="${sw}"${d}/>`;
}

function svgText(x: number, y: number, text: string, fill: string, size: number, anchor: "start" | "middle" | "end" = "start", bold = false): string {
  const fw = bold ? ' font-weight="bold"' : "";
  return `<text x="${r(x)}" y="${r(y)}" fill="${fill}" font-size="${size}" text-anchor="${anchor}"${fw} font-family="'Courier New',monospace">${escapeXml(text)}</text>`;
}

function svgArrow(x: number, y: number, up: boolean, color: string, size = 10): string {
  const pts = up
    ? `${r(x)},${r(y)} ${r(x - size / 2)},${r(y + size)} ${r(x + size / 2)},${r(y + size)}`
    : `${r(x)},${r(y)} ${r(x - size / 2)},${r(y - size)} ${r(x + size / 2)},${r(y - size)}`;
  return `<polygon points="${pts}" fill="${color}" opacity="0.85"/>`;
}

function svgBadge(x: number, y: number, label: string, fill: string): string {
  const w = label.length * 7.5 + 10;
  return svgRect(x, y - 14, w, 18, fill, "none", 0, 3)
    + svgText(x + 5, y - 2, label, "#000", 10, "start", true);
}

function r(n: number): string { return n.toFixed(1); }
function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Grid Lines ─────────────────────────────────────────────────────────────

function drawGrid(
  chartLeft: number, chartTop: number,
  chartWidth: number, chartHeight: number,
  priceToY: (p: number) => number,
  bars: OHLCVBar[],
  lines = 6,
): string {
  const parts: string[] = [];
  const allPrices = [...bars.map((b) => b.High), ...bars.map((b) => b.Low)];
  const lo = Math.min(...allPrices);
  const hi = Math.max(...allPrices);
  const step = (hi - lo) / lines;
  for (let i = 0; i <= lines; i++) {
    const price = lo + step * i;
    const y = priceToY(price);
    parts.push(svgLine(chartLeft, y, chartLeft + chartWidth, y, CHART_CONFIG.colors.grid, 0.5));
    parts.push(svgText(chartLeft - 5, y + 4, price.toFixed(2), CHART_CONFIG.colors.subtext, 9, "end"));
  }
  return parts.join("\n");
}

// ── Candlestick Drawing ────────────────────────────────────────────────────

function drawCandles(
  bars: OHLCVBar[],
  confirmBarIndex: number,
  priceToY: (p: number) => number,
  xScale: { x: (i: number) => number; candleWidth: number },
): string {
  const { x, candleWidth } = xScale;
  const parts: string[] = [];

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const isBull = bar.Close >= bar.Open;
    const color = isBull ? CHART_CONFIG.colors.bullCandle : CHART_CONFIG.colors.bearCandle;

    const candleX = x(i);
    const bodyTop = priceToY(Math.max(bar.Open, bar.Close));
    const bodyBot = priceToY(Math.min(bar.Open, bar.Close));
    const bodyH = Math.max(1, bodyBot - bodyTop);
    const wickX = candleX + candleWidth / 2;

    // Highlight confirmation bar
    if (i === confirmBarIndex) {
      parts.push(svgRect(candleX - 1, priceToY(bar.High) - 2, candleWidth + 2, priceToY(bar.Low) - priceToY(bar.High) + 4, CHART_CONFIG.colors.confirmBar));
    }

    // High/low wick
    parts.push(svgLine(wickX, priceToY(bar.High), wickX, bodyTop, CHART_CONFIG.colors.wickColor, 1));
    parts.push(svgLine(wickX, bodyBot, wickX, priceToY(bar.Low), CHART_CONFIG.colors.wickColor, 1));

    // Body
    parts.push(svgRect(candleX, bodyTop, candleWidth, bodyH, color));
  }

  return parts.join("\n");
}

// ── Order Block Rectangles ─────────────────────────────────────────────────

function drawOrderBlocks(
  confirmation: SetupConfirmation,
  priceToY: (p: number) => number,
  xScale: { x: (i: number) => number; candleWidth: number },
  totalBars: number,
  chartLeft: number,
  chartWidth: number,
): string {
  const parts: string[] = [];
  const { x, candleWidth } = xScale;

  // Nearest OB — approximate position (we know count and nearest price from confirmation)
  const obPrice = confirmation.structure.nearestOBPrice ?? 0;
  if (obPrice > 0) {
    const dir = confirmation.direction === "long" ? "bullish" : "bearish";
    const fill = dir === "bullish" ? CHART_CONFIG.colors.bullOB : CHART_CONFIG.colors.bearOB;
    const strokeColor = dir === "bullish" ? CHART_CONFIG.colors.bullCandle : CHART_CONFIG.colors.bearCandle;

    // Draw OB as a zone spanning across the chart (we approximate its height as 0.15% of price)
    const zoneH = obPrice * 0.0015;
    const yTop = priceToY(obPrice + zoneH);
    const yBot = priceToY(obPrice - zoneH);
    const zoneHeight = Math.max(4, yBot - yTop);

    parts.push(svgRect(chartLeft, yTop, chartWidth, zoneHeight, fill, strokeColor, 0.5));
    parts.push(svgText(chartLeft + chartWidth + 4, yTop + 10, `OB ${obPrice.toFixed(2)}`, strokeColor, 9, "start"));
  }

  return parts.join("\n");
}

// ── FVG Zones ─────────────────────────────────────────────────────────────

function drawFVGs(
  bars: OHLCVBar[],
  confirmBarIndex: number,
  priceToY: (p: number) => number,
  xScale: { x: (i: number) => number; candleWidth: number },
): string {
  const parts: string[] = [];
  const { x, candleWidth } = xScale;

  // Detect FVGs in the visible bars
  for (let i = 2; i <= confirmBarIndex && i < bars.length - 1; i++) {
    const prev = bars[i - 2];
    const curr = bars[i - 1];
    const next = bars[i];

    // Bullish FVG: current low > previous high (gap up)
    if (next.Low > prev.High) {
      const yTop = priceToY(next.Low);
      const yBot = priceToY(prev.High);
      if (yBot - yTop > 1) {
        const startX = x(i - 2);
        const endX = x(i) + candleWidth;
        parts.push(svgRect(startX, yTop, endX - startX, yBot - yTop, CHART_CONFIG.colors.fvg, CHART_CONFIG.colors.takeProfit, 0.3));
        parts.push(svgText(startX + 2, yTop - 2, "FVG+", CHART_CONFIG.colors.takeProfit, 8, "start"));
      }
    }

    // Bearish FVG: current high < previous low (gap down)
    if (next.High < prev.Low) {
      const yTop = priceToY(next.High);
      const yBot = priceToY(prev.Low);
      if (yBot - yTop > 1) {
        const startX = x(i - 2);
        const endX = x(i) + candleWidth;
        parts.push(svgRect(startX, yTop, endX - startX, yBot - yTop, CHART_CONFIG.colors.fvg, CHART_CONFIG.colors.bearCandle, 0.3));
        parts.push(svgText(startX + 2, yBot + 10, "FVG-", CHART_CONFIG.colors.bearCandle, 8, "start"));
      }
    }
  }

  return parts.join("\n");
}

// ── Structure Markers (BOS / CHoCH) ───────────────────────────────────────

function drawStructureMarkers(
  confirmation: SetupConfirmation,
  bars: OHLCVBar[],
  confirmBarIndex: number,
  priceToY: (p: number) => number,
  xScale: { x: (i: number) => number; candleWidth: number },
): string {
  const parts: string[] = [];
  const { x, candleWidth } = xScale;

  // Draw BOS marker near confirmation bar
  if (confirmation.structure.bos) {
    const barX = x(confirmBarIndex) + candleWidth / 2;
    const barY = priceToY(bars[confirmBarIndex].High) - 18;
    const isLong = confirmation.direction === "long";
    parts.push(svgArrow(barX, barY, isLong, CHART_CONFIG.colors.bos, 10));
    parts.push(svgText(barX, barY - 5, "BOS", CHART_CONFIG.colors.bos, 9, "middle", true));
  }

  if (confirmation.structure.choch) {
    const barX = x(confirmBarIndex) + candleWidth / 2;
    const barY = priceToY(bars[confirmBarIndex].Low) + 20;
    const isLong = confirmation.direction === "long";
    parts.push(svgArrow(barX, barY, !isLong, CHART_CONFIG.colors.choch, 10));
    parts.push(svgText(barX, barY + 15, "CHoCH", CHART_CONFIG.colors.choch, 9, "middle", true));
  }

  return parts.join("\n");
}

// ── Entry / SL / TP Lines ─────────────────────────────────────────────────

function drawLevelLines(
  entryPrice: number,
  stopLoss: number,
  takeProfit: number,
  confirmBarIndex: number,
  totalBars: number,
  priceToY: (p: number) => number,
  xScale: { x: (i: number) => number; candleWidth: number },
  chartLeft: number,
  chartWidth: number,
): string {
  const parts: string[] = [];
  const startX = xScale.x(confirmBarIndex);
  const endX = chartLeft + chartWidth;

  // Entry
  const entryY = priceToY(entryPrice);
  parts.push(svgLine(startX, entryY, endX, entryY, CHART_CONFIG.colors.entry, 1.5, "5,3"));
  parts.push(svgText(endX + 4, entryY + 4, `ENTRY ${entryPrice.toFixed(4)}`, CHART_CONFIG.colors.entry, 9, "start", true));

  // Stop Loss
  const slY = priceToY(stopLoss);
  parts.push(svgLine(startX, slY, endX, slY, CHART_CONFIG.colors.stopLoss, 1.5, "5,3"));
  parts.push(svgText(endX + 4, slY + 4, `SL ${stopLoss.toFixed(4)}`, CHART_CONFIG.colors.stopLoss, 9, "start", true));

  // Take Profit
  const tpY = priceToY(takeProfit);
  parts.push(svgLine(startX, tpY, endX, tpY, CHART_CONFIG.colors.takeProfit, 1.5, "5,3"));
  parts.push(svgText(endX + 4, tpY + 4, `TP ${takeProfit.toFixed(4)}`, CHART_CONFIG.colors.takeProfit, 9, "start", true));

  return parts.join("\n");
}

// ── Delta Histogram ────────────────────────────────────────────────────────

function drawDeltaHistogram(
  bars: OHLCVBar[],
  confirmBarIndex: number,
  deltaTop: number,
  deltaHeight: number,
  xScale: { x: (i: number) => number; candleWidth: number },
  chartLeft: number,
  chartWidth: number,
): string {
  const parts: string[] = [];
  const { x, candleWidth } = xScale;

  // Estimate delta from volume * (close-open) direction
  const deltas = bars.map((b) => {
    const range = b.High - b.Low;
    if (range === 0) return 0;
    const bullFrac = (b.Close - b.Low) / range;
    return (bullFrac - 0.5) * b.Volume;
  });

  const deltaScale = buildDeltaScale(deltas, deltaTop, deltaHeight);

  // Mid line
  parts.push(svgLine(chartLeft, deltaTop + deltaHeight / 2, chartLeft + chartWidth, deltaTop + deltaHeight / 2, CHART_CONFIG.colors.grid, 0.5));
  parts.push(svgText(chartLeft - 5, deltaTop + 5, "Δ", CHART_CONFIG.colors.subtext, 9, "end"));

  for (let i = 0; i < bars.length; i++) {
    const d = deltas[i];
    const { y, h } = deltaScale(d);
    const color = d >= 0 ? CHART_CONFIG.colors.bullDelta : CHART_CONFIG.colors.bearDelta;
    parts.push(svgRect(x(i), y, candleWidth, Math.max(1, h), color, "none", 0));
    if (i === confirmBarIndex) {
      parts.push(svgRect(x(i) - 1, deltaTop, candleWidth + 2, deltaHeight, CHART_CONFIG.colors.confirmBar));
    }
  }

  return parts.join("\n");
}

// ── Timestamp Markers on X-Axis ────────────────────────────────────────────

function drawTimeAxis(
  bars: OHLCVBar[],
  confirmBarIndex: number,
  xScale: { x: (i: number) => number; candleWidth: number },
  axisY: number,
  chartLeft: number,
  chartWidth: number,
): string {
  const parts: string[] = [];
  const { x, candleWidth } = xScale;
  const step = Math.max(1, Math.floor(bars.length / 8));

  for (let i = 0; i < bars.length; i += step) {
    const ts = bars[i].Timestamp;
    const label = ts.length > 16 ? ts.slice(0, 16).replace("T", " ") : ts;
    const cx = x(i) + candleWidth / 2;
    parts.push(svgLine(cx, axisY, cx, axisY + 4, CHART_CONFIG.colors.subtext, 0.5));
    parts.push(svgText(cx, axisY + 14, label, CHART_CONFIG.colors.subtext, 8, "middle"));
  }

  // Confirm bar label
  if (confirmBarIndex >= 0 && confirmBarIndex < bars.length) {
    const ts = bars[confirmBarIndex].Timestamp;
    const label = ts.length > 19 ? ts.slice(0, 19).replace("T", " ") : ts;
    const cx = x(confirmBarIndex) + candleWidth / 2;
    parts.push(svgLine(cx, axisY, cx, axisY + 4, CHART_CONFIG.colors.takeProfit, 1));
    parts.push(svgText(cx, axisY + 26, `★ ${label}`, CHART_CONFIG.colors.takeProfit, 8, "middle", true));
  }

  return parts.join("\n");
}

// ── Info Panel ─────────────────────────────────────────────────────────────

function drawInfoPanel(
  confirmation: SetupConfirmation,
  infoTop: number,
  chartLeft: number,
  chartWidth: number,
): string {
  const parts: string[] = [];
  const { colors } = CHART_CONFIG;
  const c = confirmation;

  const dirColor = c.direction === "long" ? colors.longBadge : colors.shortBadge;
  const dirLabel = c.direction === "long" ? "▲ LONG" : "▼ SHORT";
  const rr = Math.abs(c.takeProfit - c.entryPrice) / Math.abs(c.entryPrice - c.stopLoss);
  const score = (c.confirmationScore * 100).toFixed(0);
  const mtfLabel = c.mtfAligned ? "✓ MTF ALIGNED" : "✗ MTF DIVERGENT";
  const mtfColor = c.mtfAligned ? colors.longBadge : colors.shortBadge;

  // Row 1 — direction badge + symbol + time + regime
  parts.push(svgBadge(chartLeft, infoTop + 15, dirLabel, dirColor));
  parts.push(svgText(chartLeft + 80, infoTop + 9, c.symbol, colors.text, 12, "start", true));
  parts.push(svgText(chartLeft + 80, infoTop + 22, c.confirmedAt.replace("T", " ").slice(0, 19), colors.subtext, 9, "start"));
  parts.push(svgBadge(chartLeft + 200, infoTop + 15, c.setupType.toUpperCase(), colors.regime));
  const regimeLabel = typeof c.regime === "string" ? c.regime : (c.regime as any)?.label ?? "unknown";
  parts.push(svgBadge(chartLeft + 340, infoTop + 15, regimeLabel.toUpperCase().replace("_", " "), colors.regime));
  parts.push(svgBadge(chartLeft + 500, infoTop + 15, mtfLabel, mtfColor));

  // Row 1 right side — key metrics
  const flowBias = (c as any).orderflowBias ?? (c as any).orderflow?.bias ?? "neutral";
  parts.push(svgText(chartLeft + chartWidth - 200, infoTop + 9, `Score: ${score}%  |  R:R: 1:${rr.toFixed(2)}  |  Flow: ${flowBias}`, colors.text, 9, "start"));

  // Row 2 — supporting reasons (word-wrapped across up to 2 lines)
  const evidence = Array.isArray(c.supportingEvidence) ? c.supportingEvidence : [(c as any).confirmationReason ?? "No evidence recorded"];
  const reasons = evidence.join("  •  ");
  const maxLen = 140;
  const line1 = reasons.slice(0, maxLen);
  const line2 = reasons.length > maxLen ? reasons.slice(maxLen, maxLen * 2) : "";
  parts.push(svgText(chartLeft, infoTop + 38, "• " + line1, colors.subtext, 9, "start"));
  if (line2) {
    parts.push(svgText(chartLeft, infoTop + 52, "  " + line2, colors.subtext, 9, "start"));
  }

  return parts.join("\n");
}

// ── Title Bar ─────────────────────────────────────────────────────────────

function drawTitleBar(
  confirmation: SetupConfirmation,
  width: number,
): string {
  const parts: string[] = [];
  const { colors } = CHART_CONFIG;
  const dirLabel = confirmation.direction === "long" ? "LONG SETUP" : "SHORT SETUP";
  const dirColor = confirmation.direction === "long" ? colors.longBadge : colors.shortBadge;

  parts.push(svgRect(0, 0, width, 52, "#12121f"));
  parts.push(svgText(16, 22, `GodsView Agent Snapshot`, colors.subtext, 11, "start"));
  parts.push(svgText(16, 42, `${confirmation.symbol}  ·  ${dirLabel}  ·  Confirmed: ${confirmation.confirmedAt.replace("T", " ").slice(0, 19)}`, dirColor, 12, "start", true));
  parts.push(svgText(width - 16, 22, `ID: ${confirmation.id.slice(0, 12)}`, colors.subtext, 9, "end"));
  parts.push(svgText(width - 16, 42, `Score: ${(confirmation.confirmationScore * 100).toFixed(0)}%  ·  ${confirmation.setupType}`, colors.text, 10, "end", true));

  return parts.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN CHART GENERATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate an annotated SVG chart snapshot for a setup confirmation.
 *
 * @param confirmation - The setup confirmation record (from backtest_engine)
 * @param allBars      - Full bar array for the symbol (1m or 5m)
 */
export function generateChartSnapshot(
  confirmation: SetupConfirmation,
  allBars: OHLCVBar[],
): ChartSnapshot {
  const cfg = CHART_CONFIG;
  const { width, height, padding } = cfg;

  // ── Slice bars around confirmation ───────────────────────────────────────
  const confirmIdx = Math.min(confirmation.barIndex, allBars.length - 1);
  const startIdx = Math.max(0, confirmIdx - cfg.lookback);
  const endIdx = Math.min(allBars.length - 1, confirmIdx + cfg.forward);
  const bars = allBars.slice(startIdx, endIdx + 1);
  const confirmBarIndex = confirmIdx - startIdx; // index within sliced bars

  // ── Layout zones ─────────────────────────────────────────────────────────
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const candleH = Math.floor(innerH * cfg.candleArea.heightRatio);
  const deltaH = Math.floor(innerH * cfg.deltaArea.heightRatio);
  const infoH = Math.floor(innerH * cfg.infoArea.heightRatio);
  const gapBetween = 8;

  const chartLeft = padding.left;
  const chartTop = padding.top;
  const deltaTop = chartTop + candleH + gapBetween;
  const infoTop = deltaTop + deltaH + gapBetween;
  const axisY = deltaTop + deltaH + 4;

  // ── Scales ───────────────────────────────────────────────────────────────
  const priceToY = buildPriceScale(
    bars,
    confirmation.entryPrice,
    confirmation.stopLoss,
    confirmation.takeProfit,
    chartTop,
    candleH,
  );
  const xScale = buildBarScale(bars.length, chartLeft, innerW);

  // ── Build SVG layers ─────────────────────────────────────────────────────
  const layers: string[] = [];

  // 1. Background
  layers.push(svgRect(0, 0, width, height, cfg.colors.background));

  // 2. Title bar
  layers.push(drawTitleBar(confirmation, width));

  // 3. Chart background
  layers.push(svgRect(chartLeft, chartTop, innerW, candleH, "#0a0a14"));

  // 4. Grid
  layers.push(drawGrid(chartLeft, chartTop, innerW, candleH, priceToY, bars));

  // 5. FVG zones (behind candles)
  layers.push(drawFVGs(bars, confirmBarIndex, priceToY, xScale));

  // 6. Order blocks (behind candles)
  layers.push(drawOrderBlocks(confirmation, priceToY, xScale, bars.length, chartLeft, innerW));

  // 7. Candles
  layers.push(drawCandles(bars, confirmBarIndex, priceToY, xScale));

  // 8. Structure markers (BOS/CHoCH)
  layers.push(drawStructureMarkers(confirmation, bars, confirmBarIndex, priceToY, xScale));

  // 9. Level lines (Entry / SL / TP)
  layers.push(drawLevelLines(
    confirmation.entryPrice,
    confirmation.stopLoss,
    confirmation.takeProfit,
    confirmBarIndex,
    bars.length,
    priceToY,
    xScale,
    chartLeft,
    innerW,
  ));

  // 10. Chart border
  layers.push(svgRect(chartLeft, chartTop, innerW, candleH, "none", cfg.colors.grid, 0.5));

  // 11. Delta histogram background + chart
  layers.push(svgRect(chartLeft, deltaTop, innerW, deltaH, "#0a0a14"));
  layers.push(drawDeltaHistogram(bars, confirmBarIndex, deltaTop, deltaH, xScale, chartLeft, innerW));
  layers.push(svgRect(chartLeft, deltaTop, innerW, deltaH, "none", cfg.colors.grid, 0.5));

  // 12. Time axis labels
  layers.push(drawTimeAxis(bars, confirmBarIndex, xScale, axisY, chartLeft, innerW));

  // 13. Info panel background + content
  layers.push(svgRect(chartLeft, infoTop, innerW, infoH + 20, "#0f0f1e"));
  layers.push(drawInfoPanel(confirmation, infoTop, chartLeft, innerW));

  // 14. Watermark
  layers.push(svgText(width / 2, height - 6, "GodsView Intelligence Platform — L8 Chart Agent", cfg.colors.grid, 8, "middle"));

  // ── Assemble SVG ─────────────────────────────────────────────────────────
  const svgChart = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<style>text { font-family: 'Courier New', Courier, monospace; }</style>
${layers.join("\n")}
</svg>`;

  // ── Collect annotations for structured storage ───────────────────────────
  const annotations: ChartAnnotation[] = [];

  annotations.push({
    type: "confirm",
    label: `Confirmation: ${confirmation.confirmedAt}`,
    price: confirmation.entryPrice,
    barStart: confirmBarIndex,
    barEnd: confirmBarIndex,
  });

  annotations.push({ type: "entry", label: `Entry: ${confirmation.entryPrice}`, price: confirmation.entryPrice });
  annotations.push({ type: "sl", label: `Stop Loss: ${confirmation.stopLoss}`, price: confirmation.stopLoss });
  annotations.push({ type: "tp", label: `Take Profit: ${confirmation.takeProfit}`, price: confirmation.takeProfit });

  if (confirmation.structure.nearestOBPrice) {
    annotations.push({
      type: "ob",
      label: `OB @ ${confirmation.structure.nearestOBPrice.toFixed(4)}`,
      price: confirmation.structure.nearestOBPrice,
      direction: confirmation.direction === "long" ? "bullish" : "bearish",
    });
  }

  if (confirmation.structure.bos) {
    annotations.push({ type: "bos", label: "Break of Structure confirmed", barStart: confirmBarIndex });
  }
  if (confirmation.structure.choch) {
    annotations.push({ type: "choch", label: "Change of Character confirmed", barStart: confirmBarIndex });
  }

  // Extract string fields safely from SetupConfirmation (regime and orderflow are objects)
  const regimeLabelStr = typeof confirmation.regime === "string"
    ? confirmation.regime
    : (confirmation.regime as any)?.label ?? "unknown";
  const orderflowBiasStr = typeof (confirmation as any).orderflowBias === "string"
    ? (confirmation as any).orderflowBias
    : (confirmation as any).orderflow?.bias ?? "neutral";
  const supportingEvidenceArr = Array.isArray(confirmation.supportingEvidence)
    ? confirmation.supportingEvidence
    : [(confirmation as any).confirmationReason ?? "No evidence"];

  return {
    confirmationId: confirmation.id,
    symbol: confirmation.symbol,
    generatedAt: new Date().toISOString(),
    confirmedAt: confirmation.confirmedAt,
    direction: confirmation.direction,
    setupType: confirmation.setupType,
    entryPrice: confirmation.entryPrice,
    stopLoss: confirmation.stopLoss,
    takeProfit: confirmation.takeProfit,
    regime: regimeLabelStr,
    supportingEvidence: supportingEvidenceArr,
    orderflowBias: orderflowBiasStr,
    mtfAligned: confirmation.mtfAligned,
    confirmationScore: confirmation.confirmationScore,
    svgChart,
    bars,
    annotations,
  };
}

// ── Batch generation ───────────────────────────────────────────────────────

export interface ChartBatchResult {
  symbol: string;
  totalConfirmations: number;
  generatedAt: string;
  snapshots: ChartSnapshot[];
  /** Summary for logging */
  summary: string;
}

/**
 * Generate chart snapshots for all confirmations from a backtest run.
 * Returns snapshots sorted by confidence score (best setups first).
 */
export function generateChartBatch(
  confirmations: SetupConfirmation[],
  allBars: OHLCVBar[],
  symbol: string,
  maxSnapshots = 20,
): ChartBatchResult {
  // Sort by score — capture the highest-quality setups
  const sorted = [...confirmations].sort((a, b) => b.confirmationScore - a.confirmationScore);
  const toGenerate = sorted.slice(0, maxSnapshots);

  const snapshots: ChartSnapshot[] = [];
  for (const conf of toGenerate) {
    try {
      const snap = generateChartSnapshot(conf, allBars);
      snapshots.push(snap);
    } catch {
      // Skip failed snapshots — don't crash the batch
    }
  }

  return {
    symbol,
    totalConfirmations: confirmations.length,
    generatedAt: new Date().toISOString(),
    snapshots,
    summary: `Generated ${snapshots.length}/${toGenerate.length} snapshots for ${symbol} (${confirmations.length} total confirmations, top ${maxSnapshots} by score)`,
  };
}

/**
 * Export a snapshot as a standalone HTML page (embeds the SVG + metadata).
 * This is what you'd save to disk or serve as a "chart screenshot."
 */
export function snapshotToHTML(snapshot: ChartSnapshot): string {
  const c = snapshot;
  const dirColor = c.direction === "long" ? "#00e676" : "#ff1744";
  const evidenceList = c.supportingEvidence.map((e) => `<li>${escapeXml(e)}</li>`).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>GodsView Setup Snapshot — ${escapeXml(c.symbol)} ${escapeXml(c.confirmedAt.slice(0, 10))}</title>
<style>
  body { background: #0d0d14; color: #e0e0e0; font-family: 'Courier New', monospace; margin: 0; padding: 20px; }
  h1 { color: ${dirColor}; font-size: 18px; margin: 0 0 4px 0; }
  .meta { color: #888; font-size: 11px; margin-bottom: 16px; }
  .chart { max-width: 100%; }
  svg { max-width: 100%; height: auto; border: 1px solid #1a1a2e; border-radius: 4px; }
  .evidence { margin-top: 16px; }
  .evidence h3 { color: #888; font-size: 12px; margin: 0 0 6px 0; }
  .evidence ul { margin: 0; padding-left: 18px; color: #bbb; font-size: 11px; line-height: 1.8; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 10px; font-weight: bold; margin-right: 6px; }
</style>
</head>
<body>
<h1>${escapeXml(c.symbol)} — ${c.direction.toUpperCase()} Setup Snapshot</h1>
<p class="meta">
  <span class="badge" style="background:${dirColor};color:#000">${c.direction.toUpperCase()}</span>
  <span class="badge" style="background:#1a1a2e;color:#7c83fd">${escapeXml(c.setupType)}</span>
  <span class="badge" style="background:#1a1a2e;color:#7c83fd">${escapeXml(c.regime)}</span>
  Confirmed: ${escapeXml(c.confirmedAt.replace("T", " ").slice(0, 19))} UTC &nbsp;|&nbsp;
  Score: ${(c.confirmationScore * 100).toFixed(0)}% &nbsp;|&nbsp;
  R:R ${(Math.abs(c.takeProfit - c.entryPrice) / Math.abs(c.entryPrice - c.stopLoss)).toFixed(2)}:1 &nbsp;|&nbsp;
  Flow: ${escapeXml(c.orderflowBias)} &nbsp;|&nbsp;
  MTF: ${c.mtfAligned ? "✓ Aligned" : "✗ Divergent"} &nbsp;|&nbsp;
  ID: ${escapeXml(c.confirmationId.slice(0, 12))}
</p>
<div class="chart">${c.svgChart}</div>
<div class="evidence">
  <h3>Supporting Evidence at Confirmation</h3>
  <ul>${evidenceList}</ul>
</div>
</body>
</html>`;
}
