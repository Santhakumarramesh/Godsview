import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

/* ── Types ─────────────────────────────────────────────────────────── */

interface AuditEvent {
  id: number;
  event_type: string;
  decision_state: string | null;
  instrument: string | null;
  actor: string | null;
  reason: string | null;
  created_at: string;
}

interface BreakerEvent {
  id: number;
  session_id: string | null;
  level: string;
  previous_level: string | null;
  trigger: string;
  daily_pnl: string | null;
  consecutive_losses: number | null;
  created_at: string;
}

interface TradingSession {
  id: number;
  session_id: string;
  system_mode: string;
  started_at: string;
  ended_at: string | null;
  trades_executed: number | null;
  signals_generated: number | null;
  realized_pnl: string | null;
  breaker_triggered: boolean | null;
  kill_switch_used: boolean | null;
  exit_reason: string | null;
}

interface TimelineEntry {
  id: number;
  type: string;
  event_type: string;
  decision_state: string | null;
  instrument: string | null;
  actor: string | null;
  reason: string | null;
  created_at: string;
}

/* ── Helpers ───────────────────────────────────────────────────────── */

const fmt = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

const fmtDate = (iso: string | null) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
};

const levelColor: Record<string, string> = {
  NORMAL: "#22c55e",
  WARNING: "#eab308",
  THROTTLE: "#f97316",
  HALT: "#ef4444",
};

const eventIcon: Record<string, string> = {
  signal_generated: "📊",
  signal_rejected: "🚫",
  trade_executed: "💹",
  trade_closed: "📕",
  kill_switch_toggled: "🔴",
  breaker_escalated: "⚡",
  breaker_reset: "🔄",
  emergency_liquidation: "☢️",
  session_started: "▶️",
  session_ended: "⏹️",
  config_changed: "⚙️",
  breaker: "🛡️",
};

/* ── Components ────────────────────────────────────────────────────── */

function SessionCard({ s }: { s: TradingSession }) {
  const pnl = s.realized_pnl ? parseFloat(s.realized_pnl) : 0;
  const isActive = !s.ended_at;
  return (
    <div style={{
      background: "#1e1e2e", border: `1px solid ${isActive ? "#22c55e" : "#333"}`,
      borderRadius: 8, padding: 14, marginBottom: 10,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <span style={{
            background: isActive ? "#22c55e" : "#555", color: "#000",
            padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700,
          }}>
            {isActive ? "ACTIVE" : s.exit_reason || "ended"}
          </span>
          <span style={{ marginLeft: 8, color: "#aaa", fontSize: 12 }}>{s.system_mode}</span>
        </div>
        <span style={{ color: "#888", fontSize: 11 }}>{fmtDate(s.started_at)}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 10 }}>
        <Stat label="Trades" value={s.trades_executed ?? 0} />
        <Stat label="Signals" value={s.signals_generated ?? 0} />
        <Stat label="PnL" value={`$${pnl.toFixed(2)}`} color={pnl >= 0 ? "#22c55e" : "#ef4444"} />
        <Stat label="Breaker" value={s.breaker_triggered ? "YES" : "No"} color={s.breaker_triggered ? "#f97316" : "#22c55e"} />
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: color || "#e0e0e0" }}>{value}</div>
    </div>
  );
}

function TimelineRow({ e }: { e: TimelineEntry }) {
  const icon = eventIcon[e.type === "breaker" ? "breaker" : e.event_type] || "📝";
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "30px 90px 140px 100px 1fr",
      alignItems: "center", padding: "6px 0", borderBottom: "1px solid #222", fontSize: 13,
    }}>
      <span>{icon}</span>
      <span style={{ color: "#888" }}>{fmt(e.created_at)}</span>
      <span style={{ color: "#ccc", fontWeight: 600 }}>{e.event_type}</span>
      <span style={{
        color: e.decision_state === "rejected" ? "#ef4444" :
               e.decision_state === "accepted" ? "#22c55e" :
               e.decision_state === "HALT" ? "#ef4444" : "#aaa",
      }}>
        {e.decision_state || "—"}
      </span>
      <span style={{ color: "#777", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {e.instrument || e.reason || "—"}
      </span>
    </div>
  );
}

