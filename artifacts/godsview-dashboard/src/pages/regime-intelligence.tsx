import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";

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

const API_BASE = import.meta.env.VITE_API_URL || "/api";

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

// Types
interface RegimeState {
  currentRegime: "trend_up" | "trend_down" | "range" | "compression" | "expansion" | "chaotic";
  confidence: number;
  durationMinutes: number;
  regimeHistory: Array<{
    regime: string;
    durationMinutes: number;
    timestamp: string;
  }>;
}

interface RegimeProfile {
  name: string;
  allowedSignals: string[];
  blockedSignals: string[];
  riskMultiplier: number;
  maxPositions: number;
  winRate: number;
}

interface MTFTimeframe {
  timeframe: string;
  trend: "up" | "down" | "neutral";
  momentum: number;
  volumeConfirmed: boolean;
  aligned: boolean;
}

interface MTFData {
  confluenceScore: number;
  timeframes: MTFTimeframe[];
}

interface DimensionPerformance {
  dimension: string;
  power: number;
}

interface ParameterChange {
  timestamp: string;
  parameter: string;
  oldValue: string;
  newValue: string;
  reason: string;
}

interface OptimizerState {
  confirmationScore: number;
  confirmationScoreDefault: number;
  weights: Record<string, number>;
  riskPerTrade: number;
  riskPerTradeDefault: number;
  dimensionPerformance: DimensionPerformance[];
  recentChanges: ParameterChange[];
}

// Mock data
const mockRegimeState: RegimeState = {
  currentRegime: "trend_up",
  confidence: 87,
  durationMinutes: 342,
  regimeHistory: [
    { regime: "range", durationMinutes: 180, timestamp: "2026-04-06T08:30:00Z" },
    { regime: "trend_down", durationMinutes: 120, timestamp: "2026-04-06T10:30:00Z" },
    { regime: "compression", durationMinutes: 90, timestamp: "2026-04-06T12:30:00Z" },
    { regime: "trend_up", durationMinutes: 342, timestamp: "2026-04-06T14:00:00Z" },
  ],
};

const mockRegimeProfiles: Record<string, RegimeProfile> = {
  trend_up: {
    name: "Trend Up",
    allowedSignals: ["breakout", "momentum", "rsi_oversold"],
    blockedSignals: ["reversal", "support_bounce"],
    riskMultiplier: 1.2,
    maxPositions: 5,
    winRate: 0.68,
  },
  trend_down: {
    name: "Trend Down",
    allowedSignals: ["breakdown", "shorting", "rsi_overbought"],
    blockedSignals: ["long_entry", "support_bounce"],
    riskMultiplier: 1.15,
    maxPositions: 4,
    winRate: 0.64,
  },
  range: {
    name: "Range",
    allowedSignals: ["mean_reversion", "support_bounce", "resistance_touch"],
    blockedSignals: ["breakout", "momentum"],
    riskMultiplier: 0.85,
    maxPositions: 3,
    winRate: 0.71,
  },
  compression: {
    name: "Compression",
    allowedSignals: ["volatility_watch", "setup_formation"],
    blockedSignals: ["momentum", "trend_following"],
    riskMultiplier: 0.6,
    maxPositions: 2,
    winRate: 0.62,
  },
  expansion: {
    name: "Expansion",
    allowedSignals: ["volatility_play", "momentum", "breakout"],
    blockedSignals: ["mean_reversion"],
    riskMultiplier: 1.35,
    maxPositions: 4,
    winRate: 0.66,
  },
  chaotic: {
    name: "Chaotic",
    allowedSignals: [],
    blockedSignals: ["all"],
    riskMultiplier: 0.0,
    maxPositions: 0,
    winRate: 0.0,
  },
};

const mockMTFData: MTFData = {
  confluenceScore: 80,
  timeframes: [
    { timeframe: "1m", trend: "up", momentum: 62, volumeConfirmed: true, aligned: true },
    { timeframe: "5m", trend: "up", momentum: 71, volumeConfirmed: true, aligned: true },
    { timeframe: "15m", trend: "neutral", momentum: 48, volumeConfirmed: false, aligned: false },
    { timeframe: "1h", trend: "up", momentum: 65, volumeConfirmed: true, aligned: true },
    { timeframe: "1d", trend: "up", momentum: 58, volumeConfirmed: true, aligned: true },
  ],
};

