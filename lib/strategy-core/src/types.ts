export type SetupType =
  | "absorption_reversal"
  | "sweep_reclaim"
  | "continuation_pullback"
  | "cvd_divergence"
  | "breakout_failure"
  | "vwap_reclaim"
  | "opening_range_breakout"
  | "post_news_continuation";

export type Direction = "long" | "short";

export type RiskModel = "reversal" | "continuation" | "breakout-fade";
export type C4Category = "reversal" | "continuation" | "breakout" | "trap";

export type SystemMode = "demo" | "paper" | "live_disabled" | "live_enabled";
export type DecisionState = "TRADE" | "PASS" | "REJECTED" | "BLOCKED_BY_RISK" | "DEGRADED_DATA";

export interface SetupDefinition {
  type: SetupType;
  label: string;
  c4Category: C4Category;
  allowedRegimes?: string[];
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
