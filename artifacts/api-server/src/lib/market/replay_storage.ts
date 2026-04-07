/**
 * Replay Storage — In-memory storage for market data replay.
 */

export interface OrderBookLevel { price: number; size: number; }
export interface OrderBookSnapshot { symbol: string; timestamp: number; bids: OrderBookLevel[]; asks: OrderBookLevel[]; }
export interface StorageMetrics { barCount: number; tradeCount: number; snapshotCount: number; memoryEstimateBytes: number; }
export interface CompressionStats { rawBytes: number; compressedBytes: number; ratio: number; }
export interface ReplayStorageConfig { maxBarsPerSymbol: number; maxTradesPerSymbol: number; maxSnapshots: number; autoFlushIntervalMs: number; }

interface BarEntry { symbol: string; timestamp: number; open: number; high: number; low: number; close: number; volume: number; }

const bars = new Map<string, BarEntry[]>();
const trades = new Map<string, any[]>();
const snapshots = new Map<string, OrderBookSnapshot[]>();
let cfg: ReplayStorageConfig = { maxBarsPerSymbol: 5000, maxTradesPerSymbol: 10000, maxSnapshots: 1000, autoFlushIntervalMs: 60000 };
let flushTimer: any = null;

export function storeBar(symbol: string, bar: BarEntry): void {
  if (!bars.has(symbol)) bars.set(symbol, []);
  const arr = bars.get(symbol)!;
  arr.push(bar);
  if (arr.length > cfg.maxBarsPerSymbol) arr.shift();
}

export function getBarsInRange(symbol: string, start: number, end: number): BarEntry[] {
  return (bars.get(symbol) ?? []).filter(b => b.timestamp >= start && b.timestamp <= end);
}

export function getLatestBar(symbol: string): BarEntry | null {
  const arr = bars.get(symbol);
  return arr && arr.length > 0 ? arr[arr.length - 1] : null;
}

export function getAllBars(symbol: string): BarEntry[] { return bars.get(symbol) ?? []; }

export function storeTrade(symbol: string, trade: any): void {
  if (!trades.has(symbol)) trades.set(symbol, []);
  const arr = trades.get(symbol)!;
  arr.push(trade);
  if (arr.length > cfg.maxTradesPerSymbol) arr.shift();
}

export function getTradesInRange(symbol: string, start: number, end: number): any[] {
  return (trades.get(symbol) ?? []).filter((t: any) => t.timestamp >= start && t.timestamp <= end);
}

export function storeSnapshot(symbol: string, snap: OrderBookSnapshot): void {
  if (!snapshots.has(symbol)) snapshots.set(symbol, []);
  const arr = snapshots.get(symbol)!;
  arr.push(snap);
  if (arr.length > cfg.maxSnapshots) arr.shift();
}

export function getLatestSnapshot(symbol: string): OrderBookSnapshot | null {
  const arr = snapshots.get(symbol);
  return arr && arr.length > 0 ? arr[arr.length - 1] : null;
}

export function getSnapshotNear(symbol: string, ts: number): OrderBookSnapshot | null {
  const arr = snapshots.get(symbol) ?? [];
  let closest: OrderBookSnapshot | null = null;
  let minDist = Infinity;
  for (const s of arr) {
    const d = Math.abs(s.timestamp - ts);
    if (d < minDist) { minDist = d; closest = s; }
  }
  return closest;
}

export function getSnapshotsInRange(symbol: string, start: number, end: number): OrderBookSnapshot[] {
  return (snapshots.get(symbol) ?? []).filter(s => s.timestamp >= start && s.timestamp <= end);
}

export function getStorageMetrics(): StorageMetrics {
  let barCount = 0, tradeCount = 0, snapshotCount = 0;
  for (const v of bars.values()) barCount += v.length;
  for (const v of trades.values()) tradeCount += v.length;
  for (const v of snapshots.values()) snapshotCount += v.length;
  return { barCount, tradeCount, snapshotCount, memoryEstimateBytes: (barCount * 64) + (tradeCount * 48) + (snapshotCount * 256) };
}

export function clearSymbol(symbol: string): void { bars.delete(symbol); trades.delete(symbol); snapshots.delete(symbol); }
export function clearAll(): void { bars.clear(); trades.clear(); snapshots.clear(); }

export function pruneAll(): void {
  for (const [sym, arr] of bars) { if (arr.length > cfg.maxBarsPerSymbol) bars.set(sym, arr.slice(-cfg.maxBarsPerSymbol)); }
  for (const [sym, arr] of trades) { if (arr.length > cfg.maxTradesPerSymbol) trades.set(sym, arr.slice(-cfg.maxTradesPerSymbol)); }
}

export function updateConfig(updates: Partial<ReplayStorageConfig>): void { cfg = { ...cfg, ...updates }; }
export function getConfig(): ReplayStorageConfig { return { ...cfg }; }

export function startAutoFlush(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => pruneAll(), cfg.autoFlushIntervalMs);
}

export function stopAutoFlush(): void {
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
}

export function flush(): void { pruneAll(); }
export function getTotalStored(): number { const m = getStorageMetrics(); return m.barCount + m.tradeCount + m.snapshotCount; }
