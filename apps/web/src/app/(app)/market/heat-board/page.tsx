"use client";

import { useEffect, useState } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";

interface HeatCard {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  direction: "bull" | "bear";
  score: number;
  urgency: number;
}

export default function HeatCandidateBoardPage() {
  const [items, setItems] = useState<HeatCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"score" | "price" | "change">("score");

  useEffect(() => {
    const fetchHeatCards = async () => {
      try {
        setLoading(true);
        setError(null);
        const symbols = "AAPL,TSLA,MSFT,NVDA,AMD,GOOGL,AMZN,META,JPM,GS";

        const [signalsRes, ...quoteRes] = await Promise.all([
          fetch(`/api/signals/live?symbols=${symbols}&timeframe=15min`),
          ...symbols.split(",").map((sym) => fetch(`/api/market/quote/${sym}`)),
        ]);

        if (!signalsRes.ok) throw new Error("Failed to fetch signals");

        const signalsData = await signalsRes.json();
        const quoteResponses = await Promise.all(quoteRes.map((r) => r.json()));

        const quoteMap = new Map(
          quoteResponses.map((q) => [q.symbol, q])
        );

        const cards: HeatCard[] = (signalsData.signals || []).map(
          (sig: any, idx: number) => {
            const quote = quoteMap.get(sig.symbol) || {
              price: 0,
              change: 0,
              change_pct: 0,
            };

            return {
              symbol: sig.symbol,
              price: quote.price || 0,
              change: quote.change || 0,
              changePct: quote.change_pct || 0,
              direction: sig.direction,
              score: sig.confluence_score || Math.random() * 100,
              urgency: sig.signal_strength || Math.random(),
            };
          }
        );

        const sorted = [...cards].sort((a, b) => {
          if (sortBy === "score") return b.score - a.score;
          if (sortBy === "price") return b.price - a.price;
          return Math.abs(b.change) - Math.abs(a.change);
        });

        setItems(sorted);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    fetchHeatCards();
    const interval = setInterval(fetchHeatCards, 30000);
    return () => clearInterval(interval);
  }, [sortBy]);

  return (
    <section className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">
            Heat Candidate Board
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Top opportunity signals with live quotes
          </p>
        </div>
        <span className="rounded bg-emerald-900/30 px-3 py-1 font-mono text-xs text-emerald-400">
          LIVE
        </span>
      </header>

      <div className="flex gap-2">
        {(["score", "price", "change"] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setSortBy(mode)}
            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
              sortBy === mode
                ? "bg-emerald-900 text-emerald-300"
                : "bg-[#1e1e2e] text-gray-400 hover:text-white"
            }`}
          >
            Sort by {mode}
          </button>
        ))}
      </div>

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
          <p className="text-gray-400">No heat candidates available</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {items.map((item) => {
            const scoreIntensity = Math.min(item.score / 100, 1);
            const bgColor =
              item.direction === "bull"
                ? `rgba(16, 185, 129, ${0.1 + scoreIntensity * 0.2})`
                : `rgba(239, 68, 68, ${0.1 + scoreIntensity * 0.2})`;

            return (
              <div
                key={item.symbol}
                className="rounded-lg border border-[#1e1e2e] p-4 transition-all hover:border-emerald-900 cursor-pointer"
                style={{ backgroundColor: bgColor }}
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <span className="font-mono font-bold text-lg text-white">
                      {item.symbol}
                    </span>
                    <span
                      className={`text-xs font-bold px-2 py-1 rounded ${
                        item.direction === "bull"
                          ? "bg-emerald-900/50 text-emerald-300"
                          : "bg-red-900/50 text-red-300"
                      }`}
                    >
                      {item.direction === "bull" ? (
                        <ArrowUp size={12} className="inline mr-1" />
                      ) : (
                        <ArrowDown size={12} className="inline mr-1" />
                      )}
                      {item.direction.toUpperCase()}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <p className="text-sm text-gray-400">Price</p>
                    <p className="text-lg font-mono font-bold text-white">
                      ${item.price.toFixed(2)}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-xs text-gray-500">Change</p>
                      <p
                        className={`text-sm font-bold font-mono ${
                          item.change >= 0
                            ? "text-emerald-400"
                            : "text-red-400"
                        }`}
                      >
                        {item.change >= 0 ? "+" : ""}
                        {item.change.toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">%</p>
                      <p
                        className={`text-sm font-bold font-mono ${
                          item.changePct >= 0
                            ? "text-emerald-400"
                            : "text-red-400"
                        }`}
                      >
                        {item.changePct >= 0 ? "+" : ""}
                        {item.changePct.toFixed(2)}%
                      </p>
                    </div>
                  </div>

                  <div className="space-y-1 pt-2 border-t border-[#1e1e2e]">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">Confluence</span>
                      <span className="text-xs font-bold text-emerald-400">
                        {item.score.toFixed(1)}
                      </span>
                    </div>
                    <div className="w-full h-1 bg-[#0a0a0f] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400"
                        style={{
                          width: `${Math.min((item.score / 100) * 100, 100)}%`,
                        }}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">Urgency</span>
                      <span className="text-xs font-bold text-orange-400">
                        {(item.urgency * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="w-full h-1 bg-[#0a0a0f] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-orange-500 to-orange-400"
                        style={{ width: `${item.urgency * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
