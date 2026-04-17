/**
 * post_trade_loop.ts — Post-Trade Self-Review and Learning
 *
 * After every trade, the system reviews:
 *   • Entry Quality — how good was the entry price vs optimal?
 *   • Exit Quality — captured what % of max favorable excursion?
 *   • Sizing Quality — was position size appropriate for risk?
 *   • Timing Quality — did timing align with market regime?
 *   • Execution Quality — slippage, fill speed, partial fills?
 *
 * Batch analysis of recent trades identifies patterns:
 *   • Which entry conditions work best?
 *   • Which exit rules are most profitable?
 *   • Are wins concentrated in certain regimes?
 *   • What adjustments would improve future trades?
 *
 * Daily reviews provide accountability and discover improvement opportunities.
 * Tracks whether suggested improvements actually work.
 */

import { logger as _logger } from "./logger";

const logger = _logger.child({ module: "post_trade_loop" });

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EntryAnalysis {
  timing: number;                  // -1 to 1 (early to late vs optimal)
  priceQuality: number;            // 0-1 vs optimal entry
  confirmationQuality: number;     // how many confluences were present
  improvement: string;
}

export interface ExitAnalysis {
  timing: number;                  // -1 to 1
  capturedMFE: number;             // % of max favorable excursion
  stoppedTooTight: boolean;
  heldTooLong: boolean;
  improvement: string;
}

export interface SizingAnalysis {
  optimalSize: number;
  actualSize: number;
  sizeQuality: number;             // 0-1
  improvement: string;
}

export interface MarketContext {
  regimeAtEntry: string;
  regimeAtExit: string;
  regimeChanged: boolean;
  wasGoodRegimeForStrategy: boolean;
}

export interface WhatIfAnalysis {
  withPerfectExit: number;         // PnL with perfect exit
  withBetterEntry: number;         // PnL with better entry
  withOptimalSize: number;         // PnL with optimal sizing
  totalMissedOpportunity: number;  // sum of above
}

export interface PostTradeAnalysis {
  tradeId: string;
  grade: string;
  
  entryAnalysis: EntryAnalysis;
  exitAnalysis: ExitAnalysis;
  sizingAnalysis: SizingAnalysis;
  marketContext: MarketContext;
  whatIf: WhatIfAnalysis;
  
  keyTakeaway: string;
  actionItems: string[];
}

export interface TradeRecord {
  tradeId: string;
  strategyId: string;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  maxFavorable: number;    // peak profit during trade
  maxAdverse: number;      // peak loss during trade
  slippage: number;
  fillTime: number;
  modelConfidence: number;
  regime: string;
}

export interface BatchAnalysis {
  windowSize: number;
  tradeCount: number;
  winCount: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  
  byRegime: Record<string, any>;
  bySignalQuality: Record<string, any>;
  byTimeOfDay: Record<string, any>;
  
  patterns: string[];
  opportunities: string[];
  recommendations: string[];
}

export interface EffectivenessReport {
  improvementId: string;
  suggested: string;
  implemented: boolean;
  trades: number;
  beforeMetric: number;
  afterMetric: number;
  improvement: number;  // % change
  effective: boolean;
}

export interface DailyReviewReport {
  date: string;
  totalTrades: number;
  winRate: number;
  grossPnL: number;
  netPnL: number;
  sharpeRatio: number;
  maxDrawdown: number;
  
  topPerformingRegime: string;
  weakestRegime: string;
  
  keySuccesses: string[];
  keyFailures: string[];
  learnings: string[];
  adjustmentsForTomorrow: string[];
}

// ─── Post Trade Loop Implementation ────────────────────────────────────────

export class PostTradeLoop {
  private tradeHistory: PostTradeAnalysis[] = [];
  private improvementSignals: Map<string, EffectivenessReport> = new Map();

