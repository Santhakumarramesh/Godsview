/**
 * engines/daily_review_engine.ts — Daily Review Engine
 *
 * Generates day-by-day trading reviews with findings, plottings, and trade probability analysis.
 * Stores reviews in an in-memory store and provides query/export functions.
 *
 * Exports:
 *   - generateDailyReview(symbol, date, signals, trades, structureData): DailyReview
 *   - saveDailyReview(review): void
 *   - getDailyReview(symbol, date): DailyReview | null
 *   - getDailyReviews(symbol, fromDate?, toDate?): DailyReview[]
 *   - getAllReviews(fromDate?, toDate?): DailyReview[]
 *   - calculateChanceOfTrade(structureData, regime, dayOfWeek): number
 *   - generateStructureSummary(review): string
 *   - clearReviews(): void
 */

/**
 * Market structure bias
 */
export type HTFBias = "bullish" | "bearish" | "ranging";

/**
 * Daily finding type
 */
export type DailyFindingType =
  | "order_block"
  | "structure_break"
  | "pattern"
  | "liquidity_sweep"
  | "zone_test"
  | "confluence";

/**
 * Finding importance level
 */
export type FindingImportance = "high" | "medium" | "low";

/**
 * Individual finding from day's analysis
 */
export interface DailyFinding {
  type: DailyFindingType;
  description: string;
  importance: FindingImportance;
  price: number;
  timeframe: string;
  timestamp: string;
}

/**
 * Key price level on chart
 */
export interface KeyLevel {
  price: number;
  type: string; // "support", "resistance", "pivot", etc.
  timeframe: string;
}

/**
 * Trade probability breakdown for the day
 */
export interface TradeProbability {
  long: number; // 0-1
  short: number; // 0-1
  neutral: number; // 0-1
}

/**
 * Daily review snapshot
 */
export interface DailyReview {
  id: string;
  date: string; // YYYY-MM-DD
  symbol: string;

  // Market structure snapshot for the day
  htfBias: HTFBias;
  keyLevels: KeyLevel[];
  orderBlocksActive: number;
  abcdPatternsActive: number;

  // Day's activity
  signalsGenerated: number;
  tradesExecuted: number;
  tradesWon: number;
  tradesLost: number;
  pnlPct: number;

  // Trade probability for the day
  tradeProbability: TradeProbability;
  chanceOfTrade: number; // 0-100 percentage

  // Findings
  findings: DailyFinding[];

  // Structure summary
  structureSummary: string; // Natural language summary

  createdAt: string;
}

/**
 * In-memory store of all reviews
 * Key format: "YYYY-MM-DD:SYMBOL"
 */
export interface DailyReviewStore {
  reviews: Map<string, DailyReview>;
}

/**
 * Global store
 */
const store: DailyReviewStore = {
  reviews: new Map(),
};

/**
 * Generate a unique ID for the review
 */
