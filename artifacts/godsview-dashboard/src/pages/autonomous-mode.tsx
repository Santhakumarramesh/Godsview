import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

type TrustedStrategy = {
  strategy_id: string;
  is_trusted: boolean;
  consecutive_wins: number;
  allowed_auto_trades: number;
  circuit_breaker_active: boolean;
};

type AutonomyStatus = {
  autonomy_tier: "candidate" | "trusted" | "master";
  restrictions: string[];
  current_auto_actions: number;
  max_allowed_auto_actions: number;
  consecutive_wins: number;
  circuit_breaker_state: "off" | "warning" | "triggered";
  trusted_strategies: TrustedStrategy[];
  safety_score: number;
};

export default function AutonomousModePage() {
  const { data: autonomyData, isLoading } = useQuery({
    queryKey: ["autonomous", "status"],
    queryFn: () => fetch(`${API}/api/autonomous/status`).then((r) => r.json()),
    refetchInterval: 10000,
  });

  const { data: governanceData } = useQuery({
    queryKey: ["governance", "status"],
    queryFn: () => fetch(`${API}/api/governance/status`).then((r) => r.json()),
    refetchInterval: 10000,
  });

  if (isLoading) {
    return <div style={{ padding: "32px", color: "#767576" }}>Loading autonomy status...</div>;
  }

  const autonomy: AutonomyStatus = autonomyData?.autonomy || {
    autonomy_tier: "candidate",
    restrictions: [],
    current_auto_actions: 0,
    max_allowed_auto_actions: 0,
    consecutive_wins: 0,
    circuit_breaker_state: "off",
    trusted_strategies: [],
    safety_score: 0,
  };

  const tierColors = {
    candidate: { bg: "#1a191b", border: "rgba(156, 255, 147, 0.2)", color: "#9cff93" },
    trusted: { bg: "#1a3a1a", border: "rgba(156, 255, 147, 0.3)", color: "#7fff7f" },
    master: { bg: "#2d5a2d", border: "rgba(156, 255, 147, 0.4)", color: "#5fff5f" },
  };

  const tierColor = tierColors[autonomy.autonomy_tier];

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
        Autonomous Candidate Mode
      </h1>

      <div
        style={{
          backgroundColor: tierColor.bg,
          border: `2px solid ${tierColor.border}`,
          borderRadius: "12px",
          padding: "32px",
          marginBottom: "32px",
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "24px" }}>
          <div>
            <div style={{ fontSize: "12px", color: "#767576", fontFamily: "Space Grotesk" }}>Autonomy Tier</div>
            <div
              style={{
                fontSize: "24px",
                fontWeight: "600",
                color: tierColor.color,
                marginTop: "8px",
                fontFamily: "Space Grotesk",
              }}
            >
              {autonomy.autonomy_tier.toUpperCase()}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "#767576", fontFamily: "Space Grotesk" }}>Consecutive Wins</div>
            <div
              style={{
                fontSize: "24px",
                fontWeight: "600",
                color: "#9cff93",
                marginTop: "8px",
                fontFamily: "JetBrains Mono, monospace",
              }}
            >
              {autonomy.consecutive_wins}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "#767576", fontFamily: "Space Grotesk" }}>Safety Score</div>
            <div
              style={{
                fontSize: "24px",
                fontWeight: "600",
                color: autonomy.safety_score > 0.8 ? "#2d5a2d" : autonomy.safety_score > 0.6 ? "#9cff93" : "#ffd93d",
                marginTop: "8px",
                fontFamily: "JetBrains Mono, monospace",
              }}
            >
              {(autonomy.safety_score * 100).toFixed(1)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "#767576", fontFamily: "Space Grotesk" }}>Circuit Breaker</div>
            <div
              style={{
                fontSize: "14px",
                fontWeight: "600",
                color:
                  autonomy.circuit_breaker_state === "triggered"
                    ? "#ff6b6b"
                    : autonomy.circuit_breaker_state === "warning"
                      ? "#ffd93d"
                      : "#9cff93",
                marginTop: "8px",
                fontFamily: "Space Grotesk",
              }}
            >
              {autonomy.circuit_breaker_state.toUpperCase()}
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
        Current Restrictions
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
        {autonomy.restrictions.length === 0 ? (
          <div style={{ color: "#767576" }}>No active restrictions</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "12px" }}>
            {autonomy.restrictions.map((restriction) => (
              <div
                key={restriction}
                style={{
                  backgroundColor: "#0e0e0f",
                  border: "1px solid rgba(255, 138, 138, 0.2)",
                  borderRadius: "8px",
                  padding: "12px",
                  color: "#ff8a8a",
                  fontSize: "11px",
                  fontFamily: "Space Grotesk",
                }}
              >
                • {restriction}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "32px", marginBottom: "32px" }}>
        <div>
          <h2
            style={{
              fontSize: "18px",
              fontWeight: "600",
              color: "#ffffff",
              marginBottom: "16px",
              fontFamily: "Space Grotesk",
            }}
          >
            Auto Action Quota
          </h2>
          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            <div style={{ marginBottom: "16px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: "8px",
                  fontFamily: "Space Grotesk",
                }}
              >
                <span style={{ fontSize: "13px", color: "#ffffff" }}>Used / Allowed</span>
                <span
                  style={{
                    fontSize: "13px",
                    color: "#9cff93",
                    fontFamily: "JetBrains Mono, monospace",
                  }}
                >
                  {autonomy.current_auto_actions} / {autonomy.max_allowed_auto_actions}
                </span>
              </div>
              <div
                style={{
                  height: "16px",
                  backgroundColor: "rgba(72,72,73,0.2)",
                  borderRadius: "8px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    backgroundColor:
                      autonomy.current_auto_actions > autonomy.max_allowed_auto_actions * 0.8
                        ? "#ffd93d"
                        : "#9cff93",
                    width: `${Math.min(
                      (autonomy.current_auto_actions / autonomy.max_allowed_auto_actions) * 100,
                      100
                    )}%`,
                  }}
                />
              </div>
            </div>

            <div style={{ fontSize: "11px", color: "#767576" }}>
              Remaining: {Math.max(0, autonomy.max_allowed_auto_actions - autonomy.current_auto_actions)} trades
            </div>
          </div>
        </div>

        <div>
          <h2
            style={{
              fontSize: "18px",
              fontWeight: "600",
              color: "#ffffff",
              marginBottom: "16px",
              fontFamily: "Space Grotesk",
            }}
          >
            Safety Metrics
          </h2>
          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            <div style={{ marginBottom: "16px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: "8px",
                  fontFamily: "Space Grotesk",
                }}
              >
                <span style={{ fontSize: "13px", color: "#ffffff" }}>Safety Score</span>
                <span
                  style={{
                    fontSize: "13px",
                    color:
                      autonomy.safety_score > 0.8
                        ? "#2d5a2d"
                        : autonomy.safety_score > 0.6
                          ? "#9cff93"
                          : "#ffd93d",
                    fontFamily: "JetBrains Mono, monospace",
                  }}
                >
                  {(autonomy.safety_score * 100).toFixed(1)}
                </span>
              </div>
              <div
                style={{
                  height: "16px",
                  backgroundColor: "rgba(72,72,73,0.2)",
                  borderRadius: "8px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    backgroundColor:
                      autonomy.safety_score > 0.8
                        ? "#2d5a2d"
                        : autonomy.safety_score > 0.6
                          ? "#9cff93"
                          : "#ffd93d",
                    width: `${autonomy.safety_score * 100}%`,
                  }}
                />
              </div>
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
        Trusted Strategies
      </h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: "16px",
        }}
      >
        {autonomy.trusted_strategies.map((strategy) => (
          <div
            key={strategy.strategy_id}
            style={{
              backgroundColor: "#1a191b",
              border: strategy.is_trusted ? "1px solid rgba(156, 255, 147, 0.2)" : "1px solid rgba(255, 138, 138, 0.2)",
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "12px",
              }}
            >
              <div style={{ fontSize: "13px", color: "#ffffff", fontWeight: "600", fontFamily: "Space Grotesk" }}>
                {strategy.strategy_id}
              </div>
              <div
                style={{
                  backgroundColor: strategy.is_trusted ? "#2d5a2d" : "#5a2d2d",
                  color: strategy.is_trusted ? "#9cff93" : "#ff8a8a",
                  padding: "4px 8px",
                  borderRadius: "4px",
                  fontSize: "10px",
                  fontWeight: "600",
                  fontFamily: "Space Grotesk",
                }}
              >
                {strategy.is_trusted ? "TRUSTED" : "UNTRUSTED"}
              </div>
            </div>

            <div style={{ marginBottom: "12px" }}>
              <div style={{ fontSize: "11px", color: "#767576", marginBottom: "4px", fontFamily: "Space Grotesk" }}>
                Consecutive Wins
              </div>
              <div
                style={{
                  fontSize: "16px",
                  fontWeight: "600",
                  color: "#9cff93",
                  fontFamily: "JetBrains Mono, monospace",
                }}
              >
                {strategy.consecutive_wins}
              </div>
            </div>

            <div>
              <div style={{ fontSize: "11px", color: "#767576", marginBottom: "4px", fontFamily: "Space Grotesk" }}>
                Max Auto-Trades
              </div>
              <div
                style={{
                  fontSize: "16px",
                  fontWeight: "600",
                  color: "#767576",
                  fontFamily: "JetBrains Mono, monospace",
                }}
              >
                {strategy.allowed_auto_trades}
              </div>
            </div>

            {strategy.circuit_breaker_active && (
              <div
                style={{
                  marginTop: "12px",
                  padding: "8px",
                  backgroundColor: "rgba(255, 107, 107, 0.1)",
                  borderRadius: "6px",
                  border: "1px solid rgba(255, 107, 107, 0.2)",
                  textAlign: "center",
                  fontSize: "10px",
                  color: "#ff6b6b",
                  fontFamily: "Space Grotesk",
                }}
              >
                CIRCUIT BREAKER ACTIVE
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
