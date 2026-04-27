import { useQuery } from "@tanstack/react-query";
import { safeObj, safeNum, safeLocale } from "@/lib/safe";

// ── Design Tokens ──────────────────────────────────────────────────────────
const C = {
  bg: "#0e0e0f", card: "#1a191b", cardHigh: "#201f21",
  border: "rgba(72,72,73,0.25)", primary: "#9cff93", secondary: "#669dff",
  tertiary: "#ff7162", muted: "#adaaab", outline: "#767576",
  outlineVar: "#484849", gold: "#fbbf24", purple: "#a78bfa",
  online: "#9cff93", degraded: "#fbbf24", offline: "#ff7162",
};

// ── Types ──────────────────────────────────────────────────────────────────
type Status = "online" | "active" | "running" | "idle" | "connected" | "degraded" | "offline" | "disconnected" | "kill_switch_active" | string;
type ComponentRow = {
  name: string; icon: string; status: Status;
  primary_metric?: string; primary_label?: string;
  secondary_metric?: string; secondary_label?: string;
  tertiary_metric?: string; tertiary_label?: string;
  detail?: string;
};
type IntelligenceCenterData = {
  generated_at: string;
  server: { status: Status; uptime_human: string; started_at: string; system_mode: string; node_version: string };
  database: { status: Status; latency_ms: number };
  ml_model: { status: Status; message: string; accuracy: number | null; sample_count: number; last_trained_at: string | null };
  super_intelligence: { status: Status; message: string; ensemble_accuracy: number | null; ensemble_size: number; total_processed: number };
  risk_engine: { status: Status; kill_switch_active: boolean; session: string; daily_pnl_pct: number | null; open_positions: number; max_drawdown_pct: number | null };
  alpaca: { status: Status; is_live_mode: boolean; can_write_orders: boolean; account_value: number | null };
  scheduler: { status: Status; retrain_interval_h: number | null; last_retrain_at: string | null; next_retrain_at: string | null; retrain_count: number };
  signal_stream: { status: Status; connected_clients: number; signals_last_24h: number };
  brain: { status: Status; entity_count: number };
  trading: { trades_today: number };
};

// ── Helpers ────────────────────────────────────────────────────────────────
function statusColor(s: Status): string {
  const g = ["online", "active", "running", "connected"];
  const y = ["degraded", "idle"];
  const r = ["offline", "disconnected", "kill_switch_active"];
  if (g.includes(s)) return C.online;
  if (y.includes(s)) return C.degraded;
  if (r.includes(s)) return C.offline;
  return C.gold;
}

function statusLabel(s: Status): string {
  const map: Record<string, string> = {
    online: "ONLINE", active: "ACTIVE", running: "RUNNING",
    connected: "CONNECTED", idle: "IDLE", degraded: "DEGRADED",
    offline: "OFFLINE", disconnected: "DISCONNECTED", kill_switch_active: "KILL SWITCH",
  };
  return map[s] ?? s.toUpperCase().replace(/_/g, " ");
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: "9px", fontFamily: "Space Grotesk", letterSpacing: "0.16em",
      textTransform: "uppercase", color: C.outline }}>
      {children}
    </span>
  );
}

function fmt(n: number | null | undefined, d = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  return n.toFixed(d);
}

function timeAgo(iso: string | null): string {
  if (!iso) return "–";
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

// ── Status Dot ─────────────────────────────────────────────────────────────
function StatusDot({ status }: { status: Status }) {
  const color = statusColor(status);
  return (
    <div style={{ position: "relative", width: 8, height: 8, flexShrink: 0 }}>
      <div style={{
        width: 8, height: 8, borderRadius: "50%", background: color,
        boxShadow: `0 0 6px ${color}`,
      }} />
    </div>
  );
}

// ── Component Card ─────────────────────────────────────────────────────────
function ComponentCard({ row }: { row: ComponentRow }) {
  const color = statusColor(safeObj(row).status ?? "unknown");
  return (
    <div className="rounded-lg p-5" style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderLeft: `3px solid ${color}`,
      transition: "border-color 0.3s",
    }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined" style={{ fontSize: 18, color }}>{row.icon}</span>
          <span style={{ fontFamily: "Space Grotesk", fontWeight: 600, fontSize: 13, color: "#fff" }}>{row.name}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <StatusDot status={safeObj(row).status ?? "unknown"} />
          <span style={{ fontSize: "10px", color, fontWeight: 600, letterSpacing: "0.08em" }}>
            {statusLabel(safeObj(row).status ?? "unknown")}
          </span>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-3 gap-3">
        {row.primary_metric !== undefined && (
          <div>
            <Label>{row.primary_label ?? "–"}</Label>
            <div style={{ fontFamily: "JetBrains Mono", fontSize: 16, color, marginTop: 3 }}>
              {row.primary_metric}
            </div>
          </div>
        )}
        {row.secondary_metric !== undefined && (
          <div>
            <Label>{row.secondary_label ?? "–"}</Label>
            <div style={{ fontFamily: "JetBrains Mono", fontSize: 16, color: C.secondary, marginTop: 3 }}>
              {row.secondary_metric}
            </div>
          </div>
        )}
        {row.tertiary_metric !== undefined && (
          <div>
            <Label>{row.tertiary_label ?? "–"}</Label>
            <div style={{ fontFamily: "JetBrains Mono", fontSize: 16, color: C.muted, marginTop: 3 }}>
              {row.tertiary_metric}
            </div>
          </div>
        )}
      </div>

      {row.detail && (
        <div style={{ marginTop: 10, fontSize: "10px", color: C.outline,
          borderTop: `1px solid ${C.outlineVar}22`, paddingTop: 8 }}>
          {row.detail}
        </div>
      )}
    </div>
  );
}

