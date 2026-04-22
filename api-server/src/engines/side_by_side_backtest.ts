/**
 * engines/side_by_side_backtest.ts — Side-by-Side Backtester
 *
 * Runs historical backtest and live paper feed simultaneously,
 * comparing performance metrics and signal alignment.
 *
 * Exports:
 *   - startSideBySide(config): SideBySideSnapshot
 *   - stopSideBySide(): SideBySideSnapshot | null
 *   - pauseSideBySide(): SideBySideSnapshot | null
 *   - resumeSideBySide(): SideBySideSnapshot | null
 *   - getSideBySideSnapshot(): SideBySideSnapshot | null
 *   - updateBacktestProgress(trades, wins, pnl, signals, progress): void
 *   - updateLiveProgress(trades, wins, pnl, unrealized, positions, signals): void
 *   - resetSideBySide(): void
 */

/**
 * Configuration for side-by-side run
 */
export interface SideBySideConfig {
  symbols: string[];
  historicalDays: number; // how many days of history to backtest
  strategies: string[];
  updateIntervalMs: number; // how often to check live feed
}

/**
 * Historical backtest leg
 */
export interface BacktestLeg {
  status: "running" | "complete" | "error";
  startDate: string;
  endDate: string;
  tradesTotal: number;
  winRate: number;
  pnlPct: number;
  sharpeRatio: number;
  maxDrawdown: number;
  signals: number;
  progress: number; // 0-100%
}

/**
 * Live paper trading leg
 */
export interface LiveLeg {
  status: "running" | "paused" | "stopped";
  startedAt: string;
  tradesTotal: number;
  winRate: number;
  pnlPct: number;
  unrealizedPnl: number;
  openPositions: number;
  signalsProcessed: number;
  lastSignalAt: string | null;
}

/**
 * Comparison metrics
 */
export interface SideBySideComparison {
  winRateDelta: number; // live - backtest
  pnlDelta: number; // live - backtest
  signalOverlap: number; // % of signals both would take
  divergenceScore: number; // 0=identical, 1=completely different
}

/**
 * Side-by-side snapshot
 */
export interface SideBySideSnapshot {
  id: string;
  config: SideBySideConfig;
  backtest: BacktestLeg;
  live: LiveLeg;
  comparison: SideBySideComparison;
  status: "running" | "paused" | "stopped" | "complete";
  startedAt: string;
  updatedAt: string;
}

/**
 * Global state
 */
let currentSnapshot: SideBySideSnapshot | null = null;

/**
 * Generate unique ID
 */
