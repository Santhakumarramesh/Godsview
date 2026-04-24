"use client";

import { useState, useEffect } from "react";
import { Radio, Power, Send, Script, Activity, MoreVertical, CheckCircle } from "lucide-react";
import { api } from "@/lib/api";

interface WebhookEvent {
  timestamp: string;
  symbol: string;
  action: string;
  source: string;
  status: "delivered" | "processing" | "failed";
}

interface PineScript {
  name: string;
  version: string;
  active: boolean;
  lastUpdate: string;
}

interface MCPAction {
  id: string;
  type: string;
  symbol: string;
  status: "queued" | "executing" | "completed" | "error";
  timestamp: string;
}

const mockWebhookEvents: WebhookEvent[] = [
  {
    timestamp: "14:32:15",
    symbol: "AAPL",
    action: "LONG_ENTRY",
    source: "RSI Bouncer v1.2",
    status: "delivered",
  },
  {
    timestamp: "14:31:42",
    symbol: "MSFT",
    action: "SHORT_EXIT",
    source: "MACD Cross v2.1",
    status: "delivered",
  },
  {
    timestamp: "14:30:58",
    symbol: "TSLA",
    action: "LONG_ENTRY",
    source: "Volume Surge v1.0",
    status: "processing",
  },
  {
    timestamp: "14:29:45",
    symbol: "NVDA",
    action: "ALERT_CONFLUENCE",
    source: "Ichimoku v3.2",
    status: "delivered",
  },
  {
    timestamp: "14:28:20",
    symbol: "SPY",
    action: "LONG_EXIT",
    source: "Bollinger Bands v1.8",
    status: "delivered",
  },
];

const mockPineScripts: PineScript[] = [
  {
    name: "RSI Bouncer",
    version: "1.2",
    active: true,
    lastUpdate: "2024-04-18 09:15:00",
  },
  {
    name: "MACD Cross",
    version: "2.1",
    active: true,
    lastUpdate: "2024-04-17 14:32:00",
  },
  {
    name: "Ichimoku Cloud",
    version: "3.2",
    active: false,
    lastUpdate: "2024-04-16 11:45:00",
  },
];

const mockMCPActions: MCPAction[] = [
  {
    id: "ACT-2541",
    type: "Analyze Symbol",
    symbol: "AAPL",
    status: "completed",
    timestamp: "14:32:00",
  },
  {
    id: "ACT-2540",
    type: "Save Chart State",
    symbol: "MSFT",
    status: "completed",
    timestamp: "14:30:15",
  },
  {
    id: "ACT-2539",
    type: "Launch Backtest",
    symbol: "TSLA",
    status: "executing",
    timestamp: "14:28:45",
  },
];

