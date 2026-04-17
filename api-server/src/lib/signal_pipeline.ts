/**
 * signal_pipeline.ts — Shared helpers used by both the live analyze endpoint
 * and the autonomous scanner scheduler.
 *
 * Extracted from routes/alpaca.ts so they can be imported without pulling in
 * the full Express router, DB layer, or Alpaca SDK.
 */

import {
  detectAbsorptionReversal,
  detectSweepReclaim,
  detectContinuationPullback,
  detectCVDDivergence,
  detectBreakoutFailure,
  detectVWAPReclaim,
  detectOpeningRangeBreakout,
  detectPostNewsContinuation,
  type SetupType,
  type RecallFeatures,
} from "./strategy_engine";
import { getSetupDefinition } from "@workspace/strategy-core";
import type { AlpacaBar } from "./alpaca";

// ─── Setup detector dispatch ──────────────────────────────────────────────────

export function runSetupDetector(
  setup: SetupType,
  bars1m: AlpacaBar[],
  bars5m: AlpacaBar[],
  recall: RecallFeatures,
): { detected: boolean; direction: "long" | "short"; structure: number; orderFlow: number } {
  if (setup === "absorption_reversal")   return detectAbsorptionReversal(bars1m, bars5m, recall);
  if (setup === "sweep_reclaim")         return detectSweepReclaim(bars1m, bars5m, recall);
  if (setup === "cvd_divergence")        return detectCVDDivergence(bars1m, bars5m, recall);
  if (setup === "breakout_failure")      return detectBreakoutFailure(bars1m, bars5m, recall);
  if (setup === "vwap_reclaim")          return detectVWAPReclaim(bars1m, bars5m, recall);
  if (setup === "opening_range_breakout") return detectOpeningRangeBreakout(bars1m, bars5m, recall);
  if (setup === "post_news_continuation") return detectPostNewsContinuation(bars1m, bars5m, recall);
  return detectContinuationPullback(bars1m, bars5m, recall);
}

// ─── C4 scoring helpers ───────────────────────────────────────────────────────

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function computeC4ContextScore(recallScore: number, recall: RecallFeatures): number {
  const fakeEntrySafety = 1 - clamp01(recall.fake_entry_risk);
  const persistence     = clamp01(recall.directional_persistence);
  return clamp01(recallScore * 0.65 + fakeEntrySafety * 0.2 + persistence * 0.15);
}

export function computeC4ConfirmationScore(
  setupDef: ReturnType<typeof getSetupDefinition>,
  detected: { structure: number; orderFlow: number },
  recall: RecallFeatures,
): number {
  const reclaimBonus   = setupDef.requiresReclaim
    ? (detected.structure >= setupDef.minStructureScore ? 1 : 0.35)
    : 0.7;
  const flowConfirm    = detected.orderFlow >= setupDef.minOrderFlowScore ? 1 : 0.4;
  const earlyRiskPenalty = 1 - clamp01(recall.fake_entry_risk);
  return clamp01(
    detected.structure  * 0.35 +
    detected.orderFlow  * 0.35 +
    reclaimBonus        * 0.20 +
    flowConfirm         * 0.05 +
    earlyRiskPenalty    * 0.05,
  );
}
