/**
 * proof_engine.ts — Proof/Drift Dashboard for strategy validation
 *
 * Generates comprehensive performance reports grouped by:
 *   - Overall win rate and statistics
 *   - Setup type performance (e.g., absorption_reversal, sweep_reclaim, etc.)
 *   - Market regime performance (volatile, trending, ranging, etc.)
 *   - Drift analysis (comparing performance across time periods)
 *
 * Results cached with 5-minute TTL.
 */

import { db, siDecisionsTable } from "@workspace/db";
import { desc, gte } from "@workspace/db";
import { logger } from "./logger";

/** Row shape from si_decisions query */
type SIRow = {
  id: number;
  symbol: string;
  setup_type: string;
  direction: string;
  regime: string;
  approved: boolean;
  win_probability: string;
  edge_score: string;
  enhanced_quality: string;
  kelly_fraction: string;
  confluence_score: string;
  suggested_qty: number;
  rejection_reason: string | null;
  entry_price: string;
  stop_loss: string;
  take_profit: string;
  final_quality: string;
  gate_action: string | null;
  gate_block_reasons: string | null;
  trailing_stop_json: string | null;
  profit_targets_json: string | null;
  outcome: string | null;
  realized_pnl: string | null;
  created_at: Date;
  [key: string]: unknown;
};

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SetupProof {
  setup_type: string;
  total_trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  avg_quality: number;
  avg_pnl: number;
  profit_factor: number;
  sharpe_estimate: number;
}

export interface DriftReport {
  symbol: string;
  setup_type: string;
  period1_win_rate: number;  // first half
  period2_win_rate: number;  // second half
  drift_magnitude: number;   // abs difference
  drift_status: "stable" | "watch" | "drift" | "critical";
  degrading: boolean;
}

export interface RegimeStats {
  win_rate: number;
  count: number;
  avg_quality: number;
}

export interface ProofDashboard {
  overall_win_rate: number;
  total_decisions: number;
  by_setup: SetupProof[];
  by_regime: Record<string, RegimeStats>;
  drift_reports: DriftReport[];
  generated_at: string;
}

// ── Cache ──────────────────────────────────────────────────────────────────────

interface CacheEntry {
  dashboard: ProofDashboard;
  timestamp: number;
}

const proofCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCacheKey(days: number): string {
  return `proof_dashboard_${days}`;
}

function getCached(days: number): ProofDashboard | null {
  const key = getCacheKey(days);
  const entry = proofCache.get(key);
  if (!entry) return null;

  const now = Date.now();
  if (now - entry.timestamp > CACHE_TTL_MS) {
    proofCache.delete(key);
    return null;
  }

  return entry.dashboard;
}

