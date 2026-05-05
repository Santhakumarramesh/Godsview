import type { Bar } from "./types";

export function findOrderBlockForBOS(
  bars: Bar[], bosIndex: number, brokenSwingIndex: number,
): { obIndex: number; obLow: number; obHigh: number } | null {
  const lowerBound = Math.max(0, Math.min(brokenSwingIndex - 5, bosIndex - 30));
  for (let i = bosIndex - 1; i >= lowerBound; i--) {
    const b = bars[i]!;
    if (b.Close < b.Open) {
      return { obIndex: i, obLow: b.Low, obHigh: b.High };
    }
  }
  return null;
}

export function displacementATR(
  bars: Bar[], obIndex: number, bosIndex: number, atrAtBos: number,
): number {
  if (!Number.isFinite(atrAtBos) || atrAtBos <= 0) return 0;
  if (obIndex > bosIndex) return 0;
  let high = -Infinity, low = Infinity;
  for (let i = obIndex; i <= bosIndex; i++) {
    const b = bars[i]!;
    if (b.High > high) high = b.High;
    if (b.Low < low) low = b.Low;
  }
  return (high - low) / atrAtBos;
}
