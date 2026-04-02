import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ─── Types ───────────────────────────────────────────────────────────────────
type GateStatus = "ALLOW" | "WATCH" | "REDUCE" | "BLOCK";
type RailStatus = "OK" | "WARNING" | "TRIGGERED" | "DISABLED";

interface RiskGate {
  status: GateStatus;
  reason: string;
  lastChange: number;
}

interface SafetyRail {
  id: string;
  name: string;
  icon: string;
  status: RailStatus;
  current: string;
  limit: string;
  pct: number;
  detail: string;
}

interface PositionRisk {
  symbol: string;
  direction: "LONG" | "SHORT";
  entryPrice: number;
  currentPrice: number;
  size: number;
  unrealizedPnl: number;
  riskR: number;
  stopLoss: number;
  takeProfit: number;
  riskPct: number;
  timeHeld: string;
}
interface RiskEvent {
  timestamp: number;
  type: "gate_change" | "rail_trigger" | "position_alert" | "cooldown" | "kill_switch";
  severity: "info" | "warning" | "critical";
  message: string;
}

interface DrawdownState {
  dailyRealized: number;
  dailyUnrealized: number;
  dailyLimit: number;
  weeklyRealized: number;
  weeklyLimit: number;
  maxDrawdown: number;
  maxDrawdownLimit: number;
  streakLosses: number;
  streakWins: number;
}

// ─── API Hooks ────────────────────────────────────────────────────────────────
function useRiskStatus() {
  return useQuery({
    queryKey: ["risk-status"],
    queryFn: () => fetch("/api/alpaca/risk/status").then(r => r.ok ? r.json() : null),
    refetchInterval: 10_000,
    retry: 1,
  });
}

function useSystemRisk() {
  return useQuery({
    queryKey: ["system-risk"],
    queryFn: () => fetch("/api/system/risk").then(r => r.ok ? r.json() : null),
    refetchInterval: 10_000,
    retry: 1,
  });
}

function useLivePositions() {
  return useQuery({
    queryKey: ["live-positions"],
    queryFn: () => fetch("/api/alpaca/positions/live").then(r => r.ok ? r.json() : []),
    refetchInterval: 15_000,
    retry: 1,
  });
}

// ─── Mock Fallback Data ───────────────────────────────────────────────────────
const GATE_DEFAULT: RiskGate = {
  status: "ALLOW",
  reason: "All safety rails nominal — full trading capacity",
  lastChange: Date.now() - 3600000,
};

