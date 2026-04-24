"use client";

import { useState } from "react";
import { TrendingDown, AlertTriangle, Lock } from "lucide-react";

interface DrawdownLevel {
  period: "daily" | "weekly" | "monthly";
  current: number;
  threshold: number;
  status: "safe" | "warning" | "critical";
}

interface AutoDerisking {
  trigger: string;
  action: string;
  enabled: boolean;
}

const mockDrawdownLevels: DrawdownLevel[] = [
  {
    period: "daily",
    current: -2.1,
    threshold: -5,
    status: "safe",
  },
  {
    period: "weekly",
    current: -4.8,
    threshold: -8,
    status: "safe",
  },
  {
    period: "monthly",
    current: -7.2,
    threshold: -15,
    status: "safe",
  },
];

const autoDerisks: AutoDerisking[] = [
  {
    trigger: "At -2% daily",
    action: "Reduce position sizes 50%",
    enabled: true,
  },
  {
    trigger: "At -5% weekly",
    action: "Flatten all positions",
    enabled: true,
  },
  {
    trigger: "At -10% monthly",
    action: "Enter full defensive mode",
    enabled: false,
  },
];

const drawdownHistory = [
  { date: "04-20", value: -2.1 },
  { date: "04-19", value: -1.8 },
  { date: "04-18", value: -3.2 },
  { date: "04-17", value: -2.9 },
  { date: "04-16", value: -1.5 },
  { date: "04-15", value: -4.8 },
  { date: "04-14", value: -4.2 },
  { date: "04-13", value: -3.6 },
];

