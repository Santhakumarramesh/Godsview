/**
 * routes/strategy_params.ts — Phase 11B
 *
 * CRUD API for per-strategy parameter overrides.
 * All routes are under /brain/strategy/params.
 */

import { Router } from "express";
import { strategyParamsStore } from "../lib/strategy_params_store.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ── GET /brain/strategy/params ─────────────────────────────────────────────
// List all active overrides + full snapshot
router.get("/brain/strategy/params", (_req, res) => {
  res.json(strategyParamsStore.snapshot());
});

// ── GET /brain/strategy/params/:strategyId ─────────────────────────────────
router.get("/brain/strategy/params/:strategyId", (req, res) => {
  const { strategyId } = req.params;
  const override = strategyParamsStore.get(strategyId);
  if (!override) {
    return res.json({
      strategyId,
      override: null,
      message: "No override set — using system defaults",
    });
  }
  return res.json({ strategyId, override });
});

// ── PUT /brain/strategy/params/:strategyId ─────────────────────────────────
// Body: Partial<StrategyParamOverride> (any subset of fields)
router.put("/brain/strategy/params/:strategyId", (req, res) => {
  const { strategyId } = req.params;
  const patch = req.body as Record<string, unknown>;

  // Validate numeric fields
  const numericFields = ["minScore", "minWinProb", "maxKellyFraction", "atrMultiplierSL", "atrMultiplierTP"] as const;
  for (const field of numericFields) {
    if (patch[field] !== undefined) {
      const val = Number(patch[field]);
      if (isNaN(val)) {
        return res.status(400).json({ error: `${field} must be a number` });
      }
      // Validate 0–1 range for fraction fields
      if (["minScore", "minWinProb", "maxKellyFraction"].includes(field) && (val < 0 || val > 1)) {
        return res.status(400).json({ error: `${field} must be between 0 and 1` });
      }
    }
  }

  const updated = strategyParamsStore.set(strategyId, {
    minScore: patch.minScore !== undefined ? Number(patch.minScore) : undefined,
    minWinProb: patch.minWinProb !== undefined ? Number(patch.minWinProb) : undefined,
    maxKellyFraction: patch.maxKellyFraction !== undefined ? Number(patch.maxKellyFraction) : undefined,
    atrMultiplierSL: patch.atrMultiplierSL !== undefined ? Number(patch.atrMultiplierSL) : undefined,
    atrMultiplierTP: patch.atrMultiplierTP !== undefined ? Number(patch.atrMultiplierTP) : undefined,
    enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : undefined,
    blacklistedRegimes: Array.isArray(patch.blacklistedRegimes) ? patch.blacklistedRegimes as string[] : undefined,
    note: typeof patch.note === "string" ? patch.note : undefined,
  });

  logger.info({ strategyId, updated }, "Strategy param override updated via API");
  return res.json({ strategyId, override: updated, saved: true });
});

// ── DELETE /brain/strategy/params/:strategyId ──────────────────────────────
// Reset a single strategy to defaults
router.delete("/brain/strategy/params/:strategyId", (req, res) => {
  const { strategyId } = req.params;
  const wasReset = strategyParamsStore.reset(strategyId);
  return res.json({ strategyId, reset: true, hadOverride: wasReset });
});

// ── DELETE /brain/strategy/params ─────────────────────────────────────────
// Reset ALL strategy overrides
router.delete("/brain/strategy/params", (_req, res) => {
  strategyParamsStore.resetAll();
  return res.json({ reset: true, message: "All strategy overrides cleared — using system defaults" });
});

export default router;
