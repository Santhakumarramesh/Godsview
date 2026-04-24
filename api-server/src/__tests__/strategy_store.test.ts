/**
 * Strategy Store Tests — Validates persistent storage abstraction.
 */
import { describe, it, expect } from "vitest";
import {
  createStrategy,
  getStrategy,
  listStrategies,
  updateStrategyStatus,
  recordPromotion,
  getPromotionHistory,
  recordEvidence,
  getLatestEvidence,
  recordCalibration,
  getCalibrationHistory,
  getCriticalDriftStrategies,
  recordTradeOutcome,
  getTradeOutcomes,
  getRecentOutcomes,
  logKillSwitch,
  getKillSwitchHistory,
  getStorageStats,
} from "../lib/storage/strategy_store";

describe("StrategyStore", () => {
  it("creates and retrieves a strategy", async () => {
    const s = await createStrategy({ name: "RSI Mean Revert", rawInput: "buy oversold RSI" });
    expect(s.id).toBeTruthy();
    expect(s.status).toBe("draft");
    expect(s.version).toBe(1);

    const fetched = await getStrategy(s.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe("RSI Mean Revert");
  });

  it("lists strategies with optional status filter", async () => {
    await createStrategy({ name: "Strat A" });
    const all = await listStrategies();
    expect(all.length).toBeGreaterThan(0);

    const drafts = await listStrategies("draft");
    expect(drafts.every(s => s.status === "draft")).toBe(true);
  });

  it("updates strategy status", async () => {
    const s = await createStrategy({ name: "Status Test" });
    await updateStrategyStatus(s.id, "backtested");
    const updated = await getStrategy(s.id);
    expect(updated!.status).toBe("backtested");
  });

  it("records and retrieves promotion events", async () => {
    const s = await createStrategy({ name: "Promo Test" });
    const promo = await recordPromotion({
      strategyId: s.id,
      fromStatus: "draft",
      toStatus: "parsed",
      approvedBy: "operator",
      reason: "Strategy parsed successfully",
    });
    expect(promo.id).toBeTruthy();
    expect(promo.toStatus).toBe("parsed");

    const history = await getPromotionHistory(s.id);
    expect(history.length).toBe(1);

    // Verify strategy status was also updated
    const updated = await getStrategy(s.id);
    expect(updated!.status).toBe("parsed");
  });

  it("records and retrieves evidence packets", async () => {
    const s = await createStrategy({ name: "Evidence Test" });
    await recordEvidence({
      strategyId: s.id,
      backtestSharpe: 1.8,
      backtestWinRate: 0.62,
      backtestMaxDrawdown: -0.12,
      backtestSampleSize: 500,
      riskLimitsPass: true,
    });

    const latest = await getLatestEvidence(s.id);
    expect(latest).not.toBeNull();
    expect(latest!.backtestSharpe).toBe(1.8);
    expect(latest!.riskLimitsPass).toBe(true);
  });

  it("records calibration and detects critical drift", async () => {
    const s = await createStrategy({ name: "Drift Test" });
    await recordCalibration({
      strategyId: s.id,
      backtestWinRate: 0.60,
      liveWinRate: 0.32,
      drift: -0.28,
      driftSeverity: "critical",
      sampleSize: 100,
    });

    const history = await getCalibrationHistory(s.id);
    expect(history.length).toBe(1);
    expect(history[0].driftSeverity).toBe("critical");

    const critical = await getCriticalDriftStrategies();
    expect(critical.some(c => c.strategyId === s.id)).toBe(true);
  });

  it("records and retrieves trade outcomes", async () => {
    const s = await createStrategy({ name: "Outcome Test" });
    await recordTradeOutcome({
      strategyId: s.id,
      symbol: "AAPL",
      side: "buy",
      entryPrice: 150.0,
      exitPrice: 155.0,
      quantity: 10,
      pnl: 50.0,
      pnlPercent: 3.33,
      executionMode: "paper",
      enteredAt: new Date(),
      exitedAt: new Date(),
    });

    const outcomes = await getTradeOutcomes(s.id);
    expect(outcomes.length).toBe(1);
    expect(outcomes[0].pnl).toBe(50.0);

    const recent = await getRecentOutcomes();
    expect(recent.length).toBeGreaterThan(0);
  });

  it("logs kill switch events", async () => {
    await logKillSwitch("activate", "Daily loss limit breached", "risk_system");
    const history = await getKillSwitchHistory();
    expect(history.length).toBeGreaterThan(0);
    expect(history[history.length - 1].action).toBe("activate");
  });

  it("reports storage stats", async () => {
    const stats = await getStorageStats();
    expect(stats.driver).toBe("memory");
    expect(typeof stats.strategies).toBe("number");
    expect(typeof stats.outcomes).toBe("number");
  });
});
