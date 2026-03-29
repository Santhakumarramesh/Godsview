import type { C4Category, SetupDefinition } from "./types";

export type C4Decision = "TRADE" | "CONDITIONAL" | "REJECT";

export type C4HardGateReason =
  | "sk_zone_required"
  | "bias_mismatch"
  | "cvd_not_ready"
  | "session_blocked"
  | "news_lockout"
  | "degraded_data"
  | "regime_mismatch"
  | "order_flow_not_confirmed"
  | "confirmation_failed";

export interface C4Weights {
  structure: number;
  orderflow: number;
  context: number;
  confirmation: number;
}

export interface C4Thresholds {
  trade: number;
  conditional: number;
}

export interface C4GateInput {
  inSkZone?: boolean;
  sessionAllowed?: boolean;
  newsClear?: boolean;
  degradedData?: boolean;
  biasAligned?: boolean;
  cvdReady?: boolean;
  confirmationValid?: boolean;
  orderFlowConfirmed?: boolean;
  regime?: string;
}

export interface C4EvaluationInput {
  setup: Pick<
    SetupDefinition,
    | "type"
    | "c4Category"
    | "allowedRegimes"
    | "requiresSkZone"
    | "requiresBiasAlignment"
    | "requiresCvdDivergence"
  >;
  scores: {
    structure: number;
    orderflow: number;
    context: number;
    confirmation: number;
  };
  gates?: C4GateInput;
  thresholds?: Partial<C4Thresholds>;
  useDynamicWeights?: boolean;
}

export interface C4EvaluationResult {
  score: number;
  decision: C4Decision;
  blocked: boolean;
  block_reasons: C4HardGateReason[];
  weights: C4Weights;
  thresholds: C4Thresholds;
  regime_ok: boolean;
}

const DEFAULT_THRESHOLDS: C4Thresholds = {
  trade: 0.75,
  conditional: 0.65,
};

const BASE_WEIGHTS: C4Weights = {
  structure: 0.35,
  orderflow: 0.30,
  context: 0.20,
  confirmation: 0.15,
};

const CATEGORY_WEIGHT_ADJUSTMENTS: Record<C4Category, Partial<C4Weights>> = {
  reversal: { orderflow: 0.33, structure: 0.33, context: 0.20, confirmation: 0.14 },
  continuation: { structure: 0.38, orderflow: 0.28, context: 0.21, confirmation: 0.13 },
  breakout: { structure: 0.34, orderflow: 0.29, context: 0.17, confirmation: 0.20 },
  trap: { structure: 0.32, orderflow: 0.35, context: 0.20, confirmation: 0.13 },
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeWeights(weights: C4Weights): C4Weights {
  const total = weights.structure + weights.orderflow + weights.context + weights.confirmation;
  if (!Number.isFinite(total) || total <= 0) return { ...BASE_WEIGHTS };
  return {
    structure: weights.structure / total,
    orderflow: weights.orderflow / total,
    context: weights.context / total,
    confirmation: weights.confirmation / total,
  };
}

export function getC4Weights(category: C4Category, regime?: string): C4Weights {
  const adjusted = {
    ...BASE_WEIGHTS,
    ...CATEGORY_WEIGHT_ADJUSTMENTS[category],
  };

  // Regime-aware micro-adjustments keep total normalized to 1.
  if (category === "continuation" && (regime === "trending_bull" || regime === "trending_bear")) {
    adjusted.structure += 0.02;
    adjusted.confirmation -= 0.01;
    adjusted.context -= 0.01;
  } else if (category === "trap" && (regime === "ranging" || regime === "volatile")) {
    adjusted.orderflow += 0.02;
    adjusted.structure -= 0.01;
    adjusted.confirmation -= 0.01;
  } else if (category === "breakout" && regime === "volatile") {
    adjusted.confirmation += 0.02;
    adjusted.context -= 0.01;
    adjusted.structure -= 0.01;
  }

  return normalizeWeights(adjusted);
}

export function isRegimeAllowedForC4(setup: C4EvaluationInput["setup"], regime: string | undefined): boolean {
  const normalizedRegime = String(regime ?? "").trim();
  if (!normalizedRegime) return true;
  if (normalizedRegime === "chop") return false;
  if (!setup.allowedRegimes || setup.allowedRegimes.length === 0) return true;
  return setup.allowedRegimes.includes(normalizedRegime);
}

export function evaluateC4Decision(input: C4EvaluationInput): C4EvaluationResult {
  const thresholds: C4Thresholds = {
    trade: clamp01(input.thresholds?.trade ?? DEFAULT_THRESHOLDS.trade),
    conditional: clamp01(input.thresholds?.conditional ?? DEFAULT_THRESHOLDS.conditional),
  };
  if (thresholds.conditional > thresholds.trade) {
    thresholds.conditional = thresholds.trade;
  }

  const gates = input.gates ?? {};
  const block_reasons: C4HardGateReason[] = [];

  if (gates.degradedData) block_reasons.push("degraded_data");
  if (gates.sessionAllowed === false) block_reasons.push("session_blocked");
  if (gates.newsClear === false) block_reasons.push("news_lockout");
  if (input.setup.requiresSkZone && gates.inSkZone === false) block_reasons.push("sk_zone_required");
  if (input.setup.requiresBiasAlignment && gates.biasAligned === false) block_reasons.push("bias_mismatch");
  if (input.setup.requiresCvdDivergence && gates.cvdReady === false) block_reasons.push("cvd_not_ready");
  if (gates.orderFlowConfirmed === false) block_reasons.push("order_flow_not_confirmed");
  if (gates.confirmationValid === false) block_reasons.push("confirmation_failed");

  const regime_ok = isRegimeAllowedForC4(input.setup, gates.regime);
  if (!regime_ok) block_reasons.push("regime_mismatch");

  const weights = input.useDynamicWeights === false
    ? { ...BASE_WEIGHTS }
    : getC4Weights(input.setup.c4Category, gates.regime);

  const score = Number(
    (
      weights.structure * clamp01(input.scores.structure) +
      weights.orderflow * clamp01(input.scores.orderflow) +
      weights.context * clamp01(input.scores.context) +
      weights.confirmation * clamp01(input.scores.confirmation)
    ).toFixed(4),
  );

  if (block_reasons.length > 0) {
    return {
      score,
      decision: "REJECT",
      blocked: true,
      block_reasons,
      weights,
      thresholds,
      regime_ok,
    };
  }

  const decision: C4Decision =
    score >= thresholds.trade ? "TRADE" :
    score >= thresholds.conditional ? "CONDITIONAL" :
    "REJECT";

  return {
    score,
    decision,
    blocked: false,
    block_reasons: [],
    weights,
    thresholds,
    regime_ok,
  };
}

export function getC4SizeMultiplier(decision: C4Decision): number {
  if (decision === "TRADE") return 1;
  if (decision === "CONDITIONAL") return 0.5;
  return 0;
}
