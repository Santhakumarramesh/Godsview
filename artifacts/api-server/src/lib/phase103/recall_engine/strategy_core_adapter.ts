/**
 * P1-9: Adapter that registers the Phase 103 RecallStore as the runtime
 * RecallProvider for lib/strategy-core. Legacy callers of
 * normalizeRecallScore / recallScoreForSetup continue to work, but now get
 * real similarity-backed stats instead of the 0.5 neutral stub.
 *
 * Wired from api-server/src/index.ts so registration happens exactly once
 * at boot.
 */

import {
  setRecallProvider,
  type RecallLookupInput,
  type RecallStats,
} from "@workspace/strategy-core";
import { getRecallStore } from "./recall_store.js";
import type { SetupFeatures } from "./embedding.js";

function toSetupFeatures(input: RecallLookupInput): SetupFeatures {
  const features = input.features ?? {};
  const pick = (k: string) => {
    const v = features[k];
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  };
  const out: SetupFeatures = { symbol: input.symbol };
  if (input.setupType) out.setup_type = input.setupType;
  if (input.regime) out.regime = input.regime;
  const rr = pick("rr");
  if (rr !== undefined) out.rr = rr;
  const confidence = pick("confidence");
  if (confidence !== undefined) out.confidence = confidence;
  return out;
}

export function registerRecallAdapter(): void {
  const store = getRecallStore();

  setRecallProvider({
    async lookup(input: RecallLookupInput): Promise<RecallStats> {
      try {
        const query = toSetupFeatures(input);
        const k = input.k ?? 50;
        const summary = store.summarize(query, k);

        if (!summary || summary.matches === 0) {
          return { sampleSize: 0, winRate: 0.5, expectancyR: 0 };
        }

        return {
          sampleSize: summary.matches,
          winRate: Number(summary.win_rate.toFixed(4)),
          // Use realized RR as the expectancy proxy since the store records
          // rr_realized per match; avg_rr is the mean across matches.
          expectancyR: Number((summary.avg_rr || 0).toFixed(4)),
        };
      } catch {
        return { sampleSize: 0, winRate: 0.5, expectancyR: 0 };
      }
    },
  });
}
