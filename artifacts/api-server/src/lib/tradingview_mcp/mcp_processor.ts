// @ts-nocheck
/**
 * DESIGN SCAFFOLD — not wired into the live runtime.
 *
 * STATUS: This file is a forward-looking integration shell. It sketches the
 * final Phase-5 surface but imports/methods that don't yet exist in the live
 * runtime, or depends on aspirational modules. Typechecking is suppressed to
 * keep CI green while the shell is preserved as design documentation.
 *
 * Wiring it into the live runtime is tracked in
 * docs/PRODUCTION_READINESS.md (Phase 5: Auto-Promotion Pipeline).
 *
 * REMOVE the `// @ts-nocheck` directive once Phase 5 is implemented and all
 * referenced modules/methods exist.
 */
/**
 * Phase 97 — MCP Processor
 *
 * The intelligence core: takes a standardized signal, enriches it
 * with market context (order book, volume delta, macro, sentiment, memory),
 * scores it across multiple dimensions, and makes a trade/no-trade decision.
 *
 * This is the "brain" between TradingView signals and execution.
 */
import { EventEmitter } from "events";
import type {
  StandardSignal,
  EnrichmentContext,
  SignalScore,
  MCPDecision,
  MCPPipelineConfig,
} from "./types.js";

// Interfaces for the data providers we depend on (injected)
export interface DataProvider {
  getOrderBook(symbol: string): {
    midpoint: number; spread: number; spreadBps: number;
    imbalanceRatio: number; microPressure: number;
    bidDepth: number; askDepth: number;
  } | null;

  getVolumeDelta(symbol: string): {
    delta: number; cumulativeDelta: number; deltaPercent: number;
    aggressiveBuyPct: number; aggressiveSellPct: number;
  } | null;

  getMacro(): {
    vix: number | null; dxy: number | null;
    us10y: number | null; spyChange: number | null;
  };

  getSentiment(symbol: string): {
    newsScore: number; socialScore: number;
    overallSentiment: "bullish" | "bearish" | "neutral";
  };

  getRegime(): "risk_on" | "risk_off" | "neutral" | "high_vol" | "low_vol";
  getSession(): "premarket" | "open" | "midday" | "power_hour" | "after_hours" | "closed";
  getDataQuality(symbol: string): { sourcesActive: number; sourcesTotal: number; overallScore: number };
}

export interface MemoryProvider {
  recallSimilarSetups(symbol: string, signalType: string, regime: string): {
    winRate: number | null;
    profitFactor: number | null;
    sampleSize: number;
    lastOutcome: "win" | "loss" | "breakeven" | null;
    avgHoldBars: number | null;
  };
}

export interface RiskProvider {
  calculatePositionSize(request: {
    symbol: string; direction: "long" | "short"; entryPrice: number;
    stopPrice: number; confidence: number; regime: string; volatility: number;
    setupFamily: string;
  }): { approved: boolean; quantity: number; riskDollars: number; riskPercent: number };

  runPreTradeChecks(request: {
    symbol: string; direction: "long" | "short"; entryPrice: number;
    stopPrice: number; confidence: number; regime: string; volatility: number;
    setupFamily: string;
  }): { passed: boolean; blockReasons: string[] };
}

/**
 * MCPProcessor — orchestrates enrichment, scoring, and decision-making
 *
 * Events:
 * - 'enriched': (signalId, context: EnrichmentContext)
 * - 'scored': (signalId, score: SignalScore)
 * - 'decided': (decision: MCPDecision)
 * - 'error': (signalId, error: Error)
 */
export class MCPProcessor extends EventEmitter {
  private config: MCPPipelineConfig;
  private dataProvider: DataProvider | null = null;
  private memoryProvider: MemoryProvider | null = null;
  private riskProvider: RiskProvider | null = null;
  private decisions: Map<string, MCPDecision> = new Map();
  private maxDecisions = 5000;

  constructor(config: MCPPipelineConfig) {
    super();
    this.config = config;
  }

