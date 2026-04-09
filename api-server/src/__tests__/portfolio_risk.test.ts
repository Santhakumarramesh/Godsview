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
vi.mock("../../lib/risk_engine", () => ({ evaluateRisk: vi.fn() }));
vi.mock("../../lib/drawdown_breaker", () => ({ checkDrawdown: vi.fn() }));

import {
  addPosition,
  updatePosition,
  removePosition,
  getPositions,
  computeRiskMetrics,
  addCorrelation,
  getCorrelations,
  getCorrelationsForSymbol,
  suggestHedge,
  getHedgeSuggestions,
  checkRiskAlerts,
  getRiskAlerts,
  _clearPortfolioRisk,
} from "../lib/portfolio_risk";

describe("Phase 44 — Portfolio Risk Engine", () => {
  beforeEach(() => {
    _clearPortfolioRisk();
  });

  // ── Positions ──

  describe("addPosition", () => {
    it("should add a long position with auto-computed PnL", () => {
      addPosition({
        symbol: "AAPL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 150,
        current_price: 160,
        side: "long",
      });

      const positions = getPositions();
      expect(positions).toHaveLength(1);
      expect(positions[0].symbol).toBe("AAPL");
      expect(positions[0].unrealized_pnl).toBe(1000); // (160-150)*100
      expect(positions[0].weight_pct).toBe(100); // single position = 100%
    });

    it("should add a short position with auto-computed PnL", () => {
      addPosition({
        symbol: "TSLA",
        strategy_id: "strat_1",
        quantity: 50,
        entry_price: 200,
        current_price: 180,
        side: "short",
      });

      const positions = getPositions();
      expect(positions[0].unrealized_pnl).toBe(1000); // (200-180)*50
    });

    it("should compute negative PnL for losing long", () => {
      addPosition({
        symbol: "AAPL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 160,
        current_price: 150,
        side: "long",
      });

      expect(getPositions()[0].unrealized_pnl).toBe(-1000);
    });

    it("should compute negative PnL for losing short", () => {
      addPosition({
        symbol: "TSLA",
        strategy_id: "strat_1",
        quantity: 50,
        entry_price: 180,
        current_price: 200,
        side: "short",
      });

      expect(getPositions()[0].unrealized_pnl).toBe(-1000);
    });

    it("should recompute weights when adding multiple positions", () => {
      addPosition({
        symbol: "AAPL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 100,
        current_price: 100,
        side: "long",
      }); // 10000 notional

      addPosition({
        symbol: "MSFT",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 100,
        current_price: 100,
        side: "long",
      }); // 10000 notional

      const positions = getPositions();
      expect(positions).toHaveLength(2);
      expect(positions[0].weight_pct).toBeCloseTo(50, 0);
      expect(positions[1].weight_pct).toBeCloseTo(50, 0);
    });
  });

  describe("updatePosition", () => {
    it("should update a position", () => {
      addPosition({
        symbol: "AAPL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 150,
        current_price: 160,
        side: "long",
      });

      const result = updatePosition("AAPL", "strat_1", { current_price: 170 });
      expect(result.success).toBe(true);

      const pos = getPositions()[0];
      expect(pos.current_price).toBe(170);
      expect(pos.unrealized_pnl).toBe(2000); // (170-150)*100
    });

    it("should return error for missing position", () => {
      const result = updatePosition("AAPL", "strat_1", { current_price: 170 });
      expect(result.success).toBe(false);
      expect(result.error).toBe("Position not found");
    });
  });

  describe("removePosition", () => {
    it("should remove a position", () => {
      addPosition({
        symbol: "AAPL",
        strategy_id: "strat_1",
        quantity: 100,
        entry_price: 150,
        current_price: 160,
        side: "long",
      });

      const result = removePosition("AAPL", "strat_1");
      expect(result.success).toBe(true);
      expect(getPositions()).toHaveLength(0);
    });

    it("should return error for missing position", () => {
      const result = removePosition("AAPL", "strat_1");
      expect(result.success).toBe(false);
    });
  });

  // ── Risk Metrics ──

  describe("computeRiskMetrics", () => {
    it("should return zero metrics for empty portfolio", () => {
      const metrics = computeRiskMetrics();
      expect(metrics.total_exposure).toBe(0);
      expect(metrics.net_exposure).toBe(0);
      expect(metrics.diversification_score).toBe(100);
      expect(metrics.concentration_risk.level).toBe("low");
    });

    it("should compute exposure metrics", () => {
      addPosition({
        symbol: "AAPL",
        strategy_id: "s1",
        quantity: 100,
        entry_price: 150,
        current_price: 150,
        side: "long",
      }); // 15000

      addPosition({
        symbol: "TSLA",
        strategy_id: "s1",
        quantity: 50,
        entry_price: 200,
        current_price: 200,
        side: "short",
      }); // 10000

      const metrics = computeRiskMetrics();
      expect(metrics.long_exposure).toBe(15000);
      expect(metrics.short_exposure).toBe(10000);
      expect(metrics.total_exposure).toBe(25000);
      expect(metrics.net_exposure).toBe(5000);
    });

    it("should compute VaR", () => {
      addPosition({
        symbol: "AAPL",
        strategy_id: "s1",
        quantity: 100,
        entry_price: 100,
        current_price: 100,
        side: "long",
      }); // 10000

      const metrics = computeRiskMetrics();
      expect(metrics.portfolio_var_95).toBe(200); // 10000 * 0.02
      expect(metrics.portfolio_var_99).toBe(300); // 10000 * 0.03
    });

    it("should compute concentration risk levels", () => {
      // Single position = 100% concentration → critical
      addPosition({
        symbol: "AAPL",
        strategy_id: "s1",
        quantity: 100,
        entry_price: 100,
        current_price: 100,
        side: "long",
      });

      const metrics = computeRiskMetrics();
      expect(metrics.concentration_risk.max_single_position_pct).toBe(100);
      expect(metrics.concentration_risk.level).toBe("critical");
    });

    it("should compute medium concentration for balanced portfolio", () => {
      // Add 5 equal positions → 20% each → medium
      for (let i = 0; i < 5; i++) {
        addPosition({
          symbol: `SYM${i}`,
          strategy_id: "s1",
          quantity: 100,
          entry_price: 100,
          current_price: 100,
          side: "long",
        });
      }

      const metrics = computeRiskMetrics();
      expect(metrics.concentration_risk.max_single_position_pct).toBeCloseTo(20, 0);
      expect(metrics.concentration_risk.level).toBe("medium");
    });

    it("should compute low concentration for diversified portfolio", () => {
      for (let i = 0; i < 20; i++) {
        addPosition({
          symbol: `SYM${i}`,
          strategy_id: "s1",
          quantity: 100,
          entry_price: 100,
          current_price: 100,
          side: "long",
        });
      }

      const metrics = computeRiskMetrics();
      expect(metrics.concentration_risk.max_single_position_pct).toBeCloseTo(5, 0);
      expect(metrics.concentration_risk.level).toBe("low");
    });

    it("should compute top 3 concentration", () => {
      addPosition({ symbol: "A", strategy_id: "s1", quantity: 100, entry_price: 100, current_price: 100, side: "long" }); // 10000
      addPosition({ symbol: "B", strategy_id: "s1", quantity: 100, entry_price: 100, current_price: 100, side: "long" }); // 10000
      addPosition({ symbol: "C", strategy_id: "s1", quantity: 100, entry_price: 100, current_price: 100, side: "long" }); // 10000
      addPosition({ symbol: "D", strategy_id: "s1", quantity: 100, entry_price: 100, current_price: 100, side: "long" }); // 10000

      const metrics = computeRiskMetrics();
      expect(metrics.concentration_risk.top_3_concentration_pct).toBeCloseTo(75, 0);
    });
  });

  // ── Correlations ──

  describe("addCorrelation", () => {
    it("should auto-classify high positive", () => {
      const pair = addCorrelation({
        symbol_a: "AAPL",
        symbol_b: "MSFT",
        correlation: 0.85,
        period_days: 30,
      });
      expect(pair.classification).toBe("high_positive");
    });

    it("should auto-classify moderate positive", () => {
      const pair = addCorrelation({
        symbol_a: "AAPL",
        symbol_b: "GLD",
        correlation: 0.55,
        period_days: 30,
      });
      expect(pair.classification).toBe("moderate_positive");
    });

    it("should auto-classify low", () => {
      const pair = addCorrelation({
        symbol_a: "AAPL",
        symbol_b: "BTC",
        correlation: 0.15,
        period_days: 30,
      });
      expect(pair.classification).toBe("low");
    });

    it("should auto-classify moderate negative", () => {
      const pair = addCorrelation({
        symbol_a: "SPY",
        symbol_b: "VIX",
        correlation: -0.55,
        period_days: 30,
      });
      expect(pair.classification).toBe("moderate_negative");
    });

    it("should auto-classify high negative", () => {
      const pair = addCorrelation({
        symbol_a: "SPY",
        symbol_b: "SH",
        correlation: -0.95,
        period_days: 30,
      });
      expect(pair.classification).toBe("high_negative");
    });
  });

  describe("getCorrelationsForSymbol", () => {
    it("should find correlations involving a symbol", () => {
      addCorrelation({ symbol_a: "AAPL", symbol_b: "MSFT", correlation: 0.8, period_days: 30 });
      addCorrelation({ symbol_a: "AAPL", symbol_b: "GOOGL", correlation: 0.7, period_days: 30 });
      addCorrelation({ symbol_a: "TSLA", symbol_b: "MSFT", correlation: 0.5, period_days: 30 });

      const aaplCorrs = getCorrelationsForSymbol("AAPL");
      expect(aaplCorrs).toHaveLength(2);
    });
  });

  // ── Diversification Score ──

  describe("diversification_score", () => {
    it("should be 100 with no correlations", () => {
      addPosition({ symbol: "AAPL", strategy_id: "s1", quantity: 100, entry_price: 100, current_price: 100, side: "long" });

      const metrics = computeRiskMetrics();
      expect(metrics.diversification_score).toBe(100);
    });

    it("should decrease with high correlations", () => {
      addPosition({ symbol: "AAPL", strategy_id: "s1", quantity: 100, entry_price: 100, current_price: 100, side: "long" });
      addCorrelation({ symbol_a: "AAPL", symbol_b: "MSFT", correlation: 0.9, period_days: 30 });

      const metrics = computeRiskMetrics();
      expect(metrics.diversification_score).toBeLessThan(20);
    });
  });

  // ── Hedge Suggestions ──

  describe("suggestHedge", () => {
    it("should suggest inverse ETF for known symbols", () => {
      addPosition({ symbol: "SPY", strategy_id: "s1", quantity: 100, entry_price: 450, current_price: 450, side: "long" });

      const suggestion = suggestHedge("SPY");
      expect(suggestion).toBeDefined();
      expect(suggestion!.hedge_instrument).toBe("SH");
      expect(suggestion!.hedge_type).toBe("inverse_etf");
      expect(suggestion!.id).toMatch(/^hdg_/);
      expect(suggestion!.suggested_size).toBe(50);
    });

    it("should suggest put option for unknown symbols", () => {
      addPosition({ symbol: "RIVN", strategy_id: "s1", quantity: 200, entry_price: 20, current_price: 20, side: "long" });

      const suggestion = suggestHedge("RIVN");
      expect(suggestion).toBeDefined();
      expect(suggestion!.hedge_instrument).toBe("RIVN_PUT");
      expect(suggestion!.hedge_type).toBe("put_option");
    });

    it("should return undefined for no position", () => {
      expect(suggestHedge("AAPL")).toBeUndefined();
    });

    it("should track hedge suggestions", () => {
      addPosition({ symbol: "SPY", strategy_id: "s1", quantity: 100, entry_price: 450, current_price: 450, side: "long" });
      suggestHedge("SPY");

      expect(getHedgeSuggestions()).toHaveLength(1);
    });
  });

  // ── Risk Alerts ──

  describe("checkRiskAlerts", () => {
    it("should return no alerts for empty portfolio", () => {
      const alerts = checkRiskAlerts();
      expect(alerts).toHaveLength(0);
    });

    it("should generate concentration alert for single position", () => {
      addPosition({ symbol: "AAPL", strategy_id: "s1", quantity: 100, entry_price: 100, current_price: 100, side: "long" });

      const alerts = checkRiskAlerts();
      const concAlert = alerts.find((a) => a.type === "concentration");
      expect(concAlert).toBeDefined();
      expect(concAlert!.severity).toBe("critical");
      expect(concAlert!.id).toMatch(/^ra_/);
    });

    it("should generate correlation alert for highly correlated portfolio", () => {
      addPosition({ symbol: "AAPL", strategy_id: "s1", quantity: 100, entry_price: 100, current_price: 100, side: "long" });
      addCorrelation({ symbol_a: "AAPL", symbol_b: "MSFT", correlation: 0.9, period_days: 30 });

      const alerts = checkRiskAlerts();
      const corrAlert = alerts.find((a) => a.type === "correlation");
      expect(corrAlert).toBeDefined();
      expect(corrAlert!.severity).toBe("critical");
    });

    it("should accumulate alerts in getRiskAlerts", () => {
      addPosition({ symbol: "AAPL", strategy_id: "s1", quantity: 100, entry_price: 100, current_price: 100, side: "long" });
      checkRiskAlerts();
      checkRiskAlerts();

      const allAlerts = getRiskAlerts();
      expect(allAlerts.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── Integration ──

  describe("integration", () => {
    it("should handle full portfolio workflow", () => {
      // Add positions
      addPosition({ symbol: "AAPL", strategy_id: "s1", quantity: 100, entry_price: 150, current_price: 160, side: "long" });
      addPosition({ symbol: "MSFT", strategy_id: "s1", quantity: 80, entry_price: 350, current_price: 360, side: "long" });
      addPosition({ symbol: "TSLA", strategy_id: "s2", quantity: 50, entry_price: 250, current_price: 240, side: "short" });

      // Add correlations
      addCorrelation({ symbol_a: "AAPL", symbol_b: "MSFT", correlation: 0.8, period_days: 30 });

      // Compute metrics
      const metrics = computeRiskMetrics();
      expect(metrics.total_exposure).toBeGreaterThan(0);
      expect(metrics.long_exposure).toBeGreaterThan(0);
      expect(metrics.short_exposure).toBeGreaterThan(0);

      // Get hedge suggestion
      const hedge = suggestHedge("AAPL");
      expect(hedge).toBeDefined();

      // Check alerts
      const alerts = checkRiskAlerts();
      expect(Array.isArray(alerts)).toBe(true);

      // Update position
      updatePosition("AAPL", "s1", { current_price: 170 });
      const updated = getPositions().find((p) => p.symbol === "AAPL");
      expect(updated!.unrealized_pnl).toBe(2000);

      // Remove position
      removePosition("TSLA", "s2");
      expect(getPositions()).toHaveLength(2);
    });

    it("should clear all data", () => {
      addPosition({ symbol: "AAPL", strategy_id: "s1", quantity: 100, entry_price: 100, current_price: 100, side: "long" });
      addCorrelation({ symbol_a: "AAPL", symbol_b: "MSFT", correlation: 0.8, period_days: 30 });
      suggestHedge("AAPL");
      checkRiskAlerts();

      _clearPortfolioRisk();

      expect(getPositions()).toHaveLength(0);
      expect(getCorrelations()).toHaveLength(0);
      expect(getHedgeSuggestions()).toHaveLength(0);
      expect(getRiskAlerts()).toHaveLength(0);
    });
  });
});
