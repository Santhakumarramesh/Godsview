import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE_URL ?? "";

type Alert = {
  type: string;
  severity: "warning" | "critical" | "fatal";
  message: string;
  details: Record<string, unknown>;
  timestamp: string;
  acknowledged: boolean;
};

type StreamEvent = {
  type: string;
  timestamp: string;
  payload: Record<string, unknown>;
};

function severityColor(s: string) {
  if (s === "fatal") return "bg-red-900/60 border-red-500 text-red-200";
  if (s === "critical") return "bg-orange-900/40 border-orange-500 text-orange-200";
  return "bg-yellow-900/30 border-yellow-600 text-yellow-200";
}

function severityIcon(s: string) {
  if (s === "fatal") return "\u2620\uFE0F";
  if (s === "critical") return "\u26A0\uFE0F";
  return "\u26A1";
}

function typeLabel(t: string) {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function timeAgo(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export default function AlertsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"active" | "history" | "live">("active");
  const [liveEvents, setLiveEvents] = useState<StreamEvent[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  // ── REST queries ─────────────────────────────────────────────
  const { data: activeData } = useQuery({
    queryKey: ["alerts", "active"],
    queryFn: () => fetch(`${API}/api/alerts/active`).then((r) => r.json()),
    refetchInterval: 5000,
  });

  const { data: historyData } = useQuery({
    queryKey: ["alerts", "history"],
    queryFn: () => fetch(`${API}/api/alerts?limit=100`).then((r) => r.json()),
    refetchInterval: 10000,
  });

  const { data: streamStatus } = useQuery({
    queryKey: ["stream", "status"],
    queryFn: () => fetch(`${API}/api/stream/status`).then((r) => r.json()),
    refetchInterval: 15000,
  });

  const ackMutation = useMutation({
    mutationFn: (ts: string) =>
      fetch(`${API}/api/alerts/${encodeURIComponent(ts)}/ack`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
    },
  });

  // ── SSE live stream ──────────────────────────────────────────
  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) eventSourceRef.current.close();
    const es = new EventSource(`${API}/api/alerts/stream`);
    eventSourceRef.current = es;

    es.addEventListener("alert", (e) => {
      try {
        const event: StreamEvent = JSON.parse(e.data);
        setLiveEvents((prev) => [event, ...prev].slice(0, 100));
        queryClient.invalidateQueries({ queryKey: ["alerts"] });
      } catch { /* ignore parse errors */ }
    });

    es.addEventListener("system", (e) => {
      try {
        const event: StreamEvent = JSON.parse(e.data);
        setLiveEvents((prev) => [event, ...prev].slice(0, 100));
      } catch { /* ignore */ }
    });

    es.onerror = () => {
      es.close();
      setTimeout(connectSSE, 3000); // reconnect after 3s
    };
  }, [queryClient]);

  useEffect(() => {
    if (tab === "live") connectSSE();
    return () => { eventSourceRef.current?.close(); };
  }, [tab, connectSSE]);

  const active: Alert[] = activeData?.alerts ?? [];
  const history: Alert[] = historyData?.alerts ?? [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Alerts & Live Stream</h1>
          <p className="text-sm text-zinc-400 mt-1">
            {active.length} active alert{active.length !== 1 ? "s" : ""} &middot;{" "}
            {streamStatus?.connectedClients ?? 0} SSE clients connected
          </p>
        </div>
        <div className="flex gap-1 bg-zinc-800 rounded-lg p-1">
          {(["active", "history", "live"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                tab === t ? "bg-zinc-600 text-white" : "text-zinc-400 hover:text-white"
              }`}
            >
              {t === "active" ? `Active (${active.length})` : t === "history" ? "History" : "Live Feed"}
            </button>
          ))}
        </div>
      </div>

      {/* Active Alerts Tab */}
      {tab === "active" && (
        <div className="space-y-3">
          {active.length === 0 ? (
            <div className="text-center py-12 text-zinc-500">
              <p className="text-4xl mb-2">&#x2705;</p>
              <p className="text-lg">No active alerts</p>
              <p className="text-sm mt-1">All systems operating normally</p>
            </div>
          ) : (
            active.map((a, i) => (
              <div key={i} className={`rounded-lg border p-4 ${severityColor(a.severity)}`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <span className="text-xl">{severityIcon(a.severity)}</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm uppercase tracking-wide">
                          {typeLabel(a.type)}
                        </span>
                        <span className="text-xs opacity-60">{a.severity}</span>
                      </div>
                      <p className="mt-1 text-sm">{a.message}</p>
                      <p className="mt-1 text-xs opacity-50">{timeAgo(a.timestamp)}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => ackMutation.mutate(a.timestamp)}
                    className="px-3 py-1 text-xs bg-zinc-700 hover:bg-zinc-600 text-white rounded transition-colors"
                  >
                    Acknowledge
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* History Tab */}
      {tab === "history" && (
        <div className="space-y-2">
          {history.length === 0 ? (
            <p className="text-center py-8 text-zinc-500">No alert history</p>
          ) : (
            <div className="bg-zinc-900 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-zinc-400 text-xs border-b border-zinc-800">
                    <th className="text-left px-4 py-2">Time</th>
                    <th className="text-left px-4 py-2">Severity</th>
                    <th className="text-left px-4 py-2">Type</th>
                    <th className="text-left px-4 py-2">Message</th>
                    <th className="text-left px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((a, i) => (
                    <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                      <td className="px-4 py-2 text-zinc-400 text-xs whitespace-nowrap">
                        {new Date(a.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          a.severity === "fatal" ? "bg-red-900/50 text-red-300" :
                          a.severity === "critical" ? "bg-orange-900/50 text-orange-300" :
                          "bg-yellow-900/50 text-yellow-300"
                        }`}>
                          {a.severity}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-zinc-300">{typeLabel(a.type)}</td>
                      <td className="px-4 py-2 text-zinc-400 max-w-md truncate">{a.message}</td>
                      <td className="px-4 py-2">
                        {a.acknowledged
                          ? <span className="text-xs text-green-400">&#x2713; Acked</span>
                          : <span className="text-xs text-red-400">Unacked</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Live Feed Tab */}
      {tab === "live" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Connected to SSE stream &middot; {liveEvents.length} events received
          </div>
          {liveEvents.length === 0 ? (
            <div className="text-center py-12 text-zinc-500">
              <p className="text-lg">Waiting for events...</p>
              <p className="text-sm mt-1">Alert events will appear here in real-time</p>
            </div>
          ) : (
            <div className="space-y-1">
              {liveEvents.map((evt, i) => (
                <div key={i} className="bg-zinc-900 rounded px-4 py-2 flex items-start gap-3 text-sm border border-zinc-800">
                  <span className="text-xs text-zinc-500 whitespace-nowrap mt-0.5">
                    {new Date(evt.timestamp).toLocaleTimeString()}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    evt.type === "alert" ? "bg-red-900/50 text-red-300" :
                    evt.type === "system" ? "bg-blue-900/50 text-blue-300" :
                    "bg-zinc-700 text-zinc-300"
                  }`}>
                    {evt.type}
                  </span>
                  <span className="text-zinc-300 flex-1">
                    {evt.payload?.message as string ?? evt.payload?.action as string ?? JSON.stringify(evt.payload)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
