"use client";

import { useState, useEffect } from "react";
import { Target, TrendingDown, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";

interface SLO {
  id: string;
  name: string;
  target: number;
  current: number;
  unit: string;
  budgetRemaining: number;
  burnRate: number;
  status: "healthy" | "warning" | "critical";
}

const mockSLOs: SLO[] = [
  {
    id: "1",
    name: "API Availability",
    target: 99.9,
    current: 99.94,
    unit: "%",
    budgetRemaining: 0.45,
    burnRate: 0.02,
    status: "healthy",
  },
  {
    id: "2",
    name: "Latency P95",
    target: 100,
    current: 87,
    unit: "ms",
    budgetRemaining: 13,
    burnRate: 0.8,
    status: "healthy",
  },
  {
    id: "3",
    name: "Error Rate",
    target: 0.1,
    current: 0.08,
    unit: "%",
    budgetRemaining: 0.02,
    burnRate: 0.15,
    status: "warning",
  },
  {
    id: "4",
    name: "Data Freshness",
    target: 99.5,
    current: 99.38,
    unit: "%",
    budgetRemaining: 0.12,
    burnRate: 0.6,
    status: "warning",
  },
];

export default function OpsSLOsPage() {
  const [slos, setSLOs] = useState<SLO[]>(mockSLOs);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSLOs = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await api.ops.getSLOs?.();
        if (result) {
          setSLOs(result);
        }
      } catch (err) {
        console.error("Error fetching SLOs:", err);
        setError("Failed to fetch SLO data");
      } finally {
        setLoading(false);
      }
    };

    fetchSLOs();
  }, []);

  const getStatusConfig = (status: string) => {
    switch (status) {
      case "healthy":
        return {
          bg: "bg-green-500/20",
          border: "border-green-500/30",
          text: "text-green-300",
          badge: "bg-green-500/30 text-green-300",
        };
      case "warning":
        return {
          bg: "bg-yellow-500/20",
          border: "border-yellow-500/30",
          text: "text-yellow-300",
          badge: "bg-yellow-500/30 text-yellow-300",
        };
      case "critical":
        return {
          bg: "bg-red-500/20",
          border: "border-red-500/30",
          text: "text-red-300",
          badge: "bg-red-500/30 text-red-300",
        };
      default:
        return {
          bg: "bg-slate-500/20",
          border: "border-slate-500/30",
          text: "text-slate-300",
          badge: "bg-slate-500/30 text-slate-300",
        };
    }
  };

  const calculateMeterPercentage = (slo: SLO) => {
    if (slo.name === "Error Rate" || slo.name === "Data Freshness (Inverse)") {
      // For error rate, lower is better
      return Math.min(100, (slo.current / slo.target) * 100);
    }
    // For other metrics, show against target
    return Math.min(100, (slo.current / slo.target) * 100);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 pb-6">
          <div className="flex items-center gap-3">
            <Target className="w-8 h-8 text-purple-400" />
            <div>
              <h1 className="text-3xl font-bold text-white">SLO Dashboard</h1>
              <p className="text-slate-400 text-sm">Service Level Objectives and error budgets</p>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4 flex items-center gap-2 text-red-300">
            <AlertCircle className="w-5 h-5" />
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-12">
            <p className="text-slate-400">Loading SLO data...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {slos.map((slo) => {
              const config = getStatusConfig(slo.status);
              const percentage = calculateMeterPercentage(slo);
              const isErrorMetric =
                slo.name === "Error Rate" || slo.name.includes("Inverse");

              return (
                <div
                  key={slo.id}
                  className={`rounded-lg border p-6 ${config.bg} ${config.border}`}
                >
                  {/* Header */}
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-semibold text-white mb-2">
                        {slo.name}
                      </h3>
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-sm font-semibold px-2 py-1 rounded ${config.badge}`}
                        >
                          {slo.status === "healthy"
                            ? "Healthy"
                            : slo.status === "warning"
                              ? "Warning"
                              : "Critical"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Performance Meter */}
                  <div className="mb-4">
                    <div className="flex justify-between mb-2">
                      <span className="text-sm font-semibold text-white">
                        Current:{" "}
                        <span className={config.text}>
                          {slo.current} {slo.unit}
                        </span>
                      </span>
                      <span className="text-sm font-semibold text-slate-400">
                        Target: {slo.target} {slo.unit}
                      </span>
                    </div>
                    <div className="w-full bg-slate-700 rounded-full h-3">
                      <div
                        className={`h-3 rounded-full transition-all ${
                          slo.status === "healthy"
                            ? "bg-gradient-to-r from-green-500 to-green-400"
                            : slo.status === "warning"
                              ? "bg-gradient-to-r from-yellow-500 to-yellow-400"
                              : "bg-gradient-to-r from-red-500 to-red-400"
                        }`}
                        style={{ width: `${Math.min(percentage, 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* Budget Info */}
                  <div className="grid grid-cols-2 gap-4 mb-4 pt-4 border-t border-current border-opacity-20">
                    {/* Budget Remaining */}
                    <div>
                      <p className="text-xs font-semibold text-slate-400 uppercase mb-1">
                        Budget Remaining
                      </p>
                      <p
                        className={`text-xl font-bold ${
                          slo.budgetRemaining > 0.1
                            ? "text-green-400"
                            : slo.budgetRemaining > 0.01
                              ? "text-yellow-400"
                              : "text-red-400"
                        }`}
                      >
                        {slo.budgetRemaining.toFixed(3)} {slo.unit}
                      </p>
                    </div>

                    {/* Burn Rate */}
                    <div>
                      <p className="text-xs font-semibold text-slate-400 uppercase mb-1">
                        Burn Rate
                      </p>
                      <div className="flex items-center gap-1">
                        <TrendingDown className="w-4 h-4 text-red-400" />
                        <p className="text-xl font-bold text-red-400">
                          {slo.burnRate.toFixed(2)}{slo.unit}/day
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Timeline Indicator */}
                  <div className="bg-slate-800/50 rounded p-3">
                    <p className="text-xs font-semibold text-slate-400 uppercase mb-2">
                      Error Budget Exhaustion
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${
                            slo.status === "healthy"
                              ? "bg-green-500"
                              : slo.status === "warning"
                                ? "bg-yellow-500"
                                : "bg-red-500"
                          }`}
                          style={{
                            width: `${Math.min(
                              (slo.burnRate / slo.budgetRemaining) * 10,
                              100
                            )}%`,
                          }}
                        />
                      </div>
                      <span className="text-xs text-slate-400">
                        {slo.budgetRemaining > 0
                          ? `~${Math.ceil(
                              slo.budgetRemaining / slo.burnRate
                            )}d left`
                          : "Critical"}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Summary Stats */}
        {!loading && (
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Overall Health</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-slate-800/50 rounded-lg p-4">
                <p className="text-slate-400 text-xs font-semibold uppercase mb-2">
                  Total SLOs
                </p>
                <p className="text-2xl font-bold text-white">{slos.length}</p>
              </div>
              <div className="bg-green-500/20 rounded-lg p-4 border border-green-500/30">
                <p className="text-slate-400 text-xs font-semibold uppercase mb-2">
                  Healthy
                </p>
                <p className="text-2xl font-bold text-green-400">
                  {slos.filter((s) => s.status === "healthy").length}
                </p>
              </div>
              <div className="bg-yellow-500/20 rounded-lg p-4 border border-yellow-500/30">
                <p className="text-slate-400 text-xs font-semibold uppercase mb-2">
                  Warning
                </p>
                <p className="text-2xl font-bold text-yellow-400">
                  {slos.filter((s) => s.status === "warning").length}
                </p>
              </div>
              <div className="bg-red-500/20 rounded-lg p-4 border border-red-500/30">
                <p className="text-slate-400 text-xs font-semibold uppercase mb-2">
                  Critical
                </p>
                <p className="text-2xl font-bold text-red-400">
                  {slos.filter((s) => s.status === "critical").length}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