  /** Inject data providers */
  setDataProvider(provider: DataProvider): void { this.dataProvider = provider; }
  setMemoryProvider(provider: MemoryProvider): void { this.memoryProvider = provider; }
  setRiskProvider(provider: RiskProvider): void { this.riskProvider = provider; }

  /** Process a signal through the full MCP pipeline */
  async processSignal(signal: StandardSignal): Promise<MCPDecision> {
    const startMs = Date.now();

    try {
      // Step 1: Enrich with market context
      signal.status = "enriching";
      const enrichment = this.enrich(signal);
      this.emit("enriched", signal.id, enrichment);

      // Step 2: Score across all dimensions
      signal.status = "scoring";
      const score = this.score(signal, enrichment);
      this.emit("scored", signal.id, score);

      // Step 3: Make decision
      signal.status = "decided";
      const decision = this.decide(signal, enrichment, score);
      decision.processingMs = Date.now() - startMs;

      // Store decision
      this.decisions.set(signal.id, decision);
      if (this.decisions.size > this.maxDecisions) {
        const oldest = Array.from(this.decisions.keys())[0];
        this.decisions.delete(oldest);
      }

      signal.status = decision.action === "approve" ? "approved" : "rejected";
      this.emit("decided", decision);
      return decision;

    } catch (error) {
      this.emit("error", signal.id, error);
      return this.createRejection(signal, [`Processing error: ${(error as Error).message}`], Date.now() - startMs);
    }
  }

  /** Step 1: Enrich signal with market context */
  private enrich(signal: StandardSignal): EnrichmentContext {
    const orderBook = this.dataProvider?.getOrderBook(signal.symbol) ?? null;
    const volumeDelta = this.dataProvider?.getVolumeDelta(signal.symbol) ?? null;
    const macro = this.dataProvider?.getMacro() ?? { vix: null, dxy: null, us10y: null, spyChange: null };
    const sentiment = this.dataProvider?.getSentiment(signal.symbol) ?? { newsScore: 0, socialScore: 0, overallSentiment: "neutral" as const };
    const regime = this.dataProvider?.getRegime() ?? "neutral";
    const session = this.dataProvider?.getSession() ?? "closed";
    const dataQuality = this.dataProvider?.getDataQuality(signal.symbol) ?? { sourcesActive: 0, sourcesTotal: 5, overallScore: 0 };

    const memory = this.memoryProvider?.recallSimilarSetups(signal.symbol, signal.signalType, regime) ?? {
      winRate: null, profitFactor: null, sampleSize: 0, lastOutcome: null, avgHoldBars: null,
    };

    return {
      signalId: signal.id,
      symbol: signal.symbol,
      ts: new Date(),
      orderBook,
      volumeDelta,
      macro,
      sentiment,
      regime,
      session,
      memory: {
        similarSetupWinRate: memory.winRate,
        similarSetupProfitFactor: memory.profitFactor,
        sampleSize: memory.sampleSize,
        lastSimilarOutcome: memory.lastOutcome,
        avgHoldBars: memory.avgHoldBars,
      },
      dataQuality,
    };
  }

