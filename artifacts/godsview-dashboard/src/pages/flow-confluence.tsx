import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toArray, safeFixed, safeNum } from "@/lib/safe";

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
        <div style={{ marginBottom: "28px" }}>
          <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", marginBottom: "8px" }}>
            Flow + Structure Confluence
          </h1>
          <p style={{ color: C.muted, fontSize: "14px" }}>
            High-conviction setups where order flow evidence validates chart structure zones
          </p>
        </div>

        {/* Stats Bar */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "16px", marginBottom: "24px" }}>
          <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "16px" }}>
            <div style={{ fontSize: "12px", color: C.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Setups Found</div>
            <div style={{ fontSize: "24px", fontWeight: "700", color: C.accent }}>{confluenceData?.count ?? 0}</div>
          </div>
          <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "16px" }}>
            <div style={{ fontSize: "12px", color: C.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Long Setups</div>
            <div style={{ fontSize: "24px", fontWeight: "700", color: C.accent }}>
              {confluenceData?.setups?.filter((s: ConfluenceSetup) => s.direction === "long").length ?? 0}
            </div>
          </div>
          <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "16px" }}>
            <div style={{ fontSize: "12px", color: C.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Short Setups</div>
            <div style={{ fontSize: "24px", fontWeight: "700", color: "#ff7162" }}>
              {confluenceData?.setups?.filter((s: ConfluenceSetup) => s.direction === "short").length ?? 0}
            </div>
          </div>
          <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "16px" }}>
            <div style={{ fontSize: "12px", color: C.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Avg Confidence</div>
            <div style={{ fontSize: "24px", fontWeight: "700", color: C.accent }}>
              {confluenceData?.setups && confluenceData.setups.length > 0
                ? (confluenceData.setups.reduce((s: number, x: ConfluenceSetup) => s + x.combined_confidence, 0) / confluenceData.setups.length * 100).toFixed(0) + "%"
                : "—"}
            </div>
          </div>
        </div>

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
          <label style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: C.muted, textTransform: "uppercase", letterSpacing: "0.5px" }}>
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
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
            <span style={{ fontSize: "11px", color: C.muted }}>0%</span>
            <span style={{ fontSize: "11px", color: C.muted }}>50%</span>
            <span style={{ fontSize: "11px", color: C.muted }}>100%</span>
          </div>
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
                {toArray<ConfluenceSetup>(confluenceData, "setups").map((setup, idx) => (
                    <tr
                      key={idx}
                      style={{ borderBottom: `1px solid ${C.border}`, backgroundColor: idx % 2 === 0 ? "" : "rgba(26,25,27,0.5)" }}
                    >
                      <td style={{ padding: "12px", color: C.accent, fontWeight: "500" }}>{setup?.symbol ?? "—"}</td>
                      <td style={{ padding: "12px", textAlign: "right", color: C.text }}>
                        {safeFixed(setup?.structure_score, 3)}
                      </td>
                      <td style={{ padding: "12px", textAlign: "right", color: C.text }}>
                        {safeFixed(setup?.flow_score, 3)}
                      </td>
                      <td
                        style={{
                          padding: "12px",
                          textAlign: "right",
                          color: safeNum(setup?.combined_confidence) > 0.85 ? "#52ff00" : C.accent,
                          fontWeight: "500",
                        }}
                      >
                        {(safeNum(setup?.combined_confidence) * 100).toFixed(1)}%
                      </td>
                      <td style={{ padding: "12px", color: C.muted }}>{setup?.setup_type ?? "—"}</td>
                      <td
                        style={{
                          padding: "12px",
                          textAlign: "center",
                          color: setup?.direction === "long" ? C.accent : "#ff7162",
                          fontWeight: "600",
                        }}
                      >
                        {String(setup?.direction ?? "—").toUpperCase()}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {confluenceData && confluenceData.count === 0 && (
              <div style={{ textAlign: "center", padding: "48px", color: C.muted }}>
                <div style={{ fontSize: "32px", marginBottom: "12px", opacity: 0.3 }}>⊘</div>
                <div style={{ fontSize: "14px", marginBottom: "8px" }}>No high-confluence setups at {(minConfidence * 100).toFixed(0)}% threshold</div>
                <div style={{ fontSize: "12px" }}>Lower the confidence slider or wait for new market data</div>
              </div>
            )}
            {confluenceData && confluenceData.count > 0 && (
              <div style={{ marginTop: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: "12px", color: C.muted }}>
                  Updated: {confluenceData.timestamp ? new Date(confluenceData.timestamp).toLocaleTimeString() : "—"}
                </div>
                <div style={{ fontSize: "12px", color: C.muted }}>
                  {confluenceData.count} setup{confluenceData.count !== 1 ? "s" : ""} above {(minConfidence * 100).toFixed(0)}%
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
