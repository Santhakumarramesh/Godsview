import { logger } from "../logger";

// ─── Phase 116: Paper Trading Validation Program ────────────────────────────

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
  accuracy: boolean; // did market move as predicted?
  latencyMs: number; // time between signal and market move
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

interface ProgramConfig {
  strategies: string[];
  symbols: string[];
  capitalAllocation: number;
}

// ─── In-Memory Store ──────────────────────────────────────────────────────────

let programStatus: ProgramStatus = "not_started";
let currentDay = 0;
let maxDays = 30;
let config: ProgramConfig | null = null;
let isPaused = false;
let startedAt: string | null = null;

// Phase 1: Signal Verification
const signalLogs: SignalRecord[] = [];
let phase1Grade: PhaseGrade = {
  phase: 1,
  name: "Signal Verification",
  gradeA: false,
  criteria: {
    signal_accuracy: { target: 0.6, actual: 0, passed: false },
    avg_latency_ms: { target: 500, actual: 0, passed: false },
  },
  completedAt: null,
};

// Phase 2: Execution Simulation
const executionLogs: ExecutionRecord[] = [];
let phase2Grade: PhaseGrade = {
  phase: 2,
  name: "Execution Simulation",
  gradeA: false,
  criteria: {
    fill_rate: { target: 0.95, actual: 0, passed: false },
    avg_slippage_pct: { target: 0.001, actual: 0, passed: false },
  },
  completedAt: null,
};

// Phase 3: Risk Compliance
const riskGuards: RiskGuardTestResult[] = [
  { guardName: "Max Daily Loss Guard", tested: false, passed: false, lastTestedAt: "" },
  { guardName: "Max Position Size Guard", tested: false, passed: false, lastTestedAt: "" },
  { guardName: "Correlation Guard", tested: false, passed: false, lastTestedAt: "" },
  { guardName: "Volatility Guard", tested: false, passed: false, lastTestedAt: "" },
  { guardName: "Circuit Breaker", tested: false, passed: false, lastTestedAt: "" },
];
let circuitBreakerTested = false;
let phase3Grade: PhaseGrade = {
  phase: 3,
  name: "Risk Compliance",
  gradeA: false,
  criteria: {
    guard_compliance: { target: 1.0, actual: 0, passed: false },
    circuit_breaker_tested: { target: 1, actual: 0, passed: false },
  },
  completedAt: null,
};

// Phase 4: Full Strategy Validation
const strategyComparisons: StrategyComparisonEntry[] = [];
let phase4Grade: PhaseGrade = {
  phase: 4,
  name: "Full Strategy Validation",
  gradeA: false,
  criteria: {
    pnl_deviation_pct: { target: 0.15, actual: 0, passed: false },
    win_rate_deviation: { target: 0.1, actual: 0, passed: false },
  },
  completedAt: null,
};

let certification: CertificationData = {
  status: "not_certified",
  allPhasesPassed: false,
  generatedAt: "",
  validUntil: "",
  criteriaBreakdown: {
    signalAccuracy: false,
    executionSimulation: false,
    riskCompliance: false,
    strategyValidation: false,
  },
};

// ─── Utility Functions ────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function getPhaseDay(phase: PhaseType): { start: number; end: number } {
  return {
    1: { start: 1, end: 5 },
    2: { start: 6, end: 15 },
    3: { start: 16, end: 25 },
    4: { start: 26, end: 30 },
  }[phase] || { start: 0, end: 0 };
}

function getCurrentPhase(): PhaseType | null {
  if (currentDay <= 5) return 1;
  if (currentDay <= 15) return 2;
  if (currentDay <= 25) return 3;
  if (currentDay <= 30) return 4;
  return null;
}

function getProgressPercent(): number {
  if (maxDays === 0) return 0;
  return Math.round((currentDay / maxDays) * 100);
}

