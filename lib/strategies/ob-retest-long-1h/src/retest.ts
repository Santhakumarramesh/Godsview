import type { Bar, OrderBlock1H } from "./types";

export type RetestResult =
  | { kind: "ob_broken"; atIndex: number }
  | { kind: "expired"; checkedThrough: number }
  | { kind: "confirmed"; index: number; ts: string; close: number };

/**
 * Walk forward from BOS+1 looking for either:
 *   (a) an OB break — a bar that closes below `effectiveLow`, OR
 *   (b) a retest confirmation — a bar that touches the OB zone AND closes bullish.
 *
 * `effectiveLow = obLow * (1 - obBreakBufferPct)`.
 *
 *   - obBreakBufferPct = 0 (default, strict baseline): any Close < obLow invalidates.
 *   - obBreakBufferPct > 0 (M5c experiment): allow brief Close excursions below
 *     obLow up to that fraction before declaring the OB broken. Useful for
 *     absorbing single-bar wick spikes on volatile crypto. NOT enabled in
 *     production by default — see types.ts Config.obBreakBufferPct doc.
 *
 * The buffer is clamped to [0, 0.05] internally (5% absolute cap) so that no
 * misconfiguration silently disables the OB-break check entirely.
 */
export function findRetestConfirmation(
  bars: Bar[],
  ob: OrderBlock1H,
  maxBars: number,
  obBreakBufferPct: number = 0,
): RetestResult {
  const safeBuffer = Math.min(0.05, Math.max(0, Number.isFinite(obBreakBufferPct) ? obBreakBufferPct : 0));
  const effectiveLow = ob.obLow * (1 - safeBuffer);
  const start = ob.bosIndex + 1;
  const end = Math.min(bars.length - 1, ob.bosIndex + maxBars);
  for (let i = start; i <= end; i++) {
    const b = bars[i]!;
    if (b.Close < effectiveLow) {
      return { kind: "ob_broken", atIndex: i };
    }
    const touchesZone = b.Low <= ob.obHigh && b.High >= ob.obLow;
    const bullishClose = b.Close > b.Open;
    if (touchesZone && bullishClose) {
      return { kind: "confirmed", index: i, ts: b.Timestamp, close: b.Close };
    }
  }
  return { kind: "expired", checkedThrough: end };
}
