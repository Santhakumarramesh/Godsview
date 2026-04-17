/**
 * brain_execution_bridge.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 7E: Live Execution Bridge
 *
 * Connects the Autonomous Brain's STRONG_LONG / STRONG_SHORT decisions
 * to Alpaca order placement via the existing hardened OrderExecutor.
 *
 * Architecture:
 *   AutonomousBrain.onSignalConfirmed()
 *     → BrainExecutionBridge.evaluate(confirmation)
 *       → [strategy gate] check tier, kelly, mode
 *       → [position gate] check existing positions
 *       → [production gate] validate risk limits
 *         → [order executor] place order on Alpaca
 *           → [fill reconciler] confirm fill
 *             → BrainExecutionBridge.onFill()
 *               → autonomousBrain.recordTradeOutcome()
 *                 → superIntelligenceV2.recordOutcome()
 *                   → strategyRegistry.evolve()
 *
 * Everything is logged at each step. The bridge NEVER silently discards a signal.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "./logger.js";
import { autonomousBrain } from "./autonomous_brain.js";
import { strategyRegistry } from "./strategy_evolution.js";
import { superIntelligenceV2 } from "./super_intelligence_v2.js";
import { superIntelligenceV3, type V3Prediction } from "./super_intelligence_v3.js";
import { brainEventBus } from "./brain_event_bus.js";
import { saveTradeOutcome, saveChartSnapshot } from "./brain_persistence.js";
import { brainPerformance } from "./brain_performance.js";
import { brainAlerts } from "./brain_alerts.js";
import { brainCircuitBreaker } from "./brain_daily_circuit_breaker.js";
import { registerCostBasis, clearCostBasis } from "./fill_reconciler.js";
import { strategyParamsStore } from "./strategy_params_store.js";
import { computeMTFConfluence, MTF_MIN_ALIGNMENT } from "./brain_mtf_confluence.js";
import { adaptKellyToRegime, regimeSizingInfo } from "./regime_sizing_adapter.js";
import { telemetry } from "./brain_health_telemetry.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BrainSignal {
  /** From L5 confirmation output */
  confirmationId: string;
  symbol: string;
  direction: "STRONG_LONG" | "STRONG_SHORT" | "LONG" | "SHORT";
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  confirmationScore: number;
  regime: string;
  strategyId: string;
  /** SI win probability if available */
  winProbability?: number;
  siConfidence?: number;
  obQuality?: number;
  bosConfirmed?: boolean;
  fvgPresent?: boolean;
  mtfAligned?: boolean;
  /** Chart snapshot SVG if L8 ran */
  chartSvg?: string;
  /** Raw brain layer outputs for context */
  layerContext?: Record<string, unknown>;
}

export interface BridgeDecision {
  approved: boolean;
  reason: string;
  symbol: string;
  direction: string;
  suggestedQty?: number;
  kellyFraction?: number;
  tier?: string;
  orderId?: string;
  error?: string;
  executedAt?: string;
}

export interface OpenBrainPosition {
  symbol: string;
  direction: "long" | "short";
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  quantity: number;
  openedAt: number;
  confirmationId: string;
  strategyId: string;
  orderId?: string;
  /** Running P&L in R multiples */
  currentR?: number;
  /** SI prediction at entry */
  winProbAtEntry?: number;
  /** V3 prediction snapshot at entry */
  v3Prediction?: V3Prediction;
}

// ── Configuration ─────────────────────────────────────────────────────────────

const BRIDGE_ENABLED = String(process.env.BRAIN_EXECUTION_BRIDGE ?? "false").toLowerCase() === "true";
const MIN_SCORE_FOR_EXECUTION = Number(process.env.BRAIN_MIN_SCORE ?? "0.72");
const MIN_WIN_PROB_FOR_EXECUTION = Number(process.env.BRAIN_MIN_WIN_PROB ?? "0.60");
const MAX_CONCURRENT_POSITIONS = Number(process.env.BRAIN_MAX_POSITIONS ?? "5");
const ACCOUNT_RISK_PER_TRADE_PCT = Number(process.env.BRAIN_RISK_PER_TRADE_PCT ?? "1.0"); // 1% default
const ACCOUNT_EQUITY = Number(process.env.BRAIN_ACCOUNT_EQUITY ?? "100000"); // $100k default

