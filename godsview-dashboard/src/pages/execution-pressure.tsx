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

interface PressureData {
  symbol: string;
  dominance: { buyers: number; sellers: number };
  transitions: { zone: string; confidence: number }[];
  exhaustion: { level: number; signal: string };
  score: number;
  buyer_pressure: number;
  seller_pressure: number;
}

interface SnapshotData {
  timestamp: string;
  symbols: string[];
  metrics: Record<string, PressureData>;
}

export default function ExecutionPressure() {
  const [selectedSymbol, setSelectedSymbol] = useState("SPY");

  const { data: featureData, isLoading: featureLoading } = useQuery({
    queryKey: ["feature", selectedSymbol],
    queryFn: async () => {
      const res = await fetch(`${API}/api/features/${selectedSymbol}`);
      return res.json() as Promise<PressureData>;
    },
    enabled: !!selectedSymbol,
  });

  const { data: snapshotData, isLoading: snapshotLoading } = useQuery({
    queryKey: ["execution-snapshot"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/execution-intelligence/snapshot`);
      return res.json() as Promise<SnapshotData>;
    },
  });

  const isLoading = featureLoading || snapshotLoading;

  return (
    <div style={{ backgroundColor: C.bg, minHeight: "100vh", padding: "24px", color: C.text }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", marginBottom: "32px" }}>
          Execution Pressure Map
        </h1>

        {/* Symbol Selector */}
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
            SELECT SYMBOL
          </label>
          <input
            type="text"
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(e.target.value.toUpperCase())}
            style={{
              width: "100%",
              padding: "12px",
              marginTop: "8px",
              backgroundColor: "#0e0e0f",
              border: `1px solid ${C.border}`,
              color: C.text,
              borderRadius: "8px",
              fontFamily: "JetBrains Mono, monospace",
            }}
          />
        </div>

        {isLoading ? (
          <div style={{ textAlign: "center", padding: "40px" }}>Loading...</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
            {/* Dominance Indicator */}
            <div
              style={{
                backgroundColor: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: "12px",
                padding: "24px",
              }}
            >
              <h3 style={{ fontFamily: "Space Grotesk", fontSize: "14px", color: C.muted, marginBottom: "16px" }}>
                PRESSURE DOMINANCE
              </h3>
              {featureData && (
                <div>
                  <div style={{ marginBottom: "16px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                      <span style={{ fontFamily: "Space Grotesk" }}>Buyers</span>
                      <span style={{ fontFamily: "JetBrains Mono", color: C.accent }}>
                        {(featureData.dominance.buyers * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div
                      style={{
                        height: "8px",
                        backgroundColor: "#1a191b",
                        borderRadius: "4px",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          backgroundColor: C.accent,
                          width: `${featureData.dominance.buyers * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                      <span style={{ fontFamily: "Space Grotesk" }}>Sellers</span>
                      <span style={{ fontFamily: "JetBrains Mono", color: "#ff7162" }}>
                        {(featureData.dominance.sellers * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div
                      style={{
                        height: "8px",
                        backgroundColor: "#1a191b",
                        borderRadius: "4px",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          backgroundColor: "#ff7162",
                          width: `${featureData.dominance.sellers * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Exhaustion Signals */}
            <div
              style={{
                backgroundColor: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: "12px",
                padding: "24px",
              }}
            >
              <h3 style={{ fontFamily: "Space Grotesk", fontSize: "14px", color: C.muted, marginBottom: "16px" }}>
                EXHAUSTION SIGNALS
              </h3>
              {featureData && (
                <div>
                  <div style={{ marginBottom: "12px" }}>
                    <span style={{ fontFamily: "Space Grotesk", fontSize: "12px" }}>Level</span>
                    <div style={{ fontFamily: "JetBrains Mono", fontSize: "18px", color: C.accent, marginTop: "4px" }}>
                      {featureData.exhaustion.level.toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <span style={{ fontFamily: "Space Grotesk", fontSize: "12px" }}>Signal</span>
                    <div style={{ fontFamily: "JetBrains Mono", fontSize: "14px", color: C.muted, marginTop: "4px" }}>
                      {featureData.exhaustion.signal}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Transition Zones */}
            <div
              style={{
                backgroundColor: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: "12px",
                padding: "24px",
                gridColumn: "1 / -1",
              }}
            >
              <h3 style={{ fontFamily: "Space Grotesk", fontSize: "14px", color: C.muted, marginBottom: "16px" }}>
                TRANSITION ZONES
              </h3>
              {featureData && featureData.transitions.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px" }}>
                  {featureData.transitions.map((t, i) => (
                    <div
                      key={i}
                      style={{
                        backgroundColor: "#0e0e0f",
                        border: `1px solid ${C.border}`,
                        borderRadius: "8px",
                        padding: "12px",
                      }}
                    >
                      <div style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: C.muted }}>Zone</div>
                      <div style={{ fontFamily: "JetBrains Mono", fontSize: "14px", color: C.accent }}>
                        {t.zone}
                      </div>
                      <div style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: C.muted, marginTop: "4px" }}>
                        Confidence: {(t.confidence * 100).toFixed(0)}%
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Pressure Score */}
            <div
              style={{
                backgroundColor: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: "12px",
                padding: "24px",
                gridColumn: "1 / -1",
              }}
            >
              <h3 style={{ fontFamily: "Space Grotesk", fontSize: "14px", color: C.muted, marginBottom: "16px" }}>
                DERIVED SCORES
              </h3>
              {featureData && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "16px" }}>
                  <div>
                    <span style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: C.muted }}>Total Score</span>
                    <div style={{ fontFamily: "JetBrains Mono", fontSize: "20px", color: C.accent, marginTop: "8px" }}>
                      {featureData.score.toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <span style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: C.muted }}>Buyer Pressure</span>
                    <div style={{ fontFamily: "JetBrains Mono", fontSize: "20px", color: C.accent, marginTop: "8px" }}>
                      {featureData.buyer_pressure.toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <span style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: C.muted }}>Seller Pressure</span>
                    <div style={{ fontFamily: "JetBrains Mono", fontSize: "20px", color: "#ff7162", marginTop: "8px" }}>
                      {featureData.seller_pressure.toFixed(2)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
