import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

const C = {
  bg: "#0e0e0f",
  card: "#1a191b",
  border: "rgba(72,72,73,0.2)",
  accent: "#9cff93",
  text: "#ffffff",
  muted: "#767576",
  win: "#52ff00",
  loss: "#ff7162",
  breakeven: "#ffcc00",
};

interface RecallResult {
  symbol: string;
  date: string;
  setup_type: string;
  outcome: "win" | "loss" | "breakeven";
  similarity_score: number;
  pnl: number;
  duration_bars: number;
  entry_reason?: string;
  chart_context?: string;
  tags?: string[];
}

interface RecallResponse {
  results: RecallResult[];
  query_time_ms: number;
  total_memories?: number;
}

const QUICK_PRESETS = [
  "OB retest at support",
  "liquidity sweep reversal",
  "BOS continuation",
  "gap fill morning",
];

export default function RecallEngine() {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [outcomeFilter, setOutcomeFilter] = useState<"all" | "win" | "loss" | "breakeven">("all");
  const [sortBy, setSortBy] = useState<"similarity" | "pnl" | "date">("similarity");
  const [symbolFilter, setSymbolFilter] = useState("");
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [apiError, setApiError] = useState("");

  const { data: recallData, isLoading, isError } = useQuery({
    queryKey: ["recall", query],
    queryFn: async () => {
      if (!query) return null;
      setApiError("");
      try {
        const res = await fetch(`${API}/api/memory/recall`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        });
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        return res.json() as Promise<RecallResponse>;
      } catch (err) {
        setApiError(err instanceof Error ? err.message : "Failed to fetch results");
        return null;
      }
    },
    enabled: submitted && !!query,
  });

  const filteredAndSorted = useMemo(() => {
    if (!recallData?.results) return [];
    let filtered = recallData.results;

    if (outcomeFilter !== "all") {
      filtered = filtered.filter((r) => r.outcome === outcomeFilter);
    }
    if (symbolFilter) {
      filtered = filtered.filter((r) => r.symbol.toUpperCase().includes(symbolFilter.toUpperCase()));
    }

    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        case "similarity":
          return b.similarity_score - a.similarity_score;
        case "pnl":
          return b.pnl - a.pnl;
        case "date":
          return new Date(b.date).getTime() - new Date(a.date).getTime();
        default:
          return 0;
      }
    });
  }, [recallData?.results, outcomeFilter, symbolFilter, sortBy]);

  const stats = useMemo(() => {
    const results = recallData?.results || [];
    const wins = results.filter((r) => r.outcome === "win").length;
    const losses = results.filter((r) => r.outcome === "loss").length;
    const breakevens = results.filter((r) => r.outcome === "breakeven").length;
    const total = results.length;
    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : "0";
    const avgSimilarity = total > 0 ? (results.reduce((sum, r) => sum + r.similarity_score, 0) / total * 100).toFixed(0) : "0";
    const avgPnL = total > 0 ? (results.reduce((sum, r) => sum + r.pnl, 0) / total).toFixed(2) : "0";

    return { wins, losses, breakevens, total, winRate, avgSimilarity, avgPnL };
  }, [recallData?.results]);

  const handleSearch = () => {
    if (query.trim()) {
      setSubmitted(true);
    }
  };

  const handlePreset = (preset: string) => {
    setQuery(preset);
    setSubmitted(true);
  };

  const getOutcomeColor = (outcome: string) => {
    switch (outcome) {
      case "win":
        return C.win;
      case "loss":
        return C.loss;
      default:
        return C.breakeven;
    }
  };

  const getSimilarityGradient = (score: number) => {
    const percent = score * 100;
    if (percent >= 80) return { bg: "rgba(82, 255, 0, 0.2)", bar: C.win };
    if (percent >= 60) return { bg: "rgba(156, 255, 147, 0.15)", bar: "#7cff6a" };
    if (percent >= 40) return { bg: "rgba(255, 204, 0, 0.15)", bar: C.breakeven };
    return { bg: "rgba(255, 113, 98, 0.15)", bar: "#ff9480" };
  };

  return (
    <div style={{ backgroundColor: C.bg, minHeight: "100vh", padding: "24px", color: C.text }}>
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", marginBottom: "32px" }}>Recall Engine</h1>

        {/* Search Input */}
        <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "24px", marginBottom: "24px" }}>
          <label style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: C.muted, display: "block", marginBottom: "12px" }}>
            SEARCH SIMILAR SETUPS
          </label>
          <div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
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
            <button onClick={handleSearch} style={{ padding: "12px 32px", backgroundColor: C.accent, border: "none", borderRadius: "8px", color: "#000", fontFamily: "Space Grotesk", fontWeight: "600", cursor: "pointer", fontSize: "13px" }}>
              Search
            </button>
          </div>

          {/* Quick Presets */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {QUICK_PRESETS.map((preset) => (
              <button
                key={preset}
                onClick={() => handlePreset(preset)}
                style={{
                  padding: "6px 12px",
                  backgroundColor: "transparent",
                  border: `1px solid ${C.border}`,
                  borderRadius: "6px",
                  color: C.muted,
                  fontFamily: "Space Grotesk",
                  fontSize: "11px",
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = C.accent;
                  (e.currentTarget as HTMLButtonElement).style.color = C.accent;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = C.border;
                  (e.currentTarget as HTMLButtonElement).style.color = C.muted;
                }}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        {/* Stats Bar */}
        {submitted && recallData && !isLoading && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px", marginBottom: "24px" }}>
            {[
              { label: "Total Memories", value: stats.total },
              { label: "Win Rate", value: `${stats.winRate}%` },
              { label: "Avg Similarity", value: `${stats.avgSimilarity}%` },
              { label: "Avg P&L", value: `${stats.avgPnL}R` },
            ].map((stat) => (
              <div key={stat.label} style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "16px", textAlign: "center" }}>
                <div style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: C.muted, marginBottom: "8px" }}>{stat.label}</div>
                <div style={{ fontFamily: "JetBrains Mono", fontSize: "18px", fontWeight: "600", color: C.accent }}>{stat.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Outcome Distribution */}
        {submitted && recallData && !isLoading && stats.total > 0 && (
          <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "12px", marginBottom: "24px", display: "flex", gap: "16px", alignItems: "center" }}>
            <span style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: C.muted }}>OUTCOME:</span>
            {[
              { label: "Win", count: stats.wins, color: C.win },
              { label: "Loss", count: stats.losses, color: C.loss },
              { label: "Breakeven", count: stats.breakevens, color: C.breakeven },
            ].map((item) => (
              <div key={item.label} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <div style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: item.color }} />
                <span style={{ fontFamily: "JetBrains Mono", fontSize: "12px", color: C.text }}>{item.label}: {item.count}</span>
              </div>
            ))}
          </div>
        )}

        {/* Filter Controls */}
        {submitted && recallData && !isLoading && (
          <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "16px", marginBottom: "24px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
            <div>
              <label style={{ fontFamily: "Space Grotesk", fontSize: "10px", color: C.muted, display: "block", marginBottom: "6px" }}>OUTCOME</label>
              <select value={outcomeFilter} onChange={(e) => setOutcomeFilter(e.target.value as any)} style={{ width: "100%", padding: "8px", backgroundColor: "#0e0e0f", border: `1px solid ${C.border}`, borderRadius: "6px", color: C.text, fontFamily: "JetBrains Mono", fontSize: "12px", cursor: "pointer" }}>
                <option value="all">All</option>
                <option value="win">Win</option>
                <option value="loss">Loss</option>
                <option value="breakeven">Breakeven</option>
              </select>
            </div>
            <div>
              <label style={{ fontFamily: "Space Grotesk", fontSize: "10px", color: C.muted, display: "block", marginBottom: "6px" }}>SORT BY</label>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} style={{ width: "100%", padding: "8px", backgroundColor: "#0e0e0f", border: `1px solid ${C.border}`, borderRadius: "6px", color: C.text, fontFamily: "JetBrains Mono", fontSize: "12px", cursor: "pointer" }}>
                <option value="similarity">Similarity</option>
                <option value="pnl">P&L</option>
                <option value="date">Date</option>
              </select>
            </div>
            <div>
              <label style={{ fontFamily: "Space Grotesk", fontSize: "10px", color: C.muted, display: "block", marginBottom: "6px" }}>SYMBOL</label>
              <input type="text" value={symbolFilter} onChange={(e) => setSymbolFilter(e.target.value)} placeholder="e.g., AAPL" style={{ width: "100%", padding: "8px", backgroundColor: "#0e0e0f", border: `1px solid ${C.border}`, borderRadius: "6px", color: C.text, fontFamily: "JetBrains Mono", fontSize: "12px" }} />
            </div>
          </div>
        )}

        {/* Error State */}
        {apiError && (
          <div style={{ backgroundColor: "rgba(255, 113, 98, 0.1)", border: `1px solid ${C.loss}`, borderRadius: "12px", padding: "16px", marginBottom: "24px" }}>
            <div style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: C.loss }}>ERROR: {apiError}</div>
          </div>
        )}

        {/* Loading Skeleton */}
        {isLoading && (
          <div style={{ display: "grid", gap: "12px" }}>
            {[1, 2, 3].map((i) => (
              <div key={i} style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
                  <div style={{ width: "100px", height: "20px", backgroundColor: "rgba(156, 255, 147, 0.1)", borderRadius: "4px", animation: "pulse 2s infinite" }} />
                  <div style={{ width: "60px", height: "20px", backgroundColor: "rgba(156, 255, 147, 0.1)", borderRadius: "4px", animation: "pulse 2s infinite" }} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px" }}>
                  {[1, 2, 3, 4].map((j) => (
                    <div key={j} style={{ height: "40px", backgroundColor: "rgba(156, 255, 147, 0.1)", borderRadius: "4px", animation: "pulse 2s infinite" }} />
                  ))}
                </div>
              </div>
            ))}
            <style>{`@keyframes pulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 0.3; } }`}</style>
          </div>
        )}

        {/* Results */}
        {submitted && recallData && !isLoading && (
          <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "24px" }}>
            <div style={{ marginBottom: "20px" }}>
              <span style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: C.muted }}>
                FOUND {filteredAndSorted.length} RESULTS
              </span>
              <span style={{ fontFamily: "JetBrains Mono", fontSize: "11px", color: C.muted, marginLeft: "12px" }}>
                ({recallData.query_time_ms}ms)
              </span>
            </div>

            {filteredAndSorted.length === 0 ? (
              <div style={{ textAlign: "center", padding: "48px 24px", color: C.muted }}>
                <div style={{ fontFamily: "Space Grotesk", fontSize: "48px", marginBottom: "12px" }}>📭</div>
                <div style={{ fontFamily: "Space Grotesk", fontSize: "14px", marginBottom: "8px" }}>No matches found</div>
                <div style={{ fontFamily: "JetBrains Mono", fontSize: "12px", color: C.muted }}>Try adjusting filters or search terms</div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: "12px" }}>
                {filteredAndSorted.map((result, idx) => {
                  const grad = getSimilarityGradient(result.similarity_score);
                  return (
                    <div
                      key={idx}
                      style={{
                        backgroundColor: "#0e0e0f",
                        border: `1px solid ${C.border}`,
                        borderRadius: "8px",
                        padding: "16px",
                        cursor: "pointer",
                        transition: "border-color 0.2s",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLDivElement).style.borderColor = C.accent;
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLDivElement).style.borderColor = C.border;
                      }}
                    >
                      {/* Header */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "12px" }}>
                        <div>
                          <div style={{ fontFamily: "Space Grotesk", fontSize: "14px", fontWeight: "600" }}>{result.symbol}</div>
                          <div style={{ fontFamily: "JetBrains Mono", fontSize: "12px", color: C.muted, marginTop: "4px" }}>{result.date}</div>
                        </div>
                        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                          <div style={{ fontFamily: "JetBrains Mono", fontSize: "16px", fontWeight: "600", color: getOutcomeColor(result.outcome) }}>
                            {result.outcome.toUpperCase()}
                          </div>
                          <button
                            onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
                            style={{
                              padding: "6px 12px",
                              backgroundColor: "transparent",
                              border: `1px solid ${C.border}`,
                              borderRadius: "6px",
                              color: C.muted,
                              fontFamily: "Space Grotesk",
                              fontSize: "11px",
                              cursor: "pointer",
                            }}
                          >
                            {expandedIdx === idx ? "Hide" : "View"} Details
                          </button>
                        </div>
                      </div>

                      {/* Similarity Bar */}
                      <div style={{ marginBottom: "12px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                          <span style={{ fontFamily: "Space Grotesk", fontSize: "10px", color: C.muted }}>SIMILARITY</span>
                          <span style={{ fontFamily: "JetBrains Mono", fontSize: "12px", color: C.accent }}>{(result.similarity_score * 100).toFixed(0)}%</span>
                        </div>
                        <div style={{ width: "100%", height: "6px", backgroundColor: grad.bg, borderRadius: "3px", overflow: "hidden" }}>
                          <div style={{ width: `${result.similarity_score * 100}%`, height: "100%", backgroundColor: grad.bar }} />
                        </div>
                      </div>

                      {/* Main Stats */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "12px", marginBottom: expandedIdx === idx ? "12px" : "0" }}>
                        <div>
                          <span style={{ fontFamily: "Space Grotesk", fontSize: "10px", color: C.muted }}>SETUP TYPE</span>
                          <div style={{ fontFamily: "JetBrains Mono", fontSize: "12px", color: C.text, marginTop: "4px" }}>{result.setup_type}</div>
                        </div>
                        <div>
                          <span style={{ fontFamily: "Space Grotesk", fontSize: "10px", color: C.muted }}>P&L</span>
                          <div style={{ fontFamily: "JetBrains Mono", fontSize: "12px", color: result.pnl > 0 ? C.win : C.loss, marginTop: "4px" }}>
                            {result.pnl > 0 ? "+" : ""}{result.pnl.toFixed(2)}R
                          </div>
                        </div>
                        <div>
                          <span style={{ fontFamily: "Space Grotesk", fontSize: "10px", color: C.muted }}>DURATION</span>
                          <div style={{ fontFamily: "JetBrains Mono", fontSize: "12px", color: C.text, marginTop: "4px" }}>{result.duration_bars} bars</div>
                        </div>
                      </div>

                      {/* Expanded Details */}
                      {expandedIdx === idx && (
                        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: "12px", marginTop: "12px" }}>
                          {result.entry_reason && (
                            <div style={{ marginBottom: "12px" }}>
                              <span style={{ fontFamily: "Space Grotesk", fontSize: "10px", color: C.muted, display: "block", marginBottom: "6px" }}>ENTRY REASONING</span>
                              <div style={{ fontFamily: "JetBrains Mono", fontSize: "12px", color: C.text, lineHeight: "1.5" }}>{result.entry_reason}</div>
                            </div>
                          )}
                          {result.chart_context && (
                            <div style={{ marginBottom: "12px" }}>
                              <span style={{ fontFamily: "Space Grotesk", fontSize: "10px", color: C.muted, display: "block", marginBottom: "6px" }}>CHART CONTEXT</span>
                              <div style={{ fontFamily: "JetBrains Mono", fontSize: "12px", color: C.text, lineHeight: "1.5" }}>{result.chart_context}</div>
                            </div>
                          )}
                          {result.tags && result.tags.length > 0 && (
                            <div>
                              <span style={{ fontFamily: "Space Grotesk", fontSize: "10px", color: C.muted, display: "block", marginBottom: "6px" }}>TAGS</span>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                                {result.tags.map((tag) => (
                                  <span key={tag} style={{ fontFamily: "JetBrains Mono", fontSize: "11px", backgroundColor: `${C.accent}20`, color: C.accent, padding: "4px 8px", borderRadius: "4px" }}>
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Empty State */}
        {!submitted && (
          <div style={{ textAlign: "center", padding: "80px 24px", color: C.muted }}>
            <div style={{ fontFamily: "Space Grotesk", fontSize: "48px", marginBottom: "16px" }}>🔍</div>
            <div style={{ fontFamily: "Space Grotesk", fontSize: "16px", marginBottom: "8px" }}>Ready to recall similar setups</div>
            <div style={{ fontFamily: "JetBrains Mono", fontSize: "12px", color: C.muted, lineHeight: "1.6" }}>
              Search by setup description or use quick presets to find similar past trades in your memory
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
