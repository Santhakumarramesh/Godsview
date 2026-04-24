"use client";

import { useState, useEffect } from "react";
import { Wifi, WifiOff, AlertTriangle, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";

interface Feed {
  id: string;
  name: string;
  status: "connected" | "disconnected" | "degraded";
  latency: number;
  messagesPerSec: number;
  lastMessage: string;
}

const mockFeeds: Feed[] = [
  {
    id: "1",
    name: "Alpaca WS",
    status: "connected",
    latency: 12,
    messagesPerSec: 450,
    lastMessage: "15 seconds ago",
  },
  {
    id: "2",
    name: "TradingView",
    status: "connected",
    latency: 34,
    messagesPerSec: 320,
    lastMessage: "3 seconds ago",
  },
  {
    id: "3",
    name: "News API",
    status: "degraded",
    latency: 280,
    messagesPerSec: 45,
    lastMessage: "2 minutes ago",
  },
  {
    id: "4",
    name: "Order Flow",
    status: "connected",
    latency: 8,
    messagesPerSec: 1200,
    lastMessage: "1 second ago",
  },
  {
    id: "5",
    name: "Market Data",
    status: "connected",
    latency: 18,
    messagesPerSec: 680,
    lastMessage: "2 seconds ago",
  },
];

export default function OpsFeedsPage() {
  const [feeds, setFeeds] = useState<Feed[]>(mockFeeds);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchFeeds = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await api.ops.getFeedStatus?.();
        if (result) {
          setFeeds(result);
        }
      } catch (err) {
        console.error("Error fetching feeds:", err);
        setError("Failed to fetch feed status");
      } finally {
        setLoading(false);
      }
    };

    fetchFeeds();
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "connected":
        return "bg-green-500/20 text-green-300 border-green-500/30";
      case "disconnected":
        return "bg-red-500/20 text-red-300 border-red-500/30";
      case "degraded":
        return "bg-yellow-500/20 text-yellow-300 border-yellow-500/30";
      default:
        return "bg-slate-500/20 text-slate-300";
    }
  };

  const getLatencyColor = (latency: number) => {
    if (latency < 50) return "text-green-400";
    if (latency < 150) return "text-yellow-400";
    return "text-red-400";
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 pb-6">
          <div className="flex items-center gap-3">
            <Wifi className="w-8 h-8 text-blue-400" />
            <div>
              <h1 className="text-3xl font-bold text-white">Data Feed Status</h1>
              <p className="text-slate-400 text-sm">Monitor real-time market data feeds</p>
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
            <p className="text-slate-400">Loading feed status...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {feeds.map((feed) => (
              <div
                key={feed.id}
                className={`rounded-lg border p-6 transition-all ${getStatusColor(
                  feed.status
                )} bg-opacity-10`}
              >
                {/* Feed Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-white mb-2">
                      {feed.name}
                    </h3>
                    <div className="flex items-center gap-2">
                      {feed.status === "connected" ? (
                        <Wifi className="w-4 h-4 text-green-400" />
                      ) : feed.status === "degraded" ? (
                        <AlertTriangle className="w-4 h-4 text-yellow-400" />
                      ) : (
                        <WifiOff className="w-4 h-4 text-red-400" />
                      )}
                      <span className="text-sm font-semibold">
                        {feed.status === "connected"
                          ? "Connected"
                          : feed.status === "degraded"
                            ? "Degraded"
                            : "Disconnected"}
                      </span>
                    </div>
                  </div>

                  <div
                    className={`w-3 h-3 rounded-full ${
                      feed.status === "connected"
                        ? "bg-green-400 animate-pulse"
                        : feed.status === "degraded"
                          ? "bg-yellow-400 animate-pulse"
                          : "bg-red-400"
                    }`}
                  />
                </div>

                {/* Metrics */}
                <div className="space-y-3">
                  {/* Latency */}
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-medium text-slate-400 uppercase">
                      Latency
                    </span>
                    <span
                      className={`font-semibold ${getLatencyColor(
                        feed.latency
                      )}`}
                    >
                      {feed.latency}ms
                    </span>
                  </div>

                  {/* Messages Per Second */}
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-medium text-slate-400 uppercase">
                      Throughput
                    </span>
                    <span className="font-semibold text-cyan-400">
                      {feed.messagesPerSec.toLocaleString()} msg/s
                    </span>
                  </div>

                  {/* Last Message */}
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-medium text-slate-400 uppercase">
                      Last Message
                    </span>
                    <span className="font-semibold text-slate-300">
                      {feed.lastMessage}
                    </span>
                  </div>

                  {/* Activity Bar */}
                  <div className="mt-4 pt-3 border-t border-current border-opacity-20">
                    <div className="flex items-center gap-1 h-6">
                      {Array.from({ length: 12 }).map((_, i) => {
                        const height = Math.floor(
                          Math.random() * 100 * (feed.status === "connected" ? 1 : 0.3)
                        );
                        return (
                          <div
                            key={i}
                            className={`flex-1 rounded-sm ${
                              feed.status === "connected"
                                ? "bg-green-500/50"
                                : feed.status === "degraded"
                                  ? "bg-yellow-500/50"
                                  : "bg-red-500/20"
                            }`}
                            style={{ height: `${Math.max(10, height)}%` }}
                          />
                        );
                      })}
                    </div>
                    <p className="text-xs text-slate-400 mt-2">Activity (last 12s)</p>
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
