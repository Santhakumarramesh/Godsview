import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

const C = {
  bg: "#0e0e0f",
  card: "#1a191b",
  border: "rgba(72,72,73,0.2)",
  accent: "#9cff93",
  text: "#ffffff",
  muted: "#767576",
};

interface ConfluenceSetup {
  symbol: string;
  structure_score: number;
  flow_score: number;
  combined_confidence: number;
  setup_type: string;
  direction: "long" | "short";
  timestamp: string;
}

interface ConfluenceResponse {
  setups: ConfluenceSetup[];
  count: number;
  timestamp: string;
}

export default function FlowConfluence() {
  const [minConfidence, setMinConfidence] = useState(0.75);

  const { data: confluenceData, isLoading } = useQuery({
    queryKey: ["context-fusion", minConfidence],
    queryFn: async () => {
      const res = await fetch(`${API}/api/context-fusion/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ min_confidence: minConfidence }),
      });
      return res.json() as Promise<ConfluenceResponse>;
    },
  });

  const { data: signalsData } = useQuery({
    queryKey: ["signals"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/signals/latest`);
      return res.json();
    },
  });

  return (
    <div style={{ backgroundColor: C.bg, minHeight: "100vh", padding: "24px", color: C.text }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", marginBottom: "32px" }}>
          Flow + Structure Confluence
        </h1>

        {/* Filter Controls */}
        <div
          style={{
            backgroundColor: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: "12px",
            padding: "24px",
            marginBottom: "24px",
          }}
        >
          <label style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: C.muted }}>
            MINIMUM CONFIDENCE: {(minConfidence * 100).toFixed(0)}%
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={minConfidence}
            onChange={(e) => setMinConfidence(parseFloat(e.target.value))}
            style={{ width: "100%", marginTop: "12px" }}
          />
        </div>

        {isLoading ? (
          <div style={{ textAlign: "center", padding: "40px" }}>Loading confluence data...</div>
        ) : (
          <div
            style={{
              backgroundColor: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: "12px",
              padding: "24px",
              overflowX: "auto",
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontFamily: "JetBrains Mono, monospace",
                fontSize: "14px",
              }}
            >
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  <th style={{ padding: "12px", textAlign: "left", color: C.muted, fontWeight: "normal" }}>Symbol</th>
                  <th style={{ padding: "12px", textAlign: "right", color: C.muted, fontWeight: "normal" }}>
                    Structure Score
                  </th>
                  <th style={{ padding: "12px", textAlign: "right", color: C.muted, fontWeight: "normal" }}>
                    Flow Score
                  </th>
                  <th style={{ padding: "12px", textAlign: "right", color: C.muted, fontWeight: "normal" }}>
                    Combined Confidence
                  </th>
                  <th style={{ padding: "12px", textAlign: "left", color: C.muted, fontWeight: "normal" }}>
                    Setup Type
                  </th>
                  <th style={{ padding: "12px", textAlign: "center", color: C.muted, fontWeight: "normal" }}>
                    Direction
                  </th>
                </tr>
              </thead>
              <tbody>
                {confluenceData &&
                  confluenceData.setups.map((setup, idx) => (
                    <tr
                      key={idx}
                      style={{ borderBottom: `1px solid ${C.border}`, backgroundColor: idx % 2 === 0 ? "" : "rgba(26,25,27,0.5)" }}
                    >
                      <td style={{ padding: "12px", color: C.accent, fontWeight: "500" }}>{setup.symbol}</td>
                      <td style={{ padding: "12px", textAlign: "right", color: C.text }}>
                        {setup.structure_score.toFixed(3)}
                      </td>
                      <td style={{ padding: "12px", textAlign: "right", color: C.text }}>
                        {setup.flow_score.toFixed(3)}
                      </td>
                      <td
                        style={{
                          padding: "12px",
                          textAlign: "right",
                          color: setup.combined_confidence > 0.85 ? "#52ff00" : C.accent,
                          fontWeight: "500",
                        }}
                      >
                        {(setup.combined_confidence * 100).toFixed(1)}%
                      </td>
                      <td style={{ padding: "12px", color: C.muted }}>{setup.setup_type}</td>
                      <td
                        style={{
                          padding: "12px",
                          textAlign: "center",
                          color: setup.direction === "long" ? C.accent : "#ff7162",
                          fontWeight: "600",
                        }}
                      >
                        {setup.direction.toUpperCase()}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {confluenceData && confluenceData.count === 0 && (
              <div style={{ textAlign: "center", padding: "32px", color: C.muted }}>
                No high-confluence setups at this threshold
              </div>
            )}
            {confluenceData && (
              <div style={{ marginTop: "16px", textAlign: "right", color: C.muted, fontSize: "12px" }}>
                {confluenceData.count} setup{confluenceData.count !== 1 ? "s" : ""}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
