/**
 * proof.tsx — Proof Dashboard
 *
 * Shows trading performance metrics:
 * - Overall win rate percentage
 * - Total decisions count
 * - By setup table with win rates and profit factors
 * - Drift reports with color-coded badges
 * - Days selector (7, 14, 30, 60, 90)
 */

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, AlertCircle } from "lucide-react";

interface SetupStats {
  setup_type: string;
  win_rate: number;
  total_trades: number;
  profit_factor: number;
}

interface DriftReport {
  metric: string;
  status: "stable" | "watch" | "drift" | "critical";
  current_value: number;
  threshold: number;
}

interface ProofDashboardData {
  win_rate: number;
  total_decisions: number;
  by_setup: SetupStats[];
  drift_reports: DriftReport[];
  period_days: number;
}

const DAY_OPTIONS = [7, 14, 30, 60, 90];

export default function Proof() {
  const [days, setDays] = useState(30);

  const { data, isLoading } = useQuery({
    queryKey: ["proof-dashboard", days],
    queryFn: async () => {
      const res = await fetch(`/api/proof/dashboard?days=${days}`);
      if (!res.ok) throw new Error("Failed to fetch proof data");
      return (await res.json()) as ProofDashboardData;
    },
  });

  const driftBadgeConfig = {
    stable: { bg: "bg-emerald-500/20", border: "border-emerald-400/40", text: "text-emerald-200", label: "Stable" },
    watch: { bg: "bg-yellow-500/20", border: "border-yellow-400/40", text: "text-yellow-200", label: "Watch" },
    drift: { bg: "bg-orange-500/20", border: "border-orange-400/40", text: "text-orange-200", label: "Drift" },
    critical: { bg: "bg-red-500/20", border: "border-red-400/40", text: "text-red-200", label: "Critical" },
  };

  return (
    <div className="min-h-screen bg-[#0a0a1a] text-white">
      <div className="max-w-6xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-12">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h1 className="text-4xl font-bold mb-2">Proof Dashboard</h1>
              <p className="text-gray-400">Trading Performance & Drift Analysis</p>
            </div>
            <div className="flex gap-2">
              {DAY_OPTIONS.map((day) => (
                <button
                  key={day}
                  onClick={() => setDays(day)}
                  className={`px-4 py-2 rounded font-medium transition-colors ${
                    days === day
                      ? "bg-purple-600 text-white"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  }`}
                >
                  {day}d
                </button>
              ))}
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-16 text-gray-400">Loading proof data...</div>
        ) : data ? (
          <div className="space-y-12">
            {/* Win Rate Card */}
            <div className="bg-gradient-to-br from-purple-900/40 to-pink-900/40 border border-purple-500/30 rounded-lg p-8">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-gray-400 text-sm mb-2">Overall Win Rate</div>
                  <div className="text-6xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
                    {Math.round(data.win_rate * 100)}%
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-gray-400 text-sm mb-2">Total Decisions</div>
                  <div className="text-4xl font-bold">{data.total_decisions}</div>
                </div>
              </div>
            </div>

            {/* By Setup Table */}
            <div>
              <h2 className="text-2xl font-semibold mb-6">Performance by Setup</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="text-left py-3 px-4 font-semibold text-gray-300">Setup Type</th>
                      <th className="text-center py-3 px-4 font-semibold text-gray-300">Win Rate</th>
                      <th className="text-center py-3 px-4 font-semibold text-gray-300">Total Trades</th>
                      <th className="text-center py-3 px-4 font-semibold text-gray-300">Profit Factor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_setup.map((setup) => (
                      <tr key={setup.setup_type} className="border-b border-gray-800 hover:bg-gray-800/30 transition-colors">
                        <td className="py-4 px-4 text-gray-300">{setup.setup_type}</td>
                        <td className="py-4 px-4 text-center">
                          <span className="font-semibold text-emerald-400">{Math.round(setup.win_rate * 100)}%</span>
                        </td>
                        <td className="py-4 px-4 text-center text-gray-400">{setup.total_trades}</td>
                        <td className="py-4 px-4 text-center">
                          <span className={setup.profit_factor >= 1 ? "text-emerald-400 font-semibold" : "text-red-400"}>
                            {setup.profit_factor.toFixed(2)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Drift Reports */}
            <div>
              <h2 className="text-2xl font-semibold mb-6">Drift Reports</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {data.drift_reports.map((report) => {
                  const config = driftBadgeConfig[report.status];
                  return (
                    <div
                      key={report.metric}
                      className={`${config.bg} border ${config.border} rounded-lg p-4`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="font-medium text-gray-300 mb-2">{report.metric}</div>
                          <div className="text-2xl font-bold text-white">{report.current_value.toFixed(2)}</div>
                          <div className="text-xs text-gray-400 mt-1">Threshold: {report.threshold.toFixed(2)}</div>
                        </div>
                        <div
                          className={`px-3 py-1 rounded text-xs font-semibold ${config.text} ${config.bg} border ${config.border}`}
                        >
                          {config.label}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