// ── Position Registry ─────────────────────────────────────────────────────────

class BrainPositionRegistry {
  private positions = new Map<string, OpenBrainPosition>();

  open(pos: OpenBrainPosition): void {
    this.positions.set(pos.symbol, pos);
    logger.info({ symbol: pos.symbol, dir: pos.direction, entry: pos.entryPrice }, "[BrainBridge] Position opened");
  }

  close(symbol: string): OpenBrainPosition | undefined {
    const pos = this.positions.get(symbol);
    this.positions.delete(symbol);
    return pos;
  }

  get(symbol: string): OpenBrainPosition | undefined {
    return this.positions.get(symbol);
  }

  getAll(): OpenBrainPosition[] {
    return Array.from(this.positions.values());
  }

  hasOpen(symbol: string): boolean {
    return this.positions.has(symbol);
  }

  count(): number {
    return this.positions.size;
  }
}

export const brainPositions = new BrainPositionRegistry();

// ── Execution Bridge ──────────────────────────────────────────────────────────

class BrainExecutionBridge {
  private totalSignals = 0;
  private totalApproved = 0;
  private totalExecuted = 0;
  private totalBlocked = 0;
  private readonly rejections: Array<{ ts: number; symbol: string; reason: string }> = [];

  /**
   * Main entry point — evaluate a brain signal and optionally execute.
   * Returns a BridgeDecision for logging/UI display.
   */
  async evaluate(signal: BrainSignal): Promise<BridgeDecision> {
    const bridgeTimer = telemetry.startLayer("EXECUTION_BRIDGE");
    this.totalSignals++;

    // ── Gate 0: Bridge enabled? ───────────────────────────────────────────────
    if (!BRIDGE_ENABLED) {
      return this._reject(signal, "BRIDGE_DISABLED", "Execution bridge is disabled (BRAIN_EXECUTION_BRIDGE=false)");
    }

    // ── Gate 1: Brain mode ────────────────────────────────────────────────────
    const brainState = autonomousBrain.getFullStatus().brain;
    if (brainState.mode === "PAUSED") {
      return this._reject(signal, "BRAIN_PAUSED", "Brain is paused — no new positions");
    }

    // ── Gate 2: Only STRONG signals in NORMAL mode ────────────────────────────
    if (brainState.mode === "DEFENSIVE" && !signal.direction.startsWith("STRONG")) {
      return this._reject(signal, "DEFENSIVE_FILTER", "DEFENSIVE mode: only STRONG_LONG/STRONG_SHORT allowed");
    }

    // ── Gate 2.5: Strategy param override — manually disabled ────────────────
    if (!strategyParamsStore.isEnabled(signal.strategyId)) {
      return this._reject(signal, "STRATEGY_DISABLED", `Strategy ${signal.strategyId} is manually disabled via param override`);
    }

    // ── Gate 3: Confirmation score (respects per-strategy override) ───────────
    const effectiveMinScore = strategyParamsStore.effectiveMinScore(signal.strategyId, MIN_SCORE_FOR_EXECUTION);
    if (signal.confirmationScore < effectiveMinScore) {
      return this._reject(signal, "LOW_SCORE", `Confirmation score ${signal.confirmationScore.toFixed(3)} < ${effectiveMinScore} threshold`);
    }

    // ── Gate 4: SI win probability (respects per-strategy override) ───────────
    const effectiveMinWinProb = strategyParamsStore.effectiveMinWinProb(signal.strategyId, MIN_WIN_PROB_FOR_EXECUTION);
    if (signal.winProbability !== undefined && signal.winProbability < effectiveMinWinProb) {
      return this._reject(signal, "LOW_WIN_PROB", `SI win probability ${(signal.winProbability * 100).toFixed(1)}% < ${(effectiveMinWinProb * 100).toFixed(1)}% minimum`);
    }

    // ── Gate 5: Existing position in symbol ───────────────────────────────────
    if (brainPositions.hasOpen(signal.symbol)) {
      return this._reject(signal, "ALREADY_IN_POSITION", `Already have an open position in ${signal.symbol}`);
    }

    // ── Gate 6: Max concurrent positions ─────────────────────────────────────
    if (brainPositions.count() >= MAX_CONCURRENT_POSITIONS) {
      return this._reject(signal, "MAX_POSITIONS", `At max ${MAX_CONCURRENT_POSITIONS} concurrent brain positions`);
    }

    // ── Gate 7: Strategy tier ─────────────────────────────────────────────────
    const strategy = strategyRegistry.getOrCreate(signal.strategyId, signal.symbol, signal.strategyId);
    if (strategy.tier === "SUSPENDED") {
      return this._reject(signal, "STRATEGY_SUSPENDED", `Strategy ${signal.strategyId} on ${signal.symbol} is SUSPENDED`);
    }

    // ── Gate 8: Strategy regime blacklist ─────────────────────────────────────
    if (strategy.blacklistedRegimes.includes(signal.regime)) {
      return this._reject(signal, "BLACKLISTED_REGIME", `Regime ${signal.regime} is blacklisted for ${signal.strategyId}`);
    }

    // ── Gate 2.7: Multi-timeframe confluence (Phase 12B) ──────────────────────
    const mtfEnabled = String(process.env.BRAIN_MTF_ENABLED ?? "true").toLowerCase() !== "false";
    if (mtfEnabled) {
      try {
        const dir = signal.direction.includes("LONG") ? "long" : "short";
        const mtf = await computeMTFConfluence(signal.symbol, dir);
        if (mtf.alignmentScore < MTF_MIN_ALIGNMENT) {
          return this._reject(
            signal,
            "MTF_MISALIGNMENT",
            `MTF alignment ${(mtf.alignmentScore * 100).toFixed(1)}% < ${(MTF_MIN_ALIGNMENT * 100).toFixed(0)}% (${mtf.agreementCount}/${mtf.timeframes.length} TFs aligned; conflicts: ${mtf.conflictTFs.join(",") || "none"})`,
          );
        }
        logger.debug({ symbol: signal.symbol, alignment: mtf.alignmentScore, strongTFs: mtf.strongTFs }, "[BrainBridge] MTF gate passed");
      } catch (err) {
        logger.warn({ err, symbol: signal.symbol }, "[BrainBridge] MTF check failed — continuing without gate");
      }
    }

    // ── Gate 9: V3 Super Intelligence tier check ──────────────────────────────
    let v3Result: V3Prediction | undefined;
    try {
      const { buildSIFeatures } = await import("./super_intelligence_v2.js");
      const siFeatures = buildSIFeatures(
        signal.symbol,
        signal.direction.includes("LONG") ? "long" : "short",
        { smc: signal.layerContext?.smc ?? {}, regime: signal.layerContext?.regime ?? {}, mtfScores: signal.layerContext?.mtfScores ?? {}, trend: String(signal.layerContext?.trend ?? "neutral"), regimeLabel: signal.regime, structureScore: signal.confirmationScore, regimeScore: 0.5 },
        { macroBias: signal.layerContext?.macroBias ?? {}, sentiment: signal.layerContext?.sentiment ?? {}, volatility: signal.layerContext?.volatility ?? {}, macroScore: 0.5, sentimentScore: 0.5, stressScore: 0.5 },
        { setupMemory: signal.layerContext?.setupMemory ?? {}, marketDna: signal.layerContext?.marketDna ?? {}, winRate: signal.winProbability ?? 0.5, profitFactor: 1.5, decayDetected: false, similarSetups: 10 },
      );
      v3Result = superIntelligenceV3.predict(siFeatures);
      if (v3Result.tier.tier === "WEAK") {
        return this._reject(signal, "V3_WEAK_TIER", `V3 Super Intelligence classified as WEAK: ${v3Result.tier.reason}`);
      }
      if (v3Result.tier.tier === "MARGINAL" && brainState.mode === "DEFENSIVE") {
        return this._reject(signal, "V3_MARGINAL_DEFENSIVE", `MARGINAL tier + DEFENSIVE mode — skipping: ${v3Result.tier.reason}`);
      }
      logger.info({ symbol: signal.symbol, tier: v3Result.tier.tier, adjustedProb: v3Result.v3Adjustments.adjustedProbability.toFixed(3), edgeScore: v3Result.edgeScore.toFixed(3) }, "[BrainBridge] V3 SI gate passed");
    } catch (err) {
      logger.warn({ err, symbol: signal.symbol }, "[BrainBridge] V3 SI check failed — continuing with V2");
    }

    // ── Gates passed — compute position sizing ────────────────────────────────
    this.totalApproved++;

    const riskPerTrade = ACCOUNT_EQUITY * (ACCOUNT_RISK_PER_TRADE_PCT / 100);
    const stopDistance = Math.abs(signal.entryPrice - signal.stopLoss);
    const rawQty = stopDistance > 0 ? Math.floor(riskPerTrade / stopDistance) : 1;

    // Apply Kelly scaling — respects per-strategy override (Phase 11B) +
    // regime-adaptive multiplier (Phase 12C)
    const baseKelly = strategyParamsStore.effectiveMaxKelly(signal.strategyId, strategy.maxKellyFraction);
    const regimeConfidence = (signal.layerContext?.regimeConfidence as number) ?? 0.7;
    const regimeAdaptedKelly = adaptKellyToRegime(baseKelly, signal.regime, regimeConfidence);
    const kellyFraction = brainState.mode === "DEFENSIVE"
      ? regimeAdaptedKelly * 0.5
      : regimeAdaptedKelly;

    const sizingMeta = regimeSizingInfo(signal.regime, regimeConfidence);
    logger.debug({ symbol: signal.symbol, baseKelly, regimeAdaptedKelly, kellyFraction, ...sizingMeta }, "[BrainBridge] Regime-adaptive sizing applied");
    // Apply V3 tier size multiplier (ELITE=1.5x, STRONG=1.0x, MARGINAL=0.5x)
    const v3SizeMultiplier = v3Result?.tier.sizeMultiplier ?? 1.0;
    const maxQtyByKelly = Math.floor(ACCOUNT_EQUITY * kellyFraction / signal.entryPrice);
    const finalQty = Math.max(1, Math.min(rawQty, Math.floor(maxQtyByKelly * v3SizeMultiplier)));

    // ── Build execution request ───────────────────────────────────────────────
    const side = signal.direction.includes("LONG") ? "buy" : "sell";

    logger.info({
      symbol: signal.symbol,
      side,
      qty: finalQty,
      entry: signal.entryPrice,
      sl: signal.stopLoss,
      tp: signal.takeProfit,
      kelly: kellyFraction,
      tier: strategy.tier,
    }, "[BrainBridge] Signal approved — attempting execution");

    // ── Execute via order executor ────────────────────────────────────────────
    try {
      const { executeOrder } = await import("./order_executor.js");
      const execResult = await executeOrder({
        symbol: signal.symbol,
        side,
        quantity: finalQty,
        direction: signal.direction.includes("LONG") ? "long" : "short",
        setup_type: signal.strategyId,
        regime: signal.regime,
        entry_price: signal.entryPrice,
        stop_loss: signal.stopLoss,
        take_profit: signal.takeProfit,
        decision: {
          approved: true,
          action: side,
          suggestedQty: finalQty,
          kellyFraction,
          winProbability: signal.winProbability ?? 0.6,
          edgeScore: signal.confirmationScore,
          confluenceScore: signal.confirmationScore,
          enhancedQuality: signal.confirmationScore,
          blockReasons: [],
          safetyFlags: [],
        } as any,
      });

      if (execResult.executed) {
        this.totalExecuted++;

        // Register open position
        brainPositions.open({
          symbol: signal.symbol,
          direction: signal.direction.includes("LONG") ? "long" : "short",
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
          quantity: finalQty,
          openedAt: Date.now(),
          confirmationId: signal.confirmationId,
          strategyId: signal.strategyId,
          orderId: execResult.order_id,
          winProbAtEntry: v3Result?.v3Adjustments.adjustedProbability ?? signal.winProbability,
          v3Prediction: v3Result,
        });

        // Register cost basis with fill reconciler (Phase 11A)
        registerCostBasis(
          signal.symbol,
          signal.direction.includes("LONG") ? "long" : "short",
          signal.entryPrice,
          finalQty,
        );

        // Persist chart if available
        if (signal.chartSvg) {
          saveChartSnapshot({
            confirmation_id: signal.confirmationId,
            symbol: signal.symbol,
            direction: signal.direction,
            regime: signal.regime,
            confirmation_score: String(signal.confirmationScore),
            svg_chart: signal.chartSvg,
            annotation_count: 0,
          }).catch((e) => logger.debug({ err: e }, "[ExecutionBridge] snapshot audit failed"));
        }

        // Emit brain event
        brainEventBus.agentReport({
          agentId: "brain",
          symbol: signal.symbol,
          status: "done",
          confidence: signal.winProbability ?? signal.confirmationScore,
          score: signal.confirmationScore,
          verdict: `Executed ${side.toUpperCase()} ${finalQty} ${signal.symbol} @ ${signal.entryPrice}`,
          data: { orderId: execResult.order_id, qty: finalQty, kelly: kellyFraction, tier: strategy.tier },
          flags: [],
          timestamp: Date.now(),
          latencyMs: 0,
        });

        bridgeTimer.end("success");
        return {
          approved: true,
          reason: `Executed ${execResult.mode} order — ${side} ${finalQty} @ ${signal.entryPrice}`,
          symbol: signal.symbol,
          direction: signal.direction,
          suggestedQty: finalQty,
          kellyFraction,
          tier: strategy.tier,
          orderId: execResult.order_id,
          executedAt: new Date().toISOString(),
        };
      } else {
        bridgeTimer.end("error", execResult.error ?? "not-executed");
        return this._reject(signal, "EXECUTION_FAILED", execResult.error ?? "Order executor returned not-executed");
      }
    } catch (err: any) {
      logger.error({ err, symbol: signal.symbol }, "[BrainBridge] Execution error");
      bridgeTimer.end("error", String(err?.message ?? err));
      return this._reject(signal, "EXECUTION_ERROR", String(err?.message ?? err));
    }
  }

