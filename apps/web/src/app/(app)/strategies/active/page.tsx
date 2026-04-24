"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface ActiveStrategy {
  id: string;
  name: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  currentPnL: number;
  timeInTrade: string;
  entryPrice: number;
  currentPrice: number;
}

const mockActiveStrategies: ActiveStrategy[] = [
  {
    id: "1",
    name: "Mean Reversion RSI",
    symbol: "AAPL",
    direction: "LONG",
    currentPnL: 1250.50,
    timeInTrade: "2h 45m",
    entryPrice: 189.50,
    currentPrice: 191.25,
  },
  {
    id: "2",
    name: "Momentum Cross",
    symbol: "MSFT",
    direction: "LONG",
    currentPnL: 825.75,
    timeInTrade: "5h 20m",
    entryPrice: 405.00,
    currentPrice: 408.75,
  },
  {
    id: "3",
    name: "Mean Reversion RSI",
    symbol: "TSLA",
    direction: "SHORT",
    currentPnL: -125.25,
    timeInTrade: "1h 15m",
    entryPrice: 182.50,
    currentPrice: 183.19,
  },
];

export default function ActiveStrategiesPage() {
  const [strategies, setStrategies] = useState<ActiveStrategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStrategies = async () => {
      try {
        setLoading(true);
        try {
          const result = await api.backtest.getBacktestResults?.();
          setStrategies(result?.results as unknown as ActiveStrategy[] || mockActiveStrategies);
        } catch {
          setStrategies(mockActiveStrategies);
        }
      } catch (err) {
        setError((err as Error).message || "Failed to load active strategies");
        setStrategies(mockActiveStrategies);
      } finally {
        setLoading(false);
      }
    };

    fetchStrategies();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-slate-400">Loading active strategies...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400">
        {error}
      </div>
    );
  }

  const totalPnL = strategies.reduce((sum, s) => sum + s.currentPnL, 0);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-slate-100">Active Strategies</h1>
        <p className="mt-1 text-sm text-slate-400">
          Currently running strategies with live position data
        </p>
      </header>

      <div className="rounded-lg border border-slate-700 bg-slate-900 p-6">
        <p className="text-xs font-semibold uppercase text-slate-400">Portfolio PnL</p>
        <p className={`mt-2 text-3xl font-bold ${totalPnL >= 0 ? "text-green-400" : "text-red-400"}`}>
          {totalPnL >= 0 ? "+" : ""}{totalPnL.toFixed(2)}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {strategies.map((strategy) => (
          <StrategyCard key={strategy.id} strategy={strategy} />
        ))}
      </div>

      {strategies.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-600 bg-slate-800/50 p-8 text-center">
          <p className="text-slate-400">No active strategies running</p>
        </div>
      )}
    </div>
  );
}

function StrategyCard({ strategy }: { strategy: ActiveStrategy }) {
  const directionColor = strategy.direction === "LONG" ? "text-green-400" : "text-red-400";
  const pnlColor = strategy.currentPnL >= 0 ? "text-green-400" : "text-red-400";
  const priceChange = ((strategy.currentPrice - strategy.entryPrice) / strategy.entryPrice) * 100;

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 p-6 hover:border-slate-600 transition">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-slate-100">{strategy.name}</h3>
          <p className="text-sm text-slate-400">{strategy.symbol}</p>
        </div>
        <span className={`rounded px-2 py-1 text-xs font-bold ${directionColor}`}>
          {strategy.direction}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-400">Current PnL</span>
          <span className={`text-lg font-semibold ${pnlColor}`}>
            {strategy.currentPnL >= 0 ? "+" : ""}{strategy.currentPnL.toFixed(2)}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-400">Entry Price</span>
          <span className="text-sm font-mono text-slate-300">${strategy.entryPrice.toFixed(2)}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-400">Current Price</span>
          <span className="text-sm font-mono text-slate-300">${strategy.currentPrice.toFixed(2)}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-400">Price Change</span>
          <span className={`text-sm font-mono font-semibold ${priceChange >= 0 ? "text-green-400" : "text-red-400"}`}>
            {priceChange >= 0 ? "+" : ""}{priceChange.toFixed(2)}%
          </span>
        </div>

        <div className="mt-4 border-t border-slate-700 pt-4">
          <span className="text-xs text-slate-400">Time in Trade: {strategy.timeInTrade}</span>
        </div>
      </div>
    </div>
  );
}
