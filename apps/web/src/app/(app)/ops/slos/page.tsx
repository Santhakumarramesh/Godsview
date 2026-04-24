"use client";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";

const MOCK = [
  { name: "API Availability", target: 99.9, current: 99.95, budgetRemaining: 87, burnRate: 0.4, unit: "%" },
  { name: "API Latency (p95)", target: 200, current: 85, budgetRemaining: 92, burnRate: 0.2, unit: "ms" },
  { name: "Error Rate", target: 0.1, current: 0.03, budgetRemaining: 95, burnRate: 0.1, unit: "%" },
  { name: "Data Freshness", target: 5, current: 2.1, budgetRemaining: 78, burnRate: 0.8, unit: "sec" },
  { name: "Order Fill Latency", target: 500, current: 210, budgetRemaining: 90, burnRate: 0.3, unit: "ms" },
  { name: "Broker Uptime", target: 99.5, current: 99.8, budgetRemaining: 85, burnRate: 0.5, unit: "%" },
];

export default function OpsSlosPage() {
  const [slos, setSlos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try { const r = await api.ops.getSlos(); setSlos(Array.isArray(r) ? r : r?.slos ?? MOCK); }
      catch { setSlos(MOCK); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="p-6"><div className="animate-pulse h-8 bg-white/5 rounded w-48 mb-4" /><div className="animate-pulse h-64 bg-white/5 rounded" /></div>;

  const budgetColor = (b: number) => b > 80 ? "bg-emerald-500" : b > 50 ? "bg-amber-500" : "bg-red-500";

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Service Level Objectives</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {slos.map((s) => (
          <div key={s.name} className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
            <h3 className="font-medium text-sm">{s.name}</h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><span className="text-zinc-500">Target</span><p className="font-mono text-lg">{s.target}<span className="text-xs text-zinc-500">{s.unit}</span></p></div>
              <div><span className="text-zinc-500">Current</span><p className="font-mono text-lg text-emerald-400">{s.current}<span className="text-xs text-zinc-500">{s.unit}</span></p></div>
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-zinc-500">Error Budget</span>
                <span className="font-mono">{s.budgetRemaining}%</span>
              </div>
              <div className="w-full h-2 bg-white/10 rounded-full">
                <div className={`h-full rounded-full ${budgetColor(s.budgetRemaining)}`} style={{ width: `${s.budgetRemaining}%` }} />
              </div>
            </div>
            <div className="text-xs text-zinc-500">Burn rate: <span className="font-mono">{s.burnRate}x</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}
