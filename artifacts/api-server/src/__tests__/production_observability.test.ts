/**
 * Tests for production_observability.ts — Health reports, alert rules, operator summary.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  generateHealthReport,
  getOperatorSummary,
  ALERT_RULES,
} from "../lib/production_observability";
import {
  alignmentScore,
  unresolvedDriftEvents,
  championAccuracy,
  avgSlippageBps,
  reconciliationDiscrepancies,
  dailyPnl,
  openPositions,
} from "../lib/metrics";

// Reset gauge values before each test
beforeEach(() => {
  alignmentScore.set(0);
  unresolvedDriftEvents.set(0);
  championAccuracy.set(0);
  avgSlippageBps.set(0);
  reconciliationDiscrepancies.set(0);
  dailyPnl.set(0);
  openPositions.set(0);
});

// ── Health Report Structure ────────────────────────────────────

describe("generateHealthReport", () => {
  it("returns a valid report structure", () => {
    const report = generateHealthReport();
    expect(report).toHaveProperty("overall_status");
    expect(report).toHaveProperty("subsystems");
    expect(report).toHaveProperty("alerts");
    expect(report).toHaveProperty("timestamp");
    expect(report).toHaveProperty("uptime_seconds");
    expect(Array.isArray(report.subsystems)).toBe(true);
    expect(Array.isArray(report.alerts)).toBe(true);
  });

  it("includes all major subsystems", () => {
    const report = generateHealthReport();
    const names = report.subsystems.map(s => s.name);
    expect(names).toContain("execution_truth");
    expect(names).toContain("alignment");
    expect(names).toContain("ml_operations");
    expect(names).toContain("risk");
  });

  it("reports healthy when all metrics are nominal", () => {
    alignmentScore.set(0.85);
    championAccuracy.set(0.65);
    dailyPnl.set(50);
    const report = generateHealthReport();
    expect(report.overall_status).toBe("healthy");
    expect(report.alerts).toHaveLength(0);
  });

  it("reports degraded when alignment drops", () => {
    alignmentScore.set(0.55); // Below 0.70 threshold
    const report = generateHealthReport();
    const alignSys = report.subsystems.find(s => s.name === "alignment");
    expect(alignSys?.status).not.toBe("healthy");
  });

  it("reports critical when alignment is very low", () => {
    alignmentScore.set(0.20); // Below 0.40 critical threshold
    const report = generateHealthReport();
    expect(report.overall_status).toBe("critical");
  });

  it("reports critical on severe daily loss", () => {
    dailyPnl.set(-600); // Below -500 critical threshold
    const report = generateHealthReport();
    const riskSys = report.subsystems.find(s => s.name === "risk");
    expect(riskSys?.status).toBe("critical");
    expect(report.overall_status).toBe("critical");
  });
});

// ── Alert Rules ────────────────────────────────────────────────

describe("ALERT_RULES", () => {
  it("has at least 5 rules defined", () => {
    expect(ALERT_RULES.length).toBeGreaterThanOrEqual(5);
  });

  it("no alerts fire with all metrics at zero", () => {
    const fired = ALERT_RULES.filter(r => r.check().triggered);
    expect(fired).toHaveLength(0);
  });

  it("alignment rule fires when score drops", () => {
    alignmentScore.set(0.35);
    const rule = ALERT_RULES.find(r => r.name === "alignment_degraded");
    expect(rule).toBeDefined();
    const result = rule!.check();
    expect(result.triggered).toBe(true);
    expect(result.severity).toBe("critical");
  });

  it("slippage rule fires on high slippage", () => {
    avgSlippageBps.set(12);
    const rule = ALERT_RULES.find(r => r.name === "high_slippage");
    expect(rule).toBeDefined();
    const result = rule!.check();
    expect(result.triggered).toBe(true);
    expect(result.severity).toBe("warning");
  });

  it("slippage rule fires critical on very high slippage", () => {
    avgSlippageBps.set(25);
    const rule = ALERT_RULES.find(r => r.name === "high_slippage");
    const result = rule!.check();
    expect(result.triggered).toBe(true);
    expect(result.severity).toBe("critical");
  });

  it("daily loss rule fires on significant loss", () => {
    dailyPnl.set(-300);
    const rule = ALERT_RULES.find(r => r.name === "daily_loss_limit");
    const result = rule!.check();
    expect(result.triggered).toBe(true);
    expect(result.severity).toBe("warning");
  });

  it("champion accuracy rule fires when accuracy drops", () => {
    championAccuracy.set(0.48);
    const rule = ALERT_RULES.find(r => r.name === "champion_accuracy_low");
    const result = rule!.check();
    expect(result.triggered).toBe(true);
    expect(result.severity).toBe("critical");
  });

  it("unresolved drift rule fires with multiple events", () => {
    unresolvedDriftEvents.set(3);
    const rule = ALERT_RULES.find(r => r.name === "unresolved_drift");
    const result = rule!.check();
    expect(result.triggered).toBe(true);
    expect(result.severity).toBe("warning");
  });

  it("each rule has a message function", () => {
    for (const rule of ALERT_RULES) {
      const msg = rule.message(42);
      expect(typeof msg).toBe("string");
      expect(msg.length).toBeGreaterThan(0);
    }
  });
});

// ── Operator Summary ──────────────────────────────────────────

describe("getOperatorSummary", () => {
  it("returns a non-empty string", () => {
    const summary = getOperatorSummary();
    expect(typeof summary).toBe("string");
    expect(summary.length).toBeGreaterThan(0);
  });

  it("includes GodsView header", () => {
    const summary = getOperatorSummary();
    expect(summary).toContain("[GodsView]");
  });

  it("includes status in uppercase", () => {
    const summary = getOperatorSummary();
    expect(summary).toMatch(/Status: (HEALTHY|DEGRADED|CRITICAL|UNKNOWN)/);
  });

  it("includes subsystem statuses", () => {
    const summary = getOperatorSummary();
    expect(summary).toContain("Subsystems:");
    expect(summary).toContain("execution_truth=");
    expect(summary).toContain("alignment=");
  });

  it("includes alert details when alerts are active", () => {
    dailyPnl.set(-600);
    const summary = getOperatorSummary();
    expect(summary).toContain("Alerts:");
    expect(summary).toContain("[critical]");
  });
});
