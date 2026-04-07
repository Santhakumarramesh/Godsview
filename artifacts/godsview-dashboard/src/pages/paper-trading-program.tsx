import React, { useState, useEffect } from "react";

type PhaseType = 1 | 2 | 3 | 4;
type ProgramStatus = "not_started" | "phase_1" | "phase_2" | "phase_3" | "phase_4" | "completed" | "paused";

interface SignalRecord {
  id: string;
  timestamp: string;
  symbol: string;
  direction: "buy" | "sell";
  entryPrice: number;
  predictedEntry: number;
  marketEntry: number;
  accuracy: boolean;
  latencyMs: number;
}

interface ExecutionRecord {
  id: string;
  timestamp: string;
  symbol: string;
  qty: number;
  orderedPrice: number;
  filledPrice: number;
  slippagePct: number;
  filled: boolean;
  partialFillPct: number;
}

interface RiskGuardTestResult {
  guardName: string;
  tested: boolean;
  passed: boolean;
  lastTestedAt: string;
}

interface CertificationData {
  status: "not_certified" | "certified" | "certified_with_conditions";
  allPhasesPassed: boolean;
  generatedAt: string;
  validUntil: string;
  criteriaBreakdown: {
    signalAccuracy: boolean;
    executionSimulation: boolean;
    riskCompliance: boolean;
    strategyValidation: boolean;
  };
}

interface PhaseGrade {
  phase: PhaseType;
  name: string;
  gradeA: boolean;
  criteria: Record<string, { target: number; actual: number; passed: boolean }>;
  completedAt: string | null;
}

interface StrategyComparisonEntry {
  symbol: string;
  strategy: string;
  paperPnL: number;
  backtestPnL: number;
  deviation: number;
}

