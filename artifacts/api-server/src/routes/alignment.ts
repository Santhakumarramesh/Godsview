/**
 * Alignment Routes — API for backtest↔live alignment checks.
 *
 * GET   /alignment/:strategyId/history       — Alignment snapshot history
 * GET   /alignment/:strategyId/latest        — Latest alignment snapshot
 * POST  /alignment/:strategyId/check         — Run alignment check
 * GET   /alignment/drift-events              — Unresolved drift events
 * POST  /alignment/drift-events/:id/resolve  — Resolve a drift event
 * GET   /alignment/slippage/:symbol          — Latest slippage calibration
 * POST  /alignment/slippage/:symbol/calibrate — Run slippage calibration
 */

import { Router, Request, Response } from "express";
import { requireOperator } from "../lib/auth_guard";
import { logger } from "../lib/logger";
import {
  runAlignmentCheck,
  persistAlignmentSnapshot,
  computeLiveMetrics,
  computeSlippageCalibration,
  getAlignmentHistory,
  getUnresolvedDriftEvents,
  getLatestSlippageCalibration,
  resolveDriftEvent,
  type BacktestMetrics,
} from "../lib/alignment_engine";

export const alignmentRouter = Router();

// ── Alignment History ──────────────────────────────────────────

alignmentRouter.get("/:strategyId/history", async (req: Request, res: Response) => {
  try {
    const { strategyId } = req.params;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const snapshots = await getAlignmentHistory(strategyId, limit);
    res.json({ snapshots, count: snapshots.length });
  } catch (err) {
    logger.error({ err }, "Failed to get alignment history");
    res.status(503).json({ error: "internal_error" });
  }
});

// ── Latest Alignment ───────────────────────────────────────────

alignmentRouter.get("/:strategyId/latest", async (req: Request, res: Response) => {
  try {
    const { strategyId } = req.params;
    const snapshots = await getAlignmentHistory(strategyId, 1);
    const latest = snapshots[0] ?? null;
    if (!latest) {
      res.json({ snapshot: null, message: "No alignment data yet" });
      return;
    }
    res.json({ snapshot: latest });
  } catch (err) {
    logger.error({ err }, "Failed to get latest alignment");
    res.status(503).json({ error: "internal_error" });
  }
});

// ── Run Alignment Check ────────────────────────────────────────

alignmentRouter.post("/:strategyId/check", async (req: Request, res: Response) => {
  try {
    const { strategyId } = req.params;
    const {
      backtest_metrics,
      period_days = 30,
      symbol,
      regime,
    } = req.body ?? {};

    if (!backtest_metrics) {
      res.status(400).json({
        error: "missing_backtest_metrics",
        message: "Provide backtest_metrics: { win_rate, avg_pnl, sharpe, max_drawdown_pct, avg_slippage_bps, trade_count }",
      });
      return;
    }

    const bt: BacktestMetrics = {
      win_rate: Number(backtest_metrics.win_rate) || 0,
      avg_pnl: Number(backtest_metrics.avg_pnl) || 0,
      sharpe: Number(backtest_metrics.sharpe) || 0,
      max_drawdown_pct: Number(backtest_metrics.max_drawdown_pct) || 0,
      avg_slippage_bps: Number(backtest_metrics.avg_slippage_bps) || 0,
      trade_count: Number(backtest_metrics.trade_count) || 0,
    };

    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - period_days * 24 * 60 * 60 * 1000);

    // Compute live metrics from execution truth layer
    const live = await computeLiveMetrics(strategyId, periodStart, periodEnd, symbol);

    if (!live) {
      // No live data yet — still run alignment with zeros to record the check
      const result = runAlignmentCheck(strategyId, bt, {
        win_rate: 0, avg_pnl: 0, sharpe: 0,
        max_drawdown_pct: 0, avg_slippage_bps: 0, trade_count: 0,
      }, { period_start: periodStart, period_end: periodEnd, symbol, regime });

      await persistAlignmentSnapshot(result);
      res.json({ alignment: result, note: "No live execution data found for this strategy/period" });
      return;
    }

    const result = runAlignmentCheck(strategyId, bt, live, {
      period_start: periodStart,
      period_end: periodEnd,
      symbol,
      regime,
    });

    await persistAlignmentSnapshot(result);
    res.json({ alignment: result });
  } catch (err) {
    logger.error({ err }, "Alignment check failed");
    res.status(503).json({ error: "alignment_check_failed" });
  }
});

// ── Drift Events ───────────────────────────────────────────────

alignmentRouter.get("/drift-events", async (req: Request, res: Response) => {
  try {
    const strategyId = typeof req.query.strategy_id === "string" ? req.query.strategy_id : undefined;
    const events = await getUnresolvedDriftEvents(strategyId);
    res.json({ events, count: events.length });
  } catch (err) {
    logger.error({ err }, "Failed to get drift events");
    res.status(503).json({ error: "internal_error" });
  }
});

alignmentRouter.post("/drift-events/:id/resolve", requireOperator, async (req: Request, res: Response) => {
  try {
    const eventId = Number(req.params.id);
    const { notes } = req.body ?? {};
    const success = await resolveDriftEvent(eventId, notes);
    if (success) {
      res.json({ resolved: true });
    } else {
      res.status(503).json({ error: "resolve_failed" });
    }
  } catch (err) {
    logger.error({ err }, "Failed to resolve drift event");
    res.status(503).json({ error: "internal_error" });
  }
});

// ── Slippage Calibration ───────────────────────────────────────

alignmentRouter.get("/slippage/:symbol", async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const calibration = await getLatestSlippageCalibration(symbol);
    if (!calibration) {
      res.json({ calibration: null, message: "No calibration data yet" });
      return;
    }
    res.json({ calibration });
  } catch (err) {
    logger.error({ err }, "Failed to get slippage calibration");
    res.status(503).json({ error: "internal_error" });
  }
});

alignmentRouter.post("/slippage/:symbol/calibrate", async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const {
      period_days = 30,
      assumed_slippage_bps = 5.0,
      regime,
      setup_type,
    } = req.body ?? {};

    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - period_days * 24 * 60 * 60 * 1000);

    const result = await computeSlippageCalibration(
      symbol,
      periodStart,
      periodEnd,
      Number(assumed_slippage_bps),
      { regime, setup_type },
    );

    if (!result) {
      res.json({
        calibration: null,
        message: "Insufficient fill data for calibration (need >= 5 fills with slippage data)",
      });
      return;
    }

    res.json({ calibration: result, symbol });
  } catch (err) {
    logger.error({ err }, "Slippage calibration failed");
    res.status(503).json({ error: "calibration_failed" });
  }
});

export default alignmentRouter;
