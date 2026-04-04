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
import {
  canExecuteByIncidentGuard,
  getExecutionIncidentSnapshot,
  recordExecutionAttempt,
  recordExecutionSlippage,
  resetExecutionIncidentGuard,
} from "../lib/execution_incident_guard";
import {
  evaluateExecutionMarketGuard,
  getExecutionMarketGuardSnapshot,
  resetExecutionMarketGuard,
} from "../lib/execution_market_guard";
import {
  beginExecutionIdempotency,
  buildExecutionFingerprint,
  finalizeExecutionIdempotency,
  getExecutionIdempotencySnapshot,
  requireExecutionIdempotencyKeyInLiveMode,
  resetExecutionIdempotencyStore,
} from "../lib/execution_idempotency";
import { auditExecutionLifecycle } from "../lib/audit_logger";

export const executionRouter = Router();

// ── POST /execute — Full production pipeline ──────────

executionRouter.post("/execute", requireOperator, async (req: Request, res: Response) => {
  const idempotencyKeyRaw = String(req.body?.idempotency_key ?? req.header("x-idempotency-key") ?? "").trim();
  const idempotencyKey = idempotencyKeyRaw.length > 0 ? idempotencyKeyRaw : null;
  const executionTraceId = `exec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  let idempotencyFingerprint: string | null = null;

  const finalizeTracked = (status: number, payload: unknown): void => {
    if (!idempotencyFingerprint) return;
    finalizeExecutionIdempotency({
      key: idempotencyKey,
      fingerprint: idempotencyFingerprint,
      status,
      body: payload,
    });
  };

  try {
    const {
      symbol, direction, setup_type, regime,
      entry_price, stop_loss, take_profit,
      bars_1h, bars_5m,
      spread, volume,
      operator_token,
    } = req.body;
    const symbolText = typeof symbol === "string" ? symbol.trim().toUpperCase() : "";
    const directionText = typeof direction === "string" ? direction.trim().toLowerCase() : "";
    const emitLifecycleAudit = (
      eventType: "execution_request_received" | "execution_idempotency" | "execution_gate_blocked" | "execution_result",
      decisionState: string,
      reason?: string,
      payload?: Record<string, unknown>,
    ): void => {
      void auditExecutionLifecycle(eventType, {
        symbol: symbolText || undefined,
        decision_state: decisionState,
        reason,
        payload: {
          trace_id: executionTraceId,
          idempotency_key_present: Boolean(idempotencyKey),
          idempotency_key: idempotencyKey,
          ...payload,
        },
      });
    };

    const sendTracked = (status: number, payload: Record<string, unknown>): void => {
      const body = {
        ...payload,
        idempotency_key: idempotencyKey,
        idempotent_replay: false,
      };
      finalizeTracked(status, body);
      res.status(status).json(body);
    };

    const mode = getExecutionMode();
    emitLifecycleAudit("execution_request_received", "received", undefined, {
      mode: mode.mode,
      direction: directionText || null,
      setup_type: setup_type ?? null,
      regime: regime ?? null,
      entry_price: Number(entry_price ?? Number.NaN),
      stop_loss: Number(stop_loss ?? Number.NaN),
      take_profit: Number(take_profit ?? Number.NaN),
    });

    if (!symbol || !direction || !entry_price || !stop_loss || !take_profit) {
      emitLifecycleAudit(
        "execution_gate_blocked",
        "validation_error",
        "required_fields_missing",
        { gate: "validation" },
      );
      sendTracked(400, {
        error: "validation_error",
        message: "Required: symbol, direction, entry_price, stop_loss, take_profit",
      });
      return;
    }

    if (mode.isLive && requireExecutionIdempotencyKeyInLiveMode() && !idempotencyKey) {
      emitLifecycleAudit(
        "execution_gate_blocked",
        "idempotency_key_required",
        "idempotency_key_missing_live_mode",
        { gate: "idempotency" },
      );
      sendTracked(400, {
        error: "idempotency_key_required",
        message: "Idempotency key is required for live execution. Pass x-idempotency-key header or idempotency_key in body.",
      });
      return;
    }

    idempotencyFingerprint = buildExecutionFingerprint({
      symbol,
      direction,
      setup_type: setup_type ?? "auto",
      regime: regime ?? "normal",
      entry_price,
      stop_loss,
      take_profit,
    });
    const idempotencyBegin = beginExecutionIdempotency({
      key: idempotencyKey,
      fingerprint: idempotencyFingerprint,
    });
    emitLifecycleAudit("execution_idempotency", idempotencyBegin.action.toLowerCase(), undefined, {
      action: idempotencyBegin.action,
    });

    if (idempotencyBegin.action === "REPLAY") {
      emitLifecycleAudit("execution_result", "replay", "served_cached_response", {
        status: idempotencyBegin.status,
      });
      const replayBody = (idempotencyBegin.body && typeof idempotencyBegin.body === "object")
        ? {
            ...(idempotencyBegin.body as Record<string, unknown>),
            idempotency_key: idempotencyBegin.key,
            idempotent_replay: true,
          }
        : {
            replayed: true,
            idempotency_key: idempotencyBegin.key,
            idempotent_replay: true,
            response: idempotencyBegin.body ?? null,
          };
      res.status(idempotencyBegin.status).json(replayBody);
      return;
    }

    if (idempotencyBegin.action === "CONFLICT") {
      emitLifecycleAudit(
        "execution_gate_blocked",
        "idempotency_conflict",
        idempotencyBegin.message,
        { gate: "idempotency", error: idempotencyBegin.error },
      );
      res.status(idempotencyBegin.status).json({
        error: idempotencyBegin.error,
        message: idempotencyBegin.message,
        idempotency: getExecutionIdempotencySnapshot(),
        idempotency_key: idempotencyBegin.key,
        idempotent_replay: false,
      });
      return;
    }

    const incidentGate = canExecuteByIncidentGuard();
    if (!incidentGate.allowed) {
      emitLifecycleAudit(
        "execution_gate_blocked",
        "incident_guard_halt",
        incidentGate.reason ?? "incident_guard_halt",
        { gate: "incident_guard" },
      );
      recordExecutionAttempt({
        symbol,
        outcome: "BLOCKED",
        detail: "incident_guard_halt",
        reason: incidentGate.reason ?? undefined,
      });
      sendTracked(423, {
        error: "execution_incident_halt",
        message: `Execution halted by incident guard (${incidentGate.reason ?? "halt"})`,
        incident_guard: incidentGate.snapshot,
        market_guard: getExecutionMarketGuardSnapshot(),
      });
      return;
    }

    // Check breaker state first
    if (isCooldownActive()) {
      emitLifecycleAudit(
        "execution_gate_blocked",
        "breaker_cooldown",
        "cooldown_active",
        { gate: "drawdown_breaker" },
      );
      sendTracked(429, {
        error: "cooldown_active",
        message: "Trading paused: consecutive loss cooldown active",
        breaker: getBreakerSnapshot(),
        incident_guard: getExecutionIncidentSnapshot(),
        market_guard: getExecutionMarketGuardSnapshot(),
      });
      return;
    }

    const sizeMultiplier = getPositionSizeMultiplier();
    if (sizeMultiplier <= 0) {
      emitLifecycleAudit(
        "execution_gate_blocked",
        "breaker_halt",
        "drawdown_breaker_halt",
        { gate: "drawdown_breaker" },
      );
      sendTracked(429, {
        error: "breaker_halt",
        message: "Trading halted by drawdown circuit breaker",
        breaker: getBreakerSnapshot(),
        incident_guard: getExecutionIncidentSnapshot(),
        market_guard: getExecutionMarketGuardSnapshot(),
      });
      return;
    }

    // Phase 16: Portfolio risk hardening gate (drawdown / VaR / correlation)
    const portfolioRiskGate = await evaluateExecutionRisk(symbol);
    if (!portfolioRiskGate.allowed) {
      const status = portfolioRiskGate.action === "HALT" ? 423 : 429;
      emitLifecycleAudit(
        "execution_gate_blocked",
        `portfolio_risk_${String(portfolioRiskGate.action).toLowerCase()}`,
        portfolioRiskGate.reasons[0] ?? "portfolio_risk_blocked",
        { gate: "portfolio_risk", action: portfolioRiskGate.action, reasons: portfolioRiskGate.reasons },
      );
      sendTracked(status, {
        error: "portfolio_risk_blocked",
        message: `Execution blocked by portfolio risk guard (${portfolioRiskGate.action})`,
        action: portfolioRiskGate.action,
        reasons: portfolioRiskGate.reasons,
        portfolio_risk: portfolioRiskGate.snapshot,
        incident_guard: getExecutionIncidentSnapshot(),
        market_guard: getExecutionMarketGuardSnapshot(),
      });
      return;
    }

    // Phase 19: Market microstructure quality guard (spread/liquidity/freshness/volatility)
    const marketGuard = await evaluateExecutionMarketGuard({ symbol });
    if (!marketGuard.allowed) {
      const isHalt = marketGuard.snapshot.halt_active || marketGuard.level === "HALT";
      emitLifecycleAudit(
        "execution_gate_blocked",
        `market_guard_${String(marketGuard.action).toLowerCase()}`,
        marketGuard.reasons[0] ?? "market_quality_blocked",
        { gate: "market_guard", action: marketGuard.action, reasons: marketGuard.reasons },
      );
      recordExecutionAttempt({
        symbol,
        outcome: "BLOCKED",
        detail: `market_guard_block:${marketGuard.action}`,
        reason: marketGuard.reasons[0],
      });
      sendTracked(isHalt ? 423 : 429, {
        error: "market_quality_blocked",
        message: `Execution blocked by market guard (${marketGuard.reasons.join(", ") || marketGuard.action})`,
        action: marketGuard.action,
        reasons: marketGuard.reasons,
        market_guard: marketGuard.snapshot,
        incident_guard: getExecutionIncidentSnapshot(),
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
      emitLifecycleAudit(
        "execution_gate_blocked",
        `production_gate_${String(decision.action).toLowerCase()}`,
        decision.block_reasons[0] ?? "production_gate_blocked",
        { gate: "production_gate", action: decision.action, reasons: decision.block_reasons },
      );
      recordExecutionAttempt({
        symbol,
        outcome: "BLOCKED",
        detail: `gate_block:${decision.action}`,
        reason: decision.block_reasons[0] ?? undefined,
      });
      sendTracked(200, {
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
        incident_guard: getExecutionIncidentSnapshot(),
        market_guard: marketGuard.snapshot,
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
    emitLifecycleAudit(
      "execution_result",
      executionResult.executed ? "executed" : "failed",
      executionResult.error,
      {
        mode: executionResult.mode,
        order_id: executionResult.order_id ?? null,
        adjusted_qty: adjustedQty,
        original_qty: decision.quantity,
        si_decision_id: executionResult.si_decision_id ?? null,
      },
    );

    if (executionResult.executed) {
      recordExecutionAttempt({
        symbol,
        outcome: "EXECUTED",
        detail: executionResult.order_id ? `order_id:${executionResult.order_id}` : "order_executed",
        mode: executionResult.mode,
      });
      const filledAvgPrice = Number((executionResult.details as Record<string, unknown>)?.filled_avg_price ?? Number.NaN);
      if (Number.isFinite(filledAvgPrice) && filledAvgPrice > 0) {
        recordExecutionSlippage({
          symbol,
          expected_price: Number(entry_price),
          executed_price: filledAvgPrice,
          side: direction === "long" ? "buy" : "sell",
        });
      }
    } else {
      const errLower = String(executionResult.error ?? "").toLowerCase();
      const isRejected =
        errLower.includes("invalid") ||
        errLower.includes("required") ||
        errLower.includes("exceeds") ||
        errLower.includes("blocked") ||
        errLower.includes("validation");
      recordExecutionAttempt({
        symbol,
        outcome: isRejected ? "REJECTED" : "ERROR",
        detail: executionResult.error ?? "execution_failed",
        mode: executionResult.mode,
      });
    }

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

    sendTracked(200, {
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
      incident_guard: getExecutionIncidentSnapshot(),
      market_guard: marketGuard.snapshot,
    });
  } catch (err) {
    const symbol = String(req.body?.symbol ?? "UNKNOWN");
    void auditExecutionLifecycle("execution_result", {
      symbol: symbol !== "UNKNOWN" ? symbol : undefined,
      decision_state: "error",
      reason: err instanceof Error ? err.message : String(err),
      actor: "execution_router",
      payload: {
        trace_id: executionTraceId,
        idempotency_key_present: Boolean(idempotencyKey),
        idempotency_key: idempotencyKey,
      },
    });
    recordExecutionAttempt({
      symbol,
      outcome: "ERROR",
      detail: err instanceof Error ? err.message : String(err),
    });
    logger.error({ err }, "Execution pipeline error");
    const body = {
      error: "execution_error",
      message: String(err),
      incident_guard: getExecutionIncidentSnapshot(),
      market_guard: getExecutionMarketGuardSnapshot(),
      idempotency_key: idempotencyKey,
      idempotent_replay: false,
    };
    finalizeTracked(500, body);
    res.status(500).json(body);
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
    const incidentGuard = getExecutionIncidentSnapshot();
    const marketGuard = getExecutionMarketGuardSnapshot();
    const idempotency = getExecutionIdempotencySnapshot();

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
      incident_guard: incidentGuard,
      market_guard: marketGuard,
      idempotency,
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

// ── GET /incident-guard — Execution incident safety state ────────

executionRouter.get("/incident-guard", (_req: Request, res: Response) => {
  try {
    res.json(getExecutionIncidentSnapshot());
  } catch (err) {
    res.status(500).json({ error: "internal_error" });
  }
});

// ── GET /market-guard — Market quality safety state ─────────────

executionRouter.get("/market-guard", async (req: Request, res: Response) => {
  try {
    const symbol = String(req.query.symbol ?? "").trim().toUpperCase();
    const refresh = ["1", "true", "yes", "on"].includes(String(req.query.refresh ?? "").toLowerCase());
    if (symbol || refresh) {
      const targetSymbol = symbol || "BTCUSD";
      const decision = await evaluateExecutionMarketGuard({ symbol: targetSymbol });
      res.json({
        ...decision.snapshot,
        decision: {
          symbol: targetSymbol,
          allowed: decision.allowed,
          action: decision.action,
          reasons: decision.reasons,
          level: decision.level,
        },
      });
      return;
    }
    res.json(getExecutionMarketGuardSnapshot());
  } catch (err) {
    res.status(500).json({ error: "internal_error" });
  }
});

// ── GET /idempotency — Execution request idempotency state ───────

executionRouter.get("/idempotency", (_req: Request, res: Response) => {
  try {
    res.json(getExecutionIdempotencySnapshot());
  } catch {
    res.status(500).json({ error: "internal_error" });
  }
});

// ── POST /incident-guard/reset — Manual incident guard reset ─────

executionRouter.post("/incident-guard/reset", requireOperator, (req: Request, res: Response) => {
  try {
    const clearKillSwitch =
      String(req.body?.clear_kill_switch ?? "")
        .trim()
        .toLowerCase();
    const snapshot = resetExecutionIncidentGuard({
      reason: String(req.body?.reason ?? "manual_reset"),
      clearKillSwitch: clearKillSwitch === "1" || clearKillSwitch === "true" || clearKillSwitch === "yes" || clearKillSwitch === "on",
    });
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({ error: "internal_error" });
  }
});

// ── POST /market-guard/reset — Manual market guard reset ─────────

executionRouter.post("/market-guard/reset", requireOperator, (req: Request, res: Response) => {
  try {
    const clearKillSwitch =
      String(req.body?.clear_kill_switch ?? "")
        .trim()
        .toLowerCase();
    const snapshot = resetExecutionMarketGuard({
      reason: String(req.body?.reason ?? "manual_reset"),
      clearKillSwitch: clearKillSwitch === "1" || clearKillSwitch === "true" || clearKillSwitch === "yes" || clearKillSwitch === "on",
    });
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({ error: "internal_error" });
  }
});

// ── POST /idempotency/reset — Clear idempotency cache/state ─────

executionRouter.post("/idempotency/reset", requireOperator, (_req: Request, res: Response) => {
  try {
    const snapshot = resetExecutionIdempotencyStore();
    res.json(snapshot);
  } catch {
    res.status(500).json({ error: "internal_error" });
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
