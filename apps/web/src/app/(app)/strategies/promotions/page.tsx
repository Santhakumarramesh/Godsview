"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface StrategyInPipeline {
  id: string;
  name: string;
  status: string;
  sharpeRatio: number;
  trades: number;
  promotedAt: string;
}

interface PipelineStage {
  name: string;
  color: string;
  strategies: StrategyInPipeline[];
}

const mockPipelineData: PipelineStage[] = [
  {
    name: "Draft",
    color: "slate",
    strategies: [
      { id: "1", name: "EMA Crossover v3", status: "draft", sharpeRatio: 0.85, trades: 25, promotedAt: "2024-04-15" },
      { id: "2", name: "RSI Extremes", status: "draft", sharpeRatio: 0.92, trades: 18, promotedAt: "2024-04-18" },
    ],
  },
  {
    name: "Backtested",
    color: "blue",
    strategies: [
      { id: "3", name: "Bollinger Bounce", status: "backtested", sharpeRatio: 1.28, trades: 156, promotedAt: "2024-04-10" },
      { id: "4", name: "MACD Cross", status: "backtested", sharpeRatio: 1.15, trades: 142, promotedAt: "2024-04-12" },
    ],
  },
  {
    name: "Paper Trading",
    color: "yellow",
    strategies: [
      { id: "5", name: "Momentum Burst", status: "paper", sharpeRatio: 1.42, trades: 87, promotedAt: "2024-04-05" },
    ],
  },
  {
    name: "Assisted Live",
    color: "purple",
    strategies: [
      { id: "6", name: "Mean Reversion", status: "assisted", sharpeRatio: 1.58, trades: 234, promotedAt: "2024-03-20" },
    ],
  },
  {
    name: "Autonomous",
    color: "green",
    strategies: [
      { id: "7", name: "Trend Rider", status: "autonomous", sharpeRatio: 1.75, trades: 512, promotedAt: "2024-02-15" },
      { id: "8", name: "RSI Mean Rev", status: "autonomous", sharpeRatio: 1.62, trades: 468, promotedAt: "2024-03-01" },
    ],
  },
];

export default function PromotionPipelinePage() {
  const [pipeline, setPipeline] = useState<PipelineStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPipeline = async () => {
      try {
        setLoading(true);
        try {
          await api.backtest.getBacktestResults?.();
        } catch {
          // Fallback
        }
        setPipeline(mockPipelineData);
      } catch (err) {
        setError((err as Error).message || "Failed to load promotion pipeline");
        setPipeline(mockPipelineData);
      } finally {
        setLoading(false);
      }
    };

    fetchPipeline();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-slate-400">Loading promotion pipeline...</p>
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

  const colorMap = {
    slate: "bg-slate-500",
    blue: "bg-blue-500",
    yellow: "bg-yellow-500",
    purple: "bg-purple-500",
    green: "bg-green-500",
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-slate-100">Promotion Pipeline</h1>
        <p className="mt-1 text-sm text-slate-400">
          Strategy progression from draft through autonomous trading
        </p>
      </header>

      {/* Pipeline View */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {pipeline.map((stage) => (
          <div key={stage.name} className="space-y-3">
            {/* Stage Header */}
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${colorMap[stage.color as keyof typeof colorMap]}`} />
              <h2 className="font-semibold text-slate-100">{stage.name}</h2>
              <span className="ml-auto rounded bg-slate-800 px-2 py-1 text-xs text-slate-400">
                {stage.strategies.length}
              </span>
            </div>

            {/* Strategies in Stage */}
            <div className="space-y-2">
              {stage.strategies.map((strategy) => (
                <div
                  key={strategy.id}
                  className="rounded-lg border border-slate-700 bg-slate-900 p-3 hover:border-slate-600 transition cursor-pointer"
                >
                  <h3 className="font-medium text-slate-100 text-sm">{strategy.name}</h3>
                  <div className="mt-2 space-y-1 text-xs text-slate-400">
                    <div className="flex justify-between">
                      <span>Sharpe</span>
                      <span className="text-blue-400 font-mono">{strategy.sharpeRatio.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Trades</span>
                      <span className="text-green-400 font-mono">{strategy.trades}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Pipeline Flow Visualization */}
      <div className="rounded-lg border border-slate-700 bg-slate-900 p-6">
        <h2 className="mb-6 text-lg font-semibold text-slate-100">Pipeline Flow</h2>
        <div className="flex items-center justify-between">
          {pipeline.map((stage, idx) => (
            <div key={stage.name} className="flex items-center flex-1">
              <div className="flex flex-col items-center">
                <div className={`w-4 h-4 rounded-full ${colorMap[stage.color as keyof typeof colorMap]}`} />
                <span className="text-xs text-slate-400 mt-1">{stage.name}</span>
              </div>
              {idx < pipeline.length - 1 && (
                <div className="flex-1 h-0.5 bg-gradient-to-r from-slate-700 to-transparent mx-2" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Stage Descriptions */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <StageDescription
          name="Draft"
          description="Initial strategy concept under development with basic backtesting"
        />
        <StageDescription
          name="Backtested"
          description="Comprehensive historical testing across multiple regimes and timeframes"
        />
        <StageDescription
          name="Paper Trading"
          description="Virtual trading to validate real-time performance and signal quality"
        />
        <StageDescription
          name="Assisted Live"
          description="Live trading with manual review and risk controls before each trade"
        />
        <StageDescription
          name="Autonomous"
          description="Fully automated trading with automated risk management and SLO monitoring"
        />
      </div>
    </div>
  );
}

function StageDescription({ name, description }: { name: string; description: string }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 p-4">
      <h3 className="font-semibold text-slate-100">{name}</h3>
      <p className="mt-2 text-sm text-slate-400">{description}</p>
    </div>
  );
}