// ─── Data Mappers ────────────────────────────────────────────────────────────
function buildRailsFromAPI(riskStatus: any, systemRisk: any): SafetyRail[] {
  const risk = riskStatus?.risk ?? {};
  const cfg = systemRisk?.config ?? {};
  const runtime = systemRisk?.runtime ?? {};
  const gateReasons: string[] = riskStatus?.gate_reasons ?? [];

  const dailyLossUsd = Math.abs(risk.realizedPnlTodayUsd ?? 0);
  const dailyLimitUsd = cfg.maxDailyLossUsd ?? 250;
  const dailyPct = dailyLimitUsd > 0 ? (dailyLossUsd / dailyLimitUsd) * 100 : 0;

  const exposurePct = (risk.openExposurePct ?? 0) * 100;
  const maxExposurePct = (cfg.maxOpenExposurePct ?? 0.6) * 100;

  const openPositions = risk.openPositions ?? 0;
  const maxPositions = cfg.maxConcurrentPositions ?? 3;

  const closedToday = risk.closedTradesToday ?? 0;
  const maxTrades = cfg.maxTradesPerSession ?? 10;

  const cooldownActive = risk.cooldownActive ?? false;
  const cooldownMinutes = cfg.cooldownMinutes ?? 30;

  return [
    {
      id: "kill_switch", name: "Kill Switch", icon: "power_settings_new",
      status: runtime.killSwitchActive ? "TRIGGERED" : "OK",
      current: runtime.killSwitchActive ? "ACTIVE" : "OFF", limit: "Manual", pct: 0,
      detail: "Emergency halt — disables all new entries instantly",
    },
    {
      id: "daily_loss", name: "Daily Loss Limit", icon: "trending_down",
      status: gateReasons.includes("daily_loss_limit_reached") ? "TRIGGERED" : dailyPct > 80 ? "WARNING" : "OK",
      current: `$${dailyLossUsd.toFixed(0)}`, limit: `$${dailyLimitUsd.toFixed(0)}`,
      pct: Math.min(dailyPct, 100), detail: `Realized losses today: $${dailyLossUsd.toFixed(0)} of $${dailyLimitUsd.toFixed(0)} max`,
    },
    {
      id: "max_exposure", name: "Max Exposure", icon: "pie_chart",
      status: gateReasons.includes("max_open_exposure_exceeded") ? "TRIGGERED" : exposurePct > maxExposurePct * 0.8 ? "WARNING" : "OK",
      current: `${exposurePct.toFixed(1)}%`, limit: `${maxExposurePct.toFixed(0)}%`,
      pct: maxExposurePct > 0 ? (exposurePct / maxExposurePct) * 100 : 0,
      detail: "Current portfolio exposure as % of equity",
    },
    {
      id: "max_positions", name: "Max Positions", icon: "stacked_bar_chart",
      status: gateReasons.includes("max_concurrent_positions_reached") ? "TRIGGERED" : openPositions >= maxPositions ? "WARNING" : "OK",
      current: String(openPositions), limit: String(maxPositions),
      pct: maxPositions > 0 ? (openPositions / maxPositions) * 100 : 0,
      detail: "Active concurrent positions vs maximum",
    },
    {
      id: "trades_per_session", name: "Trades / Session", icon: "tag",
      status: gateReasons.includes("max_trades_per_session_reached") ? "TRIGGERED" : closedToday >= maxTrades * 0.8 ? "WARNING" : "OK",
      current: String(closedToday), limit: String(maxTrades),
      pct: maxTrades > 0 ? (closedToday / maxTrades) * 100 : 0,
      detail: "Trades executed this session vs cap",
    },
    {
      id: "cooldown", name: "Loss Cooldown", icon: "timer",
      status: cooldownActive ? "TRIGGERED" : "OK",
      current: cooldownActive ? `${cooldownMinutes} min` : "0 min",
      limit: `${cooldownMinutes} min`, pct: cooldownActive ? 100 : 0,
      detail: `${cooldownMinutes}-min cooldown activates after ${cfg.cooldownAfterLosses ?? 3} consecutive losses`,
    },
    {
      id: "degraded_data", name: "Data Quality", icon: "signal_cellular_alt",
      status: riskStatus?.data_health?.healthy === false ? "WARNING" : "OK",
      current: riskStatus?.data_health?.healthy === false ? "DEGRADED" : "GOOD",
      limit: "MIN", pct: 15,
      detail: riskStatus?.data_health?.healthy === false ? riskStatus?.data_health?.reasons?.join(", ") ?? "Data degraded" : "All data feeds nominal",
    },
    {
      id: "session_filter", name: "Session Filter", icon: "schedule",
      status: gateReasons.includes("session_not_allowed") ? "TRIGGERED" : "OK",
      current: riskStatus?.active_session ?? "Unknown",
      limit: "Allowed", pct: 0,
      detail: gateReasons.includes("session_not_allowed") ? "Current session is NOT in the allowed trading window" : "Current session is in the allowed trading window",
    },
    {
      id: "news_lockout", name: "News Lockout", icon: "newspaper",
      status: gateReasons.includes("news_lockout_active") || cfg.newsLockoutActive ? "TRIGGERED" : "OK",
      current: cfg.newsLockoutActive ? "ACTIVE" : "Clear",
      limit: "Active", pct: 0,
      detail: cfg.newsLockoutActive ? "News lockout is manually active" : "No high-impact news lockout active",
    },
  ];
}

