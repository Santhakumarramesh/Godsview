/**
 * shadow_canary.ts — Shadow Mode & Canary Deployment Routes
 *
 * REST API endpoints for:
 *   - Shadow session lifecycle (create, query, complete)
 *   - Hypothetical order tracking
 *   - Canary deployment management
 *   - Auto-demotion rule checking
 */

import { Router, Request, Response } from "express";
import { requireOperator } from "../lib/auth_guard";
import { logger } from "../lib/logger";
import {
  createShadowSession,
  addHypotheticalOrder,
  recordMarketOutcome,
  completeShadowSession,
  getShadowSession,
  getShadowSessionsByStrategy,
  getActiveShadowSessions,
  getAllShadowSessions,
  type ShadowMode,
} from "../lib/shadow_canary/shadow_mode_manager";
import {
  createCanaryDeployment,
  activateCanary,
  checkDemotionRules,
  demoteCanary,
  graduateCanary,
  revokeCanary,
  getDeployment,
  getDeploymentsByStrategy,
  getActiveDeployments,
  getAllDeployments,
  updatePerformanceMetrics,
  type CanaryConfig,
} from "../lib/shadow_canary/canary_controller";

const shadowCanaryRouter = Router();

// ────────────────────────────────────────────────────────────────────────────
// SHADOW SESSION ENDPOINTS
// ────────────────────────────────────────────────────────────────────────────

/**
 * POST /shadow/sessions
 * Create a new shadow session.
 */