const mockOptimizerState: OptimizerState = {
  confirmationScore: 0.65,
  confirmationScoreDefault: 0.6,
  weights: {
    structure: 0.28,
    orderflow: 0.22,
    context: 0.18,
    memory: 0.14,
    sentiment: 0.08,
    quality: 0.1,
  },
  riskPerTrade: 0.85,
  riskPerTradeDefault: 1.0,
  dimensionPerformance: [
    { dimension: "Structure", power: 0.89 },
    { dimension: "Orderflow", power: 0.76 },
    { dimension: "Context", power: 0.68 },
    { dimension: "Memory", power: 0.61 },
    { dimension: "Quality", power: 0.58 },
    { dimension: "Sentiment", power: 0.44 },
  ],
  recentChanges: [
    {
      timestamp: "2026-04-06T15:32:00Z",
      parameter: "Risk per Trade",
      oldValue: "1.00%",
      newValue: "0.85%",
      reason: "Reduced due to expansion regime volatility",
    },
    {
      timestamp: "2026-04-06T15:28:00Z",
      parameter: "Orderflow Weight",
      oldValue: "0.20",
      newValue: "0.22",
      reason: "Improved signal accuracy in trending markets",
    },
    {
      timestamp: "2026-04-06T15:20:00Z",
      parameter: "Confirmation Score",
      oldValue: "0.60",
      newValue: "0.65",
      reason: "High confidence regime detected",
    },
    {
      timestamp: "2026-04-06T15:10:00Z",
      parameter: "Structure Weight",
      oldValue: "0.26",
      newValue: "0.28",
      reason: "Structure signals performing well",
    },
    {
      timestamp: "2026-04-06T14:55:00Z",
      parameter: "Max Positions",
      oldValue: "4",
      newValue: "5",
      reason: "Trend regime expanded opportunity set",
    },
  ],
};

