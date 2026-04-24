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

interface RecallResult {
  symbol: string;
  date: string;
  setup_type: string;
  outcome: "win" | "loss" | "breakeven";
  similarity_score: number;
  pnl: number;
  duration_bars: number;
}

interface RecallResponse {
  results: RecallResult[];
  query_time_ms: number;
}

export default function RecallEngine() {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const { data: recallData, isLoading } = useQuery({
    queryKey: ["recall", query],
    queryFn: async () => {
      if (!query) return null;
      const res = await fetch(`${API}/api/memory/recall`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      return res.json() as Promise<RecallResponse>;
    },
    enabled: submitted && !!query,
  });

  const handleSearch = () => {
    if (query.trim()) {
      setSubmitted(true);
    }
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
          Recall Engine
        </h1>

        {/* Search Input */}
        <div
          style={{
            backgroundColor: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: "12px",
            padding: "24px",
            marginBottom: "24px",
          }}
        >
          <label style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: C.muted, display: "block", marginBottom: "12px" }}>
            SEARCH SIMILAR SETUPS
          </label>
          <div style={{ display: "flex", gap: "12px" }}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch();
              }}
              placeholder="e.g., 'early morning gap fill with oversold RSI'"
              style={{
                flex: 1,
                padding: "12px",
                backgroundColor: "#0e0e0f",
                border: `1px solid ${C.border}`,
                color: C.text,
                borderRadius: "8px",
                fontFamily: "JetBrains Mono, monospace",
                fontSize: "13px",
              }}
            />
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
              Search
            </button>
          </div>
        </div>

        {isLoading && (
          <div style={{ textAlign: "center", padding: "40px", color: C.muted }}>
            Searching memory...
          </div>
        )}

        {recallData && !isLoading && (
          <div
            style={{
              backgroundColor: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            <div style={{ marginBottom: "20px" }}>
              <span style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: C.muted }}>
                FOUND {recallData.results.length} RESULTS
              </span>
              <span style={{ fontFamily: "JetBrains Mono", fontSize: "11px", color: C.muted, marginLeft: "12px" }}>
                ({recallData.query_time_ms}ms)
              </span>
            </div>

            {recallData.results.length === 0 ? (
              <div style={{ textAlign: "center", padding: "32px", color: C.muted }}>
                No similar setups found in memory
              </div>
            ) : (
              <div style={{ display: "grid", gap: "12px" }}>
                {recallData.results.map((result, idx) => (
                  <div
                    key={idx}
                    style={{
                      backgroundColor: "#0e0e0f",
                      border: `1px solid ${C.border}`,
                      borderRadius: "8px",
                      padding: "16px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "12px" }}>
                      <div>
                        <div style={{ fontFamily: "Space Grotesk", fontSize: "14px", fontWeight: "600" }}>
                          {result.symbol}
                        </div>
                        <div style={{ fontFamily: "JetBrains Mono", fontSize: "12px", color: C.muted, marginTop: "4px" }}>
                          {result.date}
                        </div>
                      </div>
                      <div
                        style={{
                          fontFamily: "JetBrains Mono",
                          fontSize: "16px",
                          fontWeight: "600",
                          color: getOutcomeColor(result.outcome),
                        }}
                      >
                        {result.outcome.toUpperCase()}
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "12px" }}>
                      <div>
                        <span style={{ fontFamily: "Space Grotesk", fontSize: "10px", color: C.muted }}>Setup Type</span>
                        <div style={{ fontFamily: "JetBrains Mono", fontSize: "12px", color: C.text, marginTop: "4px" }}>
                          {result.setup_type}
                        </div>
                      </div>
                      <div>
                        <span style={{ fontFamily: "Space Grotesk", fontSize: "10px", color: C.muted }}>Similarity</span>
                        <div style={{ fontFamily: "JetBrains Mono", fontSize: "12px", color: C.accent, marginTop: "4px" }}>
                          {(result.similarity_score * 100).toFixed(0)}%
                        </div>
                      </div>
                      <div>
                        <span style={{ fontFamily: "Space Grotesk", fontSize: "10px", color: C.muted }}>P&L</span>
                        <div
                          style={{
                            fontFamily: "JetBrains Mono",
                            fontSize: "12px",
                            color: result.pnl > 0 ? "#52ff00" : "#ff7162",
                            marginTop: "4px",
                          }}
                        >
                          {result.pnl > 0 ? "+" : ""}{result.pnl.toFixed(2)}R
                        </div>
                      </div>
                      <div>
                        <span style={{ fontFamily: "Space Grotesk", fontSize: "10px", color: C.muted }}>Duration</span>
                        <div style={{ fontFamily: "JetBrains Mono", fontSize: "12px", color: C.text, marginTop: "4px" }}>
                          {result.duration_bars} bars
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!submitted && (
          <div
            style={{
              textAlign: "center",
              padding: "60px 24px",
              color: C.muted,
              fontFamily: "Space Grotesk",
              fontSize: "14px",
            }}
          >
            Enter a setup description to search similar past trades
          </div>
        )}
      </div>
    </div>
  );
}
