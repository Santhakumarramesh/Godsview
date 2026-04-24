import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

export default function TVReplay() {
  const [selectedSession, setSelectedSession] = useState<string | null>(null);

  const { data: replaySessions = [] } = useQuery({
    queryKey: ["replay-sessions"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/memory/recall?type=replay`);
      if (!res.ok) throw new Error("Failed to fetch replay sessions");
      return res.json();
    },
  });

  const { data: backtestResults = [] } = useQuery({
    queryKey: ["backtest-results"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/backtest/results`);
      if (!res.ok) throw new Error("Failed to fetch backtest results");
      return res.json();
    },
  });

  return (
    <div style={{ backgroundColor: "#0e0e0f", minHeight: "100vh", padding: "24px" }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        <div style={{ marginBottom: "32px" }}>
          <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", color: "#ffffff", marginBottom: "8px" }}>
            TV Replay Connector
          </h1>
          <p style={{ color: "#767576", fontSize: "14px" }}>Review historical replay sessions and linked outcomes</p>
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
          <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", color: "#ffffff", marginBottom: "16px" }}>
            Replay Sessions ({replaySessions.length})
          </h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                  <th style={{ textAlign: "left", padding: "12px", fontFamily: "Space Grotesk", color: "#9cff93", fontSize: "12px" }}>
                    Session ID
                  </th>
                  <th style={{ textAlign: "left", padding: "12px", fontFamily: "Space Grotesk", color: "#9cff93", fontSize: "12px" }}>
                    Symbol
                  </th>
                  <th style={{ textAlign: "left", padding: "12px", fontFamily: "Space Grotesk", color: "#9cff93", fontSize: "12px" }}>
                    Date
                  </th>
                  <th style={{ textAlign: "left", padding: "12px", fontFamily: "Space Grotesk", color: "#9cff93", fontSize: "12px" }}>
                    Observations
                  </th>
                  <th style={{ textAlign: "left", padding: "12px", fontFamily: "Space Grotesk", color: "#9cff93", fontSize: "12px" }}>
                    Outcome
                  </th>
                </tr>
              </thead>
              <tbody>
                {replaySessions.map((session: any, idx: number) => (
                  <tr
                    key={idx}
                    style={{
                      borderBottom: "1px solid rgba(72,72,73,0.2)",
                      cursor: "pointer",
                      backgroundColor: selectedSession === String(idx) ? "rgba(156,255,147,0.05)" : "transparent",
                    }}
                    onClick={() => setSelectedSession(selectedSession === String(idx) ? null : String(idx))}
                  >
                    <td style={{ padding: "12px", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#ffffff" }}>
                      {session.session_id || `SES-${idx}`}
                    </td>
                    <td style={{ padding: "12px", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#ffffff" }}>
                      {session.symbol || "—"}
                    </td>
                    <td style={{ padding: "12px", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#ffffff" }}>
                      {session.date || "—"}
                    </td>
                    <td style={{ padding: "12px", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#767576" }}>
                      {session.observations || "—"}
                    </td>
                    <td style={{ padding: "12px" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "4px 8px",
                          borderRadius: "4px",
                          fontSize: "11px",
                          fontFamily: "Space Grotesk",
                          backgroundColor: session.outcome === "profitable" ? "rgba(156,255,147,0.2)" : "rgba(255,100,100,0.2)",
                          color: session.outcome === "profitable" ? "#9cff93" : "#ff6464",
                        }}
                      >
                        {session.outcome || "unknown"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {selectedSession !== null && replaySessions[parseInt(selectedSession)] && (
          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "24px",
              marginBottom: "24px",
            }}
          >
            <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", color: "#9cff93", marginBottom: "12px" }}>
              Case Study Details
            </h2>
            <pre
              style={{
                backgroundColor: "#0e0e0f",
                padding: "12px",
                borderRadius: "8px",
                overflow: "auto",
                fontFamily: "JetBrains Mono, monospace",
                fontSize: "12px",
                color: "#767576",
              }}
            >
              {JSON.stringify(replaySessions[parseInt(selectedSession)], null, 2)}
            </pre>
          </div>
        )}

        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", color: "#ffffff", marginBottom: "16px" }}>
            Linked Backtest Results ({backtestResults.length})
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: "12px" }}>
            {backtestResults.map((result: any, idx: number) => (
              <div
                key={idx}
                style={{
                  backgroundColor: "#0e0e0f",
                  border: "1px solid rgba(72,72,73,0.2)",
                  borderRadius: "8px",
                  padding: "12px",
                }}
              >
                <p style={{ fontFamily: "Space Grotesk", fontSize: "13px", color: "#ffffff", margin: "0 0 4px 0" }}>
                  {result.test_name || `Test ${idx}`}
                </p>
                <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "11px", color: "#767576", margin: "0 0 4px 0" }}>
                  Return: {result.return_pct || "—"}%
                </p>
                <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "11px", color: "#767576", margin: 0 }}>
                  Trades: {result.trade_count || "—"}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
