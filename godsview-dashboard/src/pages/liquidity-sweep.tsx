import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

export default function LiquiditySweep() {
  const [symbol, setSymbol] = useState("BTCUSD");

  const { data: signals } = useQuery({
    queryKey: ["signals", symbol, "sweeps"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/signals?symbol=${symbol}&type=sweep&limit=80`);
      return res.json();
    },
    refetchInterval: 45000,
  });

  const sweepEvents = signals?.signals || [];

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
        <h1 style={{ marginBottom: "16px" }}>Liquidity Sweep Mapper</h1>
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
            width: "200px",
          }}
        />
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
        <h2 style={{ fontSize: "14px", color: "#767576", marginBottom: "16px", textTransform: "uppercase" }}>
          Sweep Statistics
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "16px" }}>
          <div>
            <div style={{ fontSize: "12px", color: "#767576" }}>Total Sweeps</div>
            <div style={{ fontSize: "20px", fontWeight: "700", color: "#9cff93" }}>
              {sweepEvents.length}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "#767576" }}>Reversals</div>
            <div style={{ fontSize: "20px", fontWeight: "700", color: "#9cff93" }}>
              {sweepEvents.filter((e: any) => e.outcome === "reversal").length}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "#767576" }}>Continuations</div>
            <div style={{ fontSize: "20px", fontWeight: "700", color: "#ff6b6b" }}>
              {sweepEvents.filter((e: any) => e.outcome === "continuation").length}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "#767576" }}>Avg Participants</div>
            <div style={{ fontSize: "20px", fontWeight: "700", color: "#9cff93" }}>
              {Math.round(
                sweepEvents.reduce((sum: number, e: any) => sum + (e.participantCount || 0), 0) /
                  (sweepEvents.length || 1)
              )}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "16px" }}>
        {sweepEvents.slice(0, 12).map((event: any, idx: number) => (
          <div
            key={idx}
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "16px",
            }}
          >
            <div style={{ marginBottom: "12px" }}>
              <div style={{ fontSize: "11px", color: "#767576", marginBottom: "4px" }}>ZONE</div>
              <div
                style={{
                  fontSize: "14px",
                  fontWeight: "700",
                  color: "#9cff93",
                  fontFamily: '"JetBrains Mono", monospace',
                }}
              >
                ${event.level?.toFixed(2) || "N/A"}
              </div>
            </div>

            <div style={{ marginBottom: "12px" }}>
              <div style={{ fontSize: "11px", color: "#767576", marginBottom: "4px" }}>TRAPPED PARTICIPANTS</div>
              <div
                style={{
                  fontSize: "12px",
                  color: "#ffffff",
                  fontFamily: '"JetBrains Mono", monospace',
                }}
              >
                {event.participantCount || "0"}
              </div>
            </div>

            <div style={{ marginBottom: "12px" }}>
              <div style={{ fontSize: "11px", color: "#767576", marginBottom: "4px" }}>LIKELY OUTCOME</div>
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: "600",
                  color: event.outcome === "reversal" ? "#9cff93" : "#ff6b6b",
                  textTransform: "uppercase",
                }}
              >
                {event.outcome || "PENDING"}
              </div>
            </div>

            <div style={{ fontSize: "11px", color: "#767576" }}>
              Probability: {event.probability || "N/A"}%
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
