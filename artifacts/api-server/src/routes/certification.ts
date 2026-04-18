/**
 * Strategy Certification Routes
 *
 * POST  /certification/:strategyId/initiate    — Start certification process
 * POST  /certification/:strategyId/evaluate    — Evaluate all gates and complete
 * GET   /certification/:strategyId/history     — Certification history
 * GET   /certification/:strategyId/active      — Current valid certification
 * GET   /certification/pending                 — Pending certifications for review
 */

import { Router, Request, Response } from "express";
import { requireOperator } from "../lib/auth_guard";
import { logger } from "../lib/logger";
import { paramString, paramInt } from "../lib/utils/params";
import {
  initiateCertification,
  completeCertification,
  buildEvidencePacket,
  getCertificationHistory,
  getActiveCertification,
  getPendingCertifications,
  TIER_REQUIREMENTS,
  type TargetTier,
} from "../lib/certification_engine";

export const certificationRouter = Router();

// ── Initiate Certification ─────────────────────────────────────

certificationRouter.post("/:strategyId/initiate", async (req: Request, res: Response) => {
  try {
    const strategyId = paramString(req.params.strategyId);
    const { target_tier, current_tier } = req.body ?? {};

    if (!target_tier || !TIER_REQUIREMENTS[target_tier as TargetTier]) {
      res.status(400).json({
        error: "invalid_tier",
        message: "Provide target_tier: paper_approved | live_assisted | autonomous_candidate",
      });
      return;
    }

    const id = await initiateCertification(strategyId, target_tier as TargetTier, current_tier);
    if (id) {
      res.json({ certification_id: id, strategy_id: strategyId, target_tier, status: "initiated" });
    } else {
      res.status(500).json({ error: "initiation_failed" });
    }
  } catch (err) {
    logger.error({ err }, "Failed to initiate certification");
    res.status(500).json({ error: "internal_error" });
  }
});

// ── Evaluate and Complete ──────────────────────────────────────

certificationRouter.post("/:strategyId/evaluate", async (req: Request, res: Response) => {
  try {
    const strategyId = paramString(req.params.strategyId);
    const {
      certification_id,
      target_tier,
      evidence,
      approved_by,
    } = req.body ?? {};

    if (!certification_id || !target_tier || !evidence) {
      res.status(400).json({
        error: "missing_fields",
        message: "Provide certification_id, target_tier, and evidence object",
      });
      return;
    }

    // Build evidence packet
    const packet = buildEvidencePacket(strategyId, target_tier as TargetTier, {
      backtest_sharpe: Number(evidence.backtest_sharpe) || 0,
      backtest_win_rate: Number(evidence.backtest_win_rate) || 0,
      backtest_trade_count: Number(evidence.backtest_trade_count) || 0,
      walkforward_pass_rate: Number(evidence.walkforward_pass_rate) || 0,
      stress_survival_rate: Number(evidence.stress_survival_rate) || 0,
      paper_trade_count: Number(evidence.paper_trade_count) || 0,
      paper_win_rate: Number(evidence.paper_win_rate) || 0,
      paper_pnl: Number(evidence.paper_pnl) || 0,
      alignment_score: Number(evidence.alignment_score) || 0,
      avg_slippage_bps: Number(evidence.avg_slippage_bps) || 0,
      avg_latency_ms: Number(evidence.avg_latency_ms) || 0,
      fill_rate: Number(evidence.fill_rate) || 1.0,
      live_sharpe: Number(evidence.live_sharpe) || undefined,
      live_win_rate: Number(evidence.live_win_rate) || undefined,
    });

    // Complete certification
    const success = await completeCertification(
      Number(certification_id),
      packet,
      approved_by,
    );

    if (success) {
      res.json({
        certification_id,
        strategy_id: strategyId,
        result: packet.all_gates_passed ? "certified" : "rejected",
        packet,
      });
    } else {
      res.status(500).json({ error: "completion_failed" });
    }
  } catch (err) {
    logger.error({ err }, "Certification evaluation failed");
    res.status(500).json({ error: "internal_error" });
  }
});

// ── Certification History ──────────────────────────────────────

certificationRouter.get("/:strategyId/history", async (req: Request, res: Response) => {
  try {
    const strategyId = paramString(req.params.strategyId);
    const limit = paramInt(req.query.limit, 20, 1, 100);
    const history = await getCertificationHistory(strategyId, limit);
    res.json({ certifications: history, count: history.length });
  } catch (err) {
    logger.error({ err }, "Failed to get certification history");
    res.status(500).json({ error: "internal_error" });
  }
});

// ── Active Certification ───────────────────────────────────────

certificationRouter.get("/:strategyId/active", async (req: Request, res: Response) => {
  try {
    const strategyId = paramString(req.params.strategyId);
    const cert = await getActiveCertification(strategyId);
    res.json({ certification: cert });
  } catch (err) {
    logger.error({ err }, "Failed to get active certification");
    res.status(500).json({ error: "internal_error" });
  }
});

// ── Pending Certifications ─────────────────────────────────────

certificationRouter.get("/pending", async (_req: Request, res: Response) => {
  try {
    const pending = await getPendingCertifications();
    res.json({ certifications: pending, count: pending.length });
  } catch (err) {
    logger.error({ err }, "Failed to get pending certifications");
    res.status(500).json({ error: "internal_error" });
  }
});

// ── Tier Requirements Reference ────────────────────────────────

certificationRouter.get("/requirements", async (_req: Request, res: Response) => {
  res.json({ requirements: TIER_REQUIREMENTS });
});

export default certificationRouter;
