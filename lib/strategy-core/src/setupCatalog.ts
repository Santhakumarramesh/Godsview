import type { SetupDefinition, SetupType } from "./types";

export const SETUP_CATALOG = {
  absorption_reversal: {
    type: "absorption_reversal",
    label: "Absorption Reversal",
    c4Category: "reversal",
    allowedRegimes: ["ranging", "volatile", "trending_bull", "trending_bear"],
    requiresSkZone: true,
    requiresBiasAlignment: true,
    requiresCvdDivergence: false,
    requiresReclaim: true,
    minStructureScore: 0.62,
    minOrderFlowScore: 0.60,
    minRecallScore: 0.50,
    minFinalQuality: 0.68,
    riskModel: "reversal",
  },
  sweep_reclaim: {
    type: "sweep_reclaim",
    label: "Sweep Reclaim",
    c4Category: "reversal",
    allowedRegimes: ["ranging", "volatile", "trending_bull", "trending_bear"],
    requiresSkZone: true,
    requiresBiasAlignment: true,
    requiresCvdDivergence: false,
    requiresReclaim: true,
    minStructureScore: 0.66,
    minOrderFlowScore: 0.63,
    minRecallScore: 0.52,
    minFinalQuality: 0.70,
    riskModel: "reversal",
  },
  continuation_pullback: {
    type: "continuation_pullback",
    label: "Continuation Pullback",
    c4Category: "continuation",
    allowedRegimes: ["trending_bull", "trending_bear"],
    requiresSkZone: false,
    requiresBiasAlignment: true,
    requiresCvdDivergence: false,
    requiresReclaim: false,
    minStructureScore: 0.60,
    minOrderFlowScore: 0.55,
    minRecallScore: 0.58,
    minFinalQuality: 0.67,
    riskModel: "continuation",
  },
  cvd_divergence: {
    type: "cvd_divergence",
    label: "CVD Divergence",
    c4Category: "reversal",
    allowedRegimes: ["ranging", "volatile", "trending_bull", "trending_bear"],
    requiresSkZone: true,
    requiresBiasAlignment: false,
    requiresCvdDivergence: true,
    requiresReclaim: false,
    minStructureScore: 0.58,
    minOrderFlowScore: 0.67,
    minRecallScore: 0.52,
    minFinalQuality: 0.69,
    riskModel: "reversal",
  },
  breakout_failure: {
    type: "breakout_failure",
    label: "Breakout Failure",
    c4Category: "trap",
    allowedRegimes: ["ranging", "volatile", "trending_bull", "trending_bear"],
    requiresSkZone: true,
    requiresBiasAlignment: false,
    requiresCvdDivergence: false,
    requiresReclaim: true,
    minStructureScore: 0.68,
    minOrderFlowScore: 0.61,
    minRecallScore: 0.50,
    minFinalQuality: 0.71,
    riskModel: "breakout-fade",
  },
} satisfies Record<SetupType, SetupDefinition>;

export const DEFAULT_SETUPS = Object.keys(SETUP_CATALOG) as SetupType[];

export function isSetupType(value: string): value is SetupType {
  return value in SETUP_CATALOG;
}

export function getSetupDefinition(setup: SetupType): SetupDefinition {
  return SETUP_CATALOG[setup];
}