function buildDrawdownFromAPI(riskStatus: any, systemRisk: any): DrawdownState {
  const risk = riskStatus?.risk ?? {};
  const cfg = systemRisk?.config ?? {};
  return {
    dailyRealized: risk.realizedPnlTodayUsd ?? 0,
    dailyUnrealized: risk.unrealizedPnlUsd ?? 0,
    dailyLimit: -(cfg.maxDailyLossUsd ?? 250),
    weeklyRealized: risk.realizedPnlWeekUsd ?? 0,
    weeklyLimit: -(cfg.maxDailyLossUsd ?? 250) * 3,
    maxDrawdown: risk.maxDrawdownUsd ?? 0,
    maxDrawdownLimit: -(cfg.maxDailyLossUsd ?? 250) * 5,
    streakLosses: risk.consecutiveLosses ?? 0,
    streakWins: risk.consecutiveWins ?? 0,
  };
}

function buildGateFromAPI(riskStatus: any, systemRisk: any): RiskGate {
  if (!riskStatus) return GATE_DEFAULT;
  const gateReasons: string[] = riskStatus.gate_reasons ?? [];
  const killSwitch = systemRisk?.runtime?.killSwitchActive ?? false;
  let status: GateStatus = "ALLOW";
  if (killSwitch || gateReasons.includes("daily_loss_limit_reached")) status = "BLOCK";
  else if (gateReasons.length >= 2) status = "REDUCE";
  else if (gateReasons.length === 1) status = "WATCH";
  const reason = gateReasons.length === 0
    ? "All safety rails nominal — full trading capacity"
    : gateReasons.map(r => r.replace(/_/g, " ")).join("; ");
  return { status, reason, lastChange: Date.now() };
}

function buildPositionsFromAPI(positions: any[]): PositionRisk[] {
  if (!Array.isArray(positions)) return [];
  return positions.map((p: any) => ({
    symbol: p.symbol ?? "Unknown",
    direction: (p.side === "long" || p.qty > 0) ? "LONG" : "SHORT",
    entryPrice: Number(p.avg_entry_price ?? p.entry_price ?? 0),
    currentPrice: Number(p.current_price ?? 0),
    size: Math.abs(Number(p.qty ?? 0)),
    unrealizedPnl: Number(p.unrealized_pl ?? 0),
    riskR: Number(p.riskR ?? 0),
    stopLoss: Number(p.stop_loss ?? 0),
    takeProfit: Number(p.take_profit ?? 0),
    riskPct: Math.abs(Number(p.unrealized_plpc ?? 0)) * 100,
    timeHeld: "—",
  }));
}

// ─── Static Risk Events (non-persisted in current backend) ───────────────────
const EVENTS: RiskEvent[] = [];

// ─── Helpers ─────────────────────────────────────────────────────────────────
const gateColor: Record<GateStatus, string> = { ALLOW: "#9cff93", WATCH: "#ffd166", REDUCE: "#ff9a5c", BLOCK: "#ff4444" };
const railStatusColor: Record<RailStatus, string> = { OK: "#9cff93", WARNING: "#ffd166", TRIGGERED: "#ff7162", DISABLED: "#666" };
const severityColor: Record<string, string> = { info: "#8c909f", warning: "#ffd166", critical: "#ff7162" };

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function formatPnl(v: number): string { return (v >= 0 ? "+" : "") + "$" + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function timeAgo(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}
// ─── Sub-components ──────────────────────────────────────────────────────────

function RiskHeader({ gate }: { gate: RiskGate }) {
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    const iv = setInterval(() => setPulse(p => !p), 1500);
    return () => clearInterval(iv);
  }, []);

  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px", borderBottom: "1px solid rgba(72,72,73,0.12)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span className="material-symbols-outlined" style={{ color: "#ff7162", fontSize: 28 }}>shield</span>
        <div>
          <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 700, color: "#e6e1e5", margin: 0, letterSpacing: "-0.02em" }}>
            RISK COMMAND CENTER
          </h1>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8c909f", letterSpacing: "0.08em" }}>
            9 SAFETY RAILS · REAL-TIME GATING · POSITION CONTROL
          </span>
        </div>
      </div>

      {/* Main gate indicator */}
      <div style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "12px 24px", borderRadius: 6,
        background: `${gateColor[gate.status]}08`,
        border: `1px solid ${gateColor[gate.status]}30`,
      }}>        <div style={{
          width: 14, height: 14, borderRadius: "50%",
          background: gateColor[gate.status],
          boxShadow: pulse ? `0 0 16px ${gateColor[gate.status]}` : `0 0 4px ${gateColor[gate.status]}`,
          transition: "box-shadow 0.8s ease",
        }} />
        <div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#8c909f", letterSpacing: "0.08em" }}>RISK GATE</div>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 700, color: gateColor[gate.status], letterSpacing: "0.04em" }}>
            {gate.status}
          </div>
        </div>
      </div>
    </div>
  );
}

