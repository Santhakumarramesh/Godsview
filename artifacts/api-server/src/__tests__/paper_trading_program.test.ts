/**
 * paper_trading_program.test.ts — Phase 122: Paper Trading Program Tests
 *
 * Tests:
 *   - Program lifecycle: start → advance → pause → resume
 *   - Phase progression through 4 phases over 30 days
 *   - Signal and execution logging
 *   - Risk compliance reporting
 *   - Certification generation
 */

import { describe, it, expect, beforeEach } from "vitest";

const importModule = () => import("../lib/paper_trading_program/index");

// Valid config matching ProgramConfig interface
const validConfig = {
  strategies: ["test-strat-122"],
  symbols: ["AAPL", "MSFT"],
  capitalAllocation: 100000,
};

// ─── Program Lifecycle ──────────────────────────────────────────────────────

describe("PaperTradingProgram — Lifecycle", () => {
  it("should start a program with valid config", async () => {
    const mod = await importModule();
    const result = mod.startProgram(validConfig as any);
    expect(result.success).toBe(true);
    expect(result).toHaveProperty("status");
  });

  it("should return program status with expected fields", async () => {
    const mod = await importModule();
    mod.startProgram({
      strategies: ["test-strat-122b"],
      symbols: ["AAPL"],
      capitalAllocation: 100000,
    } as any);

    const status = mod.getProgramStatus();
    expect(status).toHaveProperty("status");
    expect(status).toHaveProperty("currentDay");
    expect(status).toHaveProperty("maxDays");
    expect(status).toHaveProperty("progressPercent");
    expect(status).toHaveProperty("currentPhase");
    expect(typeof status.progressPercent).toBe("number");
  });

  it("should advance day and increment counter", async () => {
    const mod = await importModule();
    mod.startProgram({
      strategies: ["test-advance"],
      symbols: ["AAPL"],
      capitalAllocation: 50000,
    } as any);

    const before = mod.getProgramStatus().currentDay;
    const result = mod.advanceDay();
    expect(result.success).toBe(true);
    expect(result.currentDay).toBe(before + 1);
  });

  it("should pause and resume program", async () => {
    const mod = await importModule();
    mod.startProgram({
      strategies: ["test-pause"],
      symbols: ["AAPL"],
      capitalAllocation: 50000,
    } as any);

    const pauseResult = mod.pauseProgram();
    expect(pauseResult.success).toBe(true);

    const status = mod.getProgramStatus();
    expect(status.isPaused).toBe(true);

    const resumeResult = mod.resumeProgram();
    expect(resumeResult.success).toBe(true);
  });
});

// ─── Phase Progression ──────────────────────────────────────────────────────

describe("PaperTradingProgram — Phases", () => {
  it("should start in Phase 1 (Signal Verification)", async () => {
    const mod = await importModule();
    mod.startProgram({
      strategies: ["test-phase-check"],
      symbols: ["AAPL"],
      capitalAllocation: 100000,
    } as any);

    const status = mod.getProgramStatus();
    expect(status.currentPhase).toBe(1);
  });

  it("should transition to Phase 2 after day 5", async () => {
    const mod = await importModule();
    mod.startProgram({
      strategies: ["test-phase-transition"],
      symbols: ["AAPL", "MSFT"],
      capitalAllocation: 100000,
    } as any);

    // Advance through days 1-5
    for (let i = 0; i < 5; i++) {
      mod.advanceDay();
    }

    const status = mod.getProgramStatus();
    expect(status.currentDay).toBeGreaterThanOrEqual(5);
    expect(status.currentPhase).toBeGreaterThanOrEqual(2);
  });

  it("should return phase report for each phase", async () => {
    const mod = await importModule();
    mod.startProgram({
      strategies: ["test-phase-report"],
      symbols: ["AAPL"],
      capitalAllocation: 100000,
    } as any);

    const report = mod.getPhaseReport(1);
    expect(report).toBeDefined();
    expect(typeof report).toBe("object");
  });
});

// ─── Logging ────────────────────────────────────────────────────────────────

describe("PaperTradingProgram — Logs", () => {
  it("should return signal log as array", async () => {
    const mod = await importModule();
    const log = mod.getSignalLog();
    expect(Array.isArray(log)).toBe(true);
  });

  it("should return execution log as array", async () => {
    const mod = await importModule();
    const log = mod.getExecutionLog();
    expect(Array.isArray(log)).toBe(true);
  });
});

// ─── Risk & Certification ───────────────────────────────────────────────────

describe("PaperTradingProgram — Risk & Certification", () => {
  it("should return risk compliance report with required fields", async () => {
    const mod = await importModule();
    mod.startProgram({
      strategies: ["test-risk-report"],
      symbols: ["AAPL"],
      capitalAllocation: 100000,
    } as any);

    const report = mod.getRiskComplianceReport();
    expect(report).toHaveProperty("guards");
    expect(report).toHaveProperty("overallCompliance");
  });

  it("should return strategy comparison report", async () => {
    const mod = await importModule();
    const report = mod.getStrategyComparisonReport();
    expect(report).toBeDefined();
    expect(report).toHaveProperty("comparisons");
    expect(report).toHaveProperty("summary");
  });

  it("should return certification status", async () => {
    const mod = await importModule();
    const cert = mod.getCertificationStatus();
    expect(cert).toBeDefined();
    expect(typeof cert).toBe("object");
  });

  it("should generate a full report", async () => {
    const mod = await importModule();
    mod.startProgram({
      strategies: ["test-full-report"],
      symbols: ["AAPL"],
      capitalAllocation: 100000,
    } as any);

    const report = mod.getFullReport();
    expect(report).toBeDefined();
    expect(typeof report).toBe("object");
  });
});
