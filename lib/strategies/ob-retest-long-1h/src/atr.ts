import type { Bar } from "./types";

export function trueRange(bar: Bar, prevClose: number | null): number {
  const hl = bar.High - bar.Low;
  if (prevClose === null) return hl;
  const hc = Math.abs(bar.High - prevClose);
  const lc = Math.abs(bar.Low - prevClose);
  return Math.max(hl, hc, lc);
}

export function atr(bars: Bar[], period: number): number[] {
  const out: number[] = new Array(bars.length).fill(NaN);
  if (period <= 0 || bars.length < period) return out;
  let sumTR = 0;
  for (let i = 0; i < period; i++) {
    const prevC = i === 0 ? null : bars[i - 1]!.Close;
    sumTR += trueRange(bars[i]!, prevC);
  }
  out[period - 1] = sumTR / period;
  for (let i = period; i < bars.length; i++) {
    const tr = trueRange(bars[i]!, bars[i - 1]!.Close);
    out[i] = (out[i - 1]! * (period - 1) + tr) / period;
  }
  return out;
}

export function smaIgnoreNaN(values: number[], window: number, atIndex: number): number {
  if (atIndex < 0 || atIndex >= values.length) return NaN;
  const start = Math.max(0, atIndex - window + 1);
  let sum = 0;
  let n = 0;
  for (let i = start; i <= atIndex; i++) {
    const v = values[i]!;
    if (!Number.isNaN(v)) { sum += v; n++; }
  }
  return n === 0 ? NaN : sum / n;
}
