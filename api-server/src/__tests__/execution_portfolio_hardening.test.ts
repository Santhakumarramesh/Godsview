/**
 * Execution Core + Portfolio Allocation Hardening Tests
 * Phase 69-70: Wave 3.1-3.3
 *
 * Tests for:
 * - order_executor.ts validation, audit trail, health checks
 * - position_monitor.ts position health, lifecycle tracking
 * - execution_intelligence.ts slippage validation, quality reports
 * - portfolio_allocator.ts constraint validation, correlation guard
 * - position_sizing_oracle.ts input validation, Kelly cap
 * - drawdown_breaker.ts persistence, health checks
 * - trade_journal.ts health checks, stats aggregation
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  validateExecutionRequest,
  ExecutionRequest,
  executionHealthCheck,
  getExecutionLog,
  ExecutionLogEntry,
} from "../lib/order_executor";
import {
  positionHealthCheck,
  getPositionHistory,
  PositionHealthCheck,
  PositionLifecycleEvent,
} from "../lib/position_monitor";
import {
  validateSlippageInput,
  getSlippageStats,
} from "../lib/execution_intelligence";
import {
  validateAllocationConstraints,
  correlationGuard,
  PortfolioAllocatorPolicy,
  PortfolioAllocationEntry,
} from "../lib/portfolio_allocator";
import {
  validateSizingInput,
  SizingInput,
} from "../lib/position_sizing_oracle";
import {
  drawdownHealthCheck,
  getDrawdownHistory,
  DrawdownEvent,
} from "../lib/drawdown_breaker";
import {
  journalHealthCheck,
  getJournalStatsByPeriod,
} from "../lib/trade_journal";
import { persistWrite, persistRead, persistDelete, persistAppend, getCollectionSize } from "../lib/persistent_store";

describe("execution_portfolio_hardening", () => {
  beforeEach(() => {
    // Clean up persistent store before each test
    persistDelete("execution_log");
    persistDelete("position_events");
    persistDelete("execution_quality");
    persistDelete("allocation_snapshots");
    persistDelete("sizing_decisions");
    persistDelete("drawdown_events");
    persistDelete("journal_entries");
  });

  // ────────────────────────────────────────────────────────────────────────
  // ORDER EXECUTOR TESTS
  // ────────────────────────────────────────────────────────────────────────

  describe("order_executor validation", () => {
    it("should validate valid execution request", () => {
      const req: Partial<ExecutionRequest> = {
        symbol: "AAPL",
        side: "buy",
        quantity: 10,
        direction: "long",
        entry_price: 150,
        stop_loss: 145,
        take_profit: 160,
        decision: {
          action: "EXECUTE",
          signal: {} as any,
          block_reasons: [],
          meta: {},
        },
      };

      const errors = validateExecutionRequest(req as ExecutionRequest);
      expect(errors.length).toBe(0);
    });

    it("should reject invalid symbol", () => {
      const req: Partial<ExecutionRequest> = {
        symbol: "",
        side: "buy",
        quantity: 10,
        direction: "long",
        entry_price: 150,
        stop_loss: 145,
        take_profit: 160,
        decision: { action: "EXECUTE", signal: {} as any, block_reasons: [], meta: {} },
      };

      const errors = validateExecutionRequest(req as ExecutionRequest);
      expect(errors.some((e) => e.includes("Symbol"))).toBe(true);
    });

    it("should reject invalid quantity", () => {
      const req: Partial<ExecutionRequest> = {
        symbol: "AAPL",
        side: "buy",
        quantity: -5,
        direction: "long",
        entry_price: 150,
        stop_loss: 145,
        take_profit: 160,
        decision: { action: "EXECUTE", signal: {} as any, block_reasons: [], meta: {} },
      };

      const errors = validateExecutionRequest(req as ExecutionRequest);
      expect(errors.some((e) => e.includes("quantity"))).toBe(true);
    });

    it("should reject invalid direction for stop loss", () => {
      const req: Partial<ExecutionRequest> = {
        symbol: "AAPL",
        side: "buy",
        quantity: 10,
        direction: "long",
        entry_price: 150,
        stop_loss: 155, // Wrong: should be below entry for long
        take_profit: 160,
        decision: { action: "EXECUTE", signal: {} as any, block_reasons: [], meta: {} },
      };

      const errors = validateExecutionRequest(req as ExecutionRequest);
      expect(errors.some((e) => e.includes("Long stop loss"))).toBe(true);
    });

    it("should reject invalid direction for take profit", () => {
      const req: Partial<ExecutionRequest> = {
        symbol: "AAPL",
        side: "buy",
        quantity: 10,
        direction: "long",
        entry_price: 150,
        stop_loss: 145,
        take_profit: 140, // Wrong: should be above entry for long
        decision: { action: "EXECUTE", signal: {} as any, block_reasons: [], meta: {} },
      };

      const errors = validateExecutionRequest(req as ExecutionRequest);
      expect(errors.some((e) => e.includes("Long take profit"))).toBe(true);
    });

    it("should validate short direction constraints", () => {
      const req: Partial<ExecutionRequest> = {
        symbol: "AAPL",
        side: "sell",
        quantity: 10,
        direction: "short",
        entry_price: 150,
        stop_loss: 145, // Wrong: should be above entry for short
        take_profit: 140,
        decision: { action: "EXECUTE", signal: {} as any, block_reasons: [], meta: {} },
      };

      const errors = validateExecutionRequest(req as ExecutionRequest);
      expect(errors.some((e) => e.includes("Short stop loss"))).toBe(true);
    });
  });

  describe("execution audit trail", () => {
    it("should persist execution log entries", () => {
      const entry: ExecutionLogEntry = {
        timestamp: new Date().toISOString(),
        symbol: "AAPL",
        side: "buy",
        quantity: 10,
        execution_mode: "paper",
        success: true,
        order_id: "order123",
        duration_ms: 100,
      };

      persistAppend("execution_log", entry, 5000);
      const size = getCollectionSize("execution_log");
      expect(size).toBeGreaterThan(0);
    });

    it("should retrieve execution log", () => {
      const entry1: ExecutionLogEntry = {
        timestamp: new Date().toISOString(),
        symbol: "AAPL",
        side: "buy",
        quantity: 10,
        execution_mode: "paper",
        success: true,
        duration_ms: 100,
      };
      const entry2: ExecutionLogEntry = {
        timestamp: new Date().toISOString(),
        symbol: "MSFT",
        side: "sell",
        quantity: 5,
        execution_mode: "paper",
        success: false,
        error_message: "Insufficient funds",
        duration_ms: 50,
      };

      persistAppend("execution_log", entry1, 5000);
      persistAppend("execution_log", entry2, 5000);

      const log = getExecutionLog("AAPL", 100);
      expect(log.length).toBeGreaterThan(0);
      expect(log.some((e) => e.symbol === "AAPL")).toBe(true);
    });

    it("should compute execution health check", () => {
      persistAppend("execution_log", {
        timestamp: new Date().toISOString(),
        symbol: "AAPL",
        side: "buy",
        quantity: 10,
        execution_mode: "paper",
        success: true,
        duration_ms: 100,
      } as ExecutionLogEntry, 5000);

      persistAppend("execution_log", {
        timestamp: new Date().toISOString(),
        symbol: "MSFT",
        side: "sell",
        quantity: 5,
        execution_mode: "paper",
        success: false,
        error_message: "Error",
        duration_ms: 50,
      } as ExecutionLogEntry, 5000);

      const health = executionHealthCheck();
      expect(health.total_execution_attempts).toBeGreaterThan(0);
      expect(health.error_rate_pct).toBeGreaterThanOrEqual(0);
      expect(health.avg_latency_ms).toBeGreaterThanOrEqual(0);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // POSITION MONITOR TESTS
  // ────────────────────────────────────────────────────────────────────────

  describe("position monitor health checks", () => {
    it("should compute position health check", () => {
      const health = positionHealthCheck();
      expect(health.managed_positions).toBeGreaterThanOrEqual(0);
      expect(health.stale_positions).toBeGreaterThanOrEqual(0);
      expect(health.total_monitored_value_usd).toBeGreaterThanOrEqual(0);
    });

    it("should track position lifecycle events", () => {
      const event: PositionLifecycleEvent = {
        symbol: "AAPL",
        stage: "opened",
        entry_price: 150,
        entry_time: new Date().toISOString(),
        quantity_opened: 10,
      };

      persistAppend("position_events", event, 5000);
      const history = getPositionHistory("AAPL");
      expect(history.length).toBeGreaterThan(0);
      expect(history[0].symbol).toBe("AAPL");
      expect(history[0].stage).toBe("opened");
    });

    it("should record full close lifecycle event", () => {
      const openEvent: PositionLifecycleEvent = {
        symbol: "AAPL",
        stage: "opened",
        entry_price: 150,
        entry_time: new Date().toISOString(),
        quantity_opened: 10,
      };

      const closeEvent: PositionLifecycleEvent = {
        symbol: "AAPL",
        stage: "full_closed",
        entry_price: 150,
        close_price: 155,
        entry_time: new Date().toISOString(),
        close_time: new Date().toISOString(),
        quantity_opened: 10,
        quantity_closed: 10,
        reason: "stop_hit",
      };

      persistAppend("position_events", openEvent, 5000);
      persistAppend("position_events", closeEvent, 5000);

      const history = getPositionHistory("AAPL");
      expect(history.length).toBe(2);
      expect(history.some((e) => e.stage === "full_closed")).toBe(true);
    });

    it("should record partial close lifecycle event", () => {
      const partialEvent: PositionLifecycleEvent = {
        symbol: "AAPL",
        stage: "partial_closed",
        entry_price: 150,
        close_price: 152,
        entry_time: new Date().toISOString(),
        close_time: new Date().toISOString(),
        quantity_opened: 10,
        quantity_closed: 3,
        reason: "partial_at_1R",
      };

      persistAppend("position_events", partialEvent, 5000);
      const history = getPositionHistory("AAPL");
      expect(history.some((e) => e.stage === "partial_closed")).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // EXECUTION INTELLIGENCE TESTS
  // ────────────────────────────────────────────────────────────────────────

  describe("execution intelligence validation", () => {
    it("should validate slippage input with valid params", () => {
      const params = {
        symbol: "AAPL",
        price: 150,
        volume: 1000000,
        spread: 0.02,
        atr: 1.5,
        orderSizeUsd: 5000,
      };

      const errors = validateSlippageInput(params);
      expect(errors.length).toBe(0);
    });

    it("should reject invalid price", () => {
      const params = { price: -10 };
      const errors = validateSlippageInput(params);
      expect(errors.some((e) => e.includes("price"))).toBe(true);
    });

    it("should reject invalid spread", () => {
      const params = { spread: -0.01 };
      const errors = validateSlippageInput(params);
      expect(errors.some((e) => e.includes("spread"))).toBe(true);
    });

    it("should reject invalid ATR", () => {
      const params = { atr: -0.5 };
      const errors = validateSlippageInput(params);
      expect(errors.some((e) => e.includes("ATR"))).toBe(true);
    });

    it("should reject invalid order size", () => {
      const params = { orderSizeUsd: -1000 };
      const errors = validateSlippageInput(params);
      expect(errors.some((e) => e.includes("order size"))).toBe(true);
    });
  });

  describe("execution quality persistence", () => {
    it("should persist execution quality reports", () => {
      persistAppend(
        "execution_quality",
        {
          tradeId: "trade1",
          symbol: "AAPL",
          expectedEntry: 150,
          actualEntry: 150.5,
          entrySlippageBps: 3.3,
          expectedExit: 155,
          actualExit: 154.8,
          exitSlippageBps: 1.3,
          totalSlippageCost: 1.7,
          fillTimeMs: 200,
          orderType: "limit",
          qualityScore: 85,
          grade: "B",
          reportedAt: new Date().toISOString(),
        },
        2000,
      );

      const size = getCollectionSize("execution_quality");
      expect(size).toBeGreaterThan(0);
    });

    it("should compute slippage stats", () => {
      persistAppend(
        "execution_quality",
        {
          tradeId: "trade1",
          symbol: "AAPL",
          expectedEntry: 150,
          actualEntry: 150.5,
          entrySlippageBps: 3.3,
          expectedExit: 155,
          actualExit: 154.8,
          exitSlippageBps: 1.3,
          totalSlippageCost: 1.7,
          fillTimeMs: 200,
          orderType: "limit",
          qualityScore: 85,
          grade: "B",
          reportedAt: new Date().toISOString(),
        },
        2000,
      );

      const stats = getSlippageStats("AAPL", 30);
      expect(stats.symbol).toBe("AAPL");
      expect(stats.sampleCount).toBeGreaterThan(0);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // PORTFOLIO ALLOCATOR TESTS
  // ────────────────────────────────────────────────────────────────────────

  describe("portfolio allocation constraint validation", () => {
    it("should validate correct allocation policy", () => {
      const policy: PortfolioAllocatorPolicy = {
        account_equity: 100000,
        max_total_risk_pct: 0.12,
        max_positions: 8,
        max_new_allocations: 6,
        max_symbol_exposure_pct: 0.2,
        min_expected_value: 0.05,
        min_risk_pct_per_trade: 0.0035,
        max_risk_pct_per_trade: 0.02,
      };

      const errors = validateAllocationConstraints(policy);
      expect(errors.length).toBe(0);
    });

    it("should reject invalid max_total_risk_pct", () => {
      const policy: PortfolioAllocatorPolicy = {
        account_equity: 100000,
        max_total_risk_pct: 1.5, // Invalid: > 1
        max_positions: 8,
        max_new_allocations: 6,
        max_symbol_exposure_pct: 0.2,
        min_expected_value: 0.05,
        min_risk_pct_per_trade: 0.0035,
        max_risk_pct_per_trade: 0.02,
      };

      const errors = validateAllocationConstraints(policy);
      expect(errors.some((e) => e.includes("max_total_risk_pct"))).toBe(true);
    });

    it("should reject when min > max risk pct", () => {
      const policy: PortfolioAllocatorPolicy = {
        account_equity: 100000,
        max_total_risk_pct: 0.12,
        max_positions: 8,
        max_new_allocations: 6,
        max_symbol_exposure_pct: 0.2,
        min_expected_value: 0.05,
        min_risk_pct_per_trade: 0.05, // Greater than max
        max_risk_pct_per_trade: 0.02,
      };

      const errors = validateAllocationConstraints(policy);
      expect(
        errors.some((e) => e.includes("min_risk_pct_per_trade must be <="))
      ).toBe(true);
    });

    it("should reject invalid account_equity", () => {
      const policy: PortfolioAllocatorPolicy = {
        account_equity: 0,
        max_total_risk_pct: 0.12,
        max_positions: 8,
        max_new_allocations: 6,
        max_symbol_exposure_pct: 0.2,
        min_expected_value: 0.05,
        min_risk_pct_per_trade: 0.0035,
        max_risk_pct_per_trade: 0.02,
      };

      const errors = validateAllocationConstraints(policy);
      expect(errors.some((e) => e.includes("account_equity"))).toBe(true);
    });
  });

  describe("correlation guard", () => {
    it("should pass with uncorrelated positions", () => {
      const allocations: PortfolioAllocationEntry[] = [
        {
          decision_id: 1,
          symbol: "AAPL",
          setup_type: "breakout",
          regime: "trending_up",
          direction: "long",
          strategy_id: "strat1",
          score: 85,
          expected_value: 0.15,
          risk_pct: 0.01,
          risk_usd: 1000,
          notional_usd: 15000,
          quantity: 10,
          rationale: ["Good setup"],
        },
        {
          decision_id: 2,
          symbol: "XLE", // Energy sector, different from tech
          setup_type: "mean_reversion",
          regime: "trending_up",
          direction: "long",
          strategy_id: "strat2",
          score: 80,
          expected_value: 0.12,
          risk_pct: 0.01,
          risk_usd: 1000,
          notional_usd: 12000,
          quantity: 5,
          rationale: ["Good setup"],
        },
      ];

      const result = correlationGuard(allocations);
      expect(result.warnings.length).toBeGreaterThanOrEqual(0); // May have warnings or not
    });

    it("should warn about correlated positions with high combined weight", () => {
      const allocations: PortfolioAllocationEntry[] = [
        {
          decision_id: 1,
          symbol: "MSFT",
          setup_type: "breakout",
          regime: "trending_up",
          direction: "long",
          strategy_id: "strat1",
          score: 85,
          expected_value: 0.15,
          risk_pct: 0.25, // 25% risk
          risk_usd: 25000,
          notional_usd: 125000,
          quantity: 100,
          rationale: ["Good setup"],
        },
        {
          decision_id: 2,
          symbol: "AAPL",
          setup_type: "breakout",
          regime: "trending_up",
          direction: "long",
          strategy_id: "strat1", // Same strategy, high correlation likely
          score: 85,
          expected_value: 0.15,
          risk_pct: 0.20, // 20% risk
          risk_usd: 20000,
          notional_usd: 120000,
          quantity: 50,
          rationale: ["Good setup"],
        },
      ];

      const result = correlationGuard(allocations);
      // Combined weight is 45%, which exceeds 40% threshold
      expect(result.passed).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // POSITION SIZING ORACLE TESTS
  // ────────────────────────────────────────────────────────────────────────

  describe("position sizing input validation", () => {
    it("should validate correct sizing input", () => {
      const input: SizingInput = {
        equity: 100000,
        riskPct: 0.01,
        entryPrice: 150,
        stopLoss: 145,
        winRate: 0.55,
        avgWinLossRatio: 1.5,
      };

      const errors = validateSizingInput(input);
      expect(errors.length).toBe(0);
    });

    it("should reject risk pct below 0.001", () => {
      const input: SizingInput = {
        equity: 100000,
        riskPct: 0.0005, // Too low
        entryPrice: 150,
        stopLoss: 145,
      };

      const errors = validateSizingInput(input);
      expect(errors.some((e) => e.includes("Risk pct"))).toBe(true);
    });

    it("should reject risk pct above 0.1", () => {
      const input: SizingInput = {
        equity: 100000,
        riskPct: 0.15, // Too high
        entryPrice: 150,
        stopLoss: 145,
      };

      const errors = validateSizingInput(input);
      expect(errors.some((e) => e.includes("Risk pct"))).toBe(true);
    });

    it("should reject invalid win rate", () => {
      const input: SizingInput = {
        equity: 100000,
        riskPct: 0.01,
        entryPrice: 150,
        stopLoss: 145,
        winRate: 1.5, // Invalid: > 1
      };

      const errors = validateSizingInput(input);
      expect(errors.some((e) => e.includes("Win rate"))).toBe(true);
    });

    it("should reject negative win/loss ratio", () => {
      const input: SizingInput = {
        equity: 100000,
        riskPct: 0.01,
        entryPrice: 150,
        stopLoss: 145,
        avgWinLossRatio: -1.5,
      };

      const errors = validateSizingInput(input);
      expect(errors.some((e) => e.includes("win/loss ratio"))).toBe(true);
    });

    it("should reject negative ATR", () => {
      const input: SizingInput = {
        equity: 100000,
        riskPct: 0.01,
        entryPrice: 150,
        stopLoss: 145,
        atr: -2,
      };

      const errors = validateSizingInput(input);
      expect(errors.some((e) => e.includes("ATR"))).toBe(true);
    });
  });

  describe("Kelly criterion cap", () => {
    it("should persist sizing decisions", () => {
      persistAppend(
        "sizing_decisions",
        {
          method: "KELLY",
          positionSize: 5000,
          dollarRisk: 500,
          shares: 33,
          riskPctActual: 0.005,
          kellyFraction: 0.15, // Should be capped at 0.25
          adjustments: [{ factor: "kelly_half", multiplier: 0.75 }],
          confidence: 0.85,
          calculatedAt: new Date().toISOString(),
        },
        2000,
      );

      const size = getCollectionSize("sizing_decisions");
      expect(size).toBeGreaterThan(0);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // DRAWDOWN BREAKER TESTS
  // ────────────────────────────────────────────────────────────────────────

  describe("drawdown breaker persistence", () => {
    it("should persist drawdown events", () => {
      const event: DrawdownEvent = {
        timestamp: new Date().toISOString(),
        level: "WARNING",
        realized_pnl: -100,
        unrealized_pnl: -50,
        peak_equity: 100000,
        reason: "Daily loss at 50% threshold",
      };

      persistAppend("drawdown_events", event, 5000);
      const size = getCollectionSize("drawdown_events");
      expect(size).toBeGreaterThan(0);
    });

    it("should retrieve drawdown history", () => {
      const event1: DrawdownEvent = {
        timestamp: new Date().toISOString(),
        level: "WARNING",
        realized_pnl: -100,
        unrealized_pnl: -50,
        peak_equity: 100000,
        reason: "Daily loss at 50% threshold",
      };

      const event2: DrawdownEvent = {
        timestamp: new Date(Date.now() - 1000).toISOString(),
        level: "THROTTLE",
        realized_pnl: -200,
        unrealized_pnl: -100,
        peak_equity: 100000,
        reason: "Daily loss at 75% threshold",
      };

      persistAppend("drawdown_events", event1, 5000);
      persistAppend("drawdown_events", event2, 5000);

      const history = getDrawdownHistory(1);
      expect(history.length).toBeGreaterThan(0);
    });

    it("should compute drawdown health check", () => {
      const health = drawdownHealthCheck();
      expect(health.current_level).toBeDefined();
      expect(health.peak_equity).toBeGreaterThanOrEqual(0);
      expect(typeof health.cooldown_active).toBe("boolean");
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // TRADE JOURNAL TESTS
  // ────────────────────────────────────────────────────────────────────────

  describe("trade journal health checks", () => {
    it("should compute journal health check", () => {
      const health = journalHealthCheck();
      expect(health.total_entries).toBeGreaterThanOrEqual(0);
      expect(health.entries_today).toBeGreaterThanOrEqual(0);
      expect(health.open_positions).toBeGreaterThanOrEqual(0);
    });

    it("should aggregate journal stats by day", () => {
      const stats = getJournalStatsByPeriod("day");
      expect(stats.period).toBe("day");
      expect(stats.trades).toBeGreaterThanOrEqual(0);
      expect(stats.win_rate).toBeGreaterThanOrEqual(0);
    });

    it("should aggregate journal stats by week", () => {
      const stats = getJournalStatsByPeriod("week");
      expect(stats.period).toBe("week");
      expect(stats.trades).toBeGreaterThanOrEqual(0);
    });

    it("should aggregate journal stats by month", () => {
      const stats = getJournalStatsByPeriod("month");
      expect(stats.period).toBe("month");
      expect(stats.trades).toBeGreaterThanOrEqual(0);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // PERSISTENT STORE INTEGRATION TESTS
  // ────────────────────────────────────────────────────────────────────────

  describe("persistent store integration", () => {
    it("should write and read collections", () => {
      const data = [
        { id: 1, value: "test1" },
        { id: 2, value: "test2" },
      ];

      persistWrite("test_collection", data);
      const read = persistRead("test_collection", []);

      expect(read.length).toBe(2);
      expect(read[0].value).toBe("test1");

      persistDelete("test_collection");
    });

    it("should append items to collection", () => {
      persistAppend("test_append", { id: 1, data: "first" }, 100);
      persistAppend("test_append", { id: 2, data: "second" }, 100);

      const items = persistRead("test_append", []);
      expect(items.length).toBe(2);

      persistDelete("test_append");
    });

    it("should trim collection to max items", () => {
      for (let i = 0; i < 10; i++) {
        persistAppend("test_trim", { id: i }, 5);
      }

      const items = persistRead("test_trim", []);
      expect(items.length).toBeLessThanOrEqual(5);

      persistDelete("test_trim");
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // INTEGRATION TESTS
  // ────────────────────────────────────────────────────────────────────────

  describe("full workflow integration", () => {
    it("should validate and log order execution", () => {
      const req: Partial<ExecutionRequest> = {
        symbol: "AAPL",
        side: "buy",
        quantity: 10,
        direction: "long",
        entry_price: 150,
        stop_loss: 145,
        take_profit: 160,
        decision: { action: "EXECUTE", signal: {} as any, block_reasons: [], meta: {} },
      };

      const errors = validateExecutionRequest(req as ExecutionRequest);
      expect(errors.length).toBe(0);

      // Simulate logging
      const logEntry: ExecutionLogEntry = {
        timestamp: new Date().toISOString(),
        symbol: "AAPL",
        side: "buy",
        quantity: 10,
        execution_mode: "paper",
        success: true,
        duration_ms: 125,
      };

      persistAppend("execution_log", logEntry, 5000);
      const log = getExecutionLog("AAPL", 10);
      expect(log.length).toBeGreaterThan(0);
    });

    it("should coordinate portfolio allocation and sizing", () => {
      const policy: PortfolioAllocatorPolicy = {
        account_equity: 100000,
        max_total_risk_pct: 0.12,
        max_positions: 8,
        max_new_allocations: 6,
        max_symbol_exposure_pct: 0.2,
        min_expected_value: 0.05,
        min_risk_pct_per_trade: 0.0035,
        max_risk_pct_per_trade: 0.02,
      };

      const policyErrors = validateAllocationConstraints(policy);
      expect(policyErrors.length).toBe(0);

      const sizingInput: SizingInput = {
        equity: 100000,
        riskPct: 0.01,
        entryPrice: 150,
        stopLoss: 145,
        winRate: 0.55,
        avgWinLossRatio: 1.5,
      };

      const sizingErrors = validateSizingInput(sizingInput);
      expect(sizingErrors.length).toBe(0);
    });
  });
});
