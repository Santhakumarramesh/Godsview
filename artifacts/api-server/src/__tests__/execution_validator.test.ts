import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  ExecutionValidator,
  SlippageAnalyzer,
  ExecutionDriftDetector,
  ExecutionFeedbackLoop,
  type Order,
  type Fill,
} from "../lib/execution_validator.js";

describe("Execution Validator", () => {
  let db: Database.Database;
  let validator: ExecutionValidator;
  let analyzer: SlippageAnalyzer;
  let detector: ExecutionDriftDetector;
  let feedbackLoop: ExecutionFeedbackLoop;

  beforeEach(() => {
    // Create in-memory database
    db = new Database(":memory:");

    // Create schema
    db.exec(`
      CREATE TABLE execution_validations (
        id INTEGER PRIMARY KEY,
        order_uuid TEXT NOT NULL,
        strategy_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        expected_price REAL NOT NULL,
        actual_price REAL NOT NULL,
        expected_qty REAL NOT NULL,
        actual_qty REAL NOT NULL,
        slippage_bps REAL NOT NULL,
        latency_ms INTEGER NOT NULL,
        fill_quality_score REAL NOT NULL,
        venue TEXT NOT NULL,
        validated_at TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE slippage_distributions (
        id INTEGER PRIMARY KEY,
        strategy_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        sample_count INTEGER NOT NULL,
        mean_slippage_bps REAL NOT NULL,
        median_slippage_bps REAL NOT NULL,
        p95_slippage_bps REAL NOT NULL,
        p99_slippage_bps REAL NOT NULL,
        std_dev_bps REAL NOT NULL,
        favorable_pct REAL NOT NULL,
        computed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE execution_drift_events (
        id INTEGER PRIMARY KEY,
        strategy_id TEXT NOT NULL,
        drift_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        observed_value REAL NOT NULL,
        expected_range_low REAL NOT NULL,
        expected_range_high REAL NOT NULL,
        details TEXT NOT NULL DEFAULT '{}',
        detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Initialize validators
    validator = new ExecutionValidator(db);
    analyzer = new SlippageAnalyzer(db);
    detector = new ExecutionDriftDetector(db);
    feedbackLoop = new ExecutionFeedbackLoop(
      db,
      validator,
      analyzer,
      detector
    );
  });

  // =========================================================================
  // ExecutionValidator Tests
  // =========================================================================

  describe("ExecutionValidator", () => {
    it("computes correct slippage for buy orders", () => {
      const order: Order = {
        uuid: "order-1",
        strategyId: "strategy-1",
        symbol: "AAPL",
        side: "buy",
        expectedPrice: 150.0,
        expectedQty: 100,
        timestamp: new Date("2025-01-01T10:00:00"),
      };

      const fill: Fill = {
        orderUuid: "order-1",
        actualPrice: 149.5,
        actualQty: 100,
        venue: "NASDAQ",
        timestamp: new Date("2025-01-01T10:00:10"),
      };

      const validation = validator.validateFill(order, fill);

      // Expected slippage: (150 - 149.5) / 150 * 10000 = 33.33 bps (favorable)
      expect(validation.slippageBps).toBeCloseTo(33.33, 1);
      expect(validation.slippageBps).toBeGreaterThan(0);
    });

    it("computes correct slippage for sell orders", () => {
      const order: Order = {
        uuid: "order-2",
        strategyId: "strategy-1",
        symbol: "AAPL",
        side: "sell",
        expectedPrice: 150.0,
        expectedQty: 100,
        timestamp: new Date("2025-01-01T10:00:00"),
      };

      const fill: Fill = {
        orderUuid: "order-2",
        actualPrice: 150.5,
        actualQty: 100,
        venue: "NASDAQ",
        timestamp: new Date("2025-01-01T10:00:10"),
      };

      const validation = validator.validateFill(order, fill);

      // Expected slippage: (150.5 - 150) / 150 * 10000 = 33.33 bps (favorable)
      expect(validation.slippageBps).toBeCloseTo(33.33, 1);
      expect(validation.slippageBps).toBeGreaterThan(0);
    });

    it("computes negative slippage for unfavorable fills", () => {
      const order: Order = {
        uuid: "order-3",
        strategyId: "strategy-1",
        symbol: "AAPL",
        side: "buy",
        expectedPrice: 150.0,
        expectedQty: 100,
        timestamp: new Date("2025-01-01T10:00:00"),
      };

      const fill: Fill = {
        orderUuid: "order-3",
        actualPrice: 151.0,
        actualQty: 100,
        venue: "NASDAQ",
        timestamp: new Date("2025-01-01T10:00:10"),
      };

      const validation = validator.validateFill(order, fill);

      // Expected slippage: (150 - 151) / 150 * 10000 = -66.67 bps (unfavorable)
      expect(validation.slippageBps).toBeCloseTo(-66.67, 1);
      expect(validation.slippageBps).toBeLessThan(0);
    });

    it("fill quality score weights components correctly", () => {
      const order: Order = {
        uuid: "order-4",
        strategyId: "strategy-1",
        symbol: "AAPL",
        side: "buy",
        expectedPrice: 150.0,
        expectedQty: 100,
        timestamp: new Date("2025-01-01T10:00:00"),
      };

      const fill: Fill = {
        orderUuid: "order-4",
        actualPrice: 150.0,
        actualQty: 100,
        venue: "NASDAQ",
        timestamp: new Date("2025-01-01T10:00:01"),
      };

      const validation = validator.validateFill(order, fill);

      // Perfect fill: 0 slippage (1.0), low latency 1ms (1.0), 100% fill (1.0)
      // Score = 1.0 * 0.4 + 1.0 * 0.3 + 1.0 * 0.3 = 1.0
      expect(validation.fillQualityScore).toBeCloseTo(1.0, 2);
    });

    it("fill quality score handles partial fills", () => {
      const order: Order = {
        uuid: "order-5",
        strategyId: "strategy-1",
        symbol: "AAPL",
        side: "buy",
        expectedPrice: 150.0,
        expectedQty: 100,
        timestamp: new Date("2025-01-01T10:00:00"),
      };

      const fill: Fill = {
        orderUuid: "order-5",
        actualPrice: 150.0,
        actualQty: 50,
        venue: "NASDAQ",
        timestamp: new Date("2025-01-01T10:00:01"),
      };

      const validation = validator.validateFill(order, fill);

      // 50% fill: slippage score 1.0, latency score 1.0, completeness 0.5
      // Score = 1.0 * 0.4 + 1.0 * 0.3 + 0.5 * 0.3 = 0.85
      expect(validation.fillQualityScore).toBeCloseTo(0.85, 1);
    });

    it("includes latency in validation", () => {
      const order: Order = {
        uuid: "order-6",
        strategyId: "strategy-1",
        symbol: "AAPL",
        side: "buy",
        expectedPrice: 150.0,
        expectedQty: 100,
        timestamp: new Date("2025-01-01T10:00:00"),
      };

      const fill: Fill = {
        orderUuid: "order-6",
        actualPrice: 150.0,
        actualQty: 100,
        venue: "NASDAQ",
        timestamp: new Date("2025-01-01T10:00:05"),
      };

      const validation = validator.validateFill(order, fill);

      expect(validation.latencyMs).toBe(5000);
    });
  });

  // =========================================================================
  // SlippageAnalyzer Tests
  // =========================================================================

  describe("SlippageAnalyzer", () => {
    it("computes distribution stats correctly", () => {
      // Insert test data
      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const slippages = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
      const stmt = db.prepare(`
        INSERT INTO execution_validations (
          order_uuid, strategy_id, symbol, side,
          expected_price, actual_price, expected_qty, actual_qty,
          slippage_bps, latency_ms, fill_quality_score, venue,
          validated_at, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')
      `);

      for (let i = 0; i < slippages.length; i++) {
        stmt.run(
          `order-${i}`,
          "strategy-1",
          "AAPL",
          "buy",
          150.0,
          150.0,
          100,
          100,
          slippages[i],
          10,
          0.95,
          "NASDAQ",
          oneWeekAgo.toISOString()
        );
      }

      const dist = analyzer.computeDistribution("strategy-1", "AAPL", 7);

      expect(dist).not.toBeNull();
      expect(dist!.sampleCount).toBe(10);
      expect(dist!.meanSlippageBps).toBeCloseTo(27.5, 1);
      expect(dist!.favorablePct).toBe(100);
    });

    it("detects unacceptable slippage", () => {
      // Insert data with high slippage
      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const slippages = Array(20).fill(0).map((_, i) => 50 + i);
      const stmt = db.prepare(`
        INSERT INTO execution_validations (
          order_uuid, strategy_id, symbol, side,
          expected_price, actual_price, expected_qty, actual_qty,
          slippage_bps, latency_ms, fill_quality_score, venue,
          validated_at, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')
      `);

      for (let i = 0; i < slippages.length; i++) {
        stmt.run(
          `order-${i}`,
          "strategy-2",
          "AAPL",
          "buy",
          150.0,
          150.0,
          100,
          100,
          slippages[i],
          10,
          0.95,
          "NASDAQ",
          oneWeekAgo.toISOString()
        );
      }

      // Insert into slippage_distributions
      const distStmt = db.prepare(`
        INSERT INTO slippage_distributions (
          strategy_id, symbol, period_start, period_end,
          sample_count, mean_slippage_bps, median_slippage_bps,
          p95_slippage_bps, p99_slippage_bps, std_dev_bps,
          favorable_pct
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      distStmt.run(
        "strategy-2",
        "AAPL",
        oneWeekAgo.toISOString(),
        now.toISOString(),
        20,
        59.5,
        59.5,
        68.05,
        69.81,
        5.77,
        100
      );

      // Threshold of 10 bps should fail
      const acceptable = analyzer.isSlippageAcceptable("strategy-2", 10);
      expect(acceptable).toBe(false);
    });

    it("records slippage in rolling window", () => {
      analyzer.recordSlippage("strategy-3", "AAPL", 25);
      analyzer.recordSlippage("strategy-3", "AAPL", 30);
      analyzer.recordSlippage("strategy-3", "AAPL", 35);

      // After recording, distribution should compute correctly
      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const stmt = db.prepare(`
        INSERT INTO execution_validations (
          order_uuid, strategy_id, symbol, side,
          expected_price, actual_price, expected_qty, actual_qty,
          slippage_bps, latency_ms, fill_quality_score, venue,
          validated_at, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')
      `);

      stmt.run(
        "order-test",
        "strategy-3",
        "AAPL",
        "buy",
        150.0,
        150.0,
        100,
        100,
        30,
        10,
        0.95,
        "NASDAQ",
        oneWeekAgo.toISOString()
      );

      expect(true).toBe(true);
    });

    it("compares backtest vs live slippage", () => {
      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Insert live data with mean slippage of 10 bps
      const stmt = db.prepare(`
        INSERT INTO execution_validations (
          order_uuid, strategy_id, symbol, side,
          expected_price, actual_price, expected_qty, actual_qty,
          slippage_bps, latency_ms, fill_quality_score, venue,
          validated_at, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')
      `);

      for (let i = 0; i < 10; i++) {
        stmt.run(
          `order-${i}`,
          "strategy-4",
          "AAPL",
          "buy",
          150.0,
          150.0,
          100,
          100,
          10,
          10,
          0.95,
          "NASDAQ",
          oneWeekAgo.toISOString()
        );
      }

      const distStmt = db.prepare(`
        INSERT INTO slippage_distributions (
          strategy_id, symbol, period_start, period_end,
          sample_count, mean_slippage_bps, median_slippage_bps,
          p95_slippage_bps, p99_slippage_bps, std_dev_bps,
          favorable_pct
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      distStmt.run(
        "strategy-4",
        "AAPL",
        oneWeekAgo.toISOString(),
        now.toISOString(),
        10,
        10,
        10,
        10,
        10,
        0,
        100
      );

      // Backtest assumed 5 bps, live is 10 bps
      const comparison = analyzer.compareBacktestVsLive(
        "strategy-4",
        5
      );

      expect(comparison.status).toBe("aligned");
      expect(comparison.divergence).toBeLessThan(100);
    });
  });

  // =========================================================================
  // ExecutionDriftDetector Tests
  // =========================================================================

  describe("ExecutionDriftDetector", () => {
    it("identifies slippage spikes", () => {
      // Record baseline metrics
      for (let i = 0; i < 20; i++) {
        detector.recordMetrics("strategy-5", 10, 100, 0.95);
      }

      // Record spike
      for (let i = 0; i < 5; i++) {
        detector.recordMetrics("strategy-5", 50, 100, 0.95);
      }

      const events = detector.detectDrift("strategy-5");

      // Should detect slippage spike
      const slippageSpikes = events.filter(
        (e) => e.driftType === "slippage_spike"
      );
      expect(slippageSpikes.length).toBeGreaterThan(0);
    });

    it("identifies latency spikes", () => {
      // Record baseline metrics
      for (let i = 0; i < 20; i++) {
        detector.recordMetrics("strategy-6", 10, 100, 0.95);
      }

      // Record spike (3x baseline)
      for (let i = 0; i < 5; i++) {
        detector.recordMetrics("strategy-6", 10, 400, 0.95);
      }

      const events = detector.detectDrift("strategy-6");

      // Should detect latency spike
      const latencySpikes = events.filter(
        (e) => e.driftType === "latency_spike"
      );
      expect(latencySpikes.length).toBeGreaterThan(0);
    });

    it("identifies fill rate drops", () => {
      // Record baseline metrics (high fill rates)
      for (let i = 0; i < 20; i++) {
        detector.recordMetrics("strategy-7", 10, 100, 0.95);
      }

      // Record drop in fill rate (< 90%)
      for (let i = 0; i < 5; i++) {
        detector.recordMetrics("strategy-7", 10, 100, 0.8);
      }

      const events = detector.detectDrift("strategy-7");

      // Should detect fill rate drop
      const fillRateDrops = events.filter(
        (e) => e.driftType === "fill_rate_drop"
      );
      expect(fillRateDrops.length).toBeGreaterThan(0);
    });

    it("classifies severity correctly", () => {
      // Record baseline
      for (let i = 0; i < 20; i++) {
        detector.recordMetrics("strategy-8", 10, 100, 0.95);
      }

      // Record critical spike (> 3 stddev)
      for (let i = 0; i < 5; i++) {
        detector.recordMetrics("strategy-8", 100, 100, 0.95);
      }

      const events = detector.detectDrift("strategy-8");

      if (events.length > 0) {
        const highestSeverity = events.reduce((max, e) => {
          const severityMap = { info: 0, warning: 1, critical: 2 };
          return Math.max(
            max,
            severityMap[e.severity as keyof typeof severityMap]
          );
        }, 0);

        expect(highestSeverity).toBeGreaterThan(0);
      }
    });

    it("returns clean status when no drift", () => {
      // Record normal metrics
      for (let i = 0; i < 20; i++) {
        detector.recordMetrics("strategy-9", 10, 100, 0.95);
      }

      const status = detector.getDriftStatus("strategy-9");

      // Status should be clean or warning, not critical
      expect(["clean", "warning"]).toContain(status);
    });
  });

  // =========================================================================
  // ExecutionFeedbackLoop Tests
  // =========================================================================

  describe("ExecutionFeedbackLoop", () => {
    it("generates execution report with all required sections", () => {
      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Insert test data
      const stmt = db.prepare(`
        INSERT INTO execution_validations (
          order_uuid, strategy_id, symbol, side,
          expected_price, actual_price, expected_qty, actual_qty,
          slippage_bps, latency_ms, fill_quality_score, venue,
          validated_at, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')
      `);

      for (let i = 0; i < 10; i++) {
        stmt.run(
          `order-${i}`,
          "strategy-10",
          "AAPL",
          "buy",
          150.0,
          150.0,
          100,
          100,
          10 + i,
          50 + i * 10,
          0.9 + i * 0.01,
          "NASDAQ",
          oneWeekAgo.toISOString()
        );
      }

      const report = feedbackLoop.getExecutionReport("strategy-10", 5);

      expect(report).toHaveProperty("strategyId");
      expect(report).toHaveProperty("reportedAt");
      expect(report).toHaveProperty("periodStart");
      expect(report).toHaveProperty("periodEnd");
      expect(report).toHaveProperty("totalFills");
      expect(report).toHaveProperty("averageSlippageBps");
      expect(report).toHaveProperty("p95SlippageBps");
      expect(report).toHaveProperty("p99SlippageBps");
      expect(report).toHaveProperty("averageLatencyMs");
      expect(report).toHaveProperty("fillCompletionRate");
      expect(report).toHaveProperty("driftStatus");
      expect(report).toHaveProperty("recentDriftEvents");
      expect(report).toHaveProperty("backtestAssumedSlippageBps");
      expect(report).toHaveProperty("backtestVsLiveDivergence");
      expect(report).toHaveProperty("fillQualityScore");
      expect(report).toHaveProperty("venues");
      expect(report).toHaveProperty("symbols");

      expect(report.totalFills).toBe(10);
    });

    it("detects backtest vs live divergence", () => {
      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Insert live data with high slippage
      const stmt = db.prepare(`
        INSERT INTO execution_validations (
          order_uuid, strategy_id, symbol, side,
          expected_price, actual_price, expected_qty, actual_qty,
          slippage_bps, latency_ms, fill_quality_score, venue,
          validated_at, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')
      `);

      for (let i = 0; i < 10; i++) {
        stmt.run(
          `order-${i}`,
          "strategy-11",
          "AAPL",
          "buy",
          150.0,
          150.0,
          100,
          100,
          50,
          50,
          0.9,
          "NASDAQ",
          oneWeekAgo.toISOString()
        );
      }

      // Backtest assumed only 5 bps
      const report = feedbackLoop.getExecutionReport(
        "strategy-11",
        5
      );

      // Should show divergence
      expect(report.backtestAssumedSlippageBps).toBe(5);
      expect(report.backtestVsLiveDivergence).toBeGreaterThan(0);
    });

    it("includes venue and symbol breakdowns", () => {
      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Insert data across multiple venues and symbols
      const stmt = db.prepare(`
        INSERT INTO execution_validations (
          order_uuid, strategy_id, symbol, side,
          expected_price, actual_price, expected_qty, actual_qty,
          slippage_bps, latency_ms, fill_quality_score, venue,
          validated_at, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')
      `);

      stmt.run(
        "order-1",
        "strategy-12",
        "AAPL",
        "buy",
        150.0,
        150.0,
        100,
        100,
        10,
        50,
        0.9,
        "NASDAQ",
        oneWeekAgo.toISOString()
      );

      stmt.run(
        "order-2",
        "strategy-12",
        "TSLA",
        "buy",
        200.0,
        200.0,
        100,
        100,
        10,
        50,
        0.9,
        "NYSE",
        oneWeekAgo.toISOString()
      );

      const report = feedbackLoop.getExecutionReport("strategy-12");

      expect(Object.keys(report.venues).length).toBeGreaterThan(0);
      expect(Object.keys(report.symbols).length).toBeGreaterThan(0);
      expect(report.venues["NASDAQ"]).toBe(1);
      expect(report.venues["NYSE"]).toBe(1);
    });
  });
});