shadowCanaryRouter.post("/shadow/sessions", requireOperator, async (req: Request, res: Response) => {
  try {
    const { strategy_id, symbol, mode } = req.body;

    if (!strategy_id || !symbol) {
      res.status(400).json({ error: "validation_error", message: "Required: strategy_id, symbol" });
      return;
    }

    const result = createShadowSession({
      strategy_id,
      symbol,
      mode: mode ?? "shadow",
    });

    if (!result.success) {
      res.status(400).json({ error: "creation_failed", message: result.error });
      return;
    }

    res.status(201).json(result.data);
  } catch (err) {
    logger.error({ err }, "POST /shadow/sessions error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

/**
 * GET /shadow/sessions
 * List all shadow sessions (optionally filtered by strategy).
 */
shadowCanaryRouter.get("/shadow/sessions", async (req: Request, res: Response) => {
  try {
    const strategy_id = req.query.strategy_id as string | undefined;
    const status = req.query.status as string | undefined;

    let sessions = getAllShadowSessions();

    if (strategy_id) {
      sessions = sessions.filter((s) => s.strategy_id === strategy_id);
    }

    if (status) {
      sessions = sessions.filter((s) => s.status === status);
    }

    res.json({
      count: sessions.length,
      sessions,
    });
  } catch (err) {
    logger.error({ err }, "GET /shadow/sessions error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

/**
 * GET /shadow/sessions/:id
 * Get a specific shadow session.
 */
shadowCanaryRouter.get("/shadow/sessions/:id", async (req: Request, res: Response) => {
  try {
    const session = getShadowSession(req.params.id);

    if (!session) {
      res.status(404).json({ error: "not_found", message: "Session not found" });
      return;
    }

    res.json(session);
  } catch (err) {
    logger.error({ err }, "GET /shadow/sessions/:id error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

/**
 * POST /shadow/sessions/:id/orders
 * Add a hypothetical order to a shadow session.
 */
shadowCanaryRouter.post("/shadow/sessions/:id/orders", requireOperator, async (req: Request, res: Response) => {
  try {
    const session_id = req.params.id;
    const { side, quantity, price, timestamp, market_price_at_signal, market_price_after_1m, market_price_after_5m } = req.body;

    if (!side || !quantity || price === undefined || !timestamp) {
      res.status(400).json({
        error: "validation_error",
        message: "Required: side, quantity, price, timestamp",
      });
      return;
    }

    const result = addHypotheticalOrder(session_id, {
      side,
      quantity,
      price,
      timestamp,
      market_price_at_signal,
      market_price_after_1m: market_price_after_1m ?? null,
      market_price_after_5m: market_price_after_5m ?? null,
      would_have_profit: null,
    });

    if (!result.success) {
      res.status(400).json({ error: "order_failed", message: result.error });
      return;
    }

    res.status(201).json(result.data);
  } catch (err) {
    logger.error({ err }, "POST /shadow/sessions/:id/orders error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

/**
 * POST /shadow/sessions/:id/outcomes
 * Record a market outcome for a shadow session.
 */
shadowCanaryRouter.post("/shadow/sessions/:id/outcomes", requireOperator, async (req: Request, res: Response) => {
  try {
    const session_id = req.params.id;
    const { timestamp, price, volume } = req.body;

    if (!timestamp || price === undefined) {
      res.status(400).json({
        error: "validation_error",
        message: "Required: timestamp, price",
      });
      return;
    }

    const result = recordMarketOutcome(session_id, {
      timestamp,
      price,
      volume,
    });

    if (!result.success) {
      res.status(400).json({ error: "outcome_failed", message: result.error });
      return;
    }

    res.json({ success: true, message: "Outcome recorded" });
  } catch (err) {
    logger.error({ err }, "POST /shadow/sessions/:id/outcomes error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

/**
 * POST /shadow/sessions/:id/complete
 * Complete a shadow session.
 */
shadowCanaryRouter.post("/shadow/sessions/:id/complete", requireOperator, async (req: Request, res: Response) => {
  try {
    const session_id = req.params.id;
    const status = req.body.status ?? "completed";

    if (!["completed", "aborted"].includes(status)) {
      res.status(400).json({
        error: "validation_error",
        message: "Status must be 'completed' or 'aborted'",
      });
      return;
    }

    const result = completeShadowSession(session_id, status);

    if (!result.success) {
      res.status(400).json({ error: "completion_failed", message: result.error });
      return;
    }

    res.json(result.data);
  } catch (err) {
    logger.error({ err }, "POST /shadow/sessions/:id/complete error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// CANARY DEPLOYMENT ENDPOINTS
// ────────────────────────────────────────────────────────────────────────────

/**
 * POST /canary/deployments
 * Create a new canary deployment.
 */
shadowCanaryRouter.post("/canary/deployments", requireOperator, async (req: Request, res: Response) => {
  try {
    const { strategy_id, symbols_allowed, max_position_size, max_daily_trades, trust_tier_required, regime_allowed, auto_demotion_rules } = req.body;

    if (!strategy_id || !symbols_allowed || !max_position_size || !max_daily_trades || !trust_tier_required) {
      res.status(400).json({
        error: "validation_error",
        message: "Required: strategy_id, symbols_allowed, max_position_size, max_daily_trades, trust_tier_required",
      });
      return;
    }

    const config: CanaryConfig = {
      strategy_id,
      symbols_allowed,
      max_position_size,
      max_daily_trades,
      trust_tier_required,
      regime_allowed: regime_allowed ?? [],
      auto_demotion_rules: auto_demotion_rules ?? [],
    };

    const result = createCanaryDeployment(config);

    if (!result.success) {
      res.status(400).json({ error: "creation_failed", message: result.error });
      return;
    }

    res.status(201).json(result.data);
  } catch (err) {
    logger.error({ err }, "POST /canary/deployments error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

/**
 * GET /canary/deployments
 * List all canary deployments (optionally filtered by strategy or status).
 */
shadowCanaryRouter.get("/canary/deployments", async (req: Request, res: Response) => {
  try {
    const strategy_id = req.query.strategy_id as string | undefined;
    const status = req.query.status as string | undefined;

    let deployments = getAllDeployments();

    if (strategy_id) {
      deployments = deployments.filter((d) => d.strategy_id === strategy_id);
    }

    if (status) {
      deployments = deployments.filter((d) => d.status === status);
    }

    res.json({
      count: deployments.length,
      deployments,
    });
  } catch (err) {
    logger.error({ err }, "GET /canary/deployments error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

/**
 * GET /canary/deployments/:id
 * Get a specific canary deployment.
 */
shadowCanaryRouter.get("/canary/deployments/:id", async (req: Request, res: Response) => {
  try {
    const deployment = getDeployment(req.params.id);

    if (!deployment) {
      res.status(404).json({ error: "not_found", message: "Deployment not found" });
      return;
    }

    res.json(deployment);
  } catch (err) {
    logger.error({ err }, "GET /canary/deployments/:id error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

/**
 * POST /canary/deployments/:id/activate
 * Activate a pending canary deployment.
 */
shadowCanaryRouter.post("/canary/deployments/:id/activate", requireOperator, async (req: Request, res: Response) => {
  try {
    const result = activateCanary(req.params.id);

    if (!result.success) {
      res.status(400).json({ error: "activation_failed", message: result.error });
      return;
    }

    res.json(result.data);
  } catch (err) {
    logger.error({ err }, "POST /canary/deployments/:id/activate error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

/**
 * POST /canary/deployments/:id/demote
 * Demote an active canary deployment.
 */
shadowCanaryRouter.post("/canary/deployments/:id/demote", requireOperator, async (req: Request, res: Response) => {
  try {
    const { reason } = req.body;

    if (!reason) {
      res.status(400).json({
        error: "validation_error",
        message: "Required: reason",
      });
      return;
    }

    const result = demoteCanary(req.params.id, reason);

    if (!result.success) {
      res.status(400).json({ error: "demotion_failed", message: result.error });
      return;
    }

    res.json(result.data);
  } catch (err) {
    logger.error({ err }, "POST /canary/deployments/:id/demote error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

/**
 * POST /canary/deployments/:id/graduate
 * Graduate a canary to full production.
 */
shadowCanaryRouter.post("/canary/deployments/:id/graduate", requireOperator, async (req: Request, res: Response) => {
  try {
    const result = graduateCanary(req.params.id);

    if (!result.success) {
      res.status(400).json({ error: "graduation_failed", message: result.error });
      return;
    }

    res.json(result.data);
  } catch (err) {
    logger.error({ err }, "POST /canary/deployments/:id/graduate error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

/**
 * POST /canary/deployments/:id/revoke
 * Revoke a canary deployment.
 */
shadowCanaryRouter.post("/canary/deployments/:id/revoke", requireOperator, async (req: Request, res: Response) => {
  try {
    const { reason } = req.body;

    if (!reason) {
      res.status(400).json({
        error: "validation_error",
        message: "Required: reason",
      });
      return;
    }

    const result = revokeCanary(req.params.id, reason);

    if (!result.success) {
      res.status(400).json({ error: "revocation_failed", message: result.error });
      return;
    }

    res.json(result.data);
  } catch (err) {
    logger.error({ err }, "POST /canary/deployments/:id/revoke error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

/**
 * POST /canary/deployments/:id/check
 * Check demotion rules for a canary deployment.
 */
shadowCanaryRouter.post("/canary/deployments/:id/check", requireOperator, async (req: Request, res: Response) => {
  try {
    const result = checkDemotionRules(req.params.id);

    if (!result.success) {
      res.status(400).json({ error: "check_failed", message: result.error });
      return;
    }

    const { triggered_rules, should_demote, should_revoke } = result.data || {};

    res.json({
      deployment_id: req.params.id,
      triggered_rules,
      should_demote,
      should_revoke,
    });
  } catch (err) {
    logger.error({ err }, "POST /canary/deployments/:id/check error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

/**
 * GET /canary/active
 * List all active canary deployments.
 */
shadowCanaryRouter.get("/canary/active", async (req: Request, res: Response) => {
  try {
    const activeDeployments = getActiveDeployments();

    res.json({
      count: activeDeployments.length,
      deployments: activeDeployments,
    });
  } catch (err) {
    logger.error({ err }, "GET /canary/active error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

/**
 * POST /canary/deployments/:id/metrics
 * Update performance metrics for a canary deployment.
 */
shadowCanaryRouter.post("/canary/deployments/:id/metrics", requireOperator, async (req: Request, res: Response) => {
  try {
    const deployment_id = req.params.id;
    const metrics = req.body;

    const result = updatePerformanceMetrics(deployment_id, metrics);

    if (!result.success) {
      res.status(400).json({ error: "update_failed", message: result.error });
      return;
    }

    res.json(result.data);
  } catch (err) {
    logger.error({ err }, "POST /canary/deployments/:id/metrics error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// SUMMARY ENDPOINT
// ────────────────────────────────────────────────────────────────────────────

/**
 * GET /summary
 * Get overall shadow/canary summary.
 */
shadowCanaryRouter.get("/summary", async (req: Request, res: Response) => {
  try {
    const shadowSessions = getAllShadowSessions();
    const activeShadow = shadowSessions.filter((s) => s.status === "active");
    const completedShadow = shadowSessions.filter((s) => s.status === "completed");

    const canaryDeployments = getAllDeployments();
    const activeCanaries = getActiveDeployments();
    const demotedCanaries = canaryDeployments.filter((d) => d.status === "demoted");
    const graduatedCanaries = canaryDeployments.filter((d) => d.status === "graduated");
    const revokedCanaries = canaryDeployments.filter((d) => d.status === "revoked");

    res.json({
      shadow: {
        total_sessions: shadowSessions.length,
        active: activeShadow.length,
        completed: completedShadow.length,
        aborted: shadowSessions.filter((s) => s.status === "aborted").length,
      },
      canary: {
        total_deployments: canaryDeployments.length,
        pending: canaryDeployments.filter((d) => d.status === "pending").length,
        active: activeCanaries.length,
        demoted: demotedCanaries.length,
        graduated: graduatedCanaries.length,
        revoked: revokedCanaries.length,
      },
    });
  } catch (err) {
    logger.error({ err }, "GET /summary error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

export default shadowCanaryRouter;
