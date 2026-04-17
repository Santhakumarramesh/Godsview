import { describe, it, expect, beforeEach } from "vitest";
import {
  CertificationRunner,
  type CertificationGateStepName,
} from "../lib/certification_run";

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    strategyId: "strategy_alpha",
    strategyName: "Alpha Strategy",
    targetTier: "live_assisted" as const,
    symbols: ["SPY"],
    timeframe: "5m",
    backtestDateRange: {
      start: "2025-01-01",
      end: "2025-12-31",
    },
    walkforwardFolds: 5,
    stressScenarios: ["covid_crash"],
    shadowDurationMinutes: 180,
    paperTradeMinCount: 30,
    capitalAllocation: 50_000,
    ...overrides,
  };
}

describe("CertificationRunner", () => {
  let runner: CertificationRunner;

  beforeEach(() => {
    runner = new CertificationRunner();
  });

  it("initiates a run and creates all gate steps", async () => {
    const runId = await runner.initiate(makeConfig());
    const status = await runner.getRunStatus(runId);

    expect(status.runId).toBe(runId);
    expect(status.status).toBe("initiated");
    expect(status.steps).toHaveLength(7);
    expect(status.steps.every((step) => step.status === "pending")).toBe(true);
  });

  it("runs full certification and marks run certified when all gates pass", async () => {
    const runId = await runner.initiate(makeConfig());
    const result = await runner.runFull(runId);

    expect(result.status).toBe("certified");
    expect(result.governanceVerdict).toBe("promote");
    expect(result.gateResults).toHaveLength(7);
    expect(result.gateResults.every((gate) => gate.passed)).toBe(true);

    const status = await runner.getRunStatus(runId);
    expect(status.status).toBe("certified");
  });

  it("rejects the run when a gate fails", async () => {
    const runId = await runner.initiate(makeConfig());

    const backtest = await runner.executeStep(runId, "backtest", {
      sharpe: 0.1,
      winRate: 0.3,
      tradeCount: 10,
    });

    expect(backtest.status).toBe("failed");
    expect(backtest.result.passed).toBe(false);

    const status = await runner.getRunStatus(runId);
    expect(status.status).toBe("rejected");
  });

  it("records incidents and includes them in status", async () => {
    const runId = await runner.initiate(makeConfig());
    await runner.recordIncident(runId, {
      type: "data_gap",
      severity: "warning",
      message: "Temporary feed outage",
      occurredAt: new Date().toISOString(),
      details: { source: "alpaca" },
    });

    const status = await runner.getRunStatus(runId);
    expect(status.incidents).toHaveLength(1);
    expect(status.incidents[0].type).toBe("data_gap");
  });

  it("aborts a run and marks incomplete steps as skipped", async () => {
    const runId = await runner.initiate(makeConfig());
    await runner.executeStep(runId, "backtest");
    await runner.abort(runId, "Operator stop");

    const status = await runner.getRunStatus(runId);
    expect(status.status).toBe("aborted");

    const skipped = status.steps.filter((step) => step.status === "skipped");
    expect(skipped.length).toBe(6);
  });

  it("collects evidence packet even for partially executed runs", async () => {
    const runId = await runner.initiate(makeConfig());
    await runner.executeStep(runId, "backtest");

    const packet = await runner.collectEvidence(runId);
    expect(packet.gates).toHaveLength(7);
    expect(packet.all_gates_passed).toBe(false);
    expect(packet.summary).toContain("Failed");
  });

  it("rejects concurrent active runs for the same strategy", async () => {
    await runner.initiate(makeConfig());
    await expect(runner.initiate(makeConfig())).rejects.toThrow(
      "Active run already exists",
    );
  });

  it("marks expired runs as failed when queried", async () => {
    const runId = await runner.initiate(
      makeConfig({
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
      }),
    );

    const status = await runner.getRunStatus(runId);
    expect(status.status).toBe("failed");
    expect(status.steps.some((step) => step.status === "skipped")).toBe(true);
  });

  it("enforces sequential step execution", async () => {
    const runId = await runner.initiate(makeConfig());
    await expect(
      runner.executeStep(runId, "slippage" as CertificationGateStepName),
    ).rejects.toThrow("Cannot run step 'slippage' before 'backtest' is complete");
  });
});
