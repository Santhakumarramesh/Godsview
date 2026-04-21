"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface Decision {
  id: string;
  timestamp: string;
  type: "ENTRY" | "EXIT" | "ADJUSTMENT" | "RISK_CHECK";
  context: string;
  outcome: "EXECUTED" | "REJECTED" | "PENDING";
  signals: string[];
  reasoning: string;
}

const mockDecisions: Decision[] = [
  {
    id: "1",
    timestamp: "2024-04-20 14:30:00",
    type: "ENTRY",
    context: "AAPL at resistance, RSI < 30",
    outcome: "EXECUTED",
    signals: ["RSI Oversold", "Volume Spike", "Support Bounce"],
    reasoning: "Mean reversion signal triggered with confluence from three indicators",
  },
  {
    id: "2",
    timestamp: "2024-04-20 15:15:00",
    type: "RISK_CHECK",
    context: "Position size validation",
    outcome: "EXECUTED",
    signals: ["Volatility OK", "Correlation Check", "Drawdown Monitor"],
    reasoning: "Risk checks passed: position within limits, drawdown threshold safe",
  },
  {
    id: "3",
    timestamp: "2024-04-20 16:45:00",
    type: "EXIT",
    context: "Take profit target reached",
    outcome: "EXECUTED",
    signals: ["Target Price Hit", "Trend Reversal", "Profit Lock"],
    reasoning: "Exit signal: +2% profit target achieved with lower conviction",
  },
  {
    id: "4",
    timestamp: "2024-04-20 13:20:00",
    type: "ENTRY",
    context: "MSFT momentum setup",
    outcome: "REJECTED",
    signals: ["MACD Positive", "High Slippage", "Low Liquidity"],
    reasoning: "Entry rejected: market hours but spread widened, risk/reward unfavorable",
  },
];

export default function DecisionReplayPage() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDecision, setSelectedDecision] = useState<Decision | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const fetchDecisions = async () => {
      try {
        setLoading(true);
        try {
          await api.memory.getRecentSignals?.();
        } catch {
          // Fallback
        }
        setDecisions(mockDecisions);
        if (mockDecisions.length > 0) {
          setSelectedDecision(mockDecisions[0]);
        }
      } catch (err) {
        setError((err as Error).message || "Failed to load decision log");
        setDecisions(mockDecisions);
      } finally {
        setLoading(false);
      }
    };

    fetchDecisions();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-slate-400">Loading decision replay...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400">
        {error}
      </div>
    );
  }

  const typeColors = {
    ENTRY: "bg-green-500/20 text-green-400",
    EXIT: "bg-red-500/20 text-red-400",
    ADJUSTMENT: "bg-blue-500/20 text-blue-400",
    RISK_CHECK: "bg-purple-500/20 text-purple-400",
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-slate-100">Decision Replay Center</h1>
        <p className="mt-1 text-sm text-slate-400">
          Timeline of all trading decisions with full reasoning and signal analysis
        </p>
      </header>

      {/* Timeline View */}
      <div className="space-y-3">
        {decisions.map((decision) => (
          <div key={decision.id}>
            <button
              onClick={() => setExpandedId(expandedId === decision.id ? null : decision.id)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 p-4 text-left hover:border-slate-600 transition"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-4 flex-1">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className={`rounded px-2 py-1 text-xs font-semibold ${typeColors[decision.type]}`}>
                        {decision.type}
                      </span>
                      <span className="text-sm text-slate-400">{decision.timestamp}</span>
                    </div>
                    <p className="font-medium text-slate-100">{decision.context}</p>
                  </div>
                  <div className="text-right">
                    <span
                      className={`inline-block rounded px-2 py-1 text-xs font-semibold ${
                        decision.outcome === "EXECUTED"
                          ? "bg-green-500/20 text-green-400"
                          : decision.outcome === "REJECTED"
                            ? "bg-red-500/20 text-red-400"
                            : "bg-yellow-500/20 text-yellow-400"
                      }`}
                    >
                      {decision.outcome}
                    </span>
                  </div>
                </div>
                <span className="ml-2 text-slate-400">
                  {expandedId === decision.id ? "▼" : "▶"}
                </span>
              </div>
            </button>

            {/* Expanded Details */}
            {expandedId === decision.id && (
              <div className="mt-2 rounded-lg border border-slate-700 bg-slate-800 p-4 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100 mb-2">Decision Reasoning</h3>
                  <p className="text-sm text-slate-400">{decision.reasoning}</p>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-slate-100 mb-2">Signals</h3>
                  <div className="flex flex-wrap gap-2">
                    {decision.signals.map((signal, idx) => (
                      <span
                        key={idx}
                        className="rounded-full bg-slate-700 px-3 py-1 text-xs text-slate-300"
                      >
                        {signal}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 pt-4 border-t border-slate-700">
                  <div>
                    <p className="text-xs text-slate-400">Risk Level</p>
                    <p className="text-sm font-mono text-slate-100">Medium</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Conviction</p>
                    <p className="text-sm font-mono text-slate-100">8.5/10</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Latency</p>
                    <p className="text-sm font-mono text-slate-100">12ms</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Decision Summary */}
      <div className="rounded-lg border border-slate-700 bg-slate-900 p-6">
        <h2 className="mb-4 text-lg font-semibold text-slate-100">Decision Summary</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <SummaryItem label="Total Decisions" value={decisions.length.toString()} />
          <SummaryItem
            label="Executed"
            value={decisions.filter((d) => d.outcome === "EXECUTED").length.toString()}
            color="green"
          />
          <SummaryItem
            label="Rejected"
            value={decisions.filter((d) => d.outcome === "REJECTED").length.toString()}
            color="red"
          />
          <SummaryItem
            label="Success Rate"
            value={((decisions.filter((d) => d.outcome === "EXECUTED").length / decisions.length) * 100).toFixed(0) + "%"}
            color="blue"
          />
        </div>
      </div>
    </div>
  );
}

function SummaryItem({ label, value, color = "slate" }: { label: string; value: string; color?: string }) {
  const colorClasses = {
    slate: "text-slate-300",
    green: "text-green-400",
    red: "text-red-400",
    blue: "text-blue-400",
  };

  return (
    <div>
      <p className="text-xs text-slate-400 uppercase">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${colorClasses[color as keyof typeof colorClasses]}`}>
        {value}
      </p>
    </div>
  );
}
