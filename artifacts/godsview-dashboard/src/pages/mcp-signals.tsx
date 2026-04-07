import { useState } from "react";
import {
  BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, Cell,
} from "recharts";
import {
  useMCPStats,
  useMCPDecisions,
  useMCPHealth,
  type MCPDecisionSummary,
} from "@/lib/api";

// ── Design Tokens ──────────────────────────────────────────────────────────
const C = {
  bg: "#0e0e0f", card: "#1a191b", cardHigh: "#201f21",
  border: "rgba(72,72,73,0.25)", primary: "#9cff93", secondary: "#669dff",
  tertiary: "#ff7162", muted: "#adaaab", outline: "#767576",
  outlineVar: "#484849", gold: "#fbbf24", purple: "#a78bfa",
};

// ── UI Components ──────────────────────────────────────────────────────────
function Label({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: "9px", fontFamily: "Space Grotesk", letterSpacing: "0.16em",
      textTransform: "uppercase", color: C.outline,
    }}>
      {children}
    </span>
  );
}

function HealthIndicator({ status }: { status: "healthy" | "degraded" | "offline" }) {
  const colorMap = {
    healthy: C.primary,
    degraded: C.gold,
    offline: C.tertiary,
  };
  return (
    <div style={{
      display: "inline-flex",
      alignItems: "center",
      gap: "6px",
      padding: "4px 10px",
      borderRadius: "4px",
      background: C.cardHigh,
      border: `1px solid ${C.border}`,
    }}>
      <div style={{
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        backgroundColor: colorMap[status],
        boxShadow: `0 0 8px ${colorMap[status]}`,
      }} />
      <span style={{ fontSize: "10px", color: colorMap[status], fontFamily: "Space Grotesk", fontWeight: 500 }}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    </div>
  );
}

function StatCard({ label, value, sub, color }: {
  label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div style={{
      borderRadius: "6px",
      padding: "16px",
      display: "flex",
      flexDirection: "column",
      gap: "8px",
      background: C.card,
      border: `1px solid ${C.border}`,
    }}>
      <Label>{label}</Label>
      <div style={{
        fontSize: "24px",
        fontFamily: "JetBrains Mono, monospace",
        color: color ?? C.primary,
        lineHeight: 1.1,
        fontWeight: "bold",
      }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: "10px", color: C.muted }}>{sub}</div>}
    </div>
  );
}

