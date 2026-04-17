/**
 * useCandleCountdown.ts — Phase 2 countdown hook
 *
 * Returns a formatted countdown string (e.g. "4:55") that ticks every second
 * and resets automatically when the timeframe changes or a new bucket starts.
 *
 * Uses getCandleBoundary() from clock.ts — no stale-closure drift.
 */

import { useState, useEffect, useRef } from "react";
import { getCandleBoundary, formatCountdown } from "@/lib/market/clock";
import type { Timeframe } from "@/lib/market/clock";

export interface CandleCountdownResult {
  /** Formatted countdown string, e.g. "4:55" or "23:41:05" */
  countdown: string;
  /** Seconds remaining in the current candle bucket */
  remaining: number;
  /** Unix seconds when the current bucket started */
  bucketStart: number;
  /** Unix seconds when the current bucket ends */
  bucketEnd: number;
}

/**
 * Hook that returns a live countdown to the end of the current candle bucket.
 *
 * @param timeframe  Active timeframe selector
 */
export function useCandleCountdown(timeframe: Timeframe): CandleCountdownResult {
  const tfRef = useRef<Timeframe>(timeframe);
  // Keep ref in sync so the interval closure always reads the latest timeframe
  useEffect(() => { tfRef.current = timeframe; }, [timeframe]);

  const compute = () => getCandleBoundary(tfRef.current);

  const [state, setState] = useState<CandleBoundary>(compute);

  useEffect(() => {
    // Fire immediately to avoid a 1-second blank
    setState(compute());

    const id = setInterval(() => {
      setState(compute());
    }, 1000);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // single interval — tfRef keeps it fresh

  return {
    countdown:   formatCountdown(state.remaining),
    remaining:   state.remaining,
    bucketStart: state.bucketStart,
    bucketEnd:   state.bucketEnd,
  };
}

// ── Re-export types so consumers only need one import ──────────────────────
export type { Timeframe };

// ── Internal type used above ───────────────────────────────────────────────
interface CandleBoundary {
  bucketStart: number;
  bucketEnd: number;
  remaining: number;
}