  /**
   * Called when a brain-managed position gets filled/closed.
   * Triggers outcome recording which feeds SI + strategy evolution.
   */
  async onPositionClosed(
    symbol: string,
    exitPrice: number,
    reason: "TP_HIT" | "SL_HIT" | "MANUAL" | "TIME_EXIT" | "TRAIL_STOP",
  ): Promise<void> {
    const pos = brainPositions.close(symbol);
    if (!pos) {
      logger.warn({ symbol }, "[BrainBridge] onPositionClosed: no open position found");
      return;
    }

    // Clear fill reconciler cost basis (Phase 11A)
    clearCostBasis(symbol);

    const slDistance = Math.abs(pos.entryPrice - pos.stopLoss);
    const pnlDollar = (exitPrice - pos.entryPrice) * pos.quantity * (pos.direction === "long" ? 1 : -1);
    const pnlR = slDistance > 0 ? pnlDollar / (slDistance * pos.quantity) : 0;
    const won = pnlR > 0;
    const exitTime = new Date();

    logger.info({ symbol, pnlR: pnlR.toFixed(2), reason, won }, "[BrainBridge] Position closed");

    // Persist full outcome to DB
    await saveTradeOutcome({
      symbol,
      strategy_id: pos.strategyId,
      confirmation_id: pos.confirmationId,
      direction: pos.direction,
      entry_price: String(pos.entryPrice),
      stop_loss: String(pos.stopLoss),
      take_profit: String(pos.takeProfit),
      exit_price: String(exitPrice),
      quantity: String(pos.quantity),
      outcome: won ? (Math.abs(pnlR) < 0.1 ? "BREAKEVEN" : "WIN") : "LOSS",
      pnl_usd: String(pnlDollar.toFixed(4)),
      pnl_r: String(pnlR.toFixed(4)),
      hold_bars: Math.round((Date.now() - pos.openedAt) / 300000), // 5min bars
      si_win_probability: pos.winProbAtEntry !== undefined ? String(pos.winProbAtEntry) : undefined,
      entry_time: new Date(pos.openedAt),
      exit_time: exitTime,
    });

    // ── Feed Daily Circuit Breaker ───────────────────────────────────────────
    brainCircuitBreaker.recordTrade(pnlR);

    // ── Feed Performance Engine (equity curve, Sharpe, Sortino) ─────────────
    brainPerformance.recordOutcome({
      symbol,
      direction: pos.direction.toUpperCase() as "LONG" | "SHORT",
      regime: "unknown",
      pnlR,
      won,
      timestamp: exitTime.getTime(),
    });

    // ── Emit TP/SL alert ─────────────────────────────────────────────────────
    if (reason === "TP_HIT") {
      brainAlerts.tpHit(symbol, pnlR);
    } else if (reason === "SL_HIT") {
      brainAlerts.slHit(symbol, pnlR);
    }

    // Feed V3 super intelligence with outcome (also feeds V2 internally)
    const adverseConditions: string[] = [];
    if (pos.v3Prediction) {
      if (pos.v3Prediction.v3Adjustments.antifragility < 0.4) adverseConditions.push("low_antifragility");
      if (pos.v3Prediction.v3Adjustments.correlationBoost < -0.02) adverseConditions.push("cross_asset_contradiction");
      if (pos.v3Prediction.v3Adjustments.regimeBoost < -0.03) adverseConditions.push("adverse_regime");
    }
    superIntelligenceV3.recordOutcome({
      id: pos.confirmationId,
      symbol,
      strategyId: pos.strategyId,
      direction: pos.direction,
      regime: pos.v3Prediction?.regime ?? "unknown",
      features: {},
      predictedWinProb: pos.winProbAtEntry ?? 0.5,
      actualWon: won,
      achievedR: pnlR,
      timestamp: exitTime.toISOString(),
      adverseConditions,
    });

    // Feed autonomous brain for streak tracking + defensive mode
    autonomousBrain.recordTradeOutcome(
      symbol,
      pos.direction,
      won,
      pnlR,
      "unknown",
      pos.winProbAtEntry ?? 0.5,
    );

    // Emit event to UI
    brainEventBus.agentReport({
      agentId: "brain",
      symbol,
      status: "done",
      confidence: 1,
      score: won ? 1 : 0,
      verdict: `Position closed: ${reason} | PnL: ${pnlR.toFixed(2)}R | ${won ? "WIN ✓" : "LOSS ✗"}`,
      data: { reason, pnlR, pnlDollar, exitPrice, direction: pos.direction },
      flags: won ? [] : [{ level: "warning" as const, code: "TRADE_LOSS", message: `${symbol} lost ${Math.abs(pnlR).toFixed(2)}R` }],
      timestamp: Date.now(),
      latencyMs: 0,
    });
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private _reject(signal: BrainSignal, code: string, reason: string): BridgeDecision {
    this.totalBlocked++;
    this.rejections.push({ ts: Date.now(), symbol: signal.symbol, reason: code });
    if (this.rejections.length > 500) this.rejections.splice(0, this.rejections.length - 500);

    logger.debug({ symbol: signal.symbol, code, reason }, "[BrainBridge] Signal rejected");
    return {
      approved: false,
      reason,
      symbol: signal.symbol,
      direction: signal.direction,
    };
  }

  getStatus() {
    return {
      enabled: BRIDGE_ENABLED,
      totalSignals: this.totalSignals,
      totalApproved: this.totalApproved,
      totalExecuted: this.totalExecuted,
      totalBlocked: this.totalBlocked,
      approvalRate: this.totalSignals > 0 ? this.totalApproved / this.totalSignals : 0,
      executionRate: this.totalApproved > 0 ? this.totalExecuted / this.totalApproved : 0,
      openPositions: brainPositions.getAll(),
      recentRejections: this.rejections.slice(-20),
      config: {
        minScore: MIN_SCORE_FOR_EXECUTION,
        minWinProb: MIN_WIN_PROB_FOR_EXECUTION,
        maxPositions: MAX_CONCURRENT_POSITIONS,
        riskPerTradePct: ACCOUNT_RISK_PER_TRADE_PCT,
        accountEquity: ACCOUNT_EQUITY,
      },
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const brainExecutionBridge = new BrainExecutionBridge();
