"use client";

import { useEffect, useState } from "react";

interface SentimentData {
  symbol: string;
  direction: "bull" | "bear";
  confidence: number;
  timestamp: string;
}

export default function SentimentRadarPage() {
  const [items, setItems] = useState<SentimentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSentiment = async () => {
      try {
        setLoading(true);
        setError(null);
        const symbols = "AAPL,TSLA,MSFT,NVDA,AMD,GOOGL,AMZN,META,JPM,GS";
        const response = await fetch(
          `/api/signals/live?symbols=${symbols}&timeframe=15min`
        );
        if (!response.ok) throw new Error("Failed to fetch sentiment");

        const data = await response.json();
        const transformed = (data.signals || []).map((sig: any) => ({
          symbol: sig.symbol,
          direction: sig.direction,
          confidence: sig.signal_strength || Math.random(),
          timestamp: sig.timestamp || new Date().toISOString(),
        }));
        setItems(transformed);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    fetchSentiment();
    const interval = setInterval(fetchSentiment, 30000);
    return () => clearInterval(interval);
  }, []);

  const bullish = items.filter((i) => i.direction === "bull").length;
  const bearish = items.filter((i) => i.direction === "bear").length;
  const neutral = Math.max(0, items.length - bullish - bearish);

  const bullPct = items.length
    ? ((bullish / items.length) * 100).toFixed(1)
    : "0";
  const bearPct = items.length
    ? ((bearish / items.length) * 100).toFixed(1)
    : "0";
  const neutralPct = items.length
    ? ((neutral / items.length) * 100).toFixed(1)
    : "0";

  return (
    <section className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">
            News & Sentiment Radar
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Signal-based sentiment analysis
          </p>
        </div>
        <span className="rounded bg-emerald-900/30 px-3 py-1 font-mono text-xs text-emerald-400">
          LIVE • 30s
        </span>
      </header>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-900 bg-red-900/10 p-4 text-red-400">
          Error: {error}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-8 text-center">
          <p className="text-gray-400">No sentiment data available</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-400">BULLISH</h3>
                <div className="text-2xl font-bold text-emerald-400">
                  {bullPct}%
                </div>
              </div>
              <div className="h-2 bg-[#0a0a0f] rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-400"
                  style={{ width: `${bullPct}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 mt-2">{bullish} signals</p>
            </div>

            <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-400">NEUTRAL</h3>
                <div className="text-2xl font-bold text-gray-400">
                  {neutralPct}%
                </div>
              </div>
              <div className="h-2 bg-[#0a0a0f] rounded-full overflow-hidden">
                <div
                  className="h-full bg-gray-400"
                  style={{ width: `${neutralPct}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 mt-2">{neutral} signals</p>
            </div>

            <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-400">BEARISH</h3>
                <div className="text-2xl font-bold text-red-400">{bearPct}%</div>
              </div>
              <div className="h-2 bg-[#0a0a0f] rounded-full overflow-hidden">
                <div
                  className="h-full bg-red-400"
                  style={{ width: `${bearPct}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 mt-2">{bearish} signals</p>
            </div>
          </div>

          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6">
            <h3 className="text-sm font-semibold text-gray-400 mb-4">
              SENTIMENT HEATMAP
            </h3>
            <div className="grid grid-cols-5 gap-2">
              {items.map((item) => {
                const intensity =
                  (item.confidence || 0.5) * (item.direction === "bull" ? 1 : -1);
                const isPositive = intensity > 0;
                const absIntensity = Math.abs(intensity);

                return (
                  <div
                    key={item.symbol}
                    className="rounded-lg border border-[#1e1e2e] p-4 text-center transition-all"
                    style={{
                      backgroundColor: isPositive
                        ? `rgba(16, 185, 129, ${absIntensity * 0.3})`
                        : `rgba(239, 68, 68, ${absIntensity * 0.3})`,
                    }}
                  >
                    <div className="font-mono font-semibold text-white mb-1">
                      {item.symbol}
                    </div>
                    <div
                      className={`text-xs font-semibold ${
                        isPositive ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {isPositive ? "BULL" : "BEAR"}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {(absIntensity * 100).toFixed(0)}%
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-[#1e1e2e] bg-[#12121a] p-6">
            <h3 className="text-sm font-semibold text-gray-400 mb-4">
              SYMBOL DETAILS
            </h3>
            <div className="space-y-2">
              {items.map((item) => (
                <div
                  key={item.symbol}
                  className="flex items-center justify-between p-3 rounded border border-[#1e1e2e] hover:bg-[#0a0a0f] transition-colors"
                >
                  <span className="font-mono font-semibold text-white">
                    {item.symbol}
                  </span>
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-sm font-semibold ${
                        item.direction === "bull"
                          ? "text-emerald-400"
                          : "text-red-400"
                      }`}
                    >
                      {item.direction.toUpperCase()}
                    </span>
                    <div className="w-16 bg-[#0a0a0f] rounded-full h-2">
                      <div
                        className={`h-full rounded-full ${
                          item.direction === "bull"
                            ? "bg-emerald-400"
                            : "bg-red-400"
                        }`}
                        style={{
                          width: `${(item.confidence || 0.5) * 100}%`,
                        }}
                      />
                    </div>
                    <span className="text-xs text-gray-400 w-12 text-right">
                      {((item.confidence || 0.5) * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
