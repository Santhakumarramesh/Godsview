/**
 * Operator Daily Brief — Generates a summary of system state for the operator.
 *
 * Designed to be called once daily (or on-demand) to give the operator
 * a clear picture of:
 * 1. System health and uptime
 * 2. Trading performance (paper or live)
 * 3. Risk status (kill switch, exposure, circuit breaker)
 * 4. Strategy performance and calibration drift
 * 5. Data quality status
 * 6. Alerts and warnings
 * 7. Recommended actions
 *
 * This is the operator's "morning coffee" view.
 */
import { logger } from "../logger.js";
import { getKillSwitchState, getKillSwitchEvents } from "../risk/kill_switch.js";
import { getExposureLimits } from "../risk/exposure_guard.js";
import { getAllTrackers, getDriftAlerts, getCriticalDriftStrategies } from "../learning/post_trade_loop.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface OperatorBrief {
  generatedAt: string;
  period: string; // "daily" | "weekly"

  system: {
    mode: string;
    uptime: string;
    nodeVersion: string;
    memoryMB: number;
  };

  trading: {
    totalStrategies: number;
    totalTrades: number;
    totalPnl: number;
    overallWinRate: number;
    bestStrategy: { id: string; winRate: number; pnl: number } | null;
    worstStrategy: { id: string; winRate: number; pnl: number } | null;
  };

  risk: {
    killSwitchActive: boolean;
    killSwitchTrips: number;
    exposureLimits: Record<string, number>;
    criticalDriftCount: number;
  };

  alerts: {
    driftAlerts: number;
    criticalAlerts: number;
    recentEvents: string[];
  };

  recommendations: string[];
}

// ── Generator ────────────────────────────────────────────────────────────────

export function generateOperatorBrief(): OperatorBrief {
  const now = new Date();
  const recommendations: string[] = [];

  // System state
  const mode = process.env.GODSVIEW_SYSTEM_MODE ?? "paper";
  const uptimeSeconds = process.uptime();
  const uptimeHours = Math.floor(uptimeSeconds / 3600);
  const uptimeMinutes = Math.floor((uptimeSeconds % 3600) / 60);
  const uptime = `${uptimeHours}h ${uptimeMinutes}m`;
  const memoryMB = Math.round(process.memoryUsage.rss() / 1024 / 1024);

  // Kill switch
  const ksState = getKillSwitchState();
  if (ksState.active) {
    recommendations.push("🚨 Kill switch is ACTIVE — review and deactivate if conditions are resolved");
  }

  // Exposure limits
  const limits = getExposureLimits();

  // Strategy performance
  const trackers = getAllTrackers();
  const totalTrades = trackers.reduce((sum, t) => sum + t.totalTrades, 0);
  const totalPnl = trackers.reduce((sum, t) => sum + t.totalPnl, 0);
  const overallWins = trackers.reduce((sum, t) => sum + t.wins, 0);
  const overallWinRate = totalTrades > 0 ? overallWins / totalTrades : 0;

  // Best/worst strategies
  let bestStrategy: OperatorBrief["trading"]["bestStrategy"] = null;
  let worstStrategy: OperatorBrief["trading"]["worstStrategy"] = null;

  if (trackers.length > 0) {
    const sorted = [...trackers].sort((a, b) => b.totalPnl - a.totalPnl);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];

    if (best && best.totalTrades > 0) {
      bestStrategy = { id: best.strategyId, winRate: best.liveWinRate, pnl: best.totalPnl };
    }
    if (worst && worst.totalTrades > 0 && worst !== best) {
      worstStrategy = { id: worst.strategyId, winRate: worst.liveWinRate, pnl: worst.totalPnl };
    }
  }

  // Drift alerts
  const driftAlerts = getDriftAlerts();
  const criticalDrift = getCriticalDriftStrategies();

  if (criticalDrift.length > 0) {
    recommendations.push(
      `⚠ ${criticalDrift.length} strategy(ies) have critical calibration drift — review: ${criticalDrift.map(s => s.strategyId).join(", ")}`,
    );
  }

  // Kill switch events
  const ksEvents = getKillSwitchEvents(10);
  const recentEvents = ksEvents.map(e => `[${e.timestamp}] ${e.type}: ${e.reason ?? "n/a"}`);

  // General recommendations
  if (totalTrades === 0) {
    recommendations.push("No trades recorded yet — verify data feeds and strategy configuration");
  }
  if (overallWinRate < 0.45 && totalTrades >= 20) {
    recommendations.push(`Overall win rate is ${(overallWinRate * 100).toFixed(1)}% — review strategy selection`);
  }
  if (memoryMB > 400) {
    recommendations.push(`Memory usage high (${memoryMB}MB) — consider restarting if it keeps climbing`);
  }
  if (mode === "demo") {
    recommendations.push("Running in demo mode — switch to paper mode for real market data");
  }

  const brief: OperatorBrief = {
    generatedAt: now.toISOString(),
    period: "daily",
    system: {
      mode,
      uptime,
      nodeVersion: process.version,
      memoryMB,
    },
    trading: {
      totalStrategies: trackers.length,
      totalTrades,
      totalPnl: Math.round(totalPnl * 100) / 100,
      overallWinRate: Math.round(overallWinRate * 1000) / 1000,
      bestStrategy,
      worstStrategy,
    },
    risk: {
      killSwitchActive: ksState.active,
      killSwitchTrips: ksState.tripCount,
      exposureLimits: {
        maxPositionPct: limits.maxPositionPct,
        maxPortfolioExposurePct: limits.maxPortfolioExposurePct,
        maxConcurrentPositions: limits.maxConcurrentPositions,
      },
      criticalDriftCount: criticalDrift.length,
    },
    alerts: {
      driftAlerts: driftAlerts.length,
      criticalAlerts: driftAlerts.filter(a => a.severity === "critical").length,
      recentEvents,
    },
    recommendations,
  };

  logger.info({
    mode,
    strategies: trackers.length,
    trades: totalTrades,
    pnl: totalPnl,
    winRate: `${(overallWinRate * 100).toFixed(1)}%`,
    recommendations: recommendations.length,
  }, "Operator brief generated");

  return brief;
}
