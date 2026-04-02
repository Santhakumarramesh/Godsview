import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

// ─── Types ───────────────────────────────────────────────────────────────────
type Regime = "BALANCED" | "VOLATILE" | "TRENDING" | "EXTREME" | "REVERSAL";
type SessionTime = "NY Morning" | "London Open" | "Asian" | "All Sessions" | "NY Close";
type SetupStatus = "Live" | "Waiting" | "Disabled";

interface TradingSetup {
  id: string;
  name: string;
  description: string;
  status: SetupStatus;
  marketFit: string;
  successRate: number;
  avgWinR: number;
  tradeFreq: number;
  eligibleLong: boolean;
  eligibleShort: boolean;
  bestSession: SessionTime;
  regime: Regime;
  executionRules: string[];
  layerScores: { structure: number; orderflow: number; recall: number; ml: number; claude: number };
  recentTrades: number;
  lastTriggered: number;
}

// ─── Mock Data ───────────────────────────────────────────────────────────────
const SETUPS: TradingSetup[] = [
  {
    id: "sweep_reclaim",
    name: "Sweep Reclaim",
    description: "Liquidity sweep below/above a key level followed by aggressive reclaim. Classic institutional trap pattern.",
    status: "Live",
    marketFit: "HIGH",
    successRate: 81,
    avgWinR: 1.82,
    tradeFreq: 4.2,
    eligibleLong: true,
    eligibleShort: true,
    bestSession: "NY Morning",
    regime: "BALANCED",
    executionRules: [
      "Price must sweep a defined SK swing high/low by ≥2 ticks",
      "Opposite-side aggression must appear within 3 candles of sweep",
      "CVD must confirm: delta divergence at sweep point",
      "ATR filter: range must be ≥0.8× average 20-period ATR",
    ],
    layerScores: { structure: 0.88, orderflow: 0.85, recall: 0.91, ml: 0.72, claude: 0.84 },
    recentTrades: 47,
    lastTriggered: Date.now() - 1800000,
  },
  {
    id: "absorption_reversal",
    name: "Absorption Reversal",
    description: "Price at key S/R level with aggressor absorbed. Reclaim confirms trapped traders and reversal initiation.",
    status: "Live",
    marketFit: "HIGH",
    successRate: 72,
    avgWinR: 2.14,
    tradeFreq: 2.8,
    eligibleLong: true,
    eligibleShort: true,
    bestSession: "London Open",
    regime: "VOLATILE",
    executionRules: [
      "Price must be within 0.1% of a defined SK zone boundary",
      "Absorption ratio ≥ 2:1 (passive vs aggressive volume)",
      "Reclaim candle must close beyond the zone within 2 bars",
      "Minimum volume: 1.5× 20-period average",
    ],
    layerScores: { structure: 0.82, orderflow: 0.90, recall: 0.78, ml: 0.68, claude: 0.80 },
    recentTrades: 34,
    lastTriggered: Date.now() - 3600000,
  },
  {
    id: "continuation_pullback",
    name: "Continuation Pullback",
    description: "Established trend with thinning liquidity on pullback. Delta aligned with trend direction for re-entry.",
    status: "Live",
    marketFit: "MEDIUM",
    successRate: 68,
    avgWinR: 1.45,
    tradeFreq: 5.6,
    eligibleLong: true,
    eligibleShort: true,
    bestSession: "All Sessions",
    regime: "TRENDING",
    executionRules: [
      "HTF bias must be confirmed (2+ timeframes aligned)",
      "Pullback depth: 38.2%–61.8% of prior impulse",
      "Volume must thin by ≥30% during pullback phase",
      "Delta must re-align with trend on entry candle",
    ],
    layerScores: { structure: 0.75, orderflow: 0.70, recall: 0.82, ml: 0.74, claude: 0.72 },
    recentTrades: 62,
    lastTriggered: Date.now() - 900000,
  },
  {
    id: "cvd_divergence",
    name: "CVD Divergence",
    description: "Price and cumulative volume delta moving in opposite directions — hidden buying/selling pressure detection.",
    status: "Live",
    marketFit: "HIGH",
    successRate: 55,
    avgWinR: 2.40,
    tradeFreq: 1.8,
    eligibleLong: true,
    eligibleShort: true,
    bestSession: "NY Morning",
    regime: "BALANCED",
    executionRules: [
      "CVD must diverge from price for ≥5 consecutive candles",
      "VWAP deviation must confirm institutional accumulation/distribution",
      "Minimum delta magnitude: 2× normal 20-period delta range",
      "Trigger: price reclaims VWAP with aligned CVD",
    ],
    layerScores: { structure: 0.65, orderflow: 0.92, recall: 0.74, ml: 0.60, claude: 0.78 },
    recentTrades: 19,
    lastTriggered: Date.now() - 7200000,
  },
  {
    id: "breakout_failure",
    name: "Breakout Failure",
    description: "False breakout of SK swing high/low with immediate snap-back. Traps momentum traders for reversal.",
    status: "Waiting",
    marketFit: "MEDIUM",
    successRate: 42,
    avgWinR: 2.80,
    tradeFreq: 0.8,
    eligibleLong: true,
    eligibleShort: false,
    bestSession: "Asian",
    regime: "EXTREME",
    executionRules: [
      "Price must break a defined SK level by ≥3 ticks",
      "Failure: price must return inside the range within 2 candles",
      "Volume spike on breakout with immediate volume collapse",
      "Snap-back must close beyond 50% of the breakout bar range",
    ],
    layerScores: { structure: 0.78, orderflow: 0.58, recall: 0.65, ml: 0.48, claude: 0.70 },
    recentTrades: 11,
    lastTriggered: Date.now() - 14400000,
  },
  {
    id: "vwap_reclaim",
    name: "VWAP Reclaim",
    description: "Price reclaims VWAP with strong delta after extended deviation. Mean-reversion entry with institutional backing.",
    status: "Waiting",
    marketFit: "LOW",
    successRate: 58,
    avgWinR: 1.30,
    tradeFreq: 3.2,
    eligibleLong: true,
    eligibleShort: true,
    bestSession: "NY Close",
    regime: "REVERSAL",
    executionRules: [
      "Price must be ≥1.5 ATR away from VWAP before reclaim",
      "Reclaim candle must close beyond VWAP",
      "Delta must flip direction on reclaim bar",
      "Time filter: must occur after first 30 minutes of session",
    ],
    layerScores: { structure: 0.60, orderflow: 0.72, recall: 0.68, ml: 0.62, claude: 0.65 },
    recentTrades: 28,
    lastTriggered: Date.now() - 5400000,
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
const statusColor: Record<SetupStatus, string> = { Live: "#9cff93", Waiting: "#ffd166", Disabled: "#666" };
const regimeColor: Record<Regime, string> = {
  BALANCED: "#669dff", VOLATILE: "#ffd166", TRENDING: "#9cff93", EXTREME: "#ff7162", REVERSAL: "#00dfc1",
};
const fitColor: Record<string, string> = { HIGH: "#9cff93", MEDIUM: "#ffd166", LOW: "#ff7162" };

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ExplorerHeader({ total, live }: { total: number; live: number }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px", borderBottom: "1px solid rgba(72,72,73,0.12)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span className="material-symbols-outlined" style={{ color: "#669dff", fontSize: 28 }}>explore</span>
        <div>
          <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 700, color: "#e6e1e5", margin: 0, letterSpacing: "-0.02em" }}>
            SETUP EXPLORER
          </h1>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8c909f", letterSpacing: "0.08em" }}>
            STRATEGY MATRIX · PATTERN INTELLIGENCE
          </span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 24 }}>
        {[
          { label: "Total Setups", value: total.toString(), color: "#e6e1e5" },
          { label: "Live", value: live.toString(), color: "#9cff93" },
          { label: "Avg Win Rate", value: (SETUPS.reduce((s, st) => s + st.successRate, 0) / SETUPS.length).toFixed(0) + "%", color: "#669dff" },
        ].map((stat) => (
          <div key={stat.label} style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#8c909f", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {stat.label}
            </div>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 700, color: stat.color }}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SetupRow({ setup, isSelected, onClick }: { setup: TradingSetup; isSelected: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: "grid",
        gridTemplateColumns: "200px 70px 80px 80px 80px 100px 100px",
        alignItems: "center",
        padding: "14px 20px",
        background: isSelected ? "rgba(102,157,255,0.06)" : "transparent",
        borderLeft: isSelected ? "3px solid #669dff" : "3px solid transparent",
        borderBottom: "1px solid rgba(72,72,73,0.08)",
        cursor: "pointer",
        transition: "all 0.15s ease",
      }}
    >
      {/* Name + status */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{
          fontFamily: "'Space Grotesk', sans-serif", fontSize: 14, fontWeight: 600,
          color: "#e6e1e5",
        }}>
          {setup.name}
        </span>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
          color: statusColor[setup.status],
          background: `${statusColor[setup.status]}15`,
          padding: "2px 7px", borderRadius: 3,
          letterSpacing: "0.06em", fontWeight: 600,
        }}>
          {setup.status.toUpperCase()}
        </span>
      </div>

      {/* Market Fit */}
      <span style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
        color: fitColor[setup.marketFit] || "#8c909f",
        fontWeight: 600,
      }}>
        {setup.marketFit}
      </span>

      {/* Success Rate */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ width: 32, height: 3, background: "rgba(72,72,73,0.2)", borderRadius: 2, overflow: "hidden" }}>
          <div style={{
            width: `${setup.successRate}%`, height: "100%",
            background: setup.successRate > 70 ? "#9cff93" : setup.successRate > 50 ? "#ffd166" : "#ff7162",
            borderRadius: 2,
          }} />
        </div>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 700,
          color: setup.successRate > 70 ? "#9cff93" : setup.successRate > 50 ? "#ffd166" : "#ff7162",
          fontVariantNumeric: "tabular-nums",
        }}>
          {setup.successRate}%
        </span>
      </div>
      {/* Eligibility */}
      <div style={{ display: "flex", gap: 6 }}>
        <span className="material-symbols-outlined" style={{
          fontSize: 16,
          color: setup.eligibleLong ? "#9cff93" : "rgba(72,72,73,0.3)",
        }}>
          {setup.eligibleLong ? "check_circle" : "radio_button_unchecked"}
        </span>
        <span className="material-symbols-outlined" style={{
          fontSize: 16,
          color: setup.eligibleShort ? "#ff7162" : "rgba(72,72,73,0.3)",
        }}>
          {setup.eligibleShort ? "check_circle" : "radio_button_unchecked"}
        </span>
      </div>

      {/* Best Session */}
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8c909f" }}>
        {setup.bestSession}
      </span>

      {/* Regime */}
      <span style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
        color: regimeColor[setup.regime],
        background: `${regimeColor[setup.regime]}12`,
        padding: "3px 10px", borderRadius: 3,
        letterSpacing: "0.06em", fontWeight: 600,
        textAlign: "center",
      }}>
        {setup.regime}
      </span>
    </div>
  );
}

