/**
 * Post-Trade Learning Loop — Feeds completed trade outcomes back into
 * the memory and calibration systems.
 *
 * After every trade closes (paper or live), this module:
 * 1. Records the outcome in memory (failure/improvement/context memory)
 * 2. Updates calibration drift tracking
 * 3. Checks if the strategy's real-world performance matches backtest
 * 4. Triggers alerts if performance diverges
 * 5. Logs everything for audit trail
 *
 * This creates the market-truth feedback loop that GodsView needs
 * to build genuine trust in its decisions.
 */
import { logger } from "../logger.js";
import { recordTradeOutcome, type PostTradeRecord } from "../memory/recall_bridge.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface StrategyPerformanceTracker {
  strategyId: string;
  totalTrades: number;
  wins: number;
  losses: number;
  totalPnl: number;
  recentTrades: TradeSnapshot[]; // last 20 trades
  backtestWinRate: number;       // expected from backtest
  liveWinRate: number;           // actual live/paper performance
  calibrationDrift: number;      // divergence from backtest
  lastUpdated: string;
}

export interface TradeSnapshot {
  symbol: string;
  direction: "long" | "short";
  pnl: number;
  pnlPct: number;
  exitReason: string;
  timestamp: string;
}

export interface DriftAlert {
  strategyId: string;
  severity: "info" | "warning" | "critical";
  drift: number;
  message: string;
  timestamp: string;
}

// ── State ────────────────────────────────────────────────────────────────────

const trackers = new Map<string, StrategyPerformanceTracker>();
const driftAlerts: DriftAlert[] = [];

const DRIFT_THRESHOLDS = {
  info: 0.05,      // 5% divergence from backtest
  warning: 0.15,   // 15% divergence
  critical: 0.25,  // 25% divergence — should trigger review
  maxRecentTrades: 20,
} as const;

// ── Core Functions ───────────────────────────────────────────────────────────

/**
 * Process a completed trade through the learning loop.
 */
export async function processTradeOutcome(
  record: PostTradeRecord,
  backtestWinRate?: number,
): Promise<{
  recorded: boolean;
  driftAlert: DriftAlert | null;
  currentPerformance: StrategyPerformanceTracker;
}> {
  // 1. Record in memory system
  await recordTradeOutcome(record);

  // 2. Update performance tracker
  const tracker = getOrCreateTracker(record.strategy, backtestWinRate);
  const win = record.pnl > 0;

  tracker.totalTrades++;
  if (win) tracker.wins++;
  else tracker.losses++;
  tracker.totalPnl += record.pnl;

  // Update recent trades (sliding window)
  tracker.recentTrades.push({
    symbol: record.symbol,
    direction: record.direction,
    pnl: record.pnl,
    pnlPct: record.pnlPct,
    exitReason: record.exitReason,
    timestamp: new Date().toISOString(),
  });
  if (tracker.recentTrades.length > DRIFT_THRESHOLDS.maxRecentTrades) {
    tracker.recentTrades.shift();
  }

  // Recalculate live win rate
  tracker.liveWinRate = tracker.totalTrades > 0 ? tracker.wins / tracker.totalTrades : 0;

  // 3. Calculate calibration drift
  if (tracker.backtestWinRate > 0 && tracker.totalTrades >= 10) {
    tracker.calibrationDrift = Math.abs(tracker.liveWinRate - tracker.backtestWinRate);
  }
  tracker.lastUpdated = new Date().toISOString();

  // 4. Check for drift alerts
  let driftAlert: DriftAlert | null = null;
  if (tracker.totalTrades >= 10) {
    driftAlert = checkDrift(tracker);
    if (driftAlert) {
      driftAlerts.push(driftAlert);
    }
  }

  logger.info({
    strategy: record.strategy,
    symbol: record.symbol,
    win,
    pnl: record.pnl,
    liveWinRate: `${(tracker.liveWinRate * 100).toFixed(1)}%`,
    drift: `${(tracker.calibrationDrift * 100).toFixed(1)}%`,
    totalTrades: tracker.totalTrades,
  }, "Post-trade learning recorded");

  return {
    recorded: true,
    driftAlert,
    currentPerformance: { ...tracker },
  };
}

function getOrCreateTracker(strategyId: string, backtestWinRate?: number): StrategyPerformanceTracker {
  let tracker = trackers.get(strategyId);
  if (!tracker) {
    tracker = {
      strategyId,
      totalTrades: 0,
      wins: 0,
      losses: 0,
      totalPnl: 0,
      recentTrades: [],
      backtestWinRate: backtestWinRate ?? 0.5, // assume 50% if unknown
      liveWinRate: 0,
      calibrationDrift: 0,
      lastUpdated: new Date().toISOString(),
    };
    trackers.set(strategyId, tracker);
  }
  if (backtestWinRate !== undefined) {
    tracker.backtestWinRate = backtestWinRate;
  }
  return tracker;
}

function checkDrift(tracker: StrategyPerformanceTracker): DriftAlert | null {
  const drift = tracker.calibrationDrift;

  if (drift >= DRIFT_THRESHOLDS.critical) {
    return {
      strategyId: tracker.strategyId,
      severity: "critical",
      drift,
      message: `Strategy "${tracker.strategyId}" has ${(drift * 100).toFixed(1)}% calibration drift (live: ${(tracker.liveWinRate * 100).toFixed(1)}% vs backtest: ${(tracker.backtestWinRate * 100).toFixed(1)}%). Consider pausing.`,
      timestamp: new Date().toISOString(),
    };
  }

  if (drift >= DRIFT_THRESHOLDS.warning) {
    return {
      strategyId: tracker.strategyId,
      severity: "warning",
      drift,
      message: `Strategy "${tracker.strategyId}" showing ${(drift * 100).toFixed(1)}% calibration drift. Monitor closely.`,
      timestamp: new Date().toISOString(),
    };
  }

  if (drift >= DRIFT_THRESHOLDS.info) {
    return {
      strategyId: tracker.strategyId,
      severity: "info",
      drift,
      message: `Strategy "${tracker.strategyId}" has minor calibration drift (${(drift * 100).toFixed(1)}%).`,
      timestamp: new Date().toISOString(),
    };
  }

  return null;
}

// ── Query Functions ──────────────────────────────────────────────────────────

/** Get all strategy performance trackers */
export function getAllTrackers(): StrategyPerformanceTracker[] {
  return Array.from(trackers.values());
}

/** Get tracker for specific strategy */
export function getTracker(strategyId: string): StrategyPerformanceTracker | null {
  return trackers.get(strategyId) ?? null;
}

/** Get recent drift alerts */
export function getDriftAlerts(limit = 20): DriftAlert[] {
  return driftAlerts.slice(-limit);
}

/** Get strategies with critical drift */
export function getCriticalDriftStrategies(): StrategyPerformanceTracker[] {
  return Array.from(trackers.values()).filter(
    t => t.calibrationDrift >= DRIFT_THRESHOLDS.critical && t.totalTrades >= 10,
  );
}

/** Reset (testing) */
export function _resetTrackers(): void {
  trackers.clear();
  driftAlerts.length = 0;
}
