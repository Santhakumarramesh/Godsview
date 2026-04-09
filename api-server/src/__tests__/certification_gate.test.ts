/**
 * __tests__/certification_gate.test.ts — Phase 36: Certification Gate Tests
 *
 * Comprehensive test suite covering:
 * - Full certification runs
 * - Individual category checks
 * - Pass/fail/warning scenarios
 * - Critical blocker detection
 * - Report generation and retrieval
 * - Pass-with-restrictions handling
 * - Edge cases and error conditions
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  runFullCertification,
  runCategoryCheck,
  getReport,
  getLatestReport,
  getAllReports,
  _clearReports,
  getReportCount,
  type CertificationReport,
  type CertificationCheck,
  type CertificationCategory,
} from "../lib/certification_gate";

// ─── Mock Setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  _clearReports();
  // Clear all mocks
  (global as any).__MOCK_STRATEGY_STATE = null;
  (global as any).__MOCK_RECONCILIATION_STATE = null;
  (global as any).__MOCK_DATA_TRUTH_STATE = null;
  (global as any).__MOCK_LATENCY_STATE = null;
  (global as any).__MOCK_AUTH_STATE = null;
  (global as any).__MOCK_DISASTER_DRILL_STATE = null;
  (global as any).__MOCK_TEST_COVERAGE_STATE = null;
  (global as any).__MOCK_DOCUMENTATION_STATE = null;
});

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    child: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    }),
  },
}));

vi.mock("../lib/risk_engine", () => ({
  getRiskEngineSnapshot: vi.fn(),
  setKillSwitchActive: vi.fn(),
}));

vi.mock("../lib/drawdown_breaker", () => ({
  recordRealizedPnl: vi.fn(),
  getBreakerSnapshot: vi.fn(),
}));

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe("Certification Gate", () => {
  // ── Full Certification Runs ──────────────────────────────────────────────

  it("should generate a full certification report", () => {
    (global as any).__MOCK_STRATEGY_STATE = { hasValidatedStrategy: true, readinessScore: 75 };
    (global as any).__MOCK_RECONCILIATION_STATE = {
      lastRunTime: new Date().toISOString(),
      hasCriticalMismatches: false,
    };
    (global as any).__MOCK_AUTH_STATE = {
      operatorAuthConfigured: true,
      envValidationPasses: true,
      hasFatalUnsafeConfigs: false,
    };
    (global as any).__MOCK_DISASTER_DRILL_STATE = { completedDrillCount: 1, lastDrillSuccess: true };
    (global as any).__MOCK_DOCUMENTATION_STATE = { readmeExists: true, productionLogExists: true };
    (global as any).__MOCK_LATENCY_STATE = { avgLatencyMs: 250 };

    const report = runFullCertification();

    expect(report).toBeDefined();
    expect(report.report_id).toMatch(/^cert_/);
    expect(report.checks).toHaveLength(8);
    expect(report.generated_at).toBeDefined();
  });

  it("should have pass status when all required checks pass", () => {
    (global as any).__MOCK_STRATEGY_STATE = { hasValidatedStrategy: true, readinessScore: 75 };
    (global as any).__MOCK_RECONCILIATION_STATE = {
      lastRunTime: new Date().toISOString(),
      hasCriticalMismatches: false,
    };
    (global as any).__MOCK_AUTH_STATE = {
      operatorAuthConfigured: true,
      envValidationPasses: true,
      hasFatalUnsafeConfigs: false,
    };
    (global as any).__MOCK_DISASTER_DRILL_STATE = { completedDrillCount: 1, lastDrillSuccess: true };
    (global as any).__MOCK_DOCUMENTATION_STATE = { readmeExists: true, productionLogExists: true };
    (global as any).__MOCK_LATENCY_STATE = { avgLatencyMs: 250 };
    (global as any).__MOCK_TEST_COVERAGE_STATE = {
      hasTestFiles: true,
      majorModulesCovered: 20,
      totalMajorModules: 20,
    };

    const report = runFullCertification();

    expect(report.status).toBe("pass");
    expect(report.critical_blockers).toHaveLength(0);
  });

  it("should have fail status when required checks fail", () => {
    (global as any).__MOCK_STRATEGY_STATE = { hasValidatedStrategy: false, readinessScore: 30 };
    (global as any).__MOCK_RECONCILIATION_STATE = { lastRunTime: null, hasCriticalMismatches: false };
    (global as any).__MOCK_AUTH_STATE = {
      operatorAuthConfigured: false,
      envValidationPasses: false,
      hasFatalUnsafeConfigs: true,
    };
    (global as any).__MOCK_DISASTER_DRILL_STATE = { completedDrillCount: 0, lastDrillSuccess: false };
    (global as any).__MOCK_DOCUMENTATION_STATE = { readmeExists: false, productionLogExists: false };

    const report = runFullCertification();

    expect(report.status).toBe("fail");
    expect(report.critical_blockers.length).toBeGreaterThan(0);
  });

  it("should have pass_with_restrictions status when non-required checks warn", () => {
    (global as any).__MOCK_STRATEGY_STATE = { hasValidatedStrategy: true, readinessScore: 75 };
    (global as any).__MOCK_RECONCILIATION_STATE = {
      lastRunTime: new Date().toISOString(),
      hasCriticalMismatches: false,
    };
    (global as any).__MOCK_AUTH_STATE = {
      operatorAuthConfigured: true,
      envValidationPasses: true,
      hasFatalUnsafeConfigs: false,
    };
    (global as any).__MOCK_DISASTER_DRILL_STATE = { completedDrillCount: 1, lastDrillSuccess: true };
    (global as any).__MOCK_DOCUMENTATION_STATE = { readmeExists: true, productionLogExists: true };
    (global as any).__MOCK_LATENCY_STATE = { avgLatencyMs: 250 };
    // Data truth has no symbols (skipped)
    (global as any).__MOCK_DATA_TRUTH_STATE = { monitoredSymbols: [] };
    // Test coverage below 80%
    (global as any).__MOCK_TEST_COVERAGE_STATE = {
      hasTestFiles: true,
      majorModulesCovered: 15,
      totalMajorModules: 20,
    };

    const report = runFullCertification();

    expect(report.status).toBe("pass_with_restrictions");
    expect(report.critical_blockers).toHaveLength(0);
    expect(report.restrictions.length).toBeGreaterThanOrEqual(0);
  });

  it("should calculate overall score from all checks", () => {
    (global as any).__MOCK_STRATEGY_STATE = { hasValidatedStrategy: true, readinessScore: 100 };
    (global as any).__MOCK_RECONCILIATION_STATE = {
      lastRunTime: new Date().toISOString(),
      hasCriticalMismatches: false,
    };
    (global as any).__MOCK_AUTH_STATE = {
      operatorAuthConfigured: true,
      envValidationPasses: true,
      hasFatalUnsafeConfigs: false,
    };
    (global as any).__MOCK_DISASTER_DRILL_STATE = { completedDrillCount: 1, lastDrillSuccess: true };
    (global as any).__MOCK_DOCUMENTATION_STATE = { readmeExists: true, productionLogExists: true };
    (global as any).__MOCK_LATENCY_STATE = { avgLatencyMs: 100 };
    (global as any).__MOCK_TEST_COVERAGE_STATE = {
      hasTestFiles: true,
      majorModulesCovered: 20,
      totalMajorModules: 20,
    };

    const report = runFullCertification();

    expect(report.overall_score).toBeGreaterThan(0);
    expect(report.overall_score).toBeLessThanOrEqual(100);
  });

  it("should count passed, failed, and warning checks", () => {
    (global as any).__MOCK_STRATEGY_STATE = { hasValidatedStrategy: true, readinessScore: 75 };
    (global as any).__MOCK_RECONCILIATION_STATE = {
      lastRunTime: new Date().toISOString(),
      hasCriticalMismatches: false,
    };
    (global as any).__MOCK_AUTH_STATE = {
      operatorAuthConfigured: true,
      envValidationPasses: true,
      hasFatalUnsafeConfigs: false,
    };
    (global as any).__MOCK_DISASTER_DRILL_STATE = { completedDrillCount: 1, lastDrillSuccess: true };
    (global as any).__MOCK_DOCUMENTATION_STATE = { readmeExists: true, productionLogExists: true };
    (global as any).__MOCK_LATENCY_STATE = { avgLatencyMs: 600 }; // Above threshold = warning
    (global as any).__MOCK_TEST_COVERAGE_STATE = {
      hasTestFiles: true,
      majorModulesCovered: 16,
      totalMajorModules: 20,
    };

    const report = runFullCertification();

    expect(report.passed_count).toBeGreaterThan(0);
    // Verify counts add up: note skipped checks are not counted in pass/fail/warning
    const countedStatuses = report.passed_count + report.failed_count + report.warning_count;
    const skippedCount = report.checks.filter((c) => c.status === "skipped").length;
    expect(countedStatuses + skippedCount).toBe(report.checks.length);
  });

  // ── Individual Category Checks ───────────────────────────────────────────

  it("should run strategy_validation check", () => {
    (global as any).__MOCK_STRATEGY_STATE = { hasValidatedStrategy: true, readinessScore: 75 };

    const check = runCategoryCheck("strategy_validation");

    expect(check.category).toBe("strategy_validation");
    expect(check.status).toBe("pass");
    expect(check.required).toBe(true);
  });

  it("should run reconciliation_health check", () => {
    (global as any).__MOCK_RECONCILIATION_STATE = {
      lastRunTime: new Date().toISOString(),
      hasCriticalMismatches: false,
    };

    const check = runCategoryCheck("reconciliation_health");

    expect(check.category).toBe("reconciliation_health");
    expect(check.status).toBe("pass");
    expect(check.required).toBe(true);
  });

  it("should run data_truth check", () => {
    (global as any).__MOCK_DATA_TRUTH_STATE = {
      monitoredSymbols: [
        { symbol: "BTCUSD", truthScore: 0.85 },
        { symbol: "ETHUSD", truthScore: 0.9 },
      ],
    };

    const check = runCategoryCheck("data_truth");

    expect(check.category).toBe("data_truth");
    expect(check.required).toBe(false);
  });

  it("should skip data_truth check when no monitored symbols", () => {
    (global as any).__MOCK_DATA_TRUTH_STATE = { monitoredSymbols: [] };

    const check = runCategoryCheck("data_truth");

    expect(check.status).toBe("skipped");
  });

  it("should run latency_thresholds check", () => {
    (global as any).__MOCK_LATENCY_STATE = { avgLatencyMs: 250 };

    const check = runCategoryCheck("latency_thresholds");

    expect(check.category).toBe("latency_thresholds");
    expect(check.status).toBe("pass");
    expect(check.required).toBe(true);
  });

  it("should warn when latency exceeds threshold", () => {
    (global as any).__MOCK_LATENCY_STATE = { avgLatencyMs: 700 };

    const check = runCategoryCheck("latency_thresholds");

    expect(check.status).toBe("warning");
    expect(check.details).toContain("700");
  });

  it("should run auth_security check", () => {
    (global as any).__MOCK_AUTH_STATE = {
      operatorAuthConfigured: true,
      envValidationPasses: true,
      hasFatalUnsafeConfigs: false,
    };

    const check = runCategoryCheck("auth_security");

    expect(check.category).toBe("auth_security");
    expect(check.status).toBe("pass");
    expect(check.required).toBe(true);
  });

  it("should fail auth_security when auth not configured", () => {
    (global as any).__MOCK_AUTH_STATE = {
      operatorAuthConfigured: false,
      envValidationPasses: true,
      hasFatalUnsafeConfigs: false,
    };

    const check = runCategoryCheck("auth_security");

    expect(check.status).toBe("fail");
    expect(check.details).toContain("Operator auth not configured");
  });

  it("should run disaster_drill_completion check", () => {
    (global as any).__MOCK_DISASTER_DRILL_STATE = { completedDrillCount: 1, lastDrillSuccess: true };

    const check = runCategoryCheck("disaster_drill_completion");

    expect(check.category).toBe("disaster_drill_completion");
    expect(check.status).toBe("pass");
    expect(check.required).toBe(true);
  });

  it("should warn when disaster drill not successful", () => {
    (global as any).__MOCK_DISASTER_DRILL_STATE = { completedDrillCount: 1, lastDrillSuccess: false };

    const check = runCategoryCheck("disaster_drill_completion");

    expect(check.status).toBe("warning");
  });

  it("should run test_coverage check", () => {
    (global as any).__MOCK_TEST_COVERAGE_STATE = {
      hasTestFiles: true,
      majorModulesCovered: 20,
      totalMajorModules: 20,
    };

    const check = runCategoryCheck("test_coverage");

    expect(check.category).toBe("test_coverage");
    expect(check.required).toBe(false);
  });

  it("should run documentation_completeness check", () => {
    (global as any).__MOCK_DOCUMENTATION_STATE = { readmeExists: true, productionLogExists: true };

    const check = runCategoryCheck("documentation_completeness");

    expect(check.category).toBe("documentation_completeness");
    expect(check.status).toBe("pass");
    expect(check.required).toBe(true);
  });

  it("should fail documentation when README missing", () => {
    (global as any).__MOCK_DOCUMENTATION_STATE = { readmeExists: false, productionLogExists: true };

    const check = runCategoryCheck("documentation_completeness");

    expect(check.status).toBe("fail");
    expect(check.details).toContain("README");
  });

  // ── Report Retrieval ─────────────────────────────────────────────────────

  it("should get a report by ID", () => {
    (global as any).__MOCK_STRATEGY_STATE = { hasValidatedStrategy: true, readinessScore: 75 };
    (global as any).__MOCK_RECONCILIATION_STATE = {
      lastRunTime: new Date().toISOString(),
      hasCriticalMismatches: false,
    };
    (global as any).__MOCK_AUTH_STATE = {
      operatorAuthConfigured: true,
      envValidationPasses: true,
      hasFatalUnsafeConfigs: false,
    };
    (global as any).__MOCK_DISASTER_DRILL_STATE = { completedDrillCount: 1, lastDrillSuccess: true };
    (global as any).__MOCK_DOCUMENTATION_STATE = { readmeExists: true, productionLogExists: true };

    const generatedReport = runFullCertification();
    const retrieved = getReport(generatedReport.report_id);

    expect(retrieved).toBeDefined();
    expect(retrieved!.report_id).toBe(generatedReport.report_id);
  });

  it("should return null when report ID not found", () => {
    const report = getReport("cert_nonexistent");
    expect(report).toBeNull();
  });

  it("should get latest report", () => {
    (global as any).__MOCK_STRATEGY_STATE = { hasValidatedStrategy: true, readinessScore: 75 };
    (global as any).__MOCK_RECONCILIATION_STATE = {
      lastRunTime: new Date().toISOString(),
      hasCriticalMismatches: false,
    };
    (global as any).__MOCK_AUTH_STATE = {
      operatorAuthConfigured: true,
      envValidationPasses: true,
      hasFatalUnsafeConfigs: false,
    };
    (global as any).__MOCK_DISASTER_DRILL_STATE = { completedDrillCount: 1, lastDrillSuccess: true };
    (global as any).__MOCK_DOCUMENTATION_STATE = { readmeExists: true, productionLogExists: true };

    const report1 = runFullCertification();
    expect(getLatestReport()!.report_id).toBe(report1.report_id);
  });

  it("should return null when no reports exist", () => {
    expect(getLatestReport()).toBeNull();
  });

  it("should get all reports in reverse chronological order", () => {
    (global as any).__MOCK_STRATEGY_STATE = { hasValidatedStrategy: true, readinessScore: 75 };
    (global as any).__MOCK_RECONCILIATION_STATE = {
      lastRunTime: new Date().toISOString(),
      hasCriticalMismatches: false,
    };
    (global as any).__MOCK_AUTH_STATE = {
      operatorAuthConfigured: true,
      envValidationPasses: true,
      hasFatalUnsafeConfigs: false,
    };
    (global as any).__MOCK_DISASTER_DRILL_STATE = { completedDrillCount: 1, lastDrillSuccess: true };
    (global as any).__MOCK_DOCUMENTATION_STATE = { readmeExists: true, productionLogExists: true };

    runFullCertification();
    runFullCertification();
    runFullCertification();

    const all = getAllReports();
    expect(all.length).toBe(3);
    expect(new Date(all[0]!.generated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(all[1]!.generated_at).getTime(),
    );
  });

  // ── Clear and Count ──────────────────────────────────────────────────────

  it("should clear all reports", () => {
    (global as any).__MOCK_STRATEGY_STATE = { hasValidatedStrategy: true, readinessScore: 75 };
    (global as any).__MOCK_RECONCILIATION_STATE = {
      lastRunTime: new Date().toISOString(),
      hasCriticalMismatches: false,
    };
    (global as any).__MOCK_AUTH_STATE = {
      operatorAuthConfigured: true,
      envValidationPasses: true,
      hasFatalUnsafeConfigs: false,
    };
    (global as any).__MOCK_DISASTER_DRILL_STATE = { completedDrillCount: 1, lastDrillSuccess: true };
    (global as any).__MOCK_DOCUMENTATION_STATE = { readmeExists: true, productionLogExists: true };

    runFullCertification();
    expect(getAllReports()).toHaveLength(1);

    _clearReports();
    expect(getAllReports()).toHaveLength(0);
    expect(getLatestReport()).toBeNull();
  });

  it("should return correct report count", () => {
    (global as any).__MOCK_STRATEGY_STATE = { hasValidatedStrategy: true, readinessScore: 75 };
    (global as any).__MOCK_RECONCILIATION_STATE = {
      lastRunTime: new Date().toISOString(),
      hasCriticalMismatches: false,
    };
    (global as any).__MOCK_AUTH_STATE = {
      operatorAuthConfigured: true,
      envValidationPasses: true,
      hasFatalUnsafeConfigs: false,
    };
    (global as any).__MOCK_DISASTER_DRILL_STATE = { completedDrillCount: 1, lastDrillSuccess: true };
    (global as any).__MOCK_DOCUMENTATION_STATE = { readmeExists: true, productionLogExists: true };

    expect(getReportCount()).toBe(0);
    runFullCertification();
    expect(getReportCount()).toBe(1);
    runFullCertification();
    expect(getReportCount()).toBe(2);
  });

  // ── Edge Cases and Validation ────────────────────────────────────────────

  it("should have unique check IDs", () => {
    (global as any).__MOCK_STRATEGY_STATE = { hasValidatedStrategy: true, readinessScore: 75 };
    (global as any).__MOCK_RECONCILIATION_STATE = {
      lastRunTime: new Date().toISOString(),
      hasCriticalMismatches: false,
    };
    (global as any).__MOCK_AUTH_STATE = {
      operatorAuthConfigured: true,
      envValidationPasses: true,
      hasFatalUnsafeConfigs: false,
    };
    (global as any).__MOCK_DISASTER_DRILL_STATE = { completedDrillCount: 1, lastDrillSuccess: true };
    (global as any).__MOCK_DOCUMENTATION_STATE = { readmeExists: true, productionLogExists: true };

    const report = runFullCertification();
    const checkIds = report.checks.map((c) => c.check_id);
    const uniqueIds = new Set(checkIds);

    expect(uniqueIds.size).toBe(checkIds.length);
  });

  it("should have timestamps on checks and reports", () => {
    (global as any).__MOCK_STRATEGY_STATE = { hasValidatedStrategy: true, readinessScore: 75 };
    (global as any).__MOCK_RECONCILIATION_STATE = {
      lastRunTime: new Date().toISOString(),
      hasCriticalMismatches: false,
    };
    (global as any).__MOCK_AUTH_STATE = {
      operatorAuthConfigured: true,
      envValidationPasses: true,
      hasFatalUnsafeConfigs: false,
    };
    (global as any).__MOCK_DISASTER_DRILL_STATE = { completedDrillCount: 1, lastDrillSuccess: true };
    (global as any).__MOCK_DOCUMENTATION_STATE = { readmeExists: true, productionLogExists: true };

    const report = runFullCertification();

    expect(report.generated_at).toBeDefined();
    for (const check of report.checks) {
      expect(check.timestamp).toBeDefined();
      expect(new Date(check.timestamp).getTime()).toBeLessThanOrEqual(Date.now());
    }
  });

  it("should have evidence field on checks", () => {
    (global as any).__MOCK_STRATEGY_STATE = { hasValidatedStrategy: true, readinessScore: 75 };

    const check = runCategoryCheck("strategy_validation");

    expect(check.evidence).toBeDefined();
    expect(typeof check.evidence).toBe("object");
  });

  it("should extract critical blockers correctly", () => {
    (global as any).__MOCK_STRATEGY_STATE = { hasValidatedStrategy: false, readinessScore: 30 };
    (global as any).__MOCK_RECONCILIATION_STATE = { lastRunTime: null, hasCriticalMismatches: false };
    (global as any).__MOCK_AUTH_STATE = {
      operatorAuthConfigured: false,
      envValidationPasses: false,
      hasFatalUnsafeConfigs: true,
    };
    (global as any).__MOCK_DISASTER_DRILL_STATE = { completedDrillCount: 0, lastDrillSuccess: false };
    (global as any).__MOCK_DOCUMENTATION_STATE = { readmeExists: false, productionLogExists: false };

    const report = runFullCertification();

    expect(report.critical_blockers.length).toBeGreaterThan(0);
    for (const blocker of report.critical_blockers) {
      expect(blocker).toMatch(/\[.*\]/);
    }
  });

  it("should have proper score ranges", () => {
    (global as any).__MOCK_STRATEGY_STATE = { hasValidatedStrategy: true, readinessScore: 75 };
    (global as any).__MOCK_RECONCILIATION_STATE = {
      lastRunTime: new Date().toISOString(),
      hasCriticalMismatches: false,
    };
    (global as any).__MOCK_AUTH_STATE = {
      operatorAuthConfigured: true,
      envValidationPasses: true,
      hasFatalUnsafeConfigs: false,
    };
    (global as any).__MOCK_DISASTER_DRILL_STATE = { completedDrillCount: 1, lastDrillSuccess: true };
    (global as any).__MOCK_DOCUMENTATION_STATE = { readmeExists: true, productionLogExists: true };

    const report = runFullCertification();

    expect(report.overall_score).toBeGreaterThanOrEqual(0);
    expect(report.overall_score).toBeLessThanOrEqual(100);

    for (const check of report.checks) {
      expect(check.score).toBeGreaterThanOrEqual(0);
      expect(check.score).toBeLessThanOrEqual(100);
    }
  });
});
