/**
 * Phase 60 — Command Center (Dashboard Integration Hub)
 * Unified real-time view of system health, engine states, API metrics, and trading activity
 * with production-grade error handling, loading states, and system status indicators.
 */
import { useMemo } from "react";
import {
  useOrchestratorSnapshot,
  useSystemHealth,
  useGatewaySnapshot,
  useTradeJournalSnapshot,
  type SystemHealthSummary,
  type OrchestratorSnapshot,
  type GatewaySnapshot,
  type TradeJournalSnapshot,
} from "@/lib/api";

const COLORS = {
  bg: "#0e0e0f",
  card: "#1a191b",
  border: "rgba(72,72,73,0.2)",
  accent: "#9cff93",
  text: "#ffffff",
  muted: "#767576",
  bearish: "#ff6b6b",
  healthy: "#00d084",
  degraded: "#ffa500",
  critical: "#ff6b6b",
};

const FONTS = {
  label: "font-['Space_Grotesk']",
  data: "font-['JetBrains_Mono']",
};

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor: COLORS.accent, borderTopColor: "transparent" }} />
        <p style={{ color: COLORS.muted }} className="text-sm">Loading...</p>
      </div>
    </div>
  );
}

function ErrorState({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-lg p-6" style={{ backgroundColor: COLORS.card, border: `1px solid ${COLORS.border}` }}>
      <div className="flex items-start gap-3">
        <span style={{ color: COLORS.bearish }} className="text-xl">⚠️</span>
        <div>
          <h3 style={{ color: COLORS.text }} className="font-semibold mb-1">{title}</h3>
          <p style={{ color: COLORS.muted }} className="text-sm">{message}</p>
        </div>
      </div>
    </div>
  );
}

function HealthBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    healthy: COLORS.healthy,
    degraded: COLORS.degraded,
    critical: COLORS.bearish,
    offline: COLORS.muted,
  };
  const bgColor = colorMap[status] || COLORS.muted;
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${FONTS.label}`}
      style={{ backgroundColor: `${bgColor}20`, color: bgColor }}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function StatCard({ label, value, sub, isLoading }: { label: string; value: string | number; sub?: string; isLoading?: boolean }) {
  return (
    <div className="rounded-lg p-4 transition-all" style={{ backgroundColor: COLORS.card, border: `1px solid ${COLORS.border}` }}>
      <div style={{ color: COLORS.muted }} className={`text-xs mb-2 ${FONTS.label}`}>{label}</div>
      {isLoading ? (
        <div className="h-8 bg-gray-700 rounded animate-pulse" />
      ) : (
        <>
          <div style={{ color: COLORS.text }} className={`text-2xl font-bold ${FONTS.data}`}>{value}</div>
          {sub && <div style={{ color: COLORS.muted }} className="text-xs mt-2">{sub}</div>}
        </>
      )}
    </div>
  );
}

function SystemHealthPanel({ health, isLoading, error }: { health?: SystemHealthSummary; isLoading: boolean; error: Error | null }) {
  const statsData = useMemo(
    () => ({
      total: health?.enginesTotal ?? 0,
      running: health?.enginesRunning ?? 0,
      degraded: health?.enginesDegraded ?? 0,
      errors: health?.enginesError ?? 0,
    }),
    [health]
  );

  const uptime = useMemo(() => health ? (health.uptimeMs / 1000 / 60).toFixed(1) : "0", [health]);

  if (error) return <ErrorState title="System Health Error" message={error.message} />;
  if (isLoading) return <LoadingState />;
  if (!health) return <ErrorState title="No Data" message="System health data unavailable" />;

  return (
    <div className="rounded-xl p-6 space-y-4" style={{ backgroundColor: COLORS.card, border: `1px solid ${COLORS.border}` }}>
      <div className="flex items-center justify-between">
        <h2 style={{ color: COLORS.text }} className={`text-lg font-semibold ${FONTS.label}`}>System Health</h2>
        <HealthBadge status={health.overall} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Engines Total" value={statsData.total} />
        <StatCard label="Running" value={statsData.running} />
        <StatCard label="Degraded" value={statsData.degraded} />
        <StatCard label="Errors" value={statsData.errors} />
      </div>
      <div style={{ color: COLORS.muted, borderColor: COLORS.border }} className={`text-xs pt-2 border-t ${FONTS.data}`}>
        Uptime: {uptime} minutes
      </div>
    </div>
  );
}

function EngineListPanel({ snap, isLoading, error }: { snap?: OrchestratorSnapshot; isLoading: boolean; error: Error | null }) {
  const stateColors: Record<string, string> = {
    running: COLORS.healthy,
    degraded: COLORS.degraded,
    error: COLORS.bearish,
    stopped: COLORS.muted,
    starting: "#3b82f6",
    stopping: "#f59e0b",
  };

  const sortedEngines = useMemo(() => {
    if (!snap) return [];
    return [...snap.engines].sort((a, b) => {
      const stateOrder = { running: 0, starting: 1, degraded: 2, stopping: 3, error: 4, stopped: 5 };
      return (stateOrder[a.state as keyof typeof stateOrder] ?? 6) - (stateOrder[b.state as keyof typeof stateOrder] ?? 6);
    });
  }, [snap]);

  if (error) return <ErrorState title="Engines Error" message={error.message} />;
  if (isLoading) return <LoadingState />;
  if (!snap || snap.engines.length === 0) {
    return (
      <div className="rounded-xl p-6 text-center" style={{ backgroundColor: COLORS.card, border: `1px solid ${COLORS.border}` }}>
        <p style={{ color: COLORS.muted }} className="text-sm">No engines registered</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl p-6 space-y-3" style={{ backgroundColor: COLORS.card, border: `1px solid ${COLORS.border}` }}>
      <h2 style={{ color: COLORS.text }} className={`text-lg font-semibold ${FONTS.label}`}>Engines ({snap.engines.length})</h2>
      <div className="space-y-2 max-h-80 overflow-y-auto">
        {sortedEngines.map((e) => (
          <div key={e.id} className="flex items-center justify-between rounded px-3 py-2.5 transition-colors hover:opacity-80" style={{ backgroundColor: COLORS.bg }}>
            <div>
              <span style={{ color: COLORS.text }} className={`text-sm font-medium ${FONTS.data}`}>{e.name}</span>
              <span style={{ color: COLORS.muted }} className="text-xs ml-3">v{e.version}</span>
            </div>
            <span className={`text-xs font-semibold ${FONTS.label}`} style={{ color: stateColors[e.state] || COLORS.muted }}>
              {e.state.charAt(0).toUpperCase() + e.state.slice(1)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GatewayPanel({ gw, isLoading, error }: { gw?: GatewaySnapshot; isLoading: boolean; error: Error | null }) {
  const blockRate = useMemo(
    () => (gw && gw.totalRequests > 0 ? ((gw.blockedRequests / gw.totalRequests) * 100).toFixed(1) : "0.0"),
    [gw]
  );

  if (error) return <ErrorState title="Gateway Error" message={error.message} />;
  if (isLoading) return <LoadingState />;
  if (!gw) return null;

  return (
    <div className="rounded-xl p-6 space-y-4" style={{ backgroundColor: COLORS.card, border: `1px solid ${COLORS.border}` }}>
      <h2 style={{ color: COLORS.text }} className={`text-lg font-semibold ${FONTS.label}`}>API Gateway</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard label="Active Keys" value={gw.activeKeys} sub={`${gw.totalKeys} total`} />
        <StatCard label="Total Requests" value={gw.totalRequests.toLocaleString()} />
        <StatCard label="Blocked" value={gw.blockedRequests} sub={`${blockRate}%`} />
      </div>
    </div>
  );
}

function JournalPanel({ tj, isLoading, error }: { tj?: TradeJournalSnapshot; isLoading: boolean; error: Error | null }) {
  const winRate = useMemo(() => (tj ? `${(tj.winRate * 100).toFixed(1)}%` : "0%"), [tj]);

  if (error) return <ErrorState title="Trade Journal Error" message={error.message} />;
  if (isLoading) return <LoadingState />;
  if (!tj) return null;

  return (
    <div className="rounded-xl p-6 space-y-4" style={{ backgroundColor: COLORS.card, border: `1px solid ${COLORS.border}` }}>
      <h2 style={{ color: COLORS.text }} className={`text-lg font-semibold ${FONTS.label}`}>Trade Journal</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Entries" value={tj.totalEntries} />
        <StatCard label="Open Trades" value={tj.openTrades} />
        <StatCard label="Win Rate" value={winRate} />
        <StatCard label="Total PnL" value={`$${tj.totalPnl.toFixed(2)}`} />
      </div>
    </div>
  );
}

function EventLogPanel({ events, isLoading, error }: { events?: OrchestratorSnapshot["recentEvents"]; isLoading: boolean; error: Error | null }) {
  const sortedEvents = useMemo(() => {
    if (!events || events.length === 0) return [];
    return [...events].slice(-20).reverse();
  }, [events]);

  if (error) return <ErrorState title="Events Error" message={error.message} />;
  if (isLoading) return <LoadingState />;
  if (sortedEvents.length === 0) return null;

  return (
    <div className="rounded-xl p-6 space-y-3" style={{ backgroundColor: COLORS.card, border: `1px solid ${COLORS.border}` }}>
      <h2 style={{ color: COLORS.text }} className={`text-lg font-semibold ${FONTS.label}`}>Recent Events</h2>
      <div className="space-y-1.5 max-h-64 overflow-y-auto text-xs">
        {sortedEvents.map((ev) => (
          <div key={ev.id} className="flex gap-3 p-2 rounded" style={{ backgroundColor: COLORS.bg }}>
            <span style={{ color: COLORS.muted }} className={`w-20 flex-shrink-0 ${FONTS.data}`}>
              {new Date(ev.timestamp).toLocaleTimeString()}
            </span>
            <span style={{ color: COLORS.accent }} className={`w-24 flex-shrink-0 font-semibold ${FONTS.label}`}>
              {ev.type}
            </span>
            <span style={{ color: COLORS.text }}>{ev.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CommandCenter() {
  const { data: orchSnap, isLoading: orchLoading, error: orchError } = useOrchestratorSnapshot();
  const { data: health, isLoading: healthLoading, error: healthError } = useSystemHealth();
  const { data: gwSnap, isLoading: gwLoading, error: gwError } = useGatewaySnapshot();
  const { data: tjSnap, isLoading: tjLoading, error: tjError } = useTradeJournalSnapshot();

  return (
    <div className="min-h-screen p-6 space-y-6" style={{ backgroundColor: COLORS.bg }}>
      <div className="space-y-1">
        <h1 style={{ color: COLORS.text }} className={`text-3xl font-bold ${FONTS.label}`}>GodsView Command Center</h1>
        <p style={{ color: COLORS.muted }} className="text-sm">Unified view of all engines, systems, and trading activity</p>
      </div>

      <SystemHealthPanel health={health} isLoading={healthLoading} error={healthError as Error | null} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <EngineListPanel snap={orchSnap} isLoading={orchLoading} error={orchError as Error | null} />
        <GatewayPanel gw={gwSnap} isLoading={gwLoading} error={gwError as Error | null} />
      </div>

      <JournalPanel tj={tjSnap} isLoading={tjLoading} error={tjError as Error | null} />
      <EventLogPanel events={orchSnap?.recentEvents} isLoading={orchLoading} error={orchError as Error | null} />
    </div>
  );
}
