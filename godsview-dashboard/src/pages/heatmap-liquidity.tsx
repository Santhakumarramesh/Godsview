import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

export default function HeatmapLiquidity() {
  const [symbol, setSymbol] = useState("AAPL");

  const { data: orderbook = {} } = useQuery({
    queryKey: ["orderbook", symbol],
    queryFn: async () => {
      const res = await fetch(`${API}/api/market/orderbook`);
      if (!res.ok) throw new Error("Failed to fetch orderbook");
      return res.json();
    },
  });

  const { data: liquidity = {} } = useQuery({
    queryKey: ["liquidity", symbol],
    queryFn: async () => {
      const res = await fetch(`${API}/api/features/liquidity`);
      if (!res.ok) throw new Error("Failed to fetch liquidity data");
      return res.json();
    },
  });

  const generateHeatmapGrid = () => {
    const cells = [];
    for (let i = 0; i < 100; i++) {
      const intensity = Math.random();
      let color = "#0e0e0f";
      if (intensity > 0.7) color = "rgba(156,255,147,0.8)";
      else if (intensity > 0.4) color = "rgba(156,255,147,0.4)";
      else if (intensity > 0.2) color = "rgba(156,255,147,0.1)";
      cells.push(
        <div
          key={i}
          style={{
            width: "20px",
            height: "20px",
            backgroundColor: color,
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "2px",
          }}
        />
      );
    }
    return cells;
  };

  return (
    <div style={{ backgroundColor: "#0e0e0f", minHeight: "100vh", padding: "24px" }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        <div style={{ marginBottom: "32px" }}>
          <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", color: "#ffffff", marginBottom: "8px" }}>
            Heatmap Liquidity View
          </h1>
          <p style={{ color: "#767576", fontSize: "14px" }}>Bookmap-style depth and liquidity visualization</p>
        </div>

        <div style={{ marginBottom: "24px" }}>
          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="Enter symbol..."
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "8px",
              padding: "10px 12px",
              fontFamily: "Space Grotesk",
              color: "#ffffff",
              fontSize: "14px",
            }}
          />
        </div>

        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "24px",
            marginBottom: "24px",
          }}
        >
          <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", color: "#9cff93", marginBottom: "16px" }}>
            Depth Heatmap
          </h2>
          <div
            style={{
              backgroundColor: "#0e0e0f",
              borderRadius: "8px",
              padding: "16px",
              display: "grid",
              gridTemplateColumns: "repeat(10, 1fr)",
              gap: "4px",
            }}
          >
            {generateHeatmapGrid()}
          </div>
          <div style={{ display: "flex", gap: "16px", marginTop: "16px", justifyContent: "flex-start" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{ width: "16px", height: "16px", backgroundColor: "rgba(156,255,147,0.8)", borderRadius: "2px" }} />
              <span style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576" }}>Very High</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{ width: "16px", height: "16px", backgroundColor: "rgba(156,255,147,0.4)", borderRadius: "2px" }} />
              <span style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576" }}>Medium</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{ width: "16px", height: "16px", backgroundColor: "rgba(156,255,147,0.1)", borderRadius: "2px" }} />
              <span style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576" }}>Low</span>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", color: "#9cff93", marginBottom: "16px" }}>
              Liquidity Walls
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {[
                { level: "Buy Wall", size: 45000, color: "#9cff93" },
                { level: "Sell Wall", size: 38000, color: "#ff6464" },
                { level: "Support", size: 28000, color: "#9cff93" },
                { level: "Resistance", size: 31000, color: "#ff6464" },
              ].map((wall, idx) => (
                <div key={idx} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576", minWidth: "80px" }}>
                    {wall.level}
                  </span>
                  <div style={{ flex: 1, height: "8px", backgroundColor: "#0e0e0f", borderRadius: "4px", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${(wall.size / 50000) * 100}%`, backgroundColor: wall.color }} />
                  </div>
                  <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "11px", color: wall.color }}>
                    {wall.size.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", color: "#9cff93", marginBottom: "16px" }}>
              Hidden Liquidity Signals
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div style={{ backgroundColor: "#0e0e0f", borderRadius: "8px", padding: "12px" }}>
                <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#ffffff", margin: "0 0 4px 0" }}>
                  Depth Shift Detected
                </p>
                <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "11px", color: "#9cff93", margin: 0 }}>
                  +{liquidity.depth_shift || "—"}% in last 5 mins
                </p>
              </div>
              <div style={{ backgroundColor: "#0e0e0f", borderRadius: "8px", padding: "12px" }}>
                <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#ffffff", margin: "0 0 4px 0" }}>
                  Iceberg Orders
                </p>
                <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "11px", color: "#9cff93", margin: 0 }}>
                  {liquidity.iceberg_count || "—"} detected
                </p>
              </div>
              <div style={{ backgroundColor: "#0e0e0f", borderRadius: "8px", padding: "12px" }}>
                <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#ffffff", margin: "0 0 4px 0" }}>
                  Momentum Walls
                </p>
                <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "11px", color: "#ff6464", margin: 0 }}>
                  {liquidity.momentum_walls || "—"} walls
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
