import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createShadowSession,
  recordShadowTrade,
  completeShadowSession,
  pauseShadowSession,
  resumeShadowSession,
  abortShadowSession,
  getShadowSession,
  getActiveSessions,
  getAllSessions,
  getSessionsByStrategy,
  compareShadowToLive,
  runStatisticalTest,
  _clearShadowTrading,
  type ShadowConfig,
} from "../lib/shadow_trading";

// Mock pino logger
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

// Mock risk engine
vi.mock("../../lib/risk_engine", () => ({
  evaluateRisk: vi.fn(),
}));

// Mock drawdown breaker
vi.mock("../../lib/drawdown_breaker", () => ({
  checkDrawdown: vi.fn(),
}));

describe("Shadow Trading Mode v2", () => {
  beforeEach(() => {
    _clearShadowTrading();
  });

  describe("Session Lifecycle", () => {
    it("should create a shadow session", () => {
      const config: ShadowConfig = {
        duration_hours: 2,
        max_trades: 10,
        symbols: ["AAPL", "MSFT"],
        compare_with_live: true,
      };

      const session = createShadowSession({
        strategy_id: "strat_001",
        strategy_name: "MA Crossover",
        config,
      });

      expect(session).toBeDefined();
      expect(session.id).toMatch(/^ss_/);
      expect(session.strategy_id).toBe("strat_001");
      expect(session.strategy_name).toBe("MA Crossover");
      expect(session.status).toBe("active");
      expect(session.trades).toEqual([]);
      expect(session.config).toEqual(config);
    });

    it("should pause an active session", () => {
      const session = createShadowSession({
        strategy_id: "strat_001",
        strategy_name: "MA Crossover",
        config: {
          duration_hours: 2,
          max_trades: 10,
          symbols: ["AAPL"],
          compare_with_live: true,
        },
      });

      const result = pauseShadowSession(session.id);
      expect(result.success).toBe(true);

      const retrieved = getShadowSession(session.id);
      expect(retrieved?.status).toBe("paused");
    });

    it("should resume a paused session", () => {
      const session = createShadowSession({
        strategy_id: "strat_001",
        strategy_name: "MA Crossover",
        config: {
          duration_hours: 2,
          max_trades: 10,
          symbols: ["AAPL"],
          compare_with_live: true,
        },
      });

      pauseShadowSession(session.id);
      const result = resumeShadowSession(session.id);
      expect(result.success).toBe(true);

      const retrieved = getShadowSession(session.id);
      expect(retrieved?.status).toBe("active");
    });

    it("should complete a session", () => {
      const session = createShadowSession({
        strategy_id: "strat_001",
        strategy_name: "MA Crossover",
        config: {
          duration_hours: 2,
          max_trades: 10,
          symbols: ["AAPL"],
          compare_with_live: true,
        },
      });

      const result = completeShadowSession(session.id);
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.total_signals).toBe(0);

      const retrieved = getShadowSession(session.id);
      expect(retrieved?.status).toBe("completed");
      expect(retrieved?.ended_at).toBeDefined();
    });

    it("should abort a session", () => {
      const session = createShadowSession({
        strategy_id: "strat_001",
        strategy_name: "MA Crossover",
        config: {
          duration_hours: 2,
          max_trades: 10,
          symbols: ["AAPL"],
          compare_with_live: true,
        },
      });

      const result = abortShadowSession(session.id);
      expect(result.success).toBe(true);

      const retrieved = getShadowSession(session.id);
      expect(retrieved?.status).toBe("aborted");
      expect(retrieved?.ended_at).toBeDefined();
    });

    it("should not allow pause on non-active session", () => {
      const session = createShadowSession({
        strategy_id: "strat_001",
        strategy_name: "MA Crossover",
        config: {
          duration_hours: 2,
          max_trades: 10,
          symbols: ["AAPL"],
          compare_with_live: true,
        },
      });

      abortShadowSession(session.id);
      const result = pauseShadowSession(session.id);
      expect(result.success).toBe(false);
      expect(result.error).toContain("cannot pause");
    });

    it("should not allow resume on non-paused session", () => {
      const session = createShadowSession({
        strategy_id: "strat_001",
        strategy_name: "MA Crossover",
        config: {
          duration_hours: 2,
          max_trades: 10,
          symbols: ["AAPL"],
          compare_with_live: true,
        },
      });

      const result = resumeShadowSession(session.id);
      expect(result.success).toBe(false);
      expect(result.error).toContain("can only resume paused");
    });
  });

  describe("Trade Recording with Auto-Compute", () => {
    it("should record shadow trade and auto-compute would_have_pnl for buy", () => {
      const session = createShadowSession({
        strategy_id: "strat_001",
        strategy_name: "MA Crossover",
        config: {
          duration_hours: 2,
          max_trades: 10,
          symbols: ["AAPL"],
          compare_with_live: true,
        },
      });

      const result = recordShadowTrade(session.id, {
        signal_timestamp: new Date().toISOString(),
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        signal_price: 150,
        market_price_at_signal: 150.5,
        market_price_after_1m: 151,
        market_price_after_5m: 152,
        decision_rationale: "MA crossover signal",
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.id).toMatch(/^st_/);
      expect(result.data?.would_have_pnl).toBe((152 - 150) * 100); // 200
      expect(result.data?.slippage_estimate_bps).toBeGreaterThan(0);
    });

    it("should record shadow trade and auto-compute would_have_pnl for sell", () => {
      const session = createShadowSession({
        strategy_id: "strat_001",
        strategy_name: "MA Crossover",
        config: {
          duration_hours: 2,
          max_trades: 10,
          symbols: ["AAPL"],
          compare_with_live: true,
        },
      });

      const result = recordShadowTrade(session.id, {
        signal_timestamp: new Date().toISOString(),
        symbol: "AAPL",
        side: "sell",
        quantity: 100,
        signal_price: 150,
        market_price_at_signal: 150.5,
        market_price_after_1m: 149,
        market_price_after_5m: 148,
        decision_rationale: "MA crossover signal",
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.would_have_pnl).toBe((150 - 148) * 100); // 200
    });

    it("should auto-compute slippage_estimate_bps", () => {
      const session = createShadowSession({
        strategy_id: "strat_001",
        strategy_name: "MA Crossover",
        config: {
          duration_hours: 2,
          max_trades: 10,
          symbols: ["AAPL"],
          compare_with_live: true,
        },
      });

      const result = recordShadowTrade(session.id, {
        signal_timestamp: new Date().toISOString(),
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        signal_price: 100,
        market_price_at_signal: 101,
        market_price_after_1m: 102,
        market_price_after_5m: 103,
        decision_rationale: "Signal",
      });

      expect(result.data?.slippage_estimate_bps).toBe(100); // (101-100)/100 * 10000 = 100
    });

    it("should enforce max_trades limit", () => {
      const session = createShadowSession({
        strategy_id: "strat_001",
        strategy_name: "MA Crossover",
        config: {
          duration_hours: 2,
          max_trades: 2,
          symbols: ["AAPL"],
          compare_with_live: true,
        },
      });

      recordShadowTrade(session.id, {
        signal_timestamp: new Date().toISOString(),
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        signal_price: 100,
        market_price_at_signal: 100.5,
        market_price_after_1m: 101,
        market_price_after_5m: 102,
        decision_rationale: "Signal 1",
      });

      recordShadowTrade(session.id, {
        signal_timestamp: new Date().toISOString(),
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        signal_price: 102,
        market_price_at_signal: 102.5,
        market_price_after_1m: 103,
        market_price_after_5m: 104,
        decision_rationale: "Signal 2",
      });

      const result = recordShadowTrade(session.id, {
        signal_timestamp: new Date().toISOString(),
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        signal_price: 104,
        market_price_at_signal: 104.5,
        market_price_after_1m: 105,
        market_price_after_5m: 106,
        decision_rationale: "Signal 3",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Max trades");
    });

    it("should not record trade on completed session", () => {
      const session = createShadowSession({
        strategy_id: "strat_001",
        strategy_name: "MA Crossover",
        config: {
          duration_hours: 2,
          max_trades: 10,
          symbols: ["AAPL"],
          compare_with_live: true,
        },
      });

      completeShadowSession(session.id);

      const result = recordShadowTrade(session.id, {
        signal_timestamp: new Date().toISOString(),
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        signal_price: 100,
        market_price_at_signal: 100.5,
        market_price_after_1m: 101,
        market_price_after_5m: 102,
        decision_rationale: "Signal",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("cannot record trades");
    });
  });

  describe("Metrics Computation", () => {
    it("should compute win_rate correctly", () => {
      const session = createShadowSession({
        strategy_id: "strat_001",
        strategy_name: "MA Crossover",
        config: {
          duration_hours: 2,
          max_trades: 10,
          symbols: ["AAPL"],
          compare_with_live: true,
        },
      });

      // Win trade
      recordShadowTrade(session.id, {
        signal_timestamp: new Date().toISOString(),
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        signal_price: 100,
        market_price_at_signal: 100.5,
        market_price_after_1m: 101,
        market_price_after_5m: 105,
        decision_rationale: "Win",
        would_have_pnl: 500,
      });

      // Loss trade
      recordShadowTrade(session.id, {
        signal_timestamp: new Date().toISOString(),
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        signal_price: 100,
        market_price_at_signal: 100.5,
        market_price_after_1m: 101,
        market_price_after_5m: 95,
        decision_rationale: "Loss",
        would_have_pnl: -500,
      });

      const result = completeShadowSession(session.id);
      expect(result.data?.win_rate).toBe(0.5);
      expect(result.data?.win_count).toBe(1);
      expect(result.data?.loss_count).toBe(1);
    });

    it("should compute sharpe_estimate", () => {
      const session = createShadowSession({
        strategy_id: "strat_001",
        strategy_name: "MA Crossover",
        config: {
          duration_hours: 2,
          max_trades: 10,
          symbols: ["AAPL"],
          compare_with_live: true,
        },
      });

      recordShadowTrade(session.id, {
        signal_timestamp: new Date().toISOString(),
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        signal_price: 100,
        market_price_at_signal: 100,
        market_price_after_1m: 101,
        market_price_after_5m: 102,
        decision_rationale: "Trade 1",
        would_have_pnl: 200,
      });

      recordShadowTrade(session.id, {
        signal_timestamp: new Date().toISOString(),
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        signal_price: 100,
        market_price_at_signal: 100,
        market_price_after_1m: 101,
        market_price_after_5m: 104,
        decision_rationale: "Trade 2",
        would_have_pnl: 400,
      });

      const result = completeShadowSession(session.id);
      expect(result.data?.sharpe_estimate).toBeGreaterThan(0);
    });

    it("should compute max_drawdown_pct", () => {
      const session = createShadowSession({
        strategy_id: "strat_001",
        strategy_name: "MA Crossover",
        config: {
          duration_hours: 2,
          max_trades: 10,
          symbols: ["AAPL"],
          compare_with_live: true,
        },
      });

      // Up 500
      recordShadowTrade(session.id, {
        signal_timestamp: new Date().toISOString(),
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        signal_price: 100,
        market_price_at_signal: 100,
        market_price_after_1m: 101,
        market_price_after_5m: 105,
        decision_rationale: "Up",
        would_have_pnl: 500,
      });

      // Down 300
      recordShadowTrade(session.id, {
        signal_timestamp: new Date().toISOString(),
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        signal_price: 100,
        market_price_at_signal: 100,
        market_price_after_1m: 101,
        market_price_after_5m: 97,
        decision_rationale: "Down",
        would_have_pnl: -300,
      });

      const result = completeShadowSession(session.id);
      expect(result.data?.max_drawdown_pct).toBeGreaterThan(0);
    });

    it("should compute metrics for empty session", () => {
      const session = createShadowSession({
        strategy_id: "strat_001",
        strategy_name: "MA Crossover",
        config: {
          duration_hours: 2,
          max_trades: 10,
          symbols: ["AAPL"],
          compare_with_live: true,
        },
      });

      const result = completeShadowSession(session.id);
      expect(result.success).toBe(true);
      expect(result.data?.total_signals).toBe(0);
      expect(result.data?.win_rate).toBe(0);
      expect(result.data?.sharpe_estimate).toBe(0);
      expect(result.data?.max_drawdown_pct).toBe(0);
    });
  });

  describe("Shadow-to-Live Comparison", () => {
    it("should mark shadow as better when pnl is higher", () => {
      const session = createShadowSession({
        strategy_id: "strat_001",
        strategy_name: "MA Crossover",
        config: {
          duration_hours: 2,
          max_trades: 10,
          symbols: ["AAPL"],
          compare_with_live: true,
        },
      });

      recordShadowTrade(session.id, {
        signal_timestamp: new Date().toISOString(),
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        signal_price: 100,
        market_price_at_signal: 100,
        market_price_after_1m: 101,
        market_price_after_5m: 105,
        decision_rationale: "Trade",
        would_have_pnl: 500,
      });

      completeShadowSession(session.id);

      const result = compareShadowToLive(session.id, 300, 1);
      expect(result.success).toBe(true);
      expect(result.data?.verdict).toBe("shadow_better");
      expect(result.data?.recommendation).toContain("Shadow");
    });

    it("should mark live as better when pnl is higher", () => {
      const session = createShadowSession({
        strategy_id: "strat_001",
        strategy_name: "MA Crossover",
        config: {
          duration_hours: 2,
          max_trades: 10,
          symbols: ["AAPL"],
          compare_with_live: true,
        },
      });

      recordShadowTrade(session.id, {
        signal_timestamp: new Date().toISOString(),
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        signal_price: 100,
        market_price_at_signal: 100,
        market_price_after_1m: 101,
        market_price_after_5m: 102,
        decision_rationale: "Trade",
        would_have_pnl: 200,
      });

      completeShadowSession(session.id);

      const result = compareShadowToLive(session.id, 500, 1);
      expect(result.success).toBe(true);
      expect(result.data?.verdict).toBe("live_better");
      expect(result.data?.recommendation).toContain("Live");
    });

    it("should mark comparable when divergence < 5%", () => {
      const session = createShadowSession({
        strategy_id: "strat_001",
        strategy_name: "MA Crossover",
        config: {
          duration_hours: 2,
          max_trades: 10,
          symbols: ["AAPL"],
          compare_with_live: true,
        },
      });

      recordShadowTrade(session.id, {
        signal_timestamp: new Date().toISOString(),
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        signal_price: 100,
        market_price_at_signal: 100,
        market_price_after_1m: 101,
        market_price_after_5m: 105,
        decision_rationale: "Trade",
        would_have_pnl: 500,
      });

      completeShadowSession(session.id);

      const result = compareShadowToLive(session.id, 490, 1);
      expect(result.success).toBe(true);
      expect(result.data?.verdict).toBe("comparable");
    });

    it("should return insufficient_data when trades are zero", () => {
      const session = createShadowSession({
        strategy_id: "strat_001",
        strategy_name: "MA Crossover",
        config: {
          duration_hours: 2,
          max_trades: 10,
          symbols: ["AAPL"],
          compare_with_live: true,
        },
      });

      completeShadowSession(session.id);

      const result = compareShadowToLive(session.id, 500, 0);
      expect(result.success).toBe(true);
      expect(result.data?.verdict).toBe("insufficient_data");
      expect(result.data?.confidence).toBe(0);
    });

    it("should compute confidence score", () => {
      const session = createShadowSession({
        strategy_id: "strat_001",
        strategy_name: "MA Crossover",
        config: {
          duration_hours: 2,
          max_trades: 10,
          symbols: ["AAPL"],
          compare_with_live: true,
        },
      });

      recordShadowTrade(session.id, {
        signal_timestamp: new Date().toISOString(),
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        signal_price: 100,
        market_price_at_signal: 100,
        market_price_after_1m: 101,
        market_price_after_5m: 105,
        decision_rationale: "Trade",
        would_have_pnl: 500,
      });

      completeShadowSession(session.id);

      const result = compareShadowToLive(session.id, 500, 1);
      expect(result.data?.confidence).toBeGreaterThan(0);
      expect(result.data?.confidence).toBeLessThanOrEqual(100);
    });
  });

  describe("Statistical Testing", () => {
    it("should run statistical test with live metrics", () => {
      const session = createShadowSession({
        strategy_id: "strat_001",
        strategy_name: "MA Crossover",
        config: {
          duration_hours: 2,
          max_trades: 10,
          symbols: ["AAPL"],
          compare_with_live: true,
        },
      });

      recordShadowTrade(session.id, {
        signal_timestamp: new Date().toISOString(),
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        signal_price: 100,
        market_price_at_signal: 100,
        market_price_after_1m: 101,
        market_price_after_5m: 105,
        decision_rationale: "Trade",
        would_have_pnl: 500,
      });

      completeShadowSession(session.id);

      const tests = runStatisticalTest(session.id, {
        pnl: 480,
        win_rate: 1.0,
        sharpe: 2.5,
      });

      expect(tests).toHaveLength(3);
      expect(tests[0].metric).toBe("pnl");
      expect(tests[1].metric).toBe("win_rate");
      expect(tests[2].metric).toBe("sharpe");

      tests.forEach((test) => {
        expect(test.p_value_proxy).toBeGreaterThanOrEqual(0);
        expect(test.p_value_proxy).toBeLessThanOrEqual(1);
        expect(typeof test.significant).toBe("boolean");
      });
    });

    it("should return empty array for nonexistent session", () => {
      const tests = runStatisticalTest("nonexistent", {
        pnl: 500,
        win_rate: 0.5,
        sharpe: 1.5,
      });

      expect(tests).toEqual([]);
    });
  });

  describe("Session Queries", () => {
    it("should get active sessions only", () => {
      createShadowSession({
        strategy_id: "strat_001",
        strategy_name: "MA Crossover",
        config: {
          duration_hours: 2,
          max_trades: 10,
          symbols: ["AAPL"],
          compare_with_live: true,
        },
      });

      const session2 = createShadowSession({
        strategy_id: "strat_002",
        strategy_name: "RSI Strategy",
        config: {
          duration_hours: 2,
          max_trades: 10,
          symbols: ["MSFT"],
          compare_with_live: true,
        },
      });

      pauseShadowSession(session2.id);

      const active = getActiveSessions();
      expect(active).toHaveLength(1);
      expect(active[0].strategy_name).toBe("MA Crossover");
    });

    it("should get all sessions with limit", () => {
      createShadowSession({
        strategy_id: "strat_001",
        strategy_name: "Strategy 1",
        config: {
          duration_hours: 2,
          max_trades: 10,
          symbols: ["AAPL"],
          compare_with_live: true,
        },
      });

      createShadowSession({
        strategy_id: "strat_002",
        strategy_name: "Strategy 2",
        config: {
          duration_hours: 2,
          max_trades: 10,
          symbols: ["MSFT"],
          compare_with_live: true,
        },
      });

      createShadowSession({
        strategy_id: "strat_003",
        strategy_name: "Strategy 3",
        config: {
          duration_hours: 2,
          max_trades: 10,
          symbols: ["GOOGL"],
          compare_with_live: true,
        },
      });

      const all = getAllSessions();
      expect(all).toHaveLength(3);

      const limited = getAllSessions(2);
      expect(limited).toHaveLength(2);
    });

    it("should get sessions by strategy", () => {
      createShadowSession({
        strategy_id: "strat_001",
        strategy_name: "MA Crossover V1",
        config: {
          duration_hours: 2,
          max_trades: 10,
          symbols: ["AAPL"],
          compare_with_live: true,
        },
      });

      createShadowSession({
        strategy_id: "strat_001",
        strategy_name: "MA Crossover V2",
        config: {
          duration_hours: 2,
          max_trades: 10,
          symbols: ["MSFT"],
          compare_with_live: true,
        },
      });

      createShadowSession({
        strategy_id: "strat_002",
        strategy_name: "RSI Strategy",
        config: {
          duration_hours: 2,
          max_trades: 10,
          symbols: ["GOOGL"],
          compare_with_live: true,
        },
      });

      const byStrategy = getSessionsByStrategy("strat_001");
      expect(byStrategy).toHaveLength(2);
      expect(byStrategy.every((s) => s.strategy_id === "strat_001")).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle session not found", () => {
      const result = getShadowSession("nonexistent");
      expect(result).toBeUndefined();
    });

    it("should handle pause on nonexistent session", () => {
      const result = pauseShadowSession("nonexistent");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should handle resume on nonexistent session", () => {
      const result = resumeShadowSession("nonexistent");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should handle complete on nonexistent session", () => {
      const result = completeShadowSession("nonexistent");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should handle abort on nonexistent session", () => {
      const result = abortShadowSession("nonexistent");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should handle compare on nonexistent session", () => {
      const result = compareShadowToLive("nonexistent", 500, 1);
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should handle record trade on nonexistent session", () => {
      const result = recordShadowTrade("nonexistent", {
        signal_timestamp: new Date().toISOString(),
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        signal_price: 100,
        market_price_at_signal: 100,
        market_price_after_1m: 101,
        market_price_after_5m: 102,
        decision_rationale: "Test",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should clear all shadow trading data", () => {
      createShadowSession({
        strategy_id: "strat_001",
        strategy_name: "MA Crossover",
        config: {
          duration_hours: 2,
          max_trades: 10,
          symbols: ["AAPL"],
          compare_with_live: true,
        },
      });

      _clearShadowTrading();

      const all = getAllSessions();
      expect(all).toHaveLength(0);
    });
  });

  describe("ID Generation", () => {
    it("should generate session IDs with ss_ prefix", () => {
      const session = createShadowSession({
        strategy_id: "strat_001",
        strategy_name: "MA Crossover",
        config: {
          duration_hours: 2,
          max_trades: 10,
          symbols: ["AAPL"],
          compare_with_live: true,
        },
      });

      expect(session.id).toMatch(/^ss_[0-9a-f-]+$/);
    });

    it("should generate trade IDs with st_ prefix", () => {
      const session = createShadowSession({
        strategy_id: "strat_001",
        strategy_name: "MA Crossover",
        config: {
          duration_hours: 2,
          max_trades: 10,
          symbols: ["AAPL"],
          compare_with_live: true,
        },
      });

      const result = recordShadowTrade(session.id, {
        signal_timestamp: new Date().toISOString(),
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        signal_price: 100,
        market_price_at_signal: 100,
        market_price_after_1m: 101,
        market_price_after_5m: 102,
        decision_rationale: "Test",
      });

      expect(result.data?.id).toMatch(/^st_[0-9a-f-]+$/);
    });

    it("should generate comparison IDs with sc_ prefix", () => {
      const session = createShadowSession({
        strategy_id: "strat_001",
        strategy_name: "MA Crossover",
        config: {
          duration_hours: 2,
          max_trades: 10,
          symbols: ["AAPL"],
          compare_with_live: true,
        },
      });

      recordShadowTrade(session.id, {
        signal_timestamp: new Date().toISOString(),
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        signal_price: 100,
        market_price_at_signal: 100,
        market_price_after_1m: 101,
        market_price_after_5m: 105,
        decision_rationale: "Test",
        would_have_pnl: 500,
      });

      completeShadowSession(session.id);
      const result = compareShadowToLive(session.id, 500, 1);

      expect(result.data?.id).toMatch(/^sc_[0-9a-f-]+$/);
    });
  });
});
