/**
 * setup_memory.ts — Setup Memory Engine
 * 
 * Queries historical SI decisions to build pattern memory:
 * - Similar setup recognition (same setup_type + regime + direction)
 * - Win rate / profit factor computation
 * - Setup decay detection (performance degrading over time)
 * - Confidence calibration (was SI's confidence accurate?)
 *
 * Powers the "Setup Memory" panel in the Brain drawer.
 */

import { db } from "@workspace/db";
import { siDecisionsTable } from "@workspace/db";
import { desc, eq, and, gte, sql } from "drizzle-orm";
import { logger } from "./logger";

type SIDecisionRow = {
  symbol: string;
  setup_type: string | null;
  direction: string | null;
  regime: string | null;
  approved: boolean | null;
  win_probability: string | null;
  edge_score: string | null;
  final_quality: string | null;
  outcome: string | null;
  realized_pnl: string | null;
  created_at: Date;
  [key: string]: unknown;
};

export interface SetupMemory {
  symbol: string;
  setup_type: string;
  direction: string;
  similar_setups: number;
  win_rate: number;
  profit_factor: number;
  avg_confidence: number;
  avg_edge_score: number;
  avg_quality: number;
  total_pnl: number;
  recent_win_rate: number;  // last 10 setups
  decay_detected: boolean;
  decay_rate: number;       // 0 = no decay, 1 = severe decay
  best_regime: string | null;
  worst_regime: string | null;
  computed_at: string;
}

export interface SetupMemorySummary {
  symbol: string;
  total_decisions: number;
  total_approved: number;
  total_with_outcome: number;
  overall_win_rate: number;
  overall_profit_factor: number;
  by_setup: SetupMemory[];
  top_setups: SetupMemory[];
  decaying_setups: SetupMemory[];
  computed_at: string;
}

// Cache
const memoryCache = new Map<string, { data: SetupMemorySummary; expiresAt: number }>();
const CACHE_TTL_MS = 3 * 60 * 1000;

/**
 * Get setup memory for a symbol by querying SI decisions history
 */
