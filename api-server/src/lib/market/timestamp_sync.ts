/**
 * Timestamp Synchronization — Utilities for market timestamp handling.
 */

export type MarketSession = "pre_market" | "regular" | "post_market" | "closed";

export interface SyncResult {
  timestamp: number;
  utcISO: string;
  session: MarketSession;
}

export interface BatchSyncResult {
  results: SyncResult[];
  outOfOrder: number;
}

export function parseISOTimestamp(iso: string): number {
  return new Date(iso).getTime();
}

export function formatUTCISO(ts: number): string {
  return new Date(ts).toISOString();
}

export function normalizeTimestamp(ts: number | string): number {
  return typeof ts === "string" ? parseISOTimestamp(ts) : ts;
}

export function syncTimestampBatch(timestamps: (number | string)[]): BatchSyncResult {
  const results = timestamps.map(ts => {
    const normalized = normalizeTimestamp(ts);
    return { timestamp: normalized, utcISO: formatUTCISO(normalized), session: getMarketSession(normalized) };
  });
  let outOfOrder = 0;
  for (let i = 1; i < results.length; i++) {
    if (results[i].timestamp < results[i - 1].timestamp) outOfOrder++;
  }
  return { results, outOfOrder };
}

export function validateTemporalOrder(timestamps: number[]): boolean {
  for (let i = 1; i < timestamps.length; i++) {
    if (timestamps[i] < timestamps[i - 1]) return false;
  }
  return true;
}

export function fromUnixMs(ms: number): Date { return new Date(ms); }
export function fromUnixSeconds(s: number): Date { return new Date(s * 1000); }
export function toUnixMs(d: Date): number { return d.getTime(); }
export function nowUTC(): number { return Date.now(); }
export function addMinutes(ts: number, min: number): number { return ts + min * 60000; }
export function diffSeconds(a: number, b: number): number { return Math.abs(a - b) / 1000; }

export function isDuringMarketHours(ts: number): boolean {
  const d = new Date(ts);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const totalMin = h * 60 + m;
  return totalMin >= 810 && totalMin < 1200; // 13:30-20:00 UTC
}

export function isTradingDay(ts: number): boolean {
  const d = new Date(ts);
  const day = d.getUTCDay();
  return day >= 1 && day <= 5;
}

export function getMarketSession(ts: number): MarketSession {
  if (!isTradingDay(ts)) return "closed";
  const d = new Date(ts);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const totalMin = h * 60 + m;
  if (totalMin >= 540 && totalMin < 810) return "pre_market";    // 9:00-13:30 UTC
  if (totalMin >= 810 && totalMin < 1200) return "regular";       // 13:30-20:00 UTC
  if (totalMin >= 1200 && totalMin < 1260) return "post_market";  // 20:00-21:00 UTC
  return "closed";
}