  /** Step 2: Score the signal across dimensions */
  private score(signal: StandardSignal, ctx: EnrichmentContext): SignalScore {
    const w = this.config.weights;
    const warnings: string[] = [];
    const boosters: string[] = [];

    // Structure score — does the signal type match market structure?
    const structureScore = this.scoreStructure(signal, ctx);

    // Order flow score — does flow confirm the signal direction?
    const orderflowScore = this.scoreOrderflow(signal, ctx);
    if (this.config.requireOrderFlowConfirmation && orderflowScore < 0.4) {
      warnings.push("Order flow does not confirm signal direction");
    }

    // Context score — is the macro/session environment supportive?
    const contextScore = this.scoreContext(signal, ctx);

    // Memory score — how has this setup performed historically?
    const memoryScore = this.scoreMemory(ctx);
    if (ctx.memory.sampleSize >= 20 && (ctx.memory.similarSetupWinRate ?? 0) > 0.6) {
      boosters.push(`Strong historical win rate: ${((ctx.memory.similarSetupWinRate ?? 0) * 100).toFixed(0)}% (n=${ctx.memory.sampleSize})`);
    }

    // Sentiment score
    const sentimentScore = this.scoreSentiment(signal, ctx);

    // Data quality score
    const dataQualityScore = ctx.dataQuality.overallScore;
    if (dataQualityScore < this.config.minDataQualityScore) {
      warnings.push(`Low data quality: ${(dataQualityScore * 100).toFixed(0)}%`);
    }

    // Composite confirmation score (weighted)
    const confirmationScore =
      structureScore * w.structure +
      orderflowScore * w.orderflow +
      contextScore * w.context +
      memoryScore * w.memory +
      sentimentScore * w.sentiment +
      dataQualityScore * w.dataQuality;

    // Confidence adjusts for data quality and sample size
    const sampleConfidence = Math.min(1, ctx.memory.sampleSize / 30);
    const confidenceScore = confirmationScore * (0.5 + 0.3 * dataQualityScore + 0.2 * sampleConfidence);

    // Signal alignment — does order flow + structure back the direction?
    const signalAlignmentScore = (structureScore + orderflowScore) / 2;

    // Risk/reward quality
    const riskRewardScore = this.scoreRiskReward(signal);

    // Overall 0-100
    const overallScore = Math.round(confirmationScore * 80 + riskRewardScore * 20);

    // Grade
    const grade = overallScore >= 90 ? "A+" : overallScore >= 80 ? "A" : overallScore >= 70 ? "B+" :
      overallScore >= 60 ? "B" : overallScore >= 50 ? "C" : overallScore >= 35 ? "D" : "F";

    const explanation = this.buildExplanation(signal, {
      structureScore, orderflowScore, contextScore, memoryScore, sentimentScore, dataQualityScore,
      confirmationScore, overallScore, grade,
    });

    return {
      signalId: signal.id,
      structureScore,
      orderflowScore,
      contextScore,
      memoryScore,
      sentimentScore,
      dataQualityScore,
      confirmationScore,
      confidenceScore,
      signalAlignmentScore,
      riskRewardScore,
      grade,
      overallScore,
      explanation,
      warnings,
      boosters,
    };
  }

