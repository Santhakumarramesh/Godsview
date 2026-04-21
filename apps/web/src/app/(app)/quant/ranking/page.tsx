"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { DataTable } from "@/components/DataTable";

interface RankedStrategy {
  rank: number;
  name: string;
  compositeScore: number;
  sharpeRatio: number;
  profitFactor: number;
  stability: number;
  regimeFit: string;
  tier: "A" | "B" | "C";
}

const mockRankedStrategies: RankedStrategy[] = [
  {
    rank: 1,
    name: "MACD Divergence",
    compositeScore: 94.2,
    sharpeRatio: 1.65,
    profitFactor: 2.12,
    stability: 0.92,
    regimeFit: "Trending",
    tier: "A",
  },
  {
    rank: 2,
    name: "Mean Reversion RSI",
    compositeScore: 91.5,
    sharpeRatio: 1.42,
    profitFactor: 1.85,
    stability: 0.88,
    regimeFit: "Range-bound",
    tier: "A",
  },
  {
    rank: 3,
    name: "Momentum Cross",
    compositeScore: 87.3,
    sharpeRatio: 1.18,
    profitFactor: 1.62,
    stability: 0.82,
    regimeFit: "Trending",
    tier: "B",
  },
  {
    rank: 4,
    name: "Bollinger Bounce",
    compositeScore: 78.9,
    sharpeRatio: 0.95,
    profitFactor: 1.45,
    stability: 0.75,
    regimeFit: "Volatile",
    tier: "B",
  },
  {
    rank: 5,
    name: "EMA Crossover",
    compositeScore: 65.2,
    sharpeRatio: 0.72,
    profitFactor: 1.28,
    stability: 0.68,
    regimeFit: "Ranging",
    tier: "C",
  },
];

export default function QuantRankingPage() {
  const [strategies, setStrategies] = useState<RankedStrategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<keyof RankedStrategy>("compositeScore");

  useEffect(() => {
    const fetchRankings = async () => {
      try {
        setLoading(true);
        try {
          await api.backtest.getBacktestResults?.();
        } catch {
          // Fallback
        }
        setStrategies(mockRankedStrategies);
      } catch (err) {
        setError((err as Error).message || "Failed to load rankings");
        setStrategies(mockRankedStrategies);
      } finally {
        setLoading(false);
      }
    };

    fetchRankings();
  }, []);

  const tierCounts = {
    A: strategies.filter((s) => s.tier === "A").length,
    B: strategies.filter((s) => s.tier === "B").length,
    C: strategies.filter((s) => s.tier === "C").length,
  };

  const getTierColor = (tier: string) => {
    switch (tier) {
      case "A":
        return "bg-green-500/20 text-green-400";
      case "B":
        return "bg-blue-500/20 text-blue-400";
      case "C":
        return "bg-yellow-500/20 text-yellow-400";
      default:
        return "bg-slate-500/20 text-slate-400";
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-slate-100">Strategy Ranking</h1>
        <p className="mt-1 text-sm text-slate-400">
          Ranked strategies by composite performance score
        </p>
      </header>

      {/* Tier Summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <TierCard label="Tier A (Live)" count={tierCounts.A} color="green" />
        <TierCard label="Tier B (Paper)" count={tierCounts.B} color="blue" />
        <TierCard label="Tier C (Experimental)" count={tierCounts.C} color="yellow" />
      </div>

      {/* Ranking Table */}
      <div className="rounded-lg border border-slate-700 bg-slate-900 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-100">Strategy Rankings</h2>
          <div>
            <label className="text-xs text-slate-400 mr-2">Sort by:</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as keyof RankedStrategy)}
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-100"
            >
              <option value="compositeScore">Composite Score</option>
              <option value="sharpeRatio">Sharpe Ratio</option>
              <option value="profitFactor">Profit Factor</option>
              <option value="stability">Stability</option>
            </select>
          </div>
        </div>

        <DataTable<RankedStrategy>
          rows={strategies}
          columns={[
            {
              key: "rank",
              header: "Rank",
              render: (row) => (
                <span className="font-bold text-lg text-slate-100">#{row.rank}</span>
              ),
            },
            {
              key: "name",
              header: "Strategy Name",
              render: (row) => <span className="font-medium text-slate-100">{row.name}</span>,
            },
            {
              key: "compositeScore",
              header: "Composite Score",
              render: (row) => (
                <div className="flex items-center gap-2">
                  <div className="w-16 rounded-full bg-slate-800 h-1.5">
                    <div
                      className="h-full bg-gradient-to-r from-green-500 to-blue-500 rounded-full"
                      style={{ width: `${row.compositeScore}%` }}
                    />
                  </div>
                  <span className="text-sm font-mono text-slate-300">{row.compositeScore.toFixed(1)}</span>
                </div>
              ),
            },
            {
              key: "sharpeRatio",
              header: "Sharpe Ratio",
              render: (row) => <span className="text-blue-400 font-mono">{row.sharpeRatio.toFixed(2)}</span>,
            },
            {
              key: "profitFactor",
              header: "Profit Factor",
              render: (row) => <span className="text-green-400 font-mono">{row.profitFactor.toFixed(2)}</span>,
            },
            {
              key: "stability",
              header: "Stability",
              render: (row) => (
                <span className="text-slate-300">{(row.stability * 100).toFixed(0)}%</span>
              ),
            },
            {
              key: "regimeFit",
              header: "Regime Fit",
              render: (row) => <span className="text-slate-400 text-sm">{row.regimeFit}</span>,
            },
            {
              key: "tier",
              header: "Tier",
              render: (row) => (
                <span className={`rounded px-2 py-1 text-xs font-bold ${getTierColor(row.tier)}`}>
                  Tier {row.tier}
                </span>
              ),
            },
          ]}
          rowKey={(row) => row.name}
          loading={loading}
          error={error}
          emptyMessage="No strategies ranked"
        />
      </div>
    </div>
  );
}

function TierCard({ label, count, color }: { label: string; count: number; color: string }) {
  const colorClasses = {
    green: "bg-green-500/10 border-green-500/30 text-green-400",
    blue: "bg-blue-500/10 border-blue-500/30 text-blue-400",
    yellow: "bg-yellow-500/10 border-yellow-500/30 text-yellow-400",
  };

  return (
    <div className={`rounded-lg border p-4 ${colorClasses[color as keyof typeof colorClasses]}`}>
      <p className="text-xs font-semibold uppercase tracking-widest">{label}</p>
      <p className="mt-2 text-2xl font-bold">{count}</p>
    </div>
  );
}
