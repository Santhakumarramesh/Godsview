/**
 * Phase 95 — Trade Feedback Loop
 *
 * Analyzes completed trades, extracts lessons, and feeds them back
 * into the brain's memory and strategy parameters.
 *
 * This is the core "learning from experience" engine.
 */

export interface TradeOutcomeInput {
  tradeId: string;
  symbol: string;
  strategyId: string;
  direction: "long" | "short";
  setupFamily: string;
  regime: string;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  quantity: number;
  pnl: number;
  pnlR: number; // P&L in R multiples
  maeR: number;
  mfeR: number;
  holdBars: number;
  entryTime: Date;
  exitTime: Date;
  // Context at entry
  structureScore: number;
  orderflowScore: number;
  contextScore: number;
  memoryScore: number;
  reasoningScore: number;
  riskScore: number;
  confidence: number;
  mtfAligned: boolean;
  session: string;
}

export interface TradeLessonExtracted {
  tradeId: string;
  symbol: string;
  lessonType: "pattern" | "timing" | "sizing" | "regime" | "setup" | "exit";
  severity: "info" | "warning" | "critical";
  description: string;
  actionable: boolean;
  suggestedAdjustment?: ParameterAdjustment;
}

export interface ParameterAdjustment {
  parameter: string;
  currentValue: number;
  suggestedValue: number;
  reason: string;
  confidence: number;
}

export interface FeedbackResult {
  tradeId: string;
  lessons: TradeLessonExtracted[];
  adjustments: ParameterAdjustment[];
  memoryEntry: MemoryEntry | null;
  strategyScore: number; // updated strategy performance score
}

export interface MemoryEntry {
  symbol: string;
  setupFamily: string;
  regime: string;
  direction: "long" | "short";
  outcome: "win" | "loss" | "breakeven";
  pnlR: number;
  confidence: number;
  contextSignature: string; // hash of key conditions at entry
  lesson: string;
}

interface StrategyPerformance {
  trades: number;
  wins: number;
  losses: number;
  totalPnlR: number;
  avgPnlR: number;
  winRate: number;
  profitFactor: number;
  avgMaeR: number;
  avgMfeR: number;
  avgHoldBars: number;
  recentTrend: "improving" | "degrading" | "stable";
}

export class TradeFeedbackLoop {
  private strategyPerformance: Map<string, StrategyPerformance> = new Map();
  private recentTrades: TradeOutcomeInput[] = [];
  private maxRecentTrades = 200;

  /** Process a completed trade and extract feedback */
  processTrade(trade: TradeOutcomeInput): FeedbackResult {
    this.recentTrades.push(trade);
    if (this.recentTrades.length > this.maxRecentTrades) {
      this.recentTrades.shift();
    }

    const lessons = this.extractLessons(trade);
    const adjustments = this.suggestAdjustments(trade, lessons);
    const memoryEntry = this.createMemoryEntry(trade);

    // Update running strategy performance
    this.updateStrategyPerformance(trade);

    const perf = this.strategyPerformance.get(trade.strategyId);
    const strategyScore = perf ? this.computeStrategyScore(perf) : 0.5;

    return {
      tradeId: trade.tradeId,
      lessons,
      adjustments,
      memoryEntry,
      strategyScore,
    };
  }

