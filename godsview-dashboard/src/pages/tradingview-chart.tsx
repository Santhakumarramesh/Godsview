import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

export default function TradingViewChart() {
  const [symbol, setSymbol] = useState("BTCUSD");
  const [timeframe, setTimeframe] = useState("1D");
  const [showVolume, setShowVolume] = useState(true);
  const [showMA, setShowMA] = useState(true);

  const { data: signals } = useQuery({
    queryKey: ["signals", "latest"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/signals/latest`);
      return res.json();
    },
    refetchInterval: 30000,
  });

  return (
    <div
      style={{
        backgroundColor: "#0e0e0f",
        color: "#ffffff",
        minHeight: "100vh",
        padding: "24px",
        fontFamily: '"Space Grotesk", sans-serif',
      }}
    >
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ marginBottom: "16px" }}>TradingView Live Chart</h1>
        <div style={{ display: "flex", gap: "16px", marginBottom: "16px", flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="Symbol (e.g., BTCUSD)"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "8px",
              padding: "8px 12px",
              color: "#ffffff",
              fontFamily: '"Space Grotesk", sans-serif',
            }}
          />
          <div style={{ display: "flex", gap: "8px" }}>
            {["1m", "5m", "15m", "1H", "4H", "1D"].map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                style={{
                  backgroundColor: timeframe === tf ? "#9cff93" : "#1a191b",
                  color: timeframe === tf ? "#0e0e0f" : "#ffffff",
                  border: "1px solid rgba(72,72,73,0.2)",
                  borderRadius: "6px",
                  padding: "6px 12px",
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: "600",
                }}
              >
                {tf}
              </button>
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
          marginBottom: "24px",
        }}
      >
        <h2 style={{ fontSize: "14px", color: "#767576", marginBottom: "12px", textTransform: "uppercase" }}>
          Chart Container
        </h2>
        <iframe
          src={`https://s.tradingview.com/widgetembed/?symbol=${symbol}&interval=${timeframe}&hide_side_toolbar=0&hide_legend=0&theme=dark`}
          style={{
            width: "100%",
            height: "600px",
            border: "none",
            borderRadius: "8px",
          }}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px" }}>
        <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
          <label style={{ fontSize: "12px", color: "#767576" }}>
            <input
              type="checkbox"
              checked={showVolume}
              onChange={(e) => setShowVolume(e.target.checked)}
              style={{ marginRight: "8px" }}
            />
            Volume
          </label>
          <label style={{ fontSize: "12px", color: "#767576" }}>
            <input
              type="checkbox"
              checked={showMA}
              onChange={(e) => setShowMA(e.target.checked)}
              style={{ marginRight: "8px" }}
            />
            Moving Averages
          </label>
        </div>

        {signals && (
          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "16px",
            }}
          >
            <div style={{ fontSize: "12px", color: "#767576", marginBottom: "8px" }}>Latest Signal</div>
            <div style={{ fontSize: "14px", color: "#9cff93", fontFamily: '"JetBrains Mono", monospace' }}>
              {signals?.type || "N/A"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
