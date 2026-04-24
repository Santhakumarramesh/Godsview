import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

type Liquidity = {
  symbol: string;
  spread: number;
  depth: number;
  participationRate: number;
  sessionScore: number;
};

export default function LiquidityEnvironmentPage() {
  const { data: orderbookData } = useQuery({
    queryKey: ["market", "orderbook"],
    queryFn: () => fetch(`${API}/api/market/orderbook`).then((r) => r.json()),
    refetchInterval: 5000,
  });

  const { data: liquidityData } = useQuery({
    queryKey: ["features", "liquidity"],
    queryFn: () => fetch(`${API}/api/features/liquidity`).then((r) => r.json()),
    refetchInterval: 10000,
  });

  const orderbook = orderbookData?.data || {};
  const liquidity: Liquidity[] = liquidityData?.instruments || [];

  const spreadColor = (spread: number) => {
    if (spread < 0.01) return "#9cff93";
    if (spread < 0.05) return "#ffd700";
    return "#ff6b6b";
  };

  const depthColor = (depth: number) => {
    if (depth > 1000000) return "#9cff93";
    if (depth > 100000) return "#ffd700";
    return "#ff6b6b";
  };

  return (
    <div style={{ background: "#0e0e0f", color: "#ffffff", minHeight: "100vh", padding: "24px" }}>
      <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", marginBottom: "24px" }}>
        Liquidity Environment
      </h1>

      {/* Overall Metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "24px" }}>
        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576" }}>
            Avg Spread
          </p>
          <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "24px", color: "#9cff93", marginTop: "8px" }}>
            {(orderbook.avgSpread * 100).toFixed(2)}%
          </p>
        </div>

        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576" }}>
            Book Depth
          </p>
          <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "20px", color: "#9cff93", marginTop: "8px" }}>
            ${(orderbook.totalDepth / 1000000).toFixed(1)}M
          </p>
        </div>

        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576" }}>
            Session Score
          </p>
          <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "24px", color: "#9cff93", marginTop: "8px" }}>
            {(orderbook.sessionScore * 100).toFixed(0)}%
          </p>
        </div>
      </div>

      {/* Depth Chart Placeholder */}
      <div
        style={{
          backgroundColor: "#1a191b",
          border: "1px solid rgba(72,72,73,0.2)",
          borderRadius: "12px",
          padding: "24px",
          marginBottom: "24px",
          height: "200px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg viewBox="0 0 500 150" style={{ width: "100%", height: "100%" }}>
          {/* Grid */}
          <defs>
            <linearGradient id="depthGrad" x1="0%" x2="100%">
              <stop offset="0%" stopColor="#9cff93" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#ff6b6b" stopOpacity="0.3" />
            </linearGradient>
          </defs>
          <line x1="0" y1="140" x2="500" y2="140" stroke="rgba(72,72,73,0.2)" strokeWidth="1" />
          {[...Array(5)].map((_, i) => (
            <line
              key={i}
              x1={i * 100}
              y1="130"
              x2={i * 100}
              y2="140"
              stroke="rgba(72,72,73,0.2)"
              strokeWidth="1"
            />
          ))}
          <path
            d="M 0 140 Q 50 100 100 80 T 200 60 T 300 70 T 400 90 T 500 140 Z"
            fill="url(#depthGrad)"
          />
        </svg>
      </div>

      {/* Instrument Liquidity */}
      <div
        style={{
          backgroundColor: "#1a191b",
          border: "1px solid rgba(72,72,73,0.2)",
          borderRadius: "12px",
          padding: "24px",
          overflowX: "auto",
        }}
      >
        <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", marginBottom: "16px" }}>
          Instrument Liquidity
        </h2>
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
              <th style={{ padding: "12px", textAlign: "right", color: "#767576" }}>Spread</th>
              <th style={{ padding: "12px", textAlign: "right", color: "#767576" }}>Depth</th>
              <th style={{ padding: "12px", textAlign: "right", color: "#767576" }}>Part. Rate</th>
              <th style={{ padding: "12px", textAlign: "right", color: "#767576" }}>Score</th>
            </tr>
          </thead>
          <tbody>
            {liquidity.slice(0, 15).map((l, i) => (
              <tr key={i} style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                <td style={{ padding: "12px", fontWeight: "bold", color: "#9cff93" }}>
                  {l.symbol}
                </td>
                <td style={{ padding: "12px", textAlign: "right", color: spreadColor(l.spread) }}>
                  {(l.spread * 100).toFixed(2)}%
                </td>
                <td style={{ padding: "12px", textAlign: "right", color: depthColor(l.depth) }}>
                  ${(l.depth / 1000000).toFixed(1)}M
                </td>
                <td style={{ padding: "12px", textAlign: "right" }}>
                  {(l.participationRate * 100).toFixed(1)}%
                </td>
                <td style={{ padding: "12px", textAlign: "right", color: "#9cff93" }}>
                  {(l.sessionScore * 100).toFixed(0)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