// ── Overall Health Bar ─────────────────────────────────────────────────────
function HealthBar({ components }: { components: Status[] }) {
  const total = components.length;
  const online = components.filter(s => ["online", "active", "running", "connected"].includes(s)).length;
  const degraded = components.filter(s => ["degraded", "idle"].includes(s)).length;
  const offline  = components.filter(s => ["offline", "disconnected", "kill_switch_active"].includes(s)).length;
  const pct = total > 0 ? Math.round((online / total) * 100) : 0;

  return (
    <div className="rounded-lg p-5" style={{ background: C.card, border: `1px solid ${C.border}`, marginBottom: 20 }}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <span style={{ fontFamily: "Bebas Neue", fontSize: 16, color: "#fff", letterSpacing: "0.06em" }}>
            SYSTEM HEALTH
          </span>
          <span style={{ marginLeft: 12, fontSize: 11, color: C.muted }}>
            {online} operational · {degraded} degraded · {offline} offline
          </span>
        </div>
        <span style={{ fontFamily: "JetBrains Mono", fontSize: 24,
          color: pct >= 80 ? C.primary : pct >= 50 ? C.gold : C.tertiary }}>
          {pct}%
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: C.outlineVar, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${pct}%`, borderRadius: 3,
          background: pct >= 80 ? C.primary : pct >= 50 ? C.gold : C.tertiary,
          transition: "width 0.5s ease",
        }} />
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function IntelligenceCenterPage() {
  const { data, isLoading, error, dataUpdatedAt } = useQuery<IntelligenceCenterData>({
    queryKey: ["intelligence-center"],
    queryFn: () => fetch("/api/system/intelligence-center").then(r => r.ok ? r.json() : Promise.reject(r.statusText)),
    refetchInterval: 10_000,
    retry: 2,
  });

  const rows: ComponentRow[] = data ? [
    {
      name: "API Server",
      icon: "dns",
      status: data?.server?.status ?? "unknown",
      primary_metric: data?.server?.uptime_human,
      primary_label: "Uptime",
      secondary_metric: String(data?.server?.system_mode ?? "—").toUpperCase(),
      secondary_label: "Mode",
      tertiary_metric: data?.server?.node_version,
      tertiary_label: "Node",
      detail: `Started ${timeAgo(data?.server?.started_at)}`,
    },
    {
      name: "Database",
      icon: "storage",
      status: data?.database?.status ?? "unknown",
      primary_metric: (data?.database?.status ?? "unknown") === "online" ? "CONNECTED" : "ERROR",
      primary_label: "State",
      secondary_metric: `${data?.database?.latency_ms}ms`,
      secondary_label: "Latency",
      detail: data?.database?.latency_ms < 10 ? "Sub-10ms · Excellent" : data?.database?.latency_ms < 100 ? "Normal latency" : "High latency",
    },
    {
      name: "ML Model",
      icon: "model_training",
      status: (data?.ml_model?.status ?? "unknown") as Status,
      primary_metric: data?.ml_model?.accuracy !== null ? `${fmt(data?.ml_model?.accuracy * 100, 1)}%` : "–",
      primary_label: "Accuracy",
      secondary_metric: safeLocale(data?.ml_model?.sample_count),
      secondary_label: "Samples",
      tertiary_metric: timeAgo(data?.ml_model?.last_trained_at),
      tertiary_label: "Last Train",
      detail: data?.ml_model?.message,
    },
    {
      name: "Super Intelligence",
      icon: "auto_awesome",
      status: (data?.super_intelligence?.status ?? "unknown") as Status,
      primary_metric: data?.super_intelligence?.ensemble_accuracy !== null
        ? `${fmt(data?.super_intelligence?.ensemble_accuracy * 100, 1)}%`
        : "–",
      primary_label: "Ensemble Acc",
      secondary_metric: String(data?.super_intelligence?.ensemble_size),
      secondary_label: "Models",
      tertiary_metric: safeLocale(data?.super_intelligence?.total_processed),
      tertiary_label: "Processed",
      detail: data?.super_intelligence?.message,
    },
    {
      name: "Risk Engine",
      icon: "shield",
      status: (data?.risk_engine?.status ?? "unknown") as Status,
      primary_metric: data?.risk_engine?.kill_switch_active ? "ARMED" : "SAFE",
      primary_label: "Kill Switch",
      secondary_metric: String(data?.risk_engine?.open_positions ?? 0),
      secondary_label: "Positions",
      tertiary_metric: data?.risk_engine?.daily_pnl_pct !== null
        ? `${data?.risk_engine?.daily_pnl_pct >= 0 ? "+" : ""}${fmt(data?.risk_engine?.daily_pnl_pct, 2)}%`
        : "–",
      tertiary_label: "Daily PnL",
      detail: `Session: ${data?.risk_engine?.session ?? "–"} · Max DD: ${data?.risk_engine?.max_drawdown_pct !== null ? `${fmt(data?.risk_engine?.max_drawdown_pct, 1)}%` : "–"}`,
    },
    {
      name: "Alpaca Broker",
      icon: "account_balance",
      status: (data?.alpaca?.status ?? "unknown") as Status,
      primary_metric: data?.alpaca?.account_value != null ? `$${safeNum(data?.alpaca?.account_value).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "–",
      primary_label: "Portfolio",
      secondary_metric: data?.alpaca?.can_write_orders ? "YES" : "NO",
      secondary_label: "Can Trade",
      tertiary_metric: data?.alpaca?.is_live_mode ? "LIVE" : "PAPER",
      tertiary_label: "Mode",
      detail: (data?.alpaca?.status ?? "unknown") === "connected" ? "API keys valid · ready" : "API keys not configured",
    },
    {
      name: "Retrain Scheduler",
      icon: "schedule",
      status: (data?.scheduler?.status ?? "unknown") as Status,
      primary_metric: String(data?.scheduler?.retrain_count),
      primary_label: "Retrains",
      secondary_metric: timeAgo(data?.scheduler?.last_retrain_at),
      secondary_label: "Last Run",
      tertiary_metric: data?.scheduler?.next_retrain_at ? timeAgo(data?.scheduler?.next_retrain_at).replace(" ago", "") : "–",
      tertiary_label: "Next Run",
      detail: data?.scheduler?.retrain_interval_h ? `Every ${data?.scheduler?.retrain_interval_h}h` : "Manual retrain only",
    },
    {
      name: "Signal Stream",
      icon: "sensors",
      status: (data?.signal_stream?.status ?? "unknown") as Status,
      primary_metric: String(data?.signal_stream?.connected_clients),
      primary_label: "SSE Clients",
      secondary_metric: safeLocale(data?.signal_stream?.signals_last_24h),
      secondary_label: "Signals 24h",
      detail: "Server-sent events · real-time push",
    },
    {
      name: "Brain / Knowledge Graph",
      icon: "neurology",
      status: (data?.brain?.status ?? "unknown") as Status,
      primary_metric: safeLocale(data?.brain?.entity_count),
      primary_label: "Entities",
      secondary_metric: String(data?.trading?.trades_today ?? 0),
      secondary_label: "Trades Today",
      detail: data?.brain?.entity_count > 0 ? "Knowledge graph populated" : "Knowledge graph empty — run brain cycle",
    },
  ] : [];

  const allStatuses = rows.map(r => r?.status ?? "unknown");

  return (
    <div style={{ background: C.bg, minHeight: "100vh", padding: "24px", fontFamily: "Space Grotesk, sans-serif" }}>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 style={{ fontFamily: "Bebas Neue, sans-serif", fontSize: "32px", color: "#fff", letterSpacing: "0.04em", margin: 0 }}>
            INTELLIGENCE CONTROL CENTER
          </h1>
          <div style={{ fontSize: "11px", color: C.muted, marginTop: 2 }}>
            Live system telemetry · All components · Auto-refresh every 10s
          </div>
        </div>
        <div style={{ textAlign: "right", fontSize: "10px", color: C.outline }}>
          {dataUpdatedAt > 0 && <div>Updated {new Date(dataUpdatedAt).toLocaleTimeString()}</div>}
          {isLoading && <div style={{ color: C.gold }}>Loading…</div>}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded p-4 mb-5" style={{ background: `${C.tertiary}15`, border: `1px solid ${C.tertiary}40` }}>
          <span style={{ color: C.tertiary, fontSize: 12 }}>⚠ Could not reach backend — {String(error)}</span>
        </div>
      )}

      {/* Health Bar */}
      {data && <HealthBar components={allStatuses} />}

      {/* Skeleton or Grid */}
      {isLoading && !data && (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="rounded-lg p-5 animate-pulse"
              style={{ background: C.card, border: `1px solid ${C.border}`, height: 140 }} />
          ))}
        </div>
      )}

      {data && (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
          {rows.map(row => <ComponentCard key={row.name} row={row} />)}
        </div>
      )}

      {/* System Info Footer */}
      {data && (
        <div className="mt-6 flex items-center gap-6" style={{ fontSize: "10px", color: C.outline }}>
          <span>System Mode: <span style={{ color: C.gold }}>{String(data?.server?.system_mode ?? "—").toUpperCase()}</span></span>
          <span>Node: {data?.server?.node_version}</span>
          <span>Snapshot: {data?.generated_at ? new Date(data.generated_at).toLocaleString() : "—"}</span>
        </div>
      )}
    </div>
  );
}
