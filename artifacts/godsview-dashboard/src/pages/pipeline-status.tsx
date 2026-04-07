import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

// ── Design Tokens ──────────────────────────────────────────────────────────
const C = {
  bg: "#0e0e0f",
  card: "#1a191b",
  cardHigh: "#201f21",
  border: "rgba(72,72,73,0.25)",
  primary: "#9cff93",
  secondary: "#669dff",
  tertiary: "#ff7162",
  muted: "#adaaab",
  outline: "#767576",
  outlineVar: "#484849",
  gold: "#fbbf24",
  purple: "#a78bfa",
};

// ── Types ──────────────────────────────────────────────────────────────────
interface PipelineStatus {
  overallHealth: "healthy" | "warning" | "critical";
  timestamp: string;
  subsystems: {
    dataEngine: {
      sourcesActive: number;
      dataQuality: number;
      status: "healthy" | "warning" | "critical";
    };
    mcpIntelligence: {
      signalsProcessed: number;
      approvalRate: number;
      avgLatency: number;
      status: "healthy" | "warning" | "critical";
    };
    execution: {
      mode: "paper" | "live";
      activePositions: number;
      dailyPnL: number;
      status: "healthy" | "warning" | "critical";
    };
    learning: {
      lessonsExtracted: number;
      strategiesByTier: { tier: string; count: number }[];
      status: "healthy" | "warning" | "critical";
    };
    risk: {
      utilization: number;
      circuitBreakerStatus: "armed" | "triggered" | "idle";
      maxDrawdown: number;
      status: "healthy" | "warning" | "critical";
    };
  };
}

interface SignalFlow {
  signalsPerMin: number;
  avgLatency: number;
  approvalRate: number;
  activePositions: number;
  dailyPnL: number;
  riskUtilization: number;
}

interface ActivePosition {
  symbol: string;
  direction: "long" | "short";
  entryPrice: number;
  currentPrice: number;
  currentPnL: number;
  exposurePercent: number;
}

interface Lesson {
  id: string;
  type: "win" | "loss" | "pattern" | "risk";
  description: string;
  strategyAffected: string;
  timestamp: string;
}

// ── API Hooks ──────────────────────────────────────────────────────────────
function usePipelineStatus() {
  return useQuery({
    queryKey: ["pipeline-status"],
    queryFn: async (): Promise<PipelineStatus> => {
      const res = await fetch("/api/pipeline/status");
      return res.json();
    },
    refetchInterval: 3000,
  });
}

function useSignalFlow() {
  return useQuery({
    queryKey: ["signal-flow"],
    queryFn: async (): Promise<SignalFlow> => {
      const res = await fetch("/api/pipeline/flow");
      return res.json();
    },
    refetchInterval: 3000,
  });
}

function useActivePositions() {
  return useQuery({
    queryKey: ["active-positions"],
    queryFn: async (): Promise<ActivePosition[]> => {
      const res = await fetch("/api/pipeline/positions");
      return res.json();
    },
    refetchInterval: 3000,
  });
}

function useLearning() {
  return useQuery({
    queryKey: ["learning-stats"],
    queryFn: async (): Promise<{ lessons: Lesson[] }> => {
      const res = await fetch("/api/pipeline/learning");
      return res.json();
    },
    refetchInterval: 3000,
  });
}

// ── Reusable Components ────────────────────────────────────────────────────
function Label({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: "10px",
        fontFamily: "Space Grotesk, sans-serif",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: C.muted,
      }}
    >
      {children}
    </span>
  );
}

function StatusDot({
  status,
}: {
  status: "healthy" | "warning" | "critical";
}) {
  const colors = {
    healthy: C.primary,
    warning: C.gold,
    critical: C.tertiary,
  };
  const glowColors = {
    healthy: "rgba(156, 255, 147, 0.3)",
    warning: "rgba(251, 191, 36, 0.3)",
    critical: "rgba(255, 113, 98, 0.3)",
  };

  return (
    <div
      style={{
        position: "relative",
        width: "12px",
        height: "12px",
        borderRadius: "50%",
        backgroundColor: colors[status],
        boxShadow: `0 0 12px ${glowColors[status]}`,
        animation: status !== "healthy" ? "pulse 2s infinite" : undefined,
      }}
    />
  );
}