export default function PaperTradingProgram() {
  const [status, setStatus] = useState<{
    status: ProgramStatus;
    currentDay: number;
    maxDays: number;
    progressPercent: number;
    currentPhase: PhaseType | null;
    isPaused: boolean;
    startedAt: string | null;
    config: any;
  } | null>(null);

  const [signals, setSignals] = useState<SignalRecord[]>([]);
  const [executions, setExecutions] = useState<ExecutionRecord[]>([]);
  const [riskCompliance, setRiskCompliance] = useState<{
    guards: RiskGuardTestResult[];
    circuitBreakerTested: boolean;
    overallCompliance: boolean;
    lastTestedAt: string | null;
  } | null>(null);

  const [strategyComparison, setStrategyComparison] = useState<{
    comparisons: StrategyComparisonEntry[];
    summary: {
      totalStrategies: number;
      avgDeviationPct: number;
      bestPerformer: string;
      worstPerformer: string;
    };
  } | null>(null);

  const [certification, setCertification] = useState<CertificationData | null>(null);
  const [phase1, setPhase1] = useState<PhaseGrade | null>(null);
  const [phase2, setPhase2] = useState<PhaseGrade | null>(null);
  const [phase3, setPhase3] = useState<PhaseGrade | null>(null);
  const [phase4, setPhase4] = useState<PhaseGrade | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCertModal, setShowCertModal] = useState(false);
  const [certLoading, setCertLoading] = useState(false);

  const [initModalOpen, setInitModalOpen] = useState(false);
  const [strategies, setStrategies] = useState("momentum,mean-reversion");
  const [symbols, setSymbols] = useState("AAPL,GOOGL,MSFT");
  const [capital, setCapital] = useState(100000);

  // Fetch all data
  const fetchAllData = async () => {
    try {
      setLoading(true);
      const [statusRes, sig, exec, risk, comp, cert, p1, p2, p3, p4] = await Promise.all([
        fetch("/api/paper-program/status"),
        fetch("/api/paper-program/signals?limit=50"),
        fetch("/api/paper-program/executions?limit=50"),
        fetch("/api/paper-program/risk-compliance"),
        fetch("/api/paper-program/strategy-comparison"),
        fetch("/api/paper-program/certification"),
        fetch("/api/paper-program/phase/1"),
        fetch("/api/paper-program/phase/2"),
        fetch("/api/paper-program/phase/3"),
        fetch("/api/paper-program/phase/4"),
      ]);

      if (statusRes.ok) {
        const s = await statusRes.json();
        setStatus(s);
        if (s.status === "not_started" && !initModalOpen) {
          setInitModalOpen(true);
        }
      }

      if (sig.ok) {
        const data = await sig.json();
        setSignals(data.signals || []);
      }

      if (exec.ok) {
        const data = await exec.json();
        setExecutions(data.executions || []);
      }

      if (risk.ok) {
        setRiskCompliance(await risk.json());
      }

      if (comp.ok) {
        setStrategyComparison(await comp.json());
      }

      if (cert.ok) {
        setCertification(await cert.json());
      }

      if (p1.ok) setPhase1(await p1.json());
      if (p2.ok) setPhase2(await p2.json());
      if (p3.ok) setPhase3(await p3.json());
      if (p4.ok) setPhase4(await p4.json());

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
    const interval = setInterval(fetchAllData, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleStartProgram = async () => {
    try {
      setLoading(true);
      const stratList = strategies.split(",").map((s) => s.trim());
      const symList = symbols.split(",").map((s) => s.trim());

      const res = await fetch("/api/paper-program/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategies: stratList,
          symbols: symList,
          capitalAllocation: capital,
        }),
      });

      if (res.ok) {
        setInitModalOpen(false);
        await fetchAllData();
      } else {
        setError("Failed to start program");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const handleAdvanceDay = async () => {
    try {
      const res = await fetch("/api/paper-program/advance", { method: "POST" });
      if (res.ok) {
        await fetchAllData();
      } else {
        setError("Failed to advance day");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  const handlePause = async () => {
    try {
      const res = await fetch("/api/paper-program/pause", { method: "POST" });
      if (res.ok) {
        await fetchAllData();
      } else {
        setError("Failed to pause");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  const handleResume = async () => {
    try {
      const res = await fetch("/api/paper-program/resume", { method: "POST" });
      if (res.ok) {
        await fetchAllData();
      } else {
        setError("Failed to resume");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  const handleGenerateCertificate = async () => {
    try {
      setCertLoading(true);
      const res = await fetch("/api/paper-program/certify", { method: "POST" });
      if (res.ok) {
        const result = await res.json();
        if (result.success) {
          await fetchAllData();
          setShowCertModal(false);
        } else {
          setError(result.message);
        }
      } else {
        setError("Failed to generate certificate");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setCertLoading(false);
    }
  };

  if (loading && !status) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-950">
        <div className="text-white">Loading Paper Trading Program...</div>
      </div>
    );
  }

  const signalAccuracy =
    signals.length > 0
      ? ((signals.filter((s) => s.accuracy).length / signals.length) * 100).toFixed(1)
      : "0";
  const avgLatency =
    signals.length > 0 ? (signals.reduce((sum, s) => sum + s.latencyMs, 0) / signals.length).toFixed(0) : "0";
  const fillRate =
    executions.length > 0
      ? ((executions.filter((e) => e.filled).length / executions.length) * 100).toFixed(1)
      : "0";
  const avgSlippage =
    executions.length > 0
      ? (executions.reduce((sum, e) => sum + e.slippagePct, 0) / executions.length * 100).toFixed(3)
      : "0";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white p-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">Paper Trading Validation Program</h1>
        <p className="text-slate-400">
          {status?.status === "not_started"
            ? "Program not started"
            : `Day ${status?.currentDay} of ${status?.maxDays} | Phase ${status?.currentPhase} | ${status?.progressPercent}% Complete`}
        </p>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="mb-6 p-4 bg-red-900/30 border border-red-500/50 rounded-lg">
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}

      {/* Init Modal */}
      {initModalOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-8 max-w-md">
            <h2 className="text-2xl font-bold mb-6">Start Paper Trading Program</h2>
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium mb-2">Strategies (comma-separated)</label>
                <input
                  type="text"
                  value={strategies}
                  onChange={(e) => setStrategies(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm"
                  placeholder="momentum,mean-reversion"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Symbols (comma-separated)</label>
                <input
                  type="text"
                  value={symbols}
                  onChange={(e) => setSymbols(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm"
                  placeholder="AAPL,GOOGL,MSFT"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Capital Allocation ($)</label>
                <input
                  type="number"
                  value={capital}
                  onChange={(e) => setCapital(Number(e.target.value))}
                  className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white text-sm"
                />
              </div>
            </div>
            <button
              onClick={handleStartProgram}
              disabled={loading}
              className="w-full bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 disabled:opacity-50 px-4 py-2 rounded font-semibold transition"
            >
              Start Program
            </button>
          </div>
        </div>
      )}

      {/* Program Overview */}
      {status && status.status !== "not_started" && (
        <>
          {/* Phase Stepper */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              {[1, 2, 3, 4].map((phase) => (
                <div key={phase} className="flex items-center">
                  <div
                    className={`w-12 h-12 rounded-full flex items-center justify-center font-bold transition ${
                      status.currentPhase === phase
                        ? "bg-gradient-to-r from-amber-500 to-amber-400 text-black ring-4 ring-amber-500/50"
                        : status.currentPhase && status.currentPhase > phase
                          ? "bg-gradient-to-r from-emerald-600 to-emerald-500"
                          : "bg-slate-700"
                    }`}
                  >
                    {phase}
                  </div>
                  {phase < 4 && (
                    <div
                      className={`w-16 h-1 mx-2 transition ${
                        status.currentPhase && status.currentPhase > phase
                          ? "bg-gradient-to-r from-emerald-600 to-emerald-500"
                          : "bg-slate-700"
                      }`}
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="text-center text-sm text-slate-400">
              {status.currentPhase === 1 && "Phase 1: Signal Verification (Days 1-5)"}
              {status.currentPhase === 2 && "Phase 2: Execution Simulation (Days 6-15)"}
              {status.currentPhase === 3 && "Phase 3: Risk Compliance (Days 16-25)"}
              {status.currentPhase === 4 && "Phase 4: Full Strategy Validation (Days 26-30)"}
              {status.status === "completed" && "Program Completed"}
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mb-8 bg-slate-800 rounded-lg p-4">
            <div className="flex justify-between items-center mb-3">
              <span className="font-semibold">Overall Progress</span>
              <span className="text-2xl font-bold">{status.progressPercent}%</span>
            </div>
            <div className="w-full h-4 bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-600 to-cyan-500 transition-all duration-500"
                style={{ width: `${status.progressPercent}%` }}
              />
            </div>
          </div>

          {/* Control Bar */}
          <div className="mb-8 flex gap-3 flex-wrap">
            {status.isPaused ? (
              <button
                onClick={handleResume}
                className="bg-emerald-600 hover:bg-emerald-500 px-6 py-2 rounded font-semibold transition"
              >
                Resume
              </button>
            ) : (
              <button
                onClick={handlePause}
                className="bg-amber-600 hover:bg-amber-500 px-6 py-2 rounded font-semibold transition"
              >
                Pause
              </button>
            )}
            <button
              onClick={handleAdvanceDay}
              disabled={status.isPaused || status.status === "completed"}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-6 py-2 rounded font-semibold transition"
            >
              Advance Day
            </button>
            <button
              onClick={() => setInitModalOpen(true)}
              className="bg-slate-700 hover:bg-slate-600 px-6 py-2 rounded font-semibold transition"
            >
              Reset Program
            </button>
          </div>
        </>
      )}

      {/* Main Content Panels */}
      {status && status.status !== "not_started" && (
        <div className="space-y-8">
          {/* Phase 1: Signal Verification */}
          {phase1 && (
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold">Signal Verification (Phase 1)</h2>
                <div
                  className={`px-3 py-1 rounded-full text-sm font-semibold ${
                    phase1.gradeA
                      ? "bg-emerald-900/50 text-emerald-300 border border-emerald-500/50"
                      : "bg-slate-700 text-slate-300 border border-slate-600"
                  }`}
                >
                  {phase1.gradeA ? "PASS" : "IN PROGRESS"}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-slate-900/50 rounded p-4">
                  <div className="text-sm text-slate-400 mb-1">Signal Accuracy</div>
                  <div className="text-3xl font-bold text-cyan-400">{signalAccuracy}%</div>
                  <div className="text-xs text-slate-500 mt-1">{"Target: >60%"}</div>
                </div>
                <div className="bg-slate-900/50 rounded p-4">
                  <div className="text-sm text-slate-400 mb-1">Avg Latency</div>
                  <div className="text-3xl font-bold text-cyan-400">{avgLatency}ms</div>
                  <div className="text-xs text-slate-500 mt-1">{"Target: <500ms"}</div>
                </div>
              </div>

              <div className="text-sm text-slate-400">
                {signals.length > 0 && (
                  <>
                    <p className="mb-3">Recent Signals ({signals.length} total):</p>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {signals.slice(0, 10).map((sig) => (
                        <div
                          key={sig.id}
                          className="flex items-center justify-between bg-slate-900/30 p-2 rounded text-xs"
                        >
                          <span>
                            {sig.symbol} {sig.direction.toUpperCase()} - Accuracy:{" "}
                            {sig.accuracy ? "✓" : "✗"} Latency: {sig.latencyMs}ms
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Phase 2: Execution Simulation */}
          {phase2 && (
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold">Execution Simulation (Phase 2)</h2>
                <div
                  className={`px-3 py-1 rounded-full text-sm font-semibold ${
                    phase2.gradeA
                      ? "bg-emerald-900/50 text-emerald-300 border border-emerald-500/50"
                      : "bg-slate-700 text-slate-300 border border-slate-600"
                  }`}
                >
                  {phase2.gradeA ? "PASS" : "IN PROGRESS"}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-slate-900/50 rounded p-4">
                  <div className="text-sm text-slate-400 mb-1">Fill Rate</div>
                  <div className="text-3xl font-bold text-cyan-400">{fillRate}%</div>
                  <div className="text-xs text-slate-500 mt-1">{"Target: >95%"}</div>
                </div>
                <div className="bg-slate-900/50 rounded p-4">
                  <div className="text-sm text-slate-400 mb-1">Avg Slippage</div>
                  <div className="text-3xl font-bold text-cyan-400">{avgSlippage}%</div>
                  <div className="text-xs text-slate-500 mt-1">{"Target: <0.1%"}</div>
                </div>
              </div>

              <div className="text-sm text-slate-400">
                {executions.length > 0 && (
                  <>
                    <p className="mb-3">Recent Executions ({executions.length} total):</p>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {executions.slice(0, 10).map((exe) => (
                        <div
                          key={exe.id}
                          className="flex items-center justify-between bg-slate-900/30 p-2 rounded text-xs"
                        >
                          <span>
                            {exe.symbol} {exe.qty} @ {exe.orderedPrice.toFixed(2)} →{" "}
                            {exe.filledPrice.toFixed(2)} | Slippage: {(exe.slippagePct * 100).toFixed(4)}% | Filled:{" "}
                            {exe.filled ? "✓" : "✗"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Phase 3: Risk Compliance */}
          {phase3 && riskCompliance && (
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold">Risk Compliance (Phase 3)</h2>
                <div
                  className={`px-3 py-1 rounded-full text-sm font-semibold ${
                    phase3.gradeA
                      ? "bg-emerald-900/50 text-emerald-300 border border-emerald-500/50"
                      : "bg-slate-700 text-slate-300 border border-slate-600"
                  }`}
                >
                  {phase3.gradeA ? "PASS" : "IN PROGRESS"}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-slate-900/50 rounded p-4">
                  <div className="text-sm text-slate-400 mb-3">Risk Guards (5)</div>
                  <div className="space-y-2">
                    {riskCompliance.guards.map((guard, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <div
                          className={`w-4 h-4 rounded ${
                            guard.passed ? "bg-emerald-500" : "bg-slate-600"
                          }`}
                        />
                        <span className="text-xs">{guard.guardName}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-slate-900/50 rounded p-4">
                  <div className="text-sm text-slate-400 mb-3">Circuit Breaker</div>
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-6 h-6 rounded ${
                        riskCompliance.circuitBreakerTested ? "bg-emerald-500" : "bg-slate-600"
                      }`}
                    />
                    <span className="text-sm">
                      {riskCompliance.circuitBreakerTested ? "Tested" : "Pending"}
                    </span>
                  </div>
                </div>
              </div>

              <div
                className={`p-3 rounded text-sm ${
                  riskCompliance.overallCompliance
                    ? "bg-emerald-900/30 border border-emerald-500/50 text-emerald-300"
                    : "bg-slate-700 border border-slate-600 text-slate-300"
                }`}
              >
                {riskCompliance.overallCompliance
                  ? "All risk guards passed and circuit breaker tested"
                  : "Risk compliance tests pending"}
              </div>
            </div>
          )}

          {/* Phase 4: Strategy Validation */}
          {phase4 && strategyComparison && (
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold">Strategy Validation (Phase 4)</h2>
                <div
                  className={`px-3 py-1 rounded-full text-sm font-semibold ${
                    phase4.gradeA
                      ? "bg-emerald-900/50 text-emerald-300 border border-emerald-500/50"
                      : "bg-slate-700 text-slate-300 border border-slate-600"
                  }`}
                >
                  {phase4.gradeA ? "PASS" : "IN PROGRESS"}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-slate-900/50 rounded p-4">
                  <div className="text-sm text-slate-400 mb-1">Strategies Tested</div>
                  <div className="text-3xl font-bold text-cyan-400">
                    {strategyComparison.summary.totalStrategies}
                  </div>
                </div>
                <div className="bg-slate-900/50 rounded p-4">
                  <div className="text-sm text-slate-400 mb-1">Avg Deviation</div>
                  <div className="text-3xl font-bold text-cyan-400">
                    {(strategyComparison.summary.avgDeviationPct * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-slate-500 mt-1">{"Target: <15%"}</div>
                </div>
              </div>

              {strategyComparison.comparisons.length > 0 && (
                <div className="text-sm text-slate-400">
                  <p className="mb-3">Strategy Comparisons:</p>
                  <div className="space-y-2 max-h-56 overflow-y-auto">
                    {strategyComparison.comparisons.slice(0, 8).map((comp, idx) => (
                      <div
                        key={idx}
                        className="grid grid-cols-4 gap-2 bg-slate-900/30 p-2 rounded text-xs"
                      >
                        <div>{comp.strategy}</div>
                        <div className="text-right">Paper: ${comp.paperPnL.toFixed(0)}</div>
                        <div className="text-right">BT: ${comp.backtestPnL.toFixed(0)}</div>
                        <div className="text-right">
                          Dev:{" "}
                          <span
                            className={
                              Math.abs(comp.deviation) < 0.15 ? "text-emerald-400" : "text-orange-400"
                            }
                          >
                            {(comp.deviation * 100).toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Certification Status */}
          {certification && (
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
              <h2 className="text-xl font-bold mb-6">Certification Status</h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Certification Badge */}
                <div className="flex flex-col items-center justify-center p-8 bg-slate-900/50 rounded-lg">
                  <div
                    className={`w-24 h-24 rounded-full flex items-center justify-center mb-4 text-3xl font-bold ${
                      certification.allPhasesPassed
                        ? "bg-gradient-to-br from-emerald-500 to-emerald-600 text-white"
                        : "bg-gradient-to-br from-slate-600 to-slate-700 text-slate-400"
                    }`}
                  >
                    {certification.allPhasesPassed ? "✓" : "○"}
                  </div>
                  <h3 className="text-lg font-semibold text-center mb-2">
                    {certification.allPhasesPassed ? "Certified" : "Not Yet Certified"}
                  </h3>
                  <p className="text-sm text-slate-400 text-center">
                    {certification.allPhasesPassed
                      ? `Valid until ${new Date(certification.validUntil).toLocaleDateString()}`
                      : "Complete all phases to certify"}
                  </p>
                </div>

                {/* Criteria Breakdown */}
                <div className="space-y-3">
                  <div className="text-sm font-semibold mb-4">Certification Criteria</div>
                  {Object.entries(certification.criteriaBreakdown).map(([key, passed]) => (
                    <div
                      key={key}
                      className="flex items-center justify-between p-3 bg-slate-900/30 rounded"
                    >
                      <span className="capitalize text-sm">
                        {key.replace(/([A-Z])/g, " $1").trim()}
                      </span>
                      <div
                        className={`w-6 h-6 rounded flex items-center justify-center ${
                          passed ? "bg-emerald-500 text-white" : "bg-slate-600"
                        }`}
                      >
                        {passed ? "✓" : "—"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {certification.allPhasesPassed && (
                <div className="mt-6 flex gap-3">
                  <button
                    onClick={() => setShowCertModal(true)}
                    className="flex-1 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 px-6 py-3 rounded font-semibold transition"
                  >
                    Generate Certificate
                  </button>
                  <button
                    onClick={() => setInitModalOpen(true)}
                    className="flex-1 bg-slate-700 hover:bg-slate-600 px-6 py-3 rounded font-semibold transition"
                  >
                    Start New Program
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Certificate Modal */}
      {showCertModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-lg p-8 max-w-md">
            <h2 className="text-2xl font-bold mb-4">Generate Certificate?</h2>
            <p className="text-slate-300 mb-6">
              You are about to generate an official Paper Trading Validation Certificate.
              This certificate will be valid for 90 days.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowCertModal(false)}
                className="flex-1 bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded font-semibold transition"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerateCertificate}
                disabled={certLoading}
                className="flex-1 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 disabled:opacity-50 px-4 py-2 rounded font-semibold transition"
              >
                {certLoading ? "Generating..." : "Generate"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
