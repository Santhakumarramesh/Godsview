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

interface SetupFeatures {
  price: number;
  volume: number;
  rsi: number;
  macd: number;
  support_level: number;
  resistance_level: number;
}

interface SimilarSetup {
  symbol: string;
  date: string;
  outcome: "win" | "loss" | "breakeven";
  similarity_score: number;
  pnl_r: number;
  duration_bars: number;
  chart_context: string;
}

interface SimilarityResponse {
  current_setup: SetupFeatures;
  matches: SimilarSetup[];
  search_time_ms: number;
}

export default function SetupSimilarity() {
  const [currentSetup, setCurrentSetup] = useState<SetupFeatures>({
    price: 0,
    volume: 0,
    rsi: 50,
    macd: 0,
    support_level: 0,
    resistance_level: 0,
  });

  const [submitted, setSubmitted] = useState(false);

  const { data: similarityData, isLoading } = useQuery({
    queryKey: ["setup-similarity", currentSetup],
    queryFn: async () => {
      if (!submitted) return null;
      const res = await fetch(`${API}/api/memory/recall/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(currentSetup),
      });
      return res.json() as Promise<SimilarityResponse>;
    },
    enabled: submitted,
  });

  const handleSearch = () => {
    setSubmitted(true);
  };

  const getOutcomeColor = (outcome: string) => {
    switch (outcome) {
      case "win":
        return "#52ff00";
      case "loss":
        return "#ff7162";
      default:
        return "#ffcc00";
    }
  };

  return (
    <div style={{ backgroundColor: C.bg, minHeight: "100vh", padding: "24px", color: C.text }}>
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", marginBottom: "32px" }}>
          Setup Similarity Search
        </h1>

        {/* Current Setup Input */}
        <div
          style={{
            backgroundColor: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: "12px",
            padding: "24px",
            marginBottom: "24px",
          }}
        >
          <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", marginBottom: "20px" }}>
            CURRENT SETUP FEATURES
          </h2>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "16px", marginBottom: "20px" }}>
            <div>
              <label style={{ fontFamily: "Space Grotesk", fontSize: "10px", color: C.muted, display: "block", marginBottom: "8px" }}>
                Price
              </label>
              <input
                type="number"
                value={currentSetup.price}
                onChange={(e) => setCurrentSetup({ ...currentSetup, price: parseFloat(e.target.value) })}
                style={{
                  width: "100%",
                  padding: "10px",
                  backgroundColor: "#0e0e0f",
                  border: `1px solid ${C.border}`,
                  color: C.text,
                  borderRadius: "6px",
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: "12px",
                }}
              />
            </div>

            <div>
              <label style={{ fontFamily: "Space Grotesk", fontSize: "10px", color: C.muted, display: "block", marginBottom: "8px" }}>
                Volume
              </label>
              <input
                type="number"
                value={currentSetup.volume}
                onChange={(e) => setCurrentSetup({ ...currentSetup, volume: parseFloat(e.target.value) })}
                style={{
                  width: "100%",
                  padding: "10px",
                  backgroundColor: "#0e0e0f",
                  border: `1px solid ${C.border}`,
                  color: C.text,
                  borderRadius: "6px",
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: "12px",
                }}
              />
            </div>

            <div>
              <label style={{ fontFamily: "Space Grotesk", fontSize: "10px", color: C.muted, display: "block", marginBottom: "8px" }}>
                RSI
              </label>
              <input
                type="number"
                min="0"
                max="100"
                value={currentSetup.rsi}
                onChange={(e) => setCurrentSetup({ ...currentSetup, rsi: parseFloat(e.target.value) })}
                style={{
                  width: "100%",
                  padding: "10px",
                  backgroundColor: "#0e0e0f",
                  border: `1px solid ${C.border}`,
                  color: C.text,
                  borderRadius: "6px",
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: "12px",
                }}
              />
            </div>

            <div>
              <label style={{ fontFamily: "Space Grotesk", fontSize: "10px", color: C.muted, display: "block", marginBottom: "8px" }}>
                MACD
              </label>
              <input
                type="number"
                value={currentSetup.macd}
                onChange={(e) => setCurrentSetup({ ...currentSetup, macd: parseFloat(e.target.value) })}
                style={{
                  width: "100%",
                  padding: "10px",
                  backgroundColor: "#0e0e0f",
                  border: `1px solid ${C.border}`,
                  color: C.text,
                  borderRadius: "6px",
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: "12px",
                }}
              />
            </div>

            <div>
              <label style={{ fontFamily: "Space Grotesk", fontSize: "10px", color: C.muted, display: "block", marginBottom: "8px" }}>
                Support
              </label>
              <input
                type="number"
                value={currentSetup.support_level}
                onChange={(e) => setCurrentSetup({ ...currentSetup, support_level: parseFloat(e.target.value) })}
                style={{
                  width: "100%",
                  padding: "10px",
                  backgroundColor: "#0e0e0f",
                  border: `1px solid ${C.border}`,
                  color: C.text,
                  borderRadius: "6px",
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: "12px",
                }}
              />
            </div>

            <div>
              <label style={{ fontFamily: "Space Grotesk", fontSize: "10px", color: C.muted, display: "block", marginBottom: "8px" }}>
                Resistance
              </label>
              <input
                type="number"
                value={currentSetup.resistance_level}
                onChange={(e) => setCurrentSetup({ ...currentSetup, resistance_level: parseFloat(e.target.value) })}
                style={{
                  width: "100%",
                  padding: "10px",
                  backgroundColor: "#0e0e0f",
                  border: `1px solid ${C.border}`,
                  color: C.text,
                  borderRadius: "6px",
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: "12px",
                }}
              />
            </div>
          </div>

          <button
            onClick={handleSearch}
            style={{
              padding: "12px 32px",
              backgroundColor: C.accent,
              border: "none",
              borderRadius: "8px",
              color: "#000",
              fontFamily: "Space Grotesk",
              fontWeight: "600",
              cursor: "pointer",
              fontSize: "13px",
            }}
          >
            Search Similar Setups
          </button>
        </div>

        {/* Results */}
        {isLoading ? (
          <div style={{ textAlign: "center", padding: "40px", color: C.muted }}>
            Searching for similar setups...
          </div>
        ) : similarityData ? (
          <div>
            <div style={{ marginBottom: "20px" }}>
              <span style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: C.muted }}>
                FOUND {similarityData.matches.length} SIMILAR SETUPS
              </span>
              <span style={{ fontFamily: "JetBrains Mono", fontSize: "11px", color: C.muted, marginLeft: "12px" }}>
                ({similarityData.search_time_ms}ms)
              </span>
            </div>

            {similarityData.matches.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "40px",
                  backgroundColor: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: "12px",
                  color: C.muted,
                }}
              >
                No similar setups found in history
              </div>
            ) : (
              <div style={{ display: "grid", gap: "16px" }}>
                {similarityData.matches.map((match, idx) => (
                  <div
                    key={idx}
                    style={{
                      backgroundColor: C.card,
                      border: `1px solid ${C.border}`,
                      borderRadius: "12px",
                      padding: "20px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "16px" }}>
                      <div>
                        <h3 style={{ fontFamily: "Space Grotesk", fontSize: "16px", fontWeight: "600", marginBottom: "4px" }}>
                          {match.symbol}
                        </h3>
                        <p style={{ fontFamily: "JetBrains Mono", fontSize: "12px", color: C.muted }}>
                          {match.date}
                        </p>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div
                          style={{
                            fontFamily: "JetBrains Mono",
                            fontSize: "16px",
                            fontWeight: "600",
                            color: getOutcomeColor(match.outcome),
                          }}
                        >
                          {match.pnl_r > 0 ? "+" : ""}{match.pnl_r.toFixed(2)}R
                        </div>
                      </div>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                        gap: "16px",
                      }}
                    >
                      <div>
                        <span style={{ fontFamily: "Space Grotesk", fontSize: "10px", color: C.muted }}>Similarity</span>
                        <div style={{ fontFamily: "JetBrains Mono", fontSize: "16px", color: C.accent, marginTop: "4px" }}>
                          {(match.similarity_score * 100).toFixed(0)}%
                        </div>
                      </div>
                      <div>
                        <span style={{ fontFamily: "Space Grotesk", fontSize: "10px", color: C.muted }}>Outcome</span>
                        <div
                          style={{
                            fontFamily: "Space Grotesk",
                            fontSize: "12px",
                            color: getOutcomeColor(match.outcome),
                            marginTop: "4px",
                            fontWeight: "600",
                          }}
                        >
                          {match.outcome.toUpperCase()}
                        </div>
                      </div>
                      <div>
                        <span style={{ fontFamily: "Space Grotesk", fontSize: "10px", color: C.muted }}>Duration</span>
                        <div style={{ fontFamily: "JetBrains Mono", fontSize: "13px", marginTop: "4px" }}>
                          {match.duration_bars} bars
                        </div>
                      </div>
                    </div>

                    {match.chart_context && (
                      <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: `1px solid ${C.border}` }}>
                        <span style={{ fontFamily: "Space Grotesk", fontSize: "10px", color: C.muted }}>Context</span>
                        <p style={{ fontFamily: "JetBrains Mono", fontSize: "11px", color: C.muted, marginTop: "4px" }}>
                          {match.chart_context}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div
            style={{
              textAlign: "center",
              padding: "60px 24px",
              color: C.muted,
              fontFamily: "Space Grotesk",
              fontSize: "14px",
            }}
          >
            Enter setup features and search to find similar historical setups
          </div>
        )}
      </div>
    </div>
  );
}