function SubsystemCard({
  title,
  icon,
  status,
  metrics,
}: {
  title: string;
  icon: string;
  status: "healthy" | "warning" | "critical";
  metrics: { label: string; value: string | number }[];
}) {
  return (
    <div
      style={{
        padding: "16px",
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: "8px",
        flex: 1,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "12px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <span style={{ fontSize: "18px" }}>{icon}</span>
          <span
            style={{
              fontSize: "13px",
              fontWeight: "600",
              color: "white",
              fontFamily: "Space Grotesk, sans-serif",
            }}
          >
            {title}
          </span>
        </div>
        <StatusDot status={status} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {metrics.map((metric, idx) => (
          <div key={idx} style={{ fontSize: "12px" }}>
            <div style={{ color: C.muted, marginBottom: "2px" }}>
              {metric.label}
            </div>
            <div
              style={{
                color: "white",
                fontSize: "14px",
                fontWeight: "600",
                fontFamily: "JetBrains Mono, monospace",
              }}
            >
              {metric.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricGauge({
  label,
  value,
  max = 100,
  color = C.primary,
}: {
  label: string;
  value: number;
  max?: number;
  color?: string;
}) {
  const percentage = (value / max) * 100;

  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: "10px", color: C.muted, marginBottom: "6px" }}>
        {label}
      </div>
      <div
        style={{
          height: "6px",
          background: C.cardHigh,
          borderRadius: "3px",
          overflow: "hidden",
          marginBottom: "6px",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.min(percentage, 100)}%`,
            background: color,
            transition: "width 0.3s",
          }}
        />
      </div>
      <div
        style={{
          fontSize: "12px",
          fontWeight: "600",
          color: "white",
          fontFamily: "JetBrains Mono, monospace",
        }}
      >
        {value.toFixed(1)}
      </div>
    </div>
  );
}

// ── Main Page Component ────────────────────────────────────────────────────
export default function PipelineStatusPage() {
  const { data: pipelineData } = usePipelineStatus();
  const { data: signalData } = useSignalFlow();
  const { data: positionData } = useActivePositions();
  const { data: learningData } = useLearning();

  const getStatusColor = (status: "healthy" | "warning" | "critical") => {
    switch (status) {
      case "healthy":
        return C.primary;
      case "warning":
        return C.gold;
      case "critical":
        return C.tertiary;
    }
  };

  const getStatusBgColor = (status: "healthy" | "warning" | "critical") => {
    switch (status) {
      case "healthy":
        return "rgba(156, 255, 147, 0.1)";
      case "warning":
        return "rgba(251, 191, 36, 0.1)";
      case "critical":
        return "rgba(255, 113, 98, 0.1)";
    }
  };

  return (
    <div style={{ padding: "24px", backgroundColor: C.bg, minHeight: "100vh" }}>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <h1
          style={{
            fontSize: "28px",
            fontWeight: "bold",
            color: "white",
            fontFamily: "JetBrains Mono, monospace",
            marginBottom: "8px",
          }}
        >
          Pipeline Status
        </h1>
        <p style={{ color: C.muted, fontSize: "14px" }}>
          Live monitoring of GodsView subsystem health
        </p>
      </div>

      {/* Section 1: Pipeline Health Banner */}
      {pipelineData && (
        <div
          style={{
            padding: "20px",
            background: getStatusBgColor(pipelineData.overallHealth),
            border: `2px solid ${getStatusColor(pipelineData.overallHealth)}`,
            borderRadius: "8px",
            marginBottom: "24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "16px",
            }}
          >
            <StatusDot status={pipelineData.overallHealth} />
            <div>
              <div
                style={{
                  fontSize: "16px",
                  fontWeight: "700",
                  color: getStatusColor(pipelineData.overallHealth),
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                System {pipelineData.overallHealth.toUpperCase()}
              </div>
              <div
                style={{
                  fontSize: "11px",
                  color: C.muted,
                  marginTop: "2px",
                }}
              >
                All subsystems operational
              </div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "11px", color: C.muted }}>
              Last update
            </div>
            <div
              style={{
                fontSize: "12px",
                fontFamily: "JetBrains Mono, monospace",
                color: "white",
                marginTop: "2px",
              }}
            >
              {pipelineData.timestamp}
            </div>
          </div>
        </div>
      )}

      {/* Section 2: Subsystem Grid */}
      {pipelineData && (
        <div style={{ marginBottom: "24px" }}>
          <Label style={{ display: "block", marginBottom: "12px" }}>
            Subsystems
          </Label>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, 1fr)",
              gap: "12px",
            }}
          >
            <SubsystemCard
              title="Data Engine"
              icon="📊"
              status={pipelineData.subsystems.dataEngine.status}
              metrics={[
                {
                  label: "Sources Active",
                  value: pipelineData.subsystems.dataEngine.sourcesActive,
                },
                {
                  label: "Data Quality",
                  value: `${pipelineData.subsystems.dataEngine.dataQuality}%`,
                },
              ]}
            />
            <SubsystemCard
              title="MCP Intelligence"
              icon="🧠"
              status={pipelineData.subsystems.mcpIntelligence.status}
              metrics={[
                {
                  label: "Signals/min",
                  value: pipelineData.subsystems.mcpIntelligence.signalsProcessed,
                },
                {
                  label: "Approval Rate",
                  value: `${pipelineData.subsystems.mcpIntelligence.approvalRate}%`,
                },
                {
                  label: "Avg Latency",
                  value: `${pipelineData.subsystems.mcpIntelligence.avgLatency}ms`,
                },
              ]}
            />
            <SubsystemCard
              title="Execution"
              icon="⚡"
              status={pipelineData.subsystems.execution.status}
              metrics={[
                {
                  label: "Mode",
                  value: pipelineData.subsystems.execution.mode.toUpperCase(),
                },
                {
                  label: "Active Pos",
                  value: pipelineData.subsystems.execution.activePositions,
                },
                {
                  label: "Daily P&L",
                  value: `$${pipelineData.subsystems.execution.dailyPnL}`,
                },
              ]}
            />
            <SubsystemCard
              title="Learning"
              icon="📈"
              status={pipelineData.subsystems.learning.status}
              metrics={[
                {
                  label: "Lessons",
                  value: pipelineData.subsystems.learning.lessonsExtracted,
                },
                {
                  label: "Strategies",
                  value: pipelineData.subsystems.learning.strategiesByTier.reduce(
                    (sum, tier) => sum + tier.count,
                    0
                  ),
                },
              ]}
            />
            <SubsystemCard
              title="Risk"
              icon="🛡️"
              status={pipelineData.subsystems.risk.status}
              metrics={[
                {
                  label: "Utilization",
                  value: `${pipelineData.subsystems.risk.utilization}%`,
                },
                {
                  label: "Circuit Breaker",
                  value: pipelineData.subsystems.risk.circuitBreakerStatus,
                },
                {
                  label: "Max Drawdown",
                  value: `${pipelineData.subsystems.risk.maxDrawdown}%`,
                },
              ]}
            />
          </div>
        </div>
      )}

      {/* Section 3: Signal Flow Metrics */}
      {signalData && (
        <div
          style={{
            padding: "20px",
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: "8px",
            marginBottom: "24px",
          }}
        >
          <Label style={{ display: "block", marginBottom: "16px" }}>
            Live Signal Flow
          </Label>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(6, 1fr)",
              gap: "20px",
            }}
          >
            <MetricGauge
              label="Signals/Min"
              value={signalData.signalsPerMin}
              max={100}
              color={C.primary}
            />
            <MetricGauge
              label="Avg Latency (ms)"
              value={signalData.avgLatency}
              max={500}
              color={C.secondary}
            />
            <MetricGauge
              label="Approval Rate (%)"
              value={signalData.approvalRate}
              max={100}
              color={C.primary}
            />
            <MetricGauge
              label="Active Positions"
              value={signalData.activePositions}
              max={50}
              color={C.secondary}
            />
            <MetricGauge
              label="Daily P&L ($)"
              value={Math.abs(signalData.dailyPnL)}
              max={10000}
              color={signalData.dailyPnL >= 0 ? C.primary : C.tertiary}
            />
            <MetricGauge
              label="Risk Util (%)"
              value={signalData.riskUtilization}
              max={100}
              color={
                signalData.riskUtilization > 80
                  ? C.tertiary
                  : signalData.riskUtilization > 50
                    ? C.gold
                    : C.primary
              }
            />
          </div>
        </div>
      )}

      {/* Section 4: Active Positions Table */}
      {positionData && positionData.length > 0 && (
        <div
          style={{
            padding: "20px",
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: "8px",
            marginBottom: "24px",
          }}
        >
          <Label style={{ display: "block", marginBottom: "12px" }}>
            Active Positions
          </Label>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "12px",
            }}
          >
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                <th
                  style={{
                    textAlign: "left",
                    padding: "12px",
                    color: C.muted,
                    fontWeight: "600",
                    fontSize: "11px",
                  }}
                >
                  SYMBOL
                </th>
                <th
                  style={{
                    textAlign: "center",
                    padding: "12px",
                    color: C.muted,
                    fontWeight: "600",
                    fontSize: "11px",
                  }}
                >
                  DIRECTION
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: "12px",
                    color: C.muted,
                    fontWeight: "600",
                    fontSize: "11px",
                  }}
                >
                  ENTRY
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: "12px",
                    color: C.muted,
                    fontWeight: "600",
                    fontSize: "11px",
                  }}
                >
                  CURRENT
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: "12px",
                    color: C.muted,
                    fontWeight: "600",
                    fontSize: "11px",
                  }}
                >
                  P&L
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: "12px",
                    color: C.muted,
                    fontWeight: "600",
                    fontSize: "11px",
                  }}
                >
                  EXPOSURE
                </th>
              </tr>
            </thead>
            <tbody>
              {positionData.map((pos, idx) => (
                <tr
                  key={idx}
                  style={{
                    borderBottom: `1px solid ${C.border}`,
                  }}
                >
                  <td
                    style={{
                      padding: "12px",
                      color: "white",
                      fontFamily: "JetBrains Mono, monospace",
                      fontWeight: "600",
                    }}
                  >
                    {pos.symbol}
                  </td>
                  <td
                    style={{
                      padding: "12px",
                      textAlign: "center",
                      color:
                        pos.direction === "long" ? C.primary : C.tertiary,
                      fontWeight: "600",
                      textTransform: "uppercase",
                    }}
                  >
                    {pos.direction}
                  </td>
                  <td
                    style={{
                      padding: "12px",
                      textAlign: "right",
                      color: C.muted,
                      fontFamily: "JetBrains Mono, monospace",
                    }}
                  >
                    ${pos.entryPrice.toFixed(2)}
                  </td>
                  <td
                    style={{
                      padding: "12px",
                      textAlign: "right",
                      color: "white",
                      fontFamily: "JetBrains Mono, monospace",
                      fontWeight: "600",
                    }}
                  >
                    ${pos.currentPrice.toFixed(2)}
                  </td>
                  <td
                    style={{
                      padding: "12px",
                      textAlign: "right",
                      color: pos.currentPnL >= 0 ? C.primary : C.tertiary,
                      fontFamily: "JetBrains Mono, monospace",
                      fontWeight: "600",
                    }}
                  >
                    {pos.currentPnL >= 0 ? "+" : ""}${pos.currentPnL.toFixed(2)}
                  </td>
                  <td
                    style={{
                      padding: "12px",
                      textAlign: "right",
                      color: "white",
                      fontFamily: "JetBrains Mono, monospace",
                    }}
                  >
                    {pos.exposurePercent.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Section 5: Recent Lessons */}
      {learningData && learningData.lessons.length > 0 && (
        <div
          style={{
            padding: "20px",
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: "8px",
          }}
        >
          <Label style={{ display: "block", marginBottom: "12px" }}>
            Recent Lessons
          </Label>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {learningData.lessons.slice(0, 10).map((lesson, idx) => {
              const typeColors = {
                win: C.primary,
                loss: C.tertiary,
                pattern: C.secondary,
                risk: C.gold,
              };

              return (
                <div
                  key={lesson.id}
                  style={{
                    padding: "12px",
                    background: C.cardHigh,
                    borderLeft: `4px solid ${typeColors[lesson.type]}`,
                    borderRadius: "4px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      marginBottom: "6px",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "11px",
                        fontWeight: "600",
                        color: typeColors[lesson.type],
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}
                    >
                      {lesson.type}
                    </div>
                    <div
                      style={{
                        fontSize: "10px",
                        color: C.muted,
                        fontFamily: "JetBrains Mono, monospace",
                      }}
                    >
                      {lesson.timestamp}
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: "white",
                      marginBottom: "6px",
                    }}
                  >
                    {lesson.description}
                  </div>
                  <div style={{ fontSize: "10px", color: C.muted }}>
                    Affects: <span style={{ color: C.secondary }}>
                      {lesson.strategyAffected}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
