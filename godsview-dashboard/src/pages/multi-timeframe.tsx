import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

const timeframes = [
  { label: "Daily (1D)", value: "1d" },
  { label: "4-Hour (4H)", value: "240" },
  { label: "1-Hour (1H)", value: "60" },
  { label: "15-Minute (15m)", value: "15" },
];

export default function MultiTimeframe() {
  const [symbol, setSymbol] = useState("BTCUSD");

  const { data: dailyData } = useQuery({
    queryKey: ["bars", symbol, "1d"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/market/bars/${symbol}?timeframe=1d&limit=50`);
      return res.json();
    },
    refetchInterval: 60000,
  });

  const { data: fourHourData } = useQuery({
    queryKey: ["bars", symbol, "240"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/market/bars/${symbol}?timeframe=240&limit=50`);
      return res.json();
    },
    refetchInterval: 60000,
  });

  const { data: oneHourData } = useQuery({
    queryKey: ["bars", symbol, "60"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/market/bars/${symbol}?timeframe=60&limit=50`);
      return res.json();
    },
    refetchInterval: 60000,
  });

  const { data: fifteenMinData } = useQuery({
    queryKey: ["bars", symbol, "15"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/market/bars/${symbol}?timeframe=15&limit=50`);
      return res.json();
    },
    refetchInterval: 30000,
  });

  const getTrendDirection = (data: any) => {
    if (!data || !data.bars || data.bars.length < 2) return "N/A";
    const latest = data.bars[data.bars.length - 1];
    const prev = data.bars[data.bars.length - 2];
    return latest.c > prev.c ? "UPTREND" : "DOWNTREND";
  };

  const getKeyLevels = (data: any) => {
    if (!data || !data.bars || data.bars.length === 0) return { high: "N/A", low: "N/A" };
    const highs = data.bars.map((b: any) => b.h);
    const lows = data.bars.map((b: any) => b.l);
    return {
      high: Math.max(...highs).toFixed(2),
      low: Math.min(...lows).toFixed(2),
    };
  };

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
        <h1 style={{ marginBottom: "16px" }}>Multi-Timeframe Structure</h1>
        <input
          type="text"
          placeholder="Symbol"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "8px",
            padding: "8px 12px",
            color: "#ffffff",
            fontFamily: '"Space Grotesk", sans-serif',
            width: "200px",
          }}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "20px" }}>
        {[
          { label: "Daily (HTF)", data: dailyData },
          { label: "4-Hour (MTF)", data: fourHourData },
          { label: "1-Hour", data: oneHourData },
          { label: "15-Minute (LTF)", data: fifteenMinData },
        ].map((frame) => (
          <div
            key={frame.label}
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            <h2 style={{ fontSize: "14px", color: "#767576", marginBottom: "16px", textTransform: "uppercase" }}>
              {frame.label}
            </h2>

            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "12px", color: "#767576", marginBottom: "4px" }}>Trend Direction</div>
              <div
                style={{
                  fontSize: "16px",
                  fontWeight: "700",
                  color: getTrendDirection(frame.data) === "UPTREND" ? "#9cff93" : "#ff6b6b",
                  fontFamily: '"JetBrains Mono", monospace',
                }}
              >
                {getTrendDirection(frame.data)}
              </div>
            </div>

            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "12px", color: "#767576", marginBottom: "4px" }}>Key Levels</div>
              <div style={{ fontSize: "12px", fontFamily: '"JetBrains Mono", monospace', lineHeight: "1.6" }}>
                <div>High: {getKeyLevels(frame.data).high}</div>
                <div>Low: {getKeyLevels(frame.data).low}</div>
              </div>
            </div>

            <div>
              <div style={{ fontSize: "12px", color: "#767576", marginBottom: "4px" }}>Structure</div>
              <div
                style={{
                  fontSize: "12px",
                  color: "#9cff93",
                  fontFamily: '"JetBrains Mono", monospace',
                }}
              >
                {frame.data ? "Active" : "Loading..."}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