function SafetyRailCard({ rail }: { rail: SafetyRail }) {
  const color = railStatusColor[rail.status];
  const isKillSwitch = rail.id === "kill_switch";

  return (
    <div style={{
      background: isKillSwitch ? "rgba(255,68,68,0.04)" : "#1a191b",
      border: `1px solid ${isKillSwitch ? "rgba(255,68,68,0.2)" : "rgba(72,72,73,0.15)"}`,
      borderRadius: 6, padding: "14px 18px",
      transition: "all 0.2s ease",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18, color }}>{rail.icon}</span>          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 600, color: "#e6e1e5" }}>
            {rail.name}
          </span>
        </div>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
          color, background: `${color}15`,
          padding: "2px 8px", borderRadius: 3, fontWeight: 600,
          letterSpacing: "0.06em",
        }}>
          {rail.status}
        </span>
      </div>

      {/* Progress bar (skip for binary rails) */}
      {rail.pct > 0 && !isKillSwitch && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ height: 3, background: "rgba(72,72,73,0.2)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{
              width: `${Math.min(rail.pct, 100)}%`, height: "100%",
              background: rail.pct > 80 ? "#ff7162" : rail.pct > 60 ? "#ffd166" : "#9cff93",
              borderRadius: 2, transition: "width 0.5s ease",
            }} />
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#e6e1e5", fontWeight: 600 }}>
          {rail.current}
        </span>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#666" }}>
          / {rail.limit}
        </span>
      </div>
      <div style={{ fontFamily: "Inter, sans-serif", fontSize: 11, color: "#8c909f", marginTop: 6 }}>
        {rail.detail}
      </div>
    </div>
  );
}

