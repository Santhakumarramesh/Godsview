/**
 * pages/capital-gating.tsx — Capital Gating & Controlled Launch Dashboard
 *
 * Phase 117: Final phase before live trading
 * Rich UI for managing capital tiers, strategy promotion/demotion,
 * launch planning, and pre-launch safety checks
 */

import { useEffect, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";

const C = {
  bg: "#0e0e0f",
  card: "#1a191b",
  cardHigh: "#201f21",
  border: "rgba(72,72,73,0.25)",
  borderMuted: "rgba(72,72,73,0.15)",
  primary: "#9cff93",
  secondary: "#669dff",
  tertiary: "#ff7162",
  success: "#4ade80",
  warning: "#facc15",
  error: "#ef4444",
  muted: "#adaaab",
  outline: "#767576",
  outlineVar: "#484849",
};

const tierColors = ["#6b7280", "#4ade80", "#3b82f6", "#8b5cf6", "#ec4899", "#f97316"];
const tierNames = ["Paper Only", "Micro Live", "Small Live", "Standard Live", "Full Allocation", "Autonomous"];

// ─── Types ────────────────────────────────────────────────────────────────────

interface StrategyTierInfo {
  strategyId: string;
  name: string;
  currentTier: number;
  allocatedCapital: number;
  daysInTier: number;
  lastPromotionDate?: number;
  metrics: {
    trades: number;
    sharpeRatio: number;
    maxDrawdown: number;
    profitFactor: number;
    winRate: number;
  };
}

interface TierBreakdown {
  tier: number;
  tierName: string;
  strategies: StrategyTierInfo[];
  totalCapitalAllocated: number;
  strategyCount: number;
}

interface LaunchMetrics {
  timestamp: number;
  totalPnL: number;
  maxDrawdown: number;
  avgFillQuality: number;
  avgSlippage: number;
  tradeCount: number;
  winRate: number;
  activePhasePnL: number;
}

interface PreLaunchChecklistItem {
  name: string;
  status: "pass" | "fail" | "warning";
  detail: string;
}

interface PreLaunchChecklist {
  timestamp: number;
  allPass: boolean;
  items: PreLaunchChecklistItem[];
}

// ─── Utility Functions ────────────────────────────────────────────────────────

function formatCurrency(value: number): string {
  return `$${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function getStatusColor(status: string): string {
  switch (status) {
    case "pass":
      return C.success;
    case "fail":
      return C.error;
    case "warning":
      return C.warning;
    default:
      return C.muted;
  }
}

// ─── Components ───────────────────────────────────────────────────────────────

function TierPyramid({ breakdown }: { breakdown: TierBreakdown[] }) {
  const reversedBreakdown = [...breakdown].reverse(); // 5 to 0

  return (
    <div
      style={{
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: "12px",
        padding: "20px",
        marginBottom: "20px",
      }}
    >
      <h3 style={{ color: C.primary, marginBottom: "20px", fontSize: "14px", fontWeight: "600" }}>
        CAPITAL TIER PYRAMID
      </h3>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {reversedBreakdown.map((tier, idx) => {
          const pyramidIdx = 5 - idx;
          const width = 100 - pyramidIdx * 15;
          const isActive = tier.strategyCount > 0;

          return (
            <div key={tier.tier}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  marginBottom: "4px",
                }}
              >
                <div
                  style={{
                    width: "32px",
                    height: "32px",
                    backgroundColor: tierColors[tier.tier],
                    borderRadius: "6px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "12px",
                    fontWeight: "bold",
                    color: "#000",
                  }}
                >
                  T{tier.tier}
                </div>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: "13px",
                      fontWeight: "600",
                      color: C.muted,
                    }}
                  >
                    {tier.tierName}
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      color: C.outline,
                    }}
                  >
                    {tier.strategyCount} strateg{tier.strategyCount === 1 ? "y" : "ies"} — {formatCurrency(tier.totalCapitalAllocated)}
                  </div>
                </div>
              </div>

              {/* Progress bar */}
              <div
                style={{
                  width: `${width}%`,
                  height: "6px",
                  backgroundColor: tierColors[tier.tier],
                  borderRadius: "3px",
                  opacity: isActive ? 1 : 0.3,
                  marginLeft: `${(100 - width) / 2}%`,
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StrategyTierTable({ tiers }: { tiers: StrategyTierInfo[] }) {
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [demotingId, setDemotingId] = useState<string | null>(null);

  const handlePromote = async (strategyId: string) => {
    setPromotingId(strategyId);
    try {
      const response = await fetch(`/api/capital-gating/tiers/${strategyId}/promote`, {
        method: "POST",
      });
      const result = await response.json();
      alert(result.message);
      // In production: refetch data
    } catch (error) {
      alert("Failed to promote strategy");
    } finally {
      setPromotingId(null);
    }
  };

  const handleDemote = async (strategyId: string) => {
    const reason = prompt("Demotion reason:");
    if (!reason) return;

    setDemotingId(strategyId);
    try {
      const response = await fetch(`/api/capital-gating/tiers/${strategyId}/demote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const result = await response.json();
      alert(result.message);
    } catch (error) {
      alert("Failed to demote strategy");
    } finally {
      setDemotingId(null);
    }
  };

  return (
    <div
      style={{
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: "12px",
        padding: "20px",
        marginBottom: "20px",
      }}
    >
      <h3 style={{ color: C.primary, marginBottom: "16px", fontSize: "14px", fontWeight: "600" }}>
        STRATEGY TIER ASSIGNMENTS
      </h3>

      <div
        style={{
          overflowX: "auto",
          borderRadius: "8px",
          border: `1px solid ${C.borderMuted}`,
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "12px",
          }}
        >
          <thead>
            <tr style={{ backgroundColor: C.cardHigh, borderBottom: `1px solid ${C.borderMuted}` }}>
              <th style={{ padding: "12px 16px", textAlign: "left", color: C.outline, fontWeight: "600" }}>Strategy</th>
              <th style={{ padding: "12px 16px", textAlign: "center", color: C.outline, fontWeight: "600" }}>Tier</th>
              <th style={{ padding: "12px 16px", textAlign: "right", color: C.outline, fontWeight: "600" }}>Capital</th>
              <th style={{ padding: "12px 16px", textAlign: "center", color: C.outline, fontWeight: "600" }}>Trades</th>
              <th style={{ padding: "12px 16px", textAlign: "center", color: C.outline, fontWeight: "600" }}>Sharpe</th>
              <th style={{ padding: "12px 16px", textAlign: "center", color: C.outline, fontWeight: "600" }}>Max DD</th>
              <th style={{ padding: "12px 16px", textAlign: "center", color: C.outline, fontWeight: "600" }}>PnL Factor</th>
              <th style={{ padding: "12px 16px", textAlign: "center", color: C.outline, fontWeight: "600" }}>Days in Tier</th>
              <th style={{ padding: "12px 16px", textAlign: "center", color: C.outline, fontWeight: "600" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((strategy) => (
              <tr
                key={strategy.strategyId}
                style={{
                  borderBottom: `1px solid ${C.borderMuted}`,
                  backgroundColor: C.card,
                  transition: "background-color 0.2s",
                }}
              >
                <td style={{ padding: "12px 16px", color: C.muted }}>
                  <div style={{ fontWeight: "600" }}>{strategy.name}</div>
                  <div style={{ fontSize: "10px", color: C.outline }}>{strategy.strategyId}</div>
                </td>
                <td style={{ padding: "12px 16px", textAlign: "center" }}>
                  <div
                    style={{
                      display: "inline-block",
                      backgroundColor: tierColors[strategy.currentTier],
                      color: "#000",
                      padding: "4px 8px",
                      borderRadius: "4px",
                      fontWeight: "bold",
                      fontSize: "11px",
                    }}
                  >
                    {tierNames[strategy.currentTier]}
                  </div>
                </td>
                <td style={{ padding: "12px 16px", textAlign: "right", color: C.primary, fontWeight: "600" }}>
                  {formatCurrency(strategy.allocatedCapital)}
                </td>
                <td style={{ padding: "12px 16px", textAlign: "center", color: C.muted }}>
                  {strategy.metrics.trades}
                </td>
                <td style={{ padding: "12px 16px", textAlign: "center", color: C.muted }}>
                  {strategy.metrics.sharpeRatio.toFixed(2)}
                </td>
                <td
                  style={{
                    padding: "12px 16px",
                    textAlign: "center",
                    color: strategy.metrics.maxDrawdown > 0.05 ? C.warning : C.muted,
                  }}
                >
                  {formatPercent(strategy.metrics.maxDrawdown)}
                </td>
                <td style={{ padding: "12px 16px", textAlign: "center", color: C.muted }}>
                  {strategy.metrics.profitFactor.toFixed(2)}
                </td>
                <td style={{ padding: "12px 16px", textAlign: "center", color: C.muted }}>
                  {strategy.daysInTier}d
                </td>
                <td style={{ padding: "12px 16px", textAlign: "center" }}>
                  <div style={{ display: "flex", gap: "4px", justifyContent: "center" }}>
                    {strategy.currentTier < 5 && (
                      <button
                        onClick={() => handlePromote(strategy.strategyId)}
                        disabled={promotingId === strategy.strategyId}
                        style={{
                          padding: "4px 8px",
                          backgroundColor: C.secondary,
                          color: "#000",
                          border: "none",
                          borderRadius: "4px",
                          fontSize: "10px",
                          fontWeight: "600",
                          cursor: "pointer",
                          opacity: promotingId === strategy.strategyId ? 0.6 : 1,
                        }}
                      >
                        Promote
                      </button>
                    )}
                    {strategy.currentTier > 0 && (
                      <button
                        onClick={() => handleDemote(strategy.strategyId)}
                        disabled={demotingId === strategy.strategyId}
                        style={{
                          padding: "4px 8px",
                          backgroundColor: C.warning,
                          color: "#000",
                          border: "none",
                          borderRadius: "4px",
                          fontSize: "10px",
                          fontWeight: "600",
                          cursor: "pointer",
                          opacity: demotingId === strategy.strategyId ? 0.6 : 1,
                        }}
                      >
                        Demote
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LaunchControlCenter({
  status,
  metrics,
  rampSchedule,
}: {
  status: string;
  metrics: LaunchMetrics | null;
  rampSchedule: number[];
}) {
  const [advancing, setAdvancing] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [aborting, setAborting] = useState(false);

  const handleAdvance = async () => {
    setAdvancing(true);
    try {
      const response = await fetch("/api/capital-gating/launch/advance", { method: "POST" });
      const result = await response.json();
      alert(result.message);
    } catch (error) {
      alert("Failed to advance phase");
    } finally {
      setAdvancing(false);
    }
  };

  const handlePause = async () => {
    const reason = prompt("Pause reason:");
    if (!reason) return;
    setPausing(true);
    try {
      const response = await fetch("/api/capital-gating/launch/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const result = await response.json();
      alert(result.message);
    } catch (error) {
      alert("Failed to pause launch");
    } finally {
      setPausing(false);
    }
  };

  const handleAbort = async () => {
    if (!confirm("Are you sure you want to abort the launch? This will close all positions.")) return;
    const reason = prompt("Abort reason:");
    if (!reason) return;
    setAborting(true);
    try {
      const response = await fetch("/api/capital-gating/launch/abort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const result = await response.json();
      alert(result.message);
    } catch (error) {
      alert("Failed to abort launch");
    } finally {
      setAborting(false);
    }
  };

  const statusColorMap: Record<string, string> = {
    pre_launch: C.outline,
    ramping: C.warning,
    steady_state: C.success,
    paused: C.warning,
    aborted: C.error,
  };
  const statusColor = statusColorMap[status as keyof typeof statusColorMap] || C.muted;

  return (
    <div
      style={{
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: "12px",
        padding: "20px",
        marginBottom: "20px",
      }}
    >
      <div style={{ marginBottom: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
          <h3 style={{ color: C.primary, fontSize: "14px", fontWeight: "600", margin: 0 }}>
            LAUNCH CONTROL CENTER
          </h3>
          <div
            style={{
              display: "inline-block",
              backgroundColor: statusColor,
              color: status === "aborted" ? "#fff" : "#000",
              padding: "4px 12px",
              borderRadius: "4px",
              fontSize: "11px",
              fontWeight: "bold",
              textTransform: "uppercase",
            }}
          >
            {status.replace(/_/g, " ")}
          </div>
        </div>

        {/* Ramp schedule */}
        {rampSchedule.length > 0 && (
          <div style={{ marginBottom: "16px" }}>
            <div style={{ fontSize: "11px", color: C.outline, marginBottom: "8px", fontWeight: "600" }}>
              CAPITAL RAMP SCHEDULE
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              {rampSchedule.map((ramp, idx) => (
                <div
                  key={idx}
                  style={{
                    flex: 1,
                    backgroundColor: C.cardHigh,
                    border: `1px solid ${C.borderMuted}`,
                    borderRadius: "6px",
                    padding: "12px",
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: "10px", color: C.outline, marginBottom: "4px" }}>Phase {idx + 1}</div>
                  <div style={{ fontSize: "16px", fontWeight: "bold", color: C.primary }}>
                    {Math.round(ramp * 100)}%
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Metrics snapshot */}
        {metrics && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
              gap: "12px",
            }}
          >
            <MetricCard label="Total P&L" value={formatCurrency(metrics.totalPnL)} color={metrics.totalPnL >= 0 ? C.success : C.error} />
            <MetricCard label="Max Drawdown" value={formatPercent(metrics.maxDrawdown)} color={C.warning} />
            <MetricCard label="Fill Quality" value={formatPercent(metrics.avgFillQuality)} color={C.secondary} />
            <MetricCard label="Slippage" value={formatPercent(metrics.avgSlippage)} color={C.muted} />
            <MetricCard label="Trades" value={`${metrics.tradeCount}`} color={C.muted} />
            <MetricCard label="Win Rate" value={formatPercent(metrics.winRate)} color={metrics.winRate > 0.55 ? C.success : C.warning} />
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <button
          onClick={handleAdvance}
          disabled={advancing || status !== "pre_launch"}
          style={{
            padding: "8px 16px",
            backgroundColor: C.secondary,
            color: "#000",
            border: "none",
            borderRadius: "6px",
            fontSize: "12px",
            fontWeight: "600",
            cursor: "pointer",
            opacity: advancing ? 0.6 : 1,
          }}
        >
          {advancing ? "Advancing..." : "Advance Phase"}
        </button>
        <button
          onClick={handlePause}
          disabled={pausing || status === "paused" || status === "aborted"}
          style={{
            padding: "8px 16px",
            backgroundColor: C.warning,
            color: "#000",
            border: "none",
            borderRadius: "6px",
            fontSize: "12px",
            fontWeight: "600",
            cursor: "pointer",
            opacity: pausing ? 0.6 : 1,
          }}
        >
          {pausing ? "Pausing..." : "Pause Launch"}
        </button>
        <button
          onClick={handleAbort}
          disabled={aborting || status === "aborted"}
          style={{
            padding: "8px 16px",
            backgroundColor: C.error,
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            fontSize: "12px",
            fontWeight: "600",
            cursor: "pointer",
            opacity: aborting ? 0.6 : 1,
          }}
        >
          {aborting ? "Aborting..." : "Abort Launch"}
        </button>
      </div>
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        backgroundColor: C.cardHigh,
        border: `1px solid ${C.borderMuted}`,
        borderRadius: "6px",
        padding: "12px",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: "10px", color: C.outline, marginBottom: "4px", fontWeight: "600" }}>
        {label}
      </div>
      <div style={{ fontSize: "14px", fontWeight: "bold", color }}>{value}</div>
    </div>
  );
}

function CapitalProtectionDashboard({ checklist }: { checklist: PreLaunchChecklist | null }) {
  const [halting, setHalting] = useState(false);

  const handleEmergencyHalt = async () => {
    if (!confirm("EMERGENCY HALT: All trading will immediately stop. Are you absolutely sure?")) return;
    if (!confirm("This is your FINAL confirmation. Emergency halt cannot be undone without manual restart.")) return;

    const reason = prompt("Emergency halt reason (required):");
    if (!reason) return;

    setHalting(true);
    try {
      const response = await fetch("/api/capital-gating/protection/emergency-halt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const result = await response.json();
      alert(result.message);
    } catch (error) {
      alert("Failed to trigger emergency halt");
    } finally {
      setHalting(false);
    }
  };

  return (
    <div
      style={{
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: "12px",
        padding: "20px",
        marginBottom: "20px",
      }}
    >
      <h3 style={{ color: C.primary, marginBottom: "16px", fontSize: "14px", fontWeight: "600" }}>
        CAPITAL PROTECTION DASHBOARD
      </h3>

      {checklist && (
        <div style={{ marginBottom: "20px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "16px",
              padding: "12px",
              backgroundColor: checklist.allPass ? "rgba(74, 222, 128, 0.1)" : "rgba(239, 68, 68, 0.1)",
              borderRadius: "8px",
              border: `1px solid ${checklist.allPass ? C.success : C.error}`,
            }}
          >
            <div
              style={{
                width: "12px",
                height: "12px",
                backgroundColor: checklist.allPass ? C.success : C.error,
                borderRadius: "50%",
              }}
            />
            <span style={{ color: checklist.allPass ? C.success : C.error, fontWeight: "600", fontSize: "12px" }}>
              {checklist.allPass ? "All Checks Passed" : "Some Checks Failed"}
            </span>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
              gap: "12px",
            }}
          >
            {checklist.items.map((item, idx) => (
              <div
                key={idx}
                style={{
                  backgroundColor: C.cardHigh,
                  border: `1px solid ${C.borderMuted}`,
                  borderRadius: "6px",
                  padding: "12px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    marginBottom: "6px",
                  }}
                >
                  <div
                    style={{
                      width: "8px",
                      height: "8px",
                      backgroundColor: getStatusColor(item.status),
                      borderRadius: "50%",
                    }}
                  />
                  <span style={{ color: C.muted, fontWeight: "600", fontSize: "12px" }}>
                    {item.name}
                  </span>
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: "10px",
                      fontWeight: "bold",
                      color: getStatusColor(item.status),
                      textTransform: "uppercase",
                    }}
                  >
                    {item.status}
                  </span>
                </div>
                <div style={{ fontSize: "11px", color: C.outline, lineHeight: "1.4" }}>
                  {item.detail}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={handleEmergencyHalt}
        disabled={halting}
        style={{
          width: "100%",
          padding: "12px",
          backgroundColor: C.error,
          color: "#fff",
          border: "none",
          borderRadius: "6px",
          fontSize: "12px",
          fontWeight: "bold",
          cursor: "pointer",
          opacity: halting ? 0.6 : 1,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
        }}
      >
        {halting ? "Halting..." : "EMERGENCY HALT - KILL ALL TRADES"}
      </button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CapitalGatingPage() {
  const [breakdown, setBreakdown] = useState<TierBreakdown[]>([]);
  const [allStrategies, setAllStrategies] = useState<StrategyTierInfo[]>([]);
  const [launchStatus, setLaunchStatus] = useState<string>("pre_launch");
  const [launchMetrics, setLaunchMetrics] = useState<LaunchMetrics | null>(null);
  const [rampSchedule, setRampSchedule] = useState<number[]>([]);
  const [checklist, setChecklist] = useState<PreLaunchChecklist | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [tierRes, statusRes, metricsRes, rampRes, checklistRes] = await Promise.all([
          fetch("/api/capital-gating/tiers"),
          fetch("/api/capital-gating/launch/status"),
          fetch("/api/capital-gating/launch/metrics"),
          fetch("/api/capital-gating/launch/ramp"),
          fetch("/api/capital-gating/protection/checklist"),
        ]);

        const tierData = await tierRes.json();
        const statusData = await statusRes.json();
        const metricsData = await metricsRes.json();
        const rampData = await rampRes.json();
        const checklistData = await checklistRes.json();

        setBreakdown(tierData.data || []);

        // Flatten all strategies
        if (tierData.data) {
          const all = tierData.data.flatMap((t: TierBreakdown) => t.strategies);
          setAllStrategies(all);
        }

        setLaunchStatus(statusData.data?.status || "pre_launch");
        setLaunchMetrics(metricsData.data || null);
        setRampSchedule(rampData.data?.schedule || []);
        setChecklist(checklistData.data || null);
      } catch (error) {
        console.error("Error fetching capital gating data:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div
        style={{
          backgroundColor: C.bg,
          color: C.muted,
          padding: "40px",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "14px",
        }}
      >
        Loading capital gating dashboard...
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: C.bg, color: C.muted, padding: "20px", minHeight: "100vh" }}>
      <div style={{ maxWidth: "1600px", margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: "32px" }}>
          <h1
            style={{
              fontSize: "28px",
              fontWeight: "bold",
              color: C.primary,
              margin: 0,
              marginBottom: "8px",
            }}
          >
            Capital Gating & Controlled Launch
          </h1>
          <p
            style={{
              fontSize: "13px",
              color: C.outline,
              margin: 0,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            Phase 117 — Final Safety Layer Before Live Trading
          </p>
        </div>

        {/* Tier Pyramid Overview */}
        {breakdown.length > 0 && <TierPyramid breakdown={breakdown} />}

        {/* Strategy Table */}
        {allStrategies.length > 0 && <StrategyTierTable tiers={allStrategies} />}

        {/* Launch Control Center */}
        <LaunchControlCenter status={launchStatus} metrics={launchMetrics} rampSchedule={rampSchedule} />

        {/* Capital Protection Dashboard */}
        <CapitalProtectionDashboard checklist={checklist} />
      </div>
    </div>
  );
}
