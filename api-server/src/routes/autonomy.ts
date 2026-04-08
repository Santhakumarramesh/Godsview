/**
 * Autonomy Routes — Phase 22
 *
 * Manages autonomous candidate lifecycle:
 *   POST   /candidates           — Register candidate
 *   GET    /candidates           — List candidates
 *   GET    /candidates/:id       — Get candidate details
 *   POST   /candidates/:id/approve    — Approve candidate
 *   POST   /candidates/:id/activate   — Activate candidate
 *   POST   /candidates/:id/suspend    — Suspend candidate
 *   POST   /candidates/:id/health     — Run health check
 *   POST   /revoke/:id           — Revoke candidate
 *   POST   /reinstate/:id        — Reinstate candidate
 *   GET    /revocations          — List revocations
 *   GET    /status               — Overall autonomy status
 *   GET    /policies             — List policies
 *   POST   /policies             — Add policy
 *   POST   /policies/:id/deactivate — Deactivate policy
 *   GET    /budget               — Budget status
 *   POST   /enable               — Enable global autonomy
 *   POST   /disable              — Disable global autonomy
 */

import { Router, Request, Response } from "express";
import { requireOperator } from "../lib/auth_guard";
import { logger } from "../lib/logger";
import {
  registerCandidate,
  approveCandidate,
  activateCandidate,
  suspendCandidate,
  revokeCandidate,
  reinstateCandidate,
  runHealthCheck,
  checkEligibility,
  getCandidate,
  getAllCandidates,
  getRevocations,
  getPolicies,
  addPolicy,
  deactivatePolicy,
  updateHealthScores,
} from "../lib/autonomy/autonomy_governor";

const autonomyRouter = Router();

// Global autonomy kill switch
let globalAutonomyEnabled = false;

// ── Candidates ───────────────────────────────────────────────────

