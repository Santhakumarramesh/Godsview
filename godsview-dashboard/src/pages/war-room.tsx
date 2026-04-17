/**
 * war-room.tsx — War Room Dashboard
 *
 * Multi-agent consensus analysis page showing:
 * - Symbol input and analysis button
 * - Verdict (approved/blocked/caution) with color coding
 * - Agent score progress bars
 * - Final reasoning text
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle, AlertTriangle } from "lucide-react";

interface WarRoomAnalysis {
  symbol: string;
  verdict: "approved" | "blocked" | "caution";
  agents: Array<{
    name: string;
    score: number; // 0-1
    confidence: number;
  }>;
  reasoning: string;
  timestamp: string;
}

export default function WarRoom() {
  const [symbol, setSymbol] = useState("");
  const [analyzed, setAnalyzed] = useState<WarRoomAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const handleAnalyze = async () => {
    if (!symbol.trim()) return;

    setIsAnalyzing(true);
    try {
      const res = await fetch(`/api/war-room/analyze/${symbol.toUpperCase()}`, { method: "POST" });
      if (res.ok) {
        const data = (await res.json()) as WarRoomAnalysis;
        setAnalyzed(data);
      }
    } catch (error) {
      console.error("Analysis error:", error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const verdictConfig = {
    approved: {
      bg: "bg-emerald-500/10",
      border: "border-emerald-400/40",
      text: "text-emerald-200",
      icon: CheckCircle,
      label: "APPROVED",
    },
    blocked: {
      bg: "bg-red-500/10",
      border: "border-red-400/40",
      text: "text-red-200",
      icon: AlertCircle,
      label: "BLOCKED",
    },
    caution: {
      bg: "bg-yellow-500/10",
      border: "border-yellow-400/40",
      text: "text-yellow-200",
      icon: AlertTriangle,
      label: "CAUTION",
    },
  };

  const currentVerdictConfig = analyzed ? verdictConfig[analyzed.verdict] : null;
  const VerdictIcon = currentVerdictConfig?.icon;

  return (
    <div className="min-h-screen bg-[#0a0a1a] text-white">
      <div className="max-w-6xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-4xl font-bold mb-2">War Room</h1>
          <p className="text-gray-400">Multi-Agent Consensus Analysis</p>
        </div>

        {/* Input Section */}
        <div className="mb-8 flex gap-3">
          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
            placeholder="Enter symbol (e.g., AAPL, BTC)"
            className="flex-1 px-4 py-3 bg-[#1a1a2e] border border-purple-500/30 rounded text-white placeholder-gray-500 focus:outline-none focus:border-purple-400"
          />
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing || !symbol.trim()}
            className="px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 rounded font-medium transition-colors"
          >
            {isAnalyzing ? "Analyzing..." : "Analyze"}
          </button>
        </div>

        {/* Analysis Results */}
        {analyzed && currentVerdictConfig && (
          <div className="space-y-8">
            {/* Verdict Card */}
            <div
              className={`${currentVerdictConfig.bg} border ${currentVerdictConfig.border} rounded-lg p-8`}
            >
              <div className="flex items-center gap-4 mb-4">
                {VerdictIcon && (
                  <VerdictIcon className={`w-8 h-8 ${currentVerdictConfig.text}`} />
                )}
                <div>
                  <div className={`text-sm font-semibold ${currentVerdictConfig.text}`}>
                    VERDICT
                  </div>
                  <div className={`text-3xl font-bold ${currentVerdictConfig.text}`}>
                    {currentVerdictConfig.label}
                  </div>
                </div>
              </div>
              <div className="text-gray-300 text-sm">
                {analyzed.symbol} — {new Date(analyzed.timestamp).toLocaleString()}
              </div>
            </div>

            {/* Agent Scores */}
            <div className="space-y-6">
              <h2 className="text-xl font-semibold">Agent Consensus</h2>
              {(analyzed.agents ?? []).map((agent) => (
                <div key={agent.name} className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-medium text-gray-300">{agent.name}</span>
                    <span className="text-sm text-gray-400">
                      {Math.round(agent.score * 100)}% (confidence: {Math.round(agent.confidence * 100)}%)
                    </span>
                  </div>
                  <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all"
                      style={{ width: `${agent.score * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Reasoning */}
            <div>
              <h2 className="text-xl font-semibold mb-4">Reasoning</h2>
              <div className="bg-gray-800/40 border border-gray-700 rounded-lg p-6 text-gray-300 leading-relaxed">
                {analyzed.reasoning}
              </div>
            </div>
          </div>
        )}

        {!analyzed && (
          <div className="text-center py-16 text-gray-400">
            <p>Enter a symbol and click Analyze to see multi-agent consensus</p>
          </div>
        )}
      </div>
    </div>
  );
}
