"use client";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";

const MOCK = [
  { timestamp: "2026-04-20T14:32:11.234Z", level: "info", service: "api-server", message: "Order ORD-4821 filled: SPY 100 @ 525.38" },
  { timestamp: "2026-04-20T14:31:55.102Z", level: "info", service: "risk-gate", message: "Pre-trade check PASSED for ORD-4821" },
  { timestamp: "2026-04-20T14:30:00.000Z", level: "warn", service: "scanner", message: "Regime shift detected: trending → choppy (QQQ)" },
  { timestamp: "2026-04-20T14:28:12.500Z", level: "error", service: "news-api", message: "Timeout fetching sentiment for TSLA — retry 2/3" },
  { timestamp: "2026-04-20T14:25:00.000Z", level: "info", service: "execution", message: "Paper order submitted: AAPL limit buy 200 @ 195.00" },
  { timestamp: "2026-04-20T14:22:33.100Z", level: "info", service: "memory", message: "Similar setup found: SPY 2026-03-15 (87% match)" },
  { timestamp: "2026-04-20T14:20:00.000Z", level: "warn", service: "python-svc", message: "Backtest worker memory at 85% — consider scaling" },
  { timestamp: "2026-04-20T14:18:44.200Z", level: "info", service: "brain", message: "God Brain cycle #4821 complete — 3 opportunities scored" },
];

export default function OpsLogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [levelFilter, setLevelFilter] = useState("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      try { const r = await api.ops.getLogs(); setLogs(Array.isArray(r) ? r : r?.logs ?? MOCK); }
      catch { setLogs(MOCK); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="p-6"><div className="animate-pulse h-8 bg-white/5 rounded w-48 mb-4" /><div className="animate-pulse h-64 bg-white/5 rounded" /></div>;

  const filtered = logs.filter((l) => (levelFilter === "all" || l.level === levelFilter) && (search === "" || l.message.toLowerCase().includes(search.toLowerCase()) || l.service.toLowerCase().includes(search.toLowerCase())));
  const lc = (l: string) => ({ info: "text-blue-400", warn: "text-amber-400", error: "text-red-400", debug: "text-zinc-500" }[l] ?? "text-zinc-400");

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Logs</h1>
      <div className="flex gap-2 items-center">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search logs..." className="bg-white/5 border border-white/10 rounded px-3 py-1.5 text-sm flex-1 outline-none focus:border-blue-500/50" />
        {["all", "info", "warn", "error"].map((l) => (
          <button key={l} onClick={() => setLevelFilter(l)} className={`px-2 py-1 rounded text-xs font-mono uppercase ${levelFilter === l ? "bg-blue-600 text-white" : "bg-white/5 text-zinc-400"}`}>{l}</button>
        ))}
      </div>
      <div className="font-mono text-xs space-y-0.5 bg-black/30 rounded-lg p-4 max-h-[600px] overflow-y-auto">
        {filtered.map((l, i) => (
          <div key={i} className="flex gap-2 hover:bg-white/5 px-1 py-0.5 rounded">
            <span className="text-zinc-600 w-24 shrink-0">{new Date(l.timestamp).toLocaleTimeString()}</span>
            <span className={`w-12 shrink-0 uppercase ${lc(l.level)}`}>{l.level}</span>
            <span className="text-zinc-500 w-24 shrink-0">{l.service}</span>
            <span className="text-zinc-300">{l.message}</span>
          </div>
        ))}
        {filtered.length === 0 && <p className="text-zinc-600 text-center py-4">No logs match filters.</p>}
      </div>
    </div>
  );
}