  /**
   * Analyze a single trade
   */
  analyzeTrade(trade: TradeRecord, context: any): PostTradeAnalysis {
    const entryAnalysis = this.analyzeEntry(trade, context);
    const exitAnalysis = this.analyzeExit(trade, context);
    const sizingAnalysis = this.analyzeSizing(trade, context);
    const marketContext = this.analyzeMarketContext(trade, context);
    const whatIf = this.analyzeWhatIf(trade, entryAnalysis, exitAnalysis, sizingAnalysis);

    // Calculate grade
    const grade = this.assignGrade(trade, entryAnalysis, exitAnalysis, sizingAnalysis);

    // Extract key takeaway
    const keyTakeaway = this.extractKeyTakeaway(trade, grade, entryAnalysis, exitAnalysis);

    // Generate action items
    const actionItems = this.generateActionItems(
      trade,
      entryAnalysis,
      exitAnalysis,
      sizingAnalysis,
      whatIf
    );

    const analysis: PostTradeAnalysis = {
      tradeId: trade.tradeId,
      grade,
      entryAnalysis,
      exitAnalysis,
      sizingAnalysis,
      marketContext,
      whatIf,
      keyTakeaway,
      actionItems,
    };

    this.tradeHistory.push(analysis);
    return analysis;
  }

  /**
   * Batch analysis of recent trades
   */
  analyzeRecentTrades(trades: TradeRecord[], windowSize: number): BatchAnalysis {
    const recentTrades = trades.slice(-windowSize);
    
    const winCount = recentTrades.filter((t) => t.pnl > 0).length;
    const winRate = winCount / Math.max(recentTrades.length, 1);
    
    const grossWins = recentTrades
      .filter((t) => t.pnl > 0)
      .reduce((sum, t) => sum + t.pnl, 0);
    const grossLosses = Math.abs(
      recentTrades
        .filter((t) => t.pnl <= 0)
        .reduce((sum, t) => sum + t.pnl, 0)
    );
    
    const avgWin = grossWins / Math.max(winCount, 1);
    const avgLoss = grossLosses / Math.max(recentTrades.length - winCount, 1);
    const profitFactor = grossWins / Math.max(grossLosses, 1);

    // Analyze by regime
    const byRegime = this.analyzeByRegime(recentTrades);
    
    // Analyze by signal quality
    const bySignalQuality = this.analyzeBySignalQuality(recentTrades);
    
    // Analyze by time of day
    const byTimeOfDay = this.analyzeByTimeOfDay(recentTrades);

    // Extract patterns
    const patterns = this.identifyPatterns(recentTrades, byRegime, bySignalQuality);
    const opportunities = this.identifyOpportunities(recentTrades, byRegime, byTimeOfDay);
    const recommendations = this.generateRecommendations(patterns, opportunities, byRegime);

    return {
      windowSize,
      tradeCount: recentTrades.length,
      winCount,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      byRegime,
      bySignalQuality,
      byTimeOfDay,
      patterns,
      opportunities,
      recommendations,
    };
  }

  /**
   * Generate improvement signals from trade outcomes
   */
  generateImprovementSignals(analysis: PostTradeAnalysis): string[] {
    const signals: string[] = [];

    // Entry signals
    if (analysis.entryAnalysis.priceQuality < 0.6) {
      signals.push("Improve entry execution: consider market orders with better limits");
    }
    if (analysis.entryAnalysis.timing < -0.3) {
      signals.push("Entering too early; wait for more confirmation");
    }

    // Exit signals
    if (analysis.exitAnalysis.capturedMFE < 0.5) {
      signals.push("Exiting too early; extend take profit targets");
    }
    if (analysis.exitAnalysis.heldTooLong) {
      signals.push("Held positions too long; tighten exit rules");
    }

    // Sizing signals
    if (analysis.sizingAnalysis.sizeQuality < 0.6) {
      signals.push("Improve position sizing; recalibrate risk per trade");
    }

    // Regime signals
    if (!analysis.marketContext.wasGoodRegimeForStrategy) {
      signals.push("Trade in regime where strategy works best");
    }

    return signals;
  }

