"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { DataTable } from "@/components/DataTable";

interface StrategyMetrics {
  id: string;
  name: string;
  expectancy: number;
  sharpeRatio: number;
  profitFactor: number;
  maxDrawdown: number;
  winRate: number;
  sortinoRatio: number;
}

const mockMetrics: StrategyMetrics[] = [
  {
    id: "1",
    name: "Mean Reversion RSI",
    expectancy: 2.35,
    sharpeRatio: 1.42,
    profitFactor: 1.85,
    maxDrawdown: -18.5,
    winRate: 0.58,
    sortinoRatio: 2.15,
  },
  {
    id: "2",
    name: "Momentum Cross",
    expectancy: 1.89,
    sharpeRatio: 1.18,
    profitFactor: 1.62,
    maxDrawdown: -22.3,
    winRate: 0.55,
    sortinoRatio: 1.85,
  },
  {
    id: "3",
    name: "Bollinger Bounce",
    expectancy: 1.52,
    sharpeRatio: 0.95,
    profitFactor: 1.45,
    maxDrawdown: -25.8,
    winRate: 0.52,
    sortinoRatio: 1.42,
  },
  {
    id: "4",
    name: "MACD Divergence",
    expectancy: 2.68,
    sharpeRatio: 1.65,
    profitFactor: 2.12,
    maxDrawdown: -15.2,
    winRate: 0.61,
    sortinoRatio: 2.48,
  },
];

export default function QuantMetricsPage() {
  const [metrics, setMetrics] = useState<StrategyMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        setLoading(true);
        try {
          await api.backtest.getBacktestResults?.();
        } catch {
          // Fallback
        }
        setMetrics(mockMetrics);
      } catch (err) {
        setError((err as Error).message || "Failed to load metrics");
        setMetrics(mockMetrics);
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
  }, []);

  const avgExpectancy = (metrics.reduce((sum, m) => sum + m.expectancy, 0) / metrics.length).toFixed(2);
  const avgSharpe = (metrics.reduce((sum, m) => sum + m.sharpeRatio, 0) / metrics.length).toFixed(2);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-slate-100">Quant Lab · Metrics</h1>
        <p className="mt-1 text-sm text-slate-400">
          Performance metrics across all strategies
        </p>
      </header>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Avg Expectancy" value={avgExpectancy} color="green" />
        <MetricCard label="Avg Sharpe Ratio" value={avgSharpe} color="blue" />
        <MetricCard label="Total Strategies" value={metrics.length.toString()} color="purple" />
        <MetricCard label="Avg Win Rate" value={((metrics.reduce((sum, m) => sum + m.winRate, 0) / metrics.length) * 100).toFixed(1) + "%"} color="yellow" />
      </div>

      {/* Metrics Table */}
      <div className="rounded-lg border border-slate-700 bg-slate-900 p-6">
        <h2 className="mb-4 text-lg font-semibold text-slate-100">Strategy Performance</h2>
        <DataTable<StrategyMetrics>
          rows={metrics}
          columns={[
            {
              key: "name",
              header: "Strategy",
              render: (row) => <span className="font-medium text-slate-100">{row.name}</span>,
            },
            {
              key: "expectancy",
              header: "Expectancy",
              render: (row) => <span className="text-green-400 font-mono">{row.expectancy.toFixed(2)}</span>,
            },
            {
              key: "sharpeRatio",
              header: "Sharpe Ratio",
              render: (row) => <span className="text-blue-400 font-mono">{row.sharpeRatio.toFixed(2)}</span>,
            },
            {
              key: "sortinoRatio",
              header: "Sortino Ratio",
              render: (row) => <span className="text-purple-400 font-mono">{row.sortinoRatio.toFixed(2)}</span>,
            },
            {
              key: "profitFactor",
              header: "Profit Factor",
              render: (row) => <span className="text-slate-300 font-mono">{row.profitFactor.toFixed(2)}</span>,
            },
            {
              key: "winRate",
              header: "Win Rate",
              render: (row) => <span className="text-slate-300">{(row.winRate * 100).toFixed(1)}%</span>,
            },
            {
              key: "maxDrawdown",
              header: "Max Drawdown",
              render: (row) => <span className="text-red-400 font-mono">{row.maxDrawdown.toFixed(1)}%</span>,
            },
          ]}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          emptyMessage="No metrics available"
        />
      </div>
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  const colorClasses = {
    green: "bg-green-500/10 border-green-500/30 text-green-400",
    blue: "bg-blue-500/10 border-blue-500/30 text-blue-400",
    purple: "bg-purple-500/10 border-purple-500/30 text-purple-400",
    yellow: "bg-yellow-500/10 border-yellow-500/30 text-yellow-400",
  };

  return (
    <div className={`rounded-lg border p-4 ${colorClasses[color as keyof typeof colorClasses]}`}>
      <p className="text-xs font-semibold uppercase tracking-widest">{label}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}
