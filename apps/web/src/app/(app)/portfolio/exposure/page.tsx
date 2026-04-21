"use client";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";

const MOCK = {
  summary: { totalLong: 142500, totalShort: 38200, netExposure: 104300, grossExposure: 180700 },
  positions: [
    { symbol: "SPY", side: "long", notional: 52540, weight: 29.1, sector: "Index" },
    { symbol: "QQQ", side: "long", notional: 44712, weight: 24.7, sector: "Index" },
    { symbol: "AAPL", side: "long", notional: 19500, weight: 10.8, sector: "Technology" },
    { symbol: "NVDA", side: "long", notional: 13375, weight: 7.4, sector: "Technology" },
    { symbol: "AMZN", side: "long", notional: 7458, weight: 4.1, sector: "Consumer" },
    { symbol: "TSLA", side: "short", notional: 16850, weight: 9.3, sector: "Automotive" },
    { symbol: "META", side: "short", notional: 12480, weight: 6.9, sector: "Technology" },
    { symbol: "MSFT", side: "short", notional: 8870, weight: 4.9, sector: "Technology" },
  ],
};

export default function PortfolioExposurePage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try { const r = await api.portfolio.getExposure(); setData(r ?? MOCK); }
      catch { setData(MOCK); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="p-6"><div className="animate-pulse h-8 bg-white/5 rounded w-48 mb-4" /><div className="animate-pulse h-64 bg-white/5 rounded" /></div>;

  const s = data?.summary ?? MOCK.summary;
  const positions = data?.positions ?? MOCK.positions;
  const fmt = (n: number) => `$${n.toLocaleString()}`;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Portfolio Exposure</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Long", value: s.totalLong, color: "text-emerald-400" },
          { label: "Total Short", value: s.totalShort, color: "text-red-400" },
          { label: "Net Exposure", value: s.netExposure, color: "text-blue-400" },
          { label: "Gross Exposure", value: s.grossExposure, color: "text-zinc-300" },
        ].map((c) => (
          <div key={c.label} className="rounded-lg border border-white/10 bg-white/5 p-4">
            <span className="text-xs text-zinc-500">{c.label}</span>
            <p className={`text-xl font-mono font-semibold ${c.color}`}>{fmt(c.value)}</p>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-zinc-500 border-b border-white/10">
            <th className="pb-2 pr-3">Symbol</th><th className="pb-2 pr-3">Side</th><th className="pb-2 pr-3">Sector</th><th className="pb-2 pr-3">Notional</th><th className="pb-2">Weight</th>
          </tr></thead>
          <tbody>
            {positions.map((p: any) => (
              <tr key={p.symbol} className="border-b border-white/5 hover:bg-white/5">
                <td className="py-2 pr-3 font-mono font-medium">{p.symbol}</td>
                <td className={`py-2 pr-3 text-xs font-mono uppercase ${p.side === "long" ? "text-emerald-400" : "text-red-400"}`}>{p.side}</td>
                <td className="py-2 pr-3 text-zinc-400">{p.sector}</td>
                <td className="py-2 pr-3 font-mono">{fmt(p.notional)}</td>
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-2 bg-white/10 rounded-full"><div className={`h-full rounded-full ${p.side === "long" ? "bg-emerald-500" : "bg-red-500"}`} style={{ width: `${Math.min(p.weight * 3, 100)}%` }} /></div>
                    <span className="font-mono text-xs">{p.weight}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
