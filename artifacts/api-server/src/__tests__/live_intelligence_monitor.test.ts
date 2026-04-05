import { describe, it, expect, beforeEach } from "vitest";
import {
  createAlert, acknowledgeAlert, getActiveAlerts,
  triggerNewsLockout, checkNewsLockout,
  updateRegime, getRegime,
  updateEngineHealth, getIntelligenceFeed,
  getLiveMonitorSnapshot, resetLiveMonitor,
} from "../lib/live_intelligence_monitor.js";

describe("Live Intelligence Monitor", () => {
  beforeEach(() => { resetLiveMonitor(); });

  it("creates and retrieves alerts", () => {
    const alert = createAlert({ severity: "WARNING", category: "ANOMALY", title: "Test", message: "Test msg" });
    expect(alert.severity).toBe("WARNING");
    expect(getActiveAlerts()).toHaveLength(1);
  });

  it("acknowledges alerts", () => {
    const alert = createAlert({ severity: "INFO", category: "ANOMALY", title: "X", message: "Y" });
    expect(acknowledgeAlert(alert.id)).toBe(true);
    expect(getActiveAlerts()).toHaveLength(0);
  });

  it("triggers news lockout and blocks trading", () => {
    triggerNewsLockout({ title: "FOMC", impact: "CRITICAL", lockoutMinutes: 60 });
    const lockout = checkNewsLockout();
    expect(lockout.active).toBe(true);
    expect(lockout.reason).toBe("FOMC");
    const feed = getIntelligenceFeed();
    expect(feed.tradingAllowed).toBe(false);
    expect(feed.overallRisk).toBe("EXTREME");
  });

  it("tracks regime changes and creates alerts", () => {
    updateRegime("TRENDING_UP", 0.8);
    expect(getRegime().current).toBe("TRENDING_UP");
    expect(getRegime().previousRegime).toBe("RANGING");

    updateRegime("CRISIS", 0.9);
    expect(getRegime().current).toBe("CRISIS");
    // Should have created regime change alerts
    expect(getActiveAlerts().some((a) => a.category === "REGIME_CHANGE")).toBe(true);
  });

  it("monitors engine health and alerts on DOWN", () => {
    updateEngineHealth("context_fusion", "DOWN", 999);
    const feed = getIntelligenceFeed();
    expect(feed.tradingAllowed).toBe(false); // down engine blocks trading
    expect(getActiveAlerts().some((a) => a.category === "ENGINE_HEALTH")).toBe(true);
  });

  it("generates unified intelligence feed", () => {
    const feed = getIntelligenceFeed();
    expect(feed.regime).toBeDefined();
    expect(feed.newsLockout).toBeDefined();
    expect(feed.engineHealth.length).toBeGreaterThan(0);
    expect(feed.tradingAllowed).toBe(true); // clean state
    expect(feed.overallRisk).toBe("LOW");
  });

  it("snapshot tracks telemetry", () => {
    createAlert({ severity: "INFO", category: "ANOMALY", title: "A", message: "B" });
    triggerNewsLockout({ title: "NFP", impact: "HIGH" });
    updateRegime("HIGH_VOLATILITY");
    const snap = getLiveMonitorSnapshot();
    expect(snap.totalAlerts).toBeGreaterThanOrEqual(3); // manual + lockout + regime
    expect(snap.newsLockouts).toBe(1);
    expect(snap.regimeChanges).toBe(1);
    expect(snap.currentRegime).toBe("HIGH_VOLATILITY");
  });

  it("resets cleanly", () => {
    createAlert({ severity: "CRITICAL", category: "RISK_BREACH", title: "X", message: "Y" });
    resetLiveMonitor();
    const snap = getLiveMonitorSnapshot();
    expect(snap.totalAlerts).toBe(0);
    expect(snap.activeAlerts).toBe(0);
    expect(snap.currentRegime).toBe("RANGING");
  });
});
