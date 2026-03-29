export interface SKFeatures {
  bias: "bull" | "bear" | "neutral";
  inZone: boolean;
  zoneDistancePct: number;
  sequenceStage: "impulse" | "correction" | "completion" | "none";
  rrQuality: number;
  swingHigh: number | null;
  swingLow: number | null;
  rejectReasons: string[];
}

export function shouldRejectForSK(
  setupRequiresSkZone: boolean,
  setupRequiresBiasAlignment: boolean,
  direction: "long" | "short",
  sk: SKFeatures,
): string[] {
  const rejectReasons: string[] = [];
  if (setupRequiresSkZone && !sk.inZone) rejectReasons.push("sk_zone_miss");
  if (setupRequiresBiasAlignment && sk.bias !== "neutral") {
    const aligned = (direction === "long" && sk.bias === "bull") || (direction === "short" && sk.bias === "bear");
    if (!aligned) rejectReasons.push("sk_bias_conflict");
  }
  return rejectReasons;
}