export async function getSetupMemory(symbol: string): Promise<SetupMemorySummary> {
  const cached = memoryCache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  try {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days

    // Fetch all decisions for this symbol
    const decisions: SIDecisionRow[] = (await db
      .select()
      .from(siDecisionsTable)
      .where(
        and(
          eq(siDecisionsTable.symbol, symbol),
          gte(siDecisionsTable.created_at, cutoff),
        ),
      )
      .orderBy(desc(siDecisionsTable.created_at))
      .limit(500)) as SIDecisionRow[];

    if (decisions.length === 0) {
      const empty = emptyMemory(symbol);
      memoryCache.set(symbol, { data: empty, expiresAt: Date.now() + CACHE_TTL_MS });
      return empty;
    }

    // Group by setup_type + direction
    const groups = new Map<string, SIDecisionRow[]>();
    for (const d of decisions) {
      const key = `${d.setup_type ?? "unknown"}::${d.direction ?? "unknown"}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(d);
    }

    const bySetup: SetupMemory[] = [];
    for (const [key, group] of groups) {
      const [setup_type, direction] = key.split("::");
      const approved = group.filter((d) => d.approved);
      const withOutcome = approved.filter((d) => d.outcome != null);
      const wins = withOutcome.filter((d) => d.outcome === "win");
      const losses = withOutcome.filter((d) => d.outcome === "loss");

      const winPnl = wins.reduce((s, d) => s + (Number(d.realized_pnl) || 0), 0);
      const lossPnl = Math.abs(losses.reduce((s, d) => s + (Number(d.realized_pnl) || 0), 0));

      const win_rate = withOutcome.length > 0 ? wins.length / withOutcome.length : 0;
      const profit_factor = lossPnl > 0 ? winPnl / lossPnl : winPnl > 0 ? 999 : 0;

      // Recent performance (last 10 with outcome)
      const recent = withOutcome.slice(0, 10);
      const recentWins = recent.filter((d) => d.outcome === "win");
      const recent_win_rate = recent.length > 0 ? recentWins.length / recent.length : win_rate;

      // Decay detection: compare first half vs second half win rate
      const half = Math.floor(withOutcome.length / 2);
      let decay_detected = false;
      let decay_rate = 0;
      if (withOutcome.length >= 10) {
        const olderHalf = withOutcome.slice(half);
        const newerHalf = withOutcome.slice(0, half);
        const olderWR = olderHalf.filter((d) => d.outcome === "win").length / olderHalf.length;
        const newerWR = newerHalf.filter((d) => d.outcome === "win").length / newerHalf.length;
        if (olderWR > newerWR + 0.1) {
          decay_detected = true;
          decay_rate = Math.min(1, (olderWR - newerWR) / olderWR);
        }
      }

      // Best/worst regime
      const regimeMap = new Map<string, { wins: number; total: number }>();
      for (const d of withOutcome) {
        const regime = d.regime ?? "unknown";
        if (!regimeMap.has(regime)) regimeMap.set(regime, { wins: 0, total: 0 });
        const r = regimeMap.get(regime)!;
        r.total++;
        if (d.outcome === "win") r.wins++;
      }
      let bestRegime: string | null = null;
      let worstRegime: string | null = null;
      let bestWR = -1;
      let worstWR = 2;
      for (const [regime, stats] of regimeMap) {
        if (stats.total < 3) continue;
        const wr = stats.wins / stats.total;
        if (wr > bestWR) { bestWR = wr; bestRegime = regime; }
        if (wr < worstWR) { worstWR = wr; worstRegime = regime; }
      }

      bySetup.push({
        symbol,
        setup_type,
        direction,
        similar_setups: group.length,
        win_rate: Math.round(win_rate * 100) / 100,
        profit_factor: Math.round(profit_factor * 100) / 100,
        avg_confidence: Math.round(
          (approved.reduce((s, d) => s + (Number(d.win_probability) || 0), 0) / (approved.length || 1)) * 100
        ) / 100,
        avg_edge_score: Math.round(
          (approved.reduce((s, d) => s + (Number(d.edge_score) || 0), 0) / (approved.length || 1)) * 1000
        ) / 1000,
        avg_quality: Math.round(
          (approved.reduce((s, d) => s + (Number(d.final_quality) || 0), 0) / (approved.length || 1)) * 100
        ) / 100,
        total_pnl: Math.round((winPnl - lossPnl) * 100) / 100,
        recent_win_rate: Math.round(recent_win_rate * 100) / 100,
        decay_detected,
        decay_rate: Math.round(decay_rate * 100) / 100,
        best_regime: bestRegime,
        worst_regime: worstRegime,
        computed_at: new Date().toISOString(),
      });
    }

    // Overall stats
    const allApproved = decisions.filter((d) => d.approved);
    const allWithOutcome = allApproved.filter((d) => d.outcome != null);
    const allWins = allWithOutcome.filter((d) => d.outcome === "win");
    const allLosses = allWithOutcome.filter((d) => d.outcome === "loss");
    const totalWinPnl = allWins.reduce((s, d) => s + (Number(d.realized_pnl) || 0), 0);
    const totalLossPnl = Math.abs(allLosses.reduce((s, d) => s + (Number(d.realized_pnl) || 0), 0));

    const summary: SetupMemorySummary = {
      symbol,
      total_decisions: decisions.length,
      total_approved: allApproved.length,
      total_with_outcome: allWithOutcome.length,
      overall_win_rate: allWithOutcome.length > 0 ? Math.round((allWins.length / allWithOutcome.length) * 100) / 100 : 0,
      overall_profit_factor: totalLossPnl > 0 ? Math.round((totalWinPnl / totalLossPnl) * 100) / 100 : 0,
      by_setup: bySetup.sort((a, b) => b.similar_setups - a.similar_setups),
      top_setups: [...bySetup].filter((s) => s.similar_setups >= 5).sort((a, b) => b.win_rate - a.win_rate).slice(0, 5),
      decaying_setups: bySetup.filter((s) => s.decay_detected),
      computed_at: new Date().toISOString(),
    };

    memoryCache.set(symbol, { data: summary, expiresAt: Date.now() + CACHE_TTL_MS });
    return summary;
  } catch (err) {
    logger.error({ err, symbol }, "Failed to compute setup memory");
    return emptyMemory(symbol);
  }
}

function emptyMemory(symbol: string): SetupMemorySummary {
  return {
    symbol,
    total_decisions: 0,
    total_approved: 0,
    total_with_outcome: 0,
    overall_win_rate: 0,
    overall_profit_factor: 0,
    by_setup: [],
    top_setups: [],
    decaying_setups: [],
    computed_at: new Date().toISOString(),
  };
}

export function clearSetupMemoryCache(symbol?: string): void {
  if (symbol) memoryCache.delete(symbol);
  else memoryCache.clear();
}