/**
 * overlay_store.ts — Persistent Overlay Snapshot Storage (Phase 51)
 *
 * Records TradingView overlay analysis snapshots:
 *   - HTF bias assessment
 *   - Order block detection
 *   - Key level identification
 *   - Signal detection
 *   - Trade probability calculation
 */

import { persistWrite, persistRead, persistAppend } from "../lib/persistent_store.js";
import { logger } from "../lib/logger.js";

export interface OverlaySnapshot {
  id: string;
  symbol: string;
  timeframe: string;
  htfBias: string;
  orderBlockCount: number;
  keyLevelCount: number;
  signalCount: number;
  tradeProbability: { long: number; short: number; neutral: number };
  createdAt: string;
}

export function saveOverlaySnapshot(snapshot: OverlaySnapshot): void {
  try {
    persistAppend("overlay_snapshots", snapshot, 2000);
    logger.debug(
      { id: snapshot.id, symbol: snapshot.symbol, timeframe: snapshot.timeframe },
      "Overlay snapshot saved"
    );
  } catch (error) {
    logger.error({ error, snapshotId: snapshot.id }, "Failed to save overlay snapshot");
    throw error;
  }
}

export function getOverlaySnapshots(
  symbol?: string,
  limit?: number
): OverlaySnapshot[] {
  try {
    let snaps = persistRead<OverlaySnapshot[]>("overlay_snapshots", []);

    if (symbol) snaps = snaps.filter((s) => s.symbol === symbol);
    if (limit) snaps = snaps.slice(-limit);

    return snaps;
  } catch (error) {
    logger.warn({ error, symbol }, "Failed to read overlay snapshots");
    return [];
  }
}

export function getLatestSnapshot(symbol: string): OverlaySnapshot | null {
  try {
    const snaps = getOverlaySnapshots(symbol);
    return snaps.length > 0 ? snaps[snaps.length - 1]! : null;
  } catch (error) {
    logger.warn({ error, symbol }, "Failed to get latest snapshot");
    return null;
  }
}

export function getSnapshotsByTimeframe(
  symbol: string,
  timeframe: string
): OverlaySnapshot[] {
  try {
    return persistRead<OverlaySnapshot[]>("overlay_snapshots", []).filter(
      (s) => s.symbol === symbol && s.timeframe === timeframe
    );
  } catch (error) {
    logger.warn({ error, symbol, timeframe }, "Failed to filter snapshots");
    return [];
  }
}

export function clearOverlaySnapshots(): void {
  try {
    persistWrite("overlay_snapshots", []);
    logger.info("Cleared all overlay snapshots");
  } catch (error) {
    logger.error({ error }, "Failed to clear overlay snapshots");
  }
}

export function getSnapshotStatistics(): {
  total: number;
  symbols: string[];
  timeframes: string[];
} {
  try {
    const snaps = persistRead<OverlaySnapshot[]>("overlay_snapshots", []);
    const symbolSet = new Set(snaps.map((s) => s.symbol));
    const timeframeSet = new Set(snaps.map((s) => s.timeframe));

    return {
      total: snaps.length,
      symbols: Array.from(symbolSet),
      timeframes: Array.from(timeframeSet),
    };
  } catch (error) {
    logger.warn({ error }, "Failed to get snapshot statistics");
    return { total: 0, symbols: [], timeframes: [] };
  }
}
