"use client";
import { useState } from "react";
import React from "react";
import { AlertCircle, CheckCircle, AlertTriangle, Info, Filter, Check } from "lucide-react";
import { api } from "@/lib/api";

interface Alert {
  id: string;
  timestamp: string;
  type: "Market" | "Infrastructure" | "Orders" | "Risk" | "Data";
  severity: "critical" | "warning" | "info";
  title: string;
  message: string;
  acknowledged: boolean;
}

const mockAlerts: Alert[] = [
  { id: "1", timestamp: "2024-04-20 14:35:22", type: "Risk", severity: "critical", title: "Drawdown Threshold Breach", message: "Portfolio drawdown exceeded -5% weekly threshold. Auto-derisking rules activated.", acknowledged: false },
  { id: "2", timestamp: "2024-04-20 14:20:15", type: "Market", severity: "warning", title: "High Volatility Detected", message: "VIX exceeded 25. Market regime changed to volatile.", acknowledged: false },
  { id: "3", timestamp: "2024-04-20 14:15:48", type: "Orders", severity: "warning", title: "Large Order Execution", message: "Order 12847: 5000 shares AAPL executed at $182.45. Slippage: 0.02%", acknowledged: true },
  { id: "4", timestamp: "2024-04-20 14:10:32", type: "Market", severity: "info", title: "Breakout Signal Generated", message: "NVDA broke above $900 resistance. Trend following strategy activated.", acknowledged: true },
  { id: "5", timestamp: "2024-04-20 13:55:17", type: "Infrastructure", severity: "critical", title: "Data Feed Latency High", message: "Market data latency exceeded 500ms. Real-time analysis affected.", acknowledged: false },
  { id: "6", timestamp: "2024-04-20 13:40:05", type: "Market", severity: "info", title: "Support Level Tested", message: "TSLA tested daily support at $240. Holding strong.", acknowledged: true },
  { id: "7", timestamp: "2024-04-20 13:25:33", type: "Orders", severity: "warning", title: "Partial Fill", message: "Order 12845: 2000 shares filled, 3000 shares pending.", acknowledged: false },
  { id: "8", timestamp: "2024-04-20 13:10:19", type: "Infrastructure", severity: "info", title: "System Health Check", message: "All systems operational. CPU: 45%, Memory: 62%", acknowledged: true },
  { id: "9", timestamp: "2024-04-20 12:55:42", type: "Market", severity: "warning", title: "Correlation Spike", message: "Portfolio correlation increased to 0.82. Diversification recommended.", acknowledged: false },
  { id: "10", timestamp: "2024-04-20 12:40:11", type: "Data", severity: "info", title: "Quote Update Received", message: "Updated quotes for 150 symbols. Last update: 12:40:08 UTC.", acknowledged: true },
];