function setCached(days: number, dashboard: ProofDashboard): void {
  const key = getCacheKey(days);
  proofCache.set(key, {
    dashboard,
    timestamp: Date.now(),
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Calculate Sharpe ratio estimate from outcome data
 * Simple approximation: (win_count - loss_count) / sqrt(total_trades)
 */
function estimateSharpe(wins: number, losses: number, total: number): number {
  if (total === 0) return 0;
  const returnEstimate = (wins - losses) / total;
  const volatilityEstimate = Math.sqrt(total);
  return volatilityEstimate > 0 ? returnEstimate / (volatilityEstimate * 0.1) : 0;
}

/**
 * Calculate profit factor (wins / losses, clamped)
 */
function calculateProfitFactor(wins: number, losses: number): number {
  if (losses === 0) return wins > 0 ? 2.0 : 0;
  const factor = wins / losses;
  return Math.min(factor, 10); // cap at 10 for display
}

// ── Main Query & Analysis ──────────────────────────────────────────────────────

/**
 * generateProofDashboard — Build comprehensive proof/drift report
 *
 * @param days Number of days to analyze (default 30)
 * @returns ProofDashboard with all statistics and drift reports
 */
export async function generateProofDashboard(days: number = 30): Promise<ProofDashboard> {
  // Check cache first
  const cached = getCached(days);
  if (cached) {
    logger.debug(`[Proof Engine] Cache hit for ${days}-day dashboard`);
    return cached;
  }

  try {
    // Calculate cutoff date
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    // Query all decisions from the period
    const decisions = (await db
      .select()
      .from(siDecisionsTable)
      .where(gte(siDecisionsTable.created_at, cutoffDate))
      .orderBy(desc(siDecisionsTable.created_at))) as SIRow[];

    logger.info(`[Proof Engine] Analyzing ${decisions.length} decisions from last ${days} days`);

    // Calculate overall stats
    const decisionsWithOutcome = decisions.filter((d) => d.outcome !== null);
    const totalDecisions = decisionsWithOutcome.length;

    if (totalDecisions === 0) {
      const emptyDashboard: ProofDashboard = {
        overall_win_rate: 0,
        total_decisions: 0,
        by_setup: [],
        by_regime: {},
        drift_reports: [],
        generated_at: new Date().toISOString(),
      };
      setCached(days, emptyDashboard);
      return emptyDashboard;
    }

    const winCount = decisionsWithOutcome.filter((d) => d.outcome === "win").length;
    const overallWinRate = totalDecisions > 0 ? winCount / totalDecisions : 0;

    // Group by setup_type
    const bySetupMap = new Map<string, Array<(typeof decisionsWithOutcome)[0]>>();
    decisionsWithOutcome.forEach((d) => {
      const setup = d.setup_type || "unknown";
      if (!bySetupMap.has(setup)) {
        bySetupMap.set(setup, []);
      }
      bySetupMap.get(setup)!.push(d);
    });

    const bySetup: SetupProof[] = Array.from(bySetupMap.entries()).map(([setup, trades]) => {
      const setupWins = trades.filter((t) => t.outcome === "win").length;
      const setupLosses = trades.filter((t) => t.outcome === "loss").length;
      const setupTotal = trades.length;

      // Calculate average quality and PnL
      const avgQuality =
        trades.reduce((sum, t) => sum + (parseFloat(t.enhanced_quality?.toString() ?? "0") ?? 0), 0) /
        setupTotal;

      const avgPnl =
        trades.reduce((sum, t) => sum + (parseFloat(t.realized_pnl?.toString() ?? "0") ?? 0), 0) /
        setupTotal;

      return {
        setup_type: setup,
        total_trades: setupTotal,
        wins: setupWins,
        losses: setupLosses,
        win_rate: setupTotal > 0 ? setupWins / setupTotal : 0,
        avg_quality: avgQuality,
        avg_pnl: avgPnl,
        profit_factor: calculateProfitFactor(setupWins, setupLosses),
        sharpe_estimate: estimateSharpe(setupWins, setupLosses, setupTotal),
      };
    });

    // Group by regime
    const byRegimeMap = new Map<string, Array<(typeof decisionsWithOutcome)[0]>>();
    decisionsWithOutcome.forEach((d) => {
      const regime = d.regime || "unknown";
      if (!byRegimeMap.has(regime)) {
        byRegimeMap.set(regime, []);
      }
      byRegimeMap.get(regime)!.push(d);
    });

    const byRegime: Record<string, RegimeStats> = {};
    byRegimeMap.forEach((trades, regime) => {
      const regimeWins = trades.filter((t) => t.outcome === "win").length;
      const avgQuality =
        trades.reduce((sum, t) => sum + (parseFloat(t.enhanced_quality?.toString() ?? "0") ?? 0), 0) /
        trades.length;

      byRegime[regime] = {
        win_rate: trades.length > 0 ? regimeWins / trades.length : 0,
        count: trades.length,
        avg_quality: avgQuality,
      };
    });

    // Calculate drift for each setup
    const driftReports: DriftReport[] = [];
    bySetupMap.forEach((trades, setup) => {
      // Split trades into first half and second half by created_at
      const sorted = [...trades].sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );

      if (sorted.length < 4) {
        // Need at least 4 trades to split meaningfully
        return;
      }

      const midpoint = Math.floor(sorted.length / 2);
      const period1 = sorted.slice(0, midpoint).filter((t) => t.outcome !== null);
      const period2 = sorted.slice(midpoint).filter((t) => t.outcome !== null);

      if (period1.length === 0 || period2.length === 0) {
        return;
      }

      const period1Wins = period1.filter((t) => t.outcome === "win").length;
      const period2Wins = period2.filter((t) => t.outcome === "win").length;

      const period1WinRate = period1.length > 0 ? period1Wins / period1.length : 0;
      const period2WinRate = period2.length > 0 ? period2Wins / period2.length : 0;

      const driftMagnitude = Math.abs(period2WinRate - period1WinRate);
      const degrading = period2WinRate < period1WinRate;

      let driftStatus: "stable" | "watch" | "drift" | "critical";
      if (driftMagnitude < 0.05) {
        driftStatus = "stable";
      } else if (driftMagnitude < 0.1) {
        driftStatus = "watch";
      } else if (driftMagnitude < 0.2) {
        driftStatus = "drift";
      } else {
        driftStatus = "critical";
      }

      // Get representative symbol from first trade
      const symbol = trades[0].symbol || "unknown";

      driftReports.push({
        symbol,
        setup_type: setup,
        period1_win_rate: period1WinRate,
        period2_win_rate: period2WinRate,
        drift_magnitude: driftMagnitude,
        drift_status: driftStatus,
        degrading,
      });
    });

    const dashboard: ProofDashboard = {
      overall_win_rate: overallWinRate,
      total_decisions: totalDecisions,
      by_setup: bySetup.sort((a, b) => b.total_trades - a.total_trades),
      by_regime: byRegime,
      drift_reports: driftReports.sort((a, b) => b.drift_magnitude - a.drift_magnitude),
      generated_at: new Date().toISOString(),
    };

    // Cache result
    setCached(days, dashboard);

    logger.info(
      `[Proof Engine] Dashboard generated: ${totalDecisions} decisions, ${(overallWinRate * 100).toFixed(1)}% overall win rate`,
    );

    return dashboard;
  } catch (error) {
    logger.error(`[Proof Engine] Error generating proof dashboard: ${error instanceof Error ? error.message : "unknown"}`);
    throw error;
  }
}

/**
 * Get proof for a specific setup type
 */
export async function getSetupProof(setupType: string, days: number = 30): Promise<SetupProof | null> {
  const dashboard = await generateProofDashboard(days);
  return dashboard.by_setup.find((s) => s.setup_type === setupType) ?? null;
}

/**
 * Get proof for a specific regime
 */
export async function getRegimeProof(regime: string, days: number = 30): Promise<RegimeStats | null> {
  const dashboard = await generateProofDashboard(days);
  return dashboard.by_regime[regime] ?? null;
}

/**
 * Get all drift reports
 */
export async function getDriftReports(days: number = 30): Promise<DriftReport[]> {
  const dashboard = await generateProofDashboard(days);
  return dashboard.drift_reports;
}

/**
 * Clear cache (useful for testing or manual refresh)
 */
export function clearProofCache(days?: number): void {
  if (days !== undefined) {
    const key = getCacheKey(days);
    proofCache.delete(key);
    logger.info(`[Proof Engine] Cache cleared for ${days}-day dashboard`);
  } else {
    proofCache.clear();
    logger.info("[Proof Engine] Cache cleared (all dashboards)");
  }
}

/**
 * Get cache stats
 */
export function getProofCacheStats(): {
  size: number;
  entries: string[];
} {
  return {
    size: proofCache.size,
    entries: Array.from(proofCache.keys()),
  };
}
