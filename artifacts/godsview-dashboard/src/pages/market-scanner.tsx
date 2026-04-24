import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

type SignalRow = {
  symbol: string;
  confluenceScore: number;
  volatility: number;
  trendState: string;
  liquidity: number;
  assetClass: string;
  recommendedAction?: string;
};

export default function MarketScannerPage() {
  const [sortBy, setSortBy] = useState("confluenceScore");
  const [filterAsset, setFilterAsset] = useState("all");
  const [searchSymbol, setSearchSymbol] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  const {
    data: signalsData,
    isLoading: signalsLoading,
    error: signalsError,
  } = useQuery({
    queryKey: ["signals", "scanner"],
    queryFn: () => fetch(`${API}/api/signals?limit=100`).then((r) => r.json()),
    refetchInterval: 10000,
  });

  const {
    data: watchlistData,
    isLoading: watchlistLoading,
    error: watchlistError,
  } = useQuery({
    queryKey: ["watchlist", "scan"],
    queryFn: () => fetch(`${API}/api/watchlist/scan`).then((r) => r.json()),
    refetchInterval: 15000,
  });

  const isLoading = signalsLoading || watchlistLoading;
  const error = signalsError || watchlistError;

  // Merge and process signals
  let allSignals: SignalRow[] = signalsData?.data || [];
  watchlistData?.data?.forEach((w: SignalRow) => {
    if (!allSignals.find((s) => s.symbol === w.symbol)) allSignals.push(w);
  });

  // Filter, sort with useMemo
  const filteredSorted = useMemo(() => {
    let result = [...allSignals];

    // Asset class filter
    if (filterAsset !== "all") {
      result = result.filter((s) => s.assetClass === filterAsset);
    }

    // Symbol search
    if (searchSymbol.trim()) {
      const query = searchSymbol.toLowerCase();
      result = result.filter((s) => s.symbol.toLowerCase().includes(query));
    }

    // Sort
    result.sort((a, b) => {
      const aVal = a[sortBy as keyof SignalRow] as number;
      const bVal = b[sortBy as keyof SignalRow] as number;
      return typeof aVal === "number" ? bVal - aVal : 0;
    });

    return result;
  }, [allSignals, filterAsset, searchSymbol, sortBy]);

  // Stats calculations
  const stats = useMemo(() => {
    const bullish = filteredSorted.filter((s) => s.trendState === "bullish").length;
    const bearish = filteredSorted.filter((s) => s.trendState === "bearish").length;
    const avgConfluence =
      filteredSorted.length > 0
        ? (
            filteredSorted.reduce((sum, s) => sum + s.confluenceScore, 0) /
            filteredSorted.length
          ).toFixed(2)
        : "0.00";
    const topSignal =
      filteredSorted.length > 0
        ? filteredSorted[0].symbol
        : "—";

    return {
      total: filteredSorted.length,
      bullish,
      bearish,
      avgConfluence,
      topSignal,
    };
  }, [filteredSorted]);

  const trendColor = (trend: string) => {
    if (trend === "bullish") return "#9cff93";
    if (trend === "bearish") return "#ff6b6b";
    return "#ffd700";
  };

  const trendArrow = (trend: string) => {
    if (trend === "bullish") return "↑";
    if (trend === "bearish") return "↓";
    return "→";
  };

  const selectedData = filteredSorted.find((s) => s.symbol === selectedSymbol);

  return (
    <div style={{ background: "#0e0e0f", color: "#ffffff", minHeight: "100vh", padding: "24px" }}>
      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", marginBottom: "8px" }}>
          Market Scanner
        </h1>
        <p style={{ fontFamily: "Space Grotesk", fontSize: "13px", color: "#767576", margin: 0 }}>
          Rank all candidate instruments by confluence score, volatility, trend state, and liquidity — continuously updated
        </p>
      </div>

      {/* Error state */}
      {error && (
        <div
          style={{
            backgroundColor: "rgba(255,107,107,0.1)",
            border: "1px solid #ff6b6b",
            borderRadius: "8px",
            padding: "16px",
            marginBottom: "24px",
            fontFamily: "Space Grotesk",
            fontSize: "13px",
            color: "#ff6b6b",
          }}
        >
          Failed to load market data. Please try again.
        </div>
      )}

      {/* Stats bar */}
      <div
        style={{
          backgroundColor: "#1a191b",
          border: "1px solid rgba(72,72,73,0.2)",
          borderRadius: "12px",
          padding: "16px",
          marginBottom: "24px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: "16px",
        }}
      >
        <div>
          <div style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: "#767576" }}>
            Total Symbols
          </div>
          <div style={{ fontFamily: "JetBrains Mono", fontSize: "18px", color: "#9cff93", marginTop: "4px" }}>
            {stats.total}
          </div>
        </div>
        <div>
          <div style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: "#767576" }}>
            Bullish Count
          </div>
          <div style={{ fontFamily: "JetBrains Mono", fontSize: "18px", color: "#9cff93", marginTop: "4px" }}>
            {stats.bullish}
          </div>
        </div>
        <div>
          <div style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: "#767576" }}>
            Bearish Count
          </div>
          <div style={{ fontFamily: "JetBrains Mono", fontSize: "18px", color: "#ff6b6b", marginTop: "4px" }}>
            {stats.bearish}
          </div>
        </div>
        <div>
          <div style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: "#767576" }}>
            Avg Confluence
          </div>
          <div style={{ fontFamily: "JetBrains Mono", fontSize: "18px", color: "#ffd700", marginTop: "4px" }}>
            {(parseFloat(stats.avgConfluence) * 100).toFixed(0)}%
          </div>
        </div>
        <div>
          <div style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: "#767576" }}>
            Top Signal
          </div>
          <div style={{ fontFamily: "JetBrains Mono", fontSize: "18px", color: "#9cff93", marginTop: "4px" }}>
            {stats.topSignal}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div
        style={{
          backgroundColor: "#1a191b",
          border: "1px solid rgba(72,72,73,0.2)",
          borderRadius: "12px",
          padding: "16px",
          marginBottom: "24px",
          display: "flex",
          gap: "12px",
          flexWrap: "wrap",
          alignItems: "flex-end",
        }}
      >
        <div style={{ flex: 1, minWidth: "200px" }}>
          <label style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576", display: "block" }}>
            Search Symbol
          </label>
          <input
            type="text"
            placeholder="e.g., AAPL, SPY..."
            value={searchSymbol}
            onChange={(e) => setSearchSymbol(e.target.value)}
            style={{
              width: "100%",
              padding: "8px",
              marginTop: "4px",
              background: "#0e0e0f",
              color: "#ffffff",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "6px",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: "13px",
              boxSizing: "border-box",
            }}
          />
        </div>
        <div>
          <label style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576", display: "block" }}>
            Sort By
          </label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={{
              padding: "8px",
              marginTop: "4px",
              background: "#0e0e0f",
              color: "#ffffff",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "6px",
              fontFamily: "JetBrains Mono, monospace",
            }}
          >
            <option value="confluenceScore">Confluence Score</option>
            <option value="volatility">Volatility</option>
            <option value="liquidity">Liquidity</option>
          </select>
        </div>
        <div>
          <label style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576", display: "block" }}>
            Asset Class
          </label>
          <select
            value={filterAsset}
            onChange={(e) => setFilterAsset(e.target.value)}
            style={{
              padding: "8px",
              marginTop: "4px",
              background: "#0e0e0f",
              color: "#ffffff",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "6px",
              fontFamily: "JetBrains Mono, monospace",
            }}
          >
            <option value="all">All</option>
            <option value="stocks">Stocks</option>
            <option value="options">Options</option>
            <option value="futures">Futures</option>
          </select>
        </div>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "48px",
            textAlign: "center",
            fontFamily: "Space Grotesk",
            fontSize: "14px",
            color: "#767576",
          }}
        >
          <div style={{ marginBottom: "12px" }}>Loading market data...</div>
          <div
            style={{
              display: "inline-block",
              width: "24px",
              height: "24px",
              border: "2px solid rgba(156,255,147,0.2)",
              borderTop: "2px solid #9cff93",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
            }}
          />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && filteredSorted.length === 0 && (
        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "48px",
            textAlign: "center",
            fontFamily: "Space Grotesk",
            fontSize: "14px",
            color: "#767576",
          }}
        >
          No signals match your filters. Try adjusting your search criteria.
        </div>
      )}

      {/* Table + Detail panel layout */}
      {!isLoading && filteredSorted.length > 0 && (
        <div style={{ display: "flex", gap: "24px" }}>
          {/* Table */}
          <div
            style={{
              flex: selectedSymbol ? 1 : 1,
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
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
                fontSize: "12px",
              }}
            >
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                  <th style={{ padding: "12px", textAlign: "left", color: "#767576" }}>Symbol</th>
                  <th style={{ padding: "12px", textAlign: "left", color: "#767576" }}>Confluence</th>
                  <th style={{ padding: "12px", textAlign: "right", color: "#767576" }}>Vol</th>
                  <th style={{ padding: "12px", textAlign: "left", color: "#767576" }}>Trend</th>
                  <th style={{ padding: "12px", textAlign: "right", color: "#767576" }}>Liq</th>
                </tr>
              </thead>
              <tbody>
                {filteredSorted.slice(0, 50).map((s, i) => (
                  <tr
                    key={i}
                    onClick={() => setSelectedSymbol(s.symbol)}
                    style={{
                      borderBottom: "1px solid rgba(72,72,73,0.2)",
                      backgroundColor: selectedSymbol === s.symbol ? "rgba(156,255,147,0.05)" : "transparent",
                      cursor: "pointer",
                      transition: "background-color 200ms",
                    }}
                    onMouseEnter={(e) => {
                      if (selectedSymbol !== s.symbol) {
                        (e.currentTarget as HTMLTableRowElement).style.backgroundColor =
                          "rgba(156,255,147,0.02)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (selectedSymbol !== s.symbol) {
                        (e.currentTarget as HTMLTableRowElement).style.backgroundColor = "transparent";
                      }
                    }}
                  >
                    <td style={{ padding: "12px", fontWeight: "bold", color: "#9cff93" }}>
                      {s.symbol}
                    </td>
                    <td style={{ padding: "12px" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          width: "120px",
                        }}
                      >
                        <div
                          style={{
                            height: "6px",
                            flex: 1,
                            backgroundColor: "#9cff93",
                            width: `${s.confluenceScore * 100}%`,
                            borderRadius: "2px",
                          }}
                        />
                        <span style={{ fontSize: "11px", color: "#9cff93", minWidth: "28px", textAlign: "right" }}>
                          {(s.confluenceScore * 100).toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: "12px", textAlign: "right", color: "#ffffff" }}>
                      {(s.volatility * 100).toFixed(1)}%
                    </td>
                    <td style={{ padding: "12px" }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "4px 8px",
                          backgroundColor: `${trendColor(s.trendState)}20`,
                          borderRadius: "4px",
                          color: trendColor(s.trendState),
                          fontSize: "11px",
                          fontWeight: "bold",
                        }}
                      >
                        {trendArrow(s.trendState)} {s.trendState.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: "12px", textAlign: "right", color: "#ffffff" }}>
                      {(s.liquidity * 100).toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Detail panel */}
          {selectedData && (
            <div
              style={{
                width: "300px",
                backgroundColor: "#1a191b",
                border: "1px solid rgba(72,72,73,0.2)",
                borderRadius: "12px",
                padding: "24px",
                maxHeight: "600px",
                overflowY: "auto",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "16px",
                }}
              >
                <h2 style={{ fontFamily: "Space Grotesk", fontSize: "18px", margin: 0 }}>
                  {selectedData.symbol}
                </h2>
                <button
                  onClick={() => setSelectedSymbol(null)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#767576",
                    fontSize: "18px",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  ×
                </button>
              </div>

              <div style={{ borderTop: "1px solid rgba(72,72,73,0.2)", paddingTop: "16px" }}>
                <div style={{ marginBottom: "16px" }}>
                  <div style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: "#767576", marginBottom: "4px" }}>
                    Confluence Score
                  </div>
                  <div style={{ fontFamily: "JetBrains Mono", fontSize: "16px", color: "#9cff93" }}>
                    {(selectedData.confluenceScore * 100).toFixed(1)}%
                  </div>
                </div>

                <div style={{ marginBottom: "16px" }}>
                  <div style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: "#767576", marginBottom: "4px" }}>
                    Volatility
                  </div>
                  <div style={{ fontFamily: "JetBrains Mono", fontSize: "16px", color: "#ffffff" }}>
                    {(selectedData.volatility * 100).toFixed(2)}%
                  </div>
                </div>

                <div style={{ marginBottom: "16px" }}>
                  <div style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: "#767576", marginBottom: "4px" }}>
                    Trend State
                  </div>
                  <div
                    style={{
                      fontFamily: "Space Grotesk",
                      fontSize: "14px",
                      color: trendColor(selectedData.trendState),
                      fontWeight: "bold",
                    }}
                  >
                    {trendArrow(selectedData.trendState)} {selectedData.trendState.toUpperCase()}
                  </div>
                </div>

                <div style={{ marginBottom: "16px" }}>
                  <div style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: "#767576", marginBottom: "4px" }}>
                    Liquidity
                  </div>
                  <div style={{ fontFamily: "JetBrains Mono", fontSize: "16px", color: "#ffffff" }}>
                    {(selectedData.liquidity * 100).toFixed(1)}%
                  </div>
                </div>

                <div style={{ marginBottom: "16px" }}>
                  <div style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: "#767576", marginBottom: "4px" }}>
                    Asset Class
                  </div>
                  <div style={{ fontFamily: "JetBrains Mono", fontSize: "14px", color: "#ffffff" }}>
                    {selectedData.assetClass}
                  </div>
                </div>

                <div style={{ marginTop: "24px", paddingTop: "16px", borderTop: "1px solid rgba(72,72,73,0.2)" }}>
                  <div style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: "#767576", marginBottom: "8px" }}>
                    Recommended Action
                  </div>
                  <div
                    style={{
                      fontFamily: "Space Grotesk",
                      fontSize: "13px",
                      color: "#9cff93",
                      lineHeight: "1.5",
                    }}
                  >
                    {selectedData.recommendedAction || "Monitor for entry signals"}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Auto-refresh indicator */}
      {!isLoading && (
        <div
          style={{
            marginTop: "24px",
            textAlign: "center",
            fontFamily: "JetBrains Mono",
            fontSize: "11px",
            color: "#767576",
          }}
        >
          Auto-refresh every 10s · Last update: just now
        </div>
      )}
    </div>
  );
}
