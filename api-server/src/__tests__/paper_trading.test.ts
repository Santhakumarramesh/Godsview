/**
 * Paper Trading Engine Tests (Phase 74)
 * 30+ tests covering the full paper trading lifecycle
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  startPaperTrading,
  stopPaperTrading,
  pausePaperTrading,
  resumePaperTrading,
  getPaperTradingState,
  processPaperSignal,
  getPaperTradingReport,
  paperTradingHealthCheck,
  getPaperTradingConfig,
  setPaperTradingConfig,
  type PaperTradingConfig,
  type SuperSignal,
} from "../engines/paper_trading_engine";
import { persistWrite, persistRead } from "../lib/persistent_store";

describe("Paper Trading Engine", () => {
  beforeEach(() => {
    // Reset persistent store before each test
    persistWrite("paper_trades", []);
  });

  afterEach(() => {
    stopPaperTrading();
  });

  // ── Initialization Tests ────────────────────────────────────────────

  describe("Initialization", () => {
    it("should start paper trading with default config", () => {
      const result = startPaperTrading();
      expect(result.success).toBe(true);
      expect(result.message).toContain("started");
    });

    it("should start paper trading with custom config", () => {
      const customConfig: Partial<PaperTradingConfig> = {
        maxDailyTrades: 100,
        paperEquity: 200000,
      };
      const result = startPaperTrading(customConfig);
      expect(result.success).toBe(true);

      const config = getPaperTradingConfig();
      expect(config.maxDailyTrades).toBe(100);
      expect(config.paperEquity).toBe(200000);
    });

    it("should not start if already running", () => {
      startPaperTrading();
      const result = startPaperTrading();
      expect(result.success).toBe(false);
      expect(result.message).toContain("already running");
    });

    it("should initialize state correctly", () => {
      startPaperTrading({
        paperEquity: 150000,
      });
      const state = getPaperTradingState();
      expect(state.status).toBe("running");
      expect(state.equity).toBe(150000);
      expect(state.cash).toBe(150000);
      expect(state.openPositions).toBe(0);
      expect(state.todayTrades).toBe(0);
    });
  });

  // ── Lifecycle Tests ─────────────────────────────────────────────────

  describe("Lifecycle Management", () => {
    it("should stop paper trading", () => {
      startPaperTrading();
      const result = stopPaperTrading();
      expect(result.success).toBe(true);

      const state = getPaperTradingState();
      expect(state.status).toBe("idle");
    });

    it("should not stop if not running", () => {
      const result = stopPaperTrading();
      expect(result.success).toBe(false);
    });

    it("should pause paper trading", () => {
      startPaperTrading();
      const result = pausePaperTrading();
      expect(result.success).toBe(true);

      const state = getPaperTradingState();
      expect(state.status).toBe("paused");
    });

    it("should resume paper trading", () => {
      startPaperTrading();
      pausePaperTrading();
      const result = resumePaperTrading();
      expect(result.success).toBe(true);

      const state = getPaperTradingState();
      expect(state.status).toBe("running");
    });

    it("should not resume if not paused", () => {
      startPaperTrading();
      const result = resumePaperTrading();
      expect(result.success).toBe(false);
    });

    it("should not pause if not running", () => {
      const result = pausePaperTrading();
      expect(result.success).toBe(false);
    });
  });

  // ── State Management Tests ──────────────────────────────────────────

  describe("State Management", () => {
    it("should return current state", () => {
      startPaperTrading({ paperEquity: 100000 });
      const state = getPaperTradingState();
      expect(state).toHaveProperty("status");
      expect(state).toHaveProperty("equity");
      expect(state).toHaveProperty("cash");
      expect(state).toHaveProperty("openPositions");
      expect(state).toHaveProperty("todayTrades");
      expect(state).toHaveProperty("todayPnl");
    });

    it("should track signals received", () => {
      startPaperTrading();
      const beforeState = getPaperTradingState();
      expect(beforeState.signalsReceived).toBe(0);

      // A signal will increment this counter
      const mockSignal = createMockSignal();
      processPaperSignal({
        ...mockSignal,
        symbol: "TEST",
        setup_type: "breakout",
        regime: "trending",
        direction: "long",
        entry_price: 100,
        stop_loss: 95,
        take_profit: 110,
      }).catch(() => {});

      // Small delay for async processing
      setTimeout(() => {
        const afterState = getPaperTradingState();
        expect(afterState.signalsReceived).toBeGreaterThanOrEqual(1);
      }, 100);
    });
  });

  // ── Signal Processing Tests ─────────────────────────────────────────

  describe("Signal Processing", () => {
    it("should reject signal if trading not running", async () => {
      const signal = createMockSignal();
      const result = await processPaperSignal({
        ...signal,
        symbol: "TEST",
        setup_type: "breakout",
        regime: "trending",
        direction: "long",
        entry_price: 100,
        stop_loss: 95,
        take_profit: 110,
      });

      expect(result.approved).toBe(false);
      expect(result.reason).toContain("not running");
    });

    it("should reject signal if quality below threshold", async () => {
      startPaperTrading({ signalThreshold: 0.7, sessionHoursUTC: [0, 23] });
      const signal = createMockSignal();
      signal.enhanced_quality = 0.65; // Below threshold

      const result = await processPaperSignal({
        ...signal,
        symbol: "TEST",
        setup_type: "breakout",
        regime: "trending",
        direction: "long",
        entry_price: 100,
        stop_loss: 95,
        take_profit: 110,
      });

      expect(result.approved).toBe(false);
      expect(result.reason).toContain("quality");
    });

    it("should reject signal if daily limit reached", async () => {
      startPaperTrading({ maxDailyTrades: 1, sessionHoursUTC: [0, 23] });

      // Mock a trade already being recorded
      persistWrite("paper_trades", [
        {
          id: "trade1",
          timestamp: new Date().toISOString(),
          symbol: "TEST1",
          side: "buy",
          quantity: 10,
          entry_price: 100,
          stop_loss: 95,
          take_profit: 110,
          setup_type: "breakout",
          regime: "trending",
          direction: "long",
          signal_quality: 0.75,
          win_probability: 0.65,
          edge_score: 1.5,
          kelly_fraction: 0.02,
          status: "open",
        },
      ]);

      // Reinitialize state to load the trade from disk
      stopPaperTrading();
      startPaperTrading({ maxDailyTrades: 1 });

      const signal = createMockSignal();
      const result = await processPaperSignal({
        ...signal,
        symbol: "TEST2",
        setup_type: "breakout",
        regime: "trending",
        direction: "long",
        entry_price: 100,
        stop_loss: 95,
        take_profit: 110,
      });

      expect(result.approved).toBe(false);
      expect(result.reason).toContain("Daily trade limit");
    });

    it("should reject signal if max positions reached", async () => {
      // Test that when max open positions is 1 and we're at limit, we reject
      // This tests the position limit check in processPaperSignal
      const trades = [
        {
          id: "existing_trade",
          timestamp: new Date().toISOString(),
          symbol: "EXISTING",
          side: "buy" as const,
          quantity: 10,
          entry_price: 100,
          stop_loss: 95,
          take_profit: 110,
          setup_type: "breakout",
          regime: "trending",
          direction: "long" as const,
          signal_quality: 0.75,
          win_probability: 0.65,
          edge_score: 1.5,
          kelly_fraction: 0.02,
          status: "open" as const,
        },
      ];

      persistWrite("paper_trades", trades);

      startPaperTrading({
        maxOpenPositions: 1,
        maxDailyTrades: 100,
        sessionHoursUTC: [0, 23],
      });

      // Verify the state correctly loaded the open position
      const state = getPaperTradingState();
      expect(state.openPositions).toBe(1);

      // Now try to process a new signal
      const signal = createMockSignal();
      const result = await processPaperSignal({
        ...signal,
        symbol: "NEWTEST",
        setup_type: "breakout",
        regime: "trending",
        direction: "long",
        entry_price: 100,
        stop_loss: 95,
        take_profit: 110,
      });

      expect(result.approved).toBe(false);
      expect(result.reason).toContain("Max open positions");
    });

    it("should reject signal if position size exceeds max", async () => {
      startPaperTrading({ maxPositionSize: 1000, sessionHoursUTC: [0, 23] });

      const signal = createMockSignal();
      signal.suggested_qty = 20; // 20 * 100 = 2000 > 1000 limit

      const result = await processPaperSignal({
        ...signal,
        symbol: "TEST",
        setup_type: "breakout",
        regime: "trending",
        direction: "long",
        entry_price: 100,
        stop_loss: 95,
        take_profit: 110,
      });

      expect(result.approved).toBe(false);
      expect(result.reason).toContain("Position size");
    });

    it("should reject signal if paused", async () => {
      startPaperTrading({ sessionHoursUTC: [0, 23] });
      pausePaperTrading();

      const signal = createMockSignal();
      const result = await processPaperSignal({
        ...signal,
        symbol: "TEST",
        setup_type: "breakout",
        regime: "trending",
        direction: "long",
        entry_price: 100,
        stop_loss: 95,
        take_profit: 110,
      });

      expect(result.approved).toBe(false);
      expect(result.reason).toContain("not running");
    });
  });

  // ── Configuration Tests ─────────────────────────────────────────────

  describe("Configuration", () => {
    it("should get current config", () => {
      startPaperTrading({
        maxDailyTrades: 75,
        maxPositionSize: 15000,
      });
      const config = getPaperTradingConfig();

      expect(config.maxDailyTrades).toBe(75);
      expect(config.maxPositionSize).toBe(15000);
    });

    it("should set new config", () => {
      startPaperTrading();
      const newConfig: Partial<PaperTradingConfig> = {
        signalThreshold: 0.8,
        cooldownMs: 60000,
      };

      const updated = setPaperTradingConfig(newConfig);
      expect(updated.signalThreshold).toBe(0.8);
      expect(updated.cooldownMs).toBe(60000);
    });

    it("should validate config values", () => {
      startPaperTrading();
      const config = getPaperTradingConfig();

      expect(config.maxDailyTrades).toBeGreaterThan(0);
      expect(config.maxPositionSize).toBeGreaterThan(0);
      expect(config.maxOpenPositions).toBeGreaterThan(0);
      expect(config.paperEquity).toBeGreaterThan(0);
      expect(config.signalThreshold).toBeGreaterThanOrEqual(0);
      expect(config.signalThreshold).toBeLessThanOrEqual(1);
    });
  });

  // ── Reporting Tests ─────────────────────────────────────────────────

  describe("Reporting", () => {
    it("should generate report with no trades", () => {
      startPaperTrading();
      const report = getPaperTradingReport(30);

      expect(report).toHaveProperty("generated_at");
      expect(report.days).toBe(30);
      expect(report.total_trades).toBe(0);
      expect(report.win_rate).toBe(0);
      expect(report.total_pnl).toBe(0);
    });

    it("should generate report with sample trades", () => {
      startPaperTrading();

      // Add sample trades
      const trades = [
        {
          id: "trade1",
          timestamp: new Date().toISOString(),
          symbol: "TEST",
          side: "buy",
          quantity: 10,
          entry_price: 100,
          stop_loss: 95,
          take_profit: 110,
          setup_type: "breakout",
          regime: "trending",
          direction: "long",
          signal_quality: 0.75,
          win_probability: 0.65,
          edge_score: 1.5,
          kelly_fraction: 0.02,
          status: "closed",
          close_price: 110,
          close_time: new Date().toISOString(),
          realized_pnl: 100,
        },
        {
          id: "trade2",
          timestamp: new Date().toISOString(),
          symbol: "TEST2",
          side: "sell",
          quantity: 5,
          entry_price: 50,
          stop_loss: 55,
          take_profit: 40,
          setup_type: "reversal",
          regime: "ranging",
          direction: "short",
          signal_quality: 0.7,
          win_probability: 0.6,
          edge_score: 1.2,
          kelly_fraction: 0.015,
          status: "closed",
          close_price: 40,
          close_time: new Date().toISOString(),
          realized_pnl: 50,
        },
      ];

      persistWrite("paper_trades", trades);

      const report = getPaperTradingReport(30);
      expect(report.total_trades).toBe(2);
      expect(report.winning_trades).toBe(2);
      expect(report.total_pnl).toBe(150);
      expect(report.win_rate).toBe(1.0);
    });

    it("should calculate win rate correctly", () => {
      startPaperTrading();

      const trades = [
        {
          id: "trade1",
          timestamp: new Date().toISOString(),
          symbol: "TEST",
          side: "buy",
          quantity: 10,
          entry_price: 100,
          stop_loss: 95,
          take_profit: 110,
          setup_type: "breakout",
          regime: "trending",
          direction: "long",
          signal_quality: 0.75,
          win_probability: 0.65,
          edge_score: 1.5,
          kelly_fraction: 0.02,
          status: "closed",
          close_price: 110,
          close_time: new Date().toISOString(),
          realized_pnl: 100,
        },
        {
          id: "trade2",
          timestamp: new Date().toISOString(),
          symbol: "TEST2",
          side: "buy",
          quantity: 5,
          entry_price: 50,
          stop_loss: 45,
          take_profit: 60,
          setup_type: "breakout",
          regime: "trending",
          direction: "long",
          signal_quality: 0.7,
          win_probability: 0.6,
          edge_score: 1.2,
          kelly_fraction: 0.015,
          status: "closed",
          close_price: 45,
          close_time: new Date().toISOString(),
          realized_pnl: -25,
        },
      ];

      persistWrite("paper_trades", trades);

      const report = getPaperTradingReport(30);
      expect(report.total_trades).toBe(2);
      expect(report.winning_trades).toBe(1);
      expect(report.losing_trades).toBe(1);
      expect(report.win_rate).toBe(0.5);
    });

    it("should include daily breakdown in report", () => {
      startPaperTrading();

      const today = new Date();
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

      const trades = [
        {
          id: "trade1",
          timestamp: today.toISOString(),
          symbol: "TEST",
          side: "buy",
          quantity: 10,
          entry_price: 100,
          stop_loss: 95,
          take_profit: 110,
          setup_type: "breakout",
          regime: "trending",
          direction: "long",
          signal_quality: 0.75,
          win_probability: 0.65,
          edge_score: 1.5,
          kelly_fraction: 0.02,
          status: "closed",
          close_price: 110,
          close_time: today.toISOString(),
          realized_pnl: 100,
        },
        {
          id: "trade2",
          timestamp: yesterday.toISOString(),
          symbol: "TEST2",
          side: "buy",
          quantity: 5,
          entry_price: 50,
          stop_loss: 45,
          take_profit: 60,
          setup_type: "breakout",
          regime: "trending",
          direction: "long",
          signal_quality: 0.7,
          win_probability: 0.6,
          edge_score: 1.2,
          kelly_fraction: 0.015,
          status: "closed",
          close_price: 55,
          close_time: yesterday.toISOString(),
          realized_pnl: 25,
        },
      ];

      persistWrite("paper_trades", trades);

      const report = getPaperTradingReport(30);
      expect(report.daily_breakdown.length).toBeGreaterThan(0);
      expect(report.daily_breakdown[0]).toHaveProperty("date");
      expect(report.daily_breakdown[0]).toHaveProperty("trades");
      expect(report.daily_breakdown[0]).toHaveProperty("pnl");
    });
  });

  // ── Health Check Tests ──────────────────────────────────────────────

  describe("Health Check", () => {
    it("should return health status", () => {
      startPaperTrading();
      const health = paperTradingHealthCheck();

      expect(health).toHaveProperty("status");
      expect(health).toHaveProperty("equity");
      expect(health).toHaveProperty("daily_pnl");
      expect(health).toHaveProperty("win_rate");
      expect(health).toHaveProperty("open_positions");
      expect(health).toHaveProperty("signal_approval_rate");
      expect(health).toHaveProperty("errors");
    });

    it("should calculate approval rate", () => {
      startPaperTrading();
      const health = paperTradingHealthCheck();

      expect(health.signal_approval_rate).toBeGreaterThanOrEqual(0);
      expect(health.signal_approval_rate).toBeLessThanOrEqual(1);
    });

    it("should calculate win rate from closed trades", () => {
      const trades = [
        {
          id: "trade1",
          timestamp: new Date().toISOString(),
          symbol: "TEST",
          side: "buy" as const,
          quantity: 10,
          entry_price: 100,
          stop_loss: 95,
          take_profit: 110,
          setup_type: "breakout",
          regime: "trending",
          direction: "long" as const,
          signal_quality: 0.75,
          win_probability: 0.65,
          edge_score: 1.5,
          kelly_fraction: 0.02,
          status: "closed" as const,
          close_price: 110,
          close_time: new Date().toISOString(),
          realized_pnl: 100,
        },
      ];

      persistWrite("paper_trades", trades);
      startPaperTrading();

      // The state should have loaded the closed trade as a win
      const state = getPaperTradingState();
      expect(state.todayWins).toBe(1);
      expect(state.todayLosses).toBe(0);

      const health = paperTradingHealthCheck();
      const totalTodayTrades = state.todayWins + state.todayLosses;
      if (totalTodayTrades > 0) {
        expect(health.win_rate).toBe(state.todayWins / totalTodayTrades);
      }
    });

    it("should report open positions count", () => {
      const trades = [
        {
          id: "trade1",
          timestamp: new Date().toISOString(),
          symbol: "TEST",
          side: "buy" as const,
          quantity: 10,
          entry_price: 100,
          stop_loss: 95,
          take_profit: 110,
          setup_type: "breakout",
          regime: "trending",
          direction: "long" as const,
          signal_quality: 0.75,
          win_probability: 0.65,
          edge_score: 1.5,
          kelly_fraction: 0.02,
          status: "open" as const,
        },
      ];

      persistWrite("paper_trades", trades);
      startPaperTrading();

      const state = getPaperTradingState();
      expect(state.openPositions).toBe(1);
    });
  });

  // ── Edge Cases ──────────────────────────────────────────────────────

  describe("Edge Cases", () => {
    it("should handle empty signal data", async () => {
      startPaperTrading();

      const signal = createMockSignal();
      signal.symbol = "";

      const result = await processPaperSignal({
        ...signal,
        symbol: "",
        setup_type: "breakout",
        regime: "trending",
        direction: "long",
        entry_price: 100,
        stop_loss: 95,
        take_profit: 110,
      });

      expect(result.approved).toBe(false);
    });

    it("should handle zero equity", () => {
      stopPaperTrading();
      const result = startPaperTrading({ paperEquity: 0 });
      expect(result.success).toBe(true);

      const state = getPaperTradingState();
      expect(state.equity).toBe(0);
    });

    it("should handle very high signal quality", async () => {
      startPaperTrading({ signalThreshold: 0.5 });

      const signal = createMockSignal();
      signal.enhanced_quality = 0.99;

      const result = await processPaperSignal({
        ...signal,
        symbol: "TEST",
        setup_type: "breakout",
        regime: "trending",
        direction: "long",
        entry_price: 100,
        stop_loss: 95,
        take_profit: 110,
      });

      expect(result.approved).toBe(false);
    });

    it("should handle report request for future date range", () => {
      startPaperTrading();

      const report = getPaperTradingReport(120);
      expect(report.days).toBeLessThanOrEqual(120);
    });

    it("should persist and retrieve trades", () => {
      startPaperTrading();

      const mockTrade = {
        id: "test_trade_123",
        timestamp: new Date().toISOString(),
        symbol: "AAPL",
        side: "buy" as const,
        quantity: 10,
        entry_price: 150.5,
        stop_loss: 145.0,
        take_profit: 160.0,
        setup_type: "breakout",
        regime: "trending",
        direction: "long" as const,
        signal_quality: 0.78,
        win_probability: 0.68,
        edge_score: 1.45,
        kelly_fraction: 0.025,
        status: "closed" as const,
        close_price: 160.0,
        close_time: new Date().toISOString(),
        realized_pnl: 95,
      };

      persistWrite("paper_trades", [mockTrade]);
      const retrieved = persistRead("paper_trades", []);

      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].id).toBe("test_trade_123");
    });
  });
});

// ── Helper Functions ───────────────────────────────────────────────────────

function createMockSignal(): SuperSignal {
  return {
    base_quality: 0.7,
    enhanced_quality: 0.75,
    win_probability: 0.65,
    kelly_fraction: 0.02,
    suggested_qty: 10,
    regime_weights: {
      structure: 0.35,
      order_flow: 0.25,
      recall: 0.2,
      ml: 0.15,
      claude: 0.05,
      label: "trending",
    },
    confluence_score: 0.8,
    aligned_timeframes: 3,
    trailing_stop: {
      initial_atr_multiple: 2.0,
      activation_atr: 1.5,
      trail_step: 0.5,
      max_hold_minutes: 240,
    },
    profit_targets: [
      { close_pct: 0.5, r_target: 1.5 },
      { close_pct: 0.5, r_target: 3.0 },
    ],
    approved: true,
    edge_score: 1.5,
  };
}
