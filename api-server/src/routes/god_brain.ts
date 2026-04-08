/**
 * God Brain Routes — Phase 25
 *
 * Unified brain status and decision management for God Brain / Quanta Terminal
 * integration. Serves both the dashboard and full terminal UI.
 *
 * Routes:
 *   GET    /status                 — Brain health status (for god-brain.tsx)
 *   GET    /terminal               — Full terminal data (for quanta-terminal.tsx)
 *   GET    /decisions              — Decision queue (pending approvals)
 *   GET    /decisions/:id          — Single decision packet
 *   POST   /decisions              — Create decision packet
 *   GET    /packets                — Query decision packets (with filters)
 *   GET    /packets/:id            — Get specific packet
 *   POST   /packets/:id/replay     — Mark packet for replay analysis
 */

import { Router, Request, Response } from "express";
import { logger } from "../lib/logger";
import {
  createDecisionPacket,
  getPacket,
  getAllPackets,
  queryPackets,
  markForReplay,
} from "../lib/god_brain/decision_packet";
import { getBrainStatus, getDecisionQueue, getTerminalData } from "../lib/god_brain/brain_aggregator";

const godBrainRouter = Router();

// ── Status / Terminal Endpoints ──────────────────────────────────

/**
 * GET /api/god-brain/status
 * Returns brain health status for the god-brain.tsx dashboard
 */
godBrainRouter.get("/status", async (_req: Request, res: Response) => {
  try {
    const status = getBrainStatus();
    res.json(status);
  } catch (err) {
    logger.error({ err }, "Failed to get brain status");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

/**
 * GET /api/god-brain/terminal
 * Returns full terminal data for quanta-terminal.tsx
 * Includes brain status, decision queue, execution panel, portfolio, autonomy, and operations
 */
godBrainRouter.get("/terminal", async (_req: Request, res: Response) => {
  try {
    const terminal = getTerminalData();
    res.json(terminal);
  } catch (err) {
    logger.error({ err }, "Failed to get terminal data");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

// ── Decision Queue ───────────────────────────────────────────────

/**
 * GET /api/god-brain/decisions
 * Returns prioritized decision queue (pending approvals)
 */
godBrainRouter.get("/decisions", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const queue = getDecisionQueue(limit);
    res.json({ decisions: queue, count: queue.length });
  } catch (err) {
    logger.error({ err }, "Failed to get decision queue");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

/**
 * GET /api/god-brain/decisions/:id
 * Returns a single decision packet by ID
 */
godBrainRouter.get("/decisions/:id", async (req: Request, res: Response) => {
  try {
    const packet = getPacket(req.params.id);
    if (!packet) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(packet);
  } catch (err) {
    logger.error({ err }, "Failed to get decision packet");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

/**
 * POST /api/god-brain/decisions
 * Creates a new decision packet
 */
godBrainRouter.post("/decisions", async (req: Request, res: Response) => {
  try {
    const {
      strategy_id,
      symbol,
      action,
      market_regime,
      data_truth_score,
      signal_confidence,
      execution_truth_score,
      slippage_profile,
      certification_status,
      autonomy_eligible,
      portfolio_impact,
      final_action,
      reasoning,
      risk_level,
    } = req.body;

    if (
      !strategy_id ||
      !symbol ||
      !action ||
      !market_regime ||
      data_truth_score === undefined ||
      signal_confidence === undefined ||
      execution_truth_score === undefined
    ) {
      res.status(400).json({
        error: "validation_error",
        message: "Missing required fields: strategy_id, symbol, action, market_regime, data_truth_score, signal_confidence, execution_truth_score",
      });
      return;
    }

    const packet = createDecisionPacket({
      strategy_id,
      symbol,
      action,
      market_regime,
      data_truth_score,
      signal_confidence,
      execution_truth_score,
      slippage_profile,
      certification_status,
      autonomy_eligible,
      portfolio_impact,
      final_action,
      reasoning,
      risk_level,
    });

    res.status(201).json(packet);
  } catch (err) {
    logger.error({ err }, "Failed to create decision packet");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

// ── Packet Query & Replay ────────────────────────────────────────

/**
 * GET /api/god-brain/packets
 * Query decision packets with filters: strategy_id, symbol, action, certification_status, autonomy_eligible, risk_level, limit
 */
godBrainRouter.get("/packets", async (req: Request, res: Response) => {
  try {
    const filters = {
      strategy_id: req.query.strategy_id as string | undefined,
      symbol: req.query.symbol as string | undefined,
      action: req.query.action as any,
      certification_status: req.query.certification_status as any,
      autonomy_eligible:
        req.query.autonomy_eligible === "true"
          ? true
          : req.query.autonomy_eligible === "false"
            ? false
            : undefined,
      risk_level: req.query.risk_level as string | undefined,
      limit: Math.min(parseInt(req.query.limit as string) || 100, 1000),
    };

    const packets = queryPackets(filters);
    res.json({ packets, count: packets.length });
  } catch (err) {
    logger.error({ err }, "Failed to query packets");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

/**
 * GET /api/god-brain/packets/:id
 * Get a specific packet by ID
 */
godBrainRouter.get("/packets/:id", async (req: Request, res: Response) => {
  try {
    const packet = getPacket(req.params.id);
    if (!packet) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(packet);
  } catch (err) {
    logger.error({ err }, "Failed to get packet");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

/**
 * POST /api/god-brain/packets/:id/replay
 * Mark a packet for replay analysis
 */
godBrainRouter.post("/packets/:id/replay", async (req: Request, res: Response) => {
  try {
    const packet = markForReplay(req.params.id);
    if (!packet) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ marked_for_replay: true, packet });
  } catch (err) {
    logger.error({ err }, "Failed to mark packet for replay");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

export default godBrainRouter;