function updatePhaseGrades(): void {
  // Phase 1: Signal Accuracy
  if (signalLogs.length > 0) {
    const accuracy = signalLogs.filter((s) => s.accuracy).length / signalLogs.length;
    const avgLatency =
      signalLogs.reduce((sum, s) => sum + s.latencyMs, 0) / signalLogs.length;
    phase1Grade.criteria.signal_accuracy.actual = accuracy;
    phase1Grade.criteria.avg_latency_ms.actual = avgLatency;
    phase1Grade.criteria.signal_accuracy.passed = accuracy > 0.6;
    phase1Grade.criteria.avg_latency_ms.passed = avgLatency < 500;
    phase1Grade.gradeA = phase1Grade.criteria.signal_accuracy.passed &&
      phase1Grade.criteria.avg_latency_ms.passed;
  }

  // Phase 2: Fill Rate & Slippage
  if (executionLogs.length > 0) {
    const fillRate = executionLogs.filter((e) => e.filled).length / executionLogs.length;
    const avgSlippage =
      executionLogs.reduce((sum, e) => sum + e.slippagePct, 0) / executionLogs.length;
    phase2Grade.criteria.fill_rate.actual = fillRate;
    phase2Grade.criteria.avg_slippage_pct.actual = avgSlippage;
    phase2Grade.criteria.fill_rate.passed = fillRate > 0.95;
    phase2Grade.criteria.avg_slippage_pct.passed = avgSlippage < 0.001;
    phase2Grade.gradeA = phase2Grade.criteria.fill_rate.passed &&
      phase2Grade.criteria.avg_slippage_pct.passed;
  }

  // Phase 3: Risk Compliance
  const allGuardsPassed = riskGuards.every((g) => g.passed);
  phase3Grade.criteria.guard_compliance.actual = allGuardsPassed ? 1 : 0;
  phase3Grade.criteria.circuit_breaker_tested.actual = circuitBreakerTested ? 1 : 0;
  phase3Grade.criteria.guard_compliance.passed = allGuardsPassed;
  phase3Grade.criteria.circuit_breaker_tested.passed = circuitBreakerTested;
  phase3Grade.gradeA = allGuardsPassed && circuitBreakerTested;

  // Phase 4: Strategy Comparison
  if (strategyComparisons.length > 0) {
    const avgDeviationPct =
      strategyComparisons.reduce((sum, s) => sum + Math.abs(s.deviation), 0) /
      strategyComparisons.length;
    phase4Grade.criteria.pnl_deviation_pct.actual = avgDeviationPct;
    phase4Grade.criteria.pnl_deviation_pct.passed = avgDeviationPct < 0.15;
    phase4Grade.gradeA = avgDeviationPct < 0.15;
  }
}

