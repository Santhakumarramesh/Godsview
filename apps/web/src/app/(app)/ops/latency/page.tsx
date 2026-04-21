"use client";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";

const MOCK = [
  { service: "API Server", p50: 12, p95: 45, p99: 120, trend: "stable", status: "healthy" },
  { service: "Broker (Alpaca)", p50: 35, p95: 85, p99: 210, trend: "up", status: "healthy" },
  { service: "PostgreSQL", p50: 3, p95: 15, p99: 42, trend: "stable", status: "healthy" },
  { service: "Redis Cache", p50: 1, p95: 3, p99: 8, trend: "stable", status: "healthy" },
  { service: "Python Services", p50: 22, p95: 95, p99: 350, trend: "up", status: "warning" },
  { service: "TradingView Bridge", p50: 45, p95: 120, p99: 280, trend: "stable", status: "healthy" },
];

export default function OpsLatencyPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try { const r = await api.ops.getLatency(); setData(Array.isArray(r) ? r : r?.latency ?? MOCK); }
      catch { setData(MOCK); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="p-6"><div className="animate-pulse h-8 bg-white/5 rounded w-48 mb-4" /><div className="animate-pulse h-64 bg-white/5 rounded" /></div>;

  const hc = (s: string) => s === "healthy" ? "border-emerald-500/30" : s === "warning" ? "border-amber-500/30" : "border-red-500/30";
  const arrow = (t: string) => t === "up" ? "↑" : t === "down" ? "↓" : "→";
  const ac = (t: string) => t === "up" ? "text-red-400" : t === "down" ? "text-emerald-400" : "text-zinc-500";

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Service Latency</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.map((s) => (
          <div key={s.service} className={`rounded-lg border bg-white/5 p-4 space-y-3 ${hc(s.status)}`}>
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-sm">{s.service}</h3>
              <span className={`text-sm ${ac(s.trend)}`}>{arrow(s.trend)}</span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div><span className="text-zinc-500 text-xs block">p50</span><span className="font-mono text-lg">{s.p50}<span className="text-xs text-zinc-500">ms</span></span></div>
              <div><span className="text-zinc-500 text-xs block">p95</span><span className="font-mono text-lg">{s.p95}<span className="text-xs text-zinc-500">ms</span></span></div>
              <div><span className="text-zinc-500 text-xs block">p99</span><span className="font-mono text-lg text-amber-300">{s.p99}<span className="text-xs text-zinc-500">ms</span></span></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
