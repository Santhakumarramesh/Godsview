/**
 * Execution Truth Routes — API for persistent order/fill/metrics data.
 *
 * GET  /execution-truth/orders              — List orders with filters
 * GET  /execution-truth/orders/:uuid        — Get single order by UUID
 * GET  /execution-truth/orders/:uuid/fills  — Get fills for an order
 * GET  /execution-truth/fills/today         — Today's fills from DB
 * GET  /execution-truth/metrics             — Execution quality metrics
 * GET  /execution-truth/slippage            — Slippage report
 * GET  /execution-truth/reconciliation      — Recent reconciliation events
 * POST /execution-truth/reconcile           — Trigger manual reconciliation
 */

import { Router, Request, Response } from "express";
import { requireOperator } from "../lib/auth_guard";
import { logger } from "../lib/logger";
import {
  findOrderByUuid,
  getFillsForOrder,
  getRecentOrders,
  getOpenOrders,
  getTodayFillsFromDb,
  getSlippageReport,
} from "../lib/execution_store";
import { runEodReconciliation } from "../lib/eod_reconciler";
import {
  getPersistentReconciliationSnapshot,
} from "../lib/persistent_fill_reconciler";
import { db, executionMetricsTable, reconciliationEventsTable } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";

export const executionTruthRouter = Router();

// ── Orders ──────────────────────────────────────────────────

executionTruthRouter.get("/orders", async (req: Request, res: Response) => {
  try {
    const symbol = typeof req.query.symbol === "string" ? req.query.symbol : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    let orders;
    if (status === "open") {
      orders = await getOpenOrders(symbol);
    } else if (symbol) {
      orders = await getRecentOrders(symbol, limit);
    } else {
      orders = await getOpenOrders();
    }

    res.json({ orders, count: orders.length });
  } catch (err) {
    logger.error({ err }, "Failed to list orders");
    res.status(500).json({ error: "internal_error", message: "Failed to list orders" });
  }
});

executionTruthRouter.get("/orders/:uuid", async (req: Request, res: Response) => {
  try {
    const uuid = (req.params.uuid as string) ?? "";
    const order = await findOrderByUuid(uuid);
    if (!order) {
      res.status(404).json({ error: "not_found", message: `Order ${uuid} not found` });
      return;
    }
    const fills = await getFillsForOrder(order.id);
    res.json({ order, fills });
  } catch (err) {
    logger.error({ err }, "Failed to get order");
    res.status(500).json({ error: "internal_error" });
  }
});

executionTruthRouter.get("/orders/:uuid/fills", async (req: Request, res: Response) => {
  try {
    const uuid = (req.params.uuid as string) ?? "";
    const order = await findOrderByUuid(uuid);
    if (!order) {
      res.status(404).json({ error: "not_found", message: `Order ${uuid} not found` });
      return;
    }
    const fills = await getFillsForOrder(order.id);
    res.json({ fills, count: fills.length });
  } catch (err) {
    logger.error({ err }, "Failed to get fills");
    res.status(500).json({ error: "internal_error" });
  }
});

// ── Fills ───────────────────────────────────────────────────

executionTruthRouter.get("/fills/today", async (_req: Request, res: Response) => {
  try {
    const fills = await getTodayFillsFromDb();
    const snapshot = getPersistentReconciliationSnapshot();
    res.json({
      fills,
      count: fills.length,
      realized_pnl_today: snapshot.realized_pnl_today,
      reconciler_running: snapshot.is_running,
    });
  } catch (err) {
    logger.error({ err }, "Failed to get today's fills");
    res.status(500).json({ error: "internal_error" });
  }
});

// ── Metrics ─────────────────────────────────────────────────

executionTruthRouter.get("/metrics", async (req: Request, res: Response) => {
  try {
    const symbol = typeof req.query.symbol === "string" ? req.query.symbol : undefined;
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    let query = db.select()
      .from(executionMetricsTable)
      .orderBy(desc(executionMetricsTable.created_at))
      .limit(limit);

    if (symbol) {
      const rows = await db.select()
        .from(executionMetricsTable)
        .where(eq(executionMetricsTable.symbol, symbol))
        .orderBy(desc(executionMetricsTable.created_at))
        .limit(limit);
      res.json({ metrics: rows, count: rows.length });
    } else {
      const rows = await query;
      res.json({ metrics: rows, count: rows.length });
    }
  } catch (err) {
    logger.error({ err }, "Failed to get execution metrics");
    res.status(500).json({ error: "internal_error" });
  }
});

// ── Slippage ────────────────────────────────────────────────

executionTruthRouter.get("/slippage", async (req: Request, res: Response) => {
  try {
    const symbol = typeof req.query.symbol === "string" ? req.query.symbol : undefined;
    const days = Number(req.query.days) || 30;
    const report = await getSlippageReport(symbol, days);
    res.json({ report, days });
  } catch (err) {
    logger.error({ err }, "Failed to get slippage report");
    res.status(500).json({ error: "internal_error" });
  }
});

// ── Reconciliation ──────────────────────────────────────────

executionTruthRouter.get("/reconciliation", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const events = await db.select()
      .from(reconciliationEventsTable)
      .orderBy(desc(reconciliationEventsTable.created_at))
      .limit(limit);
    res.json({ events, count: events.length });
  } catch (err) {
    logger.error({ err }, "Failed to get reconciliation events");
    res.status(500).json({ error: "internal_error" });
  }
});

executionTruthRouter.post("/reconcile", requireOperator, async (_req: Request, res: Response) => {
  try {
    const result = await runEodReconciliation();
    res.json({ reconciliation: result });
  } catch (err) {
    logger.error({ err }, "Manual reconciliation failed");
    res.status(500).json({ error: "reconciliation_failed" });
  }
});

export default executionTruthRouter;
