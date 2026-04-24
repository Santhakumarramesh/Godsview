import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

type BacktestResult = {
  strategy: string;
  profitFactor: number;
  sharpe: number;
  winRate: number;
  maxDD: number;
  totalTrades: number;
  expectancy: number;
  timestamp: string;
};

export default function BacktesterPage() {
  const queryClient = useQueryClient();
  const [symbol, setSymbol] = useState("AAPL");
  const [strategy, setStrategy] = useState("breakout");
  const [startDate, setStartDate] = useState("2024-01-01");
  const [endDate, setEndDate] = useState("2024-12-31");

  const { data: resultsData } = useQuery({
    queryKey: ["backtest", "results"],
    queryFn: () => fetch(`${API}/api/backtest/results`).then((r) => r.json()),
    refetchInterval: 30000,
  });

  const { data: leaderboardData } = useQuery({
    queryKey: ["backtest", "leaderboard"],
    queryFn: () =>
      fetch(`${API}/api/backtest/leaderboard`).then((r) => r.json()),
    refetchInterval: 60000,
  });

  const runMutation = useMutation({
    mutationFn: () =>
      fetch(`${API}/api/backtest/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, strategy, startDate, endDate }),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backtest"] });
    },
  });

  const results: BacktestResult[] = resultsData?.data || [];

  return (
    <div style={{ background: "#0e0e0f", color: "#ffffff", minHeight: "100vh", padding: "24px" }}>
      <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", marginBottom: "24px" }}>
        Backtesting Engine
      </h1>

      {/* Controls Card */}
      <div
        style={{
          backgroundColor: "#1a191b",
          border: "1px solid rgba(72,72,73,0.2)",
          borderRadius: "12px",
          padding: "24px",
          marginBottom: "24px",
        }}
      >
        <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", marginBottom: "16px" }}>
          Run Backtest
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "12px" }}>
          <div>
            <label style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576" }}>
              Symbol
            </label>
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              style={{
                width: "100%",
                padding: "8px",
                marginTop: "4px",
                background: "#0e0e0f",
                color: "#ffffff",
                border: "1px solid rgba(72,72,73,0.2)",
                borderRadius: "6px",
                fontFamily: "JetBrains Mono, monospace",
              }}
            />
          </div>
          <div>
            <label style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576" }}>
              Strategy
            </label>
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
              style={{
                width: "100%",
                padding: "8px",
                marginTop: "4px",
                background: "#0e0e0f",
                color: "#ffffff",
                border: "1px solid rgba(72,72,73,0.2)",
                borderRadius: "6px",
                fontFamily: "JetBrains Mono, monospace",
              }}
            >
              <option>breakout</option>
              <option>mean-reversion</option>
              <option>momentum</option>
              <option>arb</option>
            </select>
          </div>
          <div>
            <label style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576" }}>
              Start
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={{
                width: "100%",
                padding: "8px",
                marginTop: "4px",
                background: "#0e0e0f",
                color: "#ffffff",
                border: "1px solid rgba(72,72,73,0.2)",
                borderRadius: "6px",
              }}
            />
          </div>
          <div>
            <label style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576" }}>
              End
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              style={{
                width: "100%",
                padding: "8px",
                marginTop: "4px",
                background: "#0e0e0f",
                color: "#ffffff",
                border: "1px solid rgba(72,72,73,0.2)",
                borderRadius: "6px",
              }}
            />
          </div>
        </div>
        <button
          onClick={() => runMutation.mutate()}
          disabled={runMutation.isPending}
          style={{
            marginTop: "16px",
            padding: "10px 20px",
            background: "#9cff93",
            color: "#0e0e0f",
            border: "none",
            borderRadius: "6px",
            fontFamily: "Space Grotesk",
            fontWeight: "bold",
            cursor: runMutation.isPending ? "not-allowed" : "pointer",
            opacity: runMutation.isPending ? 0.6 : 1,
          }}
        >
          {runMutation.isPending ? "Running..." : "Run Backtest"}
        </button>
      </div>

      {/* Results Table */}
      <div
        style={{
          backgroundColor: "#1a191b",
          border: "1px solid rgba(72,72,73,0.2)",
          borderRadius: "12px",
          padding: "24px",
          overflowX: "auto",
        }}
      >
        <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", marginBottom: "16px" }}>
          Results
        </h2>
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
              <th style={{ padding: "8px", textAlign: "left", color: "#767576" }}>Strategy</th>
              <th style={{ padding: "8px", textAlign: "right", color: "#767576" }}>P.F.</th>
              <th style={{ padding: "8px", textAlign: "right", color: "#767576" }}>Sharpe</th>
              <th style={{ padding: "8px", textAlign: "right", color: "#767576" }}>Win %</th>
              <th style={{ padding: "8px", textAlign: "right", color: "#767576" }}>Max DD</th>
              <th style={{ padding: "8px", textAlign: "right", color: "#767576" }}>Trades</th>
              <th style={{ padding: "8px", textAlign: "right", color: "#767576" }}>Expect.</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i} style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                <td style={{ padding: "8px", color: "#9cff93" }}>{r.strategy}</td>
                <td style={{ padding: "8px", textAlign: "right" }}>{r.profitFactor.toFixed(2)}</td>
                <td style={{ padding: "8px", textAlign: "right" }}>{r.sharpe.toFixed(2)}</td>
                <td style={{ padding: "8px", textAlign: "right" }}>
                  {(r.winRate * 100).toFixed(1)}%
                </td>
                <td style={{ padding: "8px", textAlign: "right" }}>
                  <span style={{ color: "#ff6b6b" }}>{(r.maxDD * 100).toFixed(1)}%</span>
                </td>
                <td style={{ padding: "8px", textAlign: "right" }}>{r.totalTrades}</td>
                <td style={{ padding: "8px", textAlign: "right" }}>${r.expectancy.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
