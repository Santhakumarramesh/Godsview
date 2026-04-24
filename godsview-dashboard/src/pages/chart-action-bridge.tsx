import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

export default function ChartActionBridge() {
  const [selectedZone, setSelectedZone] = useState<string | null>(null);

  const { data: actions = [] } = useQuery({
    queryKey: ["chart-actions"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/tradingview-mcp/actions`);
      if (!res.ok) throw new Error("Failed to fetch chart actions");
      return res.json();
    },
  });

  const { data: signals = [] } = useQuery({
    queryKey: ["latest-signals"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/signals/latest`);
      if (!res.ok) throw new Error("Failed to fetch signals");
      return res.json();
    },
  });

  const handleAnalyzeZone = (zoneId: string) => {
    console.log("Analyzing zone:", zoneId);
  };

  const handleBacktestSetup = (zoneId: string) => {
    console.log("Setting up backtest for:", zoneId);
  };

  const handleSaveToMemory = (zoneId: string) => {
    console.log("Saving zone to memory:", zoneId);
  };

  return (
    <div style={{ backgroundColor: "#0e0e0f", minHeight: "100vh", padding: "24px" }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        <div style={{ marginBottom: "32px" }}>
          <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", color: "#ffffff", marginBottom: "8px" }}>
            Chart Action Bridge
          </h1>
          <p style={{ color: "#767576", fontSize: "14px" }}>Link chart zones with insights and analysis tools</p>
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
              Selected Zones ({actions.length})
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {actions.map((action: any, idx: number) => (
                <div
                  key={idx}
                  style={{
                    backgroundColor: selectedZone === String(idx) ? "rgba(156,255,147,0.1)" : "#0e0e0f",
                    border: selectedZone === String(idx) ? "1px solid #9cff93" : "1px solid rgba(72,72,73,0.2)",
                    borderRadius: "8px",
                    padding: "12px",
                    cursor: "pointer",
                  }}
                  onClick={() => setSelectedZone(selectedZone === String(idx) ? null : String(idx))}
                >
                  <p style={{ fontFamily: "Space Grotesk", fontSize: "13px", color: "#ffffff", margin: "0 0 4px 0" }}>
                    {action.zone_name || `Zone ${idx}`}
                  </p>
                  <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "11px", color: "#767576", margin: "0 0 8px 0" }}>
                    Level: {action.level || "—"} • Type: {action.type || "—"}
                  </p>
                  {selectedZone === String(idx) && (
                    <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                      <button
                        onClick={() => handleAnalyzeZone(String(idx))}
                        style={{
                          flex: 1,
                          padding: "6px 8px",
                          backgroundColor: "#9cff93",
                          color: "#0e0e0f",
                          border: "none",
                          borderRadius: "6px",
                          fontSize: "11px",
                          fontFamily: "Space Grotesk",
                          cursor: "pointer",
                        }}
                      >
                        Analyze
                      </button>
                      <button
                        onClick={() => handleBacktestSetup(String(idx))}
                        style={{
                          flex: 1,
                          padding: "6px 8px",
                          backgroundColor: "transparent",
                          color: "#9cff93",
                          border: "1px solid #9cff93",
                          borderRadius: "6px",
                          fontSize: "11px",
                          fontFamily: "Space Grotesk",
                          cursor: "pointer",
                        }}
                      >
                        Backtest
                      </button>
                      <button
                        onClick={() => handleSaveToMemory(String(idx))}
                        style={{
                          flex: 1,
                          padding: "6px 8px",
                          backgroundColor: "transparent",
                          color: "#9cff93",
                          border: "1px solid #9cff93",
                          borderRadius: "6px",
                          fontSize: "11px",
                          fontFamily: "Space Grotesk",
                          cursor: "pointer",
                        }}
                      >
                        Save
                      </button>
                    </div>
                  )}
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
              Linked Insights ({signals.length})
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {signals.map((signal: any, idx: number) => (
                <div
                  key={idx}
                  style={{
                    backgroundColor: "#0e0e0f",
                    border: "1px solid rgba(72,72,73,0.2)",
                    borderRadius: "8px",
                    padding: "12px",
                  }}
                >
                  <p style={{ fontFamily: "Space Grotesk", fontSize: "13px", color: "#ffffff", margin: "0 0 4px 0" }}>
                    {signal.description || `Signal ${idx}`}
                  </p>
                  <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "11px", color: "#767576", margin: 0 }}>
                    Confidence: {signal.confidence || "—"}%
                  </p>
                </div>
              ))}
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
            Tool Suggestions
          </h2>
          <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#767576", margin: 0 }}>
            Select a zone to view analysis recommendations
          </p>
        </div>
      </div>
    </div>
  );
}
