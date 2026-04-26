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

interface WalkForwardFold {
  fold_number: number;
  train_start: string;
  train_end: string;
  test_start: string;
  test_end: string;
  profit_factor: number;
  sharpe_ratio: number;
  win_rate: number;
  passed: boolean;
}

interface WalkForwardResults {
  folds: WalkForwardFold[];
  total_folds: number;
  passed_count: number;
  avg_profit_factor: number;
  avg_sharpe: number;
}

export default function WalkForward() {
  const { data: resultsData, isLoading } = useQuery({
    queryKey: ["walk-forward"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/backtest/walk-forward`);
      return res.json() as Promise<WalkForwardResults>;
    },
  });

  return (
    <div style={{ backgroundColor: C.bg, minHeight: "100vh", padding: "24px", color: C.text }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", marginBottom: "32px" }}>
          Walk-Forward Validation
        </h1>

        {/* Summary Stats */}
        {resultsData && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "16px",
              marginBottom: "24px",
            }}
          >
            <div
              style={{
                backgroundColor: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: "12px",
                padding: "20px",
              }}
            >
              <div style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: C.muted, marginBottom: "8px" }}>
                TOTAL FOLDS
              </div>
              <div style={{ fontFamily: "JetBrains Mono", fontSize: "24px", color: C.accent }}>
                {resultsData.total_folds}
              </div>
            </div>
            <div
              style={{
                backgroundColor: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: "12px",
                padding: "20px",
              }}
            >
              <div style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: C.muted, marginBottom: "8px" }}>
                PASSED
              </div>
              <div style={{ fontFamily: "JetBrains Mono", fontSize: "24px", color: "#52ff00" }}>
                {resultsData.passed_count}
              </div>
            </div>
            <div
              style={{
                backgroundColor: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: "12px",
                padding: "20px",
              }}
            >
              <div style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: C.muted, marginBottom: "8px" }}>
                AVG PROFIT FACTOR
              </div>
              <div style={{ fontFamily: "JetBrains Mono", fontSize: "24px", color: C.accent }}>
                {resultsData.avg_profit_factor.toFixed(2)}
              </div>
            </div>
            <div
              style={{
                backgroundColor: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: "12px",
                padding: "20px",
              }}
            >
              <div style={{ fontFamily: "Space Grotesk", fontSize: "11px", color: C.muted, marginBottom: "8px" }}>
                AVG SHARPE
              </div>
              <div style={{ fontFamily: "JetBrains Mono", fontSize: "24px", color: C.accent }}>
                {resultsData.avg_sharpe.toFixed(2)}
              </div>
            </div>
          </div>
        )}

        {/* Folds Table */}
        {isLoading ? (
          <div style={{ textAlign: "center", padding: "40px" }}>Loading walk-forward results...</div>
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
                  <th style={{ padding: "12px", textAlign: "center", color: C.muted, fontWeight: "normal" }}>Fold</th>
                  <th style={{ padding: "12px", textAlign: "left", color: C.muted, fontWeight: "normal" }}>
                    Train Period
                  </th>
                  <th style={{ padding: "12px", textAlign: "left", color: C.muted, fontWeight: "normal" }}>
                    Test Period
                  </th>
                  <th style={{ padding: "12px", textAlign: "right", color: C.muted, fontWeight: "normal" }}>PF</th>
                  <th style={{ padding: "12px", textAlign: "right", color: C.muted, fontWeight: "normal" }}>
                    Sharpe
                  </th>
                  <th style={{ padding: "12px", textAlign: "right", color: C.muted, fontWeight: "normal" }}>
                    Win Rate
                  </th>
                  <th style={{ padding: "12px", textAlign: "center", color: C.muted, fontWeight: "normal" }}>
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {resultsData &&
                  resultsData.folds.map((fold, idx) => (
                    <tr
                      key={idx}
                      style={{
                        borderBottom: `1px solid ${C.border}`,
                        backgroundColor: idx % 2 === 0 ? "" : "rgba(26,25,27,0.5)",
                      }}
                    >
                      <td style={{ padding: "12px", textAlign: "center", color: C.accent }}>
                        {fold.fold_number}
                      </td>
                      <td style={{ padding: "12px", color: C.text, fontSize: "12px" }}>
                        {fold.train_start} to {fold.train_end}
                      </td>
                      <td style={{ padding: "12px", color: C.text, fontSize: "12px" }}>
                        {fold.test_start} to {fold.test_end}
                      </td>
                      <td style={{ padding: "12px", textAlign: "right", color: C.text }}>
                        {fold.profit_factor.toFixed(2)}
                      </td>
                      <td style={{ padding: "12px", textAlign: "right", color: C.text }}>
                        {fold.sharpe_ratio.toFixed(2)}
                      </td>
                      <td style={{ padding: "12px", textAlign: "right", color: C.text }}>
                        {(fold.win_rate * 100).toFixed(1)}%
                      </td>
                      <td
                        style={{
                          padding: "12px",
                          textAlign: "center",
                          color: fold.passed ? "#52ff00" : "#ff7162",
                          fontWeight: "600",
                        }}
                      >
                        {fold.passed ? "PASS" : "FAIL"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
