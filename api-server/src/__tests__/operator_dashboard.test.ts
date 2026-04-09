import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("pino", () => ({
  default: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("pino-pretty", () => ({ default: vi.fn() }));
vi.mock("../lib/risk_engine", () => ({ evaluateRisk: vi.fn() }));
vi.mock("../lib/drawdown_breaker", () => ({ checkDrawdown: vi.fn() }));

import {
  setSystemMode,
  registerStrategy,
  updateStrategyCard,
  getStrategyCards,
  createAlert,
  acknowledgeAlert,
  getActiveAlerts,
  getAllAlerts,
  generateDailyBrief,
  getBrief,
  getAllBriefs,
  getSystemOverview,
  _clearDashboard,
  StrategyCard,
} from "../lib/operator_dashboard";

describe("OperatorDashboard Module", () => {
  beforeEach(() => {
    _clearDashboard();
  });

  describe("System Mode", () => {
    it("should set system mode", () => {
      const result = setSystemMode("staging");
      expect(result.success).toBe(true);

      const overview = getSystemOverview();
      expect(overview.mode).toBe("staging");
    });

    it("should allow all valid modes", () => {
      const modes = ["live", "staging", "dev", "maintenance"] as const;
      for (const mode of modes) {
        const result = setSystemMode(mode);
        expect(result.success).toBe(true);
      }
    });
  });

  describe("Strategy Registration", () => {
    it("should register a strategy", () => {
      const card: StrategyCard = {
        strategy_id: "strat_001",
        strategy_name: "Momentum",
        status: "active",
        daily_pnl: 1500,
        win_rate: 0.65,
        exposure: 0.15,
        last_trade: "2026-04-09T15:30:00Z",
        alerts_count: 0,
      };

      const result = registerStrategy(card);
      expect(result.strategy_id).toBe("strat_001");
      expect(result.strategy_name).toBe("Momentum");
    });

    it("should retrieve all registered strategies", () => {
      const c1: StrategyCard = {
        strategy_id: "strat_002",
        strategy_name: "Mean Reversion",
        status: "active",
        daily_pnl: 1000,
        win_rate: 0.6,
        exposure: 0.1,
        last_trade: "2026-04-09T14:00:00Z",
        alerts_count: 1,
      };

      const c2: StrategyCard = {
        strategy_id: "strat_003",
        strategy_name: "Arbitrage",
        status: "active",
        daily_pnl: 2000,
        win_rate: 0.72,
        exposure: 0.12,
        last_trade: "2026-04-09T15:45:00Z",
        alerts_count: 0,
      };

      registerStrategy(c1);
      registerStrategy(c2);

      const cards = getStrategyCards();
      expect(cards).toHaveLength(2);
      expect(cards.map(c => c.strategy_id)).toContain("strat_002");
      expect(cards.map(c => c.strategy_id)).toContain("strat_003");
    });

    it("should update strategy card", () => {
      const card: StrategyCard = {
        strategy_id: "strat_004",
        strategy_name: "Original",
        status: "active",
        daily_pnl: 500,
        win_rate: 0.5,
        exposure: 0.1,
        last_trade: "2026-04-09T12:00:00Z",
        alerts_count: 0,
      };

      registerStrategy(card);

      const result = updateStrategyCard("strat_004", {
        daily_pnl: 2000,
        status: "paused",
        alerts_count: 2,
      });

      expect(result.success).toBe(true);

      const updated = getStrategyCards().find(c => c.strategy_id === "strat_004");
      expect(updated?.daily_pnl).toBe(2000);
      expect(updated?.status).toBe("paused");
      expect(updated?.alerts_count).toBe(2);
    });

    it("should fail to update non-existent strategy", () => {
      const result = updateStrategyCard("strat_missing", { daily_pnl: 1000 });
      expect(result.success).toBe(false);
      expect(result.error).toBe("Strategy not found");
    });
  });

  describe("Alert Management", () => {
    it("should create an alert", () => {
      const alert = createAlert({
        strategy_id: "strat_005",
        severity: "warning",
        message: "Drawdown approaching threshold",
      });

      expect(alert.id).toMatch(/^oa_/);
      expect(alert.strategy_id).toBe("strat_005");
      expect(alert.severity).toBe("warning");
      expect(alert.message).toBe("Drawdown approaching threshold");
      expect(alert.acknowledged_at).toBeUndefined();
    });

    it("should create alerts with all severity levels", () => {
      const severities = ["fatal", "critical", "warning", "info"] as const;
      for (const severity of severities) {
        const alert = createAlert({
          strategy_id: "strat_006",
          severity,
          message: `${severity} level alert`,
        });
        expect(alert.severity).toBe(severity);
      }
    });

    it("should acknowledge an alert", () => {
      const alert = createAlert({
        strategy_id: "strat_007",
        severity: "critical",
        message: "Critical issue",
      });

      const result = acknowledgeAlert(alert.id, "operator_john");
      expect(result.success).toBe(true);

      const active = getActiveAlerts();
      expect(active.find(a => a.id === alert.id)).toBeUndefined();
    });

    it("should prevent double acknowledgment", () => {
      const alert = createAlert({
        strategy_id: "strat_008",
        severity: "warning",
        message: "Test",
      });

      acknowledgeAlert(alert.id, "op1");
      const result2 = acknowledgeAlert(alert.id, "op2");

      expect(result2.success).toBe(false);
      expect(result2.error).toBe("Alert already acknowledged");
    });

    it("should fail to acknowledge non-existent alert", () => {
      const result = acknowledgeAlert("oa_missing", "operator");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Alert not found");
    });

    it("should retrieve only active (unacknowledged) alerts", () => {
      const a1 = createAlert({
        strategy_id: "strat_009",
        severity: "warning",
        message: "Alert 1",
      });

      const a2 = createAlert({
        strategy_id: "strat_009",
        severity: "critical",
        message: "Alert 2",
      });

      acknowledgeAlert(a1.id, "op");

      const active = getActiveAlerts();
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe(a2.id);
    });

    it("should retrieve all alerts with limit", () => {
      for (let i = 0; i < 5; i++) {
        createAlert({
          strategy_id: "strat_010",
          severity: "info",
          message: `Alert ${i}`,
        });
      }

      const limited = getAllAlerts(2);
      expect(limited).toHaveLength(2);
    });
  });

  describe("Daily Brief", () => {
    it("should generate daily brief", () => {
      const card: StrategyCard = {
        strategy_id: "strat_011",
        strategy_name: "Test Strategy",
        status: "active",
        daily_pnl: 1500,
        win_rate: 0.65,
        exposure: 0.1,
        last_trade: "2026-04-09T15:00:00Z",
        alerts_count: 1,
      };

      registerStrategy(card);
      createAlert({ strategy_id: "strat_011", severity: "warning", message: "Test" });

      const brief = generateDailyBrief();

      expect(brief.id).toMatch(/^db_/);
      expect(brief.strategies_count).toBe(1);
      expect(brief.total_pnl).toBe(1500);
      expect(brief.system_health).toBe("healthy");
    });

    it("should set health to degraded with critical alerts", () => {
      const card: StrategyCard = {
        strategy_id: "strat_012",
        strategy_name: "At Risk",
        status: "active",
        daily_pnl: 500,
        win_rate: 0.5,
        exposure: 0.15,
        last_trade: "2026-04-09T14:00:00Z",
        alerts_count: 2,
      };

      registerStrategy(card);
      createAlert({ strategy_id: "strat_012", severity: "critical", message: "Critical" });

      const brief = generateDailyBrief();
      expect(brief.system_health).toBe("degraded");
    });

    it("should set health to critical with fatal alerts", () => {
      createAlert({ strategy_id: "strat_013", severity: "fatal", message: "Fatal" });

      const brief = generateDailyBrief();
      expect(brief.system_health).toBe("critical");
    });

    it("should include top performers in brief", () => {
      const cards: StrategyCard[] = [
        {
          strategy_id: "strat_014",
          strategy_name: "Top 1",
          status: "active",
          daily_pnl: 5000,
          win_rate: 0.7,
          exposure: 0.1,
          last_trade: "2026-04-09T15:00:00Z",
          alerts_count: 0,
        },
        {
          strategy_id: "strat_015",
          strategy_name: "Top 2",
          status: "active",
          daily_pnl: 3000,
          win_rate: 0.65,
          exposure: 0.12,
          last_trade: "2026-04-09T14:30:00Z",
          alerts_count: 0,
        },
        {
          strategy_id: "strat_016",
          strategy_name: "Low",
          status: "active",
          daily_pnl: 500,
          win_rate: 0.5,
          exposure: 0.08,
          last_trade: "2026-04-09T13:00:00Z",
          alerts_count: 1,
        },
      ];

      cards.forEach(registerStrategy);

      const brief = generateDailyBrief();
      expect(brief.top_performers).toHaveLength(3);
      expect(brief.top_performers[0].daily_pnl).toBeGreaterThanOrEqual(brief.top_performers[1].daily_pnl);
    });

    it("should retrieve brief by ID", () => {
      const brief1 = generateDailyBrief();
      const brief2 = generateDailyBrief();

      const retrieved = getBrief(brief1.id);
      expect(retrieved?.id).toBe(brief1.id);

      const all = getAllBriefs();
      expect(all).toHaveLength(2);
    });

    it("should retrieve briefs with limit", () => {
      for (let i = 0; i < 5; i++) {
        generateDailyBrief();
      }

      const limited = getAllBriefs(3);
      expect(limited).toHaveLength(3);
    });
  });

  describe("System Overview", () => {
    it("should return system overview with default state", () => {
      const overview = getSystemOverview();

      expect(overview.mode).toBe("dev");
      expect(overview.active_strategies).toBe(0);
      expect(overview.daily_pnl).toBe(0);
      expect(overview.system_health).toBe("healthy");
      expect(overview.total_alerts).toBe(0);
      expect(overview.fatal_alerts).toBe(0);
    });

    it("should count active strategies correctly", () => {
      registerStrategy({
        strategy_id: "strat_017",
        strategy_name: "Active 1",
        status: "active",
        daily_pnl: 1000,
        win_rate: 0.6,
        exposure: 0.1,
        last_trade: "2026-04-09T15:00:00Z",
        alerts_count: 0,
      });

      registerStrategy({
        strategy_id: "strat_018",
        strategy_name: "Paused",
        status: "paused",
        daily_pnl: 500,
        win_rate: 0.5,
        exposure: 0.08,
        last_trade: "2026-04-09T14:00:00Z",
        alerts_count: 0,
      });

      const overview = getSystemOverview();
      expect(overview.active_strategies).toBe(1);
    });

    it("should sum daily PnL across strategies", () => {
      registerStrategy({
        strategy_id: "strat_019",
        strategy_name: "S1",
        status: "active",
        daily_pnl: 2000,
        win_rate: 0.6,
        exposure: 0.1,
        last_trade: "2026-04-09T15:00:00Z",
        alerts_count: 0,
      });

      registerStrategy({
        strategy_id: "strat_020",
        strategy_name: "S2",
        status: "active",
        daily_pnl: 1500,
        win_rate: 0.65,
        exposure: 0.12,
        last_trade: "2026-04-09T14:00:00Z",
        alerts_count: 0,
      });

      const overview = getSystemOverview();
      expect(overview.daily_pnl).toBe(3500);
    });

    it("should reflect alert counts in overview", () => {
      createAlert({ strategy_id: "strat_021", severity: "warning", message: "W1" });
      createAlert({ strategy_id: "strat_021", severity: "critical", message: "C1" });
      createAlert({ strategy_id: "strat_021", severity: "fatal", message: "F1" });

      const overview = getSystemOverview();
      expect(overview.total_alerts).toBe(3);
      expect(overview.fatal_alerts).toBe(1);
    });

    it("should not count acknowledged alerts in overview", () => {
      const a1 = createAlert({ strategy_id: "strat_022", severity: "critical", message: "C" });
      const a2 = createAlert({ strategy_id: "strat_022", severity: "warning", message: "W" });

      acknowledgeAlert(a1.id, "op");

      const overview = getSystemOverview();
      expect(overview.total_alerts).toBe(1);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty dashboard state", () => {
      const overview = getSystemOverview();
      const cards = getStrategyCards();
      const alerts = getActiveAlerts();
      const briefs = getAllBriefs();

      expect(overview.active_strategies).toBe(0);
      expect(cards).toHaveLength(0);
      expect(alerts).toHaveLength(0);
      expect(briefs).toHaveLength(0);
    });

    it("should handle negative PnL", () => {
      registerStrategy({
        strategy_id: "strat_023",
        strategy_name: "Losing",
        status: "active",
        daily_pnl: -1500,
        win_rate: 0.4,
        exposure: 0.15,
        last_trade: "2026-04-09T15:00:00Z",
        alerts_count: 2,
      });

      const overview = getSystemOverview();
      expect(overview.daily_pnl).toBe(-1500);
    });

    it("should preserve strategy_id when updating", () => {
      const original: StrategyCard = {
        strategy_id: "strat_024",
        strategy_name: "Unchanged ID",
        status: "active",
        daily_pnl: 1000,
        win_rate: 0.6,
        exposure: 0.1,
        last_trade: "2026-04-09T15:00:00Z",
        alerts_count: 0,
      };

      registerStrategy(original);
      updateStrategyCard("strat_024", { strategy_name: "New Name" });

      const updated = getStrategyCards().find(c => c.strategy_id === "strat_024");
      expect(updated?.strategy_id).toBe("strat_024");
    });

    it("should generate unique brief IDs", () => {
      const b1 = generateDailyBrief();
      const b2 = generateDailyBrief();

      expect(b1.id).not.toBe(b2.id);
    });

    it("should timestamp alerts and briefs", () => {
      const alert = createAlert({ strategy_id: "strat_025", severity: "info", message: "Info" });
      const brief = generateDailyBrief();

      expect(alert.created_at).toBeDefined();
      expect(brief.created_at).toBeDefined();

      const alertTime = new Date(alert.created_at);
      const briefTime = new Date(brief.created_at);

      expect(alertTime.getFullYear()).toBe(2026);
      expect(briefTime.getFullYear()).toBe(2026);
    });

    it("should handle special characters in messages", () => {
      const alert = createAlert({
        strategy_id: "strat_026",
        severity: "warning",
        message: "Alert: [CRITICAL] Strategy-v2.0 (TEST) failed!",
      });

      expect(alert.message).toContain("[CRITICAL]");
      expect(alert.message).toContain("Strategy-v2.0");
    });
  });

  describe("_clearDashboard", () => {
    it("should clear all dashboard state", () => {
      registerStrategy({
        strategy_id: "strat_027",
        strategy_name: "To Clear",
        status: "active",
        daily_pnl: 1000,
        win_rate: 0.6,
        exposure: 0.1,
        last_trade: "2026-04-09T15:00:00Z",
        alerts_count: 0,
      });

      createAlert({ strategy_id: "strat_027", severity: "warning", message: "To Clear" });
      generateDailyBrief();

      _clearDashboard();

      expect(getStrategyCards()).toHaveLength(0);
      expect(getActiveAlerts()).toHaveLength(0);
      expect(getAllBriefs()).toHaveLength(0);

      const overview = getSystemOverview();
      expect(overview.mode).toBe("dev");
    });
  });
});
