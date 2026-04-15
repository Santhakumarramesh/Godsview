/**
 * P1-9: Adapter that registers the Phase 103 RecallStore as the runtime
 * RecallProvider for lib/strategy-core. Legacy callers of normalizeRecallScore
 * / recallScoreForSetup continue to work, but now get real similarity-backed
 * stats instead of the 0.5 neutral stub.
 *
 * Wired in api-server/src/index.ts so registration happens exactly once at
 * boot, after the DB is ready.
 */

import { setRecallProvider, type RecallLookupInput, type RecallStats } from "@workspace/strategy-core";
import { getRecallStore } from "./recall_store.js";

export function registerRecallAdapter(): void {
  const store = getRecallStore();

  setRecallProvider({
    async lookup(input: RecallLookupInput): Promise<RecallStats> {
      try {
        const matches = await store.similaritySearch({
          symbol: input.symbol,
          setup_type: input.setupType,
          regime: input.regime,
          features: input.features ?? {},
          k: input.k ?? 50,
        } as any);

        const list = Array.isArray(matches) ? matches : (matches as any)?.matches ?? [];
        if (!Array.isArray(list) || list.length === 0) {
          return { sampleSize: 0, winRate: 0.5, expectancyR: 0 };
        }

        const wins = list.filter((m: any) => Number(m.outcome_r ?? m.realized_r ?? 0) > 0).length;
        const winRate = wins / list.length;
        const expectancyR =
          list.reduce((s: number, m: any) => s + Number(m.outcome_r ?? m.realized_r ?? 0), 0) /
          list.length;

        return {
          sampleSize: list.length,
          winRate: Number(winRate.toFixed(4)),
          expectancyR: Number(expectancyR.toFixed(4)),
        };
      } catch {
        return { sampleSize: 0, winRate: 0.5, expectancyR: 0 };
      }
    },
  });
}
