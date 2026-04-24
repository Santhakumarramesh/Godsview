import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

export default function OrderFlow() {
  const [symbol, setSymbol] = useState("AAPL");

  const { data: features = {} } = useQuery({
    queryKey: ["features", symbol],
    queryFn: async () => {
      const res = await fetch(`${API}/api/features/${symbol}`);
      if (!res.ok) throw new Error("Failed to fetch features");
      return res.json();
    },
  });

  const { data: marketStructure = {} } = useQuery({
    queryKey: ["market-structure", symbol],
    queryFn: async () => {
      const res = await fetch(`${API}/api/market-structure`);
      if (!res.ok) throw new Error("Failed to fetch market structure");
      return res.json();
    },
  });

  return (
    <div style={{ backgroundColor: "#0e0e0f", minHeight: "100vh", padding: "24px" }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        <div style={{ marginBottom: "32px" }}>
          <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", color: "#ffffff", marginBottom: "8px" }}>
            Order Flow Dashboard
          </h1>
          <p style={{ color: "#767576", fontSize: "14px" }}>Delta analysis, imbalances, and absorption signals</p>
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

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px", marginBottom: "24px" }}>
          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#9cff93", margin: "0 0 8px 0" }}>
              BUY VOLUME
            </p>
            <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "24px", color: "#ffffff", margin: 0 }}>
              {features.buy_volume?.toLocaleString() || "—"}
            </p>
          </div>

          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#9cff93", margin: "0 0 8px 0" }}>
              SELL VOLUME
            </p>
            <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "24px", color: "#ffffff", margin: 0 }}>
              {features.sell_volume?.toLocaleString() || "—"}
            </p>
          </div>

          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#9cff93", margin: "0 0 8px 0" }}>
              DELTA
            </p>
            <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "24px", color: features.delta > 0 ? "#9cff93" : "#ff6464", margin: 0 }}>
              {features.delta?.toLocaleString() || "—"}
            </p>
          </div>

          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#9cff93", margin: "0 0 8px 0" }}>
              CUMULATIVE DELTA
            </p>
            <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "24px", color: "#ffffff", margin: 0 }}>
              {features.cumulative_delta?.toLocaleString() || "—"}
            </p>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "24px" }}>
          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", color: "#9cff93", marginBottom: "16px" }}>
              Delta Chart
            </h2>
            <div
              style={{
                height: "200px",
                backgroundColor: "#0e0e0f",
                borderRadius: "8px",
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "space-around",
                padding: "16px",
              }}
            >
              {[40, 65, 45, 80, 55, 70, 50].map((val, i) => (
                <div
                  key={i}
                  style={{
                    height: `${(val / 100) * 150}px`,
                    width: "20px",
                    backgroundColor: val > 50 ? "#9cff93" : "#767576",
                    borderRadius: "4px",
                  }}
                />
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
              Aggression Meter
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                  <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#ffffff", margin: 0 }}>
                    Aggressive Buyers
                  </p>
                  <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#9cff93", margin: 0 }}>
                    {features.aggressive_buyers || "—"}%
                  </p>
                </div>
                <div style={{ height: "8px", backgroundColor: "#0e0e0f", borderRadius: "4px", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${features.aggressive_buyers || 0}%`, backgroundColor: "#9cff93" }} />
                </div>
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                  <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#ffffff", margin: 0 }}>
                    Aggressive Sellers
                  </p>
                  <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#ff6464", margin: 0 }}>
                    {features.aggressive_sellers || "—"}%
                  </p>
                </div>
                <div style={{ height: "8px", backgroundColor: "#0e0e0f", borderRadius: "4px", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${features.aggressive_sellers || 0}%`, backgroundColor: "#ff6464" }} />
                </div>
              </div>
            </div>
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
          <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", color: "#ffffff", marginBottom: "12px" }}>
            Imbalance Indicators
          </h2>
          <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#767576", margin: 0 }}>
            Buy/Sell Imbalance Ratio: {features.imbalance_ratio || "—"}
          </p>
        </div>
      </div>
    </div>
  );
}