autonomyRouter.post("/candidates", requireOperator, async (req: Request, res: Response) => {
  try {
    const { strategy_id, strategy_name, operator_id, ...rest } = req.body;
    if (!strategy_id || !strategy_name || !operator_id) {
      res.status(400).json({ error: "validation_error", message: "Required: strategy_id, strategy_name, operator_id" });
      return;
    }

    const result = registerCandidate({ strategy_id, strategy_name, operator_id, ...rest });
    if (!result.success) { res.status(409).json({ error: "registration_failed", message: result.error }); return; }

    res.status(201).json(result.candidate);
  } catch (err) {
    logger.error({ err }, "Register candidate error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

autonomyRouter.get("/candidates", async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const candidates = getAllCandidates(status as any);
    res.json({ candidates, count: candidates.length });
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

autonomyRouter.get("/candidates/:id", async (req: Request, res: Response) => {
  try {
    const candidate = getCandidate(req.params.id);
    if (!candidate) { res.status(404).json({ error: "not_found" }); return; }

    const eligibility = checkEligibility(req.params.id);
    const candidateRevocations = getRevocations(req.params.id);
    const candidatePolicies = getPolicies(req.params.id);

    res.json({ candidate, eligibility, revocations: candidateRevocations, policies: candidatePolicies });
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

autonomyRouter.post("/candidates/:id/approve", requireOperator, async (req: Request, res: Response) => {
  try {
    const approved_by = req.body.operator_id ?? "operator";
    const result = approveCandidate(req.params.id, approved_by);
    if (!result.success) { res.status(400).json({ error: "approve_failed", message: result.error }); return; }
    res.json({ approved: true, candidate: result.candidate });
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

autonomyRouter.post("/candidates/:id/activate", requireOperator, async (req: Request, res: Response) => {
  try {
    if (!globalAutonomyEnabled) {
      res.status(403).json({ error: "autonomy_disabled", message: "Global autonomy is disabled" });
      return;
    }
    const result = activateCandidate(req.params.id);
    if (!result.success) { res.status(400).json({ error: "activate_failed", message: result.error }); return; }
    res.json({ activated: true, candidate: result.candidate });
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

autonomyRouter.post("/candidates/:id/suspend", requireOperator, async (req: Request, res: Response) => {
  try {
    const reason = req.body.reason ?? "manual_suspend";
    const result = suspendCandidate(req.params.id, reason);
    if (!result.success) { res.status(400).json({ error: "suspend_failed", message: result.error }); return; }
    res.json({ suspended: true, candidate: result.candidate });
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

autonomyRouter.post("/candidates/:id/health", async (req: Request, res: Response) => {
  try {
    // Allow updating scores before check
    if (req.body.drift_score !== undefined || req.body.slippage_score !== undefined || req.body.data_health_score !== undefined) {
      updateHealthScores(req.params.id, req.body);
    }
    const result = runHealthCheck(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

// ── Revocation / Reinstatement ───────────────────────────────────

autonomyRouter.post("/revoke/:id", requireOperator, async (req: Request, res: Response) => {
  try {
    const { operator_id, trigger_type, severity, details } = req.body;
    const result = revokeCandidate(
      req.params.id,
      operator_id ?? "operator",
      trigger_type ?? "manual",
      severity ?? "critical",
      details ?? {}
    );
    if (!result.success) { res.status(400).json({ error: "revoke_failed", message: result.error }); return; }
    res.json({ revoked: true, revocation: result.revocation });
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

autonomyRouter.post("/reinstate/:id", requireOperator, async (req: Request, res: Response) => {
  try {
    const { operator_id, notes } = req.body;
    const result = reinstateCandidate(req.params.id, operator_id ?? "operator", notes ?? "");
    if (!result.success) { res.status(400).json({ error: "reinstate_failed", message: result.error }); return; }
    res.json({ reinstated: true, candidate: result.candidate });
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

autonomyRouter.get("/revocations", async (req: Request, res: Response) => {
  try {
    const candidate_id = req.query.candidate_id as string | undefined;
    const revs = getRevocations(candidate_id);
    res.json({ revocations: revs, count: revs.length });
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

// ── Policies ─────────────────────────────────────────────────────

autonomyRouter.get("/policies", async (req: Request, res: Response) => {
  try {
    const candidate_id = req.query.candidate_id as string | undefined;
    const pols = getPolicies(candidate_id);
    res.json({ policies: pols, count: pols.length });
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

autonomyRouter.post("/policies", requireOperator, async (req: Request, res: Response) => {
  try {
    const { candidate_id, policy_type, policy_value_json, reason, created_by, expires_at } = req.body;
    if (!candidate_id || !policy_type) {
      res.status(400).json({ error: "validation_error", message: "Required: candidate_id, policy_type" });
      return;
    }
    const policy = addPolicy({
      candidate_id,
      policy_type,
      policy_value_json: policy_value_json ?? {},
      reason: reason ?? "",
      created_by: created_by ?? "operator",
      expires_at: expires_at ? new Date(expires_at) : undefined,
    });
    res.status(201).json(policy);
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

autonomyRouter.post("/policies/:id/deactivate", requireOperator, async (req: Request, res: Response) => {
  try {
    const ok = deactivatePolicy(req.params.id);
    if (!ok) { res.status(404).json({ error: "not_found" }); return; }
    res.json({ deactivated: true });
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

// ── Status / Enable / Disable ────────────────────────────────────

autonomyRouter.get("/status", async (_req: Request, res: Response) => {
  try {
    const all = getAllCandidates();
    const active = all.filter((c) => c.status === "active");
    const suspended = all.filter((c) => c.status === "suspended");
    const revoked = all.filter((c) => c.status === "revoked");

    res.json({
      global_autonomy_enabled: globalAutonomyEnabled,
      total_candidates: all.length,
      active_count: active.length,
      suspended_count: suspended.length,
      revoked_count: revoked.length,
      total_revocations: getRevocations().length,
      active_policies: getPolicies().length,
    });
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

autonomyRouter.post("/enable", requireOperator, async (_req: Request, res: Response) => {
  globalAutonomyEnabled = true;
  logger.warn("Global autonomy ENABLED");
  res.json({ global_autonomy_enabled: true });
});

autonomyRouter.post("/disable", requireOperator, async (_req: Request, res: Response) => {
  globalAutonomyEnabled = false;
  logger.fatal("Global autonomy DISABLED");
  res.json({ global_autonomy_enabled: false });
});

autonomyRouter.get("/budget", async (_req: Request, res: Response) => {
  try {
    const active = getAllCandidates("active");
    const totalBudget = active.reduce((sum, c) => sum + c.max_daily_loss_usd, 0);
    const totalAllocated = active.reduce((sum, c) => sum + c.max_position_usd, 0);
    const totalPnl = active.reduce((sum, c) => sum + c.realized_pnl, 0);

    res.json({
      active_candidates: active.length,
      total_daily_loss_budget_usd: totalBudget,
      total_position_allocation_usd: totalAllocated,
      total_realized_pnl: totalPnl,
      candidates: active.map((c) => ({
        candidate_id: c.candidate_id,
        strategy_name: c.strategy_name,
        max_daily_loss_usd: c.max_daily_loss_usd,
        max_position_usd: c.max_position_usd,
        realized_pnl: c.realized_pnl,
        trades_executed: c.trades_executed,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

export default autonomyRouter;
