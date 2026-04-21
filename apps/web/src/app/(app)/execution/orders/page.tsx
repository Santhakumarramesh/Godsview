"use client";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";

const MOCK = [
  { id: "ORD-4821", symbol: "SPY", side: "buy", type: "limit", qty: 100, price: 525.40, status: "filled", filledQty: 100, filledPrice: 525.38, timestamp: "2026-04-20T14:32:11Z" },
  { id: "ORD-4820", symbol: "QQQ", side: "sell", type: "market", qty: 50, price: null, status: "filled", filledQty: 50, filledPrice: 447.12, timestamp: "2026-04-20T14:28:05Z" },
  { id: "ORD-4819", symbol: "AAPL", side: "buy", type: "limit", qty: 200, price: 195.00, status: "open", filledQty: 0, filledPrice: null, timestamp: "2026-04-20T14:25:00Z" },
  { id: "ORD-4818", symbol: "TSLA", side: "sell", type: "stop", qty: 30, price: 168.50, status: "cancelled", filledQty: 0, filledPrice: null, timestamp: "2026-04-20T13:50:22Z" },
  { id: "ORD-4817", symbol: "NVDA", side: "buy", type: "limit", qty: 75, price: 890.00, status: "rejected", filledQty: 0, filledPrice: null, timestamp: "2026-04-20T13:45:10Z" },
  { id: "ORD-4816", symbol: "AMZN", side: "buy", type: "market", qty: 40, price: null, status: "filled", filledQty: 40, filledPrice: 186.45, timestamp: "2026-04-20T13:30:00Z" },
];

export default function ExecutionOrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    (async () => {
      try { const r = await api.execution.getOrders(); setOrders(Array.isArray(r) ? r : r?.data ?? MOCK); }
      catch { setOrders(MOCK); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="p-6"><div className="animate-pulse h-8 bg-white/5 rounded w-48 mb-4" /><div className="animate-pulse h-64 bg-white/5 rounded" /></div>;

  const filtered = filter === "all" ? orders : orders.filter((o) => o.status === filter);
  const stc = (s: string) => ({ filled: "text-emerald-400", open: "text-blue-400", cancelled: "text-zinc-500", rejected: "text-red-400" }[s] ?? "text-zinc-400");

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Order Book</h1>
        <div className="flex gap-1">
          {["all", "open", "filled", "cancelled", "rejected"].map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1 rounded text-xs font-mono uppercase ${filter === f ? "bg-blue-600 text-white" : "bg-white/5 text-zinc-400 hover:bg-white/10"}`}>{f}</button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-zinc-500 border-b border-white/10">
            <th className="pb-2 pr-3">ID</th><th className="pb-2 pr-3">Symbol</th><th className="pb-2 pr-3">Side</th><th className="pb-2 pr-3">Type</th>
            <th className="pb-2 pr-3">Qty</th><th className="pb-2 pr-3">Price</th><th className="pb-2 pr-3">Status</th><th className="pb-2 pr-3">Filled</th><th className="pb-2">Time</th>
          </tr></thead>
          <tbody>
            {filtered.map((o) => (
              <tr key={o.id} className="border-b border-white/5 hover:bg-white/5">
                <td className="py-2 pr-3 font-mono text-xs">{o.id}</td>
                <td className="py-2 pr-3 font-mono font-medium">{o.symbol}</td>
                <td className={`py-2 pr-3 font-mono uppercase ${o.side === "buy" ? "text-emerald-400" : "text-red-400"}`}>{o.side}</td>
                <td className="py-2 pr-3 text-zinc-400">{o.type}</td>
                <td className="py-2 pr-3 font-mono">{o.qty}</td>
                <td className="py-2 pr-3 font-mono">{o.price ? `$${o.price.toFixed(2)}` : "MKT"}</td>
                <td className={`py-2 pr-3 font-mono text-xs uppercase ${stc(o.status)}`}>{o.status}</td>
                <td className="py-2 pr-3 font-mono">{o.filledQty}/{o.qty}{o.filledPrice ? ` @ $${o.filledPrice.toFixed(2)}` : ""}</td>
                <td className="py-2 text-zinc-400 text-xs">{new Date(o.timestamp).toLocaleTimeString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="text-center text-zinc-500 py-8">No orders match this filter.</p>}
      </div>
    </div>
  );
}