export default function RegimeIntelligencePage() {
  const [refreshTime, setRefreshTime] = useState<number>(0);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setRefreshTime((t) => t + 1);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const regimeQuery = useQuery({
    queryKey: ["regime", refreshTime],
    queryFn: () => apiFetch<RegimeState>("/regime/state"),
    staleTime: 4500,
    initialData: mockRegimeState,
  });

  const mtfQuery = useQuery({
    queryKey: ["mtf", refreshTime],
    queryFn: () => apiFetch<MTFData>("/regime/mtf"),
    staleTime: 4500,
    initialData: mockMTFData,
  });

  const optimizerQuery = useQuery({
    queryKey: ["optimizer", refreshTime],
    queryFn: () => apiFetch<OptimizerState>("/regime/optimizer"),
    staleTime: 4500,
    initialData: mockOptimizerState,
  });

  const regime = regimeQuery.data || mockRegimeState;
  const mtf = mtfQuery.data || mockMTFData;
  const optimizer = optimizerQuery.data || mockOptimizerState;

  const getRegimeIcon = (r: string) => {
    const icons: Record<string, string> = {
      trend_up: "📈",
      trend_down: "📉",
      range: "↔",
      compression: "🔄",
      expansion: "💥",
      chaotic: "⚠",
    };
    return icons[r] || "•";
  };

  const getRegimeLabel = (r: string) => {
    const labels: Record<string, string> = {
      trend_up: "Trend Up",
      trend_down: "Trend Down",
      range: "Range",
      compression: "Compression",
      expansion: "Expansion",
      chaotic: "Chaotic",
    };
    return labels[r] || r;
  };

  const getRegimeColor = (r: string) => {
    const colors: Record<string, string> = {
      trend_up: C.primary,
      trend_down: C.tertiary,
      range: C.gold,
      compression: C.purple,
      expansion: C.secondary,
      chaotic: C.tertiary,
    };
    return colors[r] || C.muted;
  };

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  const alignedCount = mtf.timeframes.filter((t) => t.aligned).length;

  return (
    <div style={{ backgroundColor: C.bg, color: "#fff", minHeight: "100vh", padding: "24px" }}>
      <h1 style={{ marginTop: 0, marginBottom: "32px", fontSize: "28px", fontWeight: 600 }}>
        Regime Intelligence
      </h1>

      {/* Section 1: Current Regime Banner */}
      <div
        style={{
          backgroundColor: getRegimeColor(regime.currentRegime),
          borderRadius: "8px",
          padding: "24px",
          marginBottom: "32px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "24px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div style={{ fontSize: "48px" }}>{getRegimeIcon(regime.currentRegime)}</div>
            <div>
              <div style={{ fontSize: "14px", opacity: 0.8, marginBottom: "4px" }}>
                Current Regime
              </div>
              <div style={{ fontSize: "32px", fontWeight: 700 }}>
                {getRegimeLabel(regime.currentRegime)}
              </div>
              <div style={{ fontSize: "12px", opacity: 0.75, marginTop: "4px" }}>
                Active for {formatDuration(regime.durationMinutes)}
              </div>
            </div>
          </div>

          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "12px", opacity: 0.8, marginBottom: "8px" }}>Confidence</div>
            <div
              style={{
                fontSize: "24px",
                fontWeight: 700,
                marginBottom: "8px",
                color: "#000",
              }}
            >
              {regime.confidence}%
            </div>
            <div
              style={{
                width: "200px",
                height: "6px",
                backgroundColor: "rgba(0,0,0,0.2)",
                borderRadius: "3px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${regime.confidence}%`,
                  height: "100%",
                  backgroundColor: "#000",
                  transition: "width 0.3s ease",
                }}
              />
            </div>
          </div>

          <div>
            <div style={{ fontSize: "12px", opacity: 0.8, marginBottom: "8px" }}>
              Regime History
            </div>
            <div
              style={{
                display: "flex",
                gap: "4px",
                justifyContent: "flex-end",
              }}
            >
              {regime.regimeHistory.slice(0, 12).map((h, i) => (
                <div
                  key={i}
                  style={{
                    width: "8px",
                    height: "24px",
                    backgroundColor: "rgba(0,0,0,0.3)",
                    borderRadius: "2px",
                    cursor: "pointer",
                    opacity: 0.6 + (i / 12) * 0.4,
                  }}
                  title={`${h.regime} (${formatDuration(h.durationMinutes)})`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Section 2: Regime Profiles Grid */}
      <div style={{ marginBottom: "32px" }}>
        <h2 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "16px", marginTop: 0 }}>
          Regime Profiles
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            gap: "16px",
          }}
        >
          {Object.entries(mockRegimeProfiles).map(([key, profile]) => (
            <div
              key={key}
              style={{
                backgroundColor: key === regime.currentRegime ? C.cardHigh : C.card,
                border: `1px solid ${
                  key === regime.currentRegime ? getRegimeColor(key) : C.border
                }`,
                borderRadius: "8px",
                padding: "16px",
                boxShadow: key === regime.currentRegime ? `0 0 12px ${getRegimeColor(key)}20` : "none",
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
                <div style={{ fontSize: "16px", fontWeight: 600 }}>{profile.name}</div>
                {key === regime.currentRegime && (
                  <div
                    style={{
                      fontSize: "12px",
                      padding: "4px 8px",
                      backgroundColor: getRegimeColor(key),
                      color: "#000",
                      borderRadius: "4px",
                      fontWeight: 600,
                    }}
                  >
                    ACTIVE
                  </div>
                )}
              </div>

              <div style={{ fontSize: "12px", marginBottom: "12px", opacity: 0.7 }}>
                <div style={{ marginBottom: "8px" }}>
                  <strong>Allowed:</strong>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "4px" }}>
                    {profile.allowedSignals.map((s) => (
                      <span
                        key={s}
                        style={{
                          padding: "2px 6px",
                          backgroundColor: `${C.primary}20`,
                          color: C.primary,
                          borderRadius: "3px",
                          fontSize: "10px",
                        }}
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <strong>Blocked:</strong>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "4px" }}>
                    {profile.blockedSignals.map((s) => (
                      <span
                        key={s}
                        style={{
                          padding: "2px 6px",
                          backgroundColor: `${C.tertiary}20`,
                          color: C.tertiary,
                          borderRadius: "3px",
                          fontSize: "10px",
                        }}
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div
                style={{
                  borderTop: `1px solid ${C.border}`,
                  paddingTop: "12px",
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "8px",
                  fontSize: "12px",
                }}
              >
                <div>
                  <div style={{ opacity: 0.6, marginBottom: "4px" }}>Risk Mult</div>
                  <div style={{ fontSize: "14px", fontWeight: 600 }}>
                    {profile.riskMultiplier.toFixed(2)}x
                  </div>
                </div>
                <div>
                  <div style={{ opacity: 0.6, marginBottom: "4px" }}>Max Pos</div>
                  <div style={{ fontSize: "14px", fontWeight: 600 }}>{profile.maxPositions}</div>
                </div>
                <div>
                  <div style={{ opacity: 0.6, marginBottom: "4px" }}>Win Rate</div>
                  <div style={{ fontSize: "14px", fontWeight: 600, color: C.primary }}>
                    {(profile.winRate * 100).toFixed(0)}%
                  </div>
                </div>
                <div>
                  <div style={{ opacity: 0.6, marginBottom: "4px" }}>Status</div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: key === regime.currentRegime ? C.primary : C.muted,
                    }}
                  >
                    {key === regime.currentRegime ? "Active" : "Inactive"}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Section 3: MTF Confluence Panel */}
      <div style={{ marginBottom: "32px" }}>
        <h2 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "16px", marginTop: 0 }}>
          Multi-Timeframe Confluence
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "300px 1fr",
            gap: "24px",
          }}
        >
          <div
            style={{
              backgroundColor: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: "8px",
              padding: "24px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div style={{ fontSize: "12px", opacity: 0.6, marginBottom: "12px" }}>
              Confluence Score
            </div>
            <div
              style={{
                fontSize: "48px",
                fontWeight: 700,
                color: C.primary,
                marginBottom: "4px",
              }}
            >
              {mtf.confluenceScore}%
            </div>
            <div style={{ fontSize: "12px", opacity: 0.6, marginBottom: "16px" }}>
              {alignedCount}/{mtf.timeframes.length} aligned
            </div>
            <div
              style={{
                width: "100%",
                height: "8px",
                backgroundColor: C.cardHigh,
                borderRadius: "4px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${mtf.confluenceScore}%`,
                  height: "100%",
                  backgroundColor: mtf.confluenceScore >= 75 ? C.primary : C.gold,
                }}
              />
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {mtf.timeframes.map((tf) => (
              <div
                key={tf.timeframe}
                style={{
                  backgroundColor: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: "6px",
                  padding: "12px",
                  display: "flex",
                  alignItems: "center",
                  gap: "16px",
                }}
              >
                <div style={{ minWidth: "40px", fontSize: "12px", fontWeight: 600 }}>
                  {tf.timeframe}
                </div>
                <div
                  style={{
                    flex: 1,
                    height: "4px",
                    backgroundColor: C.cardHigh,
                    borderRadius: "2px",
                    position: "relative",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: "0",
                      right: "0",
                      height: "100%",
                      backgroundColor: tf.aligned ? C.primary : C.tertiary,
                      width: `${tf.momentum}%`,
                      borderRadius: "2px",
                    }}
                  />
                </div>
                <div style={{ minWidth: "45px", textAlign: "right", fontSize: "12px" }}>
                  {tf.trend === "up" && "📈"}
                  {tf.trend === "down" && "📉"}
                  {tf.trend === "neutral" && "→"} {tf.momentum}%
                </div>
                <div style={{ minWidth: "20px", textAlign: "center", fontSize: "12px" }}>
                  {tf.volumeConfirmed ? "✓" : "✗"}
                </div>
                <div
                  style={{
                    minWidth: "60px",
                    textAlign: "right",
                    fontSize: "11px",
                    color: tf.aligned ? C.primary : C.tertiary,
                    fontWeight: 600,
                  }}
                >
                  {tf.aligned ? "Aligned" : "Conflict"}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div
          style={{
            marginTop: "16px",
            padding: "12px 16px",
            backgroundColor: C.cardHigh,
            borderRadius: "6px",
            fontSize: "13px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>
            <strong>Recommendation:</strong> Strong Confirm
          </span>
          <span style={{ color: C.primary, fontWeight: 600 }}>✓ Proceed</span>
        </div>
      </div>

      {/* Section 4: Adaptive Optimizer */}
      <div>
        <h2 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "16px", marginTop: 0 }}>
          Adaptive Optimizer
        </h2>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "24px" }}>
          {/* Parameters */}
          <div
            style={{
              backgroundColor: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: "8px",
              padding: "16px",
            }}
          >
            <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "16px" }}>
              Pipeline Parameters
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", fontSize: "13px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  paddingBottom: "8px",
                  borderBottom: `1px solid ${C.border}`,
                }}
              >
                <span>Min Confirmation Score</span>
                <div>
                  <span style={{ color: C.primary, fontWeight: 600 }}>
                    {optimizer.confirmationScore.toFixed(2)}
                  </span>
                  <span style={{ opacity: 0.5, marginLeft: "8px" }}>
                    (def: {optimizer.confirmationScoreDefault.toFixed(2)})
                  </span>
                  <span
                    style={{
                      marginLeft: "8px",
                      color:
                        optimizer.confirmationScore > optimizer.confirmationScoreDefault
                          ? C.primary
                          : C.tertiary,
                    }}
                  >
                    {optimizer.confirmationScore > optimizer.confirmationScoreDefault ? "↑" : "↓"}
                  </span>
                </div>
              </div>

              <div style={{ fontSize: "12px", fontWeight: 600, marginTop: "8px" }}>Weights</div>
              {Object.entries(optimizer.weights).map(([dim, weight]) => (
                <div
                  key={dim}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    paddingLeft: "8px",
                  }}
                >
                  <span style={{ opacity: 0.8 }}>{dim}</span>
                  <span style={{ color: C.secondary, fontWeight: 600 }}>
                    {(weight * 100).toFixed(0)}%
                  </span>
                </div>
              ))}

              <div
                style={{
                  paddingTop: "12px",
                  marginTop: "8px",
                  borderTop: `1px solid ${C.border}`,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    paddingBottom: "8px",
                  }}
                >
                  <span>Risk per Trade</span>
                  <div>
                    <span style={{ color: C.primary, fontWeight: 600 }}>
                      {optimizer.riskPerTrade.toFixed(2)}%
                    </span>
                    <span style={{ opacity: 0.5, marginLeft: "8px" }}>
                      (def: {optimizer.riskPerTradeDefault.toFixed(2)}%)
                    </span>
                    <span
                      style={{
                        marginLeft: "8px",
                        color:
                          optimizer.riskPerTrade < optimizer.riskPerTradeDefault
                            ? C.tertiary
                            : C.primary,
                      }}
                    >
                      {optimizer.riskPerTrade < optimizer.riskPerTradeDefault ? "↓" : "↑"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Dimension Performance Chart */}
          <div
            style={{
              backgroundColor: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: "8px",
              padding: "16px",
            }}
          >
            <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "16px" }}>
              Dimension Performance
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={optimizer.dimensionPerformance}>
                <XAxis
                  dataKey="dimension"
                  tick={{ fontSize: 11, fill: C.muted }}
                  axisLine={{ stroke: C.border }}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: C.muted }}
                  axisLine={{ stroke: C.border }}
                  domain={[0, 1]}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: C.cardHigh,
                    border: `1px solid ${C.border}`,
                    borderRadius: "4px",
                  }}
                  formatter={(value) => [(value as number).toFixed(2), "Power"]}
                />
                <Bar dataKey="power" radius={[4, 4, 0, 0]}>
                  {optimizer.dimensionPerformance.map((_, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={
                        optimizer.dimensionPerformance[index].power > 0.7
                          ? C.primary
                          : optimizer.dimensionPerformance[index].power > 0.5
                            ? C.gold
                            : C.tertiary
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Parameter Changes Log */}
        <div
          style={{
            backgroundColor: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: "8px",
            padding: "16px",
          }}
        >
          <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "12px" }}>
            Recent Parameter Changes
          </div>
          <div
            style={{
              maxHeight: "320px",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            {optimizer.recentChanges.map((change, i) => (
              <div
                key={i}
                style={{
                  backgroundColor: C.cardHigh,
                  border: `1px solid ${C.border}`,
                  borderRadius: "4px",
                  padding: "12px",
                  fontSize: "12px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: "6px",
                  }}
                >
                  <strong style={{ color: C.secondary }}>{change.parameter}</strong>
                  <span style={{ opacity: 0.5, fontSize: "11px" }}>
                    {new Date(change.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div style={{ opacity: 0.7, marginBottom: "4px" }}>
                  <span style={{ color: C.tertiary }}>{change.oldValue}</span>
                  <span style={{ margin: "0 6px" }}>→</span>
                  <span style={{ color: C.primary }}>{change.newValue}</span>
                </div>
                <div style={{ opacity: 0.6, fontSize: "11px" }}>{change.reason}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Auto-refresh indicator */}
      <div
        style={{
          marginTop: "32px",
          textAlign: "center",
          fontSize: "11px",
          opacity: 0.5,
        }}
      >
        Auto-refreshing every 5 seconds • Last update: {new Date().toLocaleTimeString()}
      </div>
    </div>
  );
}
