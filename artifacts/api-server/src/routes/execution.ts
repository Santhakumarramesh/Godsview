/**
 * Execution Routes — Production trading pipeline API.
 *
 * POST /execute          — Full pipeline: production gate → executor → position monitor
 * POST /kill-switch      — Activate/deactivate kill switch
 * POST /emergency-close  — Emergency liquidation (close all positions)
 * GET  /execution-status — Execution mode, breaker state, reconciliation, positions
 * GET  /fills            — Today's reconciled fills
 * GET  /breaker          — Drawdown circuit breaker state
 */

import { Router, Request, Response } from "express";
import { requireOperator } from "../lib/auth_guard";
import { logger } from "../lib/logger";
import { evaluateForProduction, getProductionGateStats } from "../lib/production_gate";
import { executeOrder, getExecutionMode } from "../lib/order_executor";
import { registerPosition, getManagedPositions, getMonitorEvents } from "../lib/position_monitor";
import { registerCostBasis, getReconciliationSnapshot, getRecentFills } from "../lib/fill_reconciler";
import { getBreakerSnapshot, isCooldownActive, getPositionSizeMultiplier, resetBreaker } from "../lib/drawdown_breaker";
import { setKillSwitchActive, isKillSwitchActive, getRiskEngineSnapshot } from "../lib/risk_engine";
import { emergencyLiquidateAll, getLastLiquidation, isLiquidationInProgress } from "../lib/emergency_liquidator";
import { evaluateExecutionRisk, evaluatePortfolioRisk, triggerEmergencyStopAll } from "../lib/portfolio_risk_guard";
import { computeATR } from "../lib/strategy_engine";
import { getBars } from "../lib/alpaca";

export const executionRouter = Router();

// ── POST /execute — Full production pipeline ──────────

