import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

const C = {
  bg: "#0e0e0f",
  card: "#1a191b",
  border: "rgba(72,72,73,0.2)",
  accent: "#9cff93",
  text: "#ffffff",
  muted: "#767576",
};

interface Experiment {
  id: string;
  strategy: string;
  parameters: Record<string, string | number>;
  sharpe: number;
  profit_factor: number;
  status: "running" | "completed" | "failed";
  created_at: string;
  rank?: number;
}

interface ExperimentResponse {
  experiments: Experiment[];
  total: number;
}

export default function ExperimentTracker() {
  const { data: experimentsData, isLoading } = useQuery({
    queryKey: ["experiments"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/lab/experiments`);
      return res.json() as Promise<ExperimentResponse>;
    },
  });

  const { data: leaderboardData } = useQuery({
    queryKey: ["backtest-leaderboard"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/backtest/leaderboard`);
      return res.json();
    },
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "#52ff00";
      case "running":
        return C.accent;
      case "failed":
        return "#ff7162";
      default:
        return C.muted;
    }
  };

  return (
    <div style={{ backgroundColor: C.bg, minHeight: "100vh", padding: "24px", color: C.text }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", marginBottom: "32px" }}>
          Experiment Tracker
        </h1>

        {isLoading ? (
          <div style={{ textAlign: "center", padding: "40px" }}>Loading experiments...</div>
        ) : (
          <div
            style={{
              backgroundColor: C.card,
              border: `1px solid ${C.border}`,
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
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  <th style={{ padding: "12px", textAlign: "left", color: C.muted, fontWeight: "normal" }}>
                    Experiment ID
                  </th>
                  <th style={{ padding: "12px", textAlign: "left", color: C.muted, fontWeight: "normal" }}>
                    Strategy
                  </th>
                  <th style={{ padding: "12px", textAlign: "left", color: C.muted, fontWeight: "normal" }}>
                    Parameters
                  </th>
                  <th style={{ padding: "12px", textAlign: "right", color: C.muted, fontWeight: "normal" }}>
                    Sharpe
                  </th>
                  <th style={{ padding: "12px", textAlign: "right", color: C.muted, fontWeight: "normal" }}>PF</th>
                  <th style={{ padding: "12px", textAlign: "center", color: C.muted, fontWeight: "normal" }}>
                    Status
                  </th>
                  <th style={{ padding: "12px", textAlign: "left", color: C.muted, fontWeight: "normal" }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {experimentsData &&
                  experimentsData.experiments.map((exp, idx) => (
                    <tr
                      key={exp.id}
                      style={{
                        borderBottom: `1px solid ${C.border}`,
                        backgroundColor: idx % 2 === 0 ? "" : "rgba(26,25,27,0.5)",
                      }}
                    >
                      <td style={{ padding: "12px", color: C.accent, fontWeight: "500" }}>
                        {exp.id.substring(0, 8)}
                      </td>
                      <td style={{ padding: "12px", color: C.text }}>{exp.strategy}</td>
                      <td style={{ padding: "12px", color: C.muted, fontSize: "11px" }}>
                        {Object.entries(exp.parameters)
                          .slice(0, 2)
                          .map(([k, v]) => `${k}=${v}`)
                          .join(", ")}
                        {Object.keys(exp.parameters).length > 2 && "..."}
                      </td>
                      <td style={{ padding: "12px", textAlign: "right", color: C.text }}>
                        {exp.sharpe.toFixed(2)}
                      </td>
                      <td style={{ padding: "12px", textAlign: "right", color: C.text }}>
                        {exp.profit_factor.toFixed(2)}
                      </td>
                      <td
                        style={{
                          padding: "12px",
                          textAlign: "center",
                          color: getStatusColor(exp.status),
                          fontWeight: "600",
                          fontSize: "12px",
                        }}
                      >
                        {exp.status.toUpperCase()}
                      </td>
                      <td style={{ padding: "12px", color: C.muted, fontSize: "12px" }}>
                        {new Date(exp.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {experimentsData && (
              <div style={{ marginTop: "16px", textAlign: "right", color: C.muted, fontSize: "12px" }}>
                {experimentsData.total} total experiment{experimentsData.total !== 1 ? "s" : ""}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
