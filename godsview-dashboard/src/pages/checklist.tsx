/**
 * checklist.tsx — Checklist Dashboard
 *
 * Trading checklist evaluation page:
 * - Symbol input and auto-evaluate button
 * - Checklist items as toggle cards (check/X)
 * - Overall score as percentage bar
 * - PASSED/BLOCKED status badge
 * - Blocked reasons list
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle, XCircle } from "lucide-react";

interface ChecklistItem {
  name: string;
  passed: boolean;
  description: string;
}

interface ChecklistEvaluation {
  symbol: string;
  score: number; // 0-1
  status: "PASSED" | "BLOCKED";
  checklist: ChecklistItem[];
  blocked_reasons: string[];
  timestamp: string;
}

export default function Checklist() {
  const [symbol, setSymbol] = useState("");
  const [evaluated, setEvaluated] = useState<ChecklistEvaluation | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);

  const handleAutoEvaluate = async () => {
    if (!symbol.trim()) return;

    setIsEvaluating(true);
    try {
      const res = await fetch(`/api/checklist/auto/${symbol.toUpperCase()}`, {
        method: "POST",
      });
      if (res.ok) {
        const data = (await res.json()) as ChecklistEvaluation;
        setEvaluated(data);
      }
    } catch (error) {
      console.error("Evaluation error:", error);
    } finally {
      setIsEvaluating(false);
    }
  };

  const statusConfig = {
    PASSED: {
      bg: "bg-emerald-500/10",
      border: "border-emerald-400/40",
      text: "text-emerald-200",
      icon: CheckCircle,
      label: "PASSED",
    },
    BLOCKED: {
      bg: "bg-red-500/10",
      border: "border-red-400/40",
      text: "text-red-200",
      icon: XCircle,
      label: "BLOCKED",
    },
  };

  const currentStatusConfig = evaluated ? statusConfig[evaluated.status] : null;
  const StatusIcon = currentStatusConfig?.icon;

  return (
    <div className="min-h-screen bg-[#0a0a1a] text-white">
      <div className="max-w-6xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-4xl font-bold mb-2">Checklist</h1>
          <p className="text-gray-400">Pre-Trade Validation</p>
        </div>

        {/* Input Section */}
        <div className="mb-8 flex gap-3">
          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAutoEvaluate()}
            placeholder="Enter symbol (e.g., AAPL, BTC)"
            className="flex-1 px-4 py-3 bg-[#1a1a2e] border border-cyan-500/30 rounded text-white placeholder-gray-500 focus:outline-none focus:border-cyan-400"
          />
          <button
            onClick={handleAutoEvaluate}
            disabled={isEvaluating || !symbol.trim()}
            className="px-6 py-3 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 rounded font-medium transition-colors"
          >
            {isEvaluating ? "Evaluating..." : "Auto Evaluate"}
          </button>
        </div>

        {/* Evaluation Results */}
        {evaluated && currentStatusConfig && (
          <div className="space-y-8">
            {/* Status Card */}
            <div
              className={`${currentStatusConfig.bg} border ${currentStatusConfig.border} rounded-lg p-8`}
            >
              <div className="flex items-center gap-4 mb-4">
                {StatusIcon && (
                  <StatusIcon className={`w-8 h-8 ${currentStatusConfig.text}`} />
                )}
                <div>
                  <div className={`text-sm font-semibold ${currentStatusConfig.text}`}>
                    STATUS
                  </div>
                  <div className={`text-3xl font-bold ${currentStatusConfig.text}`}>
                    {currentStatusConfig.label}
                  </div>
                </div>
              </div>
              <div className="text-gray-300 text-sm">
                {evaluated.symbol} — {new Date(evaluated.timestamp).toLocaleString()}
              </div>
            </div>

            {/* Score Bar */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-lg font-semibold">Overall Score</span>
                <span className="text-2xl font-bold text-cyan-400">
                  {Math.round(evaluated.score * 100)}%
                </span>
              </div>
              <div className="w-full h-3 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all"
                  style={{ width: `${evaluated.score * 100}%` }}
                />
              </div>
            </div>

            {/* Checklist Items */}
            <div>
              <h2 className="text-xl font-semibold mb-6">Checklist Items</h2>
              <div className="space-y-3">
                {(evaluated.checklist ?? []).map((item) => (
                  <div
                    key={item.name}
                    className={`border rounded-lg p-4 flex gap-4 items-start ${
                      item.passed
                        ? "bg-emerald-500/10 border-emerald-400/40"
                        : "bg-red-500/10 border-red-400/40"
                    }`}
                  >
                    <div className="flex-shrink-0 mt-1">
                      {item.passed ? (
                        <CheckCircle className="w-5 h-5 text-emerald-400" />
                      ) : (
                        <XCircle className="w-5 h-5 text-red-400" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="font-semibold text-gray-200">{item.name}</div>
                      <div className="text-sm text-gray-400 mt-1">{item.description}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Blocked Reasons */}
            {(evaluated.blocked_reasons ?? []).length > 0 && (
              <div>
                <h2 className="text-xl font-semibold mb-4 text-red-300">Blocked Reasons</h2>
                <div className="space-y-2">
                  {(evaluated.blocked_reasons ?? []).map((reason, idx) => (
                    <div
                      key={idx}
                      className="bg-red-500/10 border border-red-400/40 rounded-lg p-4 text-red-200 flex gap-2"
                    >
                      <span className="text-red-400 font-bold">•</span>
                      <span>{reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {!evaluated && (
          <div className="text-center py-16 text-gray-400">
            <p>Enter a symbol and click Auto Evaluate to run the pre-trade checklist</p>
          </div>
        )}
      </div>
    </div>
  );
}
