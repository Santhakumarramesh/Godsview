import type { NewsEvent } from "./types";
import { smaIgnoreNaN } from "./atr";

export function atrTooLow(
  atrSeries: number[], index: number, window: number, minRatio: number,
): boolean {
  const cur = atrSeries[index];
  if (cur === undefined || !Number.isFinite(cur)) return true;
  const avg = smaIgnoreNaN(atrSeries, window, index);
  if (!Number.isFinite(avg) || avg <= 0) return false;
  return cur / avg < minRatio;
}

export function inNewsWindow(
  barTs: string, news: NewsEvent[] | undefined, blockMinutes: number,
): boolean {
  if (!news || news.length === 0) return false;
  const t = Date.parse(barTs);
  if (Number.isNaN(t)) return false;
  const span = blockMinutes * 60_000;
  for (const ev of news) {
    if (ev.severity !== "high") continue;
    const et = Date.parse(ev.ts);
    if (Number.isNaN(et)) continue;
    if (Math.abs(t - et) <= span) return true;
  }
  return false;
}