export default function AlertsPage() {
  // Initialize with mock data, try to fetch from API on load
  const [alerts, setAlerts] = useState<Alert[]>(mockAlerts);
  const [filterType, setFilterType] = useState<string>("all");
  const [filterSeverity, setFilterSeverity] = useState<string>("all");

  // Try to fetch alerts from API with fallback to mock
  React.useEffect(() => {
    const fetchAlerts = async () => {
      try {
        const data = await api.ops.getAlerts().catch(() => ({ alerts: mockAlerts }))
        setAlerts(data.alerts || mockAlerts)
      } catch (err) {
        // Keep mockAlerts as fallback
      }
    }
    fetchAlerts()
  }, [])

  const handleAcknowledge = (id: string) => {
    setAlerts(alerts.map((alert) => alert.id === id ? { ...alert, acknowledged: !alert.acknowledged } : alert));
  };

  const unacknowledgedCount = alerts.filter((a) => !a.acknowledged).length;
  const filteredAlerts = alerts.filter((alert) => {
    const typeMatch = filterType === "all" || alert.type === filterType;
    const severityMatch = filterSeverity === "all" || alert.severity === filterSeverity;
    return typeMatch && severityMatch;
  });

  const alertsByCategory = {
    Market: mockAlerts.filter((a) => a.type === "Market").length,
    Infrastructure: mockAlerts.filter((a) => a.type === "Infrastructure").length,
    Orders: mockAlerts.filter((a) => a.type === "Orders").length,
    Risk: mockAlerts.filter((a) => a.type === "Risk").length,
    Data: mockAlerts.filter((a) => a.type === "Data").length,
  };

  const getSeverityIcon = (severity: string) => {
    if (severity === "critical") return <AlertCircle className="w-5 h-5 text-red-400" />;
    if (severity === "warning") return <AlertTriangle className="w-5 h-5 text-amber-400" />;
    return <Info className="w-5 h-5 text-blue-400" />;
  };

  const getSeverityColor = (severity: string) => {
    if (severity === "critical") return "bg-red-500/20 text-red-300 border-red-500/30";
    if (severity === "warning") return "bg-amber-500/20 text-amber-300 border-amber-500/30";
    return "bg-blue-500/20 text-blue-300 border-blue-500/30";
  };

  const getTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      Market: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
      Infrastructure: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
      Orders: "bg-purple-500/20 text-purple-300 border-purple-500/30",
      Risk: "bg-red-500/20 text-red-300 border-red-500/30",
      Data: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
    };
    return colors[type] || "bg-slate-500/20 text-slate-300 border-slate-500/30";
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between border-b border-slate-700 pb-6">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-8 h-8 text-amber-400" />
            <div>
              <h1 className="text-3xl font-bold text-white">Alerts Command Hub</h1>
              <p className="text-slate-400 text-sm">Centralized alert management and monitoring</p>
            </div>
          </div>

          {unacknowledgedCount > 0 && (
            <div className="px-4 py-2 bg-red-500/20 border border-red-500/30 rounded-full flex items-center gap-2">
              <div className="w-3 h-3 bg-red-400 rounded-full animate-pulse" />
              <span className="text-red-300 font-semibold text-sm">{unacknowledgedCount} Unacknowledged</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4"><p className="text-slate-400 text-xs font-medium uppercase mb-2">Total Alerts</p><p className="text-2xl font-bold text-white">{alerts.length}</p></div>
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4"><p className="text-red-300 text-xs font-medium uppercase mb-2">Critical</p><p className="text-2xl font-bold text-red-400">{alerts.filter((a) => a.severity === "critical").length}</p></div>
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4"><p className="text-amber-300 text-xs font-medium uppercase mb-2">Warning</p><p className="text-2xl font-bold text-amber-400">{alerts.filter((a) => a.severity === "warning").length}</p></div>
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4"><p className="text-blue-300 text-xs font-medium uppercase mb-2">Info</p><p className="text-2xl font-bold text-blue-400">{alerts.filter((a) => a.severity === "info").length}</p></div>
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4"><p className="text-slate-400 text-xs font-medium uppercase mb-2">Acknowledged</p><p className="text-2xl font-bold text-green-400">{alerts.filter((a) => a.acknowledged).length}</p></div>
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4"><p className="text-slate-400 text-xs font-medium uppercase mb-2">Pending</p><p className="text-2xl font-bold text-amber-400">{unacknowledgedCount}</p></div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {Object.entries(alertsByCategory).map(([category, count]) => (
            <div key={category} className={`p-4 rounded-lg border cursor-pointer transition-all ${getTypeColor(category)} hover:opacity-80`}>
              <p className="text-xs font-semibold uppercase mb-2">{category}</p>
              <p className="text-2xl font-bold">{count}</p>
            </div>
          ))}
        </div>

        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4 flex flex-wrap gap-4 items-center">
          <Filter className="w-5 h-5 text-slate-400" />

          <div className="flex gap-2">
            <label className="text-sm font-medium text-slate-300">Type:</label>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="px-3 py-1 bg-slate-800 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-amber-400">
              <option value="all">All Types</option>
              <option value="Market">Market</option>
              <option value="Infrastructure">Infrastructure</option>
              <option value="Orders">Orders</option>
              <option value="Risk">Risk</option>
              <option value="Data">Data</option>
            </select>
          </div>

          <div className="flex gap-2">
            <label className="text-sm font-medium text-slate-300">Severity:</label>
            <select value={filterSeverity} onChange={(e) => setFilterSeverity(e.target.value)} className="px-3 py-1 bg-slate-800 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-amber-400">
              <option value="all">All Severities</option>
              <option value="critical">Critical</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
            </select>
          </div>

          <button className="ml-auto px-3 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 border border-slate-600 rounded text-sm font-semibold transition-all">Clear Filters</button>
        </div>

        <div className="bg-slate-900/50 border border-slate-700 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-700 bg-slate-800/30">
                <tr className="text-slate-400 text-xs uppercase font-semibold">
                  <th className="text-center py-4 px-4 w-12"><input type="checkbox" className="rounded border-slate-600 cursor-pointer" /></th>
                  <th className="text-left py-4 px-6">Timestamp</th>
                  <th className="text-left py-4 px-6">Type</th>
                  <th className="text-left py-4 px-6">Severity</th>
                  <th className="text-left py-4 px-6">Title</th>
                  <th className="text-left py-4 px-6">Message</th>
                  <th className="text-center py-4 px-6">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredAlerts.length > 0 ? (
                  filteredAlerts.map((alert) => (
                    <tr key={alert.id} className={`border-b border-slate-800 hover:bg-slate-800/30 transition-colors ${alert.acknowledged ? "opacity-60" : ""}`}>
                      <td className="text-center py-4 px-4"><input type="checkbox" checked={alert.acknowledged} onChange={() => handleAcknowledge(alert.id)} className="rounded border-slate-600 cursor-pointer" /></td>
                      <td className="py-4 px-6 text-slate-300 font-mono text-xs">{alert.timestamp}</td>
                      <td className="py-4 px-6"><span className={`px-3 py-1 rounded text-xs font-bold border w-fit inline-block ${getTypeColor(alert.type)}`}>{alert.type}</span></td>
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-2">
                          {getSeverityIcon(alert.severity)}
                          <span className={`px-2 py-1 rounded text-xs font-bold border ${getSeverityColor(alert.severity)}`}>{alert.severity.toUpperCase()}</span>
                        </div>
                      </td>
                      <td className="py-4 px-6 text-white font-semibold">{alert.title}</td>
                      <td className="py-4 px-6 text-slate-300">{alert.message}</td>
                      <td className="py-4 px-6 text-center">
                        <button onClick={() => handleAcknowledge(alert.id)} className={`px-3 py-1 rounded text-xs font-semibold border transition-all ${alert.acknowledged ? "bg-green-500/20 text-green-300 border-green-500/30" : "bg-slate-700 hover:bg-slate-600 text-slate-300 border-slate-600"}`}>
                          {alert.acknowledged ? <CheckCircle className="w-4 h-4 inline-block mr-1" /> : <Check className="w-4 h-4 inline-block mr-1" />}
                          {alert.acknowledged ? "Acked" : "Ack"}
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan={7} className="py-12 text-center text-slate-400">No alerts match your filters</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {alerts.filter((a) => a.severity === "critical" && !a.acknowledged).length > 0 && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-red-300 mb-4 flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              Critical Alerts Requiring Attention
            </h2>
            <div className="space-y-3">
              {alerts.filter((a) => a.severity === "critical" && !a.acknowledged).map((alert) => (
                <div key={alert.id} className="bg-red-500/5 border border-red-500/20 rounded p-4 flex items-start justify-between">
                  <div className="flex-1">
                    <p className="font-semibold text-red-300">{alert.title}</p>
                    <p className="text-sm text-red-100 mt-1">{alert.message}</p>
                    <p className="text-xs text-red-200 mt-2">{alert.timestamp}</p>
                  </div>
                  <button onClick={() => handleAcknowledge(alert.id)} className="ml-4 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 rounded font-semibold transition-all whitespace-nowrap">
                    Acknowledge
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
