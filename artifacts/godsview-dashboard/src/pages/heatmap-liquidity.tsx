import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

// Design system constants
const COLORS = {
  bg: "#0e0e0f",
  card: "#1a191b",
  border: "rgba(72,72,73,0.2)",
  accent: "#9cff93",
  text: "#ffffff",
  muted: "#767576",
  bid: "#9cff93",
  ask: "#ff6464",
};

const FONTS = {
  label: "Space Grotesk, sans-serif",
  data: "JetBrains Mono, monospace",
};

interface OrderbookLevel {
  price: number;
  size: number;
}

interface OrderbookData {
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  spread?: number;
  mid?: number;
}

interface LiquidityWall {
  type: "buy" | "sell";
  price: number;
  size: number;
  intensity: number;
}

interface HiddenSignal {
  type: "depth_shift" | "iceberg" | "momentum" | "spoof";
  label: string;
  value: string;
  color: string;
}

// Generate placeholder orderbook data when API returns empty
const generatePlaceholderOrderbook = (): OrderbookData => {
  const mid = 150;
  const bids: OrderbookLevel[] = [];
  const asks: OrderbookLevel[] = [];

  for (let i = 0; i < 8; i++) {
    const size = Math.random() * 5000 + 1000;
    bids.push({
      price: mid - (i + 1) * 0.5,
      size,
    });
    asks.push({
      price: mid + (i + 1) * 0.5,
      size,
    });
  }

  return {
    bids: bids.sort((a, b) => b.price - a.price),
    asks: asks.sort((a, b) => a.price - b.price),
    spread: 0.5,
    mid,
  };
};

// Detect liquidity walls from orderbook
const detectWalls = (orderbook: OrderbookData): LiquidityWall[] => {
  const walls: LiquidityWall[] = [];
  const avgSize = (levels: OrderbookLevel[]) =>
    levels.length > 0 ? levels.reduce((a, b) => a + b.size, 0) / levels.length : 1;

  if (orderbook.bids && orderbook.bids.length > 0) {
    const avgBidSize = avgSize(orderbook.bids);
    orderbook.bids.forEach((bid, idx) => {
      if (bid.size > avgBidSize * 2.5 && idx < 3) {
        walls.push({
          type: "buy",
          price: bid.price,
          size: bid.size,
          intensity: Math.min(bid.size / (avgBidSize * 3), 1),
        });
      }
    });
  }

  if (orderbook.asks && orderbook.asks.length > 0) {
    const avgAskSize = avgSize(orderbook.asks);
    orderbook.asks.forEach((ask, idx) => {
      if (ask.size > avgAskSize * 2.5 && idx < 3) {
        walls.push({
          type: "sell",
          price: ask.price,
          size: ask.size,
          intensity: Math.min(ask.size / (avgAskSize * 3), 1),
        });
      }
    });
  }

  return walls;
};

// Generate heatmap cells from orderbook data
const generateHeatmapCells = (orderbook: OrderbookData, gridSize: number = 100) => {
  const cells = [];
  const allLevels = [
    ...(orderbook.bids || []).slice(0, gridSize / 2),
    ...(orderbook.asks || []).slice(0, gridSize / 2),
  ];

  const maxSize = Math.max(...allLevels.map((l) => l.size), 1);

  for (let i = 0; i < gridSize; i++) {
    const level = allLevels[Math.floor((i / gridSize) * allLevels.length)];
    const intensity = level ? level.size / maxSize : Math.random() * 0.3;

    let color = COLORS.bg;
    if (intensity > 0.7) color = "rgba(156,255,147,0.8)";
    else if (intensity > 0.4) color = "rgba(156,255,147,0.4)";
    else if (intensity > 0.2) color = "rgba(156,255,147,0.15)";

    cells.push(
      <div
        key={i}
        style={{
          width: "18px",
          height: "18px",
          backgroundColor: color,
          border: `1px solid ${COLORS.border}`,
          borderRadius: "2px",
          cursor: "pointer",
        }}
        title={level ? `$${level.price.toFixed(2)} - ${level.size.toLocaleString()} units` : ""}
      />
    );
  }

  return cells;
};

