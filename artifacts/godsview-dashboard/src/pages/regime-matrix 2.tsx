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

interface RegimeMetrics {
  profit_factor: number;
  win_rate: number;
  risk_reward: number;
}

interface PerformanceData {
  strategies: string[];
  regimes: Record<string, Record<string, RegimeMetrics>>;
}

const getColorForMetric = (value: number): string => {
  if (value >= 1.8) return "#52ff00"; // Green
  if (value >= 1.3) return "#9cff93"; // Light green
  if (value >= 0.8) return "#ffcc00"; // Yellow
  return "#ff7162"; // Red
};

export default function RegimeMatrix() {
  const { data: performanceData, isLoading } = useQuery({
    queryKey: ["performance"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/analytics/performance`);
      return res.json() as Promise<PerformanceData>;
    },
  });

  const { data: macroData } = useQuery({
    queryKey: ["macro"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/macro`);
      return res.json();
    },
  });

  const regimes = ["Trend", "Chop", "Volatile", "Event"];

  return (
    <div style={{ backgroundColor: C.bg, minHeight: "100vh", padding: "24px", color: C.text }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", marginBottom: "32px" }}>
          Regime Performance Matrix
        </h1>

        {isLoading ? (
          <div style={{ textAlign: "center", padding: "40px" }}>Loading regime analysis...</div>
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
                fontSize: "12px",
              }}
            >
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  <th style={{ padding: "12px", textAlign: "left", color: C.muted, fontWeight: "normal" }}>
                    Strategy
                  </th>
                  {regimes.map((regime) => (
                    <th
                      key={regime}
                      style={{
                        padding: "12px",
                        textAlign: "center",
                        color: C.muted,
                        fontWeight: "normal",
                      }}
                    >
                      {regime}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {performanceData &&
                  performanceData.strategies.map((strategy, idx) => (
                    <tr
                      key={strategy}
                      style={{
                        borderBottom: `1px solid ${C.border}`,
                        backgroundColor: idx % 2 === 0 ? "" : "rgba(26,25,27,0.5)",
                      }}
                    >
                      <td style={{ padding: "12px", color: C.accent, fontWeight: "500", minWidth: "150px" }}>
                        {strategy}
                      </td>
                      {regimes.map((regime) => {
                        const metrics = performanceData.regimes[regime]?.[strategy];
                        return (
                          <td
                            key={`${strategy}-${regime}`}
                            style={{
                              padding: "12px",
                              textAlign: "center",
                              backgroundColor: metrics
                                ? `${getColorForMetric(metrics.profit_factor)}20`
                                : "transparent",
                              borderRadius: "6px",
                            }}
                          >
                            {metrics ? (
                              <div>
                                <div
                                  style={{
                                    color: getColorForMetric(metrics.profit_factor),
                                    fontWeight: "600",
                                    fontSize: "13px",
                                  }}
                                >
                                  PF: {metrics.profit_factor.toFixed(2)}
                                </div>
                                <div style={{ color: C.muted, fontSize: "11px", marginTop: "2px" }}>
                                  WR: {(metrics.win_rate * 100).toFixed(0)}%
                                </div>
                                <div style={{ color: C.muted, fontSize: "11px" }}>
                                  R:R: {metrics.risk_reward.toFixed(2)}
                                </div>
                              </div>
                            ) : (
                              <div style={{ color: C.muted }}>—</div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </tbody>
            </table>

            {/* Legend */}
            <div style={{ marginTop: "24px", paddingTop: "24px", borderTop: `1px solid ${C.border}` }}>
              <div style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: C.muted, marginBottom: "12px" }}>
                LEGEND
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{ width: "16px", height: "16px", backgroundColor: "#52ff00", borderRadius: "4px" }} />
                  <span style={{ fontFamily: "JetBrains Mono", fontSize: "12px" }}>Excellent (1.8+)</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{ width: "16px", height: "16px", backgroundColor: "#9cff93", borderRadius: "4px" }} />
                  <span style={{ fontFamily: "JetBrains Mono", fontSize: "12px" }}>Good (1.3+)</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{ width: "16px", height: "16px", backgroundColor: "#ffcc00", borderRadius: "4px" }} />
                  <span style={{ fontFamily: "JetBrains Mono", fontSize: "12px" }}>Fair (0.8+)</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{ width: "16px", height: "16px", backgroundColor: "#ff7162", borderRadius: "4px" }} />
                  <span style={{ fontFamily: "JetBrains Mono", fontSize: "12px" }}>Poor (&lt;0.8)</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
