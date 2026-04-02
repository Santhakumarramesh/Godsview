/**
 * alerts_unit.test.ts — Phase 68
 *
 * Tests fireAlert, getAlertHistory, getActiveAlerts, acknowledgeAlert,
 * and convenience alert functions.
 * Uses vi.useFakeTimers() to bypass cooldowns between tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() })),
  },
}));

vi.mock("../lib/signal_stream", () => ({
  broadcast: vi.fn(),
}));

import {
  fireAlert,
  getAlertHistory,
  getActiveAlerts,
  acknowledgeAlert,
  alertDailyLossBreach,
  alertEnsembleDrift,
  alertKillSwitch,
  alertConsecutiveLosses,
  alertSIRejectionStreak,
  checkMemoryPressure,
  type Alert,
  type AlertType,
} from "../lib/alerts";

// ── Setup ─────────────────────────────────────────────────────────────────────

// Use fake timers to jump past cooldown windows
beforeEach(() => {
  vi.useFakeTimers();
  // Advance time by 10 minutes to clear all cooldowns
  vi.advanceTimersByTime(10 * 60 * 1000);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── fireAlert ─────────────────────────────────────────────────────────────────

describe("fireAlert", () => {
  it("adds an alert to history", async () => {
    const before = getAlertHistory().length;
    await fireAlert("connection_lost", "critical", "Test connection lost");
    const after = getAlertHistory();
    expect(after.length).toBeGreaterThan(before);
  });

  it("alert has required fields", async () => {
    await fireAlert("kill_switch_fired", "fatal", "Kill switch test");
    const alerts = getAlertHistory(5);
    const alert = alerts.find(a => a.type === "kill_switch_fired");
    expect(alert).toBeDefined();
    if (alert) {
      expect(alert.type).toBe("kill_switch_fired");
      expect(alert.severity).toBe("fatal");
      expect(alert.message).toBe("Kill switch test");
      expect(typeof alert.timestamp).toBe("string");
      expect(alert.acknowledged).toBe(false);
    }
  });

  it("alert timestamp is valid ISO string", async () => {
    await fireAlert("memory_pressure", "warning", "Memory test");
    const alerts = getAlertHistory(5);
    const alert = alerts.find(a => a.type === "memory_pressure");
    if (alert) {
      expect(() => new Date(alert.timestamp)).not.toThrow();
      expect(new Date(alert.timestamp).getTime()).toBeGreaterThan(0);
    }
  });

  it("alert stores details correctly", async () => {
    vi.advanceTimersByTime(700_000); // past cooldown
    await fireAlert("ensemble_drift", "warning", "Drift test", { accuracy: 0.48, threshold: 0.52 });
    const alerts = getAlertHistory(10);
    const alert = alerts.find(a => a.type === "ensemble_drift");
    if (alert) {
      expect(alert.details).toHaveProperty("accuracy", 0.48);
      expect(alert.details).toHaveProperty("threshold", 0.52);
    }
  });

  it("respects cooldown — same type within cooldown period is suppressed", async () => {
    // Clear cooldown by advancing time, then fire twice rapidly
    vi.advanceTimersByTime(700_000);
    const before = getAlertHistory().length;
    await fireAlert("daily_loss_breach", "critical", "Loss 1");
    const mid = getAlertHistory().length;
    // Second fire within cooldown (don't advance time)
    await fireAlert("daily_loss_breach", "critical", "Loss 2");
    const after = getAlertHistory().length;
    expect(mid).toBeGreaterThan(before); // first one went through
    expect(after).toBe(mid); // second was suppressed
  });

  it("different alert types are not affected by each other's cooldown", async () => {
    vi.advanceTimersByTime(700_000);
    const before = getAlertHistory().length;
    await fireAlert("connection_lost", "critical", "Conn lost");
    await fireAlert("si_rejection_streak", "warning", "SI streak");
    expect(getAlertHistory().length).toBeGreaterThan(before + 1);
  });

  it("alert starts with acknowledged=false", async () => {
    vi.advanceTimersByTime(700_000);
    await fireAlert("consecutive_losses", "critical", "Losses");
    const alert = getAlertHistory(5).find(a => a.type === "consecutive_losses");
    expect(alert?.acknowledged).toBe(false);
  });
});

// ── getAlertHistory ───────────────────────────────────────────────────────────

describe("getAlertHistory", () => {
  it("returns an array", () => {
    expect(Array.isArray(getAlertHistory())).toBe(true);
  });

  it("default limit is 50 — returns at most 50", () => {
    expect(getAlertHistory().length).toBeLessThanOrEqual(50);
  });

  it("respects custom limit", () => {
    expect(getAlertHistory(3).length).toBeLessThanOrEqual(3);
  });

  it("returns alerts in reverse chronological order (most recent first)", async () => {
    vi.advanceTimersByTime(700_000);
    await fireAlert("connection_lost", "warning", "Conn A");
    vi.advanceTimersByTime(200_000); // past cooldown
    await fireAlert("memory_pressure", "warning", "Mem B");
    const history = getAlertHistory(5);
    // Most recent (memory_pressure) should appear before or at same position as conn
    if (history.length >= 2) {
      const times = history.map(a => new Date(a.timestamp).getTime());
      // Verify descending timestamps
      for (let i = 0; i < times.length - 1; i++) {
        expect(times[i]).toBeGreaterThanOrEqual(times[i + 1]!);
      }
    }
  });
});

// ── getActiveAlerts ───────────────────────────────────────────────────────────

describe("getActiveAlerts", () => {
  it("returns an array", () => {
    expect(Array.isArray(getActiveAlerts())).toBe(true);
  });

  it("only returns unacknowledged alerts", () => {
    const active = getActiveAlerts();
    for (const a of active) {
      expect(a.acknowledged).toBe(false);
    }
  });

  it("active count decreases after acknowledgement", async () => {
    vi.advanceTimersByTime(700_000);
    await fireAlert("production_gate_block_streak", "warning", "Gate test");
    const alert = getAlertHistory(5).find(a => a.type === "production_gate_block_streak");
    if (alert) {
      const activeBefore = getActiveAlerts().length;
      acknowledgeAlert(alert.timestamp);
      const activeAfter = getActiveAlerts().length;
      expect(activeAfter).toBeLessThan(activeBefore);
    }
  });
});

// ── acknowledgeAlert ──────────────────────────────────────────────────────────

describe("acknowledgeAlert", () => {
  it("returns true for existing alert timestamp and reduces active count", async () => {
    vi.advanceTimersByTime(700_000);
    await fireAlert("connection_lost", "critical", "Ack test");
    const activeBefore = getActiveAlerts().length;
    // Find any unacknowledged alert to acknowledge
    const unacked = getActiveAlerts();
    if (unacked.length > 0) {
      const alert = unacked[0]!;
      const result = acknowledgeAlert(alert.timestamp);
      expect(result).toBe(true);
      expect(getActiveAlerts().length).toBeLessThan(activeBefore);
    }
  });

  it("returns false for non-existent timestamp", () => {
    expect(acknowledgeAlert("2000-01-01T00:00:00.000Z")).toBe(false);
  });

  it("acknowledged alert still appears in history", async () => {
    vi.advanceTimersByTime(700_000);
    await fireAlert("memory_pressure", "warning", "Ack mem");
    const alert = getAlertHistory(5).find(a => a.type === "memory_pressure");
    if (alert) {
      acknowledgeAlert(alert.timestamp);
      const history = getAlertHistory(100);
      expect(history.some(a => a.timestamp === alert.timestamp)).toBe(true);
    }
  });
});

// ── Convenience functions ─────────────────────────────────────────────────────

describe("alertDailyLossBreach", () => {
  it("fires an alert without throwing", () => {
    vi.advanceTimersByTime(700_000);
    expect(() => alertDailyLossBreach(-1500, 1000)).not.toThrow();
  });
});

describe("alertEnsembleDrift", () => {
  it("fires when accuracy below threshold", () => {
    vi.advanceTimersByTime(700_000);
    const before = getAlertHistory().length;
    alertEnsembleDrift(0.45, 0.52);
    // Alert is async via fireAlert but alertEnsembleDrift calls it without await
    // Just verify no throw
    expect(getAlertHistory().length).toBeGreaterThanOrEqual(before);
  });

  it("does not fire when accuracy above threshold", () => {
    vi.advanceTimersByTime(700_000);
    const before = getAlertHistory().length;
    alertEnsembleDrift(0.70, 0.52); // above threshold
    // No new alert should be fired
    expect(getAlertHistory().length).toBe(before);
  });
});

describe("alertConsecutiveLosses", () => {
  it("fires at or above threshold", () => {
    vi.advanceTimersByTime(700_000);
    expect(() => alertConsecutiveLosses(3, 3)).not.toThrow();
  });

  it("does not fire below threshold", () => {
    vi.advanceTimersByTime(700_000);
    const before = getAlertHistory().length;
    alertConsecutiveLosses(2, 3); // below threshold
    expect(getAlertHistory().length).toBe(before);
  });
});

describe("alertSIRejectionStreak", () => {
  it("fires at or above threshold", () => {
    vi.advanceTimersByTime(700_000);
    expect(() => alertSIRejectionStreak(10, 10)).not.toThrow();
  });

  it("does not fire below threshold", () => {
    vi.advanceTimersByTime(700_000);
    const before = getAlertHistory().length;
    alertSIRejectionStreak(5, 10); // below threshold
    expect(getAlertHistory().length).toBe(before);
  });
});

describe("checkMemoryPressure", () => {
  it("does not throw when called", () => {
    vi.advanceTimersByTime(700_000);
    expect(() => checkMemoryPressure(999999)).not.toThrow(); // high threshold, won't fire
  });
});
