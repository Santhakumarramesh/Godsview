import { describe, it, expect } from "vitest";
import { computePortfolio } from "../lib/portfolio_engine";

describe("Portfolio Engine", () => {
  it("computes allocations for multiple positions", () => {
    const result = computePortfolio({
      positions: [
        { symbol: "BTCUSD", conviction: 0.85, realized_vol: 0.65, sector: "crypto", current_qty: 0.1, current_price: 67000 },
        { symbol: "ETHUSD", conviction: 0.70, realized_vol: 0.72, sector: "crypto", current_qty: 1.5, current_price: 3400 },
        { symbol: "EURUSD", conviction: 0.60, realized_vol: 0.08, sector: "forex", current_qty: 10000, current_price: 1.085 },
      ],
      equity: 100000,
    });

    expect(result.positions).toHaveLength(3);
    expect(result.total_allocated_pct).toBeGreaterThan(0);
    // max_total_invested_pct = 80%
    expect(result.total_allocated_pct).toBeLessThanOrEqual(0.81);
    // cash >= 20%
    expect(result.cash_available).toBeGreaterThan(0);
    expect(result.total_equity).toBe(100000);
  });

  it("enforces single position cap (15%)", () => {
    const result = computePortfolio({
      positions: [
        { symbol: "BTCUSD", conviction: 1.0, realized_vol: 0.01, sector: "crypto", current_qty: 0, current_price: 67000 },
      ],
      equity: 100000,
    });

    const pos = result.positions[0];
    expect(pos.final_weight).toBeLessThanOrEqual(0.16);
  });

  it("enforces sector cap (30%)", () => {
    const result = computePortfolio({
      positions: [
        { symbol: "BTCUSD", conviction: 0.95, realized_vol: 0.10, sector: "crypto", current_qty: 0, current_price: 67000 },
        { symbol: "ETHUSD", conviction: 0.90, realized_vol: 0.10, sector: "crypto", current_qty: 0, current_price: 3400 },
        { symbol: "SOLUSD", conviction: 0.85, realized_vol: 0.10, sector: "crypto", current_qty: 0, current_price: 150 },
      ],
      equity: 100000,
    });

    const cryptoWeight = result.positions
      .filter((p) => p.symbol === "BTCUSD" || p.symbol === "ETHUSD" || p.symbol === "SOLUSD")
      .reduce((sum, p) => sum + p.final_weight, 0);

    expect(cryptoWeight).toBeLessThanOrEqual(0.31);
  });

  it("computes suggested quantities", () => {
    const result = computePortfolio({
      positions: [
        { symbol: "BTCUSD", conviction: 0.80, realized_vol: 0.50, sector: "crypto", current_qty: 0.05, current_price: 67000 },
      ],
      equity: 100000,
    });

    const pos = result.positions[0];
    expect(pos.suggested_qty).toBeDefined();
    expect(typeof pos.suggested_qty).toBe("number");
    expect(pos.suggested_qty).toBeGreaterThan(0);
  });

  it("returns risk metrics", () => {
    const result = computePortfolio({
      positions: [
        { symbol: "BTCUSD", conviction: 0.85, realized_vol: 0.65, sector: "crypto", current_qty: 0, current_price: 67000 },
      ],
      equity: 100000,
    });

    expect(result.risk_metrics).toBeDefined();
    expect(typeof result.risk_metrics.portfolio_vol).toBe("number");
    expect(result.risk_metrics.sector_concentration).toBeDefined();
  });

  it("returns valid PortfolioState structure", () => {
    const result = computePortfolio({
      positions: [
        { symbol: "BTCUSD", conviction: 0.70, realized_vol: 0.50, sector: "crypto", current_qty: 0, current_price: 67000 },
      ],
      equity: 50000,
    });

    expect(result).toHaveProperty("timestamp");
    expect(result).toHaveProperty("total_equity");
    expect(result).toHaveProperty("cash_available");
    expect(result).toHaveProperty("positions");
    expect(result).toHaveProperty("total_allocated_pct");
    expect(result).toHaveProperty("risk_metrics");
    expect(result).toHaveProperty("constraints");
  });
});