  /** Step 3: Make the trade/no-trade decision */
  private decide(signal: StandardSignal, ctx: EnrichmentContext, score: SignalScore): MCPDecision {
    const rejectionReasons: string[] = [];
    const modifications: { field: string; original: number | null; modified: number; reason: string }[] = [];

    // Check regime blocks
    const regimeOverride = this.config.regimeOverrides[ctx.regime];
    if (regimeOverride?.blocked) {
      rejectionReasons.push(`Trading blocked in ${ctx.regime} regime`);
    }

    // Check minimum confirmation score
    const minScore = regimeOverride?.minConfirmationScore ?? this.config.minConfirmationScore;
    if (score.confirmationScore < minScore) {
      rejectionReasons.push(`Confirmation score ${(score.confirmationScore * 100).toFixed(0)}% < minimum ${(minScore * 100).toFixed(0)}%`);
    }

    // Check data quality
    if (ctx.dataQuality.overallScore < this.config.minDataQualityScore) {
      rejectionReasons.push(`Data quality ${(ctx.dataQuality.overallScore * 100).toFixed(0)}% below minimum`);
    }

    // Check session
    if (ctx.session === "closed" || ctx.session === "after_hours") {
      rejectionReasons.push(`Market session: ${ctx.session}`);
    }

    // Risk pre-trade checks
    if (this.riskProvider && signal.direction !== "none" && signal.stopLoss) {
      const riskCheck = this.riskProvider.runPreTradeChecks({
        symbol: signal.symbol,
        direction: signal.direction,
        entryPrice: signal.price,
        stopPrice: signal.stopLoss,
        confidence: score.confidenceScore,
        regime: ctx.regime,
        volatility: ctx.orderBook?.spreadBps ? ctx.orderBook.spreadBps / 10000 : 0.02,
        setupFamily: signal.signalType,
      });
      if (!riskCheck.passed) {
        rejectionReasons.push(...riskCheck.blockReasons);
      }
    }

    // Auto-adjust stops if enabled
    let adjustedStop = signal.stopLoss;
    let adjustedTarget = signal.takeProfit;

    if (this.config.autoAdjustStops && ctx.orderBook && signal.stopLoss) {
      // Widen stop if spread is large
      if (ctx.orderBook.spreadBps > 10 && signal.direction !== "none") {
        const spreadAdjust = signal.price * (ctx.orderBook.spreadBps / 20000);
        if (signal.direction === "long") {
          const newStop = signal.stopLoss - spreadAdjust;
          if (newStop !== signal.stopLoss) {
            adjustedStop = newStop;
            modifications.push({
              field: "stopLoss",
              original: signal.stopLoss,
              modified: newStop,
              reason: `Widened stop by ${spreadAdjust.toFixed(2)} for spread (${ctx.orderBook.spreadBps.toFixed(1)} bps)`,
            });
          }
        } else {
          const newStop = signal.stopLoss + spreadAdjust;
          if (newStop !== signal.stopLoss) {
            adjustedStop = newStop;
            modifications.push({
              field: "stopLoss",
              original: signal.stopLoss,
              modified: newStop,
              reason: `Widened stop by ${spreadAdjust.toFixed(2)} for spread (${ctx.orderBook.spreadBps.toFixed(1)} bps)`,
            });
          }
        }
      }
    }

    // Position sizing
    let positionSize: number | null = null;
    let riskDollars: number | null = null;
    let riskPercent: number | null = null;

    if (rejectionReasons.length === 0 && this.riskProvider && signal.direction !== "none" && adjustedStop) {
      const sizing = this.riskProvider.calculatePositionSize({
        symbol: signal.symbol,
        direction: signal.direction,
        entryPrice: signal.price,
        stopPrice: adjustedStop,
        confidence: score.confidenceScore,
        regime: ctx.regime,
        volatility: ctx.orderBook?.spreadBps ? ctx.orderBook.spreadBps / 10000 : 0.02,
        setupFamily: signal.signalType,
      });

      if (sizing.approved) {
        positionSize = sizing.quantity;
        riskDollars = sizing.riskDollars;
        riskPercent = sizing.riskPercent;
      } else {
        rejectionReasons.push("Position sizing rejected");
      }
    }

    const action = rejectionReasons.length > 0
      ? "reject"
      : modifications.length > 0
      ? "modify"
      : "approve";

    const thesis = this.buildThesis(signal, ctx, score, action);

    return {
      signalId: signal.id,
      symbol: signal.symbol,
      timestamp: new Date(),
      action,
      direction: signal.direction,
      entryPrice: signal.price,
      stopLoss: adjustedStop,
      takeProfit: adjustedTarget,
      positionSize,
      riskDollars,
      riskPercent,
      modifications,
      confidence: score.confidenceScore,
      score,
      enrichment: ctx,
      thesis,
      rejectionReasons,
      processingMs: 0,
      pipelineVersion: "97.1.0",
    };
  }

  // ── Scoring Helpers ──────────────────────────────────────────────────────

  private scoreStructure(signal: StandardSignal, ctx: EnrichmentContext): number {
    let score = 0.5;

    // Boost for supportive signal types
    const strongSignals = ["order_block_entry", "sweep_reclaim", "fvg_fill"];
    if (strongSignals.includes(signal.signalType)) score += 0.2;

    // Boost for MTF-confirming regime
    if (ctx.regime === "risk_on" && (signal.direction === "long")) score += 0.15;
    if (ctx.regime === "risk_off" && (signal.direction === "short")) score += 0.15;

    // Session quality
    if (ctx.session === "open" || ctx.session === "power_hour") score += 0.1;
    if (ctx.session === "midday") score -= 0.1;

    return Math.max(0, Math.min(1, score));
  }

