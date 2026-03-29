export interface OrderFlowFeatures {
  cvd: number;
  cvdSlope: number;
  priceSlope: number;
  divergence: boolean;
  buySellRatio: number;
  deltaMomentum: number;
  largeDeltaBar: boolean;
  absorption: boolean;
  sweepDetected: boolean;
  rejectReasons: string[];
}

export function shouldRejectForOrderFlow(
  setupType: "absorption_reversal" | "sweep_reclaim" | "continuation_pullback" | "cvd_divergence" | "breakout_failure",
  features: OrderFlowFeatures,
): string[] {
  const rejectReasons: string[] = [];
  if (setupType === "cvd_divergence" && !features.divergence) rejectReasons.push("cvd_not_ready");
  if (setupType === "absorption_reversal" && !features.absorption) rejectReasons.push("no_absorption_confirmation");
  if (setupType === "sweep_reclaim" && !features.sweepDetected) rejectReasons.push("no_liquidity_sweep");
  return rejectReasons;
}
