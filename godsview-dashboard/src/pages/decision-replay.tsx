import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

type Decision = {
  timestamp: string;
  symbol: string;
  decision: string;
  confidence: number;
  outcome: "win" | "loss" | "pending";
  reasoning: string;
};

export default function DecisionReplayPage() {
  const { data: historyData } = useQuery({
    queryKey: ["decision", "history"],
    queryFn: () =>
      fetch(`${API}/api/decision-loop/history?limit=50`).then((r) => r.json()),
    refetchInterval: 10000,
  });

  const decisions: Decision[] = historyData?.decisions || [];

  const outcomeColor = (outcome: string) => {
    if (outcome === "win") return "#9cff93";
    if (outcome === "loss") return "#ff6b6b";
    return "#767576";
  };

  const decisionColor = (decision: string) => {
    if (decision === "BUY") return "#9cff93";
    if (decision === "SELL") return "#ff6b6b";
    return "#ffd700";
  };

  return (
    <div style={{ background: "#0e0e0f", color: "#ffffff", minHeight: "100vh", padding: "24px" }}>
      <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", marginBottom: "24px" }}>
        Decision Replay
      </h1>

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
              <th style={{ padding: "12px", textAlign: "left", color: "#767576" }}>Timestamp</th>
              <th style={{ padding: "12px", textAlign: "left", color: "#767576" }}>Symbol</th>
              <th style={{ padding: "12px", textAlign: "left", color: "#767576" }}>Decision</th>
              <th style={{ padding: "12px", textAlign: "right", color: "#767576" }}>Confidence</th>
              <th style={{ padding: "12px", textAlign: "left", color: "#767576" }}>Outcome</th>
              <th style={{ padding: "12px", textAlign: "left", color: "#767576" }}>Reasoning</th>
            </tr>
          </thead>
          <tbody>
            {decisions.map((d, i) => (
              <tr key={i} style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                <td style={{ padding: "12px", color: "#9cff93" }}>
                  {new Date(d.timestamp).toLocaleTimeString()}
                </td>
                <td style={{ padding: "12px", fontWeight: "bold" }}>{d.symbol}</td>
                <td style={{ padding: "12px", color: decisionColor(d.decision) }}>
                  {d.decision}
                </td>
                <td style={{ padding: "12px", textAlign: "right" }}>
                  {(d.confidence * 100).toFixed(0)}%
                </td>
                <td style={{ padding: "12px", color: outcomeColor(d.outcome) }}>
                  {d.outcome.toUpperCase()}
                </td>
                <td style={{ padding: "12px", color: "#767576", fontSize: "12px", maxWidth: "300px" }}>
                  {d.reasoning.substring(0, 50)}...
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {decisions.length === 0 && (
          <p style={{ textAlign: "center", color: "#767576", padding: "24px" }}>No decisions recorded</p>
        )}
      </div>
    </div>
  );
}
