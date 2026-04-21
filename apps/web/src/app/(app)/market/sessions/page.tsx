"use client";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";

const MOCK = [
  { name: "Pre-Market", status: "closed", timeRange: "04:00–09:30 ET", volume: "1.2M", activeSymbols: 45, tradingAllowed: false },
  { name: "Regular", status: "open", timeRange: "09:30–16:00 ET", volume: "28.4M", activeSymbols: 312, tradingAllowed: true },
  { name: "After-Hours", status: "closed", timeRange: "16:00–20:00 ET", volume: "890K", activeSymbols: 28, tradingAllowed: false },
  { name: "Overnight", status: "closed", timeRange: "20:00–04:00 ET", volume: "340K", activeSymbols: 12, tradingAllowed: false },
];

export default function MarketSessionsPage() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try { const r = await api.market.getSessions(); setSessions(Array.isArray(r) ? r : r?.data ?? MOCK); }
      catch { setSessions(MOCK); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="p-6"><div className="animate-pulse h-8 bg-white/5 rounded w-48 mb-4" /><div className="animate-pulse h-64 bg-white/5 rounded" /></div>;

  const sc = (s: string) => s === "open" ? "text-emerald-400 bg-emerald-400/10" : "text-zinc-500 bg-zinc-500/10";

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Trading Sessions</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sessions.map((s) => (
          <div key={s.name} className="rounded-lg border border-white/10 bg-white/5 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium">{s.name}</h2>
              <span className={`text-xs font-mono uppercase px-2 py-1 rounded ${sc(s.status)}`}>{s.status}</span>
            </div>
            <p className="text-sm text-zinc-400">{s.timeRange}</p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-zinc-500">Volume</span><p className="font-mono">{s.volume}</p></div>
              <div><span className="text-zinc-500">Active Symbols</span><p className="font-mono">{s.activeSymbols}</p></div>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-white/5">
              <span className="text-xs text-zinc-500">Trading Allowed</span>
              <span className={`text-xs font-mono ${s.tradingAllowed ? "text-emerald-400" : "text-red-400"}`}>{s.tradingAllowed ? "YES" : "NO"}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
