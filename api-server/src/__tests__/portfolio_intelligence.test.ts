import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../lib/risk_engine", () => ({
  isKillSwitchActive: () => false,
}));
vi.mock("../lib/drawdown_breaker", () => ({
  getBreakerSnapshot: () => ({ sizeMultiplier: 1.0 }),
  isCooldownActive: () => false,
}));

import {
  portfolioManager,
  Allocation,
  ExposureSnapshot,
  CorrelationSnapshot,
} from "../lib/portfolio";

describe("Portfolio Intelligence — Phase 23", () => {
  beforeEach(() => {
    portfolioManager._clearAll();
  });

  describe("Allocation Management", () => {
    it("registers an allocation with valid parameters", () => {
      const alloc = portfolioManager.registerAllocation({
        portfolio_id: "test-portfolio",
        strategy_id: "strat-momentum",
        strategy_name: "Momentum Strategy",
        target_weight: 0.3,
        allocated_capital: 30000,
      });

      expect(alloc).toBeDefined();
      expect(alloc.allocation_id).toMatch(/^pal_/);
      expect(alloc.target_weight).toBe(0.3);
      expect(alloc.portfolio_id).toBe("test-portfolio");
      expect(alloc.status).toBe("active");
      expect(alloc.rebalance_needed).toBe(false);
    });

    it("enforces weight constraints (0-1)", () => {
      expect(() => {
        portfolioManager.registerAllocation({
          portfolio_id: "test-portfolio",
          strategy_id: "strat-1",
          target_weight: 1.5, // Invalid: > 1
          allocated_capital: 50000,
        });
      }).toThrow("target_weight must be between 0 and 1");
    });

    it("enforces total allocation weight <= 100%", () => {
      portfolioManager.registerAllocation({
        portfolio_id: "test-portfolio",
        strategy_id: "strat-1",
        target_weight: 0.6,
        allocated_capital: 60000,
      });

      expect(() => {
        portfolioManager.registerAllocation({
          portfolio_id: "test-portfolio",
          strategy_id: "strat-2",
          target_weight: 0.5, // Would total 110%
          allocated_capital: 50000,
        });
      }).toThrow("Total allocation weight would exceed 100%");
    });

    it("allows multiple allocations up to 100%", () => {
      const alloc1 = portfolioManager.registerAllocation({
        portfolio_id: "test-portfolio",
        strategy_id: "strat-1",
        target_weight: 0.4,
        allocated_capital: 40000,
      });

      const alloc2 = portfolioManager.registerAllocation({
        portfolio_id: "test-portfolio",
        strategy_id: "strat-2",
        target_weight: 0.35,
        allocated_capital: 35000,
      });

      const alloc3 = portfolioManager.registerAllocation({
        portfolio_id: "test-portfolio",
        strategy_id: "strat-3",
        target_weight: 0.25,
        allocated_capital: 25000,
      });

      expect(alloc1.status).toBe("active");
      expect(alloc2.status).toBe("active");
      expect(alloc3.status).toBe("active");
    });
  });

  describe("Exposure Cap Enforcement", () => {
    beforeEach(() => {
      portfolioManager.registerAllocation({
        portfolio_id: "test-portfolio",
        strategy_id: "strat-momentum",
        target_weight: 0.5,
        allocated_capital: 50000,
      });
    });

    it("flags exposure breach when net exposure exceeds 80%", () => {
      // Create low exposure (safe)
      portfolioManager.updateExposure({
        portfolio_id: "test-portfolio",
        long_exposure_usd: 40000,
        short_exposure_usd: 5000,
        net_exposure_usd: 35000,
        total_positions: 5,
        total_strategies: 1,
        total_capital: 100000,
        cash_remaining: 20000,
      });

      let summary = portfolioManager.getPortfolioSummary("test-portfolio");
      expect(summary.risk_assessment.exposure_cap_breached).toBe(false);
      expect(summary.risk_assessment.net_exposure_pct).toBeLessThanOrEqual(0.8);

      // Now create high exposure (breach)
      portfolioManager.updateExposure({
        portfolio_id: "test-portfolio",
        long_exposure_usd: 85000,
        short_exposure_usd: 0,
        net_exposure_usd: 85000,
        total_positions: 5,
        total_strategies: 1,
        total_capital: 100000,
        cash_remaining: 5000,
      });

      summary = portfolioManager.getPortfolioSummary("test-portfolio");
      expect(summary.risk_assessment.exposure_cap_breached).toBe(true);
      expect(summary.risk_assessment.net_exposure_pct).toBeGreaterThan(0.8);
    });

    it("correctly calculates net exposure percentage", () => {
      portfolioManager.updateExposure({
        portfolio_id: "test-portfolio",
        long_exposure_usd: 50000,
        short_exposure_usd: 10000,
        net_exposure_usd: 40000,
        total_positions: 10,
        total_strategies: 1,
        total_capital: 100000,
        cash_remaining: 30000,
      });

      const summary = portfolioManager.getPortfolioSummary("test-portfolio");
      const exposure = summary.latest_exposure;
      expect(exposure).toBeDefined();
      expect(exposure!.net_exposure_pct).toBe(0.4);
    });
  });

  describe("Correlation-Aware De-Risking", () => {
    beforeEach(() => {
      portfolioManager.registerAllocation({
        portfolio_id: "test-portfolio",
        strategy_id: "strat-momentum",
        target_weight: 0.5,
        allocated_capital: 50000,
      });
    });

    it("flags correlation warning when max correlation > 0.7", () => {
      // Safe correlation
      portfolioManager.updateCorrelation({
        portfolio_id: "test-portfolio",
        max_correlation: 0.65,
        avg_correlation: 0.4,
        highly_correlated_pairs: [],
      });

      let summary = portfolioManager.getPortfolioSummary("test-portfolio");
      expect(summary.risk_assessment.correlation_warning).toBe(false);

      // Breach correlation threshold
      portfolioManager.updateCorrelation({
        portfolio_id: "test-portfolio",
        max_correlation: 0.75,
        avg_correlation: 0.5,
        highly_correlated_pairs: [
          {
            pair: ["strat-1", "strat-2"],
            correlation: 0.75,
          },
        ],
      });

      summary = portfolioManager.getPortfolioSummary("test-portfolio");
      expect(summary.risk_assessment.correlation_warning).toBe(true);
      expect(summary.risk_assessment.max_correlation).toBeGreaterThan(0.7);
    });

    it("tracks highly correlated pairs", () => {
      const snapshot = portfolioManager.updateCorrelation({
        portfolio_id: "test-portfolio",
        max_correlation: 0.85,
        avg_correlation: 0.6,
        highly_correlated_pairs: [
          { pair: ["strat-1", "strat-2"], correlation: 0.85 },
          { pair: ["strat-2", "strat-3"], correlation: 0.72 },
        ],
      });

      expect(snapshot.highly_correlated_pairs).toHaveLength(2);
      expect(snapshot.highly_correlated_pairs[0].correlation).toBe(0.85);
    });
  });

  describe("Regime-Based Strategy Activation/Deactivation", () => {
    it("registers regime allocation with valid weights", () => {
      const regime = portfolioManager.registerRegimeAllocation({
        portfolio_id: "test-portfolio",
        regime: "bull-market",
        strategy_weights: {
          "strat-momentum": 0.5,
          "strat-mean-reversion": 0.3,
          "strat-volatility": 0.2,
        },
        regime_confidence: 0.85,
      });

      expect(regime).toBeDefined();
      expect(regime.allocation_id).toMatch(/^pra_/);
      expect(regime.regime).toBe("bull-market");
      expect(regime.active).toBe(true);
      expect(regime.regime_confidence).toBe(0.85);
    });

    it("enforces regime weights sum to 100%", () => {
      expect(() => {
        portfolioManager.registerRegimeAllocation({
          portfolio_id: "test-portfolio",
          regime: "bear-market",
          strategy_weights: {
            "strat-1": 0.3,
            "strat-2": 0.3,
            "strat-3": 0.3, // Total = 90%, not 100%
          },
        });
      }).toThrow("Strategy weights must sum to 100%");
    });

    it("retrieves regime allocations by portfolio", () => {
      portfolioManager.registerRegimeAllocation({
        portfolio_id: "test-portfolio",
        regime: "bull-market",
        strategy_weights: { "strat-1": 1.0 },
      });

      portfolioManager.registerRegimeAllocation({
        portfolio_id: "test-portfolio",
        regime: "bear-market",
        strategy_weights: { "strat-1": 1.0 },
      });

      const summary = portfolioManager.getPortfolioSummary("test-portfolio");
      expect(summary.regime_allocations).toHaveLength(2);
    });
  });

  describe("Portfolio Drawdown Protection", () => {
    beforeEach(() => {
      portfolioManager.registerAllocation({
        portfolio_id: "test-portfolio",
        strategy_id: "strat-momentum",
        target_weight: 0.5,
        allocated_capital: 50000,
      });
    });

    it("flags drawdown warning when estimated max drawdown > 15%", () => {
      const alloc = portfolioManager.registerAllocation({
        portfolio_id: "test-portfolio",
        strategy_id: "strat-2",
        target_weight: 0.5,
        allocated_capital: 50000,
      });

      // Update with safe drawdown
      portfolioManager.updateAllocationMetrics(alloc.allocation_id, {
        drawdown_pct: 0.1,
      });

      let summary = portfolioManager.getPortfolioSummary("test-portfolio");
      expect(summary.risk_assessment.drawdown_warning).toBe(false);

      // Update with breach drawdown
      portfolioManager.updateAllocationMetrics(alloc.allocation_id, {
        drawdown_pct: 0.18,
      });

      summary = portfolioManager.getPortfolioSummary("test-portfolio");
      expect(summary.risk_assessment.drawdown_warning).toBe(true);
      expect(summary.risk_assessment.estimated_max_drawdown_pct).toBeGreaterThan(0.15);
    });
  });

  describe("Rebalance Check", () => {
    beforeEach(() => {
      portfolioManager.registerAllocation({
        portfolio_id: "test-portfolio",
        strategy_id: "strat-momentum",
        target_weight: 0.4,
        allocated_capital: 40000,
      });

      portfolioManager.registerAllocation({
        portfolio_id: "test-portfolio",
        strategy_id: "strat-mean-reversion",
        target_weight: 0.6,
        allocated_capital: 60000,
      });
    });

    it("identifies when allocations need rebalancing", () => {
      // Set actual weights to match targets (no rebalance needed)
      portfolioManager.updateAllocationWeights("test-portfolio", {
        "strat-momentum": 0.4,
        "strat-mean-reversion": 0.6,
      });

      let summary = portfolioManager.getPortfolioSummary("test-portfolio");
      expect(summary.rebalance_status.needs_rebalance).toBe(false);

      // Set actual weights far from targets (high rebalance needed)
      portfolioManager.updateAllocationWeights("test-portfolio", {
        "strat-momentum": 0.25, // -15% from target
        "strat-mean-reversion": 0.75, // +15% from target
      });

      summary = portfolioManager.getPortfolioSummary("test-portfolio");
      expect(summary.rebalance_status.needs_rebalance).toBe(true);
      expect(summary.rebalance_status.misallocations.length).toBeGreaterThan(0);
    });

    it("classifies misallocations by severity", () => {
      // Small drift (low severity)
      portfolioManager.updateAllocationWeights("test-portfolio", {
        "strat-momentum": 0.41, // +1% from target (low severity)
        "strat-mean-reversion": 0.59,
      });

      let summary = portfolioManager.getPortfolioSummary("test-portfolio");
      expect(summary.rebalance_status.misallocations.length).toBe(0); // All low severity filtered

      // Medium drift (medium severity)
      portfolioManager.updateAllocationWeights("test-portfolio", {
        "strat-momentum": 0.38, // -2% from target (medium severity)
        "strat-mean-reversion": 0.62,
      });

      summary = portfolioManager.getPortfolioSummary("test-portfolio");
      expect(summary.rebalance_status.misallocations.length).toBeGreaterThan(0);
      expect(summary.rebalance_status.misallocations.some((m) => m.severity === "medium")).toBe(
        true
      );

      // High drift (high severity)
      portfolioManager.updateAllocationWeights("test-portfolio", {
        "strat-momentum": 0.25, // -15% from target (high severity)
        "strat-mean-reversion": 0.75,
      });

      summary = portfolioManager.getPortfolioSummary("test-portfolio");
      expect(summary.rebalance_status.needs_rebalance).toBe(true);
      expect(summary.rebalance_status.misallocations.some((m) => m.severity === "high")).toBe(true);
    });
  });

  describe("Portfolio Summary", () => {
    it("returns complete portfolio summary", () => {
      const alloc1 = portfolioManager.registerAllocation({
        portfolio_id: "test-portfolio",
        strategy_id: "strat-1",
        target_weight: 0.5,
        allocated_capital: 50000,
      });

      const alloc2 = portfolioManager.registerAllocation({
        portfolio_id: "test-portfolio",
        strategy_id: "strat-2",
        target_weight: 0.5,
        allocated_capital: 50000,
      });

      portfolioManager.updateExposure({
        portfolio_id: "test-portfolio",
        long_exposure_usd: 70000,
        short_exposure_usd: 5000,
        net_exposure_usd: 65000,
        total_positions: 10,
        total_strategies: 2,
        total_capital: 100000,
        cash_remaining: 25000,
      });

      portfolioManager.updateCorrelation({
        portfolio_id: "test-portfolio",
        max_correlation: 0.6,
        avg_correlation: 0.4,
        highly_correlated_pairs: [],
      });

      const summary = portfolioManager.getPortfolioSummary("test-portfolio");

      expect(summary.allocations).toHaveLength(2);
      expect(summary.latest_exposure).toBeDefined();
      expect(summary.latest_correlation).toBeDefined();
      expect(summary.rebalance_status).toBeDefined();
      expect(summary.risk_assessment).toBeDefined();
      expect(summary.risk_assessment.exposure_cap_breached).toBe(false);
      expect(summary.risk_assessment.correlation_warning).toBe(false);
    });
  });

  describe("Allocation Metrics Tracking", () => {
    it("updates allocation metrics (PnL, Sharpe, drawdown)", () => {
      const alloc = portfolioManager.registerAllocation({
        portfolio_id: "test-portfolio",
        strategy_id: "strat-momentum",
        target_weight: 0.5,
        allocated_capital: 50000,
      });

      portfolioManager.updateAllocationMetrics(alloc.allocation_id, {
        pnl: 5000,
        sharpe: 1.5,
        drawdown_pct: 0.08,
        used_capital: 45000,
      });

      const updated = portfolioManager.getAllocation(alloc.allocation_id);
      expect(updated).toBeDefined();
      expect(updated!.strategy_pnl).toBe(5000);
      expect(updated!.strategy_sharpe).toBe(1.5);
      expect(updated!.strategy_drawdown_pct).toBe(0.08);
      expect(updated!.used_capital).toBe(45000);
    });
  });

  describe("Multi-Portfolio Isolation", () => {
    it("isolates data by portfolio_id", () => {
      // Portfolio 1
      portfolioManager.registerAllocation({
        portfolio_id: "portfolio-1",
        strategy_id: "strat-1",
        target_weight: 0.5,
        allocated_capital: 50000,
      });

      // Portfolio 2
      portfolioManager.registerAllocation({
        portfolio_id: "portfolio-2",
        strategy_id: "strat-1",
        target_weight: 0.3,
        allocated_capital: 30000,
      });

      const summary1 = portfolioManager.getPortfolioSummary("portfolio-1");
      const summary2 = portfolioManager.getPortfolioSummary("portfolio-2");

      expect(summary1.allocations).toHaveLength(1);
      expect(summary2.allocations).toHaveLength(1);
      expect(summary1.allocations[0].target_weight).toBe(0.5);
      expect(summary2.allocations[0].target_weight).toBe(0.3);
    });
  });
});
