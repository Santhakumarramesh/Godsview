"use client";

import { useState, useEffect } from "react";
import { Zap, TrendingUp, TrendingDown, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";

interface Latency {
  id: string;
  service: string;
  p50: number;
  p95: number;
  p99: number;
  trend: "up" | "down";
  status: "healthy" | "degraded" | "critical";
}

const mockLatencies: Latency[] = [
  {
    id: "1",
    service: "API Server",
    p50: 12,
    p95: 45,
    p99: 120,
    trend: "down",
    status: "healthy",
  },
  {
    id: "2",
    service: "Broker Connection",
    p50: 8,
    p95: 35,
    p99: 98,
    trend: "up",
    status: "healthy",
  },
  {
    id: "3",
    service: "Database",
    p50: 22,
    p95: 75,
    p99: 250,
    trend: "up",
    status: "degraded",
  },
  {
    id: "4",
    service: "Redis Cache",
    p50: 2,
    p95: 8,
    p99: 25,
    trend: "down",
    status: "healthy",
  },
  {
    id: "5",
    service: "Python Services",
    p50: 145,
    p95: 380,
    p99: 950,
    trend: "up",
    status: "critical",
  },
];

export default function OpsLatencyPage() {
  const [latencies, setLatencies] = useState<Latency[]>(mockLatencies);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchLatency = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await api.ops.getLatency?.();
        if (result) {
          setLatencies(result);
        }
      } catch (err) {
        console.error("Error fetching latency:", err);
        setError("Failed to fetch latency data");
      } finally {
        setLoading(false);
      }
    };

    fetchLatency();
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "healthy":
        return "bg-green-500/20 text-green-300 border-green-500/30";
      case "degraded":
        return "bg-yellow-500/20 text-yellow-300 border-yellow-500/30";
      case "critical":
        return "bg-red-500/20 text-red-300 border-red-500/30";
      default:
        return "bg-slate-500/20 text-slate-300";
    }
  };

  const getLatencyColor = (p99: number) => {
    if (p99 < 100) return "text-green-400";
    if (p99 < 300) return "text-yellow-400";
    return "text-red-400";
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 pb-6">
          <div className="flex items-center gap-3">
            <Zap className="w-8 h-8 text-yellow-400" />
            <div>
              <h1 className="text-3xl font-bold text-white">Service Latency Dashboard</h1>
              <p className="text-slate-400 text-sm">Monitor p50, p95, p99 latencies across services</p>
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
            <p className="text-slate-400">Loading latency data...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {latencies.map((latency) => (
              <div
                key={latency.id}
                className={`rounded-lg border p-6 transition-all ${getStatusColor(
                  latency.status
                )}`}
              >
                {/* Service Header */}
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-1">
                      {latency.service}
                    </h3>
                    <div className="flex items-center gap-2">
                      {latency.trend === "down" ? (
                        <TrendingDown className="w-4 h-4 text-green-400" />
                      ) : (
                        <TrendingUp className="w-4 h-4 text-red-400" />
                      )}
                      <span className="text-xs font-semibold">
                        {latency.trend === "down" ? "Improving" : "Degrading"}
                      </span>
                    </div>
                  </div>
                  <span
                    className={`px-3 py-1 rounded text-xs font-semibold ${
                      latency.status === "healthy"
                        ? "bg-green-500/30 text-green-300"
                        : latency.status === "degraded"
                          ? "bg-yellow-500/30 text-yellow-300"
                          : "bg-red-500/30 text-red-300"
                    }`}
                  >
                    {latency.status === "healthy"
                      ? "Healthy"
                      : latency.status === "degraded"
                        ? "Degraded"
                        : "Critical"}
                  </span>
                </div>

                {/* Latency Metrics */}
                <div className="space-y-4">
                  {/* P50 */}
                  <div>
                    <div className="flex justify-between mb-2">
                      <span className="text-xs font-semibold text-slate-400 uppercase">
                        P50 Latency
                      </span>
                      <span className="font-bold text-green-400">
                        {latency.p50}ms
                      </span>
                    </div>
                    <div className="w-full bg-slate-700 rounded h-2">
                      <div
                        className="bg-gradient-to-r from-green-500 to-green-400 h-2 rounded"
                        style={{ width: `${Math.min((latency.p50 / 200) * 100, 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* P95 */}
                  <div>
                    <div className="flex justify-between mb-2">
                      <span className="text-xs font-semibold text-slate-400 uppercase">
                        P95 Latency
                      </span>
                      <span className="font-bold text-yellow-400">
                        {latency.p95}ms
                      </span>
                    </div>
                    <div className="w-full bg-slate-700 rounded h-2">
                      <div
                        className="bg-gradient-to-r from-yellow-500 to-yellow-400 h-2 rounded"
                        style={{ width: `${Math.min((latency.p95 / 500) * 100, 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* P99 */}
                  <div>
                    <div className="flex justify-between mb-2">
                      <span className="text-xs font-semibold text-slate-400 uppercase">
                        P99 Latency
                      </span>
                      <span className={`font-bold ${getLatencyColor(latency.p99)}`}>
                        {latency.p99}ms
                      </span>
                    </div>
                    <div className="w-full bg-slate-700 rounded h-2">
                      <div
                        className={`h-2 rounded ${
                          latency.p99 < 100
                            ? "bg-gradient-to-r from-green-600 to-green-500"
                            : latency.p99 < 300
                              ? "bg-gradient-to-r from-yellow-600 to-yellow-500"
                              : "bg-gradient-to-r from-red-600 to-red-500"
                        }`}
                        style={{
                          width: `${Math.min((latency.p99 / 1000) * 100, 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Distribution Chart */}
                <div className="mt-4 pt-4 border-t border-current border-opacity-20">
                  <p className="text-xs font-semibold text-slate-400 uppercase mb-2">
                    Latency Distribution
                  </p>
                  <div className="flex items-end justify-between gap-1 h-16">
                    {[...Array(10)].map((_, i) => {
                      const height = Math.floor(
                        Math.random() * 100 * (i / 10)
                      );
                      return (
                        <div
                          key={i}
                          className={`flex-1 rounded-sm ${
                            latency.status === "healthy"
                              ? "bg-green-500/50"
                              : latency.status === "degraded"
                                ? "bg-yellow-500/50"
                                : "bg-red-500/50"
                          }`}
                          style={{ height: `${Math.max(5, height)}%` }}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
