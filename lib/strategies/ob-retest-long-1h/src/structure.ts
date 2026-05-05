import type { Bar } from "./types";

export interface Pivot {
  index: number;
  price: number;
  kind: "high" | "low";
}

export function detectPivots(bars: Bar[], left: number, right: number): Pivot[] {
  const pivots: Pivot[] = [];
  for (let i = left; i < bars.length - right; i++) {
    const h = bars[i]!.High;
    const l = bars[i]!.Low;
    let isHigh = true, isLow = true;
    for (let k = 1; k <= left; k++) {
      if (bars[i - k]!.High >= h) isHigh = false;
      if (bars[i - k]!.Low <= l) isLow = false;
    }
    for (let k = 1; k <= right; k++) {
      if (bars[i + k]!.High >= h) isHigh = false;
      if (bars[i + k]!.Low <= l) isLow = false;
    }
    if (isHigh) pivots.push({ index: i, price: h, kind: "high" });
    if (isLow) pivots.push({ index: i, price: l, kind: "low" });
  }
  return pivots;
}

export interface BOSUp {
  bosIndex: number;
  brokenSwingIndex: number;
  brokenSwingPrice: number;
}

/**
 * Find the most recent BOS-up *event*: among all confirmed swing highs, take
 * the FIRST bar after each one whose High > pivot.price (that bar is the BOS
 * for that pivot — once broken, the pivot is consumed). Return the (pivot,
 * bos-bar) pair with the latest bos-bar index. This guarantees we don't
 * count flat padding bars after an already-consumed pivot as new BOS events.
 */
export function findLatestBOSUp(
  bars: Bar[], pivots: Pivot[], endIndex: number, rightBuffer: number,
): BOSUp | null {
  const highs = pivots
    .filter((p) => p.kind === "high" && p.index + rightBuffer <= endIndex)
    .sort((a, b) => a.index - b.index);
  let best: BOSUp | null = null;
  for (const piv of highs) {
    const cap = Math.min(endIndex, bars.length - 1);
    for (let i = piv.index + 1; i <= cap; i++) {
      if (bars[i]!.High > piv.price) {
        const bos: BOSUp = {
          bosIndex: i,
          brokenSwingIndex: piv.index,
          brokenSwingPrice: piv.price,
        };
        if (!best || bos.bosIndex > best.bosIndex) best = bos;
        break;
      }
    }
  }
  return best;
}

/**
 * Find the first BOS-down event in [startIndex, endIndex]: a bar whose Low
 * strictly breaks the most recent confirmed swing low at or before that bar.
 *
 * Used for opposite-BOS invalidation while waiting for a long retest. We only
 * care about the FIRST occurrence after BOS-up, so this returns immediately.
 */
export function findBOSDownAfter(
  bars: Bar[], pivots: Pivot[], startIndex: number, endIndex: number, rightBuffer: number,
): number | null {
  const lows = pivots
    .filter((p) => p.kind === "low")
    .sort((a, b) => a.index - b.index);
  const cap = Math.min(endIndex, bars.length - 1);
  for (let i = startIndex; i <= cap; i++) {
    let candidate: typeof lows[number] | null = null;
    for (const p of lows) {
      if (p.index + rightBuffer <= i && p.index < i) {
        if (candidate === null || p.index > candidate.index) candidate = p;
      }
    }
    if (!candidate) continue;
    if (bars[i]!.Low < candidate.price) return i;
  }
  return null;
}

export function isBullishStructure(
  pivots: Pivot[], referenceIndex: number, rightBuffer: number,
): boolean {
  const usable = pivots.filter((p) => p.index + rightBuffer <= referenceIndex);
  const highs = usable.filter((p) => p.kind === "high").sort((a, b) => a.index - b.index);
  const lows = usable.filter((p) => p.kind === "low").sort((a, b) => a.index - b.index);
  if (highs.length < 2 || lows.length < 2) return false;
  const h1 = highs[highs.length - 2]!.price;
  const h2 = highs[highs.length - 1]!.price;
  const l1 = lows[lows.length - 2]!.price;
  const l2 = lows[lows.length - 1]!.price;
  return h2 > h1 && l2 > l1;
}
