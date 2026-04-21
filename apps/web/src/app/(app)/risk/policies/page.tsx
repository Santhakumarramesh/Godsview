"use client";

import { useState } from "react";
import { Shield, AlertTriangle, TrendingDown, Lock, Plus, MoreVertical } from "lucide-react";

interface RiskPolicy {
  id: string;
  name: string;
  type: string;
  threshold: string;
  action: string;
  status: "active" | "paused";
  current: string;
  utilization: number;
}

const mockPolicies: RiskPolicy[] = [
  {
    id: "POL-001",
    name: "Max Daily Loss",
    type: "Daily Loss Limit",
    threshold: "-$2,500",
    action: "Flatten All & Pause",
    status: "active",
    current: "-$480",
    utilization: 19,
  },
  {
    id: "POL-002",
    name: "Max Positions",
    type: "Position Count",
    threshold: "10 positions",
    action: "Reject New Entries",
    status: "active",
    current: "6 positions",
    utilization: 60,
  },
  {
    id: "POL-003",
    name: "Max Exposure",
    type: "Gross Exposure",
    threshold: "$500K",
    action: "Reduce Size by 50%",
    status: "active",
    current: "$385K",
    utilization: 77,
  },
  {
    id: "POL-004",
    name: "Min Risk/Reward",
    type: "Trade Ratio",
    threshold: "1:2 or better",
    action: "Skip Trade",
    status: "active",
    current: "1:2.5 (compliant)",
    utilization: 0,
  },
  {
    id: "POL-005",
    name: "Max Correlation",
    type: "Portfolio Beta",
    threshold: "< 0.75",
    action: "Warn & Hedge",
    status: "active",
    current: "0.62",
    utilization: 83,
  },
  {
    id: "POL-006",
    name: "Drawdown Limit",
    type: "Max Peak Drawdown",
    threshold: "-12%",
    action: "Reduce Risk by 25%",
    status: "paused",
    current: "-5.2%",
    utilization: 43,
  },
  {
    id: "POL-007",
    name: "Max Win Streak",
    type: "Behavioral Control",
    threshold: "5 consecutive wins",
    action: "Force Profit Lock",
    status: "active",
    current: "3 wins",
    utilization: 60,
  },
  {
    id: "POL-008",
    name: "Session Duration",
    type: "Time-Based",
    threshold: "6 hours max",
    action: "Flatten All",
    status: "active",
    current: "2h 34m",
    utilization: 42,
  },
];