export default function DrawdownPage() {
  const [activeRestrictions, setActiveRestrictions] = useState([
    "Position size limit: -1.5%",
    "Stop loss on all trades",
  ]);

  const currentDrawdown = -2.1;
  const maxDrawdown = Math.min(...drawdownHistory.map((d) => d.value));

  const getStatus = (current: number, threshold: number) => {
    if (current <= threshold * 1.2) return "critical";
    if (current <= threshold * 0.7) return "warning";
    return "safe";
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "critical":
        return "bg-red-500/20 text-red-300 border-red-500/30";
      case "warning":
        return "bg-amber-500/20 text-amber-300 border-amber-500/30";
      default:
        return "bg-green-500/20 text-green-300 border-green-500/30";
    }
  };

  const getBarColor = (status: string) => {
    switch (status) {
      case "critical":
        return "from-red-500 to-red-400";
      case "warning":
        return "from-amber-500 to-amber-400";
      default:
        return "from-green-500 to-green-400";
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 pb-6">
          <div className="flex items-center gap-3">
            <TrendingDown className="w-8 h-8 text-amber-400" />
            <div>
              <h1 className="text-3xl font-bold text-white">Drawdown Protection</h1>
              <p className="text-slate-400 text-sm">Risk management and auto-derisking rules</p>
            </div>
          </div>
        </div>

        {/* Current Drawdown Gauge */}
        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-8">
          <h2 className="text-lg font-semibold text-white mb-6">Current Drawdown</h2>

          <div className="flex items-center gap-8">
            <div className="flex-1">
              {/* Large Gauge */}
              <div className="relative h-48 bg-gradient-to-b from-slate-800 to-slate-900 border border-slate-700 rounded-lg flex items-center justify-center mb-4">
                <div className="text-center">
                  <p className="text-6xl font-bold text-red-400">{currentDrawdown.toFixed(1)}%</p>
                  <p className="text-slate-400 text-sm mt-2">From Peak Equity</p>
                </div>

                {/* Gauge Arc Background */}
                <div className="absolute inset-0 rounded-lg overflow-hidden opacity-20">
                  <div className="absolute inset-0 bg-gradient-to-r from-green-500 via-amber-500 to-red-500" />
                </div>
              </div>

              {/* Progress Bar */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>0%</span>
                  <span>-20%</span>
                </div>
                <div className="w-full bg-slate-700 rounded-full h-4">
                  <div
                    className="bg-gradient-to-r from-red-500 to-red-400 h-4 rounded-full relative"
                    style={{ width: `${Math.abs(currentDrawdown / 20) * 100}%` }}
                  >
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 -translate-x-2 w-1 h-6 bg-white rounded-full shadow-lg" />
                  </div>
                </div>
              </div>
            </div>

            {/* Summary Stats */}
            <div className="space-y-4">
              <div className="bg-slate-800/50 border border-slate-600 rounded p-4">
                <p className="text-xs font-semibold text-slate-400 uppercase mb-1">
                  Max Drawdown (Month)
                </p>
                <p className="text-2xl font-bold text-red-400">{maxDrawdown.toFixed(1)}%</p>
              </div>
              <div className="bg-slate-800/50 border border-slate-600 rounded p-4">
                <p className="text-xs font-semibold text-slate-400 uppercase mb-1">
                  Safe Limit
                </p>
                <p className="text-2xl font-bold text-green-400">-5%</p>
              </div>
              <div className="bg-slate-800/50 border border-slate-600 rounded p-4">
                <p className="text-xs font-semibold text-slate-400 uppercase mb-1">
                  Critical Limit
                </p>
                <p className="text-2xl font-bold text-red-400">-15%</p>
              </div>
            </div>
          </div>
        </div>

        {/* Drawdown Levels */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {mockDrawdownLevels.map((level) => {
            const status = getStatus(level.current, level.threshold);
            return (
              <div
                key={level.period}
                className={`border rounded-lg p-6 ${getStatusColor(status)}`}
              >
                <h3 className="text-sm font-semibold uppercase mb-3 text-slate-300">
                  {level.period} Drawdown
                </h3>

                <div className="mb-4">
                  <div className="flex justify-between items-baseline mb-2">
                    <p className="text-3xl font-bold text-white">{level.current.toFixed(1)}%</p>
                    <p className="text-xs text-slate-400">Threshold: {level.threshold}%</p>
                  </div>
                </div>

                <div className="w-full bg-slate-700 rounded-full h-2 mb-2">
                  <div
                    className={`bg-gradient-to-r ${getBarColor(status)} h-2 rounded-full`}
                    style={{
                      width: `${Math.abs(level.current / level.threshold) * 100}%`,
                    }}
                  />
                </div>

                <p className={`text-xs font-semibold ${
                  status === "critical" ? "text-red-300" :
                  status === "warning" ? "text-amber-300" :
                  "text-green-300"
                }`}>
                  {status === "critical" ? "CRITICAL" :
                   status === "warning" ? "WARNING" :
                   "SAFE"}
                </p>
              </div>
            );
          })}
        </div>

        {/* Drawdown History */}
        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-6">Drawdown History (7 Days)</h2>

          <div className="flex items-end justify-between h-40 gap-1 px-4 mb-4">
            {drawdownHistory.map((point, idx) => {
              const absValue = Math.abs(point.value);
              const normalized = absValue / 5; // normalize to 5% max
              return (
                <div
                  key={idx}
                  className="flex-1 flex flex-col items-center gap-2 group"
                >
                  <div
                    className="w-full bg-gradient-to-t from-red-500 to-red-400 rounded-t opacity-80 hover:opacity-100 transition-opacity cursor-pointer"
                    style={{ height: `${Math.min(normalized * 100, 100)}%` }}
                    title={`${point.date}: ${point.value.toFixed(1)}%`}
                  />
                </div>
              );
            })}
          </div>

          <div className="flex justify-between px-4 text-xs text-slate-400">
            {drawdownHistory.map((point) => (
              <span key={point.date}>{point.date}</span>
            ))}
          </div>
        </div>

        {/* Auto-Derisking Rules */}
        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-6">Auto-Derisking Rules</h2>

          <div className="space-y-3">
            {autoDerisks.map((rule, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-4 bg-slate-800/30 border border-slate-700 rounded hover:border-slate-600 transition-all"
              >
                <div className="flex-1">
                  <h3 className="font-semibold text-white mb-1">{rule.trigger}</h3>
                  <p className="text-sm text-slate-400">{rule.action}</p>
                </div>

                <div className="flex items-center gap-3 ml-4">
                  <div
                    className={`w-12 h-6 rounded-full transition-all ${
                      rule.enabled ? "bg-green-500/30" : "bg-slate-700/50"
                    } flex items-center`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full transition-all ${
                        rule.enabled ? "bg-green-400 ml-auto mr-0.5" : "bg-slate-500 ml-0.5"
                      }`}
                    />
                  </div>
                  <span className="text-xs font-semibold text-slate-400">
                    {rule.enabled ? "ON" : "OFF"}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-slate-400 mt-4 pt-4 border-t border-slate-700">
            Auto-derisking rules execute automatically when trigger conditions are met
          </p>
        </div>

        {/* Active Restrictions */}
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-6">
          <div className="flex items-start gap-4 mb-4">
            <AlertTriangle className="w-6 h-6 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-lg font-semibold text-amber-300 mb-2">Active Restrictions</h3>
              <p className="text-amber-100 text-sm">
                Current drawdown has triggered position sizing restrictions
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {activeRestrictions.map((restriction, idx) => (
              <div
                key={idx}
                className="flex items-center gap-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded"
              >
                <Lock className="w-4 h-4 text-amber-400 flex-shrink-0" />
                <span className="text-sm text-amber-100">{restriction}</span>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-4 border-t border-amber-500/20">
            <button className="px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 rounded font-semibold text-sm transition-all">
              Override Restrictions
            </button>
          </div>
        </div>

        {/* Risk Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
            <p className="text-slate-400 text-xs font-medium uppercase mb-2">Recovery Needed</p>
            <p className="text-2xl font-bold text-white">
              {(Math.abs(currentDrawdown) / (100 + Math.abs(currentDrawdown)) * 100).toFixed(1)}%
            </p>
            <p className="text-xs text-slate-400 mt-1">Gain to return to peak</p>
          </div>
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
            <p className="text-slate-400 text-xs font-medium uppercase mb-2">Days in DD</p>
            <p className="text-2xl font-bold text-amber-400">7</p>
            <p className="text-xs text-slate-400 mt-1">Since peak equity</p>
          </div>
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
            <p className="text-slate-400 text-xs font-medium uppercase mb-2">Heat Level</p>
            <p className="text-2xl font-bold text-orange-400">Medium</p>
            <p className="text-xs text-slate-400 mt-1">Risk is elevated</p>
          </div>
        </div>
      </div>
    </div>
  );
}
