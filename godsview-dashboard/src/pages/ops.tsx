import React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Activity,
  Zap,
  Server,
} from "lucide-react";

interface ServiceHealth {
  name: string;
  status: "healthy" | "degraded" | "down";
  latency_ms: number | null;
  last_check: string;
  details: string;
}

interface OpsSnapshot {
  timestamp: string;
  overall_status: "green" | "yellow" | "red";
  services: ServiceHealth[];
  data_freshness: {
    alpaca_bars_age_ms: number | null;
    orderbook_age_ms: number | null;
    si_last_decision_age_ms: number | null;
  };
  broker: {
    connected: boolean;
    mode: string;
    account_equity: number | null;
    buying_power: number | null;
  };
  system: {
    uptime_ms: number;
    memory_used_mb: number;
    memory_total_mb: number;
    cpu_usage_pct: number | null;
  };
  engine_status: Record<
    string,
    { loaded: boolean; last_run: string | null; error_count: number }
  >;
  alerts: Array<{
    level: "info" | "warn" | "critical";
    message: string;
    timestamp: string;
  }>;
}

const formatUptimeMs = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
};

const formatFreshnessMs = (ms: number | null): string => {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s ago`;
  return `${Math.round(ms / 60000)}m ago`;
};

const getStatusColor = (status: string) => {
  switch (status) {
    case "healthy":
    case "green":
      return "text-green-400 bg-green-400/10";
    case "degraded":
    case "yellow":
      return "text-yellow-400 bg-yellow-400/10";
    case "down":
    case "red":
      return "text-red-400 bg-red-400/10";
    default:
      return "text-gray-400 bg-gray-400/10";
  }
};

const getStatusDot = (status: string) => {
  switch (status) {
    case "healthy":
    case "green":
      return "bg-green-500";
    case "degraded":
    case "yellow":
      return "bg-yellow-500";
    case "down":
    case "red":
      return "bg-red-500";
    default:
      return "bg-gray-500";
  }
};

const Ops: React.FC = () => {
  const { data: snapshot, isLoading, error } = useQuery<OpsSnapshot>({
    queryKey: ["ops-snapshot"],
    queryFn: async () => {
      const response = await fetch("/api/ops/snapshot");
      if (!response.ok) throw new Error("Failed to fetch ops snapshot");
      return response.json();
    },
    refetchInterval: 5000,
  });

  if (isLoading) {
    return (
      <div className="p-8 text-gray-400">
        <p>Loading ops monitor...</p>
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="p-8 text-red-400">
        <p>Failed to load ops snapshot</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a1a] p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-white">Ops Monitor</h1>
        <span className="text-xs text-gray-400">
          Updated {new Date(snapshot.timestamp).toLocaleTimeString()}
        </span>
      </div>

      {/* Overall Status & System Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Overall Status */}
        <div className={`rounded-lg p-6 ${getStatusColor(snapshot.overall_status)}`}>
          <div className="flex items-center gap-3">
            {snapshot.overall_status === "green" && (
              <CheckCircle className="w-8 h-8" />
            )}
            {snapshot.overall_status === "yellow" && (
              <AlertCircle className="w-8 h-8" />
            )}
            {snapshot.overall_status === "red" && (
              <AlertCircle className="w-8 h-8" />
            )}
            <div>
              <div className="text-xs opacity-75">Status</div>
              <div className="text-2xl font-bold uppercase">
                {snapshot.overall_status}
              </div>
            </div>
          </div>
        </div>

        {/* Uptime */}
        <div className="rounded-lg p-6 bg-blue-400/10 border border-blue-400/20">
          <div className="flex items-center gap-3 text-blue-400">
            <Clock className="w-8 h-8" />
            <div>
              <div className="text-xs opacity-75">Uptime</div>
              <div className="text-2xl font-bold">
                {formatUptimeMs(snapshot.system.uptime_ms)}
              </div>
            </div>
          </div>
        </div>

        {/* Memory Usage */}
        <div className="rounded-lg p-6 bg-purple-400/10 border border-purple-400/20">
          <div className="flex items-center gap-3 text-purple-400">
            <Activity className="w-8 h-8" />
            <div>
              <div className="text-xs opacity-75">Memory</div>
              <div className="text-2xl font-bold">
                {snapshot.system.memory_used_mb}MB /
                {snapshot.system.memory_total_mb}MB
              </div>
            </div>
          </div>
        </div>

        {/* Broker Status */}
        <div className="rounded-lg p-6 bg-cyan-400/10 border border-cyan-400/20">
          <div className="flex items-center gap-3 text-cyan-400">
            <Zap className="w-8 h-8" />
            <div>
              <div className="text-xs opacity-75">Broker</div>
              <div className="text-2xl font-bold">
                {snapshot.broker.connected ? "ON" : "OFF"}
              </div>
              <div className="text-xs opacity-75 mt-1">
                Mode: {snapshot.broker.mode}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Services Grid */}
      <div>
        <h2 className="text-xl font-semibold text-white mb-4">Services</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          {snapshot.services.map((service) => (
            <div
              key={service.name}
              className="rounded-lg bg-[#1a1a2e] border border-gray-700/30 p-4"
            >
              <div className="flex items-start gap-3">
                <div className={`w-3 h-3 rounded-full mt-1 ${getStatusDot(service.status)}`} />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-white truncate">
                    {service.name}
                  </div>
                  <div
                    className={`text-xs mt-1 font-medium ${
                      service.status === "healthy"
                        ? "text-green-400"
                        : service.status === "degraded"
                          ? "text-yellow-400"
                          : "text-red-400"
                    }`}
                  >
                    {service.status.toUpperCase()}
                  </div>
                  <div className="text-xs text-gray-400 mt-2 break-words">
                    {service.details}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Data Freshness */}
      <div>
        <h2 className="text-xl font-semibold text-white mb-4">Data Freshness</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { name: "Alpaca Bars", value: snapshot.data_freshness.alpaca_bars_age_ms },
            { name: "Orderbook", value: snapshot.data_freshness.orderbook_age_ms },
            { name: "SI Decision", value: snapshot.data_freshness.si_last_decision_age_ms },
          ].map((item) => (
            <div
              key={item.name}
              className="rounded-lg bg-[#1a1a2e] border border-gray-700/30 p-4"
            >
              <div className="text-sm text-gray-400 mb-2">{item.name}</div>
              <div className="text-2xl font-bold text-white">
                {formatFreshnessMs(item.value)}
              </div>
              {item.value && item.value > 60000 && (
                <div className="text-xs text-yellow-400 mt-2">Stale data</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Broker Details */}
      <div>
        <h2 className="text-xl font-semibold text-white mb-4">Broker</h2>
        <div className="rounded-lg bg-[#1a1a2e] border border-gray-700/30 p-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <div className="text-sm text-gray-400">Status</div>
              <div
                className={`text-lg font-bold mt-1 ${
                  snapshot.broker.connected
                    ? "text-green-400"
                    : "text-red-400"
                }`}
              >
                {snapshot.broker.connected ? "Connected" : "Disconnected"}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-400">Mode</div>
              <div className="text-lg font-bold text-white mt-1 uppercase">
                {snapshot.broker.mode}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-400">Equity</div>
              <div className="text-lg font-bold text-white mt-1">
                {snapshot.broker.account_equity
                  ? `$${snapshot.broker.account_equity.toLocaleString()}`
                  : "—"}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-400">Buying Power</div>
              <div className="text-lg font-bold text-white mt-1">
                {snapshot.broker.buying_power
                  ? `$${snapshot.broker.buying_power.toLocaleString()}`
                  : "—"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Engine Status Table */}
      <div>
        <h2 className="text-xl font-semibold text-white mb-4">Engine Status</h2>
        <div className="rounded-lg bg-[#1a1a2e] border border-gray-700/30 overflow-hidden">
          <table className="w-full">
            <thead className="bg-[#0a0a1a] border-b border-gray-700/30">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400">
                  Engine
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400">
                  Last Run
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400">
                  Errors
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/30">
              {Object.entries(snapshot.engine_status).map(([name, engine]) => (
                <tr key={name} className="hover:bg-[#151527] transition-colors">
                  <td className="px-6 py-3 text-sm text-white font-medium">
                    {name}
                  </td>
                  <td className="px-6 py-3 text-sm">
                    {engine.loaded ? (
                      <span className="text-green-400">Loaded</span>
                    ) : (
                      <span className="text-gray-400">Not Loaded</span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-400">
                    {engine.last_run
                      ? new Date(engine.last_run).toLocaleTimeString()
                      : "—"}
                  </td>
                  <td className="px-6 py-3 text-sm">
                    {engine.error_count > 0 ? (
                      <span className="text-red-400 font-medium">
                        {engine.error_count}
                      </span>
                    ) : (
                      <span className="text-gray-400">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Alerts Feed */}
      <div>
        <h2 className="text-xl font-semibold text-white mb-4">Alerts</h2>
        <div className="rounded-lg bg-[#1a1a2e] border border-gray-700/30 max-h-96 overflow-y-auto">
          {snapshot.alerts.length === 0 ? (
            <div className="p-6 text-center text-gray-400">No alerts</div>
          ) : (
            <div className="divide-y divide-gray-700/30">
              {snapshot.alerts.map((alert, idx) => (
                <div key={idx} className="p-4 hover:bg-[#151527] transition-colors">
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                        alert.level === "critical"
                          ? "bg-red-500"
                          : alert.level === "warn"
                            ? "bg-yellow-500"
                            : "bg-blue-500"
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-xs font-semibold uppercase ${
                            alert.level === "critical"
                              ? "text-red-400"
                              : alert.level === "warn"
                                ? "text-yellow-400"
                                : "text-blue-400"
                          }`}
                        >
                          {alert.level}
                        </span>
                        <span className="text-xs text-gray-500">
                          {new Date(alert.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-sm text-gray-300 mt-1 break-words">
                        {alert.message}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Ops;
