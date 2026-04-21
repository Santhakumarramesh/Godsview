"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { DataTable } from "@/components/DataTable";

interface Strategy {
  id: string;
  name: string;
  type: string;
  status: "active" | "paper" | "backtesting" | "archived";
  winRate: number;
  profitFactor: number;
  sharpeRatio: number;
  lastSignal: string;
}

const mockStrategies: Strategy[] = [
  {
    id: "1",
    name: "Mean Reversion RSI",
    type: "Mean Reversion",
    status: "active",
    winRate: 0.58,
    profitFactor: 1.85,
    sharpeRatio: 1.42,
    lastSignal: "2024-04-20 14:30:00",
  },
  {
    id: "2",
    name: "Momentum Cross",
    type: "Trend Following",
    status: "active",
    winRate: 0.55,
    profitFactor: 1.62,
    sharpeRatio: 1.18,
    lastSignal: "2024-04-20 13:45:00",
  },
  {
    id: "3",
    name: "Bollinger Band Breakout",
    type: "Volatility",
    status: "paper",
    winRate: 0.52,
    profitFactor: 1.45,
    sharpeRatio: 0.95,
    lastSignal: "2024-04-19 16:20:00",
  },
  {
    id: "4",
    name: "MACD Divergence",
    type: "Oscillator",
    status: "backtesting",
    winRate: 0.61,
    profitFactor: 2.12,
    sharpeRatio: 1.65,
    lastSignal: "2024-04-18 11:15:00",
  },
];

export default function StrategiesCatalogPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStrategies = async () => {
      try {
        setLoading(true);
        // Try to call real API
        try {
          const result = await api.backtest.getBacktestResults?.();
          setStrategies(result?.results as unknown as Strategy[] || mockStrategies);
        } catch {
          // Fallback to mock data
          setStrategies(mockStrategies);
        }
      } catch (err) {
        setError((err as Error).message || "Failed to load strategies");
        setStrategies(mockStrategies);
      } finally {
        setLoading(false);
      }
    };

    fetchStrategies();
  }, []);

  const statusBadge = (status: string) => {
    const styles = {
      active: "bg-green-500/20 text-green-400",
      paper: "bg-blue-500/20 text-blue-400",
      backtesting: "bg-purple-500/20 text-purple-400",
      archived: "bg-gray-500/20 text-gray-400",
    };
    return styles[status as keyof typeof styles] || styles.archived;
  };

  const totalStrategies = strategies.length;
  const activeCount = strategies.filter((s) => s.status === "active").length;
  const paperCount = strategies.filter((s) => s.status === "paper").length;
  const backtestingCount = strategies.filter((s) => s.status === "backtesting").length;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-slate-100">Strategies · Catalog</h1>
        <p className="mt-1 text-sm text-slate-400">
          Strategy library with performance metrics and live status
        </p>
      </header>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Total Strategies" value={totalStrategies} />
        <SummaryCard label="Active" value={activeCount} color="green" />
        <SummaryCard label="Paper Trading" value={paperCount} color="blue" />
        <SummaryCard label="Backtesting" value={backtestingCount} color="purple" />
      </div>

      {/* Strategies Table */}
      <div className="rounded-lg border border-slate-700 bg-slate-900 p-6">
        <h2 className="mb-4 text-lg font-semibold text-slate-100">All Strategies</h2>
        <DataTable<Strategy>
          rows={strategies}
          columns={[
            {
              key: "name",
              header: "Strategy Name",
              render: (row) => <span className="font-medium text-slate-100">{row.name}</span>,
            },
            {
              key: "type",
              header: "Type",
              render: (row) => <span className="text-slate-400">{row.type}</span>,
            },
            {
              key: "status",
              header: "Status",
              render: (row) => (
                <span className={`rounded px-2 py-1 text-xs font-semibold ${statusBadge(row.status)}`}>
                  {row.status.charAt(0).toUpperCase() + row.status.slice(1)}
                </span>
              ),
            },
            {
              key: "winRate",
              header: "Win Rate",
              render: (row) => <span className="text-slate-300">{(row.winRate * 100).toFixed(1)}%</span>,
            },
            {
              key: "profitFactor",
              header: "Profit Factor",
              render: (row) => <span className="text-green-400">{row.profitFactor.toFixed(2)}</span>,
            },
            {
              key: "sharpeRatio",
              header: "Sharpe Ratio",
              render: (row) => <span className="text-blue-400">{row.sharpeRatio.toFixed(2)}</span>,
            },
            {
              key: "lastSignal",
              header: "Last Signal",
              render: (row) => <span className="text-slate-400 text-xs">{row.lastSignal}</span>,
            },
          ]}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          emptyMessage="No strategies found"
        />
      </div>
    </div>
  );
}

function SummaryCard({ label, value, color = "slate" }: { label: string; value: number; color?: string }) {
  const colorClasses = {
    slate: "bg-slate-800 border-slate-700 text-slate-300",
    green: "bg-green-500/10 border-green-500/30 text-green-400",
    blue: "bg-blue-500/10 border-blue-500/30 text-blue-400",
    purple: "bg-purple-500/10 border-purple-500/30 text-purple-400",
  };

  return (
    <div className={`rounded-lg border p-4 ${colorClasses[color as keyof typeof colorClasses]}`}>
      <p className="text-xs font-semibold uppercase tracking-widest">{label}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}
