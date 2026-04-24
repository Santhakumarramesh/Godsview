import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

export default function OrderBlocks() {
  const [symbol, setSymbol] = useState("BTCUSD");
  const [filterType, setFilterType] = useState("all");

  const { data: marketStructure } = useQuery({
    queryKey: ["market-structure", symbol],
    queryFn: async () => {
      const res = await fetch(`${API}/api/market-structure?symbol=${symbol}`);
      return res.json();
    },
    refetchInterval: 45000,
  });

  const { data: signals } = useQuery({
    queryKey: ["signals", symbol],
    queryFn: async () => {
      const res = await fetch(`${API}/api/signals?symbol=${symbol}&limit=50`);
      return res.json();
    },
    refetchInterval: 45000,
  });

  const orderBlocks = marketStructure?.orderBlocks || [];
  const filtered =
    filterType === "all"
      ? orderBlocks
      : orderBlocks.filter((ob: any) => ob.type === filterType);

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
        <h1 style={{ marginBottom: "16px" }}>Order Block Engine</h1>
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
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
            }}
          />
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "8px",
              padding: "8px 12px",
              color: "#ffffff",
            }}
          >
            <option value="all">All Blocks</option>
            <option value="bullish">Bullish</option>
            <option value="bearish">Bearish</option>
          </select>
        </div>
      </div>

      <div style={{ marginBottom: "24px" }}>
        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "24px",
            marginBottom: "16px",
          }}
        >
          <h2 style={{ fontSize: "14px", color: "#767576", marginBottom: "16px", textTransform: "uppercase" }}>
            Summary
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "16px" }}>
            <div>
              <div style={{ fontSize: "12px", color: "#767576" }}>Total Blocks</div>
              <div style={{ fontSize: "20px", fontWeight: "700", color: "#9cff93" }}>
                {filtered.length}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "12px", color: "#767576" }}>Bullish</div>
              <div style={{ fontSize: "20px", fontWeight: "700", color: "#9cff93" }}>
                {filtered.filter((ob: any) => ob.type === "bullish").length}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "12px", color: "#767576" }}>Bearish</div>
              <div style={{ fontSize: "20px", fontWeight: "700", color: "#ff6b6b" }}>
                {filtered.filter((ob: any) => ob.type === "bearish").length}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: "12px",
          }}
        >
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
              <th style={{ padding: "12px", textAlign: "left", color: "#767576" }}>Type</th>
              <th style={{ padding: "12px", textAlign: "left", color: "#767576" }}>High</th>
              <th style={{ padding: "12px", textAlign: "left", color: "#767576" }}>Low</th>
              <th style={{ padding: "12px", textAlign: "left", color: "#767576" }}>Status</th>
              <th style={{ padding: "12px", textAlign: "left", color: "#767576" }}>Freshness</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 10).map((ob: any, idx: number) => (
              <tr key={idx} style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                <td style={{ padding: "12px", color: ob.type === "bullish" ? "#9cff93" : "#ff6b6b" }}>
                  {ob.type?.toUpperCase()}
                </td>
                <td style={{ padding: "12px", color: "#ffffff" }}>{ob.high?.toFixed(2)}</td>
                <td style={{ padding: "12px", color: "#ffffff" }}>{ob.low?.toFixed(2)}</td>
                <td style={{ padding: "12px", color: "#9cff93" }}>{ob.mitigated ? "MITIGATED" : "ACTIVE"}</td>
                <td style={{ padding: "12px", color: "#767576" }}>{ob.freshness || "N/A"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
