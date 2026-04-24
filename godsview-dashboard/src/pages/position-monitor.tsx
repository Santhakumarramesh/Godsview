import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

type Position = {
  symbol: string;
  direction: "long" | "short";
  entry_price: number;
  current_price: number;
  quantity: number;
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
  mfe: number;
  mae: number;
  duration_minutes: number;
  stop_price: number;
  stop_proximity_pct: number;
  risk_remaining: number;
};

export default function PositionMonitorPage() {
  const { data: positionsData, isLoading } = useQuery({
    queryKey: ["positions"],
    queryFn: () => fetch(`${API}/api/alpaca/positions`).then((r) => r.json()),
    refetchInterval: 5000,
  });

  const { data: executionStatus } = useQuery({
    queryKey: ["execution-status"],
    queryFn: () => fetch(`${API}/api/execution-status`).then((r) => r.json()),
    refetchInterval: 5000,
  });

  if (isLoading) {
    return <div style={{ padding: "32px", color: "#767576" }}>Loading positions...</div>;
  }

  const positions: Position[] = positionsData?.positions || [];

  return (
    <div style={{ padding: "32px", backgroundColor: "#0e0e0f" }}>
      <h1
        style={{
          fontSize: "28px",
          fontWeight: "600",
          color: "#ffffff",
          marginBottom: "32px",
          fontFamily: "Space Grotesk",
        }}
      >
        Position Monitor
      </h1>

      <div style={{ marginBottom: "32px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "16px",
            marginBottom: "32px",
          }}
        >
          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            <div style={{ fontSize: "12px", color: "#767576", fontFamily: "Space Grotesk" }}>Total Positions</div>
            <div
              style={{
                fontSize: "32px",
                fontWeight: "600",
                color: "#9cff93",
                marginTop: "8px",
                fontFamily: "JetBrains Mono, monospace",
              }}
            >
              {positions.length}
            </div>
          </div>
          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            <div style={{ fontSize: "12px", color: "#767576", fontFamily: "Space Grotesk" }}>Total Unrealized P&L</div>
            <div
              style={{
                fontSize: "32px",
                fontWeight: "600",
                color: positions.reduce((a, p) => a + p.unrealized_pnl, 0) > 0 ? "#9cff93" : "#ff8a8a",
                marginTop: "8px",
                fontFamily: "JetBrains Mono, monospace",
              }}
            >
              {positions.reduce((a, p) => a + p.unrealized_pnl, 0).toFixed(2)}
            </div>
          </div>
          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            <div style={{ fontSize: "12px", color: "#767576", fontFamily: "Space Grotesk" }}>Avg Duration</div>
            <div
              style={{
                fontSize: "32px",
                fontWeight: "600",
                color: "#9cff93",
                marginTop: "8px",
                fontFamily: "JetBrains Mono, monospace",
              }}
            >
              {(positions.reduce((a, p) => a + p.duration_minutes, 0) / Math.max(positions.length, 1)).toFixed(0)}m
            </div>
          </div>
        </div>
      </div>

      <h2
        style={{
          fontSize: "18px",
          fontWeight: "600",
          color: "#ffffff",
          marginBottom: "16px",
          fontFamily: "Space Grotesk",
        }}
      >
        Open Positions
      </h2>
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
            fontSize: "12px",
            minWidth: "1200px",
          }}
        >
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
              <th style={{ textAlign: "left", padding: "12px", color: "#767576" }}>Symbol</th>
              <th style={{ textAlign: "right", padding: "12px", color: "#767576" }}>Direction</th>
              <th style={{ textAlign: "right", padding: "12px", color: "#767576" }}>Entry</th>
              <th style={{ textAlign: "right", padding: "12px", color: "#767576" }}>Current</th>
              <th style={{ textAlign: "right", padding: "12px", color: "#767576" }}>Qty</th>
              <th style={{ textAlign: "right", padding: "12px", color: "#767576" }}>P&L</th>
              <th style={{ textAlign: "right", padding: "12px", color: "#767576" }}>P&L %</th>
              <th style={{ textAlign: "right", padding: "12px", color: "#767576" }}>MFE</th>
              <th style={{ textAlign: "right", padding: "12px", color: "#767576" }}>MAE</th>
              <th style={{ textAlign: "right", padding: "12px", color: "#767576" }}>Duration</th>
              <th style={{ textAlign: "right", padding: "12px", color: "#767576" }}>Stop</th>
              <th style={{ textAlign: "right", padding: "12px", color: "#767576" }}>Risk Rem</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((pos) => (
              <tr key={pos.symbol} style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                <td style={{ padding: "12px", color: "#ffffff", fontWeight: "600" }}>{pos.symbol}</td>
                <td
                  style={{
                    padding: "12px",
                    textAlign: "right",
                    color: pos.direction === "long" ? "#9cff93" : "#ff8a8a",
                  }}
                >
                  {pos.direction.toUpperCase()}
                </td>
                <td style={{ padding: "12px", textAlign: "right", color: "#ffffff" }}>
                  {pos.entry_price.toFixed(2)}
                </td>
                <td style={{ padding: "12px", textAlign: "right", color: "#ffffff" }}>
                  {pos.current_price.toFixed(2)}
                </td>
                <td style={{ padding: "12px", textAlign: "right", color: "#ffffff" }}>
                  {pos.quantity}
                </td>
                <td
                  style={{
                    padding: "12px",
                    textAlign: "right",
                    color: pos.unrealized_pnl > 0 ? "#9cff93" : "#ff8a8a",
                  }}
                >
                  {pos.unrealized_pnl > 0 ? "+" : ""}
                  {pos.unrealized_pnl.toFixed(2)}
                </td>
                <td
                  style={{
                    padding: "12px",
                    textAlign: "right",
                    color: pos.unrealized_pnl_pct > 0 ? "#9cff93" : "#ff8a8a",
                  }}
                >
                  {pos.unrealized_pnl_pct > 0 ? "+" : ""}
                  {(pos.unrealized_pnl_pct * 100).toFixed(2)}%
                </td>
                <td style={{ padding: "12px", textAlign: "right", color: "#9cff93" }}>
                  {pos.mfe.toFixed(2)}
                </td>
                <td style={{ padding: "12px", textAlign: "right", color: "#ff8a8a" }}>
                  {pos.mae.toFixed(2)}
                </td>
                <td style={{ padding: "12px", textAlign: "right", color: "#767576" }}>
                  {pos.duration_minutes}m
                </td>
                <td style={{ padding: "12px", textAlign: "right", color: "#ffffff" }}>
                  {pos.stop_price.toFixed(2)}
                </td>
                <td
                  style={{
                    padding: "12px",
                    textAlign: "right",
                    color:
                      pos.stop_proximity_pct > 0.8
                        ? "#ff6b6b"
                        : pos.stop_proximity_pct > 0.5
                          ? "#ffd93d"
                          : "#9cff93",
                  }}
                >
                  {pos.risk_remaining.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
