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