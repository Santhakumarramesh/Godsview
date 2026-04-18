/**
 * market_dna.ts — Market DNA Engine
 * 
 * Computes per-stock personality traits from historical price action
 * and SI decision history. These traits help the Brain visualization
 * and SI engine understand each instrument's behavioral signature.
 *
 * Traits computed:
 *   trendiness        — how often does this stock follow through on moves (0-100)
 *   fakeout_risk      — probability of false breakouts (0-100)
 *   breakout_quality  — historical breakout success rate (0-100)
 *   spread_stability  — how stable are spreads / execution conditions (0-100)
 *   news_sensitivity  — reactivity to high-volume events (0-100)
 *   momentum_persistence — how long do momentum moves last (0-100)
 *   mean_reversion    — tendency to revert after extreme moves (0-100)
 *   volatility_regime — current vol state: low / medium / high / extreme
 */

import { db } from "@workspace/db";
import { siDecisionsTable } from "@workspace/db";
import { desc, eq, and, gte, sql } from "@workspace/db";
import { logger } from "./logger";

export interface MarketDNA {
  symbol: string;
  trendiness: number;
  fakeout_risk: number;
  breakout_quality: number;
  spread_stability: number;
  news_sensitivity: number;
  momentum_persistence: number;
  mean_reversion: number;
  volatility_regime: "low" | "medium" | "high" | "extreme";
  computed_at: string;
  bar_count: number;
  decision_count: number;
}

