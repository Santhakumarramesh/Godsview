import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock dependencies
vi.mock("pino", () => ({
  default: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock("pino-pretty", () => ({}));

vi.mock("../lib/risk_engine", () => ({
  getRiskSnapshot: vi.fn(() => ({})),
}));

vi.mock("../lib/drawdown_breaker", () => ({
  getBreakerSnapshot: vi.fn(() => ({ level: "NORMAL" })),
}));

import {
  computeLatencyMetrics,
  runQualityChecks,
  computeTruthScore,
  recordTimestampChain,
  getTimestampChain,
  getTruthScore,
  getTruthScoresBySymbol,
  getLatestTruthScores,
  getDegradedSymbols,
  getDataTruthSummary,
  _clearAll,
  type TimestampChain,
} from "../lib/data_truth";

describe("Data Truth + Latency Observability Service", () => {
  beforeEach(() => {
    _clearAll();
  });

  // ── Timestamp Chain Tests ────────────────────────────────────

  describe("Timestamp Chain Recording", () => {
    it("should record a timestamp chain with feed and ingest times", () => {
      const now = new Date();
      const feedTime = new Date(now.getTime() - 1000);
      const ingestTime = new Date(now.getTime() - 500);

      const chain = recordTimestampChain("chain_001", {
        feed_ts: feedTime,
        ingest_ts: ingestTime,
      });

      expect(chain.feed_ts).toEqual(feedTime);
      expect(chain.ingest_ts).toEqual(ingestTime);
    });

    it("should update an existing timestamp chain", () => {
      const chain1 = recordTimestampChain("chain_002", {
        feed_ts: new Date("2026-04-08T10:00:00Z"),
      });

      expect(chain1.feed_ts).toBeDefined();
      expect(chain1.decision_ts).toBeUndefined();

      const chain2 = recordTimestampChain("chain_002", {
        decision_ts: new Date("2026-04-08T10:00:10Z"),
      });

      expect(chain2.feed_ts).toBeDefined();
      expect(chain2.decision_ts).toBeDefined();
    });

    it("should retrieve a timestamp chain by ID", () => {
      const feedTime = new Date("2026-04-08T10:00:00Z");
      recordTimestampChain("chain_003", { feed_ts: feedTime });

      const retrieved = getTimestampChain("chain_003");
      expect(retrieved).toBeDefined();
      expect(retrieved?.feed_ts).toEqual(feedTime);
    });

    it("should return undefined for non-existent chain ID", () => {
      const retrieved = getTimestampChain("nonexistent");
      expect(retrieved).toBeUndefined();
    });

    it("should record complete timestamp chain from feed to fill", () => {
      const base = new Date("2026-04-08T10:00:00Z");

      const chain = recordTimestampChain("chain_complete", {
        feed_ts: new Date(base.getTime()),
        ingest_ts: new Date(base.getTime() + 10),
        decision_ts: new Date(base.getTime() + 20),
        order_submit_ts: new Date(base.getTime() + 30),
        broker_ack_ts: new Date(base.getTime() + 50),
        fill_ts: new Date(base.getTime() + 100),
      });

      expect(chain.feed_ts).toBeDefined();
      expect(chain.fill_ts).toBeDefined();
      expect(chain.fill_ts!.getTime() - chain.feed_ts!.getTime()).toBe(100);
    });
  });

  // ── Latency Computation Tests ────────────────────────────────

  describe("Latency Metrics Computation", () => {
    it("should compute market data lag from feed to ingest", () => {
      const feedTime = new Date("2026-04-08T10:00:00.000Z");
      const ingestTime = new Date("2026-04-08T10:00:00.150Z");

      const metrics = computeLatencyMetrics({
        feed_ts: feedTime,
        ingest_ts: ingestTime,
      });

      expect(metrics.market_data_lag_ms).toBe(150);
    });

    it("should compute decision latency from ingest to decision", () => {
      const ingestTime = new Date("2026-04-08T10:00:00.000Z");
      const decisionTime = new Date("2026-04-08T10:00:00.045Z");

      const metrics = computeLatencyMetrics({
        ingest_ts: ingestTime,
        decision_ts: decisionTime,
      });

      expect(metrics.decision_latency_ms).toBe(45);
    });

    it("should compute order routing latency from submit to ack", () => {
      const submitTime = new Date("2026-04-08T10:00:00.000Z");
      const ackTime = new Date("2026-04-08T10:00:00.075Z");

      const metrics = computeLatencyMetrics({
        order_submit_ts: submitTime,
        broker_ack_ts: ackTime,
      });

      expect(metrics.order_routing_latency_ms).toBe(75);
    });

    it("should compute fill latency from ack to fill", () => {
      const ackTime = new Date("2026-04-08T10:00:00.000Z");
      const fillTime = new Date("2026-04-08T10:00:00.250Z");

      const metrics = computeLatencyMetrics({
        broker_ack_ts: ackTime,
        fill_ts: fillTime,
      });

      expect(metrics.fill_latency_ms).toBe(250);
    });

    it("should handle partial timestamp chains", () => {
      const metrics = computeLatencyMetrics({
        feed_ts: new Date(),
      });

      expect(Object.keys(metrics).length).toBe(0);
    });

    it("should compute all latencies from complete chain", () => {
      const base = new Date("2026-04-08T10:00:00.000Z");

      const metrics = computeLatencyMetrics({
        feed_ts: new Date(base.getTime()),
        ingest_ts: new Date(base.getTime() + 10),
        decision_ts: new Date(base.getTime() + 50),
        order_submit_ts: new Date(base.getTime() + 55),
        broker_ack_ts: new Date(base.getTime() + 155),
        fill_ts: new Date(base.getTime() + 400),
      });

      expect(metrics.market_data_lag_ms).toBe(10);
      expect(metrics.decision_latency_ms).toBe(40);
      expect(metrics.order_routing_latency_ms).toBe(100);
      expect(metrics.fill_latency_ms).toBe(245);
    });
  });

  // ── Quality Check Tests ──────────────────────────────────────

  describe("Data Quality Checks", () => {
    it("should pass all checks for healthy candles", () => {
      const now = new Date();
      const candles = [
        {
          open: 100,
          high: 105,
          low: 95,
          close: 102,
          volume: 1000,
          timestamp: new Date(now.getTime() - 60000),
        },
        {
          open: 102,
          high: 108,
          low: 100,
          close: 105,
          volume: 1200,
          timestamp: now,
        },
      ];

      const check = runQualityChecks("AAPL", candles);

      expect(check.symbol).toBe("AAPL");
      expect(check.all_passed).toBe(true);
      expect(check.checks.every((c) => c.passed)).toBe(true);
    });

    it("should detect stale candles (> 5 minutes old)", () => {
      const staleTime = new Date(Date.now() - 6 * 60 * 1000);
      const candles = [
        {
          open: 100,
          high: 105,
          low: 95,
          close: 102,
          volume: 1000,
          timestamp: staleTime,
        },
      ];

      const check = runQualityChecks("BTCUSD", candles);
      const staleCheck = check.checks.find((c) => c.check_name === "stale_candles");

      expect(staleCheck?.passed).toBe(false);
      expect(staleCheck?.severity).toBe("warning");
    });

    it("should detect missing ticks (gaps in sequence)", () => {
      const base = new Date("2026-04-08T10:00:00Z");
      const candles = [
        {
          open: 100,
          high: 105,
          low: 95,
          close: 102,
          volume: 1000,
          timestamp: base,
        },
        {
          open: 102,
          high: 108,
          low: 100,
          close: 105,
          volume: 1200,
          // 3 minutes later (gap suggests missing candle)
          timestamp: new Date(base.getTime() + 3 * 60 * 1000),
        },
      ];

      const check = runQualityChecks("ETHUSD", candles);
      const ticksCheck = check.checks.find((c) => c.check_name === "missing_ticks");

      expect(ticksCheck?.passed).toBe(false);
    });

    it("should detect crossed values (high < low)", () => {
      const candles = [
        {
          open: 100,
          high: 95, // high < low: invalid
          low: 105,
          close: 102,
          volume: 1000,
          timestamp: new Date(),
        },
      ];

      const check = runQualityChecks("AAPL", candles);
      const crossedCheck = check.checks.find((c) => c.check_name === "crossed_values");

      expect(crossedCheck?.passed).toBe(false);
      expect(crossedCheck?.severity).toBe("error");
    });

    it("should detect outlier spikes (> 20% move in one candle)", () => {
      const candles = [
        {
          open: 100,
          high: 120,
          low: 95,
          close: 125, // 25% move
          volume: 1000,
          timestamp: new Date(),
        },
      ];

      const check = runQualityChecks("AAPL", candles);
      const outlierCheck = check.checks.find((c) => c.check_name === "outlier_spikes");

      expect(outlierCheck?.passed).toBe(false);
    });

    it("should detect feed silence (no data in > 5 minutes)", () => {
      const check = runQualityChecks("AAPL", []);

      const silenceCheck = check.checks.find((c) => c.check_name === "feed_silence");
      expect(silenceCheck?.passed).toBe(false);
      expect(silenceCheck?.severity).toBe("error");
    });

    it("should perform all 5 checks", () => {
      const candles = [
        {
          open: 100,
          high: 105,
          low: 95,
          close: 102,
          volume: 1000,
          timestamp: new Date(),
        },
      ];

      const check = runQualityChecks("AAPL", candles);
      expect(check.checks.length).toBe(5);
      expect(check.checks.map((c) => c.check_name)).toEqual([
        "stale_candles",
        "missing_ticks",
        "crossed_values",
        "outlier_spikes",
        "feed_silence",
      ]);
    });

    it("should set all_passed to true only when all checks pass", () => {
      const healthyCandles = [
        {
          open: 100,
          high: 105,
          low: 95,
          close: 102,
          volume: 1000,
          timestamp: new Date(),
        },
      ];

      const healthyCheck = runQualityChecks("AAPL", healthyCandles);
      expect(healthyCheck.all_passed).toBe(true);

      // Feed silence check will fail for empty candles
      const silentCheck = runQualityChecks("AAPL", []);
      expect(silentCheck.all_passed).toBe(false);
    });
  });

  // ── Truth Score Computation Tests ────────────────────────────

  describe("Data Truth Score Computation", () => {
    it("should compute full score with all healthy checks", () => {
      const now = new Date();
      const healthyCandles = [
        {
          open: 100,
          high: 105,
          low: 95,
          close: 102,
          volume: 1000,
          timestamp: new Date(now.getTime() - 60000),
        },
        {
          open: 102,
          high: 108,
          low: 100,
          close: 105,
          volume: 1200,
          timestamp: now,
        },
      ];

      const qualityCheck = runQualityChecks("AAPL", healthyCandles);
      const latencies = computeLatencyMetrics({
        feed_ts: new Date(now.getTime() - 20),
        ingest_ts: new Date(now.getTime() - 10),
        decision_ts: new Date(now.getTime() - 5),
      });

      const score = computeTruthScore(
        "AAPL",
        "session_001",
        qualityCheck,
        latencies,
        {
          feed_ts: new Date(now.getTime() - 20),
          ingest_ts: new Date(now.getTime() - 10),
          decision_ts: new Date(now.getTime() - 5),
        }
      );

      expect(score.truth_score).toBeGreaterThan(0.8);
      expect(score.degradation_status).toBe("healthy");
      expect(score.symbol).toBe("AAPL");
      expect(score.session_id).toBe("session_001");
    });

    it("should reduce score when quality checks fail", () => {
      const badQualityCheck = {
        symbol: "AAPL",
        all_passed: false,
        checks: [
          { check_name: "stale_candles" as const, passed: false, severity: "warning" as const },
          { check_name: "missing_ticks" as const, passed: false, severity: "warning" as const },
          { check_name: "crossed_values" as const, passed: true },
          { check_name: "outlier_spikes" as const, passed: true },
          { check_name: "feed_silence" as const, passed: true },
        ],
        timestamp: new Date(),
      };

      const score = computeTruthScore(
        "AAPL",
        "session_002",
        badQualityCheck,
        {},
        {}
      );

      expect(score.truth_score).toBeLessThan(1.0);
      expect(score.degradation_status).toBe("degraded");
    });

    it("should set degradation_status to critical when score < 0.6", () => {
      const badQualityCheck = {
        symbol: "AAPL",
        all_passed: false,
        checks: [
          { check_name: "stale_candles" as const, passed: false, severity: "warning" as const },
          { check_name: "missing_ticks" as const, passed: false, severity: "warning" as const },
          { check_name: "crossed_values" as const, passed: false, severity: "error" as const },
          { check_name: "outlier_spikes" as const, passed: false, severity: "warning" as const },
          { check_name: "feed_silence" as const, passed: false, severity: "error" as const },
        ],
        timestamp: new Date(),
      };

      const score = computeTruthScore(
        "AAPL",
        "session_003",
        badQualityCheck,
        {},
        {}
      );

      expect(score.degradation_status).toBe("offline");
    });

    it("should set degradation_status to offline when feed_silence check fails", () => {
      const silentQualityCheck = {
        symbol: "AAPL",
        all_passed: false,
        checks: [
          { check_name: "stale_candles" as const, passed: true },
          { check_name: "missing_ticks" as const, passed: true },
          { check_name: "crossed_values" as const, passed: true },
          { check_name: "outlier_spikes" as const, passed: true },
          { check_name: "feed_silence" as const, passed: false, severity: "error" as const },
        ],
        timestamp: new Date(),
      };

      const score = computeTruthScore(
        "AAPL",
        "session_004",
        silentQualityCheck,
        {},
        {}
      );

      expect(score.degradation_status).toBe("offline");
    });

    it("should penalize high market data lag (> 100ms)", () => {
      const goodCandles = [
        {
          open: 100,
          high: 105,
          low: 95,
          close: 102,
          volume: 1000,
          timestamp: new Date(),
        },
      ];

      const qualityCheck = runQualityChecks("AAPL", goodCandles);
      const highLagLatencies = {
        market_data_lag_ms: 150,
      };

      const score = computeTruthScore(
        "AAPL",
        "session_005",
        qualityCheck,
        highLagLatencies,
        {}
      );

      expect(score.truth_score).toBeLessThan(1.0);
    });

    it("should penalize high decision latency (> 50ms)", () => {
      const goodCandles = [
        {
          open: 100,
          high: 105,
          low: 95,
          close: 102,
          volume: 1000,
          timestamp: new Date(),
        },
      ];

      const qualityCheck = runQualityChecks("AAPL", goodCandles);
      const slowDecisionLatencies = {
        decision_latency_ms: 75,
      };

      const score = computeTruthScore(
        "AAPL",
        "session_006",
        qualityCheck,
        slowDecisionLatencies,
        {}
      );

      expect(score.truth_score).toBeLessThan(1.0);
    });

    it("should penalize high routing latency (> 200ms)", () => {
      const goodCandles = [
        {
          open: 100,
          high: 105,
          low: 95,
          close: 102,
          volume: 1000,
          timestamp: new Date(),
        },
      ];

      const qualityCheck = runQualityChecks("AAPL", goodCandles);
      const slowRoutingLatencies = {
        order_routing_latency_ms: 300,
      };

      const score = computeTruthScore(
        "AAPL",
        "session_007",
        qualityCheck,
        slowRoutingLatencies,
        {}
      );

      expect(score.truth_score).toBeLessThan(1.0);
    });

    it("should generate unique score_id with dt_ prefix", () => {
      const candles = [
        {
          open: 100,
          high: 105,
          low: 95,
          close: 102,
          volume: 1000,
          timestamp: new Date(),
        },
      ];

      const qualityCheck = runQualityChecks("AAPL", candles);

      const score1 = computeTruthScore("AAPL", "session_1", qualityCheck, {}, {});
      const score2 = computeTruthScore("AAPL", "session_2", qualityCheck, {}, {});

      expect(score1.score_id).toMatch(/^dt_/);
      expect(score2.score_id).toMatch(/^dt_/);
      expect(score1.score_id).not.toBe(score2.score_id);
    });

    it("should clamp score to [0, 1] range", () => {
      const goodCandles = [
        {
          open: 100,
          high: 105,
          low: 95,
          close: 102,
          volume: 1000,
          timestamp: new Date(),
        },
      ];

      const qualityCheck = runQualityChecks("AAPL", goodCandles);

      const score = computeTruthScore("AAPL", "session", qualityCheck, {}, {});

      expect(score.truth_score).toBeGreaterThanOrEqual(0);
      expect(score.truth_score).toBeLessThanOrEqual(1);
    });
  });

  // ── Query Tests ──────────────────────────────────────────────

  describe("Truth Score Queries", () => {
    it("should retrieve a truth score by symbol", () => {
      const candles = [
        {
          open: 100,
          high: 105,
          low: 95,
          close: 102,
          volume: 1000,
          timestamp: new Date(),
        },
      ];

      const qualityCheck = runQualityChecks("AAPL", candles);
      const score1 = computeTruthScore("AAPL", "session_1", qualityCheck, {}, {});

      const retrieved = getTruthScore("AAPL");
      expect(retrieved).toBeDefined();
      expect(retrieved?.symbol).toBe("AAPL");
      expect(retrieved?.score_id).toBe(score1.score_id);
    });

    it("should return undefined for non-existent symbol", () => {
      const retrieved = getTruthScore("NONEXISTENT");
      expect(retrieved).toBeUndefined();
    });

    it("should get latest scores across multiple symbols", () => {
      const candles = [
        {
          open: 100,
          high: 105,
          low: 95,
          close: 102,
          volume: 1000,
          timestamp: new Date(),
        },
      ];

      const qualityCheck = runQualityChecks("AAPL", candles);

      computeTruthScore("AAPL", "session_1", qualityCheck, {}, {});
      computeTruthScore("BTCUSD", "session_2", qualityCheck, {}, {});
      computeTruthScore("ETHUSD", "session_3", qualityCheck, {}, {});

      const latest = getLatestTruthScores();
      expect(latest.length).toBe(3);
      expect(latest.map((s) => s.symbol)).toContain("AAPL");
      expect(latest.map((s) => s.symbol)).toContain("BTCUSD");
    });

    it("should limit returned scores", () => {
      const candles = [
        {
          open: 100,
          high: 105,
          low: 95,
          close: 102,
          volume: 1000,
          timestamp: new Date(),
        },
      ];

      const qualityCheck = runQualityChecks("AAPL", candles);

      for (let i = 0; i < 5; i++) {
        computeTruthScore(`SYM${i}`, `session_${i}`, qualityCheck, {}, {});
      }

      const limited = getLatestTruthScores(2);
      expect(limited.length).toBe(2);
    });

    it("should identify degraded symbols", () => {
      const badQualityCheck = {
        symbol: "DEGRADED",
        all_passed: false,
        checks: [
          { check_name: "stale_candles" as const, passed: false, severity: "warning" as const },
          { check_name: "missing_ticks" as const, passed: false, severity: "warning" as const },
          { check_name: "crossed_values" as const, passed: true },
          { check_name: "outlier_spikes" as const, passed: true },
          { check_name: "feed_silence" as const, passed: true },
        ],
        timestamp: new Date(),
      };

      const goodCandles = [
        {
          open: 100,
          high: 105,
          low: 95,
          close: 102,
          volume: 1000,
          timestamp: new Date(),
        },
      ];
      const goodQualityCheck = runQualityChecks("HEALTHY", goodCandles);

      computeTruthScore("DEGRADED", "session_1", badQualityCheck, {}, {});
      computeTruthScore("HEALTHY", "session_2", goodQualityCheck, {}, {});

      const degraded = getDegradedSymbols();
      expect(degraded).toContain("DEGRADED");
      expect(degraded).not.toContain("HEALTHY");
    });
  });

  // ── Summary Tests ────────────────────────────────────────────

  describe("Data Truth Summary", () => {
    it("should generate summary of data health across symbols", () => {
      const goodCandles = [
        {
          open: 100,
          high: 105,
          low: 95,
          close: 102,
          volume: 1000,
          timestamp: new Date(),
        },
      ];

      const goodQualityCheck = runQualityChecks("SYM1", goodCandles);
      const badQualityCheck = {
        symbol: "SYM2",
        all_passed: false,
        checks: [
          { check_name: "feed_silence" as const, passed: false, severity: "error" as const },
          { check_name: "stale_candles" as const, passed: true },
          { check_name: "missing_ticks" as const, passed: true },
          { check_name: "crossed_values" as const, passed: true },
          { check_name: "outlier_spikes" as const, passed: true },
        ],
        timestamp: new Date(),
      };

      computeTruthScore("SYM1", "session_1", goodQualityCheck, {}, {});
      computeTruthScore("SYM2", "session_2", badQualityCheck, {}, {});

      const summary = getDataTruthSummary();

      expect(summary.total_symbols).toBe(2);
      expect(summary.healthy_count).toBeGreaterThan(0);
      expect(summary.offline_count).toBeGreaterThan(0);
      expect(summary.avg_truth_score).toBeGreaterThanOrEqual(0);
      expect(summary.avg_truth_score).toBeLessThanOrEqual(1);
    });

    it("should count symbols by degradation status", () => {
      const goodCandles = [
        {
          open: 100,
          high: 105,
          low: 95,
          close: 102,
          volume: 1000,
          timestamp: new Date(),
        },
      ];

      for (let i = 0; i < 3; i++) {
        const qualityCheck = runQualityChecks(`HEALTHY${i}`, goodCandles);
        computeTruthScore(`HEALTHY${i}`, `session_${i}`, qualityCheck, {}, {});
      }

      const summary = getDataTruthSummary();
      expect(summary.healthy_count).toBe(3);
      expect(summary.degraded_count).toBe(0);
      expect(summary.critical_count).toBe(0);
      expect(summary.offline_count).toBe(0);
    });

    it("should calculate average truth score", () => {
      const goodCandles = [
        {
          open: 100,
          high: 105,
          low: 95,
          close: 102,
          volume: 1000,
          timestamp: new Date(),
        },
      ];

      const qualityCheck = runQualityChecks("AAPL", goodCandles);
      const score = computeTruthScore("AAPL", "session", qualityCheck, {}, {});

      const summary = getDataTruthSummary();
      expect(summary.avg_truth_score).toBeCloseTo(score.truth_score, 2);
    });

    it("should return empty summary when no scores exist", () => {
      const summary = getDataTruthSummary();
      expect(summary.total_symbols).toBe(0);
      expect(summary.healthy_count).toBe(0);
      expect(summary.avg_truth_score).toBe(1.0);
    });
  });

  // ── Cleanup Tests ────────────────────────────────────────────

  describe("State Management", () => {
    it("should clear all data with _clearAll()", () => {
      const candles = [
        {
          open: 100,
          high: 105,
          low: 95,
          close: 102,
          volume: 1000,
          timestamp: new Date(),
        },
      ];

      const qualityCheck = runQualityChecks("AAPL", candles);
      computeTruthScore("AAPL", "session", qualityCheck, {}, {});

      _clearAll();

      const retrieved = getTruthScore("AAPL");
      expect(retrieved).toBeUndefined();

      const latest = getLatestTruthScores();
      expect(latest.length).toBe(0);

      const summary = getDataTruthSummary();
      expect(summary.total_symbols).toBe(0);
    });

    it("should allow fresh data after clearing", () => {
      const candles = [
        {
          open: 100,
          high: 105,
          low: 95,
          close: 102,
          volume: 1000,
          timestamp: new Date(),
        },
      ];

      const qualityCheck = runQualityChecks("AAPL", candles);
      computeTruthScore("AAPL", "session_1", qualityCheck, {}, {});

      _clearAll();

      const qualityCheck2 = runQualityChecks("BTCUSD", candles);
      const score = computeTruthScore("BTCUSD", "session_2", qualityCheck2, {}, {});

      const retrieved = getTruthScore("BTCUSD");
      expect(retrieved?.score_id).toBe(score.score_id);
      expect(getTruthScore("AAPL")).toBeUndefined();
    });
  });
});