  /** Extract lessons from a trade outcome */
  private extractLessons(trade: TradeOutcomeInput): TradeLessonExtracted[] {
    const lessons: TradeLessonExtracted[] = [];
    const isWin = trade.pnl > 0;

    // 1. Exit efficiency — did we leave money on the table?
    if (isWin && trade.mfeR > trade.pnlR * 2) {
      lessons.push({
        tradeId: trade.tradeId,
        symbol: trade.symbol,
        lessonType: "exit",
        severity: "warning",
        description: `MFE (${trade.mfeR.toFixed(2)}R) was ${(trade.mfeR / trade.pnlR).toFixed(1)}x actual P&L (${trade.pnlR.toFixed(2)}R). Consider trailing stop or partial exits.`,
        actionable: true,
        suggestedAdjustment: {
          parameter: "take_profit_atr_multiplier",
          currentValue: 3,
          suggestedValue: Math.min(5, trade.mfeR * 0.8),
          reason: "Historically leaving significant profit on the table",
          confidence: 0.6,
        },
      });
    }

    // 2. Stop too tight — MAE suggests stop was too close
    if (!isWin && trade.maeR < -0.5 && trade.mfeR > 0.5) {
      lessons.push({
        tradeId: trade.tradeId,
        symbol: trade.symbol,
        lessonType: "sizing",
        severity: "warning",
        description: `Trade went ${trade.mfeR.toFixed(2)}R in favor before stopping out at ${trade.maeR.toFixed(2)}R. Stop may be too tight.`,
        actionable: true,
        suggestedAdjustment: {
          parameter: "stop_atr_multiplier",
          currentValue: 1.5,
          suggestedValue: 2.0,
          reason: "Trades showing favorable movement before stop-out",
          confidence: 0.5,
        },
      });
    }

    // 3. Regime mismatch
    if (!isWin && (trade.regime === "high_vol" || trade.regime === "risk_off")) {
      lessons.push({
        tradeId: trade.tradeId,
        symbol: trade.symbol,
        lessonType: "regime",
        severity: "critical",
        description: `Loss in ${trade.regime} regime. Setup ${trade.setupFamily} may not be suitable for this regime.`,
        actionable: true,
      });
    }

    // 4. Low confidence but traded
    if (trade.confidence < 0.5) {
      const result = isWin ? "won" : "lost";
      lessons.push({
        tradeId: trade.tradeId,
        symbol: trade.symbol,
        lessonType: "pattern",
        severity: isWin ? "info" : "warning",
        description: `Trade ${result} with low confidence (${(trade.confidence * 100).toFixed(0)}%). Consider raising minimum confidence threshold.`,
        actionable: !isWin,
        suggestedAdjustment: !isWin ? {
          parameter: "min_confirmation_score",
          currentValue: 0.5,
          suggestedValue: 0.6,
          reason: "Low confidence trades are net losers",
          confidence: 0.4,
        } : undefined,
      });
    }

    // 5. Session performance
    if (!isWin && (trade.session === "midday" || trade.session === "after_hours")) {
      lessons.push({
        tradeId: trade.tradeId,
        symbol: trade.symbol,
        lessonType: "timing",
        severity: "info",
        description: `Loss during ${trade.session} session. Review if ${trade.setupFamily} works in low-liquidity periods.`,
        actionable: false,
      });
    }

    // 6. Holding too long
    if (!isWin && trade.holdBars > 50 && trade.mfeR > 0) {
      lessons.push({
        tradeId: trade.tradeId,
        symbol: trade.symbol,
        lessonType: "exit",
        severity: "warning",
        description: `Held ${trade.holdBars} bars, had ${trade.mfeR.toFixed(2)}R MFE but ended as loss. Time-based exit may help.`,
        actionable: true,
      });
    }

    // 7. Score vs outcome mismatch
    const avgScore = (trade.structureScore + trade.orderflowScore + trade.contextScore + trade.memoryScore) / 4;
    if (!isWin && avgScore > 0.7) {
      lessons.push({
        tradeId: trade.tradeId,
        symbol: trade.symbol,
        lessonType: "pattern",
        severity: "critical",
        description: `High scores (avg ${(avgScore * 100).toFixed(0)}%) but trade lost. Possible model overconfidence or missing variable.`,
        actionable: true,
      });
    }

    return lessons;
  }

  /** Suggest parameter adjustments based on recent performance */
  private suggestAdjustments(trade: TradeOutcomeInput, lessons: TradeLessonExtracted[]): ParameterAdjustment[] {
    const adjustments: ParameterAdjustment[] = [];

    // Collect all suggested adjustments from lessons
    for (const lesson of lessons) {
      if (lesson.suggestedAdjustment) {
        adjustments.push(lesson.suggestedAdjustment);
      }
    }

    // Check if recent performance warrants broader adjustments
    const recentForStrategy = this.recentTrades.filter(
      (t) => t.strategyId === trade.strategyId
    ).slice(-20);

    if (recentForStrategy.length >= 10) {
      const recentWinRate = recentForStrategy.filter((t) => t.pnl > 0).length / recentForStrategy.length;

      if (recentWinRate < 0.3) {
        adjustments.push({
          parameter: "min_confirmation_score",
          currentValue: 0.65,
          suggestedValue: 0.75,
          reason: `Recent win rate for ${trade.strategyId} is ${(recentWinRate * 100).toFixed(0)}% (last ${recentForStrategy.length} trades)`,
          confidence: 0.7,
        });
      }
    }

    return adjustments;
  }

