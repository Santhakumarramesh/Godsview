import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

export default function TVReplay() {
  const [selectedSession, setSelectedSession] = useState<string | null>(null);

  const { data: replaySessions = [], isLoading: isLoadingSessions, error: sessionsError } = useQuery({
    queryKey: ["replay-sessions"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/memory/recall?type=replay`);
      if (!res.ok) throw new Error("Failed to fetch replay sessions");
      return res.json();
    },
  });

  const { data: backtestResults = [], isLoading: isLoadingBacktest, error: backtestError } = useQuery({
    queryKey: ["backtest-results"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/backtest/results`);
      if (!res.ok) throw new Error("Failed to fetch backtest results");
      return res.json();
    },
  });

  const stats = useMemo(() => {
    const totalSessions = replaySessions.length;
    const linkedOutcomes = replaySessions.filter((s: any) => s.outcome).length;
    const savedCases = backtestResults.length;
    return { totalSessions, linkedOutcomes, savedCases };
  }, [replaySessions, backtestResults]);

  const isLoading = isLoadingSessions || isLoadingBacktest;
  const hasError = sessionsError || backtestError;
  const hasData = replaySessions.length > 0 || backtestResults.length > 0;

  return (
    <div style={{ backgroundColor: "#0e0e0f", minHeight: "100vh", padding: "24px" }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: "32px" }}>
          <h1
            style={{
              fontFamily: "Space Grotesk",
              fontSize: "32px",
              fontWeight: "700",
              color: "#ffffff",
              marginBottom: "8px",
            }}
          >
            TV Replay Connector
          </h1>
          <p style={{ color: "#767576", fontSize: "14px", margin: 0 }}>
            Analyze historical replay sessions, track linked outcomes, and review saved case studies
          </p>
        </div>

        {/* Error State */}
        {hasError && (
          <div
            style={{
              backgroundColor: "rgba(255, 107, 107, 0.1)",
              border: "1px solid rgba(255, 107, 107, 0.3)",
              borderRadius: "12px",
              padding: "16px",
              marginBottom: "24px",
            }}
          >
            <p style={{ color: "#ff6b6b", fontSize: "14px", margin: 0, fontFamily: "Space Grotesk" }}>
              Error loading data. {sessionsError && "Replay sessions failed to load."}{" "}
              {backtestError && "Backtest results failed to load."}
            </p>
          </div>
        )}

        {/* Stats Bar */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "12px",
            marginBottom: "24px",
          }}
        >
          {[
            { label: "Total Sessions", value: stats.totalSessions, color: "#9cff93" },
            { label: "Linked Outcomes", value: stats.linkedOutcomes, color: "#9cff93" },
            { label: "Saved Cases", value: stats.savedCases, color: "#9cff93" },
          ].map((stat, idx) => (
            <div
              key={idx}
              style={{
                backgroundColor: "#1a191b",
                border: "1px solid rgba(72,72,73,0.2)",
                borderRadius: "12px",
                padding: "16px",
              }}
            >
              <p style={{ fontFamily: "Space Grotesk", fontSize: "12px", color: "#767576", margin: "0 0 8px 0" }}>
                {stat.label}
              </p>
              <p
                style={{
                  fontFamily: "JetBrains Mono",
                  fontSize: "24px",
                  fontWeight: "700",
                  color: stat.color,
                  margin: 0,
                }}
              >
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        {/* Loading State */}
        {isLoading && !hasData && (
          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "40px",
              textAlign: "center",
            }}
          >
            <p style={{ color: "#767576", fontSize: "14px", fontFamily: "Space Grotesk" }}>
              Loading replay sessions and backtest results...
            </p>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !hasError && !hasData && (
          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "60px 24px",
              textAlign: "center",
            }}
          >
            <p style={{ color: "#767576", fontSize: "16px", fontFamily: "Space Grotesk", margin: 0 }}>
              No replay sessions or backtest results available yet.
            </p>
            <p style={{ color: "#767576", fontSize: "13px", marginTop: "8px", margin: 0 }}>
              Start by creating a new replay session to get started.
            </p>
          </div>
        )}

        {/* Replay Sessions Section */}
        {replaySessions.length > 0 && (
          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(72,72,73,0.2)",
              borderRadius: "12px",
              padding: "24px",
              marginBottom: "24px",
            }}
          >
            <h2
              style={{
                fontFamily: "Space Grotesk",
                fontSize: "18px",
                fontWeight: "600",
                color: "#ffffff",
                marginBottom: "16px",
                margin: 0,
              }}
            >
              Replay Sessions
            </h2>
            <p style={{ color: "#767576", fontSize: "13px", marginBottom: "16px" }}>
              {replaySessions.length} session{replaySessions.length !== 1 ? "s" : ""} recorded
            </p>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(72,72,73,0.2)" }}>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "12px",
                        fontFamily: "Space Grotesk",
                        color: "#9cff93",
                        fontSize: "12px",
                        fontWeight: "500",
                      }}
                    >
                      Session ID
                    </th>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "12px",
                        fontFamily: "Space Grotesk",
                        color: "#9cff93",
                        fontSize: "12px",
                        fontWeight: "500",
                      }}
                    >
                      Symbol
                    </th>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "12px",
                        fontFamily: "Space Grotesk",
                        color: "#9cff93",
                        fontSize: "12px",
                        fontWeight: "500",
                      }}
                    >
                      Date
                    </th>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "12px",
                        fontFamily: "Space Grotesk",
                        color: "#9cff93",
                        fontSize: "12px",
                        fontWeight: "500",
                      }}
                    >
                      Observations
                    </th>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "12px",
                        fontFamily: "Space Grotesk",
                        color: "#9cff93",
                        fontSize: "12px",
                        fontWeight: "500",
                      }}
                    >
                      Outcome
                    </th>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "12px",
                        fontFamily: "Space Grotesk",
                        color: "#9cff93",
                        fontSize: "12px",
                        fontWeight: "500",
                      }}
                    >
                      Trade ID
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {replaySessions.map((session: any, idx: number) => (
                    <tr
                      key={idx}
                      style={{
                        borderBottom: "1px solid rgba(72,72,73,0.2)",
                        cursor: "pointer",
                        backgroundColor: selectedSession === String(idx) ? "rgba(156,255,147,0.05)" : "transparent",
                        transition: "background-color 0.2s",
                      }}
                      onClick={() => setSelectedSession(selectedSession === String(idx) ? null : String(idx))}
                    >
                      <td
                        style={{
                          padding: "12px",
                          fontFamily: "JetBrains Mono, monospace",
                          fontSize: "12px",
                          color: "#ffffff",
                        }}
                      >
                        {session.session_id || `SES-${idx}`}
                      </td>
                      <td
                        style={{
                          padding: "12px",
                          fontFamily: "JetBrains Mono, monospace",
                          fontSize: "12px",
                          color: "#ffffff",
                        }}
                      >
                        {session.symbol || "—"}
                      </td>
                      <td
                        style={{
                          padding: "12px",
                          fontFamily: "JetBrains Mono, monospace",
                          fontSize: "12px",
                          color: "#ffffff",
                        }}
                      >
                        {session.date || "—"}
                      </td>
                      <td
                        style={{
                          padding: "12px",
                          fontFamily: "JetBrains Mono, monospace",
                          fontSize: "12px",
                          color: "#767576",
                          maxWidth: "200px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {session.observations || "—"}
                      </td>
                      <td style={{ padding: "12px" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "4px 8px",
                            borderRadius: "4px",
                            fontSize: "11px",
                            fontFamily: "Space Grotesk",
                            fontWeight: "500",
                            backgroundColor:
                              session.outcome === "profitable"
                                ? "rgba(156,255,147,0.2)"
                                : session.outcome === "loss"
                                ? "rgba(255,107,107,0.2)"
                                : "rgba(118,117,118,0.2)",
                            color:
                              session.outcome === "profitable"
                                ? "#9cff93"
                                : session.outcome === "loss"
                                ? "#ff6b6b"
                                : "#767576",
                          }}
                        >
                          {session.outcome || "unknown"}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: "12px",
                          fontFamily: "JetBrains Mono, monospace",
                          fontSize: "11px",
                          color: "#9cff93",
                        }}
                      >
                        {session.trade_id || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Case Study Details */}
        {selectedSession !== null && replaySessions[parseInt(selectedSession)] && (
          <div
            style={{
              backgroundColor: "#1a191b",
              border: "1px solid rgba(156,255,147,0.2)",
              borderRadius: "12px",
              padding: "24px",
              marginBottom: "24px",
            }}
          >
            <h2
              style={{
                fontFamily: "Space Grotesk",
                fontSize: "16px",
                fontWeight: "600",
                color: "#9cff93",
                marginBottom: "12px",
                margin: 0,
              }}
            >
              Case Study Details
            </h2>
            <pre
              style={{
                backgroundColor: "#0e0e0f",
                padding: "12px",
                borderRadius: "8px",
                overflow: "auto",
                fontFamily: "JetBrains Mono, monospace",
                fontSize: "12px",
                color: "#767576",
                margin: 0,
              }}
            >
              {JSON.stringify(replaySessions[parseInt(selectedSession)], null, 2)}
            </pre>
          </div>
        )}

        {/* Backtest Results Section */}
        {backtestResults.length > 0 && (
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
                fontSize: "18px",
                fontWeight: "600",
                color: "#ffffff",
                marginBottom: "16px",
                margin: 0,
              }}
            >
              Linked Backtest Results
            </h2>
            <p style={{ color: "#767576", fontSize: "13px", marginBottom: "16px" }}>
              {backtestResults.length} backtest{backtestResults.length !== 1 ? "s" : ""} available
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px" }}>
              {backtestResults.map((result: any, idx: number) => (
                <div
                  key={idx}
                  style={{
                    backgroundColor: "#0e0e0f",
                    border: "1px solid rgba(72,72,73,0.2)",
                    borderRadius: "8px",
                    padding: "16px",
                    transition: "border-color 0.2s",
                  }}
                >
                  <div style={{ marginBottom: "12px" }}>
                    <p
                      style={{
                        fontFamily: "Space Grotesk",
                        fontSize: "14px",
                        fontWeight: "600",
                        color: "#ffffff",
                        margin: "0 0 4px 0",
                      }}
                    >
                      {result.test_name || `Test ${idx + 1}`}
                    </p>
                    {result.test_id && (
                      <p
                        style={{
                          fontFamily: "JetBrains Mono, monospace",
                          fontSize: "10px",
                          color: "#767576",
                          margin: 0,
                        }}
                      >
                        ID: {result.test_id}
                      </p>
                    )}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
                    <div>
                      <p
                        style={{
                          fontFamily: "Space Grotesk",
                          fontSize: "11px",
                          color: "#767576",
                          margin: "0 0 2px 0",
                        }}
                      >
                        Return
                      </p>
                      <p
                        style={{
                          fontFamily: "JetBrains Mono, monospace",
                          fontSize: "14px",
                          fontWeight: "600",
                          color:
                            (result.return_pct || 0) >= 0 ? "#9cff93" : "#ff6b6b",
                          margin: 0,
                        }}
                      >
                        {result.return_pct || "—"}%
                      </p>
                    </div>
                    <div>
                      <p
                        style={{
                          fontFamily: "Space Grotesk",
                          fontSize: "11px",
                          color: "#767576",
                          margin: "0 0 2px 0",
                        }}
                      >
                        Trades
                      </p>
                      <p
                        style={{
                          fontFamily: "JetBrains Mono, monospace",
                          fontSize: "14px",
                          fontWeight: "600",
                          color: "#ffffff",
                          margin: 0,
                        }}
                      >
                        {result.trade_count || "—"}
                      </p>
                    </div>
                  </div>
                  {result.status && (
                    <div
                      style={{
                        paddingTop: "8px",
                        borderTop: "1px solid rgba(72,72,73,0.2)",
                      }}
                    >
                      <p
                        style={{
                          fontFamily: "Space Grotesk",
                          fontSize: "10px",
                          color: "#767576",
                          margin: 0,
                        }}
                      >
                        Status: {result.status}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
