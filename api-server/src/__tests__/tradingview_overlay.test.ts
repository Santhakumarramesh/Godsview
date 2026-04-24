import { describe, it, expect, beforeEach } from "vitest";
import {
  generateChartOverlay, getOverlay, renderStructureLevels,
  renderOrderBlocks, renderPositionOverlay, renderSignalMarkers,
  getOverlaySnapshot, resetOverlays,
} from "../lib/tradingview_overlay.js";

describe("TradingView Overlay", () => {
  beforeEach(() => { resetOverlays(); });

  it("generates auto structure levels around price", () => {
    const levels = renderStructureLevels({ symbol: "AAPL", currentPrice: 175 });
    expect(levels.length).toBe(4);
    const supports = levels.filter((l) => l.type === "support");
    const resistances = levels.filter((l) => l.type === "resistance");
    expect(supports.length).toBe(2);
    expect(resistances.length).toBe(2);
    supports.forEach((s) => expect(s.price).toBeLessThan(175));
    resistances.forEach((r) => expect(r.price).toBeGreaterThan(175));
  });

  it("renders order blocks", () => {
    const blocks = renderOrderBlocks({ symbol: "BTC", currentPrice: 65000 });
    expect(blocks.length).toBe(2);
    expect(blocks.find((b) => b.type === "demand")).toBeDefined();
    expect(blocks.find((b) => b.type === "supply")).toBeDefined();
  });

  it("renders position overlay with targets", () => {
    const pos = renderPositionOverlay({
      symbol: "NVDA", direction: "long", entryPrice: 850, currentStop: 830,
      targets: [{ price: 880, label: "TP1" }, { price: 910, label: "TP2" }],
    });
    expect(pos.symbol).toBe("NVDA");
    expect(pos.targets).toHaveLength(2);
    expect(pos.direction).toBe("long");
  });

  it("renders signal markers", () => {
    const signals = renderSignalMarkers({
      symbol: "AAPL",
      signals: [
        { type: "buy", price: 170, label: "RSI oversold", confidence: 0.8 },
        { type: "sell", price: 185, label: "RSI overbought" },
      ],
    });
    expect(signals).toHaveLength(2);
    expect(signals[0].confidence).toBe(0.8);
    expect(signals[1].confidence).toBe(0.5); // default
  });

  it("generates full chart overlay", () => {
    const overlay = generateChartOverlay({
      symbol: "TSLA",
      currentPrice: 250,
      position: { direction: "long", entryPrice: 245, currentStop: 238, targets: [{ price: 260, label: "TP1" }] },
      signals: [{ type: "buy", price: 245, label: "Entry signal" }],
    });
    expect(overlay.symbol).toBe("TSLA");
    expect(overlay.structures.length).toBeGreaterThan(0);
    expect(overlay.orderBlocks.length).toBeGreaterThan(0);
    expect(overlay.positions).toHaveLength(1);
    expect(overlay.signals).toHaveLength(1);
  });

  it("caches and retrieves overlays", () => {
    generateChartOverlay({ symbol: "SPY", currentPrice: 500 });
    const cached = getOverlay("SPY");
    expect(cached).toBeDefined();
    expect(cached!.symbol).toBe("SPY");
  });

  it("tracks snapshot telemetry", () => {
    generateChartOverlay({ symbol: "A", currentPrice: 100 });
    generateChartOverlay({ symbol: "B", currentPrice: 200 });
    const snap = getOverlaySnapshot();
    expect(snap.totalOverlaysGenerated).toBe(2);
    expect(snap.activeSymbols).toHaveLength(2);
  });

  it("resets cleanly", () => {
    generateChartOverlay({ symbol: "X", currentPrice: 50 });
    resetOverlays();
    expect(getOverlaySnapshot().totalOverlaysGenerated).toBe(0);
    expect(getOverlay("X")).toBeUndefined();
  });
});
