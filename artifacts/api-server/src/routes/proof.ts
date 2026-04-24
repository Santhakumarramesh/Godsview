/**
 * proof.ts — Proof/Drift dashboard routes
 *
 * GET /proof/dashboard?days=30 — Full proof dashboard
 * GET /proof/by-setup/:setupType?days=30 — Setup-specific proof
 * GET /proof/drift?days=30 — All drift reports
 * GET /proof/by-regime/:regime?days=30 — Regime-specific stats
 */

import { Router, Request, Response } from "express";
import { logger } from "../lib/logger";
import {
  generateProofDashboard,
  getSetupProof,
  getRegimeProof,
  getDriftReports,
  clearProofCache,
  getProofCacheStats,
} from "../lib/proof_engine";

const router = Router();

// ── Helper: Parse days query param ─────────────────────────────────────────────

function parseDaysParam(query: string | undefined, defaultDays: number = 30): number {
  if (!query) return defaultDays;

  const parsed = parseInt(query, 10);
  if (isNaN(parsed) || parsed < 1 || parsed > 365) {
    return defaultDays;
  }

  return parsed;
}

// ── GET /proof/dashboard – Full dashboard ──────────────────────────────────────

router.get(
  "/dashboard",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const days = parseDaysParam(req.query.days as string | undefined);
      logger.info(`[Proof Routes] Generating dashboard for ${days} days`);

      const dashboard = await generateProofDashboard(days);

      res.status(200).json(dashboard);
    } catch (error) {
      logger.error(`[Proof Dashboard] ${error instanceof Error ? error.message : "unknown"}`);
      res.status(503).json({
        error: "Dashboard generation failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

// ── GET /proof/by-setup/:setupType – Setup-specific proof ───────────────────────

router.get(
  "/by-setup/:setupType",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { setupType } = req.params;
      const days = parseDaysParam(req.query.days as string | undefined);

      if (!setupType || typeof setupType !== "string") {
        res.status(400).json({ error: "Missing or invalid setupType" });
        return;
      }

      logger.info(`[Proof Routes] Getting proof for setup: ${setupType}, days: ${days}`);

      const proof = await getSetupProof(setupType, days);

      if (!proof) {
        res.status(404).json({
          error: "No proof available for this setup type",
          setupType,
          days,
        });
        return;
      }

      res.status(200).json(proof);
    } catch (error) {
      logger.error(`[Proof By Setup] ${error instanceof Error ? error.message : "unknown"}`);
      res.status(503).json({
        error: "Setup proof retrieval failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

// ── GET /proof/drift – All drift reports ───────────────────────────────────────

router.get(
  "/drift",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const days = parseDaysParam(req.query.days as string | undefined);
      logger.info(`[Proof Routes] Getting drift reports for ${days} days`);

      const driftReports = await getDriftReports(days);

      res.status(200).json({
        count: driftReports.length,
        drift_reports: driftReports,
      });
    } catch (error) {
      logger.error(`[Proof Drift] ${error instanceof Error ? error.message : "unknown"}`);
      res.status(503).json({
        error: "Drift reports retrieval failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

// ── GET /proof/by-regime/:regime – Regime-specific stats ───────────────────────

router.get(
  "/by-regime/:regime",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { regime } = req.params;
      const days = parseDaysParam(req.query.days as string | undefined);

      if (!regime || typeof regime !== "string") {
        res.status(400).json({ error: "Missing or invalid regime" });
        return;
      }

      logger.info(`[Proof Routes] Getting proof for regime: ${regime}, days: ${days}`);

      const regimeProof = await getRegimeProof(regime, days);

      if (!regimeProof) {
        res.status(404).json({
          error: "No proof available for this regime",
          regime,
          days,
        });
        return;
      }

      res.status(200).json({
        regime,
        stats: regimeProof,
      });
    } catch (error) {
      logger.error(`[Proof By Regime] ${error instanceof Error ? error.message : "unknown"}`);
      res.status(503).json({
        error: "Regime proof retrieval failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

// ── GET /proof/cache/stats – Cache diagnostics ─────────────────────────────────

router.get(
  "/cache/stats",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const stats = getProofCacheStats();
      res.status(200).json(stats);
    } catch (error) {
      logger.error(`[Proof Cache Stats] ${error instanceof Error ? error.message : "unknown"}`);
      res.status(503).json({
        error: "Cache stats retrieval failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

// ── POST /proof/cache/clear – Clear cache ──────────────────────────────────────

router.post(
  "/cache/clear",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { days } = req.body;

      if (days !== undefined && typeof days === "number") {
        clearProofCache(days);
        res.status(200).json({ message: `Cache cleared for ${days}-day dashboard` });
      } else {
        clearProofCache();
        res.status(200).json({ message: "Cache cleared (all dashboards)" });
      }
    } catch (error) {
      logger.error(`[Proof Cache Clear] ${error instanceof Error ? error.message : "unknown"}`);
      res.status(503).json({
        error: "Cache clear failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

export default router;