function DrawdownPanel({ dd }: { dd: DrawdownState }) {
  const dailyNet = dd.dailyRealized + dd.dailyUnrealized;
  const dailyPct = Math.abs(dd.dailyRealized / dd.dailyLimit) * 100;

  return (
    <div style={{
      background: "#1a191b", border: "1px solid rgba(72,72,73,0.15)",
      borderRadius: 6, padding: "18px 22px",
    }}>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8c909f", letterSpacing: "0.08em", marginBottom: 14, textTransform: "uppercase" }}>
        Drawdown Monitor
      </div>

      {/* Daily */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#8c909f" }}>DAILY P&L</span>
          <span style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700,
            color: dailyNet >= 0 ? "#9cff93" : "#ff7162",
          }}>
            {formatPnl(dailyNet)}
          </span>
        </div>        <div style={{ height: 6, background: "rgba(72,72,73,0.2)", borderRadius: 3, overflow: "hidden", position: "relative" }}>
          <div style={{
            width: `${Math.min(dailyPct, 100)}%`, height: "100%",
            background: dailyPct > 80 ? "linear-gradient(90deg, #ffd166, #ff7162)" : "linear-gradient(90deg, #9cff93, #ffd166)",
            borderRadius: 3,
          }} />
          {/* Limit marker */}
          <div style={{
            position: "absolute", right: 0, top: -2, bottom: -2,
            width: 2, background: "#ff4444",
          }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "#666" }}>
            Realized: {formatPnl(dd.dailyRealized)}
          </span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "#666" }}>
            Limit: {formatPnl(dd.dailyLimit)}
          </span>
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {[
          { label: "Weekly P&L", value: formatPnl(dd.weeklyRealized), color: dd.weeklyRealized >= 0 ? "#9cff93" : "#ff7162" },
          { label: "Max Drawdown", value: formatPnl(dd.maxDrawdown), color: "#ff7162" },
          { label: "Loss Streak", value: dd.streakLosses.toString(), color: dd.streakLosses >= 3 ? "#ff7162" : "#e6e1e5" },
          { label: "Win Streak", value: dd.streakWins.toString(), color: dd.streakWins >= 2 ? "#9cff93" : "#e6e1e5" },
        ].map((stat) => (          <div key={stat.label} style={{ background: "rgba(0,0,0,0.2)", borderRadius: 4, padding: "10px 12px" }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "#666", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              {stat.label}
            </div>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 16, fontWeight: 700, color: stat.color, marginTop: 2 }}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PositionRiskPanel({ positions }: { positions: PositionRisk[] }) {
  return (
    <div style={{
      background: "#1a191b", border: "1px solid rgba(72,72,73,0.15)",
      borderRadius: 6, padding: "18px 22px",
    }}>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8c909f", letterSpacing: "0.08em", marginBottom: 14, textTransform: "uppercase" }}>
        Open Position Risk ({positions.length})
      </div>

      {positions.length === 0 && (
        <div style={{ fontFamily: "Inter, sans-serif", fontSize: 13, color: "#666", textAlign: "center", padding: 20 }}>
          No open positions
        </div>
      )}

      {positions.map((pos) => {
        const pnlColor = pos.unrealizedPnl >= 0 ? "#9cff93" : "#ff7162";
        const priceRange = pos.takeProfit - pos.stopLoss;
        const currentPct = ((pos.currentPrice - pos.stopLoss) / priceRange) * 100;
        return (
          <div key={pos.symbol} style={{
            background: "rgba(0,0,0,0.15)", borderRadius: 6,
            padding: "16px 18px", marginBottom: 10,
            borderLeft: `3px solid ${pnlColor}`,
          }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 16, fontWeight: 700, color: "#e6e1e5" }}>
                  {pos.symbol}
                </span>
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
                  color: pos.direction === "LONG" ? "#9cff93" : "#ff7162",
                  background: pos.direction === "LONG" ? "rgba(156,255,147,0.1)" : "rgba(255,113,98,0.1)",
                  padding: "2px 7px", borderRadius: 3, fontWeight: 600,
                }}>
                  {pos.direction}
                </span>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 700, color: pnlColor }}>
                  {formatPnl(pos.unrealizedPnl)}
                </div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#8c909f" }}>
                  {pos.riskR > 0 ? "+" : ""}{pos.riskR}R
                </div>
              </div>
            </div>

            {/* SL / Current / TP bar */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ height: 6, background: "rgba(72,72,73,0.2)", borderRadius: 3, overflow: "hidden", position: "relative" }}>
                <div style={{                  width: `${Math.min(Math.max(currentPct, 0), 100)}%`, height: "100%",
                  background: `linear-gradient(90deg, #ff7162, #ffd166, #9cff93)`,
                  borderRadius: 3,
                }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "#ff7162" }}>
                  SL: {pos.stopLoss.toLocaleString()}
                </span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "#e6e1e5" }}>
                  {pos.currentPrice.toLocaleString()}
                </span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "#9cff93" }}>
                  TP: {pos.takeProfit.toLocaleString()}
                </span>
              </div>
            </div>

            {/* Meta */}
            <div style={{ display: "flex", gap: 16, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#8c909f" }}>
              <span>Entry: {pos.entryPrice.toLocaleString()}</span>
              <span>Size: {pos.size}</span>
              <span>Risk: {pos.riskPct}%</span>
              <span>Held: {pos.timeHeld}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
function RiskEventLog({ events }: { events: RiskEvent[] }) {
  return (
    <div style={{
      background: "#0e0e0f", border: "1px solid rgba(72,72,73,0.12)",
      borderRadius: 6, overflow: "hidden",
    }}>
      <div style={{
        padding: "10px 16px",
        borderBottom: "1px solid rgba(72,72,73,0.12)",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span className="material-symbols-outlined" style={{ fontSize: 16, color: "#ff7162" }}>notification_important</span>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8c909f", letterSpacing: "0.08em" }}>
          RISK EVENT LOG
        </span>
      </div>
      <div style={{ maxHeight: 300, overflowY: "auto", padding: "6px 0" }}>
        {events.map((event, i) => (
          <div key={i} style={{
            display: "flex", gap: 10, padding: "6px 16px",
            fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
            borderLeft: `2px solid ${severityColor[event.severity]}`,
            marginLeft: 8,
          }}>
            <span style={{ color: "#666", minWidth: 60, fontSize: 10 }}>{formatTime(event.timestamp)}</span>
            <span style={{
              color: severityColor[event.severity],
              fontWeight: event.severity === "critical" ? 700 : 400,
            }}>
              {event.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
function KillSwitchPanel() {
  const queryClient = useQueryClient();
  const { data: systemRisk } = useSystemRisk();
  const isActive = systemRisk?.runtime?.killSwitchActive ?? false;
  const [armed, setArmed] = useState(false);
  const operatorToken = (document.cookie.match(/operator_token=([^;]+)/) ?? [])[1] ?? "";

  const toggleKillSwitch = useCallback(async () => {
    if (!armed) { setArmed(true); return; }
    try {
      await fetch("/api/system/kill-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Operator-Token": operatorToken },
        body: JSON.stringify({ active: !isActive }),
      });
      await queryClient.invalidateQueries({ queryKey: ["system-risk"] });
      await queryClient.invalidateQueries({ queryKey: ["risk-status"] });
    } catch { /* ignore */ }
    setArmed(false);
  }, [armed, isActive, operatorToken, queryClient]);

  return (
    <div style={{
      background: armed ? "rgba(255,68,68,0.08)" : "#1a191b",
      border: `1px solid ${armed ? "rgba(255,68,68,0.4)" : "rgba(72,72,73,0.15)"}`,
      borderRadius: 6, padding: "18px 22px",
      transition: "all 0.3s ease",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 22, color: armed ? "#ff4444" : "#8c909f" }}>
            power_settings_new
          </span>
          <div>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 14, fontWeight: 700, color: "#e6e1e5" }}>
              KILL SWITCH
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#8c909f" }}>
              Emergency halt — closes all positions, blocks new entries
            </div>
          </div>
        </div>
        <button
          onClick={toggleKillSwitch}
          style={{
            background: armed ? "#ff4444" : "rgba(72,72,73,0.15)",
            border: `1px solid ${armed ? "#ff4444" : "rgba(72,72,73,0.3)"}`,
            borderRadius: 6, padding: "10px 24px",
            fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
            color: armed ? "#fff" : "#8c909f",
            cursor: "pointer", fontWeight: 700,
            letterSpacing: "0.08em",
            transition: "all 0.2s ease",
          }}
        >
          {isActive ? "KILL SWITCH ACTIVE" : armed ? "CONFIRM KILL" : "ARM"}
        </button>
      </div>
      {armed && (
        <div style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
          color: "#ff7162", padding: "10px 14px",
          background: "rgba(255,68,68,0.06)", borderRadius: 4,
          borderLeft: "3px solid #ff4444",
        }}>
          ⚠ Kill switch is ARMED. Clicking again will immediately close all open positions and block all new trade entries until manually reset.
        </div>
      )}
    </div>
  );
}
// ─── Main Page ───────────────────────────────────────────────────────────────
export default function RiskPage() {
  const { data: riskStatus } = useRiskStatus();
  const { data: systemRisk } = useSystemRisk();
  const { data: rawPositions } = useLivePositions();

  const gate = buildGateFromAPI(riskStatus, systemRisk);
  const RAILS = buildRailsFromAPI(riskStatus, systemRisk);
  const POSITIONS = buildPositionsFromAPI(rawPositions);
  const DRAWDOWN = buildDrawdownFromAPI(riskStatus, systemRisk);

  return (
    <div style={{ minHeight: "100vh", background: "#131314", color: "#e6e1e5" }}>
      <RiskHeader gate={gate} />

      <div style={{ padding: 24 }}>
        {/* Kill Switch — always top */}
        <div style={{ marginBottom: 20 }}>
          <KillSwitchPanel />
        </div>

        {/* Main grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 400px", gap: 20, alignItems: "start" }}>
          {/* Left column */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Safety Rails grid */}
            <div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8c909f", letterSpacing: "0.08em", marginBottom: 12, textTransform: "uppercase" }}>
                Safety Rails ({RAILS.filter(r => r.status === "OK").length}/{RAILS.length} Nominal)
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                {RAILS.filter(r => r.id !== "kill_switch").map((rail) => (
                  <SafetyRailCard key={rail.id} rail={rail} />
                ))}
              </div>
            </div>

            {/* Position risk */}
            <PositionRiskPanel positions={POSITIONS} />

            {/* Event log */}
            <RiskEventLog events={EVENTS} />
          </div>

          {/* Right column — sticky */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20, position: "sticky", top: 24 }}>
            {/* Drawdown */}
            <DrawdownPanel dd={DRAWDOWN} />
            {/* Risk budget summary */}
            <div style={{
              background: "#1a191b", border: "1px solid rgba(72,72,73,0.15)",
              borderRadius: 6, padding: "18px 22px",
            }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8c909f", letterSpacing: "0.08em", marginBottom: 14, textTransform: "uppercase" }}>
                Risk Budget
              </div>
              {[
                { label: "Daily Budget Left", value: formatPnl(Math.abs(DRAWDOWN.dailyLimit) - Math.abs(DRAWDOWN.dailyRealized)), color: "#ffd166" },
                { label: "Position Capacity", value: `${3 - POSITIONS.length} / 3`, color: "#669dff" },
                { label: "Exposure Headroom", value: `${60 - 28}%`, color: "#9cff93" },
                { label: "Next News Event", value: "FOMC +2h", color: "#8c909f" },
              ].map((item) => (
                <div key={item.label} style={{
                  display: "flex", justifyContent: "space-between", padding: "8px 0",
                  borderBottom: "1px solid rgba(72,72,73,0.08)",
                }}>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8c909f" }}>
                    {item.label}
                  </span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: item.color, fontWeight: 600 }}>
                    {item.value}
                  </span>
                </div>
              ))}
            </div>

            {/* Gate history */}
            <div style={{
              background: "#1a191b", border: "1px solid rgba(72,72,73,0.15)",
              borderRadius: 6, padding: "16px 20px",
            }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8c909f", letterSpacing: "0.08em", marginBottom: 12, textTransform: "uppercase" }}>
                Gate Status
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <div style={{
                  width: 10, height: 10, borderRadius: "50%",
                  background: gateColor[gate.status],
                  boxShadow: `0 0 8px ${gateColor[gate.status]}`,
                }} />
                <span style={{
                  fontFamily: "'Space Grotesk', sans-serif", fontSize: 18, fontWeight: 700,
                  color: gateColor[gate.status],
                }}>
                  {gate.status}
                </span>
              </div>
              <div style={{ fontFamily: "Inter, sans-serif", fontSize: 12, color: "#b4b0b8", lineHeight: 1.5 }}>
                {gate.reason}
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#666", marginTop: 8 }}>
                Last changed: {timeAgo(gate.lastChange)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}