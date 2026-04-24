import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

type SignalRow = {
  symbol: string;
  confluenceScore: number;
  volatility: number;
  trendState: string;
  liquidity: number;
  assetClass: string;
};

export default function MarketScannerPage() {
  const [sortBy, setSortBy] = useState("confluenceScore");
  const [filterAsset, setFilterAsset] = useState("all");

  const { data: signalsData } = useQuery({
    queryKey: ["signals", "scanner"],
    queryFn: () => fetch(`${API}/api/signals?limit=100`).then((r) => r.json()),
    refetchInterval: 10000,
  });

  const { data: watchlistData } = useQuery({
    queryKey: ["watchlist", "scan"],
    queryFn: () => fetch(`${API}/api/watchlist/scan`).then((r) => r.json()),
    refetchInterval: 15000,
  });

  let signals: SignalRow[] = signalsData?.data || [];
  watchlistData?.data?.forEach((w: SignalRow) => {
    if (!signals.find((s) => s.symbol === w.symbol)) signals.push(w);
  });

  // Filter
  if (filterAsset !== "all") {
    signals = signals.filter((s) => s.assetClass === filterAsset);
  }

  // Sort
  signals.sort((a, b) => {
    const aVal = a[sortBy as keyof SignalRow] as number;
    const bVal = b[sortBy as keyof SignalRow] as number;
    return typeof aVal === "number" ? bVal - aVal : 0;
  });

  const trendColor = (trend: string) => {
    if (trend === "bullish") return "#9cff93";
    if (trend === "bearish") return "#ff6b6b";
    return "#ffd700";
  };

  return (
    <div style={{ background: "#0e0e0f", color: "#ffffff", minHeight: "100vh", padding: "24px" }}>
      <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", marginBottom: "24px" }}>
        Market Scanner
      </h1>

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
        }}
      >
        <div>
          <label style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576" }}>
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
          <label style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576" }}>
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

      {/* Table */}
      <div
        style={{
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
            fontSize: "13px",
          }}
        >
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
              <th style={{ padding: "12px", textAlign: "left", color: "#767576" }}>Symbol</th>
              <th style={{ padding: "12px", textAlign: "right", color: "#767576" }}>Confluence</th>
              <th style={{ padding: "12px", textAlign: "right", color: "#767576" }}>Volatility</th>
              <th style={{ padding: "12px", textAlign: "left", color: "#767576" }}>Trend</th>
              <th style={{ padding: "12px", textAlign: "right", color: "#767576" }}>Liquidity</th>
              <th style={{ padding: "12px", textAlign: "left", color: "#767576" }}>Class</th>
            </tr>
          </thead>
          <tbody>
            {signals.slice(0, 50).map((s, i) => (
              <tr key={i} style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                <td style={{ padding: "12px", fontWeight: "bold", color: "#9cff93" }}>
                  {s.symbol}
                </td>
                <td style={{ padding: "12px", textAlign: "right", color: "#9cff93" }}>
                  {(s.confluenceScore * 100).toFixed(0)}%
                </td>
                <td style={{ padding: "12px", textAlign: "right" }}>
                  {(s.volatility * 100).toFixed(1)}%
                </td>
                <td style={{ padding: "12px", color: trendColor(s.trendState) }}>
                  {s.trendState.toUpperCase()}
                </td>
                <td style={{ padding: "12px", textAlign: "right" }}>
                  {(s.liquidity * 100).toFixed(0)}%
                </td>
                <td style={{ padding: "12px", color: "#767576" }}>{s.assetClass}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
