/**
 * certification_gate/certification_engine.ts — Phase 36: Go-Live Certification Gate
 *
 * Comprehensive pre-production certification system validating all critical
 * subsystems before enabling live trading. Aggregates checks across:
 * - Strategy validation (readiness, backtest results)
 * - Reconciliation health (daily reconciliation runs)
 * - Data truth (symbol monitoring, truth scores)
 * - Latency thresholds (execution latency)
 * - Auth security (operator auth, config validation)
 * - Disaster drill completion (recovery procedures tested)
 * - Test coverage (unit/integration test suites)
 * - Documentation completeness (production readiness docs)
 *
 * Returns structured certification report with:
 * - Pass/Fail/Pass-with-Restrictions status
 * - Individual category checks with evidence
 * - Critical blockers preventing live trading
 * - Restrictions and conditional allowances
 * - Overall readiness score (0-100)
 */

import { randomUUID } from "node:crypto";
import { logger } from "../logger";

// ─── Type Definitions ────────────────────────────────────────────────────────

export type CertificationStatus = "pass" | "fail" | "warning" | "skipped";
export type CertificationCategory =
  | "strategy_validation"
  | "reconciliation_health"
  | "data_truth"
  | "latency_thresholds"
  | "auth_security"
  | "disaster_drill_completion"
  | "test_coverage"
  | "documentation_completeness";

export type ReportStatus = "pass" | "pass_with_restrictions" | "fail";

export interface CertificationCheck {
  check_id: string;
  category: CertificationCategory;
  name: string;
  status: CertificationStatus;
  required: boolean;
  score: number; // 0-100
  details: string;
  evidence: unknown;
  timestamp: string;
}

export interface CertificationReport {
  report_id: string;
  status: ReportStatus;
  overall_score: number; // 0-100
  checks: CertificationCheck[];
  passed_count: number;
  failed_count: number;
  warning_count: number;
  critical_blockers: string[];
  restrictions: string[];
  generated_at: string;
}

// ─── State Management ────────────────────────────────────────────────────────

const reportsMap = new Map<string, CertificationReport>();
let lastReportId: string | null = null;

// ─── Configuration ───────────────────────────────────────────────────────────

const STRATEGY_VALIDATION_MIN_READINESS = 60;
const DATA_TRUTH_MIN_SCORE = 0.7;
const LATENCY_THRESHOLD_MS = 500;

// ─── Helper: Get External Module State ──────────────────────────────────────

/**
 * Safely retrieves state from other modules.
 * In production, these would import and call actual modules.
 * For testing, these are mocked.
 */

function getStrategyValidationState(): { hasValidatedStrategy: boolean; readinessScore: number } {
  try {
    // In real implementation: import { getStrategyState } from "../strategy_engine"
    // For now, return mock that tests can override
    const globalAny = global as any;
    if (globalAny.__MOCK_STRATEGY_STATE) {
      return globalAny.__MOCK_STRATEGY_STATE;
    }
    return { hasValidatedStrategy: false, readinessScore: 0 };
  } catch {
    return { hasValidatedStrategy: false, readinessScore: 0 };
  }
}

function getReconciliationState(): { lastRunTime: string | null; hasCriticalMismatches: boolean } {
  try {
    const globalAny = global as any;
    if (globalAny.__MOCK_RECONCILIATION_STATE) {
      return globalAny.__MOCK_RECONCILIATION_STATE;
    }
    return { lastRunTime: null, hasCriticalMismatches: false };
  } catch {
    return { lastRunTime: null, hasCriticalMismatches: false };
  }
}

function getDataTruthState(): { monitoredSymbols: Array<{ symbol: string; truthScore: number }> } {
  try {
    const globalAny = global as any;
    if (globalAny.__MOCK_DATA_TRUTH_STATE) {
      return globalAny.__MOCK_DATA_TRUTH_STATE;
    }
    return { monitoredSymbols: [] };
  } catch {
    return { monitoredSymbols: [] };
  }
}

function getLatencyMetrics(): { avgLatencyMs: number } {
  try {
    const globalAny = global as any;
    if (globalAny.__MOCK_LATENCY_STATE) {
      return globalAny.__MOCK_LATENCY_STATE;
    }
    return { avgLatencyMs: 0 };
  } catch {
    return { avgLatencyMs: 0 };
  }
}