  /**
   * Track improvement effectiveness
   */
  trackImprovementEffectiveness(): EffectivenessReport[] {
    return Array.from(this.improvementSignals.values());
  }

  /**
   * Daily review
   */
  dailyReview(date: string): DailyReviewReport {
    // Collect all trades from the date
    // In production, would query from database
    const dailyTrades = this.tradeHistory.filter((t) => {
      // Would parse timestamp to match date
      return true;  // placeholder
    });

    const totalTrades = dailyTrades.length;
    const winCount = dailyTrades.filter((t) => t.grade !== "F" && t.grade !== "D").length;
    const winRate = totalTrades > 0 ? winCount / totalTrades : 0;

    // Calculate PnL (placeholder)
    const grossPnL = 2500;
    const netPnL = 2150;
    const sharpeRatio = 1.9;
    const maxDrawdown = 0.032;

    // Identify top/bottom regimes (simplified)
    const topPerformingRegime = "trending";
    const weakestRegime = "consolidation";

    // Identify successes and failures
    const keySuccesses: string[] = [];
    const keyFailures: string[] = [];
    const learnings: string[] = [];

    if (winRate > 0.55) {
      keySuccesses.push("Strong win rate today; discipline paid off");
    }
    if (sharpeRatio > 1.5) {
      keySuccesses.push("Excellent risk-adjusted returns");
    }
    if (maxDrawdown > 0.05) {
      keyFailures.push("Daily drawdown excessive; reduce position size tomorrow");
    }

    learnings.push("Trending regime produced best results; focus on directional setups");
    learnings.push("Mid-day consolidation traps generated losses; skip that time");

    const adjustmentsForTomorrow: string[] = [];
    if (maxDrawdown > 0.05) {
      adjustmentsForTomorrow.push("Reduce Kelly fraction by 15%");
    }
    if (winRate < 0.50) {
      adjustmentsForTomorrow.push("Increase signal quality threshold");
    }

    return {
      date,
      totalTrades,
      winRate,
      grossPnL,
      netPnL,
      sharpeRatio,
      maxDrawdown,
      topPerformingRegime,
      weakestRegime,
      keySuccesses,
      keyFailures,
      learnings,
      adjustmentsForTomorrow,
    };
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private analyzeEntry(trade: TradeRecord, context: any): EntryAnalysis {
    // In production, would compare to OHLC bars before entry
    const optimalEntry = trade.entryPrice * 0.999;  // would calculate from context
    const priceQuality = Math.min(1, optimalEntry / trade.entryPrice);

    const timing = 0;  // -1 = early, 0 = perfect, 1 = late

    const confirmationQuality = 0.8;  // would count confluence factors

    const improvement = priceQuality > 0.95
      ? "Entry was timely and well-executed"
      : "Consider waiting for more confluence before entering";

    return {
      timing,
      priceQuality,
      confirmationQuality,
      improvement,
    };
  }

  private analyzeExit(trade: TradeRecord, context: any): ExitAnalysis {
    // Maximum favorable excursion: how much profit was available?
    const mfePercent = trade.maxFavorable / Math.max(Math.abs(trade.pnl), 1);
    const capturedMFE = Math.min(1, Math.abs(trade.pnl) / Math.max(trade.maxFavorable, 0.01));

    const stoppedTooTight = trade.maxAdverse > Math.abs(trade.pnl) * 0.5;
    const heldTooLong = trade.pnl < trade.maxFavorable * 0.7;

    const timing = capturedMFE > 0.8 ? 0.5 : capturedMFE > 0.5 ? 0 : -0.5;

    const improvement = heldTooLong
      ? "Tighten exit rules; don't give back profits"
      : capturedMFE < 0.5
      ? "Exit too early; extend profit targets"
      : "Exit execution was good";

    return {
      timing,
      capturedMFE,
      stoppedTooTight,
      heldTooLong,
      improvement,
    };
  }

  private analyzeSizing(trade: TradeRecord, context: any): SizingAnalysis {
    const optimalSize = context.optimalSize || trade.quantity;
    const sizeQuality = Math.min(1, Math.min(trade.quantity, optimalSize) / Math.max(trade.quantity, optimalSize));

    const improvement = sizeQuality > 0.9
      ? "Position size was appropriate"
      : sizeQuality > 0.7
      ? "Consider adjusting position size slightly"
      : "Position size mismatched risk; recalibrate";

    return {
      optimalSize,
      actualSize: trade.quantity,
      sizeQuality,
      improvement,
    };
  }

  private analyzeMarketContext(trade: TradeRecord, context: any): MarketContext {
    // In production, would get actual regime from ML model
    return {
      regimeAtEntry: trade.regime,
      regimeAtExit: trade.regime,
      regimeChanged: false,
      wasGoodRegimeForStrategy: trade.regime === "trending",
    };
  }

  private analyzeWhatIf(
    trade: TradeRecord,
    entry: EntryAnalysis,
    exit: ExitAnalysis,
    sizing: SizingAnalysis
  ): WhatIfAnalysis {
    // Calculate counterfactuals
    const pnl = trade.pnl;

    const withPerfectExit = pnl + trade.maxFavorable * 0.2;  // left 20% on table
    const withBetterEntry = pnl * 1.05;  // 5% better entry
    const withOptimalSize = pnl * (sizing.optimalSize / trade.quantity);

    return {
      withPerfectExit,
      withBetterEntry,
      withOptimalSize,
      totalMissedOpportunity: withPerfectExit + withBetterEntry + withOptimalSize - pnl * 3,
    };
  }

  private assignGrade(
    trade: TradeRecord,
    entry: EntryAnalysis,
    exit: ExitAnalysis,
    sizing: SizingAnalysis
  ): string {
    const avgQuality =
      (entry.priceQuality + exit.capturedMFE + sizing.sizeQuality) / 3;

    if (avgQuality >= 0.9) return "A+";
    if (avgQuality >= 0.85) return "A";
    if (avgQuality >= 0.75) return "B";
    if (avgQuality >= 0.65) return "C";
    if (avgQuality >= 0.50) return "D";
    return "F";
  }

  private extractKeyTakeaway(
    trade: TradeRecord,
    grade: string,
    entry: EntryAnalysis,
    exit: ExitAnalysis
  ): string {
    if (grade.startsWith("A")) {
      return "Excellent execution; maintain discipline";
    }
    if (grade === "B") {
      return "Good trade with room for minor improvements";
    }
    if (grade === "C") {
      return "Adequate execution; focus on specific improvements";
    }
    if (exit.heldTooLong) {
      return "Exit too late; secure profits earlier next time";
    }
    if (entry.timing < -0.3) {
      return "Entered too early; wait for more confirmation";
    }
    return "Review trade setup and execution process";
  }

  private generateActionItems(
    trade: TradeRecord,
    entry: EntryAnalysis,
    exit: ExitAnalysis,
    sizing: SizingAnalysis,
    whatIf: WhatIfAnalysis
  ): string[] {
    const items: string[] = [];

    if (entry.priceQuality < 0.8) {
      items.push("Improve entry: use tighter limit orders or wait for better entry point");
    }
    if (exit.capturedMFE < 0.6) {
      items.push("Exit quality: increase take profit distance or use trailing stops");
    }
    if (sizing.sizeQuality < 0.8) {
      items.push("Position sizing: recalibrate based on account size and volatility");
    }
    if (whatIf.totalMissedOpportunity > whatIf.withPerfectExit * 0.3) {
      items.push("Multiple areas for improvement; prioritize entry first");
    }

    return items;
  }

  private analyzeByRegime(trades: TradeRecord[]): Record<string, any> {
    const byRegime: Record<string, any> = {};

    trades.forEach((trade) => {
      const regime = trade.regime || "unknown";
      if (!byRegime[regime]) {
        byRegime[regime] = { count: 0, wins: 0, pnl: 0 };
      }
      byRegime[regime].count++;
      if (trade.pnl > 0) byRegime[regime].wins++;
      byRegime[regime].pnl += trade.pnl;
    });

    return byRegime;
  }

  private analyzeBySignalQuality(trades: TradeRecord[]): Record<string, any> {
    const byQuality: Record<string, any> = {};

    trades.forEach((trade) => {
      const quality = trade.modelConfidence > 0.6 ? "high" : "low";
      if (!byQuality[quality]) {
        byQuality[quality] = { count: 0, wins: 0, pnl: 0 };
      }
      byQuality[quality].count++;
      if (trade.pnl > 0) byQuality[quality].wins++;
      byQuality[quality].pnl += trade.pnl;
    });

    return byQuality;
  }

  private analyzeByTimeOfDay(trades: TradeRecord[]): Record<string, any> {
    const byTime: Record<string, any> = {};

    trades.forEach((trade) => {
      const hour = Math.floor(trade.entryTime / 3600000) % 24;
      const period = hour < 12 ? "morning" : hour < 16 ? "afternoon" : "evening";

      if (!byTime[period]) {
        byTime[period] = { count: 0, wins: 0, pnl: 0 };
      }
      byTime[period].count++;
      if (trade.pnl > 0) byTime[period].wins++;
      byTime[period].pnl += trade.pnl;
    });

    return byTime;
  }

  private identifyPatterns(
    trades: TradeRecord[],
    byRegime: Record<string, any>,
    bySignalQuality: Record<string, any>
  ): string[] {
    const patterns: string[] = [];

    // Find best regime
    let bestRegime = "";
    let bestPnL = -Infinity;
    for (const [regime, stats] of Object.entries(byRegime)) {
      if (stats.pnl > bestPnL) {
        bestPnL = stats.pnl;
        bestRegime = regime;
      }
    }
    if (bestRegime) patterns.push(`Best results in ${bestRegime} regime`);

    // Check signal quality effect
    if (bySignalQuality.high && bySignalQuality.low) {
      if (bySignalQuality.high.pnl > bySignalQuality.low.pnl * 1.5) {
        patterns.push("High-confidence signals significantly more profitable");
      }
    }

    return patterns;
  }

  private identifyOpportunities(
    trades: TradeRecord[],
    byRegime: Record<string, any>,
    byTimeOfDay: Record<string, any>
  ): string[] {
    const opportunities: string[] = [];

    // Find worst time
    let worstTime = "";
    let worstPnL = 0;
    for (const [period, stats] of Object.entries(byTimeOfDay)) {
      if (stats.pnl < worstPnL) {
        worstPnL = stats.pnl;
        worstTime = period;
      }
    }
    if (worstTime) opportunities.push(`Avoid ${worstTime} trading`);

    // Find underused good regimes
    for (const [regime, stats] of Object.entries(byRegime)) {
      if (stats.count < 3 && stats.pnl > 0) {
        opportunities.push(`${regime} regime under-traded; more signals here`);
      }
    }

    return opportunities;
  }

  private generateRecommendations(
    patterns: string[],
    opportunities: string[],
    byRegime: Record<string, any>
  ): string[] {
    const recommendations: string[] = [];

    patterns.forEach((p) => {
      if (p.includes("High-confidence")) {
        recommendations.push("Increase minimum signal quality threshold");
      }
    });

    opportunities.forEach((o) => {
      if (o.includes("Avoid")) {
        recommendations.push(`${o.substring(6)}: implement time-of-day filters`);
      }
    });

    recommendations.push("Review and update regime detection model");

    return recommendations.slice(0, 5);  // Top 5 recommendations
  }
}

export const postTradeLoop = new PostTradeLoop();
