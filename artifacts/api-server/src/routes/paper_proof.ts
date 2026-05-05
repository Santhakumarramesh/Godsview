/**
 * Phase 4 — Paper trading proof endpoints.
 *
 * Read-only HTTP surface that exposes:
 *   GET  /api/proof/trades             → executed trades (newest first)
 *   GET  /api/proof/trades?status=rejected  → rejected (from execution_audit)
 *   GET  /api/proof/metrics            → computed metrics over executed trades
 *   GET  /api/proof/equity             → equity curve (one point per closed trade)
 *   GET  /api/proof/trades.csv         → CSV download of executed trades
 *
 * All numbers are computed from real trade rows; nothing is interpolated,
 * smoothed, or hardcoded. If there is no data, fields return null/0/empty
 * rather than fabricated values.
 */
import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import {
  listExecutedTrades,
  listRejectedTrades,
  rejectedCount,
} from "../lib/paper_trades/store";
import { computeMetrics } from "../lib/paper_trades/metrics";
import { buildEquityCurve } from "../lib/paper_trades/equity";
import { tradesToCsv } from "../lib/paper_trades/csv";
// Phase 5: integrity + reconciliation
import { checkTradeIntegrity } from "../lib/paper_trades/integrity";
import { reconcileOrphans } from "../lib/paper_trades/reconciler";
import { snapshotJobsStatus } from "../lib/paper_trades/jobs";
import { proofLog, reconLog } from "../lib/log_channels";

const router = Router();

const STARTING_EQUITY = Number(process.env.GODSVIEW_PAPER_STARTING_EQUITY ?? 10_000);

function parseLimit(q: unknown, def = 200, max = 5000): number {
  const n = Number(q);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
}

// ── GET /api/proof/trades ──────────────────────────────────────────────────
router.get("/proof/trades", async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = parseLimit(req.query.limit, 200);
    const status = String(req.query.status ?? "executed").toLowerCase();
    if (status === "rejected") {
      const rejected = listRejectedTrades(limit);
      res.json({ kind: "rejected", count: rejected.length, trades: rejected });
      return;
    }
    const trades = await listExecutedTrades(limit);
    res.json({
      kind: "executed",
      count: trades.length,
      open_count: trades.filter((t) => t.status !== "closed").length,
      closed_count: trades.filter((t) => t.status === "closed").length,
      trades,
    });
  } catch (err) {
    logger.error({ err }, "[proof/trades] failed");
    res.status(503).json({ error: "trades_unavailable", message: String(err) });
  }
});

// ── GET /api/proof/metrics ─────────────────────────────────────────────────
router.get("/proof/metrics", async (_req: Request, res: Response): Promise<void> => {
  try {
    const trades = await listExecutedTrades(5_000);
    const rejected = rejectedCount();
    const curve = buildEquityCurve(trades, STARTING_EQUITY);
    const metrics = computeMetrics({
      trades,
      rejectedCount: rejected,
      startingEquity: STARTING_EQUITY,
      equityCurve: curve,
    });
    res.json({
      starting_equity: STARTING_EQUITY,
      metrics,
    });
  } catch (err) {
    logger.error({ err }, "[proof/metrics] failed");
    res.status(503).json({ error: "metrics_unavailable", message: String(err) });
  }
});

// ── GET /api/proof/equity ──────────────────────────────────────────────────
router.get("/proof/equity", async (_req: Request, res: Response): Promise<void> => {
  try {
    const trades = await listExecutedTrades(5_000);
    const curve = buildEquityCurve(trades, STARTING_EQUITY);
    res.json(curve);
  } catch (err) {
    logger.error({ err }, "[proof/equity] failed");
    res.status(503).json({ error: "equity_unavailable", message: String(err) });
  }
});

// ── GET /api/proof/trades.csv ──────────────────────────────────────────────
router.get("/proof/trades.csv", async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = parseLimit(req.query.limit, 5_000, 50_000);
    const trades = await listExecutedTrades(limit);
    const csv = tradesToCsv(trades);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="paper_trades_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (err) {
    logger.error({ err }, "[proof/trades.csv] failed");
    res.status(503).type("text/plain").send(`csv_export_failed: ${String(err)}`);
  }
});


// ── Phase 5: GET /api/proof/integrity — data-correctness violations ────────
router.get("/proof/integrity", async (_req: Request, res: Response): Promise<void> => {
  try {
    const trades = await listExecutedTrades(5_000);
    const report = checkTradeIntegrity(trades);
    proofLog.info({ total_violations: report.total_violations }, "[proof/integrity] computed");
    res.json(report);
  } catch (err) {
    proofLog.error({ err }, "[proof/integrity] failed");
    res.status(503).json({ error: "integrity_unavailable", message: String(err) });
  }
});

// ── Phase 5: GET /api/proof/reconciliation/status — last-run summary ───────
router.get("/proof/reconciliation/status", async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json(snapshotJobsStatus());
  } catch (err) {
    reconLog.error({ err }, "[proof/reconciliation/status] failed");
    res.status(503).json({ error: "reconciliation_status_unavailable", message: String(err) });
  }
});

// ── Phase 5: POST /api/proof/reconciliation/run — manual trigger ───────────
router.post("/proof/reconciliation/run", async (_req: Request, res: Response): Promise<void> => {
  try {
    reconLog.info("[proof/reconciliation/run] manual trigger");
    const result = await reconcileOrphans();
    res.json(result);
  } catch (err) {
    reconLog.error({ err }, "[proof/reconciliation/run] failed");
    res.status(503).json({ error: "reconciliation_run_failed", message: String(err) });
  }
});

export default router;
