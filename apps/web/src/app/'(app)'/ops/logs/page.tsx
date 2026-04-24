"use client";

import { useState, useEffect, useRef, useEffect as useEffectScroll } from "react";
import { Terminal, AlertCircle, Filter, Pause, Play } from "lucide-react";
import { api } from "@/lib/api";

interface LogEntry {
  id: string;
  timestamp: string;
  level: "info" | "warn" | "error";
  service: string;
  message: string;
}

const mockLogs: LogEntry[] = [
  {
    id: "1",
    timestamp: "14:32:45.123",
    level: "info",
    service: "API Server",
    message: "Request processed successfully - GET /api/v1/market/quotes - 45ms",
  },
  {
    id: "2",
    timestamp: "14:32:43.891",
    level: "info",
    service: "Broker",
    message: "Order filled: AAPL 100 @ 182.45",
  },
  {
    id: "3",
    timestamp: "14:32:41.567",
    level: "warn",
    service: "Database",
    message: "Slow query detected - SELECT query took 523ms (threshold: 300ms)",
  },
  {
    id: "4",
    timestamp: "14:32:39.234",
    level: "info",
    service: "Cache",
    message: "Cache hit ratio: 94.2% - 2341 hits, 137 misses",
  },
  {
    id: "5",
    timestamp: "14:32:36.890",
    level: "error",
    service: "Python Services",
    message: "Strategy execution failed: IndexError in momentum_calc - service will retry",
  },
  {
    id: "6",
    timestamp: "14:32:34.567",
    level: "info",
    service: "Market Data",
    message: "Update: 2847 symbols updated - latency 18ms",
  },
  {
    id: "7",
    timestamp: "14:32:32.234",
    level: "warn",
    service: "API Server",
    message: "High memory usage detected - 82% of allocated heap in use",
  },
  {
    id: "8",
    timestamp: "14:32:29.891",
    level: "info",
    service: "News API",
    message: "Fetched 45 news articles - rate limit: 950/1000 remaining",
  },
];

export default function OpsLogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>(mockLogs);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterLevel, setFilterLevel] = useState<"all" | "info" | "warn" | "error">("all");
  const [filterService, setFilterService] = useState<string>("all");
  const [searchText, setSearchText] = useState("");
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await api.ops.getLogs?.();
        if (result) {
          setLogs(result);
        }
      } catch (err) {
        console.error("Error fetching logs:", err);
        setError("Failed to fetch logs");
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
  }, []);

  useEffectScroll(() => {
    if (isAutoScroll && logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs, isAutoScroll]);

  const filteredLogs = logs.filter((log) => {
    const levelMatch = filterLevel === "all" || log.level === filterLevel;
    const serviceMatch = filterService === "all" || log.service === filterService;
    const textMatch =
      searchText === "" ||
      log.message.toLowerCase().includes(searchText.toLowerCase()) ||
      log.service.toLowerCase().includes(searchText.toLowerCase());

    return levelMatch && serviceMatch && textMatch;
  });

  const uniqueServices = ["all", ...new Set(logs.map((l) => l.service))];

  const getLevelColor = (level: string) => {
    switch (level) {
      case "info":
        return "text-cyan-400";
      case "warn":
        return "text-yellow-400";
      case "error":
        return "text-red-400";
      default:
        return "text-slate-400";
    }
  };

  const getLevelBg = (level: string) => {
    switch (level) {
      case "info":
        return "bg-cyan-500/20";
      case "warn":
        return "bg-yellow-500/20";
      case "error":
        return "bg-red-500/20";
      default:
        return "bg-slate-500/20";
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 p-6 flex flex-col">
      <div className="max-w-7xl mx-auto space-y-6 flex-1 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 pb-6">
          <div className="flex items-center gap-3">
            <Terminal className="w-8 h-8 text-green-400" />
            <div>
              <h1 className="text-3xl font-bold text-white">Service Logs</h1>
              <p className="text-slate-400 text-sm">Real-time log viewer with filtering and search</p>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4 flex items-center gap-2 text-red-300">
            <AlertCircle className="w-5 h-5" />
            {error}
          </div>
        )}

        {/* Controls */}
        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Level Filter */}
            <div className="flex-1">
              <label className="block text-xs font-semibold text-slate-400 uppercase mb-2">
                <Filter className="w-3 h-3 inline mr-1" /> Level
              </label>
              <select
                value={filterLevel}
                onChange={(e) =>
                  setFilterLevel(e.target.value as "all" | "info" | "warn" | "error")
                }
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-green-400"
              >
                <option value="all">All Levels</option>
                <option value="info">Info</option>
                <option value="warn">Warn</option>
                <option value="error">Error</option>
              </select>
            </div>

            {/* Service Filter */}
            <div className="flex-1">
              <label className="block text-xs font-semibold text-slate-400 uppercase mb-2">
                Service
              </label>
              <select
                value={filterService}
                onChange={(e) => setFilterService(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-green-400"
              >
                {uniqueServices.map((service) => (
                  <option key={service} value={service}>
                    {service === "all" ? "All Services" : service}
                  </option>
                ))}
              </select>
            </div>

            {/* Search */}
            <div className="flex-1">
              <label className="block text-xs font-semibold text-slate-400 uppercase mb-2">
                Search
              </label>
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search logs..."
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm placeholder-slate-500 focus:outline-none focus:border-green-400"
              />
            </div>

            {/* Auto Scroll Toggle */}
            <div className="flex items-end">
              <button
                onClick={() => setIsAutoScroll(!isAutoScroll)}
                className={`px-4 py-2 rounded text-sm font-semibold flex items-center gap-2 transition-all ${
                  isAutoScroll
                    ? "bg-green-500/30 text-green-300 border border-green-500/50"
                    : "bg-slate-700 text-slate-400 border border-slate-600"
                }`}
              >
                {isAutoScroll ? (
                  <>
                    <Play className="w-4 h-4" />
                    Auto Scroll
                  </>
                ) : (
                  <>
                    <Pause className="w-4 h-4" />
                    Paused
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Logs Container */}
        {loading ? (
          <div className="text-center py-12">
            <p className="text-slate-400">Loading logs...</p>
          </div>
        ) : (
          <div
            ref={logsContainerRef}
            className="flex-1 bg-slate-950/50 border border-slate-700 rounded-lg p-4 font-mono text-xs overflow-y-auto space-y-1"
          >
            {filteredLogs.length > 0 ? (
              filteredLogs.map((log) => (
                <div
                  key={log.id}
                  className={`flex gap-4 py-1 px-2 hover:bg-slate-800/30 transition-colors rounded ${getLevelBg(
                    log.level
                  )}`}
                >
                  <span className="text-slate-500 min-w-fit">
                    {log.timestamp}
                  </span>
                  <span
                    className={`font-semibold min-w-fit uppercase ${getLevelColor(
                      log.level
                    )}`}
                  >
                    [{log.level}]
                  </span>
                  <span className="text-blue-400 min-w-fit">
                    {log.service}
                  </span>
                  <span className="text-slate-300 flex-1 break-words">
                    {log.message}
                  </span>
                </div>
              ))
            ) : (
              <div className="text-center py-12 text-slate-400">
                <p>No logs match the current filters</p>
              </div>
            )}
          </div>
        )}

        {/* Log Count */}
        <div className="text-xs text-slate-500 flex justify-between">
          <span>Showing {filteredLogs.length} of {logs.length} logs</span>
          <span>{isAutoScroll ? "Auto scroll enabled" : "Auto scroll disabled"}</span>
        </div>
      </div>
    </div>
  );
}
