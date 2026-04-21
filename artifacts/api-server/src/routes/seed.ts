/**
 * seed.ts — Manual data seeder trigger
 *
 * POST /api/seed/run     — triggers historical seeder + brain seeder
 * POST /api/seed/force   — purges old data and re-seeds fresh
 * GET  /api/seed/status  — returns current DB row counts
 */

import { Router, type Request, type Response } from "express";
import { db, accuracyResultsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

// ── POST /api/seed/run — Run the full data seeder ────────────────────────────
router.post("/seed/run", async (_req: Request, res: Response) => {
  try {
    logger.info("[seed] Manual seeder triggered");

    const { seedHistoricalData } = await import("../lib/historical_seeder.js");
    const result = await seedHistoricalData();

    let brainResult: any = null;
    try {
      const { seedBrainEntities } = await import("../lib/brain_seeder.js");
      brainResult = await seedBrainEntities();
    } catch (err: any) {
      brainResult = { error: err?.message };
    }

    res.json({
      status: "ok",
      historical_seeder: result,
      brain_seeder: brainResult,
    });
  } catch (err: any) {
    logger.error({ err }, "[seed] Seeder failed");
    res.status(500).json({ error: "seeder_failed", message: err?.message });
  }
});

// ── POST /api/seed/force — Force re-seed even if threshold met ──────────────
router.post("/seed/force", async (_req: Request, res: Response) => {
  try {
    logger.info("[seed] Force re-seed: purging old data and re-seeding");

    await db.delete(accuracyResultsTable);

    const { seedHistoricalData } = await import("../lib/historical_seeder.js");
    const result = await seedHistoricalData();

    res.json({ status: "ok", purged: true, seeder: result });
  } catch (err: any) {
    logger.error({ err }, "[seed] Force seeder failed");
    res.status(500).json({ error: "force_seeder_failed", message: err?.message });
  }
});

// ── GET /api/seed/status — Check current DB population ──────────────────────
router.get("/seed/status", async (_req: Request, res: Response) => {
  try {
    const tables = [
      "accuracy_results", "signals", "trades", "sessions",
      "brain_entities", "brain_memories", "brain_relations",
    ];
    const counts: Record<string, number> = {};

    for (const table of tables) {
      try {
        const [row] = await db.execute(sql.raw(`SELECT count(*)::int as cnt FROM ${table}`));
        counts[table] = (row as any)?.cnt ?? 0;
      } catch {
        counts[table] = -1;
      }
    }

    const totalAccuracy = counts["accuracy_results"] ?? 0;
    const ready = totalAccuracy >= 50;

    res.json({
      status: "ok",
      ready,
      row_counts: counts,
      threshold: { min_for_backtest: 50, target: 800 },
    });
  } catch (err: any) {
    res.status(500).json({ error: "status_check_failed", message: err?.message });
  }
});

export default router;
