import { Router, type IRouter } from "express";
import {
  processSuperSignal,
  getSuperIntelligenceStatus,
  trainEnsemble,
  type SuperIntelligenceInput,
} from "../lib/super_intelligence";
import { evaluateForProduction, getProductionGateStats } from "../lib/production_gate";
import { addSSEClient, getSSEClientCount } from "../lib/signal_stream";

const router: IRouter = Router();

// ── GET /super-intelligence/status ──────────────────────────────────────────
// Dashboard diagnostics: ensemble accuracy, GBM vs LR, sample count
router.get("/super-intelligence/status", async (_req, res) => {
  try {
    const status = getSuperIntelligenceStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: "Failed to get SI status" });
  }
});

// ── POST /super-intelligence/signal ─────────────────────────────────────────
// Process a signal through the full Super Intelligence pipeline.
// Returns enhanced quality, Kelly sizing, trailing stop, profit targets.
router.post("/super-intelligence/signal", async (req, res): Promise<void> => {
  try {
    const input: SuperIntelligenceInput = req.body;

    // Validate required fields
    if (!input.structure_score && input.structure_score !== 0) {
      res.status(400).json({ error: "validation_error", message: "structure_score is required" });
      return;
    }
    if (!input.entry_price || !input.stop_loss || !input.take_profit) {
      res.status(400).json({ error: "validation_error", message: "entry_price, stop_loss, take_profit are required" });
      return;
    }

    const symbol = (req.body as any).symbol || "UNKNOWN";
    const result = await processSuperSignal(0, symbol, input);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Super Intelligence signal processing failed");
    res.status(500).json({ error: "internal_error", message: "Signal processing failed" });
  }
});

// ── POST /super-intelligence/retrain ────────────────────────────────────────
// Retrain the ensemble model with latest data
router.post("/super-intelligence/retrain", async (_req, res) => {
  try {
    await trainEnsemble();
    const status = getSuperIntelligenceStatus();
    res.json({
      success: status.status === "active",
      message: status.message,
      ensemble: status.ensemble,
    });
  } catch (err) {
    res.status(500).json({ error: "retrain_failed", message: String(err) });
  }
});

// ── GET /super-intelligence/edge-analysis ───────────────────────────────────
// Quick edge analysis: compute win prob + Kelly for a given setup/regime combo
router.get("/super-intelligence/edge-analysis", async (req, res) => {
  try {
    const {
      setup_type = "absorption_reversal",
      regime = "ranging",
      direction = "long",
      structure = "0.7",
      order_flow = "0.7",
      recall = "0.6",
    } = req.query as Record<string, string>;

    const result = await processSuperSignal(0, (req.query.symbol as string) || "UNKNOWN", {
      structure_score: parseFloat(structure),
      order_flow_score: parseFloat(order_flow),
      recall_score: parseFloat(recall),
      setup_type,
      regime,
      direction: direction as "long" | "short",
      entry_price: 100,
      stop_loss: direction === "long" ? 98 : 102,
      take_profit: direction === "long" ? 106 : 94,
      atr: 1.5,
      equity: 10000,
    });

    res.json({
      setup_type,
      regime,
      direction,
      win_probability: result.win_probability,
      enhanced_quality: result.enhanced_quality,
      kelly_fraction: result.kelly_fraction,
      edge_score: result.edge_score,
      approved: result.approved,
      rejection_reason: result.rejection_reason,
      trailing_stop: result.trailing_stop,
      profit_targets: result.profit_targets,
    });
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: "Edge analysis failed" });
  }
});

// ── POST /super-intelligence/production-gate ────────────────────────────────
// Full production evaluation: SI + risk engine + session + cooldown + spread
router.post("/super-intelligence/production-gate", async (req, res): Promise<void> => {
  try {
    const input = req.body;
    if (!input.entry_price || !input.stop_loss || !input.symbol) {
      res.status(400).json({
        error: "validation_error",
        message: "entry_price, stop_loss, take_profit, and symbol are required",
      });
      return;
    }
    const decision = await evaluateForProduction(input);
    res.json(decision);
  } catch (err) {
    req.log.error({ err }, "Production gate evaluation failed");
    res.status(500).json({ error: "internal_error", message: "Production gate failed" });
  }
});

// ── GET /super-intelligence/stream ──────────────────────────────────────────
// SSE endpoint for real-time SI decision streaming
router.get("/super-intelligence/stream", (req, res) => {
  addSSEClient(res);
  req.on("close", () => { /* cleanup handled in addSSEClient */ });
});

// ── GET /super-intelligence/stream/clients ──────────────────────────────────
router.get("/super-intelligence/stream/clients", (_req, res) => {
  res.json({ connected_clients: getSSEClientCount() });
});

// ── GET /super-intelligence/production-stats ────────────────────────────────
// Dashboard: daily trade count, cooldowns, thresholds
router.get("/super-intelligence/production-stats", async (_req, res) => {
  try {
    res.json(getProductionGateStats());
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: "Failed to get production stats" });
  }
});

export default router;
