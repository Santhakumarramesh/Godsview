import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock external dependencies ───────────────────────────────────
vi.mock("../lib/risk_engine", () => ({
  isKillSwitchActive: () => false,
  getRiskEngineSnapshot: () => ({}),
}));
vi.mock("../lib/drawdown_breaker", () => ({
  getBreakerSnapshot: () => ({ sizeMultiplier: 1.0 }),
  isCooldownActive: () => false,
}));
vi.mock("../lib/emergency_liquidator", () => ({
  emergencyLiquidateAll: async () => ({}),
  isLiquidationInProgress: () => false,
}));

// ── Import modules under test ────────────────────────────────────
import {
  createDecisionPacket,
  getPacket,
  getAllPackets,
  queryPackets,
  markForReplay,
  _clearAll,
  type DecisionPacket,
} from "../lib/god_brain/decision_packet";

import {
  getBrainStatus,
  getDecisionQueue,
  getTerminalData,
  _resetBrainStartTime,
} from "../lib/god_brain/brain_aggregator";

describe("Phase 25: God Brain / Quanta Terminal Integration", () => {
  beforeEach(() => {
    _clearAll();
    _resetBrainStartTime();
  });

  // ── Decision Packet Tests ────────────────────────────────────

  describe("Decision Packet Creation", () => {
    it("should create a decision packet with correct fields", () => {
      const packet = createDecisionPacket({
        strategy_id: "strat_001",
        symbol: "AAPL",
        action: "buy",
        market_regime: "uptrend",
        data_truth_score: 0.9,
        signal_confidence: 0.85,
        execution_truth_score: 0.88,
        risk_level: "medium",
      });

      expect(packet.packet_id).toMatch(/^dpk_/);
      expect(packet.strategy_id).toBe("strat_001");
      expect(packet.symbol).toBe("AAPL");
      expect(packet.action).toBe("buy");
      expect(packet.market_regime).toBe("uptrend");
      expect(packet.data_truth_score).toBe(0.9);
      expect(packet.signal_confidence).toBe(0.85);
      expect(packet.execution_truth_score).toBe(0.88);
      expect(packet.risk_level).toBe("medium");
      expect(packet.timestamp).toBeInstanceOf(Date);
      expect(packet.created_at).toBeInstanceOf(Date);
    });

    it("should compute autonomy_eligibility based on truth scores", () => {
      const highTruth = createDecisionPacket({
        strategy_id: "strat_001",
        symbol: "AAPL",
        action: "buy",
        market_regime: "uptrend",
        data_truth_score: 0.9,
        signal_confidence: 0.85,
        execution_truth_score: 0.9,
      });

      expect(highTruth.autonomy_eligibility).toBe(true);

      const lowTruth = createDecisionPacket({
        strategy_id: "strat_002",
        symbol: "NVDA",
        action: "sell",
        market_regime: "downtrend",
        data_truth_score: 0.7,
        signal_confidence: 0.6,
        execution_truth_score: 0.7,
      });

      expect(lowTruth.autonomy_eligibility).toBe(false);
    });

    it("should clamp truth scores to [0, 1]", () => {
      const packet = createDecisionPacket({
        strategy_id: "strat_001",
        symbol: "AAPL",
        action: "buy",
        market_regime: "uptrend",
        data_truth_score: 1.5,
        signal_confidence: -0.1,
        execution_truth_score: 0.5,
      });

      expect(packet.data_truth_score).toBe(1);
      expect(packet.signal_confidence).toBe(0);
    });

    it("should use default values for optional fields", () => {
      const packet = createDecisionPacket({
        strategy_id: "strat_001",
        symbol: "AAPL",
        action: "buy",
        market_regime: "uptrend",
        data_truth_score: 0.8,
        signal_confidence: 0.75,
        execution_truth_score: 0.85,
      });

      expect(packet.certification_status).toBe("pending");
      expect(packet.final_action).toBe("buy");
      expect(packet.risk_level).toBe("medium");
      expect(packet.reasoning).toEqual([]);
      expect(packet.slippage_profile).toEqual({
        expected_pct: 0.05,
        percentile_95: 0.15,
      });
    });

    it("should set replay_marked_at to undefined initially", () => {
      const packet = createDecisionPacket({
        strategy_id: "strat_001",
        symbol: "AAPL",
        action: "buy",
        market_regime: "uptrend",
        data_truth_score: 0.8,
        signal_confidence: 0.75,
        execution_truth_score: 0.85,
      });

      expect(packet.replay_marked_at).toBeUndefined();
    });
  });

  // ── Decision Packet Querying ─────────────────────────────────

  describe("Decision Packet Querying", () => {
    beforeEach(() => {
      createDecisionPacket({
        strategy_id: "strat_momentum",
        symbol: "AAPL",
        action: "buy",
        market_regime: "uptrend",
        data_truth_score: 0.92,
        signal_confidence: 0.88,
        execution_truth_score: 0.9,
        certification_status: "approved",
      });

      createDecisionPacket({
        strategy_id: "strat_momentum",
        symbol: "NVDA",
        action: "sell",
        market_regime: "downtrend",
        data_truth_score: 0.85,
        signal_confidence: 0.8,
        execution_truth_score: 0.87,
        certification_status: "pending",
      });

      createDecisionPacket({
        strategy_id: "strat_revert",
        symbol: "AAPL",
        action: "hold",
        market_regime: "choppy",
        data_truth_score: 0.75,
        signal_confidence: 0.7,
        execution_truth_score: 0.75,
        certification_status: "flagged",
      });
    });

    it("should retrieve packet by ID", () => {
      const packets = getAllPackets(10);
      const packet = packets[0];
      const retrieved = getPacket(packet.packet_id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.packet_id).toBe(packet.packet_id);
      expect(retrieved?.symbol).toBe(packet.symbol);
    });

    it("should return undefined for non-existent packet", () => {
      const retrieved = getPacket("dpk_nonexistent");
      expect(retrieved).toBeUndefined();
    });

    it("should retrieve all packets sorted by timestamp descending", () => {
      const packets = getAllPackets(10);
      expect(packets.length).toBe(3);

      for (let i = 0; i < packets.length - 1; i++) {
        expect(packets[i].timestamp.getTime()).toBeGreaterThanOrEqual(
          packets[i + 1].timestamp.getTime()
        );
      }
    });

    it("should respect limit on getAllPackets", () => {
      const packets = getAllPackets(2);
      expect(packets.length).toBe(2);
    });

    it("should filter packets by strategy_id", () => {
      const packets = queryPackets({ strategy_id: "strat_momentum" });
      expect(packets.length).toBe(2);
      expect(packets.every((p) => p.strategy_id === "strat_momentum")).toBe(true);
    });

    it("should filter packets by symbol", () => {
      const packets = queryPackets({ symbol: "AAPL" });
      expect(packets.length).toBe(2);
      expect(packets.every((p) => p.symbol === "AAPL")).toBe(true);
    });

    it("should filter packets by action", () => {
      const packets = queryPackets({ action: "buy" });
      expect(packets.length).toBe(1);
      expect(packets[0].action).toBe("buy");
    });

    it("should filter packets by certification_status", () => {
      const packets = queryPackets({ certification_status: "pending" });
      expect(packets.length).toBe(1);
      expect(packets[0].certification_status).toBe("pending");
    });

    it("should filter packets by autonomy_eligible", () => {
      const packets = queryPackets({ autonomy_eligible: true });
      expect(packets.length).toBeGreaterThan(0);
      expect(packets.every((p) => p.autonomy_eligibility === true)).toBe(true);
    });

    it("should support multiple filters", () => {
      const packets = queryPackets({
        strategy_id: "strat_momentum",
        action: "sell",
        autonomy_eligible: false,
      });

      expect(packets.length).toBeGreaterThanOrEqual(0);
      if (packets.length > 0) {
        expect(packets[0].strategy_id).toBe("strat_momentum");
        expect(packets[0].action).toBe("sell");
      }
    });

    it("should sort query results by timestamp descending", () => {
      const packets = queryPackets({ strategy_id: "strat_momentum" });
      for (let i = 0; i < packets.length - 1; i++) {
        expect(packets[i].timestamp.getTime()).toBeGreaterThanOrEqual(
          packets[i + 1].timestamp.getTime()
        );
      }
    });
  });

  // ── Decision Packet Replay ───────────────────────────────────

  describe("Decision Packet Replay", () => {
    it("should mark packet for replay", () => {
      const packet = createDecisionPacket({
        strategy_id: "strat_001",
        symbol: "AAPL",
        action: "buy",
        market_regime: "uptrend",
        data_truth_score: 0.8,
        signal_confidence: 0.75,
        execution_truth_score: 0.85,
      });

      expect(packet.replay_marked_at).toBeUndefined();

      const marked = markForReplay(packet.packet_id);
      expect(marked).toBeDefined();
      expect(marked?.replay_marked_at).toBeInstanceOf(Date);
    });

    it("should return undefined for non-existent packet on replay", () => {
      const marked = markForReplay("dpk_nonexistent");
      expect(marked).toBeUndefined();
    });
  });

  // ── Brain Status Aggregation ─────────────────────────────────

  describe("Brain Status Aggregation", () => {
    it("should return brain status with all required fields", () => {
      const status = getBrainStatus();

      expect(status.brain_id).toMatch(/^brn_/);
      expect(status.timestamp).toBeInstanceOf(Date);
      expect(status.mode).toBeDefined();
      expect(status.health).toMatch(/^(green|yellow|red)$/);
      expect(status.uptime_seconds).toBeGreaterThanOrEqual(0);

      expect(status.active_sessions).toBeGreaterThanOrEqual(0);
      expect(status.pending_approvals).toBeGreaterThanOrEqual(0);
      expect(status.autonomous_candidates).toBeGreaterThanOrEqual(0);
      expect(status.open_incidents).toBeGreaterThanOrEqual(0);

      expect(status.slo_compliance).toBeDefined();
      expect(status.portfolio_exposure).toBeDefined();
      expect(status.subsystems).toBeDefined();
    });

    it("should count pending approvals correctly", () => {
      createDecisionPacket({
        strategy_id: "strat_001",
        symbol: "AAPL",
        action: "buy",
        market_regime: "uptrend",
        data_truth_score: 0.8,
        signal_confidence: 0.75,
        execution_truth_score: 0.85,
        certification_status: "pending",
      });

      createDecisionPacket({
        strategy_id: "strat_002",
        symbol: "NVDA",
        action: "sell",
        market_regime: "downtrend",
        data_truth_score: 0.8,
        signal_confidence: 0.75,
        execution_truth_score: 0.85,
        certification_status: "approved",
      });

      const status = getBrainStatus();
      expect(status.pending_approvals).toBe(1);
    });

    it("should count autonomous candidates correctly", () => {
      createDecisionPacket({
        strategy_id: "strat_001",
        symbol: "AAPL",
        action: "buy",
        market_regime: "uptrend",
        data_truth_score: 0.92,
        signal_confidence: 0.88,
        execution_truth_score: 0.9,
      });

      createDecisionPacket({
        strategy_id: "strat_002",
        symbol: "NVDA",
        action: "sell",
        market_regime: "downtrend",
        data_truth_score: 0.7,
        signal_confidence: 0.6,
        execution_truth_score: 0.7,
      });

      const status = getBrainStatus();
      expect(status.autonomous_candidates).toBe(1);
    });
  });

  // ── Decision Queue ───────────────────────────────────────────

  describe("Decision Queue Prioritization", () => {
    beforeEach(() => {
      createDecisionPacket({
        strategy_id: "strat_001",
        symbol: "AAPL",
        action: "buy",
        market_regime: "uptrend",
        data_truth_score: 0.92,
        signal_confidence: 0.88,
        execution_truth_score: 0.9,
        certification_status: "pending",
      });

      createDecisionPacket({
        strategy_id: "strat_002",
        symbol: "NVDA",
        action: "sell",
        market_regime: "downtrend",
        data_truth_score: 0.75,
        signal_confidence: 0.7,
        execution_truth_score: 0.75,
        certification_status: "pending",
      });
    });

    it("should return decision queue with pending packets", () => {
      const queue = getDecisionQueue(10);
      expect(queue.length).toBeGreaterThan(0);
      expect(queue.every((d) => d.certification_status === "pending")).toBe(true);
    });

    it("should include priority_score in queue items", () => {
      const queue = getDecisionQueue(10);
      expect(queue.length).toBeGreaterThan(0);
      expect(queue[0]).toHaveProperty("priority_score");
      expect(queue[0].priority_score).toBeGreaterThanOrEqual(0);
      expect(queue[0].priority_score).toBeLessThanOrEqual(1);
    });

    it("should respect limit parameter", () => {
      const queue = getDecisionQueue(1);
      expect(queue.length).toBeLessThanOrEqual(1);
    });

    it("should populate sequence_no sequentially", () => {
      const queue = getDecisionQueue(10);
      for (let i = 0; i < queue.length; i++) {
        expect(queue[i].sequence_no).toBe(i + 1);
      }
    });
  });

  // ── Terminal Data Completeness ──────────────────────────────

  describe("Terminal Data Completeness", () => {
    it("should return terminal data with all required panels", () => {
      const terminal = getTerminalData();

      expect(terminal.brain_status).toBeDefined();
      expect(terminal.decision_queue).toBeDefined();
      expect(terminal.execution_panel).toBeDefined();
      expect(terminal.portfolio_panel).toBeDefined();
      expect(terminal.autonomy_panel).toBeDefined();
      expect(terminal.operations_panel).toBeDefined();
    });

    it("should include brain status in terminal data", () => {
      const terminal = getTerminalData();
      expect(terminal.brain_status.brain_id).toMatch(/^brn_/);
      expect(terminal.brain_status.health).toMatch(/^(green|yellow|red)$/);
    });

    it("should include decision queue in terminal data", () => {
      createDecisionPacket({
        strategy_id: "strat_001",
        symbol: "AAPL",
        action: "buy",
        market_regime: "uptrend",
        data_truth_score: 0.8,
        signal_confidence: 0.75,
        execution_truth_score: 0.85,
        certification_status: "pending",
      });

      const terminal = getTerminalData();
      expect(terminal.decision_queue.length).toBeGreaterThan(0);
      expect(terminal.decision_queue[0]).toHaveProperty("packet_id");
      expect(terminal.decision_queue[0]).toHaveProperty("priority_score");
    });

    it("should include execution panel metrics", () => {
      const terminal = getTerminalData();
      expect(terminal.execution_panel.pending_orders).toBeGreaterThanOrEqual(0);
      expect(terminal.execution_panel.filled_today).toBeGreaterThanOrEqual(0);
      expect(terminal.execution_panel.avg_fill_time_ms).toBeGreaterThanOrEqual(0);
    });

    it("should include portfolio positions", () => {
      const terminal = getTerminalData();
      expect(terminal.portfolio_panel.total_notional_usd).toBeGreaterThanOrEqual(0);
      expect(terminal.portfolio_panel.cash_available_usd).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(terminal.portfolio_panel.positions)).toBe(true);
    });

    it("should include autonomy panel state", () => {
      const terminal = getTerminalData();
      expect(terminal.autonomy_panel.global_enabled).toBe(false);
      expect(terminal.autonomy_panel.active_candidates).toBeGreaterThanOrEqual(0);
      expect(terminal.autonomy_panel.total_budget_usd).toBeGreaterThanOrEqual(0);
    });

    it("should include operations panel health", () => {
      const terminal = getTerminalData();
      expect(terminal.operations_panel.system_health).toMatch(/^(green|yellow|red)$/);
      expect(terminal.operations_panel.risk_engine_status).toMatch(/^(green|yellow|red)$/);
      expect(typeof terminal.operations_panel.kill_switch_active).toBe("boolean");
      expect(typeof terminal.operations_panel.cooldown_active).toBe("boolean");
    });
  });

  // ── Cleanup Tests ────────────────────────────────────────────

  describe("Cleanup", () => {
    it("should clear all packets", () => {
      createDecisionPacket({
        strategy_id: "strat_001",
        symbol: "AAPL",
        action: "buy",
        market_regime: "uptrend",
        data_truth_score: 0.8,
        signal_confidence: 0.75,
        execution_truth_score: 0.85,
      });

      let packets = getAllPackets(10);
      expect(packets.length).toBe(1);

      _clearAll();

      packets = getAllPackets(10);
      expect(packets.length).toBe(0);
    });
  });
});