export default function RiskPolicyCenterPage() {
  const [policies, setPolicies] = useState(mockPolicies);
  const [expandedPolicy, setExpandedPolicy] = useState<string | null>(null);

  const handleTogglePolicy = (policyId: string) => {
    setPolicies(
      policies.map((policy) =>
        policy.id === policyId
          ? { ...policy, status: policy.status === "active" ? "paused" : "active" }
          : policy
      )
    );
  };

  const activePolicies = policies.filter((p) => p.status === "active").length;
  const totalRisk = policies.reduce((sum, p) => sum + p.utilization, 0) / policies.length;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 pb-6">
          <div className="flex items-center gap-3">
            <Shield className="w-8 h-8 text-red-400" />
            <div>
              <h1 className="text-3xl font-bold text-white">Risk Policy Center</h1>
              <p className="text-slate-400 text-sm">Configure and monitor trading risk constraints</p>
            </div>
          </div>
          <button className="px-4 py-2 rounded bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white font-semibold flex items-center gap-2 transition-all">
            <Plus className="w-4 h-4" />
            Add Policy
          </button>
        </div>

        {/* Risk State Summary */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
            <p className="text-slate-400 text-xs font-medium uppercase mb-2">Active Policies</p>
            <p className="text-3xl font-bold text-white">{activePolicies}</p>
            <p className="text-slate-500 text-xs mt-1">of {policies.length} total</p>
          </div>
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
            <p className="text-slate-400 text-xs font-medium uppercase mb-2">Overall Risk</p>
            <p className={`text-3xl font-bold ${totalRisk > 75 ? "text-red-400" : totalRisk > 50 ? "text-amber-400" : "text-green-400"}`}>
              {Math.round(totalRisk)}%
            </p>
            <p className="text-slate-500 text-xs mt-1">Average utilization</p>
          </div>
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
            <p className="text-slate-400 text-xs font-medium uppercase mb-2">Daily P&L</p>
            <p className="text-3xl font-bold text-white">-$480</p>
            <p className="text-red-400 text-xs mt-1">19% of max loss limit</p>
          </div>
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
            <p className="text-slate-400 text-xs font-medium uppercase mb-2">Violations</p>
            <p className="text-3xl font-bold text-green-400">0</p>
            <p className="text-slate-500 text-xs mt-1">All policies compliant</p>
          </div>
        </div>

        {/* Risk Policies Table */}
        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Configured Policies</h2>
          <div className="space-y-3">
            {policies.map((policy) => {
              const isHighRisk = policy.utilization > 80;
              const isWarning = policy.utilization > 60;

              return (
                <div key={policy.id}>
                  <div
                    className={`flex items-center justify-between bg-slate-800/30 border rounded p-4 hover:border-slate-600 transition-all cursor-pointer ${
                      policy.status === "paused"
                        ? "border-slate-700 opacity-60"
                        : isHighRisk
                          ? "border-red-500/50"
                          : isWarning
                            ? "border-amber-500/50"
                            : "border-slate-700"
                    }`}
                    onClick={() =>
                      setExpandedPolicy(
                        expandedPolicy === policy.id ? null : policy.id
                      )
                    }
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <p className="font-semibold text-white">{policy.name}</p>
                        <span className="text-xs text-slate-400 font-mono">{policy.id}</span>
                        {isHighRisk && (
                          <AlertTriangle className="w-4 h-4 text-red-400" />
                        )}
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <p className="text-slate-400 text-xs uppercase mb-1">Type</p>
                          <p className="text-slate-300">{policy.type}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 text-xs uppercase mb-1">Threshold</p>
                          <p className="text-slate-300">{policy.threshold}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 text-xs uppercase mb-1">Action</p>
                          <p className="text-slate-300">{policy.action}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 text-xs uppercase mb-1">Current</p>
                          <p className="text-slate-300">{policy.current}</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 flex-shrink-0">
                      <div className="text-right">
                        <p className="text-xs text-slate-400 mb-1">Utilization</p>
                        <div className="w-32 h-6 bg-slate-700 rounded overflow-hidden">
                          <div
                            className={`h-full transition-all ${
                              policy.utilization > 80
                                ? "bg-red-500"
                                : policy.utilization > 60
                                  ? "bg-amber-500"
                                  : "bg-green-500"
                            }`}
                            style={{ width: `${policy.utilization}%` }}
                          />
                        </div>
                        <p
                          className={`text-xs font-semibold mt-1 ${
                            policy.utilization > 80
                              ? "text-red-400"
                              : policy.utilization > 60
                                ? "text-amber-400"
                                : "text-green-400"
                          }`}
                        >
                          {policy.utilization}%
                        </p>
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={policy.status === "active"}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleTogglePolicy(policy.id);
                          }}
                          className="w-5 h-5 rounded border-slate-600 bg-slate-800 cursor-pointer"
                        />
                        <span className={`text-sm font-semibold ${
                          policy.status === "active"
                            ? "text-green-400"
                            : "text-slate-400"
                        }`}>
                          {policy.status === "active" ? "Active" : "Paused"}
                        </span>
                      </label>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                        className="p-2 hover:bg-slate-700 rounded transition-all"
                      >
                        <MoreVertical className="w-4 h-4 text-slate-400" />
                      </button>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {expandedPolicy === policy.id && (
                    <div className="bg-slate-800/20 border-x border-b border-slate-700 p-4 text-sm text-slate-300">
                      <p>
                        <span className="font-semibold text-white">Description:</span> {policy.name} enforces a {policy.threshold} limit on {policy.type.toLowerCase()}.
                        When this threshold is breached, the system will automatically {policy.action.toLowerCase()}.
                        Current utilization is {policy.utilization}% of the limit.
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Risk Monitoring Info */}
        <div className="bg-gradient-to-r from-amber-500/10 to-red-500/10 border border-amber-500/50 rounded-lg p-6">
          <div className="flex items-start gap-4">
            <AlertTriangle className="w-6 h-6 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-white mb-2">Risk Monitoring Active</h3>
              <p className="text-slate-300 text-sm">
                All risk policies are being monitored in real-time. If any policy is violated, the system will
                automatically execute the specified action. No trades will be executed that violate configured risk
                parameters. Review and adjust policies regularly based on market conditions.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
