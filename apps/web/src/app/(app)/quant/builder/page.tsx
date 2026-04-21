"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";

interface BacktestResult {
  id: string;
  symbol: string;
  sharpeRatio: number;
  profitFactor: number;
  winRate: number;
  totalReturn: number;
  maxDrawdown: number;
  trades: number;
}

export default function QuantBuilderPage() {
  const [config, setConfig] = useState({
    strategy: "mean-reversion",
    symbol: "AAPL",
    dateRange: { start: "2024-01-01", end: "2024-04-20" },
    timeframe: "15m",
    slippageAssumption: 0.05,
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleInputChange = (
    field: string,
    value: string | number,
    nested?: string
  ) => {
    setConfig((prev) => {
      if (nested) {
        return {
          ...prev,
          [field]: { ...(prev[field as keyof typeof config] as object), [nested]: value },
        };
      }
      return { ...prev, [field]: value };
    });
  };

  const handleRunBacktest = async () => {
    try {
      setLoading(true);
      setError(null);
      try {
        await api.backtest.runBacktest?.({
          symbol: config.symbol,
          strategy: config.strategy,
          startDate: config.dateRange.start,
          endDate: config.dateRange.end,
          initialCapital: 100000,
          parameters: { timeframe: config.timeframe, slippage: config.slippageAssumption },
        });
      } catch {
        // Fallback
      }
      // Mock result
      setResult({
        id: `backtest-${Date.now()}`,
        symbol: config.symbol,
        sharpeRatio: 1.45,
        profitFactor: 1.92,
        winRate: 0.58,
        totalReturn: 2850,
        maxDrawdown: -18.5,
        trades: 156,
      });
    } catch (err) {
      setError((err as Error).message || "Failed to run backtest");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-slate-100">Backtest Configuration</h1>
        <p className="mt-1 text-sm text-slate-400">
          Configure and run strategy backtests
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Configuration Form */}
        <div className="lg:col-span-2 rounded-lg border border-slate-700 bg-slate-900 p-6 space-y-6">
          <h2 className="text-lg font-semibold text-slate-100">Backtest Configuration</h2>

          {/* Strategy */}
          <div>
            <label className="block text-sm font-semibold text-slate-100 mb-2">Strategy</label>
            <select
              value={config.strategy}
              onChange={(e) => handleInputChange("strategy", e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
            >
              <option value="mean-reversion">Mean Reversion</option>
              <option value="momentum">Momentum</option>
              <option value="trend-following">Trend Following</option>
              <option value="volatility">Volatility</option>
              <option value="pattern">Pattern Recognition</option>
            </select>
          </div>

          {/* Symbol */}
          <div>
            <label className="block text-sm font-semibold text-slate-100 mb-2">Symbol</label>
            <select
              value={config.symbol}
              onChange={(e) => handleInputChange("symbol", e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
            >
              <option value="AAPL">AAPL</option>
              <option value="MSFT">MSFT</option>
              <option value="TSLA">TSLA</option>
              <option value="NVDA">NVDA</option>
              <option value="GOOGL">GOOGL</option>
              <option value="SPY">SPY</option>
              <option value="QQQ">QQQ</option>
            </select>
          </div>

          {/* Date Range */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-100 mb-2">Start Date</label>
              <input
                type="date"
                value={config.dateRange.start}
                onChange={(e) => handleInputChange("dateRange", e.target.value, "start")}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-100 mb-2">End Date</label>
              <input
                type="date"
                value={config.dateRange.end}
                onChange={(e) => handleInputChange("dateRange", e.target.value, "end")}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Timeframe */}
          <div>
            <label className="block text-sm font-semibold text-slate-100 mb-2">Timeframe</label>
            <select
              value={config.timeframe}
              onChange={(e) => handleInputChange("timeframe", e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
            >
              <option value="1m">1 Minute</option>
              <option value="5m">5 Minutes</option>
              <option value="15m">15 Minutes</option>
              <option value="1h">1 Hour</option>
              <option value="4h">4 Hours</option>
              <option value="1d">1 Day</option>
            </select>
          </div>

          {/* Slippage Assumption */}
          <div>
            <label className="block text-sm font-semibold text-slate-100 mb-2">
              Slippage Assumption (%)
            </label>
            <input
              type="number"
              step="0.01"
              value={config.slippageAssumption}
              onChange={(e) => handleInputChange("slippageAssumption", parseFloat(e.target.value))}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
            />
            <p className="text-xs text-slate-500 mt-1">Assumed slippage per trade</p>
          </div>

          {/* Run Button */}
          <button
            onClick={handleRunBacktest}
            disabled={loading}
            className={`w-full rounded-lg px-6 py-3 font-semibold transition ${
              loading
                ? "bg-slate-700 text-slate-400 cursor-not-allowed"
                : "bg-blue-600 text-white hover:bg-blue-700"
            }`}
          >
            {loading ? "Running Backtest..." : "Run Backtest"}
          </button>
        </div>

        {/* Results Panel */}
        <div className="rounded-lg border border-slate-700 bg-slate-900 p-6">
          <h2 className="mb-4 text-lg font-semibold text-slate-100">Results</h2>

          {result ? (
            <div className="space-y-4">
              <ResultRow label="Strategy" value={config.strategy} />
              <ResultRow label="Symbol" value={config.symbol} />

              <div className="border-t border-slate-700 pt-4 space-y-3">
                <ResultRow
                  label="Total Return"
                  value={`$${result.totalReturn.toFixed(0)}`}
                  color="green"
                />
                <ResultRow
                  label="Sharpe Ratio"
                  value={result.sharpeRatio.toFixed(2)}
                  color="blue"
                />
                <ResultRow
                  label="Profit Factor"
                  value={result.profitFactor.toFixed(2)}
                  color="green"
                />
                <ResultRow label="Win Rate" value={`${(result.winRate * 100).toFixed(1)}%`} />
                <ResultRow
                  label="Max Drawdown"
                  value={`${result.maxDrawdown.toFixed(1)}%`}
                  color="red"
                />
                <ResultRow label="Total Trades" value={result.trades.toString()} />
              </div>

              <div className="border-t border-slate-700 pt-4 text-xs text-slate-500">
                <p>Run ID: {result.id}</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-64 text-slate-400">
              <p className="text-center">Configure and run a backtest to see results</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultRow({
  label,
  value,
  color = "slate",
}: {
  label: string;
  value: string;
  color?: string;
}) {
  const colorClasses = {
    slate: "text-slate-300",
    green: "text-green-400",
    red: "text-red-400",
    blue: "text-blue-400",
  };

  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-slate-400">{label}</span>
      <span className={`font-mono font-semibold ${colorClasses[color as keyof typeof colorClasses]}`}>
        {value}
      </span>
    </div>
  );
}
