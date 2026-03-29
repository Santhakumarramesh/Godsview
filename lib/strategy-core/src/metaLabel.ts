import type { C4Decision } from "./c4";
import type { C4Category } from "./types";
import type { MarketRegimeClass } from "./regimeEngine";

export type MetaLabelDecision = "TAKE" | "REDUCE" | "SKIP";

export interface MetaLabelInput {
  c4Decision: C4Decision;
  c4Category: C4Category;
  regimeClass: MarketRegimeClass;
  finalQuality: number;
  qualityThreshold: number;
  mlProbability: number;
  fakeEntryRisk: number;
  structureScore: number;
  orderFlowScore: number;
}

export interface MetaLabelResult {
  decision: MetaLabelDecision;
  score: number;
  sizeMultiplier: number;
  reasons: string[];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function regimePenalty(regimeClass: MarketRegimeClass, category: C4Category): number {
  if (regimeClass === "news_distorted") return 0.22;
  if (regimeClass === "chop_low_edge") return 0.16;
  if (regimeClass === "breakout_expansion" && category === "reversal") return 0.08;
  if (regimeClass === "trend_day" && category === "trap") return 0.06;
  return 0;
}

export function evaluateMetaLabelDecision(input: MetaLabelInput): MetaLabelResult {
  const reasons: string[] = [];

  const finalQuality = clamp01(input.finalQuality);
  const threshold = clamp01(input.qualityThreshold);
  const mlProbability = clamp01(input.mlProbability);
  const fakeRisk = clamp01(input.fakeEntryRisk);
  const structure = clamp01(input.structureScore);
  const orderFlow = clamp01(input.orderFlowScore);

  if (input.c4Decision === "REJECT") reasons.push("c4_reject");
  if (input.regimeClass === "news_distorted") reasons.push("news_distorted_regime");
  if (input.regimeClass === "chop_low_edge") reasons.push("chop_regime");
  if (fakeRisk > 0.75) reasons.push("high_fake_entry_risk");
  if (mlProbability < 0.45) reasons.push("low_ml_probability");
  if (finalQuality < threshold * 0.9) reasons.push("below_quality_floor");

  if (reasons.length > 0) {
    return {
      decision: "SKIP",
      score: 0,
      sizeMultiplier: 0,
      reasons,
    };
  }

  let score =
    finalQuality * 0.35 +
    mlProbability * 0.35 +
    (1 - fakeRisk) * 0.2 +
    Math.min(structure, orderFlow) * 0.1;

  if (input.c4Decision === "CONDITIONAL") {
    score -= 0.08;
    reasons.push("c4_conditional_size_down");
  }
  score -= regimePenalty(input.regimeClass, input.c4Category);
  score = clamp01(score);

  if (score >= 0.72 && mlProbability >= 0.58 && fakeRisk <= 0.55 && finalQuality >= threshold) {
    return {
      decision: "TAKE",
      score,
      sizeMultiplier: 1,
      reasons,
    };
  }

  if (score >= 0.6 && mlProbability >= 0.5 && fakeRisk <= 0.68) {
    reasons.push("reduced_size_due_to_meta_gate");
    return {
      decision: "REDUCE",
      score,
      sizeMultiplier: 0.5,
      reasons,
    };
  }

  reasons.push("meta_score_below_execution_floor");
  return {
    decision: "SKIP",
    score,
    sizeMultiplier: 0,
    reasons,
  };
}

