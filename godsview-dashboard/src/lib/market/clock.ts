/**
 * clock.ts — Candle boundary utilities (Phase 2)
 *
 * All arithmetic is in UTC seconds, matching Alpaca bar timestamps.
 * The only public unit is "remaining seconds until candle close".
 */

export type Timeframe = "1Min" | "5Min" | "15Min" | "1Hour" | "1Day";

/** Seconds per timeframe */
export const TF_SECONDS: Record<Timeframe, number> = {
  "1Min":  60,
  "5Min":  300,
  "15Min": 900,
  "1Hour": 3600,
  "1Day":  86400,
};

export interface CandleBoundary {
  /** Unix seconds of the START of the current bucket */
  bucketStart: number;
  /** Unix seconds of the END of the current bucket (= next bucket start) */
  bucketEnd: number;
  /** Seconds remaining until bucketEnd from nowMs */
  remaining: number;
}

/**
 * Compute the current candle bucket boundary for a given timeframe,
 * using the supplied timestamp (defaults to Date.now()).
 *
 * Uses floor division in UTC seconds — identical to Alpaca's bar bucketing.
 */
export function getCandleBoundary(
  timeframe: Timeframe,
  nowMs: number = Date.now(),
): CandleBoundary {
  const tfSec = TF_SECONDS[timeframe];
  const nowSec = Math.floor(nowMs / 1000);
  const bucketStart = Math.floor(nowSec / tfSec) * tfSec;
  const bucketEnd = bucketStart + tfSec;
  const remaining = Math.max(0, bucketEnd - nowSec);
  return { bucketStart, bucketEnd, remaining };
}

/**
 * Format a remaining-seconds value as a countdown string.
 *   < 1 h  →  "m:ss"   (e.g. "4:55", "0:07")
 *   ≥ 1 h  →  "h:mm:ss"  (e.g. "23:41:05")
 */
export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

/**
 * Given a candle's open timestamp (Unix seconds) and a timeframe,
 * return whether the candle belongs to the CURRENT wall-clock bucket.
 * Used by the supplement poller to detect bucket roll-overs.
 */
export function isSameBucket(candleTime: number, timeframe: Timeframe): boolean {
  const { bucketStart } = getCandleBoundary(timeframe);
  return candleTime === bucketStart;
}