function getAuthSecurityState(): {
  operatorAuthConfigured: boolean;
  envValidationPasses: boolean;
  hasFatalUnsafeConfigs: boolean;
} {
  try {
    const globalAny = global as any;
    if (globalAny.__MOCK_AUTH_STATE) {
      return globalAny.__MOCK_AUTH_STATE;
    }
    return { operatorAuthConfigured: false, envValidationPasses: false, hasFatalUnsafeConfigs: false };
  } catch {
    return { operatorAuthConfigured: false, envValidationPasses: false, hasFatalUnsafeConfigs: false };
  }
}

function getDisasterDrillState(): { completedDrillCount: number; lastDrillSuccess: boolean } {
  try {
    const globalAny = global as any;
    if (globalAny.__MOCK_DISASTER_DRILL_STATE) {
      return globalAny.__MOCK_DISASTER_DRILL_STATE;
    }
    return { completedDrillCount: 0, lastDrillSuccess: false };
  } catch {
    return { completedDrillCount: 0, lastDrillSuccess: false };
  }
}

function getTestCoverageState(): { hasTestFiles: boolean; majorModulesCovered: number; totalMajorModules: number } {
  try {
    const globalAny = global as any;
    if (globalAny.__MOCK_TEST_COVERAGE_STATE) {
      return globalAny.__MOCK_TEST_COVERAGE_STATE;
    }
    return { hasTestFiles: false, majorModulesCovered: 0, totalMajorModules: 0 };
  } catch {
    return { hasTestFiles: false, majorModulesCovered: 0, totalMajorModules: 0 };
  }
}

function getDocumentationState(): { readmeExists: boolean; productionLogExists: boolean } {
  try {
    const globalAny = global as any;
    if (globalAny.__MOCK_DOCUMENTATION_STATE) {
      return globalAny.__MOCK_DOCUMENTATION_STATE;
    }
    return { readmeExists: false, productionLogExists: false };
  } catch {
    return { readmeExists: false, productionLogExists: false };
  }
}

// ─── Check Functions ────────────────────────────────────────────────────────

function checkStrategyValidation(): CertificationCheck {
  const state = getStrategyValidationState();
  const passed = state.hasValidatedStrategy && state.readinessScore > STRATEGY_VALIDATION_MIN_READINESS;

  return {
    check_id: `check_${randomUUID()}`,
    category: "strategy_validation",
    name: "At least 1 strategy with completed validation session",
    status: passed ? "pass" : "fail",
    required: true,
    score: passed ? Math.min(100, state.readinessScore) : state.readinessScore,
    details: passed
      ? `Strategy validated with readiness score ${state.readinessScore}`
      : `No validated strategies found or readiness score (${state.readinessScore}) below minimum (${STRATEGY_VALIDATION_MIN_READINESS})`,
    evidence: { hasValidatedStrategy: state.hasValidatedStrategy, readinessScore: state.readinessScore },
    timestamp: new Date().toISOString(),
  };
}

function checkReconciliationHealth(): CertificationCheck {
  const state = getReconciliationState();
  const passed = state.lastRunTime !== null && !state.hasCriticalMismatches;

  return {
    check_id: `check_${randomUUID()}`,
    category: "reconciliation_health",
    name: "Reconciliation service has been run with no critical mismatches",
    status: passed ? "pass" : state.lastRunTime ? "warning" : "fail",
    required: true,
    score: passed ? 100 : state.lastRunTime ? 60 : 0,
    details: passed
      ? `Last reconciliation run at ${state.lastRunTime}, no critical mismatches detected`
      : state.lastRunTime
        ? `Reconciliation run at ${state.lastRunTime} but critical mismatches detected`
        : "No reconciliation runs have been executed",
    evidence: { lastRunTime: state.lastRunTime, hasCriticalMismatches: state.hasCriticalMismatches },
    timestamp: new Date().toISOString(),
  };
}

function checkDataTruth(): CertificationCheck {
  const state = getDataTruthState();

  if (state.monitoredSymbols.length === 0) {
    return {
      check_id: `check_${randomUUID()}`,
      category: "data_truth",
      name: "All monitored symbols have truth score > 0.7",
      status: "skipped",
      required: false,
      score: 50,
      details: "No monitored symbols found",
      evidence: { monitoredSymbols: [] },
      timestamp: new Date().toISOString(),
    };
  }

  const allAboveThreshold = state.monitoredSymbols.every((s) => s.truthScore > DATA_TRUTH_MIN_SCORE);
  const avgScore = state.monitoredSymbols.reduce((sum, s) => sum + s.truthScore, 0) / state.monitoredSymbols.length;

  return {
    check_id: `check_${randomUUID()}`,
    category: "data_truth",
    name: "All monitored symbols have truth score > 0.7",
    status: allAboveThreshold ? "pass" : "warning",
    required: false,
    score: Math.round(avgScore * 100),
    details: allAboveThreshold
      ? `All ${state.monitoredSymbols.length} symbols above threshold (avg: ${avgScore.toFixed(3)})`
      : `${state.monitoredSymbols.filter((s) => s.truthScore <= DATA_TRUTH_MIN_SCORE).length} symbols below threshold`,
    evidence: { monitoredSymbols: state.monitoredSymbols, avgScore },
    timestamp: new Date().toISOString(),
  };
}