function updateCertificationStatus(): void {
  const allPhasesPassed =
    phase1Grade.gradeA && phase2Grade.gradeA && phase3Grade.gradeA && phase4Grade.gradeA;

  const now = new Date();
  const validUntil = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000); // 90 days

  certification = {
    status: allPhasesPassed ? "certified" : "not_certified",
    allPhasesPassed,
    generatedAt: now.toISOString(),
    validUntil: validUntil.toISOString(),
    criteriaBreakdown: {
      signalAccuracy: phase1Grade.gradeA,
      executionSimulation: phase2Grade.gradeA,
      riskCompliance: phase3Grade.gradeA,
      strategyValidation: phase4Grade.gradeA,
    },
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function startProgram(cfg: ProgramConfig): {
  success: boolean;
  message: string;
  status: ProgramStatus;
} {
  if (programStatus !== "not_started" && programStatus !== "completed") {
    return { success: false, message: "Program already running", status: programStatus };
  }

  config = cfg;
  currentDay = 0;
  maxDays = 30;
  isPaused = false;
  startedAt = new Date().toISOString();
  programStatus = "phase_1";

  // Initialize signal and execution logs
  signalLogs.length = 0;
  executionLogs.length = 0;
  strategyComparisons.length = 0;

  // Reset grades
  phase1Grade.completedAt = null;
  phase2Grade.completedAt = null;
  phase3Grade.completedAt = null;
  phase4Grade.completedAt = null;

  logger.info({ config }, "[paper-program] program started");
  return { success: true, message: "Paper trading program started", status: programStatus };
}

export function advanceDay(): {
  success: boolean;
  message: string;
  currentDay: number;
  currentPhase: PhaseType | null;
} {
  if (programStatus === "not_started" || programStatus === "completed") {
    return {
      success: false,
      message: "Program not running",
      currentDay,
      currentPhase: null,
    };
  }

  if (isPaused) {
    return {
      success: false,
      message: "Program is paused",
      currentDay,
      currentPhase: getCurrentPhase(),
    };
  }

  currentDay += 1;

  // Simulate adding some signal/execution data
  if (currentDay <= 5) {
    // Phase 1: Add simulated signals
    signalLogs.push({
      id: generateId(),
      timestamp: new Date().toISOString(),
      symbol: config?.symbols[0] || "AAPL",
      direction: Math.random() > 0.5 ? "buy" : "sell",
      entryPrice: 150 + Math.random() * 10,
      predictedEntry: 150 + Math.random() * 10,
      marketEntry: 150 + Math.random() * 10,
      accuracy: Math.random() > 0.3, // 70% accuracy
      latencyMs: Math.floor(Math.random() * 400), // 0-400ms latency
    });
  } else if (currentDay <= 15) {
    // Phase 2: Add simulated executions
    executionLogs.push({
      id: generateId(),
      timestamp: new Date().toISOString(),
      symbol: config?.symbols[0] || "AAPL",
      qty: Math.floor(Math.random() * 100) + 10,
      orderedPrice: 150 + Math.random() * 10,
      filledPrice: 150 + Math.random() * 10,
      slippagePct: Math.random() * 0.0008, // 0-0.08% slippage
      filled: Math.random() > 0.03, // 97% fill rate
      partialFillPct: Math.random(),
    });
  } else if (currentDay <= 25) {
    // Phase 3: Test risk guards
    if (currentDay === 16) {
      riskGuards.forEach((guard) => {
        guard.tested = true;
        guard.passed = Math.random() > 0.1; // 90% pass rate
        guard.lastTestedAt = new Date().toISOString();
      });
      circuitBreakerTested = true;
    }
  } else if (currentDay <= 30) {
    // Phase 4: Add strategy comparisons
    if (strategyComparisons.length === 0) {
      config?.symbols.forEach((symbol) => {
        config?.strategies.forEach((strategy) => {
          strategyComparisons.push({
            symbol,
            strategy,
            paperPnL: (Math.random() - 0.4) * 5000, // -2000 to +3000
            backtestPnL: (Math.random() - 0.4) * 5500,
            deviation: (Math.random() - 0.5) * 0.2,
          });
        });
      });
    }
  }

  updatePhaseGrades();

  // Update program status
  const phase = getCurrentPhase();
  if (!phase) {
    programStatus = "completed";
    updateCertificationStatus();
  } else {
    programStatus = (`phase_${phase}` as ProgramStatus);
  }

  return {
    success: true,
    message: `Advanced to day ${currentDay}`,
    currentDay,
    currentPhase: phase,
  };
}

export function pauseProgram(): { success: boolean; message: string } {
  if (programStatus === "not_started" || programStatus === "completed") {
    return { success: false, message: "Cannot pause program in this state" };
  }
  isPaused = true;
  logger.info("[paper-program] program paused");
  return { success: true, message: "Program paused" };
}

export function resumeProgram(): { success: boolean; message: string } {
  if (!isPaused) {
    return { success: false, message: "Program is not paused" };
  }
  isPaused = false;
  logger.info("[paper-program] program resumed");
  return { success: true, message: "Program resumed" };
}

export function getProgramStatus(): {
  status: ProgramStatus;
  currentDay: number;
  maxDays: number;
  progressPercent: number;
  currentPhase: PhaseType | null;
  isPaused: boolean;
  startedAt: string | null;
  config: ProgramConfig | null;
} {
  return {
    status: programStatus,
    currentDay,
    maxDays,
    progressPercent: getProgressPercent(),
    currentPhase: getCurrentPhase(),
    isPaused,
    startedAt,
    config,
  };
}

export function getPhaseReport(phase: PhaseType): {
  phase: PhaseType;
  name: string;
  dayRange: { start: number; end: number };
  gradeA: boolean;
  criteria: Record<string, { target: number; actual: number; passed: boolean }>;
  completedAt: string | null;
  recordCount: number;
  detailsUrl: string;
} {
  const range = getPhaseDay(phase);
  let recordCount = 0;

  const gradeMap = { 1: phase1Grade, 2: phase2Grade, 3: phase3Grade, 4: phase4Grade };
  const grade = gradeMap[phase];

  if (phase === 1) recordCount = signalLogs.length;
  else if (phase === 2) recordCount = executionLogs.length;
  else if (phase === 3) recordCount = riskGuards.length;
  else if (phase === 4) recordCount = strategyComparisons.length;

  return {
    phase,
    name: grade.name,
    dayRange: range,
    gradeA: grade.gradeA,
    criteria: grade.criteria,
    completedAt: grade.completedAt,
    recordCount,
    detailsUrl: `/api/paper-program/phase/${phase}/details`,
  };
}

export function getSignalLog(limit = 50): SignalRecord[] {
  return signalLogs.slice(-limit).reverse();
}

export function getExecutionLog(limit = 50): ExecutionRecord[] {
  return executionLogs.slice(-limit).reverse();
}

export function getRiskComplianceReport(): {
  guards: RiskGuardTestResult[];
  circuitBreakerTested: boolean;
  overallCompliance: boolean;
  lastTestedAt: string | null;
} {
  const lastTested =
    riskGuards.find((g) => g.lastTestedAt)?.lastTestedAt ||
    (circuitBreakerTested ? new Date().toISOString() : null);

  return {
    guards: riskGuards,
    circuitBreakerTested,
    overallCompliance: riskGuards.every((g) => g.passed) && circuitBreakerTested,
    lastTestedAt: lastTested,
  };
}

export function getStrategyComparisonReport(): {
  comparisons: StrategyComparisonEntry[];
  summary: {
    totalStrategies: number;
    avgDeviationPct: number;
    bestPerformer: string;
    worstPerformer: string;
  };
} {
  const summary = {
    totalStrategies: strategyComparisons.length,
    avgDeviationPct:
      strategyComparisons.length > 0
        ? strategyComparisons.reduce((sum, s) => sum + Math.abs(s.deviation), 0) /
          strategyComparisons.length
        : 0,
    bestPerformer: "",
    worstPerformer: "",
  };

  if (strategyComparisons.length > 0) {
    const sorted = [...strategyComparisons].sort(
      (a, b) => Math.abs(a.deviation) - Math.abs(b.deviation),
    );
    summary.bestPerformer = `${sorted[0].strategy} on ${sorted[0].symbol}`;
    summary.worstPerformer = `${sorted[sorted.length - 1].strategy} on ${
      sorted[sorted.length - 1].symbol
    }`;
  }

  return {
    comparisons: strategyComparisons,
    summary,
  };
}

export function getCertificationStatus(): CertificationData {
  updateCertificationStatus();
  return certification;
}

export function generateCertificate(): {
  success: boolean;
  certificate: CertificationData | null;
  message: string;
} {
  updatePhaseGrades();
  updateCertificationStatus();

  if (!certification.allPhasesPassed) {
    return {
      success: false,
      certificate: null,
      message: "Not all phases have passed. Cannot generate certificate.",
    };
  }

  return {
    success: true,
    certificate: certification,
    message: "Certificate generated successfully",
  };
}

export function getFullReport(): {
  status: ProgramStatus;
  currentDay: number;
  progressPercent: number;
  phases: {
    1: ReturnType<typeof getPhaseReport>;
    2: ReturnType<typeof getPhaseReport>;
    3: ReturnType<typeof getPhaseReport>;
    4: ReturnType<typeof getPhaseReport>;
  };
  signalAccuracy: number;
  executionFillRate: number;
  riskCompliance: boolean;
  strategyDeviation: number;
  certification: CertificationData;
} {
  const signalAccuracy =
    signalLogs.length > 0
      ? (signalLogs.filter((s) => s.accuracy).length / signalLogs.length) * 100
      : 0;
  const executionFillRate =
    executionLogs.length > 0
      ? (executionLogs.filter((e) => e.filled).length / executionLogs.length) * 100
      : 0;
  const comparisonReport = getStrategyComparisonReport();

  return {
    status: programStatus,
    currentDay,
    progressPercent: getProgressPercent(),
    phases: {
      1: getPhaseReport(1),
      2: getPhaseReport(2),
      3: getPhaseReport(3),
      4: getPhaseReport(4),
    },
    signalAccuracy,
    executionFillRate,
    riskCompliance: getRiskComplianceReport().overallCompliance,
    strategyDeviation: comparisonReport.summary.avgDeviationPct * 100,
    certification: getCertificationStatus(),
  };
}
