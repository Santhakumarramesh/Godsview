import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

export default function ImbalanceEngine() {
  const [symbol, setSymbol] = useState("AAPL");
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);

  const { data: features = {} } = useQuery({
    queryKey: ["imbalance-features", symbol],
    queryFn: async () => {
      const res = await fetch(`${API}/api/features/${symbol}`);
      if (!res.ok) throw new Error("Failed to fetch features");
      return res.json();
    },
  });

  const imbalanceRatio = features.imbalance_ratio || 1.2;
  const persistenceScore = features.persistence_score || 72;
  const buyVolume = features.buy_volume || 245000;
  const sellVolume = features.sell_volume || 204000;
  const totalVolume = buyVolume + sellVolume;

  const imbalanceHistory = [
    { timestamp: "14:32:15", ratio: 1.45, direction: "bullish", strength: "strong", outcome: "continuation" },
    { timestamp: "14:31:42", ratio: 0.85, direction: "bearish", strength: "moderate", outcome: "reversal" },
    { timestamp: "14:31:08", ratio: 1.28, direction: "bullish", strength: "strong", outcome: "continuation" },
    { timestamp: "14:30:35", ratio: 0.92, direction: "bearish", strength: "weak", outcome: "neutral" },
    { timestamp: "14:30:02", ratio: 1.52, direction: "bullish", strength: "very_strong", outcome: "continuation" },
  ];

  const getImbalanceColor = (ratio: number) => {
    if (ratio > 1.3) return "#9cff93";
    if (ratio < 0.77) return "#ff6464";
    return "#d4d464";
  };

  const getOutcomeColor = (outcome: string) => {
    if (outcome === "continuation") return "#9cff93";
    if (outcome === "reversal") return "#ff6464";
    return "#d4d464";
  };

  return (
    <div style={{ backgroundColor: "#0e0e0f", minHeight: "100vh", padding: "24px" }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        <div style={{ marginBottom: "32px" }}>
          <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", color: "#ffffff", marginBottom: "8px" }}>
            Imbalance Engine
          </h1>
          <p style={{ color: "#767576", fontSize: "14px" }}>Real-time buy/sell imbalance detection and analysis</p>
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

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "24px" }}>
          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", color: "#9cff93", marginBottom: "20px" }}>
              Current Imbalance
            </h2>

            <div style={{ marginBottom: "24px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
                <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576", margin: 0 }}>
                  Imbalance Ratio
                </p>
                <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "16px", color: getImbalanceColor(imbalanceRatio), margin: 0 }}>
                  {imbalanceRatio.toFixed(2)}
                </p>
              </div>
              <div style={{ height: "12px", backgroundColor: "#0e0e0f", borderRadius: "6px", overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${Math.min((imbalanceRatio / 2) * 100, 100)}%`,
                    backgroundColor: getImbalanceColor(imbalanceRatio),
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px" }}>
                <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "10px", color: "#767576" }}>0.5</span>
                <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "10px", color: "#767576" }}>Balanced</span>
                <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "10px", color: "#767576" }}>2.0</span>
              </div>
            </div>

            <div style={{ marginBottom: "24px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
                <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576", margin: 0 }}>
                  Persistence Score
                </p>
                <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "16px", color: "#9cff93", margin: 0 }}>
                  {persistenceScore}%
                </p>
              </div>
              <div style={{ height: "12px", backgroundColor: "#0e0e0f", borderRadius: "6px", overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${persistenceScore}%`,
                    backgroundColor: "#9cff93",
                  }}
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div style={{ backgroundColor: "#0e0e0f", borderRadius: "8px", padding: "12px" }}>
                <p style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: "#9cff93", margin: "0 0 8px 0" }}>
                  BUY VOLUME
                </p>
                <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "14px", color: "#ffffff", margin: 0 }}>
                  {(buyVolume / 1000).toFixed(0)}K
                </p>
                <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "10px", color: "#767576", margin: "4px 0 0 0" }}>
                  {((buyVolume / totalVolume) * 100).toFixed(1)}%
                </p>
              </div>
              <div style={{ backgroundColor: "#0e0e0f", borderRadius: "8px", padding: "12px" }}>
                <p style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: "#ff6464", margin: "0 0 8px 0" }}>
                  SELL VOLUME
                </p>
                <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "14px", color: "#ffffff", margin: 0 }}>
                  {(sellVolume / 1000).toFixed(0)}K
                </p>
                <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "10px", color: "#767576", margin: "4px 0 0 0" }}>
                  {((sellVolume / totalVolume) * 100).toFixed(1)}%
                </p>
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
            <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", color: "#9cff93", marginBottom: "20px" }}>
              Imbalance Hints
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div style={{ backgroundColor: "#0e0e0f", borderRadius: "8px", padding: "12px" }}>
                <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#ffffff", margin: "0 0 4px 0" }}>
                  Current Bias
                </p>
                <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#9cff93", margin: 0 }}>
                  {imbalanceRatio > 1.15 ? "Bullish" : imbalanceRatio < 0.87 ? "Bearish" : "Balanced"}
                </p>
              </div>
              <div style={{ backgroundColor: "#0e0e0f", borderRadius: "8px", padding: "12px" }}>
                <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#ffffff", margin: "0 0 4px 0" }}>
                  Expected Outcome
                </p>
                <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: persistenceScore > 70 ? "#9cff93" : "#d4d464", margin: 0 }}>
                  {persistenceScore > 70 ? "Likely Continuation" : persistenceScore > 50 ? "Possible Reversal" : "Uncertain"}
                </p>
              </div>
              <div style={{ backgroundColor: "#0e0e0f", borderRadius: "8px", padding: "12px" }}>
                <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#ffffff", margin: "0 0 4px 0" }}>
                  Signal Strength
                </p>
                <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#9cff93", margin: 0 }}>
                  {imbalanceRatio > 1.4 || imbalanceRatio < 0.72 ? "Very Strong" : imbalanceRatio > 1.2 || imbalanceRatio < 0.85 ? "Strong" : "Moderate"}
                </p>
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
          <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", color: "#ffffff", marginBottom: "16px" }}>
            Imbalance Event History
          </h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                  <th style={{ textAlign: "left", padding: "12px", fontFamily: "Space Grotesk", color: "#9cff93", fontSize: "12px" }}>
                    Timestamp
                  </th>
                  <th style={{ textAlign: "center", padding: "12px", fontFamily: "Space Grotesk", color: "#9cff93", fontSize: "12px" }}>
                    Ratio
                  </th>
                  <th style={{ textAlign: "center", padding: "12px", fontFamily: "Space Grotesk", color: "#9cff93", fontSize: "12px" }}>
                    Direction
                  </th>
                  <th style={{ textAlign: "center", padding: "12px", fontFamily: "Space Grotesk", color: "#9cff93", fontSize: "12px" }}>
                    Strength
                  </th>
                  <th style={{ textAlign: "center", padding: "12px", fontFamily: "Space Grotesk", color: "#9cff93", fontSize: "12px" }}>
                    Outcome
                  </th>
                </tr>
              </thead>
              <tbody>
                {imbalanceHistory.map((event, idx) => (
                  <tr
                    key={idx}
                    style={{
                      borderBottom: "1px solid rgba(72,72,73,0.2)",
                      cursor: "pointer",
                      backgroundColor: selectedEvent === String(idx) ? "rgba(156,255,147,0.05)" : "transparent",
                    }}
                    onClick={() => setSelectedEvent(selectedEvent === String(idx) ? null : String(idx))}
                  >
                    <td style={{ padding: "12px", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#ffffff" }}>
                      {event.timestamp}
                    </td>
                    <td style={{ padding: "12px", textAlign: "center", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: getImbalanceColor(event.ratio) }}>
                      {event.ratio.toFixed(2)}
                    </td>
                    <td style={{ padding: "12px", textAlign: "center", fontFamily: "Space Grotesk", fontSize: "11px" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "4px 8px",
                          borderRadius: "4px",
                          backgroundColor: event.direction === "bullish" ? "rgba(156,255,147,0.2)" : "rgba(255,100,100,0.2)",
                          color: event.direction === "bullish" ? "#9cff93" : "#ff6464",
                        }}
                      >
                        {event.direction}
                      </span>
                    </td>
                    <td style={{ padding: "12px", textAlign: "center", fontFamily: "Space Grotesk", fontSize: "11px", color: "#767576" }}>
                      {event.strength}
                    </td>
                    <td style={{ padding: "12px", textAlign: "center" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "4px 8px",
                          borderRadius: "4px",
                          backgroundColor: getOutcomeColor(event.outcome) + "20",
                          color: getOutcomeColor(event.outcome),
                          fontFamily: "Space Grotesk",
                          fontSize: "11px",
                        }}
                      >
                        {event.outcome}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