function generateSnapshotId(): string {
  return `sbs_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

/**
 * Calculate divergence score between backtest and live
 * 0 = identical performance, 1 = completely different
 */
function calculateDivergenceScore(snapshot: SideBySideSnapshot): number {
  let score = 0;
  const maxScore = 3;

  // Win rate divergence (max 1)
  const winRateDelta = Math.abs(snapshot.comparison.winRateDelta);
  score += Math.min(1, winRateDelta / 50); // Normalize to 0-1

  // PnL divergence (max 1)
  const pnlDelta = Math.abs(snapshot.comparison.pnlDelta);
  score += Math.min(1, pnlDelta / 100); // Normalize to 0-1

  // Signal overlap divergence (max 1)
  // Lower overlap = higher divergence
  score += Math.min(1, (100 - snapshot.comparison.signalOverlap) / 100);

  return Math.min(1, score / maxScore);
}

/**
 * Start a new side-by-side run
 */
export function startSideBySide(config: SideBySideConfig): SideBySideSnapshot {
  const now = new Date().toISOString();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - config.historicalDays);
  const endDate = new Date();

  const snapshot: SideBySideSnapshot = {
    id: generateSnapshotId(),
    config,
    backtest: {
      status: "running",
      startDate: startDate.toISOString().split("T")[0],
      endDate: endDate.toISOString().split("T")[0],
      tradesTotal: 0,
      winRate: 0,
      pnlPct: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      signals: 0,
      progress: 0,
    },
    live: {
      status: "running",
      startedAt: now,
      tradesTotal: 0,
      winRate: 0,
      pnlPct: 0,
      unrealizedPnl: 0,
      openPositions: 0,
      signalsProcessed: 0,
      lastSignalAt: null,
    },
    comparison: {
      winRateDelta: 0,
      pnlDelta: 0,
      signalOverlap: 100, // Start at 100% overlap
      divergenceScore: 0,
    },
    status: "running",
    startedAt: now,
    updatedAt: now,
  };

  currentSnapshot = snapshot;
  return snapshot;
}

/**
 * Stop the side-by-side run
 */
export function stopSideBySide(): SideBySideSnapshot | null {
  if (!currentSnapshot) return null;

  currentSnapshot.status = "stopped";
  currentSnapshot.backtest.status = "complete";
  currentSnapshot.live.status = "stopped";
  currentSnapshot.updatedAt = new Date().toISOString();

  return currentSnapshot;
}

/**
 * Pause the side-by-side run
 */
export function pauseSideBySide(): SideBySideSnapshot | null {
  if (!currentSnapshot) return null;

  currentSnapshot.status = "paused";
  currentSnapshot.live.status = "paused";
  currentSnapshot.updatedAt = new Date().toISOString();

  return currentSnapshot;
}

/**
 * Resume the side-by-side run
 */
export function resumeSideBySide(): SideBySideSnapshot | null {
  if (!currentSnapshot) return null;

  currentSnapshot.status = "running";
  currentSnapshot.live.status = "running";
  currentSnapshot.updatedAt = new Date().toISOString();

  return currentSnapshot;
}

/**
 * Get current snapshot
 */
export function getSideBySideSnapshot(): SideBySideSnapshot | null {
  return currentSnapshot;
}

/**
 * Update backtest progress
 */
export function updateBacktestProgress(
  trades: number,
  wins: number,
  pnl: number,
  signals: number,
  progress: number
): void {
  if (!currentSnapshot) return;

  currentSnapshot.backtest.tradesTotal = trades;
  currentSnapshot.backtest.winRate = trades > 0 ? (wins / trades) * 100 : 0;
  currentSnapshot.backtest.pnlPct = pnl;
  currentSnapshot.backtest.signals = signals;
  currentSnapshot.backtest.progress = Math.min(100, progress);

  // Update progress to complete if at 100%
  if (progress >= 100) {
    currentSnapshot.backtest.status = "complete";
  }

  // Recalculate comparison
  updateComparison();
  currentSnapshot.updatedAt = new Date().toISOString();
}

/**
 * Update live progress
 */
export function updateLiveProgress(
  trades: number,
  wins: number,
  pnl: number,
  unrealized: number,
  positions: number,
  signals: number
): void {
  if (!currentSnapshot) return;

  currentSnapshot.live.tradesTotal = trades;
  currentSnapshot.live.winRate = trades > 0 ? (wins / trades) * 100 : 0;
  currentSnapshot.live.pnlPct = pnl;
  currentSnapshot.live.unrealizedPnl = unrealized;
  currentSnapshot.live.openPositions = positions;
  currentSnapshot.live.signalsProcessed = signals;
  if (signals > 0) {
    currentSnapshot.live.lastSignalAt = new Date().toISOString();
  }

  // Recalculate comparison
  updateComparison();
  currentSnapshot.updatedAt = new Date().toISOString();
}

/**
 * Recalculate comparison metrics
 */
function updateComparison(): void {
  if (!currentSnapshot) return;

  const bt = currentSnapshot.backtest;
  const live = currentSnapshot.live;

  // Win rate delta
  currentSnapshot.comparison.winRateDelta = live.winRate - bt.winRate;

  // PnL delta
  currentSnapshot.comparison.pnlDelta = live.pnlPct - bt.pnlPct;

  // Signal overlap (estimate based on signal counts)
  if (bt.signals === 0 && live.signalsProcessed === 0) {
    currentSnapshot.comparison.signalOverlap = 100;
  } else if (bt.signals === 0 || live.signalsProcessed === 0) {
    currentSnapshot.comparison.signalOverlap = 0;
  } else {
    // Estimate overlap as min(signals) / max(signals) * 100
    const minSignals = Math.min(bt.signals, live.signalsProcessed);
    const maxSignals = Math.max(bt.signals, live.signalsProcessed);
    currentSnapshot.comparison.signalOverlap = (minSignals / maxSignals) * 100;
  }

  // Divergence score
  currentSnapshot.comparison.divergenceScore = calculateDivergenceScore(currentSnapshot);
}

/**
 * Reset side-by-side state
 */
export function resetSideBySide(): void {
  currentSnapshot = null;
}
