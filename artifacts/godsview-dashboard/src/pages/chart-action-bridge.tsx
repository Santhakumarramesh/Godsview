import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

interface ChartAction {
  id?: string;
  zone_name?: string;
  level?: string | number;
  type?: string;
  confidence?: number;
  status?: "pending" | "active" | "completed";
  createdAt?: string;
}

interface Signal {
  id?: string;
  description?: string;
  confidence?: number;
  signal_type?: string;
  timestamp?: string;
}

const getStatusBadge = (
  status: string | undefined
): { bg: string; text: string; label: string } => {
  switch (status) {
    case "active":
      return { bg: "rgba(156,255,147,0.15)", text: "#9cff93", label: "Active" };
    case "completed":
      return { bg: "rgba(118,117,118,0.15)", text: "#767576", label: "Completed" };
    default:
      return { bg: "rgba(255,107,107,0.15)", text: "#ff6b6b", label: "Pending" };
  }
};

export default function ChartActionBridge() {
  const [selectedZone, setSelectedZone] = useState<string | null>(null);

  const {
    data: actions = [],
    isLoading: actionsLoading,
    error: actionsError,
  } = useQuery({
    queryKey: ["chart-actions"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/tradingview-mcp/actions`);
      if (!res.ok) throw new Error("Failed to fetch chart actions");
      return res.json();
    },
    staleTime: 30000,
  });

  const {
    data: signals = [],
    isLoading: signalsLoading,
    error: signalsError,
  } = useQuery({
    queryKey: ["latest-signals"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/signals/latest`);
      if (!res.ok) throw new Error("Failed to fetch signals");
      return res.json();
    },
    staleTime: 30000,
  });

  const stats = useMemo(() => {
    const activeActions = (actions as ChartAction[]).filter(
      (a) => a.status === "active"
    ).length;
    const highConfidence = (signals as Signal[]).filter(
      (s) => (s.confidence || 0) >= 75
    ).length;
    const avgConfidence =
      (signals as Signal[]).length > 0
        ? Math.round(
            (signals as Signal[]).reduce((sum, s) => sum + (s.confidence || 0), 0) /
              (signals as Signal[]).length
          )
        : 0;

    return { activeActions, highConfidence, avgConfidence };
  }, [actions, signals]);

  const handleAnalyzeZone = (zoneId: string) => {
    console.log("Analyzing zone:", zoneId);
  };

  const handleBacktestSetup = (zoneId: string) => {
    console.log("Setting up backtest for:", zoneId);
  };

  const handleSaveToMemory = (zoneId: string) => {
    console.log("Saving zone to memory:", zoneId);
  };

  const renderLoadingState = () => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "200px",
        color: "#767576",
        fontFamily: "Space Grotesk",
        fontSize: "14px",
      }}
    >
      Loading data...
    </div>
  );

  const renderErrorState = (error: Error | null) => (
    <div
      style={{
        backgroundColor: "rgba(255,107,107,0.1)",
        border: "1px solid rgba(255,107,107,0.3)",
        borderRadius: "8px",
        padding: "16px",
        color: "#ff6b6b",
        fontFamily: "Space Grotesk",
        fontSize: "13px",
      }}
    >
      {error?.message || "An error occurred"}
    </div>
  );

  return (
    <div style={{ backgroundColor: "#0e0e0f", minHeight: "100vh", padding: "24px" }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: "32px" }}>
          <h1
            style={{
              fontFamily: "Space Grotesk",
              fontSize: "28px",
              color: "#ffffff",
              marginBottom: "6px",
              margin: 0,
            }}
          >
            Chart Action Bridge
          </h1>
          <p
            style={{
              color: "#767576",
              fontSize: "13px",
              margin: "8px 0 0 0",
              fontFamily: "Space Grotesk",
            }}
          >
            Execute contextual chart-click actions, link zones to insights, and manage analysis workflows
          </p>
        </div>

        {/* Stats Bar */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "16px",
            marginBottom: "32px",
          }}
        >
          {[
            { label: "Active Zones", value: stats.activeActions },
            { label: "High Confidence Signals", value: stats.highConfidence },
            { label: "Avg Confidence", value: `${stats.avgConfidence}%` },
          ].map((stat, idx) => (
            <div
              key={idx}
              style={{
                backgroundColor: "#1a191b",
                border: "1px solid rgba(72,72,73,0.2)",
                borderRadius: "12px",
                padding: "16px",
                textAlign: "center",
              }}
            >
              <p
                style={{
                  fontFamily: "Space Grotesk",
                  fontSize: "12px",
                  color: "#767576",
                  margin: "0 0 8px 0",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}
              >
                {stat.label}
              </p>
              <p
                style={{
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: "24px",
                  color: "#9cff93",
                  margin: 0,
                  fontWeight: 600,
                }}
              >
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        {/* Main Content Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "24px" }}>
          {/* Chart Actions Card */}
          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            <div style={{ marginBottom: "16px" }}>
              <h2
                style={{
                  fontFamily: "Space Grotesk",
                  fontSize: "16px",
                  color: "#9cff93",
                  margin: "0 0 4px 0",
                  fontWeight: 600,
                }}
              >
                Chart Zones
              </h2>
              <p
                style={{
                  fontFamily: "Space Grotesk",
                  fontSize: "12px",
                  color: "#767576",
                  margin: 0,
                }}
              >
                {actions.length} zone{actions.length !== 1 ? "s" : ""} identified
              </p>
            </div>

            {actionsLoading ? (
              renderLoadingState()
            ) : actionsError ? (
              renderErrorState(actionsError)
            ) : (actions as ChartAction[]).length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "48px 24px",
                  color: "#767576",
                }}
              >
                <p style={{ fontFamily: "Space Grotesk", fontSize: "14px", margin: "0 0 8px 0" }}>
                  No zones detected
                </p>
                <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", margin: 0, color: "#555" }}>
                  Click zones on your chart to begin
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {(actions as ChartAction[]).map((action, idx) => {
                  const badge = getStatusBadge(action.status);
                  return (
                    <div
                      key={action.id || idx}
                      style={{
                        backgroundColor:
                          selectedZone === String(idx) ? "rgba(156,255,147,0.1)" : "#0e0e0f",
                        border:
                          selectedZone === String(idx)
                            ? "1px solid #9cff93"
                            : "1px solid rgba(72,72,73,0.2)",
                        borderRadius: "8px",
                        padding: "12px",
                        cursor: "pointer",
                        transition: "all 0.2s",
                      }}
                      onClick={() =>
                        setSelectedZone(selectedZone === String(idx) ? null : String(idx))
                      }
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "8px" }}>
                        <p
                          style={{
                            fontFamily: "Space Grotesk",
                            fontSize: "13px",
                            color: "#ffffff",
                            margin: 0,
                            fontWeight: 500,
                          }}
                        >
                          {action.zone_name || `Zone ${idx + 1}`}
                        </p>
                        <div
                          style={{
                            backgroundColor: badge.bg,
                            color: badge.text,
                            padding: "4px 8px",
                            borderRadius: "4px",
                            fontFamily: "Space Grotesk",
                            fontSize: "10px",
                            fontWeight: 500,
                          }}
                        >
                          {badge.label}
                        </div>
                      </div>
                      <p
                        style={{
                          fontFamily: "JetBrains Mono, monospace",
                          fontSize: "11px",
                          color: "#767576",
                          margin: "0 0 8px 0",
                        }}
                      >
                        Level: {action.level || "—"} • Type: {action.type || "—"} • Confidence:{" "}
                        {action.confidence || "—"}%
                      </p>

                      {selectedZone === String(idx) && (
                        <div style={{ display: "flex", gap: "8px", marginTop: "12px", paddingTop: "12px", borderTop: "1px solid rgba(72,72,73,0.2)" }}>
                          <button
                            onClick={() => handleAnalyzeZone(String(idx))}
                            style={{
                              flex: 1,
                              padding: "8px",
                              backgroundColor: "#9cff93",
                              color: "#0e0e0f",
                              border: "none",
                              borderRadius: "6px",
                              fontSize: "11px",
                              fontFamily: "Space Grotesk",
                              fontWeight: 500,
                              cursor: "pointer",
                            }}
                          >
                            Analyze
                          </button>
                          <button
                            onClick={() => handleBacktestSetup(String(idx))}
                            style={{
                              flex: 1,
                              padding: "8px",
                              backgroundColor: "transparent",
                              color: "#9cff93",
                              border: "1px solid #9cff93",
                              borderRadius: "6px",
                              fontSize: "11px",
                              fontFamily: "Space Grotesk",
                              fontWeight: 500,
                              cursor: "pointer",
                            }}
                          >
                            Backtest
                          </button>
                          <button
                            onClick={() => handleSaveToMemory(String(idx))}
                            style={{
                              flex: 1,
                              padding: "8px",
                              backgroundColor: "transparent",
                              color: "#9cff93",
                              border: "1px solid #9cff93",
                              borderRadius: "6px",
                              fontSize: "11px",
                              fontFamily: "Space Grotesk",
                              fontWeight: 500,
                              cursor: "pointer",
                            }}
                          >
                            Save
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Signals Card */}
          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "24px",
            }}
          >
            <div style={{ marginBottom: "16px" }}>
              <h2
                style={{
                  fontFamily: "Space Grotesk",
                  fontSize: "16px",
                  color: "#9cff93",
                  margin: "0 0 4px 0",
                  fontWeight: 600,
                }}
              >
                Linked Signals
              </h2>
              <p
                style={{
                  fontFamily: "Space Grotesk",
                  fontSize: "12px",
                  color: "#767576",
                  margin: 0,
                }}
              >
                {signals.length} signal{signals.length !== 1 ? "s" : ""} available
              </p>
            </div>

            {signalsLoading ? (
              renderLoadingState()
            ) : signalsError ? (
              renderErrorState(signalsError)
            ) : (signals as Signal[]).length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "48px 24px",
                  color: "#767576",
                }}
              >
                <p style={{ fontFamily: "Space Grotesk", fontSize: "14px", margin: "0 0 8px 0" }}>
                  No signals generated
                </p>
                <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", margin: 0, color: "#555" }}>
                  Create zones and run analysis to generate signals
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {(signals as Signal[]).map((signal, idx) => (
                  <div
                    key={signal.id || idx}
                    style={{
                      backgroundColor: "#0e0e0f",
                      border: "1px solid rgba(72,72,73,0.2)",
                      borderRadius: "8px",
                      padding: "12px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "6px" }}>
                      <p
                        style={{
                          fontFamily: "Space Grotesk",
                          fontSize: "13px",
                          color: "#ffffff",
                          margin: 0,
                          fontWeight: 500,
                          flex: 1,
                        }}
                      >
                        {signal.description || `Signal ${idx + 1}`}
                      </p>
                      {signal.confidence !== undefined && (
                        <p
                          style={{
                            fontFamily: "JetBrains Mono, monospace",
                            fontSize: "12px",
                            color: signal.confidence >= 75 ? "#9cff93" : "#767576",
                            margin: "0 0 0 12px",
                            fontWeight: 600,
                          }}
                        >
                          {signal.confidence}%
                        </p>
                      )}
                    </div>
                    <p
                      style={{
                        fontFamily: "Space Grotesk",
                        fontSize: "11px",
                        color: "#767576",
                        margin: 0,
                      }}
                    >
                      Type: {signal.signal_type || "—"}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recommendations Footer */}
        <div
          style={{
            backgroundColor: "#1a191b",
            border: "1px solid rgba(72,72,73,0.2)",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <h2
            style={{
              fontFamily: "Space Grotesk",
              fontSize: "16px",
              color: "#ffffff",
              margin: "0 0 12px 0",
              fontWeight: 600,
            }}
          >
            Recommended Actions
          </h2>
          {selectedZone !== null ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <p
                style={{
                  fontFamily: "Space Grotesk",
                  fontSize: "13px",
                  color: "#ffffff",
                  margin: "0 0 8px 0",
                }}
              >
                Zone {parseInt(selectedZone) + 1} Analysis Workflow:
              </p>
              <ul
                style={{
                  fontFamily: "Space Grotesk",
                  fontSize: "12px",
                  color: "#767576",
                  margin: 0,
                  paddingLeft: "20px",
                  lineHeight: "1.6",
                }}
              >
                <li>Run technical analysis to identify support/resistance patterns</li>
                <li>Backtest zone strategy against historical data</li>
                <li>Save zone configuration to memory for future reference</li>
              </ul>
            </div>
          ) : (
            <p
              style={{
                fontFamily: "Space Grotesk",
                fontSize: "13px",
                color: "#767576",
                margin: 0,
              }}
            >
              Select a zone above to view tailored analysis recommendations
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
