/**
 * Phase 60 — Command Center (Dashboard Integration Hub)
 * Unified view aggregating all engine snapshots, system health, and controls.
 */
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

function HealthBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    healthy: "bg-green-500",
    degraded: "bg-yellow-500",
    critical: "bg-red-500",
    offline: "bg-gray-500",
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs text-white font-bold ${colors[status] ?? "bg-gray-400"}`}>
      {status.toUpperCase()}
    </span>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-[#1a1a2e] rounded-lg p-4 border border-gray-700">
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className="text-2xl font-bold text-white">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

function SystemHealthPanel({ health }: { health?: SystemHealthSummary }) {
  if (!health) return <div className="text-gray-500">Loading health...</div>;
  return (
    <div className="bg-[#0f0f23] rounded-xl p-6 border border-gray-700">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-lg font-semibold text-white">System Health</h2>
        <HealthBadge status={health.overall} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Engines Total" value={health.enginesTotal} />
        <StatCard label="Running" value={health.enginesRunning} />
        <StatCard label="Degraded" value={health.enginesDegraded} />
        <StatCard label="Errors" value={health.enginesError} />
      </div>
      <div className="mt-2 text-xs text-gray-500">
        Uptime: {(health.uptimeMs / 1000 / 60).toFixed(1)} min
      </div>
    </div>
  );
}

function EngineListPanel({ snap }: { snap?: OrchestratorSnapshot }) {
  if (!snap) return null;
  const stateColors: Record<string, string> = {
    running: "text-green-400",
    degraded: "text-yellow-400",
    error: "text-red-400",
    stopped: "text-gray-500",
    starting: "text-blue-400",
    stopping: "text-orange-400",
  };
  return (
    <div className="bg-[#0f0f23] rounded-xl p-6 border border-gray-700">
      <h2 className="text-lg font-semibold text-white mb-3">Engines ({snap.engines.length})</h2>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {snap.engines.map((e) => (
          <div key={e.id} className="flex items-center justify-between bg-[#1a1a2e] rounded px-3 py-2">
            <div>
              <span className="text-white text-sm font-medium">{e.name}</span>
              <span className="text-gray-500 text-xs ml-2">v{e.version}</span>
            </div>
            <span className={`text-xs font-bold ${stateColors[e.state] ?? "text-gray-400"}`}>
              {e.state.toUpperCase()}
            </span>
          </div>
        ))}
        {snap.engines.length === 0 && <div className="text-gray-500 text-sm">No engines registered</div>}
      </div>
    </div>
  );
}

function GatewayPanel({ gw }: { gw?: GatewaySnapshot }) {
  if (!gw) return null;
  return (
    <div className="bg-[#0f0f23] rounded-xl p-6 border border-gray-700">
      <h2 className="text-lg font-semibold text-white mb-3">API Gateway</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard label="API Keys" value={gw.activeKeys} sub={`${gw.totalKeys} total`} />
        <StatCard label="Total Requests" value={gw.totalRequests.toLocaleString()} />
        <StatCard label="Blocked" value={gw.blockedRequests} sub={gw.totalRequests ? `${((gw.blockedRequests / gw.totalRequests) * 100).toFixed(1)}%` : "0%"} />
      </div>
    </div>
  );
}

function JournalPanel({ tj }: { tj?: TradeJournalSnapshot }) {
  if (!tj) return null;
  return (
    <div className="bg-[#0f0f23] rounded-xl p-6 border border-gray-700">
      <h2 className="text-lg font-semibold text-white mb-3">Trade Journal</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Entries" value={tj.totalEntries} />
        <StatCard label="Open" value={tj.openTrades} />
        <StatCard label="Win Rate" value={`${(tj.winRate * 100).toFixed(1)}%`} />
        <StatCard label="Total PnL" value={`$${tj.totalPnl.toFixed(2)}`} />
      </div>
    </div>
  );
}

function EventLogPanel({ events }: { events?: OrchestratorSnapshot["recentEvents"] }) {
  if (!events || events.length === 0) return null;
  return (
    <div className="bg-[#0f0f23] rounded-xl p-6 border border-gray-700">
      <h2 className="text-lg font-semibold text-white mb-3">Recent Events</h2>
      <div className="space-y-1 max-h-48 overflow-y-auto text-xs">
        {events.slice(-20).reverse().map((ev) => (
          <div key={ev.id} className="flex gap-2 text-gray-400">
            <span className="text-gray-600 w-20 flex-shrink-0">{new Date(ev.timestamp).toLocaleTimeString()}</span>
            <span className="text-blue-400 w-24 flex-shrink-0">{ev.type}</span>
            <span className="text-gray-300">{ev.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CommandCenter() {
  const { data: orchSnap } = useOrchestratorSnapshot();
  const { data: health } = useSystemHealth();
  const { data: gwSnap } = useGatewaySnapshot();
  const { data: tjSnap } = useTradeJournalSnapshot();

  return (
    <div className="min-h-screen bg-[#0a0a1a] p-6 space-y-6">
      <h1 className="text-2xl font-bold text-white">🛰️ GodsView Command Center</h1>
      <SystemHealthPanel health={health} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <EngineListPanel snap={orchSnap} />
        <GatewayPanel gw={gwSnap} />
      </div>
      <JournalPanel tj={tjSnap} />
      <EventLogPanel events={orchSnap?.recentEvents} />
    </div>
  );
}