function BreakerRow({ e }: { e: BreakerEvent }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "90px 100px 100px 80px 100px",
      alignItems: "center", padding: "6px 0", borderBottom: "1px solid #222", fontSize: 13,
    }}>
      <span style={{ color: "#888" }}>{fmt(e.created_at)}</span>
      <span style={{ color: levelColor[e.previous_level || "NORMAL"] || "#aaa" }}>
        {e.previous_level || "—"}
      </span>
      <span style={{ color: levelColor[e.level] || "#aaa", fontWeight: 700 }}>{e.level}</span>
      <span style={{ color: "#ccc" }}>{e.trigger}</span>
      <span style={{ color: e.daily_pnl && parseFloat(e.daily_pnl) < 0 ? "#ef4444" : "#22c55e" }}>
        {e.daily_pnl ? `$${parseFloat(e.daily_pnl).toFixed(2)}` : "—"}
      </span>
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────────── */

type Tab = "timeline" | "sessions" | "breaker";

export default function AuditPage() {
  const [tab, setTab] = useState<Tab>("timeline");

  const { data: timelineData } = useQuery({
    queryKey: ["audit-timeline"],
    queryFn: () => fetch("/api/audit/timeline?hours=24&limit=200").then(r => r.json()),
    refetchInterval: 5000,
  });

  const { data: sessionsData } = useQuery({
    queryKey: ["sessions"],
    queryFn: () => fetch("/api/sessions?limit=20").then(r => r.json()),
    refetchInterval: 10000,
  });

  const { data: breakerData } = useQuery({
    queryKey: ["breaker-events"],
    queryFn: () => fetch("/api/audit/breaker?limit=100").then(r => r.json()),
    refetchInterval: 5000,
  });

  const tabs: { key: Tab; label: string }[] = [
    { key: "timeline", label: "Live Timeline" },
    { key: "sessions", label: "Sessions" },
    { key: "breaker", label: "Breaker Log" },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: "#e0e0e0", marginBottom: 4 }}>
        Audit Trail
      </h1>
      <p style={{ color: "#888", fontSize: 13, marginBottom: 20 }}>
        Every decision, every gate, every state change — logged and searchable.
      </p>

      {/* Tab Bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: "8px 18px", borderRadius: 6, border: "none", cursor: "pointer",
              fontSize: 13, fontWeight: 600,
              background: tab === t.key ? "#3b82f6" : "#2a2a3a",
              color: tab === t.key ? "#fff" : "#aaa",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Timeline Tab */}
      {tab === "timeline" && (
        <div style={{ background: "#1a1a2a", borderRadius: 8, padding: 16 }}>
          <div style={{
            display: "grid", gridTemplateColumns: "30px 90px 140px 100px 1fr",
            padding: "6px 0", borderBottom: "2px solid #333", fontSize: 11,
            color: "#666", textTransform: "uppercase", fontWeight: 700,
          }}>
            <span></span><span>Time</span><span>Event</span><span>State</span><span>Detail</span>
          </div>
          {(timelineData?.timeline || []).map((e: TimelineEntry) => (
            <TimelineRow key={`${e.type}-${e.id}`} e={e} />
          ))}
          {(!timelineData?.timeline?.length) && (
            <div style={{ padding: 40, textAlign: "center", color: "#555" }}>
              No events in the last 24 hours. Start a session to begin logging.
            </div>
          )}
        </div>
      )}

      {/* Sessions Tab */}
      {tab === "sessions" && (
        <div>
          {(sessionsData?.sessions || []).map((s: TradingSession) => (
            <SessionCard key={s.id} s={s} />
          ))}
          {(!sessionsData?.sessions?.length) && (
            <div style={{ padding: 40, textAlign: "center", color: "#555", background: "#1a1a2a", borderRadius: 8 }}>
              No sessions recorded yet.
            </div>
          )}
        </div>
      )}

      {/* Breaker Log Tab */}
      {tab === "breaker" && (
        <div style={{ background: "#1a1a2a", borderRadius: 8, padding: 16 }}>
          <div style={{
            display: "grid", gridTemplateColumns: "90px 100px 100px 80px 100px",
            padding: "6px 0", borderBottom: "2px solid #333", fontSize: 11,
            color: "#666", textTransform: "uppercase", fontWeight: 700,
          }}>
            <span>Time</span><span>From</span><span>To</span><span>Trigger</span><span>Daily PnL</span>
          </div>
          {(breakerData?.events || []).map((e: BreakerEvent) => (
            <BreakerRow key={e.id} e={e} />
          ))}
          {(!breakerData?.events?.length) && (
            <div style={{ padding: 40, textAlign: "center", color: "#555" }}>
              No breaker events recorded.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