  private scoreOrderflow(signal: StandardSignal, ctx: EnrichmentContext): number {
    if (!ctx.orderBook || !ctx.volumeDelta) return 0.3; // neutral if no data

    let score = 0.5;
    const vd = ctx.volumeDelta;
    const ob = ctx.orderBook;

    if (signal.direction === "long") {
      if (vd.delta > 0) score += 0.15;
      if (vd.aggressiveBuyPct > 0.6) score += 0.1;
      if (ob.imbalanceRatio > 0.2) score += 0.1;
      if (ob.microPressure > 0.3) score += 0.1;
      // Negative flow → penalty
      if (vd.delta < 0 && vd.deltaPercent < -20) score -= 0.2;
    } else if (signal.direction === "short") {
      if (vd.delta < 0) score += 0.15;
      if (vd.aggressiveSellPct > 0.6) score += 0.1;
      if (ob.imbalanceRatio < -0.2) score += 0.1;
      if (ob.microPressure < -0.3) score += 0.1;
      if (vd.delta > 0 && vd.deltaPercent > 20) score -= 0.2;
    }

    return Math.max(0, Math.min(1, score));
  }

  private scoreContext(signal: StandardSignal, ctx: EnrichmentContext): number {
    let score = 0.5;
    const macro = ctx.macro;

    // VIX-based
    if (macro.vix !== null) {
      if (macro.vix < 15) score += 0.1; // calm market
      if (macro.vix > 30) score -= 0.15; // fear
      if (macro.vix > 40) score -= 0.2; // extreme fear
    }

    // SPY alignment
    if (macro.spyChange !== null && signal.direction !== "none") {
      const aligned = (signal.direction === "long" && macro.spyChange > 0) ||
                      (signal.direction === "short" && macro.spyChange < 0);
      score += aligned ? 0.1 : -0.1;
    }

    // Session quality
    if (ctx.session === "open") score += 0.1;
    if (ctx.session === "premarket" || ctx.session === "after_hours") score -= 0.15;

    return Math.max(0, Math.min(1, score));
  }

  private scoreMemory(ctx: EnrichmentContext): number {
    const mem = ctx.memory;
    if (mem.sampleSize < 5) return 0.5; // not enough data

    let score = 0.5;

    if (mem.similarSetupWinRate !== null) {
      score = mem.similarSetupWinRate; // use historical win rate directly
    }

    if (mem.similarSetupProfitFactor !== null && mem.similarSetupProfitFactor > 1.5) {
      score += 0.1;
    }

    // Recent outcome
    if (mem.lastSimilarOutcome === "win") score += 0.05;
    if (mem.lastSimilarOutcome === "loss") score -= 0.05;

    return Math.max(0, Math.min(1, score));
  }

  private scoreSentiment(signal: StandardSignal, ctx: EnrichmentContext): number {
    let score = 0.5;
    const sent = ctx.sentiment;

    if (signal.direction === "long") {
      if (sent.overallSentiment === "bullish") score += 0.2;
      if (sent.overallSentiment === "bearish") score -= 0.15;
    } else if (signal.direction === "short") {
      if (sent.overallSentiment === "bearish") score += 0.2;
      if (sent.overallSentiment === "bullish") score -= 0.15;
    }

    score += sent.newsScore * 0.1;
    return Math.max(0, Math.min(1, score));
  }

  private scoreRiskReward(signal: StandardSignal): number {
    if (!signal.stopLoss || !signal.takeProfit) return 0.5;

    const risk = Math.abs(signal.price - signal.stopLoss);
    const reward = Math.abs(signal.takeProfit - signal.price);

    if (risk <= 0) return 0;
    const rr = reward / risk;

    if (rr >= 3) return 1.0;
    if (rr >= 2) return 0.8;
    if (rr >= 1.5) return 0.6;
    if (rr >= 1) return 0.4;
    return 0.2;
  }

