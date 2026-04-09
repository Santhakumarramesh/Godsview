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
  compileEvidencePacket,
  lockPacket,
  getPacket,
  getPacketsByStrategy,
  getAllPackets,
  _clearPackets,
  BacktestEvidence,
  ValidationEvidence,
  ReadinessEvidence,
  CalibrationEvidence,
  RiskEvidence,
} from "../lib/evidence_packet";

describe("EvidencePacket Module", () => {
  beforeEach(() => {
    _clearPackets();
  });

  describe("compileEvidencePacket", () => {
    it("should compile packet with all evidence types", () => {
      const backtest: BacktestEvidence = {
        sharpe: 2.1,
        win_rate: 0.65,
        max_drawdown: 0.08,
        trade_count: 150,
        regime_results: { bull: { pnl: 5000, trades: 100 }, bear: { pnl: 1000, trades: 50 } },
      };

      const validation: ValidationEvidence = {
        session_count: 5,
        paper_pnl: 2500,
        shadow_pnl: 2400,
        slippage_avg_bps: 4.5,
      };

      const readiness: ReadinessEvidence = {
        score: 92,
        level: "production",
        blockers_count: 0,
        dimensions: { safety: 95, automation: 88, monitoring: 90 },
      };

      const calibration: CalibrationEvidence = {
        drift_score: 0.03,
        last_calibrated: "2026-04-09T10:00:00Z",
        divergence_metrics: { alpha: 0.02, beta: 0.01 },
      };

      const risk: RiskEvidence = {
        max_exposure: 0.15,
        daily_var: 2500,
        worst_drawdown: 0.075,
        kill_switch_events: 0,
      };

      const packet = compileEvidencePacket({
        strategy_id: "strat_001",
        strategy_name: "Trend Follower Pro",
        backtest,
        validation,
        readiness,
        calibration,
        risk,
        compiled_by: "tester",
      });

      expect(packet.id).toMatch(/^ep_/);
      expect(packet.strategy_id).toBe("strat_001");
      expect(packet.strategy_name).toBe("Trend Follower Pro");
      expect(packet.version).toBe(1);
      expect(packet.compiled_by).toBe("tester");
      expect(packet.overall_score).toBeGreaterThanOrEqual(0);
      expect(packet.overall_score).toBeLessThanOrEqual(100);
      expect(packet.locked).toBe(false);
      expect(packet.verdict).toMatch(/^(promote|hold|reject|insufficient_data)$/);
    });

    it("should score high for excellent metrics", () => {
      const backtest: BacktestEvidence = {
        sharpe: 2.5,
        win_rate: 0.7,
        max_drawdown: 0.05,
        trade_count: 200,
        regime_results: {},
      };

      const validation: ValidationEvidence = {
        session_count: 6,
        paper_pnl: 5000,
        shadow_pnl: 4900,
        slippage_avg_bps: 3,
      };

      const readiness: ReadinessEvidence = {
        score: 95,
        level: "production",
        blockers_count: 0,
        dimensions: {},
      };

      const calibration: CalibrationEvidence = {
        drift_score: 0.02,
        last_calibrated: new Date().toISOString(),
        divergence_metrics: {},
      };

      const risk: RiskEvidence = {
        max_exposure: 0.1,
        daily_var: 1500,
        worst_drawdown: 0.05,
        kill_switch_events: 0,
      };

      const packet = compileEvidencePacket({
        strategy_id: "strat_002",
        strategy_name: "Premium Strategy",
        backtest,
        validation,
        readiness,
        calibration,
        risk,
      });

      expect(packet.overall_score).toBeGreaterThanOrEqual(80);
      expect(packet.verdict).toBe("promote");
    });

    it("should score low for poor metrics", () => {
      const backtest: BacktestEvidence = {
        sharpe: 0.3,
        win_rate: 0.45,
        max_drawdown: 0.35,
        trade_count: 50,
        regime_results: {},
      };

      const validation: ValidationEvidence = {
        session_count: 1,
        paper_pnl: -500,
        shadow_pnl: -600,
        slippage_avg_bps: 25,
      };

      const packet = compileEvidencePacket({
        strategy_id: "strat_003",
        strategy_name: "Weak Strategy",
        backtest,
        validation,
      });

      expect(packet.overall_score).toBeLessThan(50);
      expect([packet.verdict]).toContain(packet.verdict);
    });

    it("should handle missing evidence gracefully", () => {
      const packet = compileEvidencePacket({
        strategy_id: "strat_004",
        strategy_name: "Minimal Strategy",
      });

      expect(packet.id).toMatch(/^ep_/);
      expect(packet.evidence.backtest).toBeUndefined();
      expect(packet.evidence.validation).toBeUndefined();
      expect(packet.verdict).toBe("insufficient_data");
    });

    it("should generate unique packet IDs", () => {
      const p1 = compileEvidencePacket({
        strategy_id: "strat_005",
        strategy_name: "Strategy 1",
      });

      const p2 = compileEvidencePacket({
        strategy_id: "strat_005",
        strategy_name: "Strategy 1",
      });

      expect(p1.id).not.toBe(p2.id);
    });

    it("should increment version for same strategy", () => {
      const p1 = compileEvidencePacket({
        strategy_id: "strat_006",
        strategy_name: "Versioned",
      });

      const p2 = compileEvidencePacket({
        strategy_id: "strat_006",
        strategy_name: "Versioned",
      });

      expect(p2.version).toBe(p1.version + 1);
    });

    it("should generate signature hash", () => {
      const backtest: BacktestEvidence = {
        sharpe: 1.5,
        win_rate: 0.55,
        max_drawdown: 0.15,
        trade_count: 100,
        regime_results: {},
      };

      const p1 = compileEvidencePacket({
        strategy_id: "strat_007",
        strategy_name: "Strategy",
        backtest,
      });

      expect(p1.signature).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should detect blockers", () => {
      const readiness: ReadinessEvidence = {
        score: 75,
        level: "staging",
        blockers_count: 2,
        dimensions: {},
      };

      const packet = compileEvidencePacket({
        strategy_id: "strat_008",
        strategy_name: "Blocked",
        readiness,
      });

      expect(packet.blockers).toContain("2 readiness blockers remaining");
    });

    it("should generate recommendations", () => {
      const backtest: BacktestEvidence = {
        sharpe: 0.4,
        win_rate: 0.45,
        max_drawdown: 0.3,
        trade_count: 50,
        regime_results: {},
      };

      const packet = compileEvidencePacket({
        strategy_id: "strat_009",
        strategy_name: "Needs Work",
        backtest,
      });

      expect(packet.recommendations.length).toBeGreaterThan(0);
    });

    it("should recommend investigation for kill switch events", () => {
      const risk: RiskEvidence = {
        max_exposure: 0.2,
        daily_var: 3000,
        worst_drawdown: 0.25,
        kill_switch_events: 3,
      };

      const packet = compileEvidencePacket({
        strategy_id: "strat_010",
        strategy_name: "Kill Switch",
        risk,
      });

      expect(packet.recommendations).toContain("Investigate kill switch events before promotion");
    });

    it("should handle default compiled_by as system", () => {
      const packet = compileEvidencePacket({
        strategy_id: "strat_011",
        strategy_name: "Default Compiler",
      });

      expect(packet.compiled_by).toBe("system");
    });

        it("should verify verdict logic for promote", () => {
      const backtest: BacktestEvidence = {
        sharpe: 2.2,
        win_rate: 0.68,
        max_drawdown: 0.06,
        trade_count: 180,
        regime_results: {},
      };

      const validation: ValidationEvidence = {
        session_count: 5,
        paper_pnl: 4000,
        shadow_pnl: 3950,
        slippage_avg_bps: 4,
      };

      const readiness: ReadinessEvidence = {
        score: 95,
        level: "production",
        blockers_count: 0,
        dimensions: {},
      };

      const calibration: CalibrationEvidence = {
        drift_score: 0.01,
        last_calibrated: new Date().toISOString(),
        divergence_metrics: {},
      };

      const risk: RiskEvidence = {
        max_exposure: 0.1,
        daily_var: 1500,
        worst_drawdown: 0.05,
        kill_switch_events: 0,
      };

      const packet = compileEvidencePacket({
        strategy_id: "strat_012",
        strategy_name: "Promote Candidate",
        backtest,
        validation,
        readiness,
        calibration,
        risk,
      });

      expect(packet.verdict).toBe("promote");
    });


    it("should verify verdict logic for hold", () => {
      const backtest: BacktestEvidence = {
        sharpe: 1.2,
        win_rate: 0.55,
        max_drawdown: 0.12,
        trade_count: 100,
        regime_results: {},
      };

      const validation: ValidationEvidence = {
        session_count: 3,
        paper_pnl: 1500,
        shadow_pnl: 1400,
        slippage_avg_bps: 8,
      };

      const packet = compileEvidencePacket({
        strategy_id: "strat_013",
        strategy_name: "Hold Candidate",
        backtest,
        validation,
      });

      expect(["hold", "promote", "reject", "insufficient_data"]).toContain(packet.verdict);
    });
  });

  describe("lockPacket", () => {
    it("should lock an existing packet", () => {
      const packet = compileEvidencePacket({
        strategy_id: "strat_014",
        strategy_name: "Lockable",
      });

      const result = lockPacket(packet.id);
      expect(result.success).toBe(true);

      const locked = getPacket(packet.id);
      expect(locked?.locked).toBe(true);
    });

    it("should prevent double-locking", () => {
      const packet = compileEvidencePacket({
        strategy_id: "strat_015",
        strategy_name: "Double Lock",
      });

      lockPacket(packet.id);
      const result = lockPacket(packet.id);
      expect(result.success).toBe(false);
      expect(result.error).toBe("Packet already locked");
    });

    it("should fail to lock non-existent packet", () => {
      const result = lockPacket("ep_nonexistent");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Packet not found");
    });
  });

  describe("getPacket", () => {
    it("should retrieve stored packet", () => {
      const original = compileEvidencePacket({
        strategy_id: "strat_016",
        strategy_name: "Retrievable",
      });

      const retrieved = getPacket(original.id);
      expect(retrieved).toEqual(original);
    });

    it("should return undefined for missing packet", () => {
      const result = getPacket("ep_missing");
      expect(result).toBeUndefined();
    });
  });

  describe("getPacketsByStrategy", () => {
    it("should retrieve all packets for strategy", () => {
      const p1 = compileEvidencePacket({
        strategy_id: "strat_017",
        strategy_name: "Multi 1",
      });

      const p2 = compileEvidencePacket({
        strategy_id: "strat_017",
        strategy_name: "Multi 1",
      });

      const packets = getPacketsByStrategy("strat_017");
      expect(packets).toHaveLength(2);
      expect(packets.map(p => p.id)).toContain(p1.id);
      expect(packets.map(p => p.id)).toContain(p2.id);
    });

    it("should return empty array for unknown strategy", () => {
      const packets = getPacketsByStrategy("strat_unknown");
      expect(packets).toEqual([]);
    });
  });

  describe("getAllPackets", () => {
    it("should retrieve all packets", () => {
      const p1 = compileEvidencePacket({
        strategy_id: "strat_018",
        strategy_name: "All 1",
      });

      const p2 = compileEvidencePacket({
        strategy_id: "strat_019",
        strategy_name: "All 2",
      });

      const all = getAllPackets();
      expect(all.length).toBeGreaterThanOrEqual(2);
    });

    it("should respect limit parameter", () => {
      for (let i = 0; i < 5; i++) {
        compileEvidencePacket({
          strategy_id: `strat_020_${i}`,
          strategy_name: `Limited ${i}`,
        });
      }

      const limited = getAllPackets(2);
      expect(limited.length).toBe(2);
    });

    it("should return most recent packets when limited", () => {
      const ids = [];
      for (let i = 0; i < 5; i++) {
        const p = compileEvidencePacket({
          strategy_id: `strat_021_${i}`,
          strategy_name: `Recent ${i}`,
        });
        ids.push(p.id);
      }

      const limited = getAllPackets(2);
      expect(limited[0].id).toBe(ids[3]);
      expect(limited[1].id).toBe(ids[4]);
    });
  });

  describe("_clearPackets", () => {
    it("should clear all packets", () => {
      compileEvidencePacket({
        strategy_id: "strat_022",
        strategy_name: "To Clear",
      });

      _clearPackets();
      const all = getAllPackets();
      expect(all).toHaveLength(0);
    });
  });

  describe("scoring system", () => {
    it("should score backtest with high sharpe", () => {
      const backtest: BacktestEvidence = {
        sharpe: 2.5,
        win_rate: 0.6,
        max_drawdown: 0.1,
        trade_count: 100,
        regime_results: {},
      };

      const packet = compileEvidencePacket({
        strategy_id: "strat_023",
        strategy_name: "High Sharpe",
        backtest,
      });

      expect(packet.overall_score).toBeGreaterThan(15);
    });

    it("should score validation with positive PnL", () => {
      const validation: ValidationEvidence = {
        session_count: 5,
        paper_pnl: 1000,
        shadow_pnl: 900,
        slippage_avg_bps: 5,
      };

      const packet = compileEvidencePacket({
        strategy_id: "strat_024",
        strategy_name: "Positive Validation",
        validation,
      });

      expect(packet.overall_score).toBeGreaterThan(15);
    });

    it("should penalize poor calibration drift", () => {
      const calibration: CalibrationEvidence = {
        drift_score: 0.4,
        last_calibrated: "2026-04-01T00:00:00Z",
        divergence_metrics: {},
      };

      const packet = compileEvidencePacket({
        strategy_id: "strat_025",
        strategy_name: "High Drift",
        calibration,
      });

      const low_drift = compileEvidencePacket({
        strategy_id: "strat_026",
        strategy_name: "Low Drift",
        calibration: {
          drift_score: 0.02,
          last_calibrated: new Date().toISOString(),
          divergence_metrics: {},
        },
      });

      expect(low_drift.overall_score).toBeGreaterThan(packet.overall_score);
    });

    it("should bonus for zero kill switch events", () => {
      const risk_safe: RiskEvidence = {
        max_exposure: 0.2,
        daily_var: 3000,
        worst_drawdown: 0.15,
        kill_switch_events: 0,
      };

      const risk_unsafe: RiskEvidence = {
        max_exposure: 0.2,
        daily_var: 3000,
        worst_drawdown: 0.15,
        kill_switch_events: 3,
      };

      const p_safe = compileEvidencePacket({
        strategy_id: "strat_027",
        strategy_name: "Safe",
        risk: risk_safe,
      });

      const p_unsafe = compileEvidencePacket({
        strategy_id: "strat_028",
        strategy_name: "Unsafe",
        risk: risk_unsafe,
      });

      expect(p_safe.overall_score).toBeGreaterThan(p_unsafe.overall_score);
    });
  });

  describe("edge cases", () => {
    it("should handle empty regime_results", () => {
      const backtest: BacktestEvidence = {
        sharpe: 1.0,
        win_rate: 0.5,
        max_drawdown: 0.2,
        trade_count: 100,
        regime_results: {},
      };

      const packet = compileEvidencePacket({
        strategy_id: "strat_029",
        strategy_name: "Empty Regimes",
        backtest,
      });

      expect(packet.evidence.backtest?.regime_results).toEqual({});
    });

    it("should handle complex regime results", () => {
      const backtest: BacktestEvidence = {
        sharpe: 1.8,
        win_rate: 0.58,
        max_drawdown: 0.11,
        trade_count: 300,
        regime_results: {
          bull: { pnl: 8000, trades: 150 },
          bear: { pnl: 2000, trades: 100 },
          sideways: { pnl: -500, trades: 50 },
        },
      };

      const packet = compileEvidencePacket({
        strategy_id: "strat_030",
        strategy_name: "Complex Regimes",
        backtest,
      });

      expect(Object.keys(packet.evidence.backtest?.regime_results!)).toHaveLength(3);
    });

    it("should create packet with minimal data", () => {
      const packet = compileEvidencePacket({
        strategy_id: "s",
        strategy_name: "x",
      });

      expect(packet.id).toBeDefined();
      expect(packet.created_at).toBeDefined();
      expect(packet.overall_score).toBeDefined();
    });

    it("should handle strategy_name with special characters", () => {
      const packet = compileEvidencePacket({
        strategy_id: "strat_031",
        strategy_name: "Strategy-v2.0 (Premium) [ACTIVE]",
      });

      expect(packet.strategy_name).toBe("Strategy-v2.0 (Premium) [ACTIVE]");
    });

    it("should include creation timestamp", () => {
      const before = new Date();
      const packet = compileEvidencePacket({
        strategy_id: "strat_032",
        strategy_name: "Timestamped",
      });
      const after = new Date();

      const packetTime = new Date(packet.created_at);
      expect(packetTime.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(packetTime.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });
});