  /** Create a memory entry for future recall */
  private createMemoryEntry(trade: TradeOutcomeInput): MemoryEntry {
    const outcome = trade.pnl > 0 ? "win" : trade.pnl < 0 ? "loss" : "breakeven";

    // Create a "context signature" from key conditions
    const sig = [
      trade.setupFamily,
      trade.regime,
      trade.session,
      trade.mtfAligned ? "aligned" : "divergent",
      trade.confidence > 0.7 ? "high_conf" : trade.confidence > 0.5 ? "med_conf" : "low_conf",
    ].join("|");

    return {
      symbol: trade.symbol,
      setupFamily: trade.setupFamily,
      regime: trade.regime,
      direction: trade.direction,
      outcome,
      pnlR: trade.pnlR,
      confidence: trade.confidence,
      contextSignature: sig,
      lesson: this.generateLessonSummary(trade),
    };
  }

  private generateLessonSummary(trade: TradeOutcomeInput): string {
    const outcome = trade.pnl > 0 ? "WIN" : "LOSS";
    return `${outcome} ${trade.pnlR.toFixed(2)}R | ${trade.setupFamily} in ${trade.regime} regime | ` +
      `Conf: ${(trade.confidence * 100).toFixed(0)}% | Hold: ${trade.holdBars} bars | ` +
      `MAE: ${trade.maeR.toFixed(2)}R MFE: ${trade.mfeR.toFixed(2)}R`;
  }

  /** Update running strategy performance */
  private updateStrategyPerformance(trade: TradeOutcomeInput): void {
    const key = trade.strategyId;
    const perf = this.strategyPerformance.get(key) ?? {
      trades: 0, wins: 0, losses: 0, totalPnlR: 0,
      avgPnlR: 0, winRate: 0, profitFactor: 0,
      avgMaeR: 0, avgMfeR: 0, avgHoldBars: 0,
      recentTrend: "stable" as const,
    };

    perf.trades++;
    if (trade.pnl > 0) perf.wins++;
    else perf.losses++;

    perf.totalPnlR += trade.pnlR;
    perf.avgPnlR = perf.totalPnlR / perf.trades;
    perf.winRate = perf.trades > 0 ? perf.wins / perf.trades : 0;

    // Rolling averages
    const alpha = 0.1;
    perf.avgMaeR = perf.avgMaeR * (1 - alpha) + trade.maeR * alpha;
    perf.avgMfeR = perf.avgMfeR * (1 - alpha) + trade.mfeR * alpha;
    perf.avgHoldBars = perf.avgHoldBars * (1 - alpha) + trade.holdBars * alpha;

    // Detect trend
    const recent10 = this.recentTrades.filter((t) => t.strategyId === key).slice(-10);
    const older10 = this.recentTrades.filter((t) => t.strategyId === key).slice(-20, -10);

    if (recent10.length >= 5 && older10.length >= 5) {
      const recentAvg = recent10.reduce((s, t) => s + t.pnlR, 0) / recent10.length;
      const olderAvg = older10.reduce((s, t) => s + t.pnlR, 0) / older10.length;
      if (recentAvg > olderAvg * 1.2) perf.recentTrend = "improving";
      else if (recentAvg < olderAvg * 0.8) perf.recentTrend = "degrading";
      else perf.recentTrend = "stable";
    }

    this.strategyPerformance.set(key, perf);
  }

  /** Compute overall strategy score (0-1) */
  private computeStrategyScore(perf: StrategyPerformance): number {
    const winRateScore = Math.min(1, perf.winRate / 0.6);
    const pnlScore = Math.min(1, Math.max(0, (perf.avgPnlR + 1) / 2));
    const trendBonus = perf.recentTrend === "improving" ? 0.1 : perf.recentTrend === "degrading" ? -0.1 : 0;
    const sampleConfidence = Math.min(1, perf.trades / 30);

    return Math.max(0, Math.min(1,
      (winRateScore * 0.3 + pnlScore * 0.4 + sampleConfidence * 0.3) + trendBonus
    ));
  }

  /** Get performance summary for a strategy */
  getStrategyPerformance(strategyId: string): StrategyPerformance | undefined {
    return this.strategyPerformance.get(strategyId);
  }

  /** Get all strategy performances */
  getAllPerformances(): Map<string, StrategyPerformance> {
    return new Map(this.strategyPerformance);
  }

  /** Get recent trade history */
  getRecentTrades(limit = 50): TradeOutcomeInput[] {
    return this.recentTrades.slice(-limit);
  }
}
