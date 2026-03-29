export type SetupType =
  | "absorption_reversal"
  | "sweep_reclaim"
  | "continuation_pullback"
  | "cvd_divergence"
  | "breakout_failure";

export type Direction = "long" | "short";

export type RiskModel = "reversal" | "continuation" | "breakout-fade";

export type SystemMode = "demo" | "paper" | "live_disabled" | "live_enabled";

export interface SetupDefinition {
  type: SetupType;
  label: string;
  requiresSkZone: boolean;
  requiresBiasAlignment: boolean;
  requiresCvdDivergence: boolean;
  requiresReclaim: boolean;
  minStructureScore: number;
  minOrderFlowScore: number;
  minRecallScore: number;
  minFinalQuality: number;
  riskModel: RiskModel;
}
