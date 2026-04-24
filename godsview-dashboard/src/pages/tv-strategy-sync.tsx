import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

export default function TVStrategySync() {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: tvStrategies = [] } = useQuery({
    queryKey: ["tv-strategies"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/tradingview-mcp/strategies`);
      if (!res.ok) throw new Error("Failed to fetch TradingView strategies");
      return res.json();
    },
  });

  const { data: gvStrategies = [] } = useQuery({
    queryKey: ["gv-strategies"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/strategies`);
      if (!res.ok) throw new Error("Failed to fetch GodsView strategies");
      return res.json();
    },
  });

  return (
    <div style={{ backgroundColor: "#0e0e0f", minHeight: "100vh", padding: "24px" }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        <div style={{ marginBottom: "32px" }}>
          <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", color: "#ffffff", marginBottom: "8px" }}>
            TV Strategy Sync
          </h1>
          <p style={{ color: "#767576", fontSize: "14px" }}>Compare and sync TradingView strategies with GodsView</p>
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
              TradingView Strategies ({tvStrategies.length})
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {tvStrategies.map((strat: any, idx: number) => (
                <div
                  key={idx}
                  style={{
                    backgroundColor: "#0e0e0f",
                    border: "1px solid rgba(72,72,73,0.2)",
                    borderRadius: "8px",
                    padding: "12px",
                    cursor: "pointer",
                  }}
                  onClick={() => setExpandedId(expandedId === `tv-${idx}` ? null : `tv-${idx}`)}
                >
                  <p style={{ fontFamily: "Space Grotesk", fontSize: "13px", color: "#ffffff", margin: "0 0 4px 0" }}>
                    {strat.name || `Strategy ${idx}`}
                  </p>
                  <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "11px", color: "#767576", margin: 0 }}>
                    {strat.status || "unknown"} • {strat.parameters?.length || 0} parameters
                  </p>
                  {expandedId === `tv-${idx}` && (
                    <pre
                      style={{
                        marginTop: "8px",
                        backgroundColor: "#1a191b",
                        padding: "8px",
                        borderRadius: "4px",
                        fontFamily: "JetBrains Mono, monospace",
                        fontSize: "10px",
                        color: "#767576",
                        overflow: "auto",
                      }}
                    >
                      {JSON.stringify(strat, null, 2)}
                    </pre>
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
              GodsView Strategies ({gvStrategies.length})
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {gvStrategies.map((strat: any, idx: number) => (
                <div
                  key={idx}
                  style={{
                    backgroundColor: "#0e0e0f",
                    border: "1px solid rgba(72,72,73,0.2)",
                    borderRadius: "8px",
                    padding: "12px",
                    cursor: "pointer",
                  }}
                  onClick={() => setExpandedId(expandedId === `gv-${idx}` ? null : `gv-${idx}`)}
                >
                  <p style={{ fontFamily: "Space Grotesk", fontSize: "13px", color: "#ffffff", margin: "0 0 4px 0" }}>
                    {strat.name || `Strategy ${idx}`}
                  </p>
                  <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "11px", color: "#767576", margin: 0 }}>
                    {strat.status || "unknown"} • {strat.parameters?.length || 0} parameters
                  </p>
                  {expandedId === `gv-${idx}` && (
                    <pre
                      style={{
                        marginTop: "8px",
                        backgroundColor: "#1a191b",
                        padding: "8px",
                        borderRadius: "4px",
                        fontFamily: "JetBrains Mono, monospace",
                        fontSize: "10px",
                        color: "#767576",
                        overflow: "auto",
                      }}
                    >
                      {JSON.stringify(strat, null, 2)}
                    </pre>
                  )}
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
          <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", color: "#ffffff", marginBottom: "16px" }}>
            Sync Status
          </h2>
          <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#767576" }}>
            Strategies synced: {Math.min(tvStrategies.length, gvStrategies.length)} / {Math.max(tvStrategies.length, gvStrategies.length)}
          </p>
        </div>
      </div>
    </div>
  );
}
