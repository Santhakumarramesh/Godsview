import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

type ExecutionStat = {
  symbol: string;
  order_type: "limit" | "market";
  expected_price: number;
  actual_price: number;
  slippage_bps: number;
  quantity: number;
  latency_ms: number;
  fill_percentage: number;
  timestamp: string;
};

type SlippageStats = {
  avg_slippage_bps: number;
  fill_rate: number;
  partial_fill_rate: number;
  latency_p50: number;
  latency_p99: number;
  best_execution_rate: number;
};

export default function SlippageQualityPage() {
  const { data: executionData, isLoading } = useQuery({
    queryKey: ["analytics", "execution"],
    queryFn: () => fetch(`${API}/api/analytics/execution`).then((r) => r.json()),
    refetchInterval: 15000,
  });

  const { data: tradesData } = useQuery({
    queryKey: ["trades"],
    queryFn: () => fetch(`${API}/api/trades?limit=50`).then((r) => r.json()),
    refetchInterval: 15000,
  });

  if (isLoading) {
    return <div style={{ padding: "32px", color: "#767576" }}>Loading execution data...</div>;
  }

  const stats: SlippageStats = executionData?.stats || {
    avg_slippage_bps: 0,
    fill_rate: 0,
    partial_fill_rate: 0,
    latency_p50: 0,
    latency_p99: 0,
    best_execution_rate: 0,
  };

  const fills: ExecutionStat[] = tradesData?.fills || [];

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
        Slippage & Fill Quality
      </h1>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "16px", marginBottom: "32px" }}>
        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <div style={{ fontSize: "11px", color: "#767576", fontFamily: "Space Grotesk" }}>Avg Slippage</div>
          <div
            style={{
              fontSize: "24px",
              fontWeight: "600",
              color: stats.avg_slippage_bps > 5 ? "#ff8a8a" : stats.avg_slippage_bps > 2 ? "#ffd93d" : "#9cff93",
              marginTop: "8px",
              fontFamily: "JetBrains Mono, monospace",
            }}
          >
            {stats.avg_slippage_bps.toFixed(2)}bp
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
          <div style={{ fontSize: "11px", color: "#767576", fontFamily: "Space Grotesk" }}>Fill Rate</div>
          <div
            style={{
              fontSize: "24px",
              fontWeight: "600",
              color: stats.fill_rate > 0.95 ? "#9cff93" : stats.fill_rate > 0.8 ? "#ffd93d" : "#ff8a8a",
              marginTop: "8px",
              fontFamily: "JetBrains Mono, monospace",
            }}
          >
            {(stats.fill_rate * 100).toFixed(1)}%
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
          <div style={{ fontSize: "11px", color: "#767576", fontFamily: "Space Grotesk" }}>Partial Fills</div>
          <div
            style={{
              fontSize: "24px",
              fontWeight: "600",
              color: stats.partial_fill_rate > 0.2 ? "#ffd93d" : "#9cff93",
              marginTop: "8px",
              fontFamily: "JetBrains Mono, monospace",
            }}
          >
            {(stats.partial_fill_rate * 100).toFixed(1)}%
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
          <div style={{ fontSize: "11px", color: "#767576", fontFamily: "Space Grotesk" }}>P50 Latency</div>
          <div
            style={{
              fontSize: "24px",
              fontWeight: "600",
              color: "#9cff93",
              marginTop: "8px",
              fontFamily: "JetBrains Mono, monospace",
            }}
          >
            {stats.latency_p50.toFixed(0)}ms
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
          <div style={{ fontSize: "11px", color: "#767576", fontFamily: "Space Grotesk" }}>P99 Latency</div>
          <div
            style={{
              fontSize: "24px",
              fontWeight: "600",
              color: stats.latency_p99 > 100 ? "#ffd93d" : "#9cff93",
              marginTop: "8px",
              fontFamily: "JetBrains Mono, monospace",
            }}
          >
            {stats.latency_p99.toFixed(0)}ms
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
        Recent Fills Detail
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
            minWidth: "1100px",
          }}
        >
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
              <th style={{ textAlign: "left", padding: "12px", color: "#767576" }}>Time</th>
              <th style={{ textAlign: "left", padding: "12px", color: "#767576" }}>Symbol</th>
              <th style={{ textAlign: "center", padding: "12px", color: "#767576" }}>Type</th>
              <th style={{ textAlign: "right", padding: "12px", color: "#767576" }}>Expected</th>
              <th style={{ textAlign: "right", padding: "12px", color: "#767576" }}>Actual</th>
              <th style={{ textAlign: "right", padding: "12px", color: "#767576" }}>Slippage</th>
              <th style={{ textAlign: "right", padding: "12px", color: "#767576" }}>Qty</th>
              <th style={{ textAlign: "right", padding: "12px", color: "#767576" }}>Fill %</th>
              <th style={{ textAlign: "right", padding: "12px", color: "#767576" }}>Latency</th>
            </tr>
          </thead>
          <tbody>
            {fills.slice(0, 20).map((fill) => (
              <tr key={`${fill.timestamp}-${fill.symbol}`} style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                <td style={{ padding: "12px", color: "#767576", fontSize: "11px" }}>
                  {new Date(fill.timestamp).toLocaleTimeString()}
                </td>
                <td style={{ padding: "12px", color: "#ffffff", fontWeight: "600" }}>{fill.symbol}</td>
                <td
                  style={{
                    padding: "12px",
                    textAlign: "center",
                    backgroundColor:
                      fill.order_type === "market"
                        ? "rgba(255, 217, 61, 0.1)"
                        : "rgba(156, 255, 147, 0.1)",
                    color: fill.order_type === "market" ? "#ffd93d" : "#9cff93",
                    borderRadius: "4px",
                  }}
                >
                  {fill.order_type.toUpperCase()}
                </td>
                <td style={{ padding: "12px", textAlign: "right", color: "#ffffff" }}>
                  {fill.expected_price.toFixed(2)}
                </td>
                <td style={{ padding: "12px", textAlign: "right", color: "#ffffff" }}>
                  {fill.actual_price.toFixed(2)}
                </td>
                <td
                  style={{
                    padding: "12px",
                    textAlign: "right",
                    color:
                      fill.slippage_bps > 5
                        ? "#ff8a8a"
                        : fill.slippage_bps > 2
                          ? "#ffd93d"
                          : "#9cff93",
                  }}
                >
                  {fill.slippage_bps.toFixed(2)}bp
                </td>
                <td style={{ padding: "12px", textAlign: "right", color: "#ffffff" }}>
                  {fill.quantity}
                </td>
                <td
                  style={{
                    padding: "12px",
                    textAlign: "right",
                    color: fill.fill_percentage === 1 ? "#9cff93" : fill.fill_percentage > 0.8 ? "#ffd93d" : "#ff8a8a",
                  }}
                >
                  {(fill.fill_percentage * 100).toFixed(1)}%
                </td>
                <td
                  style={{
                    padding: "12px",
                    textAlign: "right",
                    color: fill.latency_ms > 100 ? "#ffd93d" : "#9cff93",
                  }}
                >
                  {fill.latency_ms}ms
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2
        style={{
          fontSize: "18px",
          fontWeight: "600",
          color: "#ffffff",
          marginTop: "32px",
          marginBottom: "16px",
          fontFamily: "Space Grotesk",
        }}
      >
        Execution Quality Summary
      </h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "16px",
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
          <div style={{ fontSize: "12px", color: "#767576", marginBottom: "12px", fontFamily: "Space Grotesk" }}>
            Best Execution Rate
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: "12px",
            }}
          >
            <div
              style={{
                fontSize: "32px",
                fontWeight: "600",
                color: stats.best_execution_rate > 0.7 ? "#9cff93" : stats.best_execution_rate > 0.5 ? "#ffd93d" : "#ff8a8a",
                fontFamily: "JetBrains Mono, monospace",
              }}
            >
              {(stats.best_execution_rate * 100).toFixed(1)}%
            </div>
            <div style={{ fontSize: "12px", color: "#767576" }}>of fills</div>
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
          <div style={{ fontSize: "12px", color: "#767576", marginBottom: "12px", fontFamily: "Space Grotesk" }}>
            Total Fills
          </div>
          <div
            style={{
              fontSize: "32px",
              fontWeight: "600",
              color: "#9cff93",
              fontFamily: "JetBrains Mono, monospace",
            }}
          >
            {fills.length}
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
          <div style={{ fontSize: "12px", color: "#767576", marginBottom: "12px", fontFamily: "Space Grotesk" }}>
            Latency Range
          </div>
          <div style={{ fontSize: "14px", color: "#9cff93", fontFamily: "JetBrains Mono, monospace" }}>
            {stats.latency_p50.toFixed(0)}ms - {stats.latency_p99.toFixed(0)}ms
          </div>
        </div>
      </div>
    </div>
  );
}