function checkLatencyThresholds(): CertificationCheck {
  const state = getLatencyMetrics();
  const passed = state.avgLatencyMs < LATENCY_THRESHOLD_MS;

  return {
    check_id: `check_${randomUUID()}`,
    category: "latency_thresholds",
    name: "Average execution latency < 500ms",
    status: passed ? "pass" : "warning",
    required: true,
    score: passed ? 100 : Math.max(0, 100 - (state.avgLatencyMs - LATENCY_THRESHOLD_MS) / 5),
    details: passed
      ? `Current latency ${state.avgLatencyMs}ms is within acceptable range`
      : `Latency ${state.avgLatencyMs}ms exceeds threshold`,
    evidence: { avgLatencyMs: state.avgLatencyMs, thresholdMs: LATENCY_THRESHOLD_MS },
    timestamp: new Date().toISOString(),
  };
}

function checkAuthSecurity(): CertificationCheck {
  const state = getAuthSecurityState();
  const passed = state.operatorAuthConfigured && state.envValidationPasses && !state.hasFatalUnsafeConfigs;

  return {
    check_id: `check_${randomUUID()}`,
    category: "auth_security",
    name: "Operator authentication configured and env validation passes",
    status: passed ? "pass" : "fail",
    required: true,
    score: passed ? 100 : 0,
    details: passed
      ? "Operator auth configured, env validation passes, no fatal unsafe configs"
      : [
          !state.operatorAuthConfigured && "Operator auth not configured",
          !state.envValidationPasses && "Environment validation failed",
          state.hasFatalUnsafeConfigs && "Fatal unsafe configs detected",
        ]
          .filter(Boolean)
          .join("; "),
    evidence: {
      operatorAuthConfigured: state.operatorAuthConfigured,
      envValidationPasses: state.envValidationPasses,
      hasFatalUnsafeConfigs: state.hasFatalUnsafeConfigs,
    },
    timestamp: new Date().toISOString(),
  };
}

function checkDisasterDrillCompletion(): CertificationCheck {
  const state = getDisasterDrillState();
  const passed = state.completedDrillCount >= 1 && state.lastDrillSuccess;

  return {
    check_id: `check_${randomUUID()}`,
    category: "disaster_drill_completion",
    name: "At least 1 disaster drill completed successfully",
    status: passed ? "pass" : state.completedDrillCount >= 1 ? "warning" : "fail",
    required: true,
    score: passed ? 100 : state.completedDrillCount >= 1 ? 50 : 0,
    details: passed
      ? `${state.completedDrillCount} drill(s) completed, last was successful`
      : state.completedDrillCount >= 1
        ? `${state.completedDrillCount} drill(s) completed but last was unsuccessful`
        : "No disaster drills have been executed",
    evidence: { completedDrillCount: state.completedDrillCount, lastDrillSuccess: state.lastDrillSuccess },
    timestamp: new Date().toISOString(),
  };
}

function checkTestCoverage(): CertificationCheck {
  const state = getTestCoverageState();
  const coverageRatio = state.totalMajorModules > 0 ? state.majorModulesCovered / state.totalMajorModules : 0;
  const passed = state.hasTestFiles && coverageRatio >= 0.8;

  return {
    check_id: `check_${randomUUID()}`,
    category: "test_coverage",
    name: "Test files exist for all major modules (80%+ coverage)",
    status: passed ? "pass" : state.hasTestFiles ? "warning" : "fail",
    required: false,
    score: Math.round(coverageRatio * 100),
    details: passed
      ? `${state.majorModulesCovered}/${state.totalMajorModules} major modules have test coverage`
      : state.hasTestFiles
        ? `Only ${state.majorModulesCovered}/${state.totalMajorModules} modules covered (${(coverageRatio * 100).toFixed(1)}%)`
        : "No test files found",
    evidence: {
      hasTestFiles: state.hasTestFiles,
      majorModulesCovered: state.majorModulesCovered,
      totalMajorModules: state.totalMajorModules,
      coverageRatio,
    },
    timestamp: new Date().toISOString(),
  };
}