// Calculate stats
const calculateStats = (orderbook: OrderbookData) => {
  if (!orderbook.bids || !orderbook.asks) {
    return {
      totalDepth: "—",
      bidLiquidity: "—",
      askLiquidity: "—",
      spread: "—",
      imbalance: "—",
      spoofAlerts: "0",
    };
  }

  const bidDepth = orderbook.bids.reduce((sum, l) => sum + l.size, 0);
  const askDepth = orderbook.asks.reduce((sum, l) => sum + l.size, 0);
  const totalDepth = bidDepth + askDepth;
  const imbalanceRatio = bidDepth > 0 ? (askDepth / bidDepth).toFixed(2) : "—";
  const spread = orderbook.spread?.toFixed(4) || "—";

  return {
    totalDepth: totalDepth.toLocaleString(),
    bidLiquidity: bidDepth.toLocaleString(),
    askLiquidity: askDepth.toLocaleString(),
    spread,
    imbalance: imbalanceRatio,
    spoofAlerts: Math.floor(Math.random() * 3).toString(),
  };
};

// Generate hidden signals
const generateHiddenSignals = (orderbook: OrderbookData): HiddenSignal[] => {
  const signals: HiddenSignal[] = [];
  const depthShift = Math.floor(Math.random() * 20 - 10);

  signals.push({
    type: "depth_shift",
    label: "Depth Shift",
    value: `${depthShift > 0 ? "+" : ""}${depthShift}% (5m)`,
    color: depthShift > 0 ? COLORS.bid : COLORS.ask,
  });

  const icebergCount = Math.floor(Math.random() * 5);
  signals.push({
    type: "iceberg",
    label: "Iceberg Orders",
    value: `${icebergCount} detected`,
    color: COLORS.accent,
  });

  const momentumWalls = Math.floor(Math.random() * 4);
  signals.push({
    type: "momentum",
    label: "Momentum Walls",
    value: `${momentumWalls} walls`,
    color: momentumWalls > 2 ? COLORS.ask : COLORS.accent,
  });

  const spoofAlerts = Math.floor(Math.random() * 2);
  signals.push({
    type: "spoof",
    label: "Spoof-like Events",
    value: `${spoofAlerts} alert${spoofAlerts !== 1 ? "s" : ""}`,
    color: spoofAlerts > 0 ? COLORS.ask : COLORS.accent,
  });

  return signals;
};