function SetupDetail({ setup }: { setup: TradingSetup }) {
  const composite = (
    setup.layerScores.structure * 0.30 +
    setup.layerScores.orderflow * 0.25 +
    setup.layerScores.recall * 0.20 +
    setup.layerScores.ml * 0.15 +
    setup.layerScores.claude * 0.10
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div style={{
        background: "#1a191b", border: "1px solid rgba(72,72,73,0.15)",
        borderRadius: 6, padding: "20px 24px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, color: "#e6e1e5" }}>
              {setup.name}
            </div>
            <div style={{ fontFamily: "Inter, sans-serif", fontSize: 13, color: "#b4b0b8", marginTop: 4, lineHeight: 1.5 }}>
              {setup.description}
            </div>
          </div>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
            color: statusColor[setup.status],
            border: `1px solid ${statusColor[setup.status]}44`,
            padding: "4px 12px", borderRadius: 4,
          }}>
            {setup.status.toUpperCase()}
          </div>
        </div>
        {/* Quick stats row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginTop: 16 }}>
          {[
            { label: "Avg Win", value: `${setup.avgWinR}R`, color: "#9cff93" },
            { label: "Frequency", value: `${setup.tradeFreq}/day`, color: "#669dff" },
            { label: "Composite", value: `${(composite * 100).toFixed(0)}%`, color: composite > 0.75 ? "#9cff93" : "#ffd166" },
            { label: "Recent Trades", value: setup.recentTrades.toString(), color: "#e6e1e5" },
          ].map((stat) => (
            <div key={stat.label} style={{ background: "rgba(0,0,0,0.2)", borderRadius: 4, padding: "12px 14px" }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#8c909f", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                {stat.label}
              </div>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, color: stat.color, marginTop: 4 }}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Layer scores */}
      <div style={{
        background: "#1a191b", border: "1px solid rgba(72,72,73,0.15)",
        borderRadius: 6, padding: "16px 20px",
      }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8c909f", letterSpacing: "0.08em", marginBottom: 12, textTransform: "uppercase" }}>
          Layer Performance
        </div>
        {Object.entries(setup.layerScores).map(([layer, score]) => (
          <div key={layer} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#8c909f", width: 70, textTransform: "uppercase" }}>
              {layer}
            </span>
            <div style={{ flex: 1, height: 4, background: "rgba(72,72,73,0.2)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{
                width: `${score * 100}%`, height: "100%",
                background: score > 0.8 ? "#9cff93" : score > 0.6 ? "#ffd166" : "#ff7162",
                borderRadius: 2,
              }} />
            </div>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
              color: score > 0.8 ? "#9cff93" : score > 0.6 ? "#ffd166" : "#ff7162",
              fontWeight: 600, width: 35, textAlign: "right",
            }}>
              {(score * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
      {/* Execution rules */}
      <div style={{
        background: "#1a191b", border: "1px solid rgba(72,72,73,0.15)",
        borderRadius: 6, padding: "16px 20px",
      }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8c909f", letterSpacing: "0.08em", marginBottom: 12, textTransform: "uppercase" }}>
          Execution Conditions
        </div>
        {setup.executionRules.map((rule, i) => (
          <div key={i} style={{
            display: "flex", gap: 10, padding: "8px 0",
            borderBottom: i < setup.executionRules.length - 1 ? "1px solid rgba(72,72,73,0.08)" : "none",
          }}>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
              color: "#669dff", fontWeight: 700, minWidth: 20,
            }}>
              {(i + 1).toString().padStart(2, "0")}
            </span>
            <span style={{ fontFamily: "Inter, sans-serif", fontSize: 13, color: "#b4b0b8", lineHeight: 1.5 }}>
              {rule}
            </span>
          </div>
        ))}
      </div>

      {/* Deploy button */}
      <button style={{
        background: setup.status === "Live"
          ? "linear-gradient(135deg, rgba(156,255,147,0.15), rgba(102,157,255,0.15))"
          : "rgba(72,72,73,0.1)",
        border: `1px solid ${setup.status === "Live" ? "rgba(156,255,147,0.3)" : "rgba(72,72,73,0.2)"}`,
        borderRadius: 6, padding: "14px 24px",
        fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
        color: setup.status === "Live" ? "#9cff93" : "#8c909f",
        cursor: "pointer", letterSpacing: "0.1em", fontWeight: 700,
        textTransform: "uppercase",
      }}>
        {setup.status === "Live" ? "DEPLOY ALGO TO LIVE" : "ACTIVATE SETUP"}
      </button>

      <div style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#666",
        textAlign: "center",
      }}>
        Last triggered: {timeAgo(setup.lastTriggered)} · ID: {setup.id}
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function SetupExplorerPage() {
  const [selectedId, setSelectedId] = useState<string>(SETUPS[0].id);
  const [filter, setFilter] = useState<"all" | "live" | "waiting">("all");
  const [search, setSearch] = useState("");

  // Real strict-setup data from backend
  const { data: strictSetupData } = useQuery({
    queryKey: ["strict-setup-matrix"],
    queryFn: () => fetch("/api/market/strict-setup/matrix").then(r => r.ok ? r.json() : null),
    refetchInterval: 60_000,
    retry: 1,
  });

  const { data: strictSetupReport } = useQuery({
    queryKey: ["strict-setup-report"],
    queryFn: () => fetch("/api/market/strict-setup/report").then(r => r.ok ? r.json() : null),
    refetchInterval: 60_000,
    retry: 1,
  });

  // Merge real data into SETUPS (real data augments the mock catalog with live metrics)
  const setups: TradingSetup[] = useMemo(() => {
    if (!strictSetupReport?.setups) return SETUPS;
    return SETUPS.map(s => {
      const real = strictSetupReport.setups?.find((rs: any) => rs.id === s.id || rs.name === s.name);
      if (!real) return s;
      return {
        ...s,
        successRate: Number((real.win_rate ?? s.successRate / 100) * 100),
        avgWinR: real.avg_win_r ?? s.avgWinR,
        tradeFreq: real.trade_freq ?? s.tradeFreq,
        status: real.active ? "Live" : "Waiting" as SetupStatus,
        recentTrades: real.total_trades ?? s.recentTrades,
        lastTriggered: real.last_triggered ? new Date(real.last_triggered).getTime() : s.lastTriggered,
      };
    });
  }, [strictSetupReport]);

  const filtered = useMemo(() => {
    return setups.filter((s) => {
      if (filter === "live" && s.status !== "Live") return false;
      if (filter === "waiting" && s.status !== "Waiting") return false;
      if (search && !s.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [setups, filter, search]);

  const selected = setups.find((s) => s.id === selectedId) || setups[0];
  const liveCount = setups.filter((s) => s.status === "Live").length;

  return (
    <div style={{ minHeight: "100vh", background: "#131314", color: "#e6e1e5" }}>
      <ExplorerHeader total={setups.length} live={liveCount} />

      {/* Toolbar */}
      <div style={{ padding: "16px 24px 0", display: "flex", gap: 12, alignItems: "center" }}>
        {/* Search */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "#1a191b", border: "1px solid rgba(72,72,73,0.15)",
          borderRadius: 4, padding: "8px 14px", flex: "0 0 240px",
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16, color: "#8c909f" }}>search</span>
          <input
            type="text"
            placeholder="Search setups..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              background: "transparent", border: "none", outline: "none",
              fontFamily: "Inter, sans-serif", fontSize: 13, color: "#e6e1e5",
              width: "100%",
            }}
          />
        </div>

        {/* Filter chips */}
        {(["all", "live", "waiting"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              background: filter === f ? "rgba(102,157,255,0.12)" : "transparent",
              border: `1px solid ${filter === f ? "rgba(102,157,255,0.3)" : "rgba(72,72,73,0.15)"}`,
              borderRadius: 4, padding: "8px 16px",
              fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
              color: filter === f ? "#669dff" : "#8c909f",
              cursor: "pointer", letterSpacing: "0.06em", textTransform: "uppercase",
            }}
          >
            {f}
          </button>
        ))}

        <div style={{ flex: 1 }} />

        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#666" }}>
          {filtered.length} setups
        </span>
      </div>

      {/* Main grid: table + detail panel */}
      <div style={{ padding: 24, display: "grid", gridTemplateColumns: "1fr 420px", gap: 24, alignItems: "start" }}>
        {/* Table */}
        <div style={{
          background: "#1a191b", border: "1px solid rgba(72,72,73,0.15)",
          borderRadius: 6, overflow: "hidden",
        }}>
          {/* Header row */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "200px 70px 80px 80px 80px 100px 100px",
            padding: "10px 20px",
            background: "rgba(0,0,0,0.2)",
            borderBottom: "1px solid rgba(72,72,73,0.12)",
          }}>
            {["SETUP", "FIT", "WIN RATE", "LONG/SHORT", "SESSION", "REGIME"].map((h, i) => (
              <span key={h} style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                color: "#666", letterSpacing: "0.08em",
                gridColumn: h === "SETUP" ? "1" : undefined,
              }}>
                {h}
              </span>
            ))}
          </div>

          {/* Rows */}
          {filtered.map((setup) => (
            <SetupRow
              key={setup.id}
              setup={setup}
              isSelected={selectedId === setup.id}
              onClick={() => setSelectedId(setup.id)}
            />
          ))}

          {filtered.length === 0 && (
            <div style={{ padding: "40px 20px", textAlign: "center", fontFamily: "Inter, sans-serif", fontSize: 14, color: "#666" }}>
              No setups match the current filter.
            </div>
          )}
        </div>

        {/* Detail panel */}
        <SetupDetail setup={selected} />
      </div>
    </div>
  );
}