export default function TradingViewMCPControlPage() {
  const [connectionStatus, setConnectionStatus] = useState("connected" as const);
  const [toggledScripts, setToggledScripts] = useState<Record<string, boolean>>({
    "RSI Bouncer": true,
    "MACD Cross": true,
    "Ichimoku Cloud": false,
  });
  const [webhookEvents, setWebhookEvents] = useState(mockWebhookEvents);
  const [pineScripts, setPineScripts] = useState(mockPineScripts);
  const [mcpActions, setMcpActions] = useState(mockMCPActions);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLiveMode, setIsLiveMode] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        const [eventsRes, scriptsRes, statusRes] = await Promise.all([
          api.tradingview.getWebhookEvents(),
          api.tradingview.getPineScripts(),
          api.tradingview.getStrategySyncStatus(),
        ]);

        if (eventsRes.success && eventsRes.data) {
          setWebhookEvents(eventsRes.data);
        }
        if (scriptsRes.success && scriptsRes.data) {
          setPineScripts(scriptsRes.data);
        }
        if (statusRes.success) {
          setIsLiveMode(true);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
        setIsLiveMode(false);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleToggleScript = (scriptName: string) => {
    setToggledScripts((prev) => ({
      ...prev,
      [scriptName]: !prev[scriptName],
    }));
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 pb-6">
          <div className="flex items-center gap-3">
            <Radio className="w-8 h-8 text-emerald-400" />
            <div>
              <h1 className="text-3xl font-bold text-white">TradingView MCP Control</h1>
              <p className="text-slate-400 text-sm">Manage Pine Scripts, webhooks, and automated actions</p>
            </div>
          </div>
          <div className={`px-3 py-1 rounded text-xs font-semibold ${isLiveMode ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"}`}>
            {isLiveMode ? "Live" : "Demo Mode"}
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 mb-6 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex justify-center py-4 mb-6">
            <div className="text-slate-400 text-sm">Loading data...</div>
          </div>
        )}

        {/* Connection Status */}
        <div className={`rounded-lg p-6 border ${
          connectionStatus === "connected"
            ? "bg-emerald-500/10 border-emerald-500/50"
            : "bg-red-500/10 border-red-500/50"
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full animate-pulse ${
                connectionStatus === "connected" ? "bg-emerald-400" : "bg-red-400"
              }`} />
              <div>
                <p className={`font-semibold ${connectionStatus === "connected" ? "text-emerald-300" : "text-red-300"}`}>
                  {connectionStatus === "connected" ? "Connected to TradingView" : "Connection Lost"}
                </p>
                <p className="text-slate-400 text-sm">MCP endpoint: wss://tv.godswiew.local:8443</p>
              </div>
            </div>
            <button
              onClick={() =>
                setConnectionStatus(connectionStatus === "connected" ? "disconnected" : "connected")
              }
              className="px-4 py-2 rounded font-semibold text-sm bg-slate-800 border border-slate-600 text-white hover:border-slate-500 transition-all"
            >
              {connectionStatus === "connected" ? "Disconnect" : "Reconnect"}
            </button>
          </div>
        </div>

        {/* Recent Webhook Events */}
        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Recent Webhook Events</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-700">
                <tr className="text-slate-400 text-xs uppercase font-semibold">
                  <th className="text-left py-3 px-4">Timestamp</th>
                  <th className="text-left py-3 px-4">Symbol</th>
                  <th className="text-left py-3 px-4">Action</th>
                  <th className="text-left py-3 px-4">Source</th>
                  <th className="text-center py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {webhookEvents.map((event, idx) => (
                  <tr
                    key={idx}
                    className="border-b border-slate-800 hover:bg-slate-800/30 transition-colors"
                  >
                    <td className="py-3 px-4 text-slate-400">{event.timestamp}</td>
                    <td className="py-3 px-4 font-semibold text-white">{event.symbol}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-1 rounded text-xs font-semibold ${
                          event.action.includes("LONG")
                            ? "bg-green-500/20 text-green-300"
                            : event.action.includes("SHORT")
                              ? "bg-red-500/20 text-red-300"
                              : "bg-blue-500/20 text-blue-300"
                        }`}
                      >
                        {event.action}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-300">{event.source}</td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`px-2 py-1 rounded text-xs font-semibold ${
                          event.status === "delivered"
                            ? "bg-green-500/20 text-green-300"
                            : event.status === "processing"
                              ? "bg-amber-500/20 text-amber-300"
                              : "bg-red-500/20 text-red-300"
                        }`}
                      >
                        {event.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Active Pine Scripts */}
        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Script className="w-5 h-5 text-purple-400" />
            Active Pine Scripts
          </h2>
          <div className="space-y-3">
            {pineScripts.map((script, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between bg-slate-800/30 border border-slate-700 rounded p-4 hover:border-slate-600 transition-all"
              >
                <div className="flex-1">
                  <p className="font-semibold text-white">{script.name}</p>
                  <p className="text-slate-400 text-sm">v{script.version} - Updated {script.lastUpdate}</p>
                </div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={toggledScripts[script.name] ?? script.active}
                      onChange={() => handleToggleScript(script.name)}
                      className="w-4 h-4 rounded border-slate-600 bg-slate-800 cursor-pointer"
                    />
                    <span className="text-sm text-slate-300">
                      {toggledScripts[script.name] ?? script.active ? "Active" : "Inactive"}
                    </span>
                  </label>
                  <button className="p-2 hover:bg-slate-700 rounded transition-all">
                    <MoreVertical className="w-4 h-4 text-slate-400" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button className="w-full mt-4 px-4 py-2 rounded bg-slate-800 border border-slate-700 text-white font-semibold hover:border-slate-600 transition-all">
            + Add Pine Script
          </button>
        </div>

        {/* MCP Action Queue */}
        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-sky-400" />
            MCP Action Queue
          </h2>
          <div className="space-y-2">
            {mcpActions.map((action) => (
              <div
                key={action.id}
                className="flex items-center justify-between bg-slate-800/30 border border-slate-700 rounded p-3"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs text-slate-400">{action.id}</span>
                    <span className="text-sm font-semibold text-white">{action.type}</span>
                    <span className="text-sm text-slate-400">{action.symbol}</span>
                  </div>
                  <p className="text-xs text-slate-500">{action.timestamp}</p>
                </div>
                <span
                  className={`px-3 py-1 rounded text-xs font-semibold ${
                    action.status === "completed"
                      ? "bg-green-500/20 text-green-300"
                      : action.status === "executing"
                        ? "bg-amber-500/20 text-amber-300"
                        : action.status === "queued"
                          ? "bg-blue-500/20 text-blue-300"
                          : "bg-red-500/20 text-red-300"
                  }`}
                >
                  {action.status}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button className="px-4 py-3 rounded bg-gradient-to-r from-sky-500 to-sky-600 hover:from-sky-600 hover:to-sky-700 text-white font-semibold flex items-center justify-center gap-2 transition-all">
            <Send className="w-4 h-4" />
            Analyze Symbol
          </button>
          <button className="px-4 py-3 rounded bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white font-semibold flex items-center justify-center gap-2 transition-all">
            <CheckCircle className="w-4 h-4" />
            Save Chart State
          </button>
          <button className="px-4 py-3 rounded bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-semibold flex items-center justify-center gap-2 transition-all">
            <Power className="w-4 h-4" />
            Launch Backtest
          </button>
        </div>
      </div>
    </div>
  );
}
