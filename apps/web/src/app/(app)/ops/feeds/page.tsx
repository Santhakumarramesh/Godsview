"use client";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";

const MOCK = [
  { name: "Alpaca WebSocket", status: "connected", latency: 12, messagesPerSec: 248, lastMessage: "2s ago" },
  { name: "TradingView Webhooks", status: "connected", latency: 45, messagesPerSec: 3, lastMessage: "5m ago" },
  { name: "Market Data (polygon)", status: "connected", latency: 8, messagesPerSec: 1520, lastMessage: "< 1s ago" },
  { name: "News / Sentiment API", status: "degraded", latency: 320, messagesPerSec: 1, lastMessage: "12m ago" },
  { name: "Order Flow (L2)", status: "connected", latency: 5, messagesPerSec: 3200, lastMessage: "< 1s ago" },
  { name: "Redis Pub/Sub", status: "connected", latency: 1, messagesPerSec: 890, lastMessage: "< 1s ago" },
];

export default function OpsFeedsPage() {
  const [feeds, setFeeds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try { const r = await api.ops.getFeeds(); setFeeds(Array.isArray(r) ? r : r?.feeds ?? MOCK); }
      catch { setFeeds(MOCK); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="p-6"><div className="animate-pulse h-8 bg-white/5 rounded w-48 mb-4" /><div className="animate-pulse h-64 bg-white/5 rounded" /></div>;

  const sc = (s: string) => ({ connected: "text-emerald-400 bg-emerald-400/10", degraded: "text-amber-400 bg-amber-400/10", disconnected: "text-red-400 bg-red-400/10" }[s] ?? "text-zinc-400 bg-zinc-400/10");

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Data Feeds</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {feeds.map((f) => (
          <div key={f.name} className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-sm">{f.name}</h3>
              <span className={`text-xs font-mono px-2 py-0.5 rounded ${sc(f.status)}`}>{f.status}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div><span className="text-zinc-500 block">Latency</span><span className="font-mono">{f.latency}ms</span></div>
              <div><span className="text-zinc-500 block">Msg/sec</span><span className="font-mono">{f.messagesPerSec.toLocaleString()}</span></div>
              <div><span className="text-zinc-500 block">Last</span><span className="text-zinc-300">{f.lastMessage}</span></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
