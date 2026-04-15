// P1-9: recallEngine now acts as a thin wrapper.
//
// strategy-core is a framework-free package (pure TS, zero runtime deps on
// api-server). To let legacy callers of normalizeRecallScore / getRecallStats
// benefit from the Phase 103 RecallStore (which lives in api-server), we
// expose a provider slot that api-server registers at boot via
// setRecallProvider(recallStoreAdapter). When no provider is registered (tests,
// strategy-core CLI usage), we fall back to the original heuristic so callers
// don't crash.

export interface RecallStats {
  sampleSize: number;
  winRate: number;
  expectancyR: number;
}

export interface RecallLookupInput {
  symbol: string;
  setupType?: string;
  regime?: string;
  features?: Record<string, number>;
  k?: number;
}

export interface RecallProvider {
  /** Structural similarity recall against the Phase 103 store. */
  lookup(input: RecallLookupInput): Promise<RecallStats> | RecallStats;
}

let registered: RecallProvider | null = null;

export function setRecallProvider(provider: RecallProvider | null): void {
  registered = provider;
}

export function getRecallProvider(): RecallProvider | null {
  return registered;
}

/**
 * Heuristic fallback used when no RecallProvider is registered. Keeps the
 * legacy contract: callers pass a raw RecallStats and get a normalized score
 * in [0, 1] weighted by sample size, expectancy, and win rate.
 */
export function normalizeRecallScore(stats: RecallStats): number {
  if (!Number.isFinite(stats.sampleSize) || stats.sampleSize <= 0) return 0.5;
  const sampleFactor = Math.min(1, stats.sampleSize / 200);
  const expectancyFactor = Math.max(0, Math.min(1, (stats.expectancyR + 1) / 2));
  const wrFactor = Math.max(0, Math.min(1, stats.winRate));
  return Number((0.5 * wrFactor + 0.3 * expectancyFactor + 0.2 * sampleFactor).toFixed(4));
}

/**
 * Preferred entry point for consumers that want similarity-backed recall.
 * Delegates to the registered RecallProvider (api-server's Phase 103 RecallStore
 * adapter) when one is available; otherwise returns a neutral stub.
 */
export async function recallForSetup(input: RecallLookupInput): Promise<RecallStats> {
  if (registered) {
    return await registered.lookup(input);
  }
  return { sampleSize: 0, winRate: 0.5, expectancyR: 0 };
}

/**
 * Convenience: look up and normalize in one call.
 */
export async function recallScoreForSetup(input: RecallLookupInput): Promise<number> {
  const stats = await recallForSetup(input);
  return normalizeRecallScore(stats);
}