executionRouter.post("/execute", requireOperator, async (req: Request, res: Response) => {
  try {
    const {
      symbol, direction, setup_type, regime,
      entry_price, stop_loss, take_profit,
      bars_1h, bars_5m,
      spread, volume,
      operator_token,
    } = req.body;

    if (!symbol || !direction || !entry_price || !stop_loss || !take_profit) {
      res.status(400).json({
        error: "validation_error",
        message: "Required: symbol, direction, entry_price, stop_loss, take_profit",
      });
      return;
    }

    // Check breaker state first
    if (isCooldownActive()) {
      res.status(429).json({
        error: "cooldown_active",
        message: "Trading paused: consecutive loss cooldown active",
        breaker: getBreakerSnapshot(),
      });
      return;
    }

    const sizeMultiplier = getPositionSizeMultiplier();
    if (sizeMultiplier <= 0) {
      res.status(429).json({
        error: "breaker_halt",
        message: "Trading halted by drawdown circuit breaker",
        breaker: getBreakerSnapshot(),
      });
      return;
    }

    // Phase 16: Portfolio risk hardening gate (drawdown / VaR / correlation)
    const portfolioRiskGate = await evaluateExecutionRisk(symbol);
    if (!portfolioRiskGate.allowed) {
      const status = portfolioRiskGate.action === "HALT" ? 423 : 429;
      res.status(status).json({
        error: "portfolio_risk_blocked",
        message: `Execution blocked by portfolio risk guard (${portfolioRiskGate.action})`,
        action: portfolioRiskGate.action,
        reasons: portfolioRiskGate.reasons,
        portfolio_risk: portfolioRiskGate.snapshot,
      });
      return;
    }

    // Compute ATR from bars if available
    let atrValue = 0;
    try {
      const atrBars = bars_1h?.length > 0 ? bars_1h : await getBars(symbol, "1Hour", 20);
      atrValue = computeATR(atrBars);
    } catch { atrValue = Math.abs(Number(entry_price) - Number(stop_loss)); }

    // Build SI input with required fields (scores default to 0 — production gate runs full pipeline)
    const siInput = {
      symbol,
      direction: direction as "long" | "short",
      setup_type: setup_type ?? "auto",
      regime: regime ?? "normal",
      entry_price: Number(entry_price),
      stop_loss: Number(stop_loss),
      take_profit: Number(take_profit),
      structure_score: Number(req.body.structure_score ?? 0),
      order_flow_score: Number(req.body.order_flow_score ?? 0),
      recall_score: Number(req.body.recall_score ?? 0),
      atr: atrValue,
      equity: Number(req.body.equity ?? 10000),
      spread: spread ? Number(spread) : undefined,
      volume: volume ? Number(volume) : undefined,
    };

    // 1. Production gate evaluation
    const decision = await evaluateForProduction(siInput);

    if (decision.action !== "EXECUTE") {
      res.json({
        executed: false,
        gate_action: decision.action,
        block_reasons: decision.block_reasons,
        signal: {
          approved: decision.signal.approved,
          win_probability: decision.signal.win_probability,
          edge_score: decision.signal.edge_score,
          enhanced_quality: decision.signal.enhanced_quality,
          kelly_pct: decision.signal.kelly_fraction,
          rejection_reason: decision.signal.rejection_reason,
        },
        meta: decision.meta,
        portfolio_risk: portfolioRiskGate.snapshot,
      });
      return;
    }

    // Apply throttle multiplier from breaker + portfolio risk guard
    const adjustedQty = Math.max(
      1,
      Math.round(decision.quantity * sizeMultiplier * portfolioRiskGate.size_multiplier),
    );

    // 2. Execute order
    const executionResult = await executeOrder({
      symbol,
      side: direction === "long" ? "buy" : "sell",
      quantity: adjustedQty,
      direction,
      setup_type: setup_type ?? "auto",
      regime: regime ?? "normal",
      entry_price: Number(entry_price),
      stop_loss: Number(stop_loss),
      take_profit: Number(take_profit),
      decision,
      operator_token,
    });

    // 3. If executed, register with position monitor + fill reconciler
    if (executionResult.executed && decision.signal.trailing_stop && decision.signal.profit_targets) {
      // Use ATR already computed above
      const atr = atrValue;

      registerPosition({
        symbol,
        direction,
        entry_price: Number(entry_price),
        stop_loss: Number(stop_loss),
        take_profit: Number(take_profit),
        quantity: adjustedQty,
        trailing_config: decision.signal.trailing_stop,
        profit_targets: decision.signal.profit_targets,
        atr,
      });

      registerCostBasis(symbol, direction, Number(entry_price), adjustedQty);
    }

    res.json({
      ...executionResult,
      gate_action: decision.action,
      signal: {
        approved: decision.signal.approved,
        win_probability: decision.signal.win_probability,
        edge_score: decision.signal.edge_score,
        enhanced_quality: decision.signal.enhanced_quality,
        kelly_pct: decision.signal.kelly_fraction,
      },
      breaker_multiplier: sizeMultiplier,
      portfolio_risk_action: portfolioRiskGate.action,
      portfolio_risk_reasons: portfolioRiskGate.reasons,
      portfolio_risk_multiplier: portfolioRiskGate.size_multiplier,
      portfolio_risk: portfolioRiskGate.snapshot,
      adjusted_qty: adjustedQty,
      original_qty: decision.quantity,
    });
  } catch (err) {
    logger.error({ err }, "Execution pipeline error");
    res.status(500).json({ error: "execution_error", message: String(err) });
  }
});

// ── POST /kill-switch — Toggle kill switch ────────────