function Pill({ children, active, onClick }: {
  children: React.ReactNode; active?: boolean; onClick?: () => void;
}) {
  return (
    <button onClick={onClick} style={{
      padding: "5px 14px",
      borderRadius: "20px",
      fontSize: "11px",
      fontFamily: "Space Grotesk",
      fontWeight: active ? 600 : 400,
      background: active ? C.primary : C.cardHigh,
      color: active ? "#0e0e0f" : C.muted,
      border: `1px solid ${active ? C.primary : C.outlineVar}`,
      cursor: "pointer",
      transition: "all 0.15s",
    }}>
      {children}
    </button>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function MCPSignalsPage() {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [filterAction, setFilterAction] = useState<"all" | "approve" | "reject" | "modify">("all");

  const statsQuery = useMCPStats();
  const decisionsQuery = useMCPDecisions(100);
  const healthQuery = useMCPHealth();

  const rawStats = statsQuery.data;
  const stats = {
    totalProcessed: rawStats?.ingestion?.totalReceived ?? 0,
    accepted: rawStats?.ingestion?.totalAccepted ?? 0,
    rejected: rawStats?.ingestion?.totalRejected ?? 0,
    approvalRate: rawStats?.approvalRate ?? 0,
    bySignalType: rawStats?.ingestion?.bySignalType ?? {},
    bySymbol: rawStats?.ingestion?.bySymbol ?? {},
  };
  const decisions: MCPDecisionSummary[] = (decisionsQuery.data as any)?.decisions ?? [];
  const healthStatus = (healthQuery.data as any)?.status ?? "offline";

  // Filter decisions
  const filteredDecisions = filterAction === "all"
    ? decisions
    : decisions.filter(d => d.action === filterAction);

  // Build signal type chart data
  const signalTypeMap = decisions.reduce((acc, d) => {
    const type = d.direction.toUpperCase();
    if (!acc[type]) acc[type] = { type, count: 0 };
    acc[type].count += 1;
    return acc;
  }, {} as Record<string, any>);
  const signalTypeData = Object.values(signalTypeMap);

  // Build symbol chart data (top 10 symbols)
  const symbolMap = decisions.reduce((acc, d) => {
    if (!acc[d.symbol]) acc[d.symbol] = { symbol: d.symbol, count: 0 };
    acc[d.symbol].count += 1;
    return acc;
  }, {} as Record<string, any>);
  const symbolData = Object.values(symbolMap)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Action colors
  const actionColorMap = {
    approve: C.primary,
    reject: C.tertiary,
    modify: C.gold,
  };

  return (
    <div style={{ paddingBottom: "40px" }}>
      {/* Header */}
      <div style={{ marginBottom: "40px" }}>
        <div style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", letterSpacing: "0.25em", textTransform: "uppercase", marginBottom: "12px" }}>
          Godsview · Signal Intelligence
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "24px", marginBottom: "12px" }}>
          <h1 style={{ fontSize: "32px", fontWeight: "bold", margin: 0, color: "#ffffff" }}>MCP Signal Flow</h1>
          <HealthIndicator status={healthStatus} />
        </div>
        <p style={{
          fontSize: "11px",
          color: C.muted,
          marginTop: "8px",
          maxWidth: "780px",
          margin: 0,
          marginTop: "8px",
        }}>
          Real-time MCP signal processing pipeline. View approval decisions, confidence scores, and detailed analysis per signal.
        </p>
      </div>

      {/* Stats Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "32px" }}>
        <StatCard label="Total Processed" value={stats.totalProcessed} color={C.secondary} />
        <StatCard label="Accepted" value={stats.accepted} color={C.primary} />
        <StatCard label="Rejected" value={stats.rejected} color={C.tertiary} />
        <StatCard label="Approval Rate" value={`${(stats.approvalRate * 100).toFixed(1)}%`} color={C.gold} />
      </div>

      {/* Charts Row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "32px" }}>
        {/* Signal Type Chart */}
        <div style={{ borderRadius: "8px", padding: "20px", background: C.card, border: `1px solid ${C.border}` }}>
          <Label>Signal Breakdown by Type</Label>
          <div style={{ height: "280px", marginTop: "16px" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={signalTypeData}>
                <XAxis dataKey="type" tick={{ fill: C.muted, fontSize: 11 }} />
                <YAxis tick={{ fill: C.muted, fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: C.cardHigh, border: `1px solid ${C.border}`, borderRadius: "4px" }}
                  labelStyle={{ color: C.muted, fontSize: "11px" }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {signalTypeData.map((_, idx) => (
                    <Cell key={idx} fill={idx % 2 === 0 ? C.primary : C.secondary} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Symbol Chart */}
        <div style={{ borderRadius: "8px", padding: "20px", background: C.card, border: `1px solid ${C.border}` }}>
          <Label>Signal Breakdown by Symbol</Label>
          <div style={{ height: "280px", marginTop: "16px" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={symbolData}>
                <XAxis dataKey="symbol" tick={{ fill: C.muted, fontSize: 10 }} />
                <YAxis tick={{ fill: C.muted, fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: C.cardHigh, border: `1px solid ${C.border}`, borderRadius: "4px" }}
                  labelStyle={{ color: C.muted, fontSize: "11px" }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {symbolData.map((_, idx) => (
                    <Cell key={idx} fill={idx % 3 === 0 ? C.primary : idx % 3 === 1 ? C.secondary : C.purple} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Decisions Table */}
      <div style={{ borderRadius: "8px", padding: "20px", background: C.card, border: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
          <Label>Recent Decisions</Label>
          <div style={{ display: "flex", gap: "8px" }}>
            <Pill active={filterAction === "all"} onClick={() => setFilterAction("all")}>All</Pill>
            <Pill active={filterAction === "approve"} onClick={() => setFilterAction("approve")}>Approved</Pill>
            <Pill active={filterAction === "reject"} onClick={() => setFilterAction("reject")}>Rejected</Pill>
            <Pill active={filterAction === "modify"} onClick={() => setFilterAction("modify")}>Modified</Pill>
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                <th style={{ padding: "12px", textAlign: "left", color: C.outline, fontWeight: 500 }}>Signal ID</th>
                <th style={{ padding: "12px", textAlign: "left", color: C.outline, fontWeight: 500 }}>Symbol</th>
                <th style={{ padding: "12px", textAlign: "center", color: C.outline, fontWeight: 500 }}>Direction</th>
                <th style={{ padding: "12px", textAlign: "center", color: C.outline, fontWeight: 500 }}>Action</th>
                <th style={{ padding: "12px", textAlign: "center", color: C.outline, fontWeight: 500 }}>Grade</th>
                <th style={{ padding: "12px", textAlign: "right", color: C.outline, fontWeight: 500 }}>Overall Score</th>
                <th style={{ padding: "12px", textAlign: "right", color: C.outline, fontWeight: 500 }}>Confidence</th>
                <th style={{ padding: "12px", textAlign: "right", color: C.outline, fontWeight: 500 }}>Latency (ms)</th>
                <th style={{ padding: "12px", textAlign: "left", color: C.outline, fontWeight: 500 }}>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {filteredDecisions.map((decision) => {
                const isExpanded = expandedRows.has(decision.signalId);
                return (
                  <div key={decision.signalId}>
                    <tr
                      onClick={() => {
                        const newExpanded = new Set(expandedRows);
                        if (newExpanded.has(decision.signalId)) {
                          newExpanded.delete(decision.signalId);
                        } else {
                          newExpanded.add(decision.signalId);
                        }
                        setExpandedRows(newExpanded);
                      }}
                      style={{
                        borderBottom: `1px solid ${C.border}`,
                        cursor: "pointer",
                        backgroundColor: isExpanded ? C.cardHigh : "transparent",
                        transition: "background-color 0.2s",
                      }}>
                      <td style={{ padding: "12px", color: C.primary, fontFamily: "JetBrains Mono" }}>{decision.signalId}</td>
                      <td style={{ padding: "12px", color: "#ffffff", fontWeight: 500 }}>{decision.symbol}</td>
                      <td style={{ padding: "12px", textAlign: "center", color: decision.direction === "long" ? C.primary : C.tertiary }}>
                        {decision.direction.toUpperCase()}
                      </td>
                      <td style={{
                        padding: "12px",
                        textAlign: "center",
                        color: actionColorMap[decision.action],
                        fontWeight: 500,
                      }}>
                        {decision.action.charAt(0).toUpperCase() + decision.action.slice(1)}
                      </td>
                      <td style={{ padding: "12px", textAlign: "center", color: C.muted }}>{decision.grade}</td>
                      <td style={{ padding: "12px", textAlign: "right", color: C.secondary, fontFamily: "JetBrains Mono" }}>
                        {decision.overallScore.toFixed(2)}
                      </td>
                      <td style={{ padding: "12px", textAlign: "right", color: C.gold, fontFamily: "JetBrains Mono" }}>
                        {(decision.confidence * 100).toFixed(1)}%
                      </td>
                      <td style={{ padding: "12px", textAlign: "right", color: C.muted, fontFamily: "JetBrains Mono" }}>
                        {decision.processingMs}
                      </td>
                      <td style={{ padding: "12px", color: C.muted, fontSize: "10px" }}>
                        {new Date(decision.timestamp).toLocaleString()}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr style={{ backgroundColor: C.cardHigh, borderBottom: `1px solid ${C.border}` }}>
                        <td colSpan={9} style={{ padding: "16px" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
                            {/* Thesis */}
                            {decision.thesis && (
                              <div>
                                <Label>Thesis</Label>
                                <div style={{ marginTop: "8px", color: C.muted, fontSize: "10px", lineHeight: 1.5 }}>
                                  {decision.thesis}
                                </div>
                              </div>
                            )}

                            {/* Score Breakdown */}
                            {decision.scoreBreakdown && Object.keys(decision.scoreBreakdown).length > 0 && (
                              <div>
                                <Label>Score Breakdown</Label>
                                <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "4px" }}>
                                  {Object.entries(decision.scoreBreakdown).map(([key, val]) => (
                                    <div key={key} style={{ display: "flex", justifyContent: "space-between", fontSize: "10px" }}>
                                      <span style={{ color: C.muted }}>{key}</span>
                                      <span style={{ color: C.primary, fontFamily: "JetBrains Mono", fontWeight: 500 }}>
                                        {(val as number).toFixed(2)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Warnings */}
                            {decision.warnings && decision.warnings.length > 0 && (
                              <div>
                                <Label>Warnings</Label>
                                <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "4px" }}>
                                  {decision.warnings.map((w, idx) => (
                                    <div key={idx} style={{ fontSize: "10px", color: C.tertiary, display: "flex", gap: "4px" }}>
                                      <span>⚠</span>
                                      <span>{w}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Boosters */}
                            {decision.boosters && decision.boosters.length > 0 && (
                              <div>
                                <Label>Boosters</Label>
                                <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "4px" }}>
                                  {decision.boosters.map((b, idx) => (
                                    <div key={idx} style={{ fontSize: "10px", color: C.primary, display: "flex", gap: "4px" }}>
                                      <span>✓</span>
                                      <span>{b}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </div>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredDecisions.length === 0 && (
          <div style={{ padding: "32px", textAlign: "center", color: C.muted }}>
            <span style={{ fontSize: "11px" }}>No decisions found for the selected filter.</span>
          </div>
        )}
      </div>
    </div>
  );
}
