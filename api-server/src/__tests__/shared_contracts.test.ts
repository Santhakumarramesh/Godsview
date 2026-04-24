import { describe, it, expect } from "vitest";
import {
  SignalContract,
  OrderContract,
  PositionContract,
  RiskAssessmentContract,
  MarketTickContract,
  OHLCVBarContract,
  BrainEventContract,
  StrategyPerformanceContract,
  ALL_CONTRACTS,
} from "../lib/shared_contracts";

const UUID = "550e8400-e29b-41d4-a716-446655440000";
const TS = "2025-01-15T10:30:00Z";

describe("Shared Data Contracts", () => {
  describe("SignalContract", () => {
    it("validates a correct signal", () => {
      const result = SignalContract.safeParse({
        signal_id: UUID, timestamp: TS, symbol: "BTCUSD",
        direction: "long", confidence: 0.85, setup_type: "smc_ob",
        timeframe: "1h", entry_price: 42000, stop_loss: 41500,
        take_profit: 43500, risk_reward: 3.0, source_layer: "smc",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid direction", () => {
      const result = SignalContract.safeParse({
        signal_id: UUID, timestamp: TS, symbol: "BTCUSD",
        direction: "invalid", confidence: 0.85, setup_type: "smc_ob",
        timeframe: "1h", entry_price: 42000, stop_loss: 41500,
        take_profit: 43500, risk_reward: 3.0, source_layer: "smc",
      });
      expect(result.success).toBe(false);
    });

    it("rejects confidence out of range", () => {
      const result = SignalContract.safeParse({
        signal_id: UUID, timestamp: TS, symbol: "BTCUSD",
        direction: "long", confidence: 1.5, setup_type: "smc_ob",
        timeframe: "1h", entry_price: 42000, stop_loss: 41500,
        take_profit: 43500, risk_reward: 3.0, source_layer: "smc",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("OrderContract", () => {
    it("validates a correct order", () => {
      const result = OrderContract.safeParse({
        order_id: UUID, timestamp: TS, symbol: "AAPL",
        side: "buy", order_type: "limit", quantity: 100,
        price: 150.50, time_in_force: "day", status: "pending",
      });
      expect(result.success).toBe(true);
    });

    it("rejects negative quantity", () => {
      const result = OrderContract.safeParse({
        order_id: UUID, timestamp: TS, symbol: "AAPL",
        side: "buy", order_type: "market", quantity: -10,
        time_in_force: "day", status: "pending",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("PositionContract", () => {
    it("validates a correct position", () => {
      const result = PositionContract.safeParse({
        position_id: UUID, symbol: "ETHUSDT", side: "long",
        quantity: 5, entry_price: 2200, current_price: 2350,
        unrealized_pnl: 750, realized_pnl: 0, opened_at: TS,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("RiskAssessmentContract", () => {
    it("validates a correct assessment", () => {
      const result = RiskAssessmentContract.safeParse({
        assessment_id: UUID, timestamp: TS,
        portfolio_var_95: -1.82, portfolio_var_99: -2.94,
        max_drawdown: -8.4, current_drawdown: -2.1,
        exposure_pct: 65, margin_used_pct: 40,
        risk_score: 72, circuit_breaker_active: false,
        warnings: ["High correlation detected"],
      });
      expect(result.success).toBe(true);
    });

    it("rejects exposure_pct > 100", () => {
      const result = RiskAssessmentContract.safeParse({
        assessment_id: UUID, timestamp: TS,
        portfolio_var_95: -1, portfolio_var_99: -2,
        max_drawdown: -5, current_drawdown: -1,
        exposure_pct: 150, margin_used_pct: 40,
        risk_score: 50, circuit_breaker_active: false, warnings: [],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("MarketTickContract", () => {
    it("validates a correct tick", () => {
      const result = MarketTickContract.safeParse({
        symbol: "BTCUSD", timestamp: TS,
        bid: 41999, ask: 42001, last: 42000, volume: 1500000,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("OHLCVBarContract", () => {
    it("validates a correct bar", () => {
      const result = OHLCVBarContract.safeParse({
        symbol: "BTCUSD", timeframe: "1h", timestamp: TS,
        open: 41800, high: 42200, low: 41700, close: 42000, volume: 850000,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("BrainEventContract", () => {
    it("validates a correct brain event", () => {
      const result = BrainEventContract.safeParse({
        event_id: UUID, timestamp: TS, subsystem: "signal-engine",
        event_type: "signal", severity: "info",
        payload: { signal_count: 5, avg_confidence: 0.82 },
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid event_type", () => {
      const result = BrainEventContract.safeParse({
        event_id: UUID, timestamp: TS, subsystem: "test",
        event_type: "invalid_type", severity: "info", payload: {},
      });
      expect(result.success).toBe(false);
    });
  });

  describe("StrategyPerformanceContract", () => {
    it("validates a correct strategy perf record", () => {
      const result = StrategyPerformanceContract.safeParse({
        strategy_id: "smc-breakout-v2", strategy_name: "SMC Breakout V2",
        period_start: TS, period_end: "2025-02-15T10:30:00Z",
        total_trades: 142, win_rate: 0.68, profit_factor: 2.1,
        sharpe_ratio: 2.14, sortino_ratio: 3.02,
        max_drawdown: -8.4, total_pnl: 15420.50,
        avg_trade_duration_ms: 3600000,
      });
      expect(result.success).toBe(true);
    });

    it("rejects win_rate > 1", () => {
      const result = StrategyPerformanceContract.safeParse({
        strategy_id: "test", strategy_name: "Test",
        period_start: TS, period_end: TS,
        total_trades: 10, win_rate: 1.5, profit_factor: 1,
        sharpe_ratio: 1, sortino_ratio: 1,
        max_drawdown: -5, total_pnl: 100,
        avg_trade_duration_ms: 1000,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("ALL_CONTRACTS registry", () => {
    it("exports all 8 contracts", () => {
      expect(Object.keys(ALL_CONTRACTS)).toHaveLength(8);
    });

    it("every contract has a safeParse method", () => {
      for (const [name, schema] of Object.entries(ALL_CONTRACTS)) {
        expect(typeof schema.safeParse).toBe("function");
      }
    });
  });
});
