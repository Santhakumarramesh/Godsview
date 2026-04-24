import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

type SuggestedTrade = {
  trade_id: string;
  symbol: string;
  direction: "long" | "short";
  quantity: number;
  signal_reason: string;
  confidence: number;
  estimated_entry: number;
  risk_score: number;
  timestamp: string;
};

export default function AssistedTradingPage() {
  const queryClient = useQueryClient();
  const [selectedTrade, setSelectedTrade] = useState<string | null>(null);

  const { data: executionData, isLoading } = useQuery({
    queryKey: ["execution-status"],
    queryFn: () => fetch(`${API}/api/execution-status`).then((r) => r.json()),
    refetchInterval: 5000,
  });

  const { data: signalsData } = useQuery({
    queryKey: ["signals", "latest"],
    queryFn: () => fetch(`${API}/api/signals/latest`).then((r) => r.json()),
    refetchInterval: 5000,
  });

  const approveTradeMutation = useMutation({
    mutationFn: (tradeId: string) =>
      fetch(`${API}/api/execution/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trade_id: tradeId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["execution-status"] });
      setSelectedTrade(null);
    },
  });

  const rejectTradeMutation = useMutation({
    mutationFn: (tradeId: string) =>
      fetch(`${API}/api/execution/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trade_id: tradeId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["execution-status"] });
      setSelectedTrade(null);
    },
  });

  if (isLoading) {
    return <div style={{ padding: "32px", color: "#767576" }}>Loading trades...</div>;
  }

  const trades: SuggestedTrade[] = signalsData?.signals || [];

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
        Assisted Live Trading
      </h1>

      <div
        style={{
          backgroundColor: "#1a191b",
          border: "1px solid rgba(72,72,73,0.2)",
          borderRadius: "12px",
          padding: "24px",
          marginBottom: "32px",
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "24px" }}>
          <div>
            <div style={{ fontSize: "12px", color: "#767576", fontFamily: "Space Grotesk" }}>Pending Approvals</div>
            <div
              style={{
                fontSize: "32px",
                fontWeight: "600",
                color: trades.length > 0 ? "#ffd93d" : "#9cff93",
                marginTop: "8px",
                fontFamily: "JetBrains Mono, monospace",
              }}
            >
              {trades.length}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "#767576", fontFamily: "Space Grotesk" }}>Avg Confidence</div>
            <div
              style={{
                fontSize: "32px",
                fontWeight: "600",
                color: "#9cff93",
                marginTop: "8px",
                fontFamily: "JetBrains Mono, monospace",
              }}
            >
              {(trades.reduce((a, t) => a + t.confidence, 0) / Math.max(trades.length, 1) * 100).toFixed(1)}%
            </div>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "#767576", fontFamily: "Space Grotesk" }}>Avg Risk</div>
            <div
              style={{
                fontSize: "32px",
                fontWeight: "600",
                color: trades.some(t => t.risk_score > 7) ? "#ff8a8a" : "#9cff93",
                marginTop: "8px",
                fontFamily: "JetBrains Mono, monospace",
              }}
            >
              {(trades.reduce((a, t) => a + t.risk_score, 0) / Math.max(trades.length, 1)).toFixed(1)}
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
        Approval Queue
      </h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
          gap: "16px",
        }}
      >
        {trades.map((trade) => (
          <div
            key={trade.trade_id}
            style={{
              backgroundColor: selectedTrade === trade.trade_id ? "#2a291d" : "#1a191b",
              border:
                selectedTrade === trade.trade_id
                  ? "2px solid #9cff93"
                  : "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "24px",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
            onClick={() => setSelectedTrade(selectedTrade === trade.trade_id ? null : trade.trade_id)}
          >
            <div style={{ marginBottom: "12px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "8px",
                }}
              >
                <div
                  style={{
                    fontSize: "16px",
                    fontWeight: "600",
                    color: "#ffffff",
                    fontFamily: "JetBrains Mono, monospace",
                  }}
                >
                  {trade.symbol}
                </div>
                <div
                  style={{
                    backgroundColor: trade.direction === "long" ? "#2d5a2d" : "#5a2d2d",
                    color: trade.direction === "long" ? "#9cff93" : "#ff8a8a",
                    padding: "4px 8px",
                    borderRadius: "4px",
                    fontSize: "10px",
                    fontWeight: "600",
                    fontFamily: "Space Grotesk",
                  }}
                >
                  {trade.direction.toUpperCase()}
                </div>
              </div>
              <div style={{ fontSize: "11px", color: "#767576" }}>
                {new Date(trade.timestamp).toLocaleTimeString()}
              </div>
            </div>

            <div style={{ marginBottom: "12px" }}>
              <div style={{ fontSize: "11px", color: "#767576", marginBottom: "4px", fontFamily: "Space Grotesk" }}>
                Signal
              </div>
              <div style={{ fontSize: "12px", color: "#ffffff" }}>
                {trade.signal_reason}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
              <div>
                <div style={{ fontSize: "10px", color: "#767576", marginBottom: "2px", fontFamily: "Space Grotesk" }}>
                  Confidence
                </div>
                <div style={{ fontSize: "14px", fontWeight: "600", color: "#9cff93", fontFamily: "JetBrains Mono, monospace" }}>
                  {(trade.confidence * 100).toFixed(0)}%
                </div>
              </div>
              <div>
                <div style={{ fontSize: "10px", color: "#767576", marginBottom: "2px", fontFamily: "Space Grotesk" }}>
                  Risk Score
                </div>
                <div
                  style={{
                    fontSize: "14px",
                    fontWeight: "600",
                    color: trade.risk_score > 7 ? "#ff8a8a" : trade.risk_score > 5 ? "#ffd93d" : "#9cff93",
                    fontFamily: "JetBrains Mono, monospace",
                  }}
                >
                  {trade.risk_score.toFixed(1)}/10
                </div>
              </div>
            </div>

            <div style={{ marginBottom: "12px" }}>
              <div style={{ fontSize: "10px", color: "#767576", marginBottom: "4px", fontFamily: "Space Grotesk" }}>
                Entry: {trade.estimated_entry.toFixed(2)} | Qty: {trade.quantity}
              </div>
            </div>

            {selectedTrade === trade.trade_id && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    approveTradeMutation.mutate(trade.trade_id);
                  }}
                  style={{
                    backgroundColor: "#9cff93",
                    border: "none",
                    color: "#0e0e0f",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    fontWeight: "600",
                    cursor: "pointer",
                    fontSize: "11px",
                    fontFamily: "Space Grotesk",
                  }}
                >
                  Approve
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    rejectTradeMutation.mutate(trade.trade_id);
                  }}
                  style={{
                    backgroundColor: "#ff8a8a",
                    border: "none",
                    color: "#0e0e0f",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    fontWeight: "600",
                    cursor: "pointer",
                    fontSize: "11px",
                    fontFamily: "Space Grotesk",
                  }}
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {trades.length === 0 && (
        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "48px 24px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "14px", color: "#767576" }}>No pending trades for approval</div>
        </div>
      )}
    </div>
  );
}
