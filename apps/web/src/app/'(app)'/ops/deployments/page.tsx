"use client";

import { useState, useEffect } from "react";
import { Zap, AlertCircle, RotateCcw, Check, X } from "lucide-react";
import { api } from "@/lib/api";

interface Deployment {
  id: string;
  version: string;
  environment: "production" | "staging" | "development";
  status: "success" | "failed" | "rolling-back" | "rolled-back";
  deployedBy: string;
  timestamp: string;
  duration: string;
}

const mockDeployments: Deployment[] = [
  {
    id: "1",
    version: "v2.4.1",
    environment: "production",
    status: "success",
    deployedBy: "automation",
    timestamp: "2025-04-20 14:32:15",
    duration: "4m 23s",
  },
  {
    id: "2",
    version: "v2.4.0",
    environment: "production",
    status: "success",
    deployedBy: "sarah.ops@godsview.io",
    timestamp: "2025-04-20 09:15:42",
    duration: "5m 12s",
  },
  {
    id: "3",
    version: "v2.3.9",
    environment: "staging",
    status: "success",
    deployedBy: "automation",
    timestamp: "2025-04-19 22:45:30",
    duration: "3m 58s",
  },
  {
    id: "4",
    version: "v2.3.8",
    environment: "production",
    status: "rolled-back",
    deployedBy: "mike.eng@godsview.io",
    timestamp: "2025-04-19 18:20:15",
    duration: "2m 45s",
  },
  {
    id: "5",
    version: "v2.3.7",
    environment: "development",
    status: "success",
    deployedBy: "automation",
    timestamp: "2025-04-18 15:30:00",
    duration: "6m 10s",
  },
];

export default function OpsDeploymentsPage() {
  const [deployments, setDeployments] = useState<Deployment[]>(mockDeployments);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rollingBackId, setRollingBackId] = useState<string | null>(null);

  useEffect(() => {
    const fetchDeployments = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await api.ops.getDeployments?.();
        if (result) {
          setDeployments(result);
        }
      } catch (err) {
        console.error("Error fetching deployments:", err);
        setError("Failed to fetch deployments");
      } finally {
        setLoading(false);
      }
    };

    fetchDeployments();
  }, []);

  const handleRollback = (deploymentId: string) => {
    setRollingBackId(deploymentId);
    setTimeout(() => {
      setDeployments(
        deployments.map((d) =>
          d.id === deploymentId ? { ...d, status: "rolled-back" } : d
        )
      );
      setRollingBackId(null);
    }, 1500);
  };

  const statusConfig = {
    success: { bg: "bg-green-500/20", text: "text-green-300", icon: Check },
    failed: { bg: "bg-red-500/20", text: "text-red-300", icon: X },
    "rolling-back": { bg: "bg-amber-500/20", text: "text-amber-300", icon: RotateCcw },
    "rolled-back": { bg: "bg-slate-500/20", text: "text-slate-300", icon: RotateCcw },
  };

  const envBgMap = {
    production: "border-red-500/30 bg-red-500/5",
    staging: "border-yellow-500/30 bg-yellow-500/5",
    development: "border-blue-500/30 bg-blue-500/5",
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 pb-6">
          <div className="flex items-center gap-3">
            <Zap className="w-8 h-8 text-yellow-400" />
            <div>
              <h1 className="text-3xl font-bold text-white">Deployment History</h1>
              <p className="text-slate-400 text-sm">Track all service deployments across environments</p>
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
            <p className="text-slate-400">Loading deployments...</p>
          </div>
        ) : (
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-700">
                  <tr className="text-slate-400 text-xs uppercase font-semibold">
                    <th className="text-left py-3 px-4">Version</th>
                    <th className="text-left py-3 px-4">Environment</th>
                    <th className="text-left py-3 px-4">Status</th>
                    <th className="text-left py-3 px-4">Deployed By</th>
                    <th className="text-left py-3 px-4">Timestamp</th>
                    <th className="text-right py-3 px-4">Duration</th>
                    <th className="text-right py-3 px-4">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {deployments.map((deployment) => {
                    const statusInfo = statusConfig[deployment.status];
                    const StatusIcon = statusInfo.icon;

                    return (
                      <tr
                        key={deployment.id}
                        className={`border-b border-slate-800 hover:bg-slate-800/30 transition-colors ${
                          envBgMap[deployment.environment]
                        } border-l-4`}
                      >
                        <td className="py-3 px-4">
                          <span className="font-semibold text-white">{deployment.version}</span>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-3 py-1 rounded text-xs font-semibold ${
                              deployment.environment === "production"
                                ? "bg-red-500/30 text-red-300"
                                : deployment.environment === "staging"
                                  ? "bg-yellow-500/30 text-yellow-300"
                                  : "bg-blue-500/30 text-blue-300"
                            }`}
                          >
                            {deployment.environment.charAt(0).toUpperCase() +
                              deployment.environment.slice(1)}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold ${
                              statusInfo.bg
                            } ${statusInfo.text}`}
                          >
                            <StatusIcon className="w-3 h-3" />
                            {deployment.status === "rolling-back"
                              ? "Rolling Back..."
                              : deployment.status === "rolled-back"
                                ? "Rolled Back"
                                : deployment.status === "success"
                                  ? "Success"
                                  : "Failed"}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-300">
                          {deployment.deployedBy === "automation" ? (
                            <span className="text-amber-400">Automation</span>
                          ) : (
                            deployment.deployedBy
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-400">
                          {deployment.timestamp}
                        </td>
                        <td className="py-3 px-4 text-right font-semibold text-white">
                          {deployment.duration}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {deployment.status === "success" && (
                            <button
                              onClick={() => handleRollback(deployment.id)}
                              disabled={rollingBackId === deployment.id}
                              className="px-3 py-1 rounded text-xs font-semibold bg-red-500/20 text-red-300 hover:bg-red-500/30 disabled:opacity-50 transition-colors"
                            >
                              {rollingBackId === deployment.id ? "Rolling..." : "Rollback"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {deployments.length === 0 && (
              <div className="text-center py-8 text-slate-400">
                <p>No deployments found</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
