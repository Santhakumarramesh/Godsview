/**
 * seed.ts — Manual data seeder trigger
 *
 * POST /api/seed/run     — triggers historical seeder + brain seeder
 * GET  /api/seed/status   — returns current DB row counts
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

    // Force re-seed by temporarily lowering threshold check
    const { seedHistoricalData } = await import("../lib/historical_seeder.js");
    const result = await seedHistoricalData();

    // Also seed brain entities
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

    // Delete all existing accuracy_results
    await db.delete(accuracyResultsTable);

    // Now run seeder (will find 0 rows and seed fresh)
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
        const result = await db.execute(sql.raw(`SELECT count(*)::int as cnt FROM ${table}`));
        const rows = (result as any)?.rows ?? result;
        const row = Array.isArray(rows) ? rows[0] : rows;
        counts[table] = Number(row?.cnt ?? row?.count ?? 0);
      } catch {
        counts[table] = -1; // table doesn't exist
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