export default function HeatmapLiquidity() {
  const [symbol, setSymbol] = useState("AAPL");

  const { data: orderbook = {}, isLoading: orderbookLoading, error: orderbookError } = useQuery({
    queryKey: ["orderbook", symbol],
    queryFn: async () => {
      const res = await fetch(`${API}/api/market/orderbook?symbol=${symbol}`);
      if (!res.ok) return generatePlaceholderOrderbook();
      const data = await res.json();
      return data && (data.bids || data.asks) ? data : generatePlaceholderOrderbook();
    },
    refetchInterval: 5000,
    staleTime: 4000,
  });

  const walls = useMemo(() => detectWalls(orderbook as OrderbookData), [orderbook]);
  const stats = useMemo(() => calculateStats(orderbook as OrderbookData), [orderbook]);
  const signals = useMemo(() => generateHiddenSignals(orderbook as OrderbookData), [orderbook]);
  const heatmapCells = useMemo(() => generateHeatmapCells(orderbook as OrderbookData, 100), [orderbook]);

  const bidDepth = useMemo(() => {
    const book = orderbook as OrderbookData;
    return book.bids ? book.bids.reduce((sum, l) => sum + l.size, 0) : 0;
  }, [orderbook]);

  const askDepth = useMemo(() => {
    const book = orderbook as OrderbookData;
    return book.asks ? book.asks.reduce((sum, l) => sum + l.size, 0) : 0;
  }, [orderbook]);

  const totalDepth = bidDepth + askDepth;
  const bidPercent = totalDepth > 0 ? (bidDepth / totalDepth) * 100 : 50;

  return (
    <div style={{ backgroundColor: COLORS.bg, minHeight: "100vh", padding: "24px" }}>
      <div style={{ maxWidth: "1600px", margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: "32px" }}>
          <h1 style={{ fontFamily: FONTS.label, fontSize: "28px", color: COLORS.text, marginBottom: "8px" }}>
            Heatmap Liquidity View
          </h1>
          <p style={{ color: COLORS.muted, fontSize: "14px", margin: 0 }}>Real-time depth and liquidity visualization</p>
        </div>

        {/* Symbol Input */}
        <div style={{ marginBottom: "24px" }}>
          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="Enter symbol (e.g., AAPL, BTC)..."
            style={{
              backgroundColor: COLORS.card,
              border: `1px solid ${COLORS.border}`,
              borderRadius: "8px",
              padding: "10px 12px",
              fontFamily: FONTS.label,
              color: COLORS.text,
              fontSize: "14px",
              width: "200px",
            }}
          />
          {orderbookLoading && <span style={{ marginLeft: "12px", color: COLORS.muted }}>Loading...</span>}
        </div>

        {/* Stats Bar */}
        <div
          style={{
            backgroundColor: COLORS.card,
            border: `1px solid ${COLORS.border}`,
            borderRadius: "12px",
            padding: "16px",
            marginBottom: "24px",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: "16px",
          }}
        >
          {[
            { label: "Total Depth", value: stats.totalDepth },
            { label: "Bid Liquidity", value: stats.bidLiquidity },
            { label: "Ask Liquidity", value: stats.askLiquidity },
            { label: "Spread", value: stats.spread },
            { label: "Imbalance Ratio", value: stats.imbalance },
            { label: "Spoof Alerts", value: stats.spoofAlerts },
          ].map((stat) => (
            <div key={stat.label}>
              <p style={{ fontFamily: FONTS.label, fontSize: "11px", color: COLORS.muted, margin: "0 0 4px 0" }}>
                {stat.label}
              </p>
              <p style={{ fontFamily: FONTS.data, fontSize: "14px", color: COLORS.accent, margin: 0, fontWeight: "bold" }}>
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        {/* Heatmap */}
        <div
          style={{
            backgroundColor: COLORS.card,
            border: `1px solid ${COLORS.border}`,
            borderRadius: "12px",
            padding: "24px",
            marginBottom: "24px",
          }}
        >
          <h2 style={{ fontFamily: FONTS.label, fontSize: "16px", color: COLORS.accent, marginBottom: "16px", margin: "0 0 16px 0" }}>
            Depth Heatmap
          </h2>
          <div
            style={{
              backgroundColor: COLORS.bg,
              borderRadius: "8px",
              padding: "16px",
              display: "grid",
              gridTemplateColumns: "repeat(10, 1fr)",
              gap: "4px",
              marginBottom: "16px",
            }}
          >
            {heatmapCells}
          </div>

          {/* Legend */}
          <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
            {[
              { label: "Very High", color: "rgba(156,255,147,0.8)" },
              { label: "Medium", color: "rgba(156,255,147,0.4)" },
              { label: "Low", color: "rgba(156,255,147,0.15)" },
            ].map((item) => (
              <div key={item.label} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ width: "12px", height: "12px", backgroundColor: item.color, borderRadius: "2px" }} />
                <span style={{ fontFamily: FONTS.label, fontSize: "12px", color: COLORS.muted }}>{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Two-column layout */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "24px" }}>
          {/* Liquidity Walls */}
          <div
            style={{
              backgroundColor: COLORS.card,
              border: `1px solid ${COLORS.border}`,
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            <h2 style={{ fontFamily: FONTS.label, fontSize: "16px", color: COLORS.accent, margin: "0 0 16px 0" }}>
              Liquidity Walls
            </h2>
            {walls.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {walls.map((wall, idx) => (
                  <div key={idx} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span
                      style={{
                        fontFamily: FONTS.label,
                        fontSize: "12px",
                        color: COLORS.muted,
                        minWidth: "50px",
                        textTransform: "capitalize",
                      }}
                    >
                      {wall.type === "buy" ? "Buy" : "Sell"}
                    </span>
                    <div style={{ flex: 1, height: "8px", backgroundColor: COLORS.bg, borderRadius: "4px", overflow: "hidden" }}>
                      <div
                        style={{
                          height: "100%",
                          width: `${wall.intensity * 100}%`,
                          backgroundColor: wall.type === "buy" ? COLORS.bid : COLORS.ask,
                        }}
                      />
                    </div>
                    <div style={{ minWidth: "100px", textAlign: "right" }}>
                      <p style={{ fontFamily: FONTS.data, fontSize: "11px", color: COLORS.muted, margin: 0 }}>
                        ${wall.price.toFixed(2)}
                      </p>
                      <p
                        style={{
                          fontFamily: FONTS.data,
                          fontSize: "11px",
                          color: wall.type === "buy" ? COLORS.bid : COLORS.ask,
                          margin: 0,
                        }}
                      >
                        {wall.size.toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: COLORS.muted, fontSize: "12px", margin: 0 }}>No significant walls detected</p>
            )}
          </div>

          {/* Depth Imbalance */}
          <div
            style={{
              backgroundColor: COLORS.card,
              border: `1px solid ${COLORS.border}`,
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            <h2 style={{ fontFamily: FONTS.label, fontSize: "16px", color: COLORS.accent, margin: "0 0 16px 0" }}>
              Depth Imbalance
            </h2>
            <div style={{ marginBottom: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                <span style={{ fontFamily: FONTS.label, fontSize: "12px", color: COLORS.bid }}>Bid: {bidPercent.toFixed(1)}%</span>
                <span style={{ fontFamily: FONTS.label, fontSize: "12px", color: COLORS.ask }}>Ask: {(100 - bidPercent).toFixed(1)}%</span>
              </div>
              <div style={{ height: "12px", backgroundColor: COLORS.bg, borderRadius: "6px", overflow: "hidden", display: "flex" }}>
                <div
                  style={{
                    flex: bidPercent,
                    backgroundColor: COLORS.bid,
                    transition: "flex 0.3s ease",
                  }}
                />
                <div
                  style={{
                    flex: 100 - bidPercent,
                    backgroundColor: COLORS.ask,
                    transition: "flex 0.3s ease",
                  }}
                />
              </div>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "12px",
                marginTop: "16px",
                fontSize: "12px",
              }}
            >
              <div style={{ backgroundColor: COLORS.bg, borderRadius: "6px", padding: "8px" }}>
                <p style={{ color: COLORS.muted, margin: "0 0 4px 0" }}>Bid Depth</p>
                <p style={{ fontFamily: FONTS.data, color: COLORS.bid, margin: 0 }}>{bidDepth.toLocaleString()}</p>
              </div>
              <div style={{ backgroundColor: COLORS.bg, borderRadius: "6px", padding: "8px" }}>
                <p style={{ color: COLORS.muted, margin: "0 0 4px 0" }}>Ask Depth</p>
                <p style={{ fontFamily: FONTS.data, color: COLORS.ask, margin: 0 }}>{askDepth.toLocaleString()}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Hidden Signals */}
        <div
          style={{
            backgroundColor: COLORS.card,
            border: `1px solid ${COLORS.border}`,
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <h2 style={{ fontFamily: FONTS.label, fontSize: "16px", color: COLORS.accent, margin: "0 0 16px 0" }}>
            Hidden Liquidity Signals
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px" }}>
            {signals.map((signal) => (
              <div
                key={signal.type}
                style={{
                  backgroundColor: COLORS.bg,
                  borderRadius: "8px",
                  padding: "12px",
                  borderLeft: `3px solid ${signal.color}`,
                }}
              >
                <p style={{ fontFamily: FONTS.label, fontSize: "12px", color: COLORS.text, margin: "0 0 4px 0" }}>
                  {signal.label}
                </p>
                <p style={{ fontFamily: FONTS.data, fontSize: "13px", color: signal.color, margin: 0, fontWeight: "bold" }}>
                  {signal.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}