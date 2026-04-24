import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

type ErrorFrequency = {
  error_type: string;
  count: number;
  last_occurrence: string;
  fix_applied?: boolean;
};

type Improvement = {
  id: string;
  suggestion: string;
  adoption_rate: number;
  net_pnl_impact: number;
  status: "pending" | "active" | "deprecated";
};

type FeedbackLoopStats = {
  total_feedback_items: number;
  processed_rate: number;
  avg_improvement_time_hours: number;
  model_drift_score: number;
};

export default function LearningLoopPage() {
  const { data: errors, isLoading: errorsLoading } = useQuery({
    queryKey: ["learning", "feedback"],
    queryFn: () => fetch(`${API}/api/learning/feedback`).then((r) => r.json()),
    refetchInterval: 30000,
  });

  const { data: improvements, isLoading: improvementsLoading } = useQuery({
    queryKey: ["learning", "improvements"],
    queryFn: () =>
      fetch(`${API}/api/learning/improvements`).then((r) => r.json()),
    refetchInterval: 30000,
  });

  const { data: stats } = useQuery({
    queryKey: ["learning", "stats"],
    queryFn: () =>
      fetch(`${API}/api/learning/stats`).then((r) => r.json()),
    refetchInterval: 30000,
  });

  if (errorsLoading || improvementsLoading) {
    return (
      <div style={{ padding: "32px" }}>
        <div style={{ color: "#767576" }}>Loading learning loop data...</div>
      </div>
    );
  }

  const errorList: ErrorFrequency[] = errors?.errors || [];
  const improvementList: Improvement[] = improvements?.improvements || [];
  const loopStats: FeedbackLoopStats = stats?.stats || {
    total_feedback_items: 0,
    processed_rate: 0,
    avg_improvement_time_hours: 0,
    model_drift_score: 0,
  };

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
        Learning Loop Dashboard
      </h1>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "32px" }}>
        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <div style={{ fontSize: "12px", color: "#767576", fontFamily: "Space Grotesk" }}>Feedback Items</div>
          <div
            style={{
              fontSize: "32px",
              fontWeight: "600",
              color: "#9cff93",
              marginTop: "8px",
              fontFamily: "JetBrains Mono, monospace",
            }}
          >
            {loopStats.total_feedback_items}
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
          <div style={{ fontSize: "12px", color: "#767576", fontFamily: "Space Grotesk" }}>Processed Rate</div>
          <div
            style={{
              fontSize: "32px",
              fontWeight: "600",
              color: "#9cff93",
              marginTop: "8px",
              fontFamily: "JetBrains Mono, monospace",
            }}
          >
            {(loopStats.processed_rate * 100).toFixed(1)}%
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
          <div style={{ fontSize: "12px", color: "#767576", fontFamily: "Space Grotesk" }}>Avg Improvement Time</div>
          <div
            style={{
              fontSize: "32px",
              fontWeight: "600",
              color: "#9cff93",
              marginTop: "8px",
              fontFamily: "JetBrains Mono, monospace",
            }}
          >
            {loopStats.avg_improvement_time_hours.toFixed(1)}h
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
          <div style={{ fontSize: "12px", color: "#767576", fontFamily: "Space Grotesk" }}>Model Drift Score</div>
          <div
            style={{
              fontSize: "32px",
              fontWeight: "600",
              color: loopStats.model_drift_score > 0.7 ? "#ff6b6b" : "#9cff93",
              marginTop: "8px",
              fontFamily: "JetBrains Mono, monospace",
            }}
          >
            {(loopStats.model_drift_score * 100).toFixed(1)}
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
        Recurring Errors
      </h2>
      <div
        style={{
          backgroundColor: "#1a191b",
          border: "1px solid rgba(72,72,73,0.2)",
          borderRadius: "12px",
          padding: "24px",
          marginBottom: "32px",
        }}
      >
        <div style={{ overflowX: "auto" }}>
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
                <th style={{ textAlign: "left", padding: "12px", color: "#767576" }}>Error Type</th>
                <th style={{ textAlign: "left", padding: "12px", color: "#767576" }}>Count</th>
                <th style={{ textAlign: "left", padding: "12px", color: "#767576" }}>Last Occurrence</th>
                <th style={{ textAlign: "left", padding: "12px", color: "#767576" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {errorList.map((err) => (
                <tr key={err.error_type} style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                  <td style={{ padding: "12px", color: "#ffffff" }}>{err.error_type}</td>
                  <td style={{ padding: "12px", color: "#9cff93" }}>{err.count}</td>
                  <td style={{ padding: "12px", color: "#767576" }}>
                    {new Date(err.last_occurrence).toLocaleTimeString()}
                  </td>
                  <td style={{ padding: "12px" }}>
                    <span
                      style={{
                        backgroundColor: err.fix_applied ? "#2d5a2d" : "#5a2d2d",
                        color: err.fix_applied ? "#9cff93" : "#ff8a8a",
                        padding: "4px 8px",
                        borderRadius: "4px",
                        fontSize: "11px",
                      }}
                    >
                      {err.fix_applied ? "Fixed" : "Active"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
        Learned Improvements
      </h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: "16px",
        }}
      >
        {improvementList.map((imp) => (
          <div
            key={imp.id}
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            <div style={{ fontSize: "13px", color: "#ffffff", marginBottom: "8px", fontFamily: "Space Grotesk" }}>
              {imp.suggestion}
            </div>
            <div style={{ marginTop: "16px" }}>
              <div
                style={{
                  fontSize: "11px",
                  color: "#767576",
                  marginBottom: "4px",
                  fontFamily: "Space Grotesk",
                }}
              >
                Adoption Rate
              </div>
              <div
                style={{
                  height: "4px",
                  backgroundColor: "rgba(72,72,73,0.2)",
                  borderRadius: "2px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    backgroundColor: "#9cff93",
                    width: `${imp.adoption_rate * 100}%`,
                  }}
                />
              </div>
              <div
                style={{
                  fontSize: "11px",
                  color: "#767576",
                  marginTop: "4px",
                  fontFamily: "JetBrains Mono, monospace",
                }}
              >
                {(imp.adoption_rate * 100).toFixed(1)}%
              </div>
            </div>
            <div style={{ marginTop: "16px" }}>
              <div
                style={{
                  fontSize: "11px",
                  color: "#767576",
                  marginBottom: "4px",
                  fontFamily: "Space Grotesk",
                }}
              >
                Net PnL Impact
              </div>
              <div
                style={{
                  fontSize: "16px",
                  fontWeight: "600",
                  color: imp.net_pnl_impact > 0 ? "#9cff93" : "#ff8a8a",
                  fontFamily: "JetBrains Mono, monospace",
                }}
              >
                {imp.net_pnl_impact > 0 ? "+" : ""}
                {imp.net_pnl_impact.toFixed(2)}
              </div>
            </div>
            <div style={{ marginTop: "12px" }}>
              <span
                style={{
                  backgroundColor: imp.status === "active" ? "rgba(156, 255, 147, 0.1)" : "rgba(118, 117, 118, 0.1)",
                  color: imp.status === "active" ? "#9cff93" : "#767576",
                  padding: "4px 8px",
                  borderRadius: "4px",
                  fontSize: "11px",
                  fontFamily: "Space Grotesk",
                }}
              >
                {imp.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