executionRouter.post("/kill-switch", requireOperator, async (req: Request, res: Response) => {
  try {
    const { active, operator_token, reason } = req.body;
    const shouldActivate = Boolean(active);

    if (shouldActivate) {
      // Activating kill switch
      const snapshot = setKillSwitchActive(true);
      logger.fatal({ reason, operator: "api" }, "Kill switch ACTIVATED via API");

      // Optionally trigger emergency liquidation
      if (req.body.liquidate) {
        const liquidation = await emergencyLiquidateAll(reason ?? "kill_switch_api");
        res.json({
          kill_switch: true,
          risk_snapshot: snapshot,
          liquidation,
        });
        return;
      }

      res.json({ kill_switch: true, risk_snapshot: snapshot });
    } else {
      // Deactivating kill switch
      const snapshot = setKillSwitchActive(false);
      logger.warn({ reason, operator: "api" }, "Kill switch DEACTIVATED via API");
      res.json({ kill_switch: false, risk_snapshot: snapshot });
    }
  } catch (err) {
    logger.error({ err }, "Kill switch toggle error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

// ── POST /emergency-close — Emergency liquidation ─────

executionRouter.post("/emergency-close", requireOperator, async (req: Request, res: Response) => {
  try {
    const reason = req.body.reason ?? "manual_api";
    if (isLiquidationInProgress()) {
      res.status(409).json({
        error: "liquidation_in_progress",
        message: "Emergency liquidation already running",
      });
      return;
    }

    const result = await emergencyLiquidateAll(reason);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Emergency close error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

// ── POST /emergency-stop-all — Kill switch + liquidation ──

executionRouter.post("/emergency-stop-all", requireOperator, async (req: Request, res: Response) => {
  try {
    const reason = String(req.body.reason ?? "manual_emergency_stop_all");
    const result = await triggerEmergencyStopAll(reason);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Emergency stop all error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

// ── GET /execution-status — Combined status ───────────

executionRouter.get("/execution-status", async (_req: Request, res: Response) => {
  try {
    const mode = getExecutionMode();
    const breaker = getBreakerSnapshot();
    const reconciliation = getReconciliationSnapshot();
    const positions = getManagedPositions();
    const gateStats = getProductionGateStats();
    const risk = getRiskEngineSnapshot();
    const lastLiquidation = getLastLiquidation();
    const portfolioRisk = await evaluatePortfolioRisk({ forceRefresh: false });

    res.json({
      mode,
      kill_switch: isKillSwitchActive(),
      breaker,
      reconciliation,
      managed_positions: positions.length,
      positions: positions.map((p) => ({
        symbol: p.symbol,
        direction: p.direction,
        entry: p.entry_price,
        current_stop: p.current_stop,
        peak_price: p.peak_price,
        trail_active: p.trail_active,
        remaining_qty: p.remaining_qty,
        targets_hit: p.targets_hit.length,
      })),
      gate_stats: gateStats,
      risk,
      portfolio_risk: portfolioRisk,
      last_liquidation: lastLiquidation,
    });
  } catch (err) {
    logger.error({ err }, "Execution status error");
    res.status(500).json({ error: "internal_error" });
  }
});

// ── GET /risk-guard — Portfolio drawdown/VAR/correlation state ──

executionRouter.get("/risk-guard", async (req: Request, res: Response) => {
  try {
    const force = ["1", "true", "yes", "on"].includes(String(req.query.force ?? "").toLowerCase());
    const candidateSymbol = String(req.query.candidate_symbol ?? "").trim().toUpperCase();
    const snapshot = await evaluatePortfolioRisk({
      forceRefresh: force,
      candidateSymbol: candidateSymbol || undefined,
    });
    res.json(snapshot);
  } catch (err) {
    logger.error({ err }, "Risk guard status error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

// ── POST /risk-guard/evaluate — Force a fresh portfolio risk evaluation ──

executionRouter.post("/risk-guard/evaluate", requireOperator, async (req: Request, res: Response) => {
  try {
    const candidateSymbol = String(req.body?.candidate_symbol ?? "").trim().toUpperCase();
    const autoHalt = req.body?.auto_halt === undefined ? false : Boolean(req.body.auto_halt);
    const snapshot = await evaluatePortfolioRisk({
      forceRefresh: true,
      autoHalt,
      candidateSymbol: candidateSymbol || undefined,
    });
    res.json(snapshot);
  } catch (err) {
    logger.error({ err }, "Risk guard evaluation error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

// ── GET /fills — Recent reconciled fills ──────────────

executionRouter.get("/fills", (_req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(_req.query.limit) || 50, 200);
    const fills = getRecentFills(limit);
    const snapshot = getReconciliationSnapshot();
    res.json({ fills, snapshot });
  } catch (err) {
    res.status(500).json({ error: "internal_error" });
  }
});

// ── GET /breaker — Drawdown breaker state ─────────────

executionRouter.get("/breaker", (_req: Request, res: Response) => {
  try {
    res.json(getBreakerSnapshot());
  } catch (err) {
    res.status(500).json({ error: "internal_error" });
  }
});

// ── POST /breaker/reset — Manual breaker reset ────────

executionRouter.post("/breaker/reset", requireOperator, (_req: Request, res: Response) => {
  try {
    const snapshot = resetBreaker();
    logger.warn("Drawdown breaker manually reset via API");
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({ error: "internal_error" });
  }
});

// ── GET /monitor-events — Position monitor events ─────

executionRouter.get("/monitor-events", (_req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(_req.query.limit) || 50, 200);
    const events = getMonitorEvents(limit);
    res.json({ events });
  } catch (err) {
    res.status(500).json({ error: "internal_error" });
  }
});

export default executionRouter;
