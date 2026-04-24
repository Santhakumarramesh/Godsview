import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

type Session = {
  state: "premarket" | "live" | "after-hours";
  activeSymbols: string[];
  startTime: string;
  endTime: string;
};

type ExecutionMode = {
  mode: string;
  enabled: boolean;
  lastChange: string;
};

export default function SessionControlPage() {
  const queryClient = useQueryClient();
  const [selectedMode, setSelectedMode] = useState("live");

  const { data: sessionsData } = useQuery({
    queryKey: ["sessions"],
    queryFn: () => fetch(`${API}/api/sessions`).then((r) => r.json()),
    refetchInterval: 5000,
  });

  const { data: executionData } = useQuery({
    queryKey: ["execution", "mode"],
    queryFn: () => fetch(`${API}/api/execution/mode`).then((r) => r.json()),
    refetchInterval: 10000,
  });

  const modeMutation = useMutation({
    mutationFn: (mode: string) =>
      fetch(`${API}/api/execution/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["execution"] });
    },
  });

  const session: Session = sessionsData?.data || {};
  const execution: ExecutionMode = executionData?.data || {};

  const sessionColor = (state: string) => {
    if (state === "live") return "#9cff93";
    if (state === "premarket") return "#ffd700";
    return "#767576";
  };

  return (
    <div style={{ background: "#0e0e0f", color: "#ffffff", minHeight: "100vh", padding: "24px" }}>
      <h1 style={{ fontFamily: "Space Grotesk", fontSize: "28px", marginBottom: "24px" }}>
        Session Control
      </h1>

      {/* Session State */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "24px" }}>
        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576", marginBottom: "8px" }}>
            Session State
          </p>
          <p
            style={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize: "24px",
              fontWeight: "bold",
              color: sessionColor(session.state),
            }}
          >
            {session.state?.toUpperCase()}
          </p>
        </div>

        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576", marginBottom: "8px" }}>
            Execution Mode
          </p>
          <p
            style={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize: "18px",
              color: execution.enabled ? "#9cff93" : "#ff6b6b",
            }}
          >
            {execution.mode || "---"}
          </p>
        </div>
      </div>

      {/* Session Times */}
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
          Session Schedule
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <div>
            <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576" }}>Start</p>
            <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "16px", marginTop: "4px" }}>
              {session.startTime || "---"}
            </p>
          </div>
          <div>
            <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576" }}>End</p>
            <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "16px", marginTop: "4px" }}>
              {session.endTime || "---"}
            </p>
          </div>
        </div>
      </div>

      {/* Active Symbols */}
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
          Active Symbols ({session.activeSymbols?.length || 0})
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))", gap: "12px" }}>
          {session.activeSymbols?.map((sym) => (
            <div
              key={sym}
              style={{
                backgroundColor: "#0e0e0f",
                border: "1px solid rgba(156,255,147,0.3)",
                borderRadius: "8px",
                padding: "12px",
                textAlign: "center",
                fontFamily: "JetBrains Mono, monospace",
                fontWeight: "bold",
                color: "#9cff93",
              }}
            >
              {sym}
            </div>
          ))}
        </div>
      </div>

      {/* Mode Controls */}
      <div
        style={{
          backgroundColor: "#1a191b",
          border: "1px solid rgba(72,72,73,0.2)",
          borderRadius: "12px",
          padding: "24px",
        }}
      >
        <h2 style={{ fontFamily: "Space Grotesk", fontSize: "16px", marginBottom: "16px" }}>
          Mode Control
        </h2>
        <div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
          {["live", "paper", "backtest"].map((mode) => (
            <button
              key={mode}
              onClick={() => setSelectedMode(mode)}
              style={{
                padding: "10px 16px",
                background: selectedMode === mode ? "#9cff93" : "#0e0e0f",
                color: selectedMode === mode ? "#0e0e0f" : "#9cff93",
                border: "1px solid rgba(156,255,147,0.3)",
                borderRadius: "6px",
                fontFamily: "Space Grotesk",
                fontWeight: "bold",
                cursor: "pointer",
              }}
            >
              {mode.toUpperCase()}
            </button>
          ))}
        </div>
        <button
          onClick={() => modeMutation.mutate(selectedMode)}
          disabled={modeMutation.isPending}
          style={{
            padding: "12px 24px",
            background: "#9cff93",
            color: "#0e0e0f",
            border: "none",
            borderRadius: "6px",
            fontFamily: "Space Grotesk",
            fontWeight: "bold",
            cursor: modeMutation.isPending ? "not-allowed" : "pointer",
            opacity: modeMutation.isPending ? 0.6 : 1,
          }}
        >
          {modeMutation.isPending ? "Switching..." : "Switch Mode"}
        </button>
      </div>
    </div>
  );
}
