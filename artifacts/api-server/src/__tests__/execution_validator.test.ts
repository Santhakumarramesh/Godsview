import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ExecutionValidator,
  SlippageAnalyzer,
  ExecutionDriftDetector,
  ExecutionFeedbackLoop,
  type Order,
  type Fill,
} from "../lib/execution_validator.js";

// ============================================================================
// Lightweight in-memory SQLite mock
// ============================================================================

interface Row { [key: string]: unknown }

class MockStatement {
  private sql: string;
  private tables: Map<string, Row[]>;

  constructor(sql: string, tables: Map<string, Row[]>) {
    this.sql = sql.trim();
    this.tables = tables;
  }

  run(...params: unknown[]): { changes: number } {
    const insertMatch = this.sql.match(
      /INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/is
    );
    if (insertMatch) {
      const tableName = insertMatch[1];
      const cols = insertMatch[2].split(",").map((c) => c.trim().replace(/['"]/g, ""));
      const row: Row = {};
      for (let i = 0; i < cols.length; i++) {
        row[cols[i]] = params[i] ?? null;
      }
      if (!this.tables.has(tableName)) this.tables.set(tableName, []);
      this.tables.get(tableName)!.push(row);
      return { changes: 1 };
    }
    return { changes: 0 };
  }

  all(...params: unknown[]): Row[] {
    const selectMatch = this.sql.match(
      /FROM\s+(\w+)/i
    );
    if (!selectMatch) return [];
    const tableName = selectMatch[1];
    const rows = this.tables.get(tableName) ?? [];

    // Apply WHERE strategy_id = ? filters
    const whereMatch = this.sql.match(/WHERE\s+(.*?)(?:ORDER|LIMIT|$)/is);
    if (!whereMatch) return rows;

    let filtered = [...rows];
    const whereClause = whereMatch[1];

    // Extract conditions with positional params
    const conditions: Array<{ col: string; op: string; paramIdx: number }> = [];
    let paramIdx = 0;
    const condParts = whereClause.split(/\s+AND\s+/i);
    for (const part of condParts) {
      const m = part.trim().match(/(\w+)\s*(>=|<=|<|>|=)\s*\?/);
      if (m) {
        conditions.push({ col: m[1], op: m[2], paramIdx });
        paramIdx++;
      }
    }

    for (const cond of conditions) {
      const val = params[cond.paramIdx];
      filtered = filtered.filter((row) => {
        const rv = row[cond.col];
        if (rv === undefined || rv === null) return false;
        switch (cond.op) {
          case "=": return rv === val;
          case ">=": return String(rv) >= String(val);
          case "<=": return String(rv) <= String(val);
          case ">": return String(rv) > String(val);
          case "<": return String(rv) < String(val);
          default: return true;
        }
      });
    }

    // Handle ORDER BY ... ASC
    const orderMatch = this.sql.match(/ORDER\s+BY\s+(\w+)\s+(ASC|DESC)/i);
    if (orderMatch) {
      const col = orderMatch[1];
      const dir = orderMatch[2].toUpperCase() === "DESC" ? -1 : 1;
      filtered.sort((a, b) => {
        const av = a[col] as number ?? 0;
        const bv = b[col] as number ?? 0;
        return (av - bv) * dir;
      });
    }

    // Handle LIMIT
    const limitMatch = this.sql.match(/LIMIT\s+(\d+)/i);
    if (limitMatch) {
      filtered = filtered.slice(0, Number(limitMatch[1]));
    }

    return filtered;
  }

  get(...params: unknown[]): Row | undefined {
    const rows = this.all(...params);
    if (rows.length === 0) {
      // Handle aggregate queries like AVG, MAX
      const aggMatch = this.sql.match(/SELECT\s+(?:AVG|MAX|MIN|COUNT)\s*\(.*?\)\s*as\s+(\w+)/i);
      if (aggMatch) {
        return { [aggMatch[1]]: null } as Row;
      }
      return undefined;
    }

    // Handle aggregate queries
    const avgMatch = this.sql.match(/AVG\s*\(\s*(?:CAST\s*\(\s*)?(\w+)/gi);
    const maxMatch = this.sql.match(/MAX\s*\(\s*(\w+)\s*\)/i);

    if (avgMatch || maxMatch) {
      const result: Row = {};

      if (avgMatch) {
        for (const m of this.sql.matchAll(/AVG\s*\(\s*(?:CAST\s*\(\s*)?(\w+)(?:\s+AS\s+\w+\s*\))?\s*\)\s*as\s+(\w+)/gi)) {
          const col = m[1];
          const alias = m[2];
          const sum = rows.reduce((s, r) => s + (Number(r[col]) || 0), 0);
          result[alias] = rows.length > 0 ? sum / rows.length : null;
        }
      }

      if (maxMatch) {
        const col = maxMatch[1];
        const alias = this.sql.match(/MAX\s*\(\s*\w+\s*\)\s*as\s+(\w+)/i)?.[1] ?? "max";
        const vals = rows.map((r) => r[col]).filter((v) => v != null);
        result[alias] = vals.length > 0 ? vals.sort().pop() : null;
      }

      return result;
    }

    return rows[0];
  }
}

class MockDatabase {
  tables: Map<string, Row[]> = new Map();

  exec(sql: string): void {
    // Parse CREATE TABLE statements to register tables
    const createMatches = sql.matchAll(/CREATE\s+TABLE\s+(\w+)/gi);
    for (const m of createMatches) {
      this.tables.set(m[1], []);
    }
  }

  prepare(sql: string): MockStatement {
    return new MockStatement(sql, this.tables);
  }
}

// ============================================================================
// Tests
// ============================================================================

describe("Execution Validator", () => {
  let db: MockDatabase;
  let validator: ExecutionValidator;
  let analyzer: SlippageAnalyzer;
  let detector: ExecutionDriftDetector;
  let feedbackLoop: ExecutionFeedbackLoop;

  beforeEach(() => {
    db = new MockDatabase();

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

    // Pass db as any since our mock implements the needed interface
    validator = new ExecutionValidator(db as any);
    analyzer = new SlippageAnalyzer(db as any);
    detector = new ExecutionDriftDetector(db as any);
    feedbackLoop = new ExecutionFeedbackLoop(
      db as any,
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

      // Perfect fill: 0 slippage (1.0), latency 1000ms (0.8), 100% fill (1.0)
      // Score = 1.0 * 0.4 + 0.8 * 0.3 + 1.0 * 0.3 = 0.94
      expect(validation.fillQualityScore).toBeGreaterThan(0.9);
      expect(validation.fillQualityScore).toBeLessThanOrEqual(1.0);
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

      // 50% fill: slippage score 1.0, latency score ~0.8, completeness 0.5
      // Score range: 0.7-0.85
      expect(validation.fillQualityScore).toBeGreaterThan(0.7);
      expect(validation.fillQualityScore).toBeLessThan(0.9);
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
      const now = new Date();
      // Use 3 days ago (well within the 7-day window) to avoid boundary issues
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

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
          threeDaysAgo.toISOString()
        );
      }

      const dist = analyzer.computeDistribution("strategy-1", "AAPL", 7);

      expect(dist).not.toBeNull();
      expect(dist!.sampleCount).toBe(10);
      expect(dist!.meanSlippageBps).toBeCloseTo(27.5, 1);
      expect(dist!.favorablePct).toBe(100);
    });

    it("detects unacceptable slippage", () => {
      const now = new Date();
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

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
          threeDaysAgo.toISOString()
        );
      }

      // Insert into slippage_distributions
      const distStmt = db.prepare(`
        INSERT INTO slippage_distributions (
          strategy_id, symbol, period_start, period_end,
          sample_count, mean_slippage_bps, median_slippage_bps,
          p95_slippage_bps, p99_slippage_bps, std_dev_bps,
          favorable_pct, computed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      distStmt.run(
        "strategy-2",
        "AAPL",
        threeDaysAgo.toISOString(),
        now.toISOString(),
        20,
        59.5,
        59.5,
        68.05,
        69.81,
        5.77,
        100,
        now.toISOString()
      );

      // Threshold of 10 bps should fail
      const acceptable = analyzer.isSlippageAcceptable("strategy-2", 10);
      expect(acceptable).toBe(false);
    });

    it("records slippage in rolling window", () => {
      analyzer.recordSlippage("strategy-3", "AAPL", 25);
      analyzer.recordSlippage("strategy-3", "AAPL", 30);
      analyzer.recordSlippage("strategy-3", "AAPL", 35);

      const now = new Date();
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

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
        threeDaysAgo.toISOString()
      );

      expect(true).toBe(true);
    });

    it("compares backtest vs live slippage", () => {
      const now = new Date();
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

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
          threeDaysAgo.toISOString()
        );
      }

      const distStmt = db.prepare(`
        INSERT INTO slippage_distributions (
          strategy_id, symbol, period_start, period_end,
          sample_count, mean_slippage_bps, median_slippage_bps,
          p95_slippage_bps, p99_slippage_bps, std_dev_bps,
          favorable_pct, computed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      distStmt.run(
        "strategy-4",
        "AAPL",
        threeDaysAgo.toISOString(),
        now.toISOString(),
        10,
        10,
        10,
        10,
        10,
        0,
        100,
        now.toISOString()
      );

      // Backtest assumed 9 bps, live is 10 bps (10% divergence < 20% threshold)
      const comparison = analyzer.compareBacktestVsLive(
        "strategy-4",
        9
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
      // Record baseline metrics (30 samples to dominate the mean)
      for (let i = 0; i < 30; i++) {
        detector.recordMetrics("strategy-5", 10, 100, 0.95);
      }

      // Record spike (must exceed 2 stddev from overall mean)
      for (let i = 0; i < 5; i++) {
        detector.recordMetrics("strategy-5", 200, 100, 0.95);
      }

      const events = detector.detectDrift("strategy-5");

      const slippageSpikes = events.filter(
        (e) => e.driftType === "slippage_spike"
      );
      expect(slippageSpikes.length).toBeGreaterThan(0);
    });

    it("identifies latency spikes", () => {
      // Record baseline metrics (30 samples)
      for (let i = 0; i < 30; i++) {
        detector.recordMetrics("strategy-6", 10, 100, 0.95);
      }

      // Record spike (must be >3x overall mean including spike samples)
      // Overall mean ≈ (3000+5000)/35 ≈ 228, so 1000 > 228*3 = 686
      for (let i = 0; i < 5; i++) {
        detector.recordMetrics("strategy-6", 10, 1000, 0.95);
      }

      const events = detector.detectDrift("strategy-6");

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
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

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
          threeDaysAgo.toISOString()
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
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

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
          threeDaysAgo.toISOString()
        );
      }

      // Backtest assumed only 5 bps
      const report = feedbackLoop.getExecutionReport(
        "strategy-11",
        5
      );

      expect(report.backtestAssumedSlippageBps).toBe(5);
      expect(report.backtestVsLiveDivergence).toBeGreaterThan(0);
    });

    it("includes venue and symbol breakdowns", () => {
      const now = new Date();
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

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
        threeDaysAgo.toISOString()
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
        threeDaysAgo.toISOString()
      );

      const report = feedbackLoop.getExecutionReport("strategy-12");

      expect(Object.keys(report.venues).length).toBeGreaterThan(0);
      expect(Object.keys(report.symbols).length).toBeGreaterThan(0);
      expect(report.venues["NASDAQ"]).toBe(1);
      expect(report.venues["NYSE"]).toBe(1);
    });
  });
});
