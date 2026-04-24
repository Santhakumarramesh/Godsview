import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

export default function BOSCHOCHEngine() {
  const [symbol, setSymbol] = useState("BTCUSD");
  const [eventType, setEventType] = useState("all");

  const { data: marketStructure } = useQuery({
    queryKey: ["market-structure", symbol],
    queryFn: async () => {
      const res = await fetch(`${API}/api/market-structure?symbol=${symbol}`);
      return res.json();
    },
    refetchInterval: 45000,
  });

  const { data: features } = useQuery({
    queryKey: ["features", symbol],
    queryFn: async () => {
      const res = await fetch(`${API}/api/features/${symbol}`);
      return res.json();
    },
    refetchInterval: 45000,
  });

  const bosEvents = marketStructure?.bosEvents || [];
  const chochEvents = marketStructure?.chochEvents || [];

  const allEvents = [
    ...bosEvents.map((e: any) => ({ ...e, type: "BOS" })),
    ...chochEvents.map((e: any) => ({ ...e, type: "CHOCH" })),
  ].sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const filtered =
    eventType === "all"
      ? allEvents
      : allEvents.filter((e: any) => e.type === eventType);

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
        <h1 style={{ marginBottom: "16px" }}>BOS/CHOCH Engine</h1>
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
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "8px",
              padding: "8px 12px",
              color: "#ffffff",
            }}
          >
            <option value="all">All Events</option>
            <option value="BOS">BOS Only</option>
            <option value="CHOCH">CHOCH Only</option>
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
            Market Context
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "16px" }}>
            <div>
              <div style={{ fontSize: "12px", color: "#767576" }}>Total Events</div>
              <div style={{ fontSize: "20px", fontWeight: "700", color: "#9cff93" }}>
                {filtered.length}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "12px", color: "#767576" }}>BOS Events</div>
              <div style={{ fontSize: "20px", fontWeight: "700", color: "#9cff93" }}>
                {filtered.filter((e: any) => e.type === "BOS").length}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "12px", color: "#767576" }}>CHOCH Events</div>
              <div style={{ fontSize: "20px", fontWeight: "700", color: "#ff6b6b" }}>
                {filtered.filter((e: any) => e.type === "CHOCH").length}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "12px", color: "#767576" }}>Avg Confidence</div>
              <div style={{ fontSize: "20px", fontWeight: "700", color: "#9cff93" }}>
                {(
                  filtered.reduce((sum: number, e: any) => sum + (e.confidence || 0), 0) /
                  (filtered.length || 1)
                ).toFixed(0)}%
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
              <th style={{ padding: "12px", textAlign: "left", color: "#767576" }}>Time</th>
              <th style={{ padding: "12px", textAlign: "left", color: "#767576" }}>Type</th>
              <th style={{ padding: "12px", textAlign: "left", color: "#767576" }}>Direction</th>
              <th style={{ padding: "12px", textAlign: "left", color: "#767576" }}>Symbol</th>
              <th style={{ padding: "12px", textAlign: "left", color: "#767576" }}>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 15).map((event: any, idx: number) => (
              <tr key={idx} style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                <td style={{ padding: "12px", color: "#767576" }}>
                  {new Date(event.timestamp).toLocaleTimeString()}
                </td>
                <td style={{ padding: "12px", color: event.type === "BOS" ? "#9cff93" : "#ff6b6b" }}>
                  {event.type}
                </td>
                <td style={{ padding: "12px", color: event.direction === "up" ? "#9cff93" : "#ff6b6b" }}>
                  {event.direction?.toUpperCase()}
                </td>
                <td style={{ padding: "12px", color: "#ffffff" }}>{event.symbol}</td>
                <td style={{ padding: "12px", color: "#9cff93" }}>{event.confidence || 0}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
