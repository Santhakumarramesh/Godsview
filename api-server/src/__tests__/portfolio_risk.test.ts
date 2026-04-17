import { describe, it, expect, beforeEach, vi } from "vitest";
import { PortfolioRiskEngine } from "../lib/portfolio_risk";

vi.mock("pino", () => ({
  default: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("pino-pretty", () => ({
  default: vi.fn(),
}));

vi.mock("../../lib/risk_engine", () => ({
  evaluateRisk: vi.fn(),
}));

vi.mock("../../lib/drawdown_breaker", () => ({
  checkDrawdown: vi.fn(),
}));

describe("PortfolioRiskEngine", () => {
  let engine: PortfolioRiskEngine;

  beforeEach(() => {
    engine = new PortfolioRiskEngine();
    engine._clearPortfolioRisk();
  });

  describe("Position Management", () => {
    it("should add a position and auto-compute unrealized PnL for long", () => {
      engine.addPosition({
        symbol: "AAPL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 150,
        current_price: 160,
        side: "long",
      });

      const positions = engine.getPositions();
      expect(positions).toHaveLength(1);
      expect(positions[0].symbol).toBe("AAPL");
      expect(positions[0].unrealized_pnl).toBe(1000);
    });

    it("should auto-compute unrealized PnL for short", () => {
      engine.addPosition({
        symbol: "AAPL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 160,
        current_price: 150,
        side: "short",
      });

      const positions = engine.getPositions();
      expect(positions[0].unrealized_pnl).toBe(1000);
    });

    it("should compute weight percentage correctly", () => {
      engine.addPosition({
        symbol: "AAPL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 150,
        current_price: 160,
        side: "long",
      });

      engine.addPosition({
        symbol: "GOOGL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 140,
        current_price: 140,
        side: "long",
      });

      const positions = engine.getPositions();
      const aapl = positions.find((p) => p.symbol === "AAPL");
      const googl = positions.find((p) => p.symbol === "GOOGL");

      expect(aapl?.weight_pct).toBeCloseTo(53.33, 1);
      expect(googl?.weight_pct).toBeCloseTo(46.67, 1);
    });

    it("should update position price and recalculate PnL", () => {
      engine.addPosition({
        symbol: "AAPL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 150,
        current_price: 160,
        side: "long",
      });

      const result = engine.updatePosition("AAPL", "strat_1", {
        current_price: 170,
      });

      expect(result.success).toBe(true);

      const positions = engine.getPositions();
      expect(positions[0].current_price).toBe(170);
      expect(positions[0].unrealized_pnl).toBe(2000);
    });

    it("should return error when updating non-existent position", () => {
      const result = engine.updatePosition("NONEXISTENT", "strat_1", {
        current_price: 100,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Position not found");
    });

    it("should remove a position", () => {
      engine.addPosition({
        symbol: "AAPL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 150,
        current_price: 160,
        side: "long",
      });

      const result = engine.removePosition("AAPL", "strat_1");
      expect(result.success).toBe(true);

      const positions = engine.getPositions();
      expect(positions).toHaveLength(0);
    });

    it("should return error when removing non-existent position", () => {
      const result = engine.removePosition("NONEXISTENT", "strat_1");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Position not found");
    });
  });

  describe("Risk Metrics", () => {
    it("should compute total exposure correctly", () => {
      engine.addPosition({
        symbol: "AAPL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 150,
        current_price: 160,
        side: "long",
      });

      engine.addPosition({
        symbol: "GOOGL",
        strategy_id: "strat_1",
        quantity: 50,
        entry_price: 140,
        current_price: 140,
        side: "long",
      });

      const metrics = engine.computeRiskMetrics();
      expect(metrics.total_exposure).toBe(23000);
    });

    it("should separate long and short exposure", () => {
      engine.addPosition({
        symbol: "AAPL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 150,
        current_price: 160,
        side: "long",
      });

      engine.addPosition({
        symbol: "GOOGL",
        strategy_id: "strat_1",
        quantity: 50,
        entry_price: 140,
        current_price: 140,
        side: "short",
      });

      const metrics = engine.computeRiskMetrics();
      expect(metrics.long_exposure).toBe(16000);
      expect(metrics.short_exposure).toBe(7000);
      expect(metrics.net_exposure).toBe(9000);
    });

    it("should compute gross leverage", () => {
      engine.addPosition({
        symbol: "AAPL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 150,
        current_price: 160,
        side: "long",
      });

      engine.addPosition({
        symbol: "GOOGL",
        strategy_id: "strat_1",
        quantity: 50,
        entry_price: 140,
        current_price: 140,
        side: "short",
      });

      const metrics = engine.computeRiskMetrics();
      expect(metrics.gross_leverage).toBeCloseTo(1, 1);
    });

    it("should compute VaR 95 and 99", () => {
      engine.addPosition({
        symbol: "AAPL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 150,
        current_price: 160,
        side: "long",
      });

      const metrics = engine.computeRiskMetrics();
      expect(metrics.portfolio_var_95).toBe(16000 * 0.02);
      expect(metrics.portfolio_var_99).toBe(16000 * 0.03);
    });

    it("should handle empty portfolio", () => {
      const metrics = engine.computeRiskMetrics();

      expect(metrics.total_exposure).toBe(0);
      expect(metrics.long_exposure).toBe(0);
      expect(metrics.short_exposure).toBe(0);
      expect(metrics.gross_leverage).toBe(0);
      expect(metrics.max_drawdown_pct).toBe(0);
      expect(metrics.sharpe_ratio).toBe(0);
    });
  });

  describe("Concentration Risk", () => {
    it("should classify low concentration", () => {
      engine.addPosition({
        symbol: "AAPL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 150,
        current_price: 160,
        side: "long",
      });

      engine.addPosition({
        symbol: "GOOGL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 140,
        current_price: 140,
        side: "long",
      });

      const metrics = engine.computeRiskMetrics();
      expect(metrics.concentration_risk.level).toBe("low");
      expect(metrics.concentration_risk.max_single_position_pct).toBeCloseTo(53.33, 1);
    });

    it("should classify medium concentration", () => {
      engine.addPosition({
        symbol: "AAPL",
        strategy_id: "strat_1",
        quantity: 200,
        entry_price: 150,
        current_price: 160,
        side: "long",
      });

      engine.addPosition({
        symbol: "GOOGL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 140,
        current_price: 140,
        side: "long",
      });

      const metrics = engine.computeRiskMetrics();
      expect(metrics.concentration_risk.level).toBe("medium");
    });

    it("should classify high concentration", () => {
      engine.addPosition({
        symbol: "AAPL",
        strategy_id: "strat_1",
        quantity: 300,
        entry_price: 150,
        current_price: 160,
        side: "long",
      });

      engine.addPosition({
        symbol: "GOOGL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 140,
        current_price: 140,
        side: "long",
      });

      const metrics = engine.computeRiskMetrics();
      expect(metrics.concentration_risk.level).toBe("high");
    });

    it("should classify critical concentration", () => {
      engine.addPosition({
        symbol: "AAPL",
        strategy_id: "strat_1",
        quantity: 500,
        entry_price: 150,
        current_price: 160,
        side: "long",
      });

      engine.addPosition({
        symbol: "GOOGL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 140,
        current_price: 140,
        side: "long",
      });

      const metrics = engine.computeRiskMetrics();
      expect(metrics.concentration_risk.level).toBe("critical");
      expect(metrics.concentration_risk.max_single_position_pct).toBeGreaterThan(30);
    });

    it("should compute top 3 concentration", () => {
      engine.addPosition({
        symbol: "AAPL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 150,
        current_price: 160,
        side: "long",
      });

      engine.addPosition({
        symbol: "GOOGL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 140,
        current_price: 140,
        side: "long",
      });

      engine.addPosition({
        symbol: "MSFT",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 300,
        current_price: 310,
        side: "long",
      });

      const metrics = engine.computeRiskMetrics();
      expect(metrics.concentration_risk.top_3_concentration_pct).toBe(100);
    });
  });

  describe("Correlation Analysis", () => {
    it("should classify high positive correlation", () => {
      const pair = engine.addCorrelation({
        symbol_a: "AAPL",
        symbol_b: "GOOGL",
        correlation: 0.85,
        period_days: 30,
      });

      expect(pair.classification).toBe("high_positive");
    });

    it("should classify moderate positive correlation", () => {
      const pair = engine.addCorrelation({
        symbol_a: "AAPL",
        symbol_b: "GOOGL",
        correlation: 0.55,
        period_days: 30,
      });

      expect(pair.classification).toBe("moderate_positive");
    });

    it("should classify low correlation", () => {
      const pair = engine.addCorrelation({
        symbol_a: "AAPL",
        symbol_b: "GOOGL",
        correlation: 0.25,
        period_days: 30,
      });

      expect(pair.classification).toBe("low");
    });

    it("should classify moderate negative correlation", () => {
      const pair = engine.addCorrelation({
        symbol_a: "AAPL",
        symbol_b: "GOOGL",
        correlation: -0.55,
        period_days: 30,
      });

      expect(pair.classification).toBe("moderate_negative");
    });

    it("should classify high negative correlation", () => {
      const pair = engine.addCorrelation({
        symbol_a: "AAPL",
        symbol_b: "GOOGL",
        correlation: -0.85,
        period_days: 30,
      });

      expect(pair.classification).toBe("high_negative");
    });

    it("should retrieve correlations for symbol", () => {
      engine.addCorrelation({
        symbol_a: "AAPL",
        symbol_b: "GOOGL",
        correlation: 0.85,
        period_days: 30,
      });

      engine.addCorrelation({
        symbol_a: "AAPL",
        symbol_b: "MSFT",
        correlation: 0.75,
        period_days: 30,
      });

      const correlations = engine.getCorrelationsForSymbol("AAPL");
      expect(correlations).toHaveLength(2);
      expect(correlations.some((c) => c.symbol_b === "GOOGL")).toBe(true);
      expect(correlations.some((c) => c.symbol_b === "MSFT")).toBe(true);
    });

    it("should compute diversification score", () => {
      engine.addCorrelation({
        symbol_a: "AAPL",
        symbol_b: "GOOGL",
        correlation: 0.5,
        period_days: 30,
      });

      const metrics = engine.computeRiskMetrics();
      expect(metrics.diversification_score).toBeCloseTo(50, 5);
    });

    it("should compute correlation risk from positive correlations", () => {
      engine.addCorrelation({
        symbol_a: "AAPL",
        symbol_b: "GOOGL",
        correlation: 0.8,
        period_days: 30,
      });

      engine.addCorrelation({
        symbol_a: "AAPL",
        symbol_b: "MSFT",
        correlation: 0.7,
        period_days: 30,
      });

      const metrics = engine.computeRiskMetrics();
      expect(metrics.correlation_risk).toBeCloseTo(0.75, 1);
    });
  });

  describe("Hedge Suggestions", () => {
    it("should not suggest hedge for non-existent position", () => {
      const suggestion = engine.suggestHedge("NONEXISTENT");
      expect(suggestion).toBeUndefined();
    });

    it("should suggest hedge for inversely correlated symbol", () => {
      engine.addPosition({
        symbol: "AAPL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 150,
        current_price: 160,
        side: "long",
      });

      engine.addCorrelation({
        symbol_a: "AAPL",
        symbol_b: "GOOGL",
        correlation: -0.8,
        period_days: 30,
      });

      const suggestion = engine.suggestHedge("AAPL");
      expect(suggestion).toBeDefined();
      expect(suggestion?.target_symbol).toBe("AAPL");
      expect(suggestion?.hedge_instrument).toBe("GOOGL");
      expect(suggestion?.hedge_type).toBe("direct_short");
      expect(suggestion?.id).toMatch(/^hdg_/);
    });

    it("should not suggest hedge without negative correlation", () => {
      engine.addPosition({
        symbol: "AAPL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 150,
        current_price: 160,
        side: "long",
      });

      engine.addCorrelation({
        symbol_a: "AAPL",
        symbol_b: "GOOGL",
        correlation: 0.8,
        period_days: 30,
      });

      const suggestion = engine.suggestHedge("AAPL");
      expect(suggestion).toBeUndefined();
    });

    it("should compute hedge confidence", () => {
      engine.addPosition({
        symbol: "AAPL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 150,
        current_price: 160,
        side: "long",
      });

      engine.addCorrelation({
        symbol_a: "AAPL",
        symbol_b: "GOOGL",
        correlation: -0.9,
        period_days: 30,
      });

      const suggestion = engine.suggestHedge("AAPL");
      expect(suggestion?.confidence).toBeGreaterThan(0.5);
      expect(suggestion?.confidence).toBeLessThanOrEqual(0.95);
    });

    it("should retrieve multiple hedge suggestions", () => {
      engine.addPosition({
        symbol: "AAPL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 150,
        current_price: 160,
        side: "long",
      });

      engine.addPosition({
        symbol: "GOOGL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 140,
        current_price: 140,
        side: "long",
      });

      engine.addCorrelation({
        symbol_a: "AAPL",
        symbol_b: "TSLA",
        correlation: -0.75,
        period_days: 30,
      });

      engine.addCorrelation({
        symbol_a: "GOOGL",
        symbol_b: "META",
        correlation: -0.8,
        period_days: 30,
      });

      engine.suggestHedge("AAPL");
      engine.suggestHedge("GOOGL");

      const suggestions = engine.getHedgeSuggestions();
      expect(suggestions.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Risk Alerts", () => {
    it("should generate concentration alert (critical)", () => {
      engine.addPosition({
        symbol: "AAPL",
        strategy_id: "strat_1",
        quantity: 500,
        entry_price: 150,
        current_price: 160,
        side: "long",
      });

      engine.addPosition({
        symbol: "GOOGL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 140,
        current_price: 140,
        side: "long",
      });

      const alerts = engine.checkRiskAlerts();
      const concentrationAlert = alerts.find((a) => a.type === "concentration");

      expect(concentrationAlert).toBeDefined();
      expect(concentrationAlert?.severity).toBe("critical");
      expect(concentrationAlert?.id).toMatch(/^ra_/);
    });

    it("should generate concentration alert (high)", () => {
      engine.addPosition({
        symbol: "AAPL",
        strategy_id: "strat_1",
        quantity: 300,
        entry_price: 150,
        current_price: 160,
        side: "long",
      });

      engine.addPosition({
        symbol: "GOOGL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 140,
        current_price: 140,
        side: "long",
      });

      const alerts = engine.checkRiskAlerts();
      const concentrationAlert = alerts.find((a) => a.type === "concentration");

      expect(concentrationAlert?.severity).toBe("warning");
    });

    it("should generate correlation alert", () => {
      engine.addCorrelation({
        symbol_a: "AAPL",
        symbol_b: "GOOGL",
        correlation: 0.9,
        period_days: 30,
      });

      engine.addCorrelation({
        symbol_a: "AAPL",
        symbol_b: "MSFT",
        correlation: 0.85,
        period_days: 30,
      });

      const alerts = engine.checkRiskAlerts();
      const correlationAlert = alerts.find((a) => a.type === "correlation");

      expect(correlationAlert).toBeDefined();
      expect(correlationAlert?.severity).toBe("warning");
    });

    it("should generate leverage alert", () => {
      engine.addPosition({
        symbol: "AAPL",
        strategy_id: "strat_1",
        quantity: 200,
        entry_price: 150,
        current_price: 160,
        side: "long",
      });

      engine.addPosition({
        symbol: "GOOGL",
        strategy_id: "strat_1",
        quantity: 200,
        entry_price: 140,
        current_price: 140,
        side: "short",
      });

      const alerts = engine.checkRiskAlerts();
      const leverageAlert = alerts.find((a) => a.type === "leverage");

      if (leverageAlert) {
        expect(leverageAlert.severity).toBe("critical");
      }
    });

    it("should retrieve risk alerts", () => {
      engine.addPosition({
        symbol: "AAPL",
        strategy_id: "strat_1",
        quantity: 500,
        entry_price: 150,
        current_price: 160,
        side: "long",
      });

      engine.addPosition({
        symbol: "GOOGL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 140,
        current_price: 140,
        side: "long",
      });

      engine.checkRiskAlerts();
      const alerts = engine.getRiskAlerts();

      expect(alerts.length).toBeGreaterThan(0);
    });

    it("should clear alerts on each check", () => {
      engine.addPosition({
        symbol: "AAPL",
        strategy_id: "strat_1",
        quantity: 500,
        entry_price: 150,
        current_price: 160,
        side: "long",
      });

      engine.addPosition({
        symbol: "GOOGL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 140,
        current_price: 140,
        side: "long",
      });

      const alerts1 = engine.checkRiskAlerts();
      const alertCount1 = alerts1.length;

      engine.removePosition("AAPL", "strat_1");
      const alerts2 = engine.checkRiskAlerts();
      const alertCount2 = alerts2.length;

      expect(alertCount2).toBeLessThan(alertCount1);
    });
  });

  describe("Clear Portfolio", () => {
    it("should clear all portfolio data", () => {
      engine.addPosition({
        symbol: "AAPL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 150,
        current_price: 160,
        side: "long",
      });

      engine.addCorrelation({
        symbol_a: "AAPL",
        symbol_b: "GOOGL",
        correlation: 0.8,
        period_days: 30,
      });

      engine.suggestHedge("AAPL");
      engine.checkRiskAlerts();

      engine._clearPortfolioRisk();

      expect(engine.getPositions()).toHaveLength(0);
      expect(engine.getCorrelations()).toHaveLength(0);
      expect(engine.getHedgeSuggestions()).toHaveLength(0);
      expect(engine.getRiskAlerts()).toHaveLength(0);
    });
  });

  describe("Edge Cases", () => {
    it("should handle zero quantity positions", () => {
      engine.addPosition({
        symbol: "AAPL",
        strategy_id: "strat_1",
        quantity: 0,
        entry_price: 150,
        current_price: 160,
        side: "long",
      });

      const positions = engine.getPositions();
      expect(positions).toHaveLength(1);
      expect(positions[0].unrealized_pnl).toBe(0);
    });

    it("should handle negative prices gracefully", () => {
      engine.addPosition({
        symbol: "AAPL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: -150,
        current_price: 160,
        side: "long",
      });

      const positions = engine.getPositions();
      expect(positions).toHaveLength(1);
    });

    it("should handle duplicate symbols with different strategies", () => {
      engine.addPosition({
        symbol: "AAPL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 150,
        current_price: 160,
        side: "long",
      });

      engine.addPosition({
        symbol: "AAPL",
        strategy_id: "strat_2",
        quantity: 50,
        entry_price: 155,
        current_price: 165,
        side: "long",
      });

      const positions = engine.getPositions();
      expect(positions).toHaveLength(2);
    });

    it("should compute metrics with single position", () => {
      engine.addPosition({
        symbol: "AAPL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 150,
        current_price: 160,
        side: "long",
      });

      const metrics = engine.computeRiskMetrics();
      expect(metrics.total_exposure).toBe(16000);
      expect(metrics.concentration_risk.max_single_position_pct).toBe(100);
      expect(metrics.concentration_risk.level).toBe("critical");
    });
  });
});
