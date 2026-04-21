"use client";

import { useState, useEffect } from "react";
import { AlertCircle, Plus, Clock, CheckCircle } from "lucide-react";
import { api } from "@/lib/api";

interface Incident {
  id: string;
  severity: "P1" | "P2" | "P3" | "P4";
  title: string;
  status: "open" | "investigating" | "resolved";
  opened: string;
  resolved: string | null;
  duration: string | null;
}

const mockIncidents: Incident[] = [
  {
    id: "1",
    severity: "P1",
    title: "Order Flow Feed Latency Spike",
    status: "investigating",
    opened: "2025-04-20 13:45:22",
    resolved: null,
    duration: "47 minutes",
  },
  {
    id: "2",
    severity: "P2",
    title: "Database Query Performance Degradation",
    status: "investigating",
    opened: "2025-04-20 12:15:08",
    resolved: null,
    duration: "1h 17m",
  },
  {
    id: "3",
    severity: "P2",
    title: "TradingView WebSocket Reconnection Issues",
    status: "resolved",
    opened: "2025-04-20 09:30:15",
    resolved: "2025-04-20 11:22:44",
    duration: "1h 52m",
  },
  {
    id: "4",
    severity: "P3",
    title: "High Memory Usage in API Server",
    status: "resolved",
    opened: "2025-04-19 22:15:30",
    resolved: "2025-04-19 23:45:22",
    duration: "1h 30m",
  },
  {
    id: "5",
    severity: "P4",
    title: "News API Rate Limit Warning",
    status: "resolved",
    opened: "2025-04-18 14:30:00",
    resolved: "2025-04-18 15:00:15",
    duration: "30m",
  },
];

export default function OpsIncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>(mockIncidents);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState({
    severity: "P3",
    title: "",
  });

  useEffect(() => {
    const fetchIncidents = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await api.ops.getIncidents?.();
        if (result) {
          setIncidents(result);
        }
      } catch (err) {
        console.error("Error fetching incidents:", err);
        setError("Failed to fetch incidents");
      } finally {
        setLoading(false);
      }
    };

    fetchIncidents();
  }, []);

  const handleCreateIncident = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) return;

    const newIncident: Incident = {
      id: String(incidents.length + 1),
      severity: formData.severity as "P1" | "P2" | "P3" | "P4",
      title: formData.title,
      status: "open",
      opened: new Date().toLocaleString(),
      resolved: null,
      duration: null,
    };

    setIncidents([newIncident, ...incidents]);
    setFormData({ severity: "P3", title: "" });
    setShowCreateForm(false);
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "P1":
        return "bg-red-500/20 text-red-300 border-red-500/30";
      case "P2":
        return "bg-orange-500/20 text-orange-300 border-orange-500/30";
      case "P3":
        return "bg-yellow-500/20 text-yellow-300 border-yellow-500/30";
      default:
        return "bg-blue-500/20 text-blue-300 border-blue-500/30";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "open":
        return "bg-red-500/20 text-red-300";
      case "investigating":
        return "bg-amber-500/20 text-amber-300";
      case "resolved":
        return "bg-green-500/20 text-green-300";
      default:
        return "bg-slate-500/20 text-slate-300";
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 pb-6">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-8 h-8 text-red-400" />
            <div>
              <h1 className="text-3xl font-bold text-white">Incident Log</h1>
              <p className="text-slate-400 text-sm">Track and manage operational incidents</p>
            </div>
          </div>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white font-semibold rounded-lg transition-all"
          >
            <Plus className="w-4 h-4" />
            Report Incident
          </button>
        </div>

        {/* Create Form */}
        {showCreateForm && (
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
            <form onSubmit={handleCreateIncident} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Severity
                </label>
                <select
                  value={formData.severity}
                  onChange={(e) =>
                    setFormData({ ...formData, severity: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white focus:outline-none focus:border-red-400"
                >
                  <option value="P1">P1 - Critical</option>
                  <option value="P2">P2 - High</option>
                  <option value="P3">P3 - Medium</option>
                  <option value="P4">P4 - Low</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Title
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) =>
                    setFormData({ ...formData, title: e.target.value })
                  }
                  placeholder="Incident description"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white placeholder-slate-500 focus:outline-none focus:border-red-400"
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="submit"
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded transition-colors"
                >
                  Create Incident
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {error && (
          <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4 flex items-center gap-2 text-red-300">
            <AlertCircle className="w-5 h-5" />
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-12">
            <p className="text-slate-400">Loading incidents...</p>
          </div>
        ) : (
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-700">
                  <tr className="text-slate-400 text-xs uppercase font-semibold">
                    <th className="text-left py-3 px-4">Severity</th>
                    <th className="text-left py-3 px-4">Title</th>
                    <th className="text-left py-3 px-4">Status</th>
                    <th className="text-left py-3 px-4">Opened</th>
                    <th className="text-left py-3 px-4">Resolved</th>
                    <th className="text-right py-3 px-4">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {incidents.map((incident) => (
                    <tr
                      key={incident.id}
                      className="border-b border-slate-800 hover:bg-slate-800/30 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-1 rounded text-xs font-bold border ${getSeverityColor(
                            incident.severity
                          )}`}
                        >
                          {incident.severity}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-white font-medium">
                        {incident.title}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold ${getStatusColor(
                            incident.status
                          )}`}
                        >
                          {incident.status === "resolved" && (
                            <CheckCircle className="w-3 h-3" />
                          )}
                          {incident.status === "open"
                            ? "Open"
                            : incident.status === "investigating"
                              ? "Investigating"
                              : "Resolved"}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-400">
                        {incident.opened}
                      </td>
                      <td className="py-3 px-4 text-slate-400">
                        {incident.resolved || "-"}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {incident.duration && (
                          <span className="font-semibold text-slate-300 flex items-center justify-end gap-1">
                            <Clock className="w-3 h-3" />
                            {incident.duration}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {incidents.length === 0 && (
              <div className="text-center py-8 text-slate-400">
                <p>No incidents recorded</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