// In-memory cache with TTL
const dnaCache = new Map<string, { dna: MarketDNA; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Compute Market DNA for a symbol from bar data.
 * bars should be 1-minute OHLCV with at least 200 bars.
 */
export function computeMarketDNA(
  symbol: string,
  bars: Array<{ open: number; high: number; low: number; close: number; volume: number; timestamp?: string }>,
  siDecisionStats?: { total: number; approved: number; win_rate: number; avg_quality: number },
): MarketDNA {
  if (bars.length < 10) {
    return defaultDNA(symbol);
  }

  const n = bars.length;

  // ── Trendiness: % of bars that follow through in the same direction as prior bar
  let followThroughs = 0;
  for (let i = 1; i < n; i++) {
    const prevDir = bars[i - 1].close >= bars[i - 1].open ? 1 : -1;
    const currDir = bars[i].close >= bars[i].open ? 1 : -1;
    if (currDir === prevDir) followThroughs++;
  }
  const trendiness = Math.round((followThroughs / (n - 1)) * 100);

  // ── Fakeout Risk: % of bars where price breaks high/low then reverses
  let fakeouts = 0;
  for (let i = 1; i < n; i++) {
    const prevRange = bars[i - 1].high - bars[i - 1].low;
    if (prevRange < 0.0001) continue;
    // Broke above prev high but closed below prev close
    const brokeHigh = bars[i].high > bars[i - 1].high && bars[i].close < bars[i - 1].close;
    // Broke below prev low but closed above prev close
    const brokeLow = bars[i].low < bars[i - 1].low && bars[i].close > bars[i - 1].close;
    if (brokeHigh || brokeLow) fakeouts++;
  }
  const fakeout_risk = Math.round((fakeouts / (n - 1)) * 100);

  // ── Breakout Quality: when price breaks a 20-bar high/low, how often does it follow through 5+ bars
  const lookback = 20;
  const followBars = 5;
  let breakouts = 0;
  let goodBreakouts = 0;
  for (let i = lookback; i < n - followBars; i++) {
    const windowHigh = Math.max(...bars.slice(i - lookback, i).map((b) => b.high));
    const windowLow = Math.min(...bars.slice(i - lookback, i).map((b) => b.low));
    
    if (bars[i].close > windowHigh) {
      breakouts++;
      // Check if price stayed above breakout level for followBars
      const held = bars.slice(i + 1, i + 1 + followBars).every((b) => b.close > windowHigh * 0.998);
      if (held) goodBreakouts++;
    } else if (bars[i].close < windowLow) {
      breakouts++;
      const held = bars.slice(i + 1, i + 1 + followBars).every((b) => b.close < windowLow * 1.002);
      if (held) goodBreakouts++;
    }
  }
  const breakout_quality = breakouts > 0 ? Math.round((goodBreakouts / breakouts) * 100) : 50;

  // ── Spread Stability: inverse of range volatility std dev (normalized)
  const ranges = bars.map((b) => (b.high - b.low) / ((b.open + b.close) / 2));
  const avgRange = ranges.reduce((s, r) => s + r, 0) / n;
  const rangeStd = Math.sqrt(ranges.reduce((s, r) => s + (r - avgRange) ** 2, 0) / n);
  const cv = avgRange > 0 ? rangeStd / avgRange : 0;
  const spread_stability = Math.round(Math.max(0, Math.min(100, (1 - cv) * 100)));

  // ── News Sensitivity: % of bars with volume > 2× average (proxy for event-driven moves)
  const avgVol = bars.reduce((s, b) => s + b.volume, 0) / n;
  const highVolBars = bars.filter((b) => b.volume > avgVol * 2).length;
  const news_sensitivity = Math.round((highVolBars / n) * 100);

  // ── Momentum Persistence: average consecutive same-direction bars
  let runs: number[] = [];
  let currentRun = 1;
  for (let i = 1; i < n; i++) {
    const prevDir = bars[i - 1].close >= bars[i - 1].open;
    const currDir = bars[i].close >= bars[i].open;
    if (currDir === prevDir) {
      currentRun++;
    } else {
      runs.push(currentRun);
      currentRun = 1;
    }
  }
  runs.push(currentRun);
  const avgRun = runs.reduce((s, r) => s + r, 0) / runs.length;
  const momentum_persistence = Math.round(Math.min(100, (avgRun / 5) * 100));

  // ── Mean Reversion: after a 2-std move, how often does price revert within 5 bars
  const returns = bars.slice(1).map((b, i) => (b.close - bars[i].close) / bars[i].close);
  const avgRet = returns.reduce((s, r) => s + r, 0) / returns.length;
  const retStd = Math.sqrt(returns.reduce((s, r) => s + (r - avgRet) ** 2, 0) / returns.length);
  let extremeMoves = 0;
  let reverted = 0;
  for (let i = 0; i < returns.length - 5; i++) {
    if (Math.abs(returns[i]) > 2 * retStd) {
      extremeMoves++;
      const direction = returns[i] > 0 ? 1 : -1;
      const reverts = returns.slice(i + 1, i + 6).some((r) => Math.sign(r) === -direction);
      if (reverts) reverted++;
    }
  }
  const mean_reversion = extremeMoves > 0 ? Math.round((reverted / extremeMoves) * 100) : 50;

  // ── Volatility Regime
  const recentRanges = ranges.slice(-20);
  const recentAvgRange = recentRanges.reduce((s, r) => s + r, 0) / recentRanges.length;
  const volatility_regime: MarketDNA["volatility_regime"] =
    recentAvgRange < avgRange * 0.6 ? "low" :
    recentAvgRange < avgRange * 1.0 ? "medium" :
    recentAvgRange < avgRange * 1.6 ? "high" : "extreme";

  // Adjust breakout quality with SI decision stats if available
  let adjustedBreakoutQuality = breakout_quality;
  if (siDecisionStats && siDecisionStats.total > 10) {
    adjustedBreakoutQuality = Math.round(
      breakout_quality * 0.6 + siDecisionStats.win_rate * 100 * 0.4
    );
  }

  return {
    symbol,
    trendiness,
    fakeout_risk,
    breakout_quality: adjustedBreakoutQuality,
    spread_stability,
    news_sensitivity,
    momentum_persistence,
    mean_reversion,
    volatility_regime,
    computed_at: new Date().toISOString(),
    bar_count: n,
    decision_count: siDecisionStats?.total ?? 0,
  };
}

/**
 * Get SI decision stats for a symbol from the database
 */
export async function getSIDecisionStats(symbol: string): Promise<{
  total: number;
  approved: number;
  win_rate: number;
  avg_quality: number;
} | null> {
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days
    const rows = await db
      .select({
        total: sql<number>`count(*)::int`,
        approved: sql<number>`count(*) filter (where ${siDecisionsTable.approved} = true)::int`,
        wins: sql<number>`count(*) filter (where ${siDecisionsTable.outcome} = 'win')::int`,
        avg_quality: sql<number>`coalesce(avg(${siDecisionsTable.final_quality}), 0)::float`,
      })
      .from(siDecisionsTable)
      .where(
        and(
          eq(siDecisionsTable.symbol, symbol),
          gte(siDecisionsTable.created_at, cutoff),
        ),
      );

    if (!rows[0] || rows[0].total === 0) return null;

    const r = rows[0];
    return {
      total: r.total,
      approved: r.approved,
      win_rate: r.approved > 0 ? r.wins / r.approved : 0,
      avg_quality: r.avg_quality,
    };
  } catch (err) {
    logger.warn({ err, symbol }, "Failed to fetch SI decision stats for Market DNA");
    return null;
  }
}

/**
 * Get cached or compute Market DNA for a symbol
 */
export async function getMarketDNA(
  symbol: string,
  bars: Array<{ open: number; high: number; low: number; close: number; volume: number }>,
): Promise<MarketDNA> {
  const cached = dnaCache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.dna;
  }

  const stats = await getSIDecisionStats(symbol);
  const dna = computeMarketDNA(symbol, bars, stats ?? undefined);

  dnaCache.set(symbol, { dna, expiresAt: Date.now() + CACHE_TTL_MS });
  return dna;
}

function defaultDNA(symbol: string): MarketDNA {
  return {
    symbol,
    trendiness: 50,
    fakeout_risk: 50,
    breakout_quality: 50,
    spread_stability: 50,
    news_sensitivity: 50,
    momentum_persistence: 50,
    mean_reversion: 50,
    volatility_regime: "medium",
    computed_at: new Date().toISOString(),
    bar_count: 0,
    decision_count: 0,
  };
}

/**
 * Clear the DNA cache (e.g., on regime change)
 */
export function clearDNACache(symbol?: string): void {
  if (symbol) {
    dnaCache.delete(symbol);
  } else {
    dnaCache.clear();
  }
}