function generateReviewId(): string {
  return `review_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

/**
 * Calculate day-of-week from YYYY-MM-DD string (0=Sunday, 6=Saturday)
 */
function getDayOfWeek(dateStr: string): number {
  const date = new Date(`${dateStr}T00:00:00Z`);
  return date.getUTCDay();
}

/**
 * Calculate chance of trade based on structure, regime, and day of week
 * Returns 0-100 percentage
 */
export function calculateChanceOfTrade(structureData: any, regime: string, dayOfWeek: number): number {
  let base = 50; // 50% base probability

  // Adjust for regime
  if (regime === "bullish" || regime === "bearish") {
    base += 20; // 70% in trending regimes
  } else if (regime === "ranging") {
    base -= 10; // 40% in ranging regimes
  }

  // Adjust for day of week (avoid Monday/Friday typically slower)
  if (dayOfWeek === 1 || dayOfWeek === 5) {
    base -= 5;
  }

  // Adjust based on structure data
  if (structureData?.orderBlockDensity > 2) {
    base += 15; // Higher chance with many order blocks
  }

  if (structureData?.volatility === "high") {
    base += 10;
  } else if (structureData?.volatility === "low") {
    base -= 10;
  }

  // Clamp to 0-100
  return Math.max(0, Math.min(100, base));
}

/**
 * Generate natural language summary of day's structure
 */
export function generateStructureSummary(review: DailyReview): string {
  const parts: string[] = [];

  parts.push(`On ${review.date}, ${review.symbol} was ${review.htfBias}.`);

  if (review.keyLevels.length > 0) {
    const supports = review.keyLevels.filter((l) => l.type === "support");
    const resistances = review.keyLevels.filter((l) => l.type === "resistance");
    if (supports.length > 0) {
      parts.push(`Support levels: ${supports.map((s) => s.price).join(", ")}.`);
    }
    if (resistances.length > 0) {
      parts.push(`Resistance levels: ${resistances.map((r) => r.price).join(", ")}.`);
    }
  }

  if (review.orderBlocksActive > 0) {
    parts.push(`${review.orderBlocksActive} order block(s) active.`);
  }

  if (review.abcdPatternsActive > 0) {
    parts.push(`${review.abcdPatternsActive} ABCD pattern(s) forming.`);
  }

  if (review.signalsGenerated > 0) {
    parts.push(`Generated ${review.signalsGenerated} signal(s).`);
  }

  if (review.tradesExecuted > 0) {
    const winRate = review.tradesExecuted > 0 ? ((review.tradesWon / review.tradesExecuted) * 100).toFixed(1) : "0";
    parts.push(`Executed ${review.tradesExecuted} trade(s) with ${winRate}% win rate. PnL: ${review.pnlPct.toFixed(2)}%.`);
  }

  return parts.join(" ");
}

/**
 * Generate daily review for a symbol on a given date
 */
export function generateDailyReview(
  symbol: string,
  date: string, // YYYY-MM-DD
  signals: any[] = [],
  trades: any[] = [],
  structureData: any = {}
): DailyReview {
  const dayOfWeek = getDayOfWeek(date);
  const htfBias = structureData.bias || "ranging";
  const orderBlocksActive = structureData.orderBlockCount || 0;
  const abcdPatternsActive = structureData.abcdCount || 0;

  // Calculate metrics from trades
  const tradesExecuted = trades.length;
  const tradesWon = trades.filter((t: any) => typeof t.pnl === "number" && t.pnl > 0).length;
  const tradesLost = trades.filter((t: any) => typeof t.pnl === "number" && t.pnl <= 0).length;
  const totalPnl = trades.reduce((sum: number, t: any) => sum + (typeof t.pnl === "number" ? t.pnl : 0), 0);
  const accountSize = structureData.accountSize || 10000;
  const pnlPct = (totalPnl / accountSize) * 100;

  // Calculate trade probability
  const chanceOfTrade = calculateChanceOfTrade(structureData, htfBias, dayOfWeek);
  const tradeProbability: TradeProbability = {
    long: htfBias === "bullish" ? 0.6 : htfBias === "bearish" ? 0.2 : 0.4,
    short: htfBias === "bearish" ? 0.6 : htfBias === "bullish" ? 0.2 : 0.4,
    neutral: 0,
  };

  // Build findings from signals and structure
  const findings: DailyFinding[] = [];

  // Add signal-based findings
  signals.forEach((sig: any, idx: number) => {
    if (sig.type === "order_block") {
      findings.push({
        type: "order_block",
        description: `Order block formed at ${sig.price}`,
        importance: sig.strength === "strong" ? "high" : "medium",
        price: sig.price,
        timeframe: sig.timeframe || "4h",
        timestamp: sig.timestamp || new Date().toISOString(),
      });
    }
  });

  // Add structure-based findings
  if (structureData.structureBreak) {
    findings.push({
      type: "structure_break",
      description: "Market structure break detected",
      importance: "high",
      price: structureData.structureBreak.price || 0,
      timeframe: "daily",
      timestamp: new Date().toISOString(),
    });
  }

  if (structureData.liquiditySweep) {
    findings.push({
      type: "liquidity_sweep",
      description: "Liquidity sweep detected at key level",
      importance: "medium",
      price: structureData.liquiditySweep.price || 0,
      timeframe: "4h",
      timestamp: new Date().toISOString(),
    });
  }

  const review: DailyReview = {
    id: generateReviewId(),
    date,
    symbol,
    htfBias,
    keyLevels: structureData.keyLevels || [],
    orderBlocksActive,
    abcdPatternsActive,
    signalsGenerated: signals.length,
    tradesExecuted,
    tradesWon,
    tradesLost,
    pnlPct,
    tradeProbability,
    chanceOfTrade,
    findings,
    structureSummary: "",
    createdAt: new Date().toISOString(),
  };

  // Generate summary
  review.structureSummary = generateStructureSummary(review);

  return review;
}

/**
 * Save review to store
 */
export function saveDailyReview(review: DailyReview): void {
  const key = `${review.date}:${review.symbol}`;
  store.reviews.set(key, review);
}

/**
 * Get single review
 */
export function getDailyReview(symbol: string, date: string): DailyReview | null {
  const key = `${date}:${symbol}`;
  return store.reviews.get(key) || null;
}

/**
 * Get all reviews for a symbol in date range
 */
export function getDailyReviews(symbol: string, fromDate?: string, toDate?: string): DailyReview[] {
  const results: DailyReview[] = [];

  store.reviews.forEach((review, key) => {
    if (review.symbol !== symbol) return;

    if (fromDate && review.date < fromDate) return;
    if (toDate && review.date > toDate) return;

    results.push(review);
  });

  return results.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Get all reviews in date range across all symbols
 */
export function getAllReviews(fromDate?: string, toDate?: string): DailyReview[] {
  const results: DailyReview[] = [];

  store.reviews.forEach((review) => {
    if (fromDate && review.date < fromDate) return;
    if (toDate && review.date > toDate) return;
    results.push(review);
  });

  return results.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Clear all reviews
 */
export function clearReviews(): void {
  store.reviews.clear();
}