function checkDocumentationCompleteness(): CertificationCheck {
  const state = getDocumentationState();
  const passed = state.readmeExists && state.productionLogExists;

  return {
    check_id: `check_${randomUUID()}`,
    category: "documentation_completeness",
    name: "README and PRODUCTION_EXECUTION_LOG exist",
    status: passed ? "pass" : "fail",
    required: true,
    score: passed ? 100 : state.readmeExists || state.productionLogExists ? 50 : 0,
    details: passed
      ? "Both README and PRODUCTION_EXECUTION_LOG are present"
      : [!state.readmeExists && "README missing", !state.productionLogExists && "PRODUCTION_EXECUTION_LOG missing"]
          .filter(Boolean)
          .join(", "),
    evidence: { readmeExists: state.readmeExists, productionLogExists: state.productionLogExists },
    timestamp: new Date().toISOString(),
  };
}

// ─── Core Certification Logic ────────────────────────────────────────────────

function computeOverallScore(checks: CertificationCheck[]): number {
  if (checks.length === 0) return 0;
  const total = checks.reduce((sum, check) => sum + check.score, 0);
  return Math.round(total / checks.length);
}

function determineFinalStatus(checks: CertificationCheck[]): ReportStatus {
  const failedRequired = checks.filter((c) => c.required && c.status === "fail");
  const hasBlockers = failedRequired.length > 0;

  if (hasBlockers) return "fail";

  const allPass = checks.every((c) => c.status === "pass" || c.status === "skipped");
  return allPass ? "pass" : "pass_with_restrictions";
}

function extractCriticalBlockers(checks: CertificationCheck[]): string[] {
  return checks
    .filter((c) => c.required && c.status === "fail")
    .map((c) => `[${c.category}] ${c.name}: ${c.details}`);
}

function extractRestrictions(checks: CertificationCheck[]): string[] {
  return checks
    .filter((c) => c.status === "warning")
    .map((c) => `[${c.category}] ${c.name}: ${c.details}`);
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function runFullCertification(): CertificationReport {
  logger.info("Starting full certification run");

  const checks: CertificationCheck[] = [
    checkStrategyValidation(),
    checkReconciliationHealth(),
    checkDataTruth(),
    checkLatencyThresholds(),
    checkAuthSecurity(),
    checkDisasterDrillCompletion(),
    checkTestCoverage(),
    checkDocumentationCompleteness(),
  ];

  const passed_count = checks.filter((c) => c.status === "pass").length;
  const failed_count = checks.filter((c) => c.status === "fail").length;
  const warning_count = checks.filter((c) => c.status === "warning").length;

  const report: CertificationReport = {
    report_id: `cert_${randomUUID()}`,
    status: determineFinalStatus(checks),
    overall_score: computeOverallScore(checks),
    checks,
    passed_count,
    failed_count,
    warning_count,
    critical_blockers: extractCriticalBlockers(checks),
    restrictions: extractRestrictions(checks),
    generated_at: new Date().toISOString(),
  };

  reportsMap.set(report.report_id, report);
  lastReportId = report.report_id;

  logger.info(
    {
      report_id: report.report_id,
      status: report.status,
      score: report.overall_score,
      passed: passed_count,
      failed: failed_count,
      warnings: warning_count,
      blockers: report.critical_blockers.length,
    },
    "Certification run completed",
  );

  return report;
}

export function runCategoryCheck(category: CertificationCategory): CertificationCheck {
  logger.debug({ category }, "Running category-specific check");

  switch (category) {
    case "strategy_validation":
      return checkStrategyValidation();
    case "reconciliation_health":
      return checkReconciliationHealth();
    case "data_truth":
      return checkDataTruth();
    case "latency_thresholds":
      return checkLatencyThresholds();
    case "auth_security":
      return checkAuthSecurity();
    case "disaster_drill_completion":
      return checkDisasterDrillCompletion();
    case "test_coverage":
      return checkTestCoverage();
    case "documentation_completeness":
      return checkDocumentationCompleteness();
    default:
      const _exhaustive: never = category;
      throw new Error(`Unknown category: ${_exhaustive}`);
  }
}

export function getReport(report_id: string): CertificationReport | null {
  return reportsMap.get(report_id) ?? null;
}

export function getLatestReport(): CertificationReport | null {
  if (!lastReportId) return null;
  return getReport(lastReportId);
}

export function getAllReports(): CertificationReport[] {
  return Array.from(reportsMap.values()).sort(
    (a, b) => new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime(),
  );
}

export function _clearReports(): void {
  reportsMap.clear();
  lastReportId = null;
  logger.debug("Certification reports cleared");
}

export function getReportCount(): number {
  return reportsMap.size;
}
