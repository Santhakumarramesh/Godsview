import type { Bar, OrderBlock1H } from "./types";

export type RetestResult =
  | { kind: "ob_broken"; atIndex: number }
  | { kind: "expired"; checkedThrough: number }
  | { kind: "confirmed"; index: number; ts: string; close: number };

export function findRetestConfirmation(
  bars: Bar[], ob: OrderBlock1H, maxBars: number,
): RetestResult {
  const start = ob.bosIndex + 1;
  const end = Math.min(bars.length - 1, ob.bosIndex + maxBars);
  for (let i = start; i <= end; i++) {
    const b = bars[i]!;
    if (b.Close < ob.obLow) {
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
