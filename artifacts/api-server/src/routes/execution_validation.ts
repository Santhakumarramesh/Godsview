import { Router, Request, Response } from "express";
import Database from "better-sqlite3";
import {
  ExecutionValidator,
  SlippageAnalyzer,
  ExecutionDriftDetector,
  ExecutionFeedbackLoop,
  type Order,
  type Fill,
  type ExecutionReport,
} from "../lib/execution_validator.js";

const router = Router();

// Injectable database instance (provided by app initialization)
let db: Database.Database;
let validator: ExecutionValidator;
let analyzer: SlippageAnalyzer;
let detector: ExecutionDriftDetector;
let feedbackLoop: ExecutionFeedbackLoop;

/**
 * Initialize routes with database connection
 */
export function initializeExecutionValidationRoutes(
  database: Database.Database
): Router {
  db = database;
  validator = new ExecutionValidator(db);
  analyzer = new SlippageAnalyzer(db);
  detector = new ExecutionDriftDetector(db);
  feedbackLoop = new ExecutionFeedbackLoop(
    db,
    validator,
    analyzer,
    detector
  );

  return router;
}

// ============================================================================
// POST /api/execution-validation/validate
// ============================================================================

router.post(
  "/validate",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { order, fill } = req.body;

      if (!order || !fill) {
        res.status(400).json({
          error: "Missing order or fill in request body",
        });
        return;
      }

      // Validate required fields
      const orderKeys = [
        "uuid",
        "strategyId",
        "symbol",
        "side",
        "expectedPrice",
        "expectedQty",
        "timestamp",
      ];
      const fillKeys = ["orderUuid", "actualPrice", "actualQty", "venue", "timestamp"];

      for (const key of orderKeys) {
        if (!(key in order)) {
          res.status(400).json({ error: `Missing order.${key}` });
          return;
        }
      }

      for (const key of fillKeys) {
        if (!(key in fill)) {
          res.status(400).json({ error: `Missing fill.${key}` });
          return;
        }
      }

      // Parse timestamps
      const orderTyped: Order = {
        ...order,
        timestamp: new Date(order.timestamp),
      };

      const fillTyped: Fill = {
        ...fill,
        timestamp: new Date(fill.timestamp),
      };

      // Validate fill
      const validation = validator.validateFill(orderTyped, fillTyped);

      // Record metrics in detector
      detector.recordMetrics(
        validation.strategyId,
        validation.slippageBps,
        validation.latencyMs,
        validation.actualQty / validation.expectedQty
      );

      // Record slippage in analyzer
      analyzer.recordSlippage(
        validation.strategyId,
        validation.symbol,
        validation.slippageBps
      );

      // Store to database
      const stmt = db.prepare(`
        INSERT INTO execution_validations (
          order_uuid, strategy_id, symbol, side,
          expected_price, actual_price, expected_qty, actual_qty,
          slippage_bps, latency_ms, fill_quality_score, venue,
          validated_at, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        validation.orderUuid,
        validation.strategyId,
        validation.symbol,
        validation.side,
        validation.expectedPrice,
        validation.actualPrice,
        validation.expectedQty,
        validation.actualQty,
        validation.slippageBps,
        validation.latencyMs,
        validation.fillQualityScore,
        validation.venue,
        validation.validatedAt.toISOString(),
        JSON.stringify(validation.metadata)
      );

      res.json({ success: true, validation });
    } catch (error) {
      console.error("Execution validation error:", error);
      res.status(503).json({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

// ============================================================================
// GET /api/execution-validation/slippage/:strategyId
// ============================================================================

router.get(
  "/slippage/:strategyId",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { strategyId } = req.params;
      const { symbol, days = "7" } = req.query;

      if (!strategyId || !symbol) {
        res.status(400).json({ error: "Missing strategyId or symbol" });
        return;
      }

      const periodDays = parseInt(days as string, 10) || 7;

      const distribution = analyzer.computeDistribution(
        strategyId as string,
        symbol as string,
        periodDays
      );

      if (!distribution) {
        res.status(404).json({ error: "No slippage data found" });
        return;
      }

      res.json({ success: true, distribution });
    } catch (error) {
      console.error("Slippage computation error:", error);
      res.status(503).json({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

// ============================================================================
// GET /api/execution-validation/slippage/:strategyId/compare
// ============================================================================

router.get(
  "/slippage/:strategyId/compare",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { strategyId } = req.params;
      const { backtestAssumedSlippageBps = "0" } = req.query;

      if (!strategyId) {
        res.status(400).json({ error: "Missing strategyId" });
        return;
      }

      const backtestSlippage =
        parseFloat(backtestAssumedSlippageBps as string) || 0;

      const comparison = analyzer.compareBacktestVsLive(
        strategyId as string,
        backtestSlippage
      );

      res.json({ success: true, comparison });
    } catch (error) {
      console.error("Backtest vs live comparison error:", error);
      res.status(503).json({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

// ============================================================================
// GET /api/execution-validation/drift/:strategyId
// ============================================================================

router.get(
  "/drift/:strategyId",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { strategyId } = req.params;

      if (!strategyId) {
        res.status(400).json({ error: "Missing strategyId" });
        return;
      }

      const driftStatus = detector.getDriftStatus(strategyId as string);

      res.json({
        success: true,
        strategyId,
        driftStatus,
        timestamp: new Date(),
      });
    } catch (error) {
      console.error("Drift status error:", error);
      res.status(503).json({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

// ============================================================================
// GET /api/execution-validation/drift/:strategyId/events
// ============================================================================

router.get(
  "/drift/:strategyId/events",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { strategyId } = req.params;
      const { limit = "50", hours = "24" } = req.query;

      if (!strategyId) {
        res.status(400).json({ error: "Missing strategyId" });
        return;
      }

      const limitNum = parseInt(limit as string, 10) || 50;
      const hoursNum = parseInt(hours as string, 10) || 24;

      const query = `
        SELECT
          id,
          strategy_id as strategyId,
          drift_type as driftType,
          severity,
          observed_value as observedValue,
          expected_range_low as expectedRangeLow,
          expected_range_high as expectedRangeHigh,
          details,
          detected_at as detectedAt
        FROM execution_drift_events
        WHERE strategy_id = ?
          AND detected_at >= datetime('now', '-' || ? || ' hours')
        ORDER BY detected_at DESC
        LIMIT ?
      `;

      const stmt = db.prepare(query);
      const events = stmt.all(strategyId, hoursNum, limitNum);

      res.json({ success: true, events });
    } catch (error) {
      console.error("Drift events error:", error);
      res.status(503).json({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

// ============================================================================
// GET /api/execution-validation/report/:strategyId
// ============================================================================

router.get(
  "/report/:strategyId",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { strategyId } = req.params;
      const { backtestAssumedSlippageBps = "0" } = req.query;

      if (!strategyId) {
        res.status(400).json({ error: "Missing strategyId" });
        return;
      }

      const backtestSlippage =
        parseFloat(backtestAssumedSlippageBps as string) || 0;

      const report: ExecutionReport = feedbackLoop.getExecutionReport(
        strategyId as string,
        backtestSlippage
      );

      res.json({ success: true, report });
    } catch (error) {
      console.error("Execution report error:", error);
      res.status(503).json({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

// ============================================================================
// GET /api/execution-validation/system
// ============================================================================

router.get(
  "/system",
  async (req: Request, res: Response): Promise<void> => {
    try {
      // Get system-wide health metrics
      const fillQuery = `
        SELECT
          COUNT(*) as total_fills,
          COUNT(DISTINCT strategy_id) as num_strategies,
          AVG(CAST(slippage_bps AS FLOAT)) as avg_slippage,
          AVG(CAST(latency_ms AS FLOAT)) as avg_latency,
          AVG(CAST(fill_quality_score AS FLOAT)) as avg_quality
        FROM execution_validations
        WHERE validated_at >= datetime('now', '-7 days')
      `;

      const fillStmt = db.prepare(fillQuery);
      const fillStats = fillStmt.get() as {
        total_fills: number;
        num_strategies: number;
        avg_slippage: number | null;
        avg_latency: number | null;
        avg_quality: number | null;
      };

      const driftQuery = `
        SELECT
          severity,
          COUNT(*) as count
        FROM execution_drift_events
        WHERE detected_at >= datetime('now', '-7 days')
        GROUP BY severity
      `;

      const driftStmt = db.prepare(driftQuery);
      const driftCounts = driftStmt.all() as Array<{
        severity: string;
        count: number;
      }>;

      const driftBreakdown = {
        info: 0,
        warning: 0,
        critical: 0,
      };
      for (const item of driftCounts) {
        if (item.severity in driftBreakdown) {
          driftBreakdown[item.severity as keyof typeof driftBreakdown] =
            item.count;
        }
      }

      res.json({
        success: true,
        systemHealth: {
          reportedAt: new Date(),
          executionStats: {
            totalFills: fillStats.total_fills,
            numStrategies: fillStats.num_strategies,
            averageSlippageBps: fillStats.avg_slippage ?? 0,
            averageLatencyMs: fillStats.avg_latency ?? 0,
            averageQualityScore: fillStats.avg_quality ?? 0,
          },
          driftEventsLast7Days: driftBreakdown,
        },
      });
    } catch (error) {
      console.error("System health error:", error);
      res.status(503).json({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

export default router;
