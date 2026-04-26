/**
 * war-room.tsx — War Room Dashboard
 *
 * Multi-agent consensus analysis page featuring:
 * - Real-time symbol analysis with loading states
 * - Verdict with color-coded confidence levels
 * - Agent consensus metrics with agreement scores
 * - Comprehensive reasoning and key insights
 * - Error handling and empty states
 */

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle, AlertTriangle, Loader } from "lucide-react";

interface WarRoomAnalysis {
  symbol: string;
  verdict: "approved" | "blocked" | "caution";
  agents: Array<{
    name: string;
    score: number;
    confidence: number;
  }>;
  reasoning: string;
  timestamp: string;
}

export default function WarRoom() {
  const [symbol, setSymbol] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzed, setAnalyzed] = useState<WarRoomAnalysis | null>(null);

  const handleAnalyze = async () => {
    if (!symbol.trim()) return;

    setIsAnalyzing(true);
    setError(null);

    try {
      const res = await fetch(`/api/war-room/analyze/${symbol.toUpperCase()}`, {
        method: "POST",
      });

      if (!res.ok) {
        if (res.status === 404) {
          setError(`Symbol "${symbol.toUpperCase()}" not found`);
        } else if (res.status === 429) {
          setError("Rate limited. Please try again in a moment.");
        } else {
          setError("Analysis failed. Please try again.");
        }
        setAnalyzed(null);
        return;
      }

      const data = (await res.json()) as WarRoomAnalysis;
      setAnalyzed(data);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error";
      setError(`Failed to connect: ${message}`);
      setAnalyzed(null);
      console.error("Analysis error:", err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Compute consensus metrics
  const metrics = useMemo(() => {
    if (!analyzed?.agents?.length) return null;

    const avgScore = analyzed.agents.reduce((sum, a) => sum + a.score, 0) / analyzed.agents.length;
    const avgConfidence = analyzed.agents.reduce((sum, a) => sum + a.confidence, 0) / analyzed.agents.length;
    const agreement = 1 - Math.max(...analyzed.agents.map(a => a.score)) + Math.min(...analyzed.agents.map(a => a.score));

    return {
      avgScore: Math.round(avgScore * 100),
      avgConfidence: Math.round(avgConfidence * 100),
      agentCount: analyzed.agents.length,
      agreement: Math.round(Math.max(0, Math.min(100, agreement * 100))),
    };
  }, [analyzed]);

  const verdictConfig = {
    approved: {
      bg: "bg-emerald-500/10",
      border: "border-emerald-400/40",
      text: "text-emerald-300",
      label: "APPROVED",
      icon: CheckCircle,
    },
    blocked: {
      bg: "bg-red-500/10",
      border: "border-red-400/40",
      text: "text-red-300",
      label: "BLOCKED",
      icon: AlertCircle,
    },
    caution: {
      bg: "bg-amber-500/10",
      border: "border-amber-400/40",
      text: "text-amber-300",
      label: "CAUTION",
      icon: AlertTriangle,
    },
  };

  const currentVerdictConfig = analyzed ? verdictConfig[analyzed.verdict] : null;
  const VerdictIcon = currentVerdictConfig?.icon as any;

  return (
    <div className="min-h-screen bg-[#0e0e0f] text-[#ffffff]">
      <div className="max-w-6xl mx-auto px-6 py-12">
        {/* Header Section */}
        <div className="mb-12">
          <h1 className="text-4xl font-bold mb-2" style={{ fontFamily: "Space Grotesk" }}>
            War Room
          </h1>
          <p className="text-[#767576]" style={{ fontFamily: "Space Grotesk" }}>
            Multi-agent consensus analysis for comprehensive investment intelligence
          </p>
        </div>

        {/* Input Section */}
        <div className="mb-8 flex gap-3">
          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !isAnalyzing && handleAnalyze()}
            placeholder="Enter symbol (e.g., AAPL, BTC)"
            disabled={isAnalyzing}
            className="flex-1 px-4 py-3 rounded border transition-colors"
            style={{
              background: "#1a191b",
              borderColor: "rgba(72,72,73,0.2)",
              color: "#ffffff",
            }}
          />
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing || !symbol.trim()}
            className="px-6 py-3 rounded font-medium transition-all duration-200"
            style={{
              background: "#9cff93",
              color: "#0e0e0f",
              opacity: isAnalyzing || !symbol.trim() ? 0.5 : 1,
              fontFamily: "Space Grotesk",
              cursor: isAnalyzing || !symbol.trim() ? "not-allowed" : "pointer",
            }}
          >
            {isAnalyzing ? (
              <span className="flex items-center gap-2">
                <Loader className="w-4 h-4 animate-spin" />
                Analyzing
              </span>
            ) : (
              "Analyze"
            )}
          </button>
        </div>

        {/* Error State */}
        {error && (
          <div
            className="mb-8 p-4 rounded border flex items-start gap-3"
            style={{
              background: "#ff6b6b",
              borderColor: "rgba(255,107,107,0.3)",
              color: "#ffffff",
            }}
          >
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Analysis Error</p>
              <p className="text-sm opacity-90">{error}</p>
            </div>
          </div>
        )}

        {/* Loading State */}
        {isAnalyzing && (
          <div className="flex items-center justify-center py-16">
            <div className="text-center">
              <Loader className="w-8 h-8 animate-spin mx-auto mb-3" style={{ color: "#9cff93" }} />
              <p className="text-[#767576]" style={{ fontFamily: "Space Grotesk" }}>
                Analyzing {symbol.toUpperCase()} across all agents...
              </p>
            </div>
          </div>
        )}

        {/* Analysis Results */}
        {analyzed && currentVerdictConfig && !isAnalyzing && (
          <div className="space-y-8">
            {/* Verdict Card */}
            <div
              className={`rounded-lg p-8 border`}
              style={{
                background: currentVerdictConfig.bg,
                borderColor: currentVerdictConfig.border,
              }}
            >
              <div className="flex items-start gap-4 mb-6">
                <VerdictIcon className="w-8 h-8 flex-shrink-0" style={{ color: currentVerdictConfig.text }} />
                <div>
                  <div
                    className="text-sm font-semibold mb-1"
                    style={{
                      color: "#767576",
                      fontFamily: "Space Grotesk",
                    }}
                  >
                    VERDICT
                  </div>
                  <div
                    className="text-3xl font-bold"
                    style={{
                      color: currentVerdictConfig.text,
                      fontFamily: "Space Grotesk",
                    }}
                  >
                    {currentVerdictConfig.label}
                  </div>
                </div>
              </div>
              <div
                className="text-sm"
                style={{
                  color: "#767576",
                  fontFamily: "JetBrains Mono",
                }}
              >
                {analyzed.symbol} • {new Date(analyzed.timestamp).toLocaleString()}
              </div>
            </div>

            {/* Key Metrics */}
            {metrics && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 rounded border" style={{ background: "#1a191b", borderColor: "rgba(72,72,73,0.2)" }}>
                  <div className="text-xs mb-1" style={{ color: "#767576", fontFamily: "Space Grotesk" }}>
                    Avg Score
                  </div>
                  <div
                    className="text-2xl font-bold"
                    style={{ color: "#9cff93", fontFamily: "JetBrains Mono" }}
                  >
                    {metrics.avgScore}%
                  </div>
                </div>
                <div className="p-4 rounded border" style={{ background: "#1a191b", borderColor: "rgba(72,72,73,0.2)" }}>
                  <div className="text-xs mb-1" style={{ color: "#767576", fontFamily: "Space Grotesk" }}>
                    Confidence
                  </div>
                  <div
                    className="text-2xl font-bold"
                    style={{ color: "#9cff93", fontFamily: "JetBrains Mono" }}
                  >
                    {metrics.avgConfidence}%
                  </div>
                </div>
                <div className="p-4 rounded border" style={{ background: "#1a191b", borderColor: "rgba(72,72,73,0.2)" }}>
                  <div className="text-xs mb-1" style={{ color: "#767576", fontFamily: "Space Grotesk" }}>
                    Agents
                  </div>
                  <div
                    className="text-2xl font-bold"
                    style={{ color: "#9cff93", fontFamily: "JetBrains Mono" }}
                  >
                    {metrics.agentCount}
                  </div>
                </div>
                <div className="p-4 rounded border" style={{ background: "#1a191b", borderColor: "rgba(72,72,73,0.2)" }}>
                  <div className="text-xs mb-1" style={{ color: "#767576", fontFamily: "Space Grotesk" }}>
                    Agreement
                  </div>
                  <div
                    className="text-2xl font-bold"
                    style={{ color: "#9cff93", fontFamily: "JetBrains Mono" }}
                  >
                    {metrics.agreement}%
                  </div>
                </div>
              </div>
            )}

            {/* Agent Consensus Section */}
            <div>
              <h2
                className="text-xl font-semibold mb-6"
                style={{ fontFamily: "Space Grotesk" }}
              >
                Agent Consensus Analysis
              </h2>
              <div className="space-y-4">
                {(analyzed.agents ?? []).map((agent) => (
                  <div
                    key={agent.name}
                    className="p-4 rounded border"
                    style={{
                      background: "#1a191b",
                      borderColor: "rgba(72,72,73,0.2)",
                    }}
                  >
                    <div className="flex justify-between items-center mb-3">
                      <span
                        className="font-medium"
                        style={{
                          fontFamily: "Space Grotesk",
                          color: "#ffffff",
                        }}
                      >
                        {agent.name}
                      </span>
                      <span
                        className="text-sm"
                        style={{
                          fontFamily: "JetBrains Mono",
                          color: "#767576",
                        }}
                      >
                        {Math.round(agent.score * 100)}% • {Math.round(agent.confidence * 100)}% confidence
                      </span>
                    </div>
                    <div
                      className="h-2 rounded-full overflow-hidden"
                      style={{
                        background: "rgba(72,72,73,0.2)",
                      }}
                    >
                      <div
                        className="h-full transition-all duration-300"
                        style={{
                          width: `${agent.score * 100}%`,
                          background: "#9cff93",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Reasoning Section */}
            <div>
              <h2
                className="text-xl font-semibold mb-4"
                style={{ fontFamily: "Space Grotesk" }}
              >
                Analysis Reasoning
              </h2>
              <div
                className="p-6 rounded border leading-relaxed"
                style={{
                  background: "#1a191b",
                  borderColor: "rgba(72,72,73,0.2)",
                  color: "#767576",
                  fontFamily: "JetBrains Mono",
                  fontSize: "0.9rem",
                }}
              >
                {analyzed.reasoning}
              </div>
            </div>
          </div>
        )}

        {/* Empty State */}
        {!analyzed && !isAnalyzing && !error && (
          <div className="text-center py-20">
            <AlertCircle className="w-12 h-12 mx-auto mb-4" style={{ color: "#767576" }} />
            <p
              className="text-lg mb-2"
              style={{
                color: "#ffffff",
                fontFamily: "Space Grotesk",
              }}
            >
              No Analysis Yet
            </p>
            <p
              style={{
                color: "#767576",
                fontFamily: "Space Grotesk",
              }}
            >
              Enter a symbol to begin multi-agent consensus analysis
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
