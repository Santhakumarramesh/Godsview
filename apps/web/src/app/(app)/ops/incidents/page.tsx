"use client";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";

const MOCK = [
  { id: "INC-012", severity: "P2", title: "News API degraded — high latency", status: "investigating", opened: "2026-04-20T10:15:00Z", resolved: null, duration: "4h 15m" },
  { id: "INC-011", severity: "P3", title: "Backtest worker OOM restart", status: "resolved", opened: "2026-04-19T22:00:00Z", resolved: "2026-04-19T22:45:00Z", duration: "45m" },
  { id: "INC-010", severity: "P1", title: "Broker WS disconnect during market hours", status: "resolved", opened: "2026-04-18T14:30:00Z", resolved: "2026-04-18T14:38:00Z", duration: "8m" },
  { id: "INC-009", severity: "P4", title: "Stale cache for scanner board", status: "resolved", opened: "2026-04-17T09:00:00Z", resolved: "2026-04-17T09:20:00Z", duration: "20m" },
];

export default function OpsIncidentsPage() {
  const [incidents, setIncidents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try { const r = await api.ops.getIncidents(); setIncidents(Array.isArray(r) ? r : r?.incidents ?? MOCK); }
      catch { setIncidents(MOCK); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="p-6"><div className="animate-pulse h-8 bg-white/5 rounded w-48 mb-4" /><div className="animate-pulse h-64 bg-white/5 rounded" /></div>;

  const sevColor = (s: string) => ({ P1: "text-red-400 bg-red-400/10", P2: "text-amber-400 bg-amber-400/10", P3: "text-blue-400 bg-blue-400/10", P4: "text-zinc-400 bg-zinc-400/10" }[s] ?? "text-zinc-400 bg-zinc-400/10");
  const statColor = (s: string) => s === "resolved" ? "text-emerald-400" : "text-amber-400";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Incidents</h1>
        <span className="text-xs text-zinc-500">{incidents.filter(i => i.status !== "resolved").length} open</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-zinc-500 border-b border-white/10">
            <th className="pb-2 pr-3">ID</th><th className="pb-2 pr-3">Sev</th><th className="pb-2 pr-3">Title</th><th className="pb-2 pr-3">Status</th><th className="pb-2 pr-3">Opened</th><th className="pb-2">Duration</th>
          </tr></thead>
          <tbody>
            {incidents.map((inc) => (
              <tr key={inc.id} className="border-b border-white/5 hover:bg-white/5">
                <td className="py-2 pr-3 font-mono text-xs">{inc.id}</td>
                <td className="py-2 pr-3"><span className={`text-xs font-mono px-2 py-0.5 rounded ${sevColor(inc.severity)}`}>{inc.severity}</span></td>
                <td className="py-2 pr-3">{inc.title}</td>
                <td className={`py-2 pr-3 text-xs font-mono ${statColor(inc.status)}`}>{inc.status}</td>
                <td className="py-2 pr-3 text-zinc-400 text-xs">{new Date(inc.opened).toLocaleString()}</td>
                <td className="py-2 font-mono text-xs">{inc.duration}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
