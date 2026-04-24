"use client";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";

const MOCK = {
  summary: { today: 1247.50, week: 4832.20, month: 12450.80, allTime: 87320.15 },
  byStrategy: [
    { name: "OB Retest Long", pnl: 3240.50, trades: 18, winRate: 72, sharpe: 1.8 },
    { name: "Liquidity Sweep", pnl: 1890.20, trades: 12, winRate: 67, sharpe: 1.5 },
    { name: "BOS Continuation", pnl: -420.30, trades: 8, winRate: 50, sharpe: 0.6 },
    { name: "Mean Reversion", pnl: 780.00, trades: 15, winRate: 60, sharpe: 1.2 },
  ],
  bySymbol: [
    { symbol: "SPY", pnl: 2450.80, trades: 22, avgHold: "2.4h" },
    { symbol: "QQQ", pnl: 1680.40, trades: 15, avgHold: "1.8h" },
    { symbol: "AAPL", pnl: 520.00, trades: 8, avgHold: "3.2h" },
    { symbol: "TSLA", pnl: -890.50, trades: 6, avgHold: "45m" },
    { symbol: "NVDA", pnl: 1730.00, trades: 10, avgHold: "1.5h" },
  ],
};

export default function PortfolioPnlPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"strategy" | "symbol">("strategy");

  useEffect(() => {
    (async () => {
      try { const r = await api.portfolio.getPnL(); setData(r ?? MOCK); }
      catch { setData(MOCK); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="p-6"><div className="animate-pulse h-8 bg-white/5 rounded w-48 mb-4" /><div className="animate-pulse h-64 bg-white/5 rounded" /></div>;

  const s = data?.summary ?? MOCK.summary;
  const pnlColor = (n: number) => n >= 0 ? "text-emerald-400" : "text-red-400";
  const fmt = (n: number) => `${n >= 0 ? "+" : ""}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Profit &amp; Loss</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Today", value: s.today },
          { label: "This Week", value: s.week },
          { label: "This Month", value: s.month },
          { label: "All Time", value: s.allTime },
        ].map((c) => (
          <div key={c.label} className="rounded-lg border border-white/10 bg-white/5 p-4">
            <span className="text-xs text-zinc-500">{c.label}</span>
            <p className={`text-xl font-mono font-semibold ${pnlColor(c.value)}`}>{fmt(c.value)}</p>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={() => setTab("strategy")} className={`px-3 py-1.5 rounded text-sm ${tab === "strategy" ? "bg-blue-600 text-white" : "bg-white/5 text-zinc-400"}`}>By Strategy</button>
        <button onClick={() => setTab("symbol")} className={`px-3 py-1.5 rounded text-sm ${tab === "symbol" ? "bg-blue-600 text-white" : "bg-white/5 text-zinc-400"}`}>By Symbol</button>
      </div>
      {tab === "strategy" ? (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-zinc-500 border-b border-white/10">
            <th className="pb-2 pr-3">Strategy</th><th className="pb-2 pr-3">P&amp;L</th><th className="pb-2 pr-3">Trades</th><th className="pb-2 pr-3">Win Rate</th><th className="pb-2">Sharpe</th>
          </tr></thead>
          <tbody>
            {(data?.byStrategy ?? MOCK.byStrategy).map((r: any) => (
              <tr key={r.name} className="border-b border-white/5">
                <td className="py-2 pr-3 font-medium">{r.name}</td>
                <td className={`py-2 pr-3 font-mono ${pnlColor(r.pnl)}`}>{fmt(r.pnl)}</td>
                <td className="py-2 pr-3 font-mono">{r.trades}</td>
                <td className="py-2 pr-3 font-mono">{r.winRate}%</td>
                <td className="py-2 font-mono">{r.sharpe}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-zinc-500 border-b border-white/10">
            <th className="pb-2 pr-3">Symbol</th><th className="pb-2 pr-3">P&amp;L</th><th className="pb-2 pr-3">Trades</th><th className="pb-2">Avg Hold</th>
          </tr></thead>
          <tbody>
            {(data?.bySymbol ?? MOCK.bySymbol).map((r: any) => (
              <tr key={r.symbol} className="border-b border-white/5">
                <td className="py-2 pr-3 font-mono font-medium">{r.symbol}</td>
                <td className={`py-2 pr-3 font-mono ${pnlColor(r.pnl)}`}>{fmt(r.pnl)}</td>
                <td className="py-2 pr-3 font-mono">{r.trades}</td>
                <td className="py-2 font-mono text-zinc-400">{r.avgHold}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