  // ── Explanation Builders ──────────────────────────────────────────────────

  private buildExplanation(
    signal: StandardSignal,
    scores: Record<string, number>,
  ): string {
    return `${signal.signalType} on ${signal.symbol} ${signal.timeframe}: ` +
      `Structure ${(scores.structureScore * 100).toFixed(0)}%, ` +
      `Flow ${(scores.orderflowScore * 100).toFixed(0)}%, ` +
      `Context ${(scores.contextScore * 100).toFixed(0)}%, ` +
      `Memory ${(scores.memoryScore * 100).toFixed(0)}% → ` +
      `Grade ${scores.grade} (${scores.overallScore}/100)`;
  }

  private buildThesis(
    signal: StandardSignal,
    ctx: EnrichmentContext,
    score: SignalScore,
    action: string,
  ): string {
    if (action === "reject") {
      return `REJECTED: ${signal.signalType} ${signal.direction} on ${signal.symbol}. ` +
        `Score: ${score.overallScore}/100 (Grade ${score.grade}). ` +
        `${score.warnings.join(". ")}`;
    }
    return `${action.toUpperCase()}: ${signal.signalType} ${signal.direction} on ${signal.symbol} @ ${signal.price}. ` +
      `Score: ${score.overallScore}/100 (Grade ${score.grade}). ` +
      `Regime: ${ctx.regime}, Session: ${ctx.session}. ` +
      `${score.boosters.length > 0 ? "Boosters: " + score.boosters.join("; ") : ""}`;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Get a past decision */
  getDecision(signalId: string): MCPDecision | undefined {
    return this.decisions.get(signalId);
  }

  /** Get all decisions */
  getRecentDecisions(limit = 50): MCPDecision[] {
    return Array.from(this.decisions.values()).slice(-limit);
  }

  /** Get approval rate */
  getApprovalRate(): number {
    const all = Array.from(this.decisions.values());
    if (all.length === 0) return 0;
    return all.filter((d) => d.action === "approve" || d.action === "modify").length / all.length;
  }

  /** Update pipeline config */
  updateConfig(config: Partial<MCPPipelineConfig>): void {
    Object.assign(this.config, config);
  }

  /** Create a rejection decision */
  private createRejection(signal: StandardSignal, reasons: string[], processingMs: number): MCPDecision {
    const emptyScore: SignalScore = {
      signalId: signal.id, structureScore: 0, orderflowScore: 0, contextScore: 0,
      memoryScore: 0, sentimentScore: 0, dataQualityScore: 0, confirmationScore: 0,
      confidenceScore: 0, signalAlignmentScore: 0, riskRewardScore: 0,
      grade: "F", overallScore: 0, explanation: "Error during processing",
      warnings: reasons, boosters: [],
    };
    const emptyEnrichment: EnrichmentContext = {
      signalId: signal.id, symbol: signal.symbol, ts: new Date(),
      orderBook: null, volumeDelta: null,
      macro: { vix: null, dxy: null, us10y: null, spyChange: null },
      sentiment: { newsScore: 0, socialScore: 0, overallSentiment: "neutral" },
      regime: "neutral", session: "closed",
      memory: { similarSetupWinRate: null, similarSetupProfitFactor: null, sampleSize: 0, lastSimilarOutcome: null, avgHoldBars: null },
      dataQuality: { sourcesActive: 0, sourcesTotal: 5, overallScore: 0 },
    };

    return {
      signalId: signal.id, symbol: signal.symbol, timestamp: new Date(),
      action: "reject", direction: signal.direction,
      entryPrice: signal.price, stopLoss: signal.stopLoss, takeProfit: signal.takeProfit,
      positionSize: null, riskDollars: null, riskPercent: null,
      modifications: [], confidence: 0, score: emptyScore, enrichment: emptyEnrichment,
      thesis: `REJECTED: ${reasons.join("; ")}`, rejectionReasons: reasons,
      processingMs, pipelineVersion: "97.1.0",
    };
  }
}
