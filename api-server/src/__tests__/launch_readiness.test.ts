/**
 * Launch Readiness Tests — Pre-launch validation system.
 */
import { describe, it, expect } from "vitest";
import {
  evaluateLaunchReadiness,
  runChaosScenario,
  CHAOS_SCENARIOS,
} from "../lib/ops/launch_readiness";

describe("LaunchReadiness", () => {
  it("produces a structured launch report", () => {
    const report = evaluateLaunchReadiness();
    expect(report.timestamp).toBeTruthy();
    expect(["GO", "NO_GO", "CONDITIONAL"]).toContain(report.overallStatus);
    expect(report.totalChecks).toBeGreaterThan(10);
    expect(report.passed + report.failed + report.warnings + report.skipped).toBe(report.totalChecks);
  });

  it("all checks have required fields", () => {
    const report = evaluateLaunchReadiness();
    for (const check of report.checks) {
      expect(check.name).toBeTruthy();
      expect(["infrastructure", "safety", "data", "governance", "operations"]).toContain(check.category);
      expect(["pass", "fail", "warn", "skip"]).toContain(check.status);
      expect(typeof check.detail).toBe("string");
      expect(typeof check.required).toBe("boolean");
    }
  });

  it("safety checks include kill switch and exposure guards", () => {
    const report = evaluateLaunchReadiness();
    const safetyChecks = report.checks.filter(c => c.category === "safety");
    expect(safetyChecks.some(c => c.name.includes("Kill switch"))).toBe(true);
    expect(safetyChecks.some(c => c.name.includes("Exposure"))).toBe(true);
  });

  it("governance checks include strategy governor", () => {
    const report = evaluateLaunchReadiness();
    const govChecks = report.checks.filter(c => c.category === "governance");
    expect(govChecks.some(c => c.name.includes("governor"))).toBe(true);
  });

  it("blockers list only contains required failed checks", () => {
    const report = evaluateLaunchReadiness();
    for (const blocker of report.blockers) {
      expect(blocker).toContain("[BLOCKER]");
    }
  });

  it("NO_GO only if required checks fail", () => {
    const report = evaluateLaunchReadiness();
    if (report.overallStatus === "NO_GO") {
      expect(report.blockers.length).toBeGreaterThan(0);
    }
    if (report.blockers.length === 0) {
      expect(report.overallStatus).not.toBe("NO_GO");
    }
  });
});

describe("ChaosScenarios", () => {
  it("has at least 5 defined scenarios", () => {
    expect(CHAOS_SCENARIOS.length).toBeGreaterThanOrEqual(5);
  });

  it("all scenarios have name and description", () => {
    for (const scenario of CHAOS_SCENARIOS) {
      expect(scenario.name).toBeTruthy();
      expect(scenario.description).toBeTruthy();
      expect(typeof scenario.execute).toBe("function");
    }
  });

  it("scenarios execute and return results", async () => {
    for (const scenario of CHAOS_SCENARIOS) {
      const result = await runChaosScenario(scenario);
      expect(result.scenario).toBe(scenario.name);
      expect(typeof result.passed).toBe("boolean");
      expect(typeof result.duration_ms).toBe("number");
      expect(result.detail).toBeTruthy();
    }
  });
});
