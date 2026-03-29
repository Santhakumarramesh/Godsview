export interface RecallStats {
  sampleSize: number;
  winRate: number;
  expectancyR: number;
}

export function normalizeRecallScore(stats: RecallStats): number {
  if (!Number.isFinite(stats.sampleSize) || stats.sampleSize <= 0) return 0.5;
  const sampleFactor = Math.min(1, stats.sampleSize / 200);
  const expectancyFactor = Math.max(0, Math.min(1, (stats.expectancyR + 1) / 2));
  const wrFactor = Math.max(0, Math.min(1, stats.winRate));
  return Number((0.5 * wrFactor + 0.3 * expectancyFactor + 0.2 * sampleFactor).toFixed(4));
}
