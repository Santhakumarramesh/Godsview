"use client";

import { useEffect, useState, useCallback } from "react";

interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface TimeframeData {
  timeframe: string;
  bars: Bar[];
}

export default function MultiTimeframeStructurePage() {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>("AAPL");
  const [htfData, setHtfData] = useState<TimeframeData>({ timeframe: "1d", bars: [] });
  const [mtfData, setMtfData] = useState<TimeframeData>({ timeframe: "1h", bars: [] });
  const [ltfData, setLtfData] = useState<TimeframeData>({ timeframe: "15min", bars: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  // Fetch symbols
  useEffect(() => {
    const fetchSymbols = async () => {
      try {
        const res = await fetch("/api/market/symbols");
        if (!res.ok) throw new Error("Failed to fetch symbols");
        const data = await res.json();
        setSymbols(data.symbols || []);
        if (data.symbols && data.symbols.length > 0) {
          setSelectedSymbol(data.symbols[0]);
        }
      } catch (err) {
        setError("Error loading symbols");
        console.error(err);
      }
    };
    fetchSymbols();
  }, []);

  // Fetch multi-timeframe data
  const fetchData = useCallback(async (symbol: string) => {
    setLoading(true);
    setError("");
    try {
      const [htfRes, mtfRes, ltfRes] = await Promise.all([
        fetch(`/api/market/bars/${symbol}?timeframe=1d&limit=50`),
        fetch(`/api/market/bars/${symbol}?timeframe=1h&limit=50`),
        fetch(`/api/market/bars/${symbol}?timeframe=15min&limit=50`),
      ]);

      if (!htfRes.ok || !mtfRes.ok || !ltfRes.ok) throw new Error("API fetch failed");

      const htf = await htfRes.json();
      const mtf = await mtfRes.json();
      const ltf = await ltfRes.json();

      setHtfData({ timeframe: "1d", bars: htf.bars || [] });
      setMtfData({ timeframe: "1h", bars: mtf.bars || [] });
      setLtfData({ timeframe: "15min", bars: ltf.bars || [] });
    } catch (err) {
      setError("Failed to fetch data");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-refresh
  useEffect(() => {
    fetchData(selectedSymbol);
    const interval = setInterval(() => {
      fetchData(selectedSymbol);
    }, 30000);
    return () => clearInterval(interval);
  }, [selectedSymbol, fetchData]);

  const getTrend = (bars: Bar[]) => {
    if (bars.length < 20) return "N/A";
    const avg = bars.slice(-20).reduce((sum, b) => sum + b.c, 0) / 20;
    const current = bars[bars.length - 1].c;
    if (current > avg) return "📈 Bullish";
    if (current < avg) return "📉 Bearish";
    return "➡️ Neutral";
  };

  const TimeframePanel = ({ data }: { data: TimeframeData }) => {
    const recentBars = data.bars.slice(-20).reverse();

    return (
      <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
        <h3 className="mb-3 text-lg font-semibold text-white">{data.timeframe.toUpperCase()}</h3>
        <p className="mb-4 text-sm font-semibold text-emerald-400">{getTrend(data.bars)}</p>

        {recentBars.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1e1e2e]">
                  <th className="px-2 py-2 text-left text-gray-400">Open</th>
                  <th className="px-2 py-2 text-left text-gray-400">High</th>
                  <th className="px-2 py-2 text-left text-gray-400">Low</th>
                  <th className="px-2 py-2 text-left text-gray-400">Close</th>
                  <th className="px-2 py-2 text-left text-gray-400">Volume</th>
                </tr>
              </thead>
              <tbody>
                {recentBars.map((bar, idx) => {
                  const isUp = bar.c >= bar.o;
                  return (
                    <tr
                      key={idx}
                      className="border-b border-[#1e1e2e] hover:bg-[#1a1a2e]"
                    >
                      <td className="px-2 py-2 text-white">${bar.o.toFixed(2)}</td>
                      <td className="px-2 py-2 text-emerald-400">${bar.h.toFixed(2)}</td>
                      <td className="px-2 py-2 text-red-400">${bar.l.toFixed(2)}</td>
                      <td className={`px-2 py-2 font-semibold ${isUp ? "text-emerald-400" : "text-red-400"}`}>
                        ${bar.c.toFixed(2)}
                      </td>
                      <td className="px-2 py-2 text-gray-400">{(bar.v / 1000000).toFixed(1)}M</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-center text-gray-400">No data</p>
        )}
      </div>
    );
  };

  return (
    <section className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Multi-Timeframe Structure</h1>
        <span className="rounded bg-blue-400/15 px-2 py-1 font-mono text-xs text-blue-400">
          HTF / MTF / LTF
        </span>
      </header>

      {/* Symbol Selector */}
      <div className="flex gap-4 rounded-lg border border-[#1e1e2e] bg-[#12121a] p-4">
        <div className="flex-1">
          <label className="block text-sm text-gray-400 mb-1">Symbol</label>
          <select
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(e.target.value)}
            className="w-full rounded border border-[#1e1e2e] bg-[#0a0a0f] px-3 py-2 text-white text-sm"
          >
            {symbols.map((sym) => (
              <option key={sym} value={sym}>
                {sym}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => fetchData(selectedSymbol)}
          className="mt-6 rounded border border-emerald-400 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-400 hover:bg-emerald-400/20 h-fit"
        >
          Refresh
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex h-96 items-center justify-center rounded-lg border border-[#1e1e2e] bg-[#12121a]">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-4 text-center text-red-400">
          {error}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <TimeframePanel data={htfData} />
          <TimeframePanel data={mtfData} />
          <TimeframePanel data={ltfData} />
        </div>
      )}
    </section>
  );
}
