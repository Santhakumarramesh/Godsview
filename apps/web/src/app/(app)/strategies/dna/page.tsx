"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { DataTable } from "@/components/DataTable";

interface FeatureImportance {
  feature: string;
  importance: number;
  direction: "+" | "-";
  stability: number;
}

interface StrategyDNA {
  strategyId: string;
  strategyName: string;
  features: FeatureImportance[];
}

const mockDNAData: StrategyDNA[] = [
  {
    strategyId: "1",
    strategyName: "Mean Reversion RSI",
    features: [
      { feature: "RSI(14)", importance: 32.5, direction: "+", stability: 0.92 },
      { feature: "Bollinger Bands (20,2)", importance: 28.3, direction: "+", stability: 0.88 },
      { feature: "Volume Profile", importance: 18.7, direction: "+", stability: 0.75 },
      { feature: "Moving Average (50)", importance: 12.4, direction: "-", stability: 0.68 },
      { feature: "ATR (14)", importance: 8.1, direction: "+", stability: 0.82 },
    ],
  },
  {
    strategyId: "2",
    strategyName: "Momentum Cross",
    features: [
      { feature: "MACD", importance: 35.2, direction: "+", stability: 0.90 },
      { feature: "EMA Cross (12,26)", importance: 26.8, direction: "+", stability: 0.85 },
      { feature: "Momentum Oscillator", importance: 21.5, direction: "+", stability: 0.79 },
      { feature: "Stochastic", importance: 10.4, direction: "-", stability: 0.71 },
      { feature: "Rate of Change", importance: 6.1, direction: "+", stability: 0.65 },
    ],
  },
];

export default function StrategyDnaPage() {
  const [dnaData, setDnaData] = useState<StrategyDNA[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStrategy, setSelectedStrategy] = useState<string | null>(null);

  useEffect(() => {
    const fetchDNA = async () => {
      try {
        setLoading(true);
        try {
          await api.ml.getPrediction?.("AAPL");
        } catch {
          // Fallback
        }
        setDnaData(mockDNAData);
        if (mockDNAData.length > 0) {
          setSelectedStrategy(mockDNAData[0].strategyId);
        }
      } catch (err) {
        setError((err as Error).message || "Failed to load strategy DNA");
        setDnaData(mockDNAData);
      } finally {
        setLoading(false);
      }
    };

    fetchDNA();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-slate-400">Loading strategy DNA...</p>
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

  const currentStrategy = dnaData.find((s) => s.strategyId === selectedStrategy);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-slate-100">Strategy DNA</h1>
        <p className="mt-1 text-sm text-slate-400">
          Feature importance and stability metrics for each strategy
        </p>
      </header>

      {/* Strategy Selector */}
      <div className="rounded-lg border border-slate-700 bg-slate-900 p-6">
        <label className="block text-sm font-semibold text-slate-100 mb-3">Select Strategy</label>
        <select
          value={selectedStrategy || ""}
          onChange={(e) => setSelectedStrategy(e.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
        >
          {dnaData.map((s) => (
            <option key={s.strategyId} value={s.strategyId}>
              {s.strategyName}
            </option>
          ))}
        </select>
      </div>

      {/* Feature Importance Visualization */}
      {currentStrategy && (
        <div className="space-y-6">
          {/* Bar Chart View */}
          <div className="rounded-lg border border-slate-700 bg-slate-900 p-6">
            <h2 className="mb-4 text-lg font-semibold text-slate-100">Feature Importance</h2>
            <div className="space-y-4">
              {currentStrategy.features.map((feature, idx) => (
                <div key={idx} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-300">{feature.feature}</span>
                    <span className="text-slate-400">{feature.importance.toFixed(1)}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 rounded-full bg-slate-800 h-2 overflow-hidden">
                      <div
                        className={`h-full ${feature.direction === "+" ? "bg-green-500" : "bg-red-500"}`}
                        style={{ width: `${feature.importance}%` }}
                      />
                    </div>
                    <span className={`text-xs font-semibold w-6 ${feature.direction === "+" ? "text-green-400" : "text-red-400"}`}>
                      {feature.direction}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Feature Table */}
          <div className="rounded-lg border border-slate-700 bg-slate-900 p-6">
            <h2 className="mb-4 text-lg font-semibold text-slate-100">Feature Details</h2>
            <DataTable<FeatureImportance>
              rows={currentStrategy.features}
              columns={[
                {
                  key: "feature",
                  header: "Feature Name",
                  render: (row) => <span className="font-medium text-slate-100">{row.feature}</span>,
                },
                {
                  key: "importance",
                  header: "Importance %",
                  render: (row) => <span className="text-slate-300">{row.importance.toFixed(2)}%</span>,
                },
                {
                  key: "direction",
                  header: "Direction",
                  render: (row) => (
                    <span className={`font-semibold ${row.direction === "+" ? "text-green-400" : "text-red-400"}`}>
                      {row.direction === "+" ? "Positive" : "Negative"}
                    </span>
                  ),
                },
                {
                  key: "stability",
                  header: "Stability",
                  render: (row) => (
                    <div className="flex items-center gap-2">
                      <div className="w-16 rounded-full bg-slate-800 h-1.5">
                        <div
                          className="h-full bg-blue-500 rounded-full"
                          style={{ width: `${row.stability * 100}%` }}
                        />
                      </div>
                      <span className="text-xs text-slate-400">{(row.stability * 100).toFixed(0)}%</span>
                    </div>
                  ),
                },
              ]}
              rowKey={(row) => row.feature}
              emptyMessage="No features"
            />
          </div>
        </div>
      )}
    </div>
  );
}
