import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toArray } from "@/lib/safe";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

export default function AbsorptionDetector() {
  const [symbol, setSymbol] = useState("AAPL");
  const [expandedLevel, setExpandedLevel] = useState<string | null>(null);

  const { data: features = {}, isLoading: loadingFeatures, error: errorFeatures } = useQuery({
    queryKey: ["absorption-features", symbol],
    queryFn: async () => {
      const res = await fetch(`${API}/api/features/${symbol}`);
      if (!res.ok) throw new Error("Failed to fetch features");
      return res.json();
    },
  });

  const { data: absorptionSignals = [], isLoading: loadingSignals, error: errorSignals } = useQuery({
    queryKey: ["absorption-signals", symbol],
    queryFn: async () => {
      const res = await fetch(`${API}/api/signals?setup_type=absorption`);
      if (!res.ok) throw new Error("Failed to fetch absorption signals");
      return res.json();
    },
  });

  const defendedLevels = [
    { price: 150.50, hitCount: 23, totalVolume: 245000, holdDuration: "12m 45s", status: "active" },
    { price: 150.25, hitCount: 18, totalVolume: 189000, holdDuration: "8m 32s", status: "active" },
    { price: 150.00, hitCount: 15, totalVolume: 156000, holdDuration: "5m 18s", status: "holding" },
    { price: 149.75, hitCount: 12, totalVolume: 128000, holdDuration: "3m 44s", status: "breached" },
    { price: 149.50, hitCount: 9, totalVolume: 92000, holdDuration: "2m 10s", status: "breached" },
  ];

  return (
    <div style={{ backgroundColor: "#0e0e0f", minHeight: "100vh", padding: "24px" }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        <div style={{ marginBottom: "32px" }}>
          <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", color: "#ffffff", marginBottom: "8px" }}>
            Absorption Detector
          </h1>
          <p style={{ color: "#767576", fontSize: "14px" }}>Identify defended levels and volume absorption patterns</p>
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

        {(loadingFeatures || loadingSignals) && (
          <div style={{ textAlign: "center", padding: "40px", color: "#767576" }}>Loading data...</div>
        )}

        {(errorFeatures || errorSignals) && (
          <div style={{ backgroundColor: "#1a191b", border: "1px solid rgba(255,107,107,0.3)", borderRadius: "12px", padding: "20px", marginBottom: "24px" }}>
            <div style={{ color: "#ff6b6b", fontSize: "14px" }}>Failed to load data</div>
            <div style={{ color: "#767576", fontSize: "12px", marginTop: "4px" }}>Check API connection</div>
          </div>
        )}

        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "24px",
            marginBottom: "24px",
          }}
        >
          <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", color: "#ffffff", marginBottom: "16px" }}>
            Defended Levels ({defendedLevels.length})
          </h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                  <th style={{ textAlign: "left", padding: "12px", fontFamily: "Space Grotesk", color: "#9cff93", fontSize: "12px" }}>
                    Level Price
                  </th>
                  <th style={{ textAlign: "right", padding: "12px", fontFamily: "Space Grotesk", color: "#9cff93", fontSize: "12px" }}>
                    Hit Count
                  </th>
                  <th style={{ textAlign: "right", padding: "12px", fontFamily: "Space Grotesk", color: "#9cff93", fontSize: "12px" }}>
                    Volume Absorbed
                  </th>
                  <th style={{ textAlign: "right", padding: "12px", fontFamily: "Space Grotesk", color: "#9cff93", fontSize: "12px" }}>
                    Hold Duration
                  </th>
                  <th style={{ textAlign: "center", padding: "12px", fontFamily: "Space Grotesk", color: "#9cff93", fontSize: "12px" }}>
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {defendedLevels.map((level, idx) => (
                  <tr
                    key={idx}
                    style={{
                      borderBottom: "1px solid rgba(72,72,73,0.2)",
                      cursor: "pointer",
                      backgroundColor: expandedLevel === String(idx) ? "rgba(156,255,147,0.05)" : "transparent",
                    }}
                    onClick={() => setExpandedLevel(expandedLevel === String(idx) ? null : String(idx))}
                  >
                    <td style={{ padding: "12px", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#ffffff" }}>
                      {level.price.toFixed(2)}
                    </td>
                    <td style={{ padding: "12px", textAlign: "right", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#ffffff" }}>
                      {level.hitCount}
                    </td>
                    <td style={{ padding: "12px", textAlign: "right", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#ffffff" }}>
                      {(level.totalVolume / 1000).toFixed(0)}K
                    </td>
                    <td style={{ padding: "12px", textAlign: "right", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#767576" }}>
                      {level.holdDuration}
                    </td>
                    <td style={{ padding: "12px", textAlign: "center" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "4px 8px",
                          borderRadius: "4px",
                          fontSize: "11px",
                          fontFamily: "Space Grotesk",
                          backgroundColor: level.status === "active" ? "rgba(156,255,147,0.2)" : level.status === "holding" ? "rgba(200,200,100,0.2)" : "rgba(255,100,100,0.2)",
                          color: level.status === "active" ? "#9cff93" : level.status === "holding" ? "#d4d464" : "#ff6464",
                        }}
                      >
                        {level.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {expandedLevel !== null && defendedLevels[parseInt(expandedLevel)] && (
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
              Level Details - {defendedLevels[parseInt(expandedLevel)].price.toFixed(2)}
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <div style={{ backgroundColor: "#0e0e0f", borderRadius: "8px", padding: "12px" }}>
                <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576", margin: "0 0 4px 0" }}>
                  Total Touches
                </p>
                <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "18px", color: "#9cff93", margin: 0 }}>
                  {defendedLevels[parseInt(expandedLevel)].hitCount}
                </p>
              </div>
              <div style={{ backgroundColor: "#0e0e0f", borderRadius: "8px", padding: "12px" }}>
                <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576", margin: "0 0 4px 0" }}>
                  Time at Level
                </p>
                <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "18px", color: "#9cff93", margin: 0 }}>
                  {defendedLevels[parseInt(expandedLevel)].holdDuration}
                </p>
              </div>
            </div>
          </div>
        )}

        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", color: "#ffffff", marginBottom: "16px" }}>
            Absorption Signals ({toArray<any>(absorptionSignals, "signals").length})
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px" }}>
            {toArray<any>(absorptionSignals, "signals").map((signal: any, idx: number) => (
              <div
                key={idx}
                style={{
                  backgroundColor: "#0e0e0f",
                  border: "1px solid rgba(72,72,73,0.2)",
                  borderRadius: "8px",
                  padding: "12px",
                }}
              >
                <p style={{ fontFamily: "Space Grotesk", fontSize: "13px", color: "#ffffff", margin: "0 0 8px 0" }}>
                  {signal?.description ?? `Signal ${idx}`}
                </p>
                <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "11px", color: "#767576", margin: "0 0 4px 0" }}>
                  Strength: {signal?.strength ?? "—"}
                </p>
                <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "11px", color: "#9cff93", margin: 0 }}>
                  Confidence: {signal?.confidence ?? "—"}%
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
