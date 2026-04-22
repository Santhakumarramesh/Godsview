import type {
  AbsorptionMetrics,
  ImbalanceMetrics,
  LiquidityHeatmapSnapshot,
  MicrostructureCompositeScore,
  NormalizedOrderBook,
  TapeSummary,
} from "./microstructure_types";

function clamp(value: number, min = 0, max = 1): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function computeMicrostructureScore(input: {
  orderbook: NormalizedOrderBook;
  imbalance: ImbalanceMetrics;
  absorption: AbsorptionMetrics;
  heatmap: LiquidityHeatmapSnapshot;
  tape: TapeSummary;
}): MicrostructureCompositeScore {
  const { orderbook, imbalance, absorption, heatmap, tape } = input;

  const spreadBps = orderbook.spread_bps ?? 999;
  const spreadQuality = spreadBps <= 1.5
    ? 1
    : spreadBps <= 4
      ? 0.75
      : spreadBps <= 8
        ? 0.5
        : 0.2;

  const imbalanceComponent = clamp(imbalance.score);
  const absorptionComponent = clamp(absorption.score);
  const liquidityComponent = clamp(heatmap.zone_score);
  const tapeComponent = clamp(tape.score);

  const weighted = clamp(
    imbalanceComponent * 0.28 +
    absorptionComponent * 0.26 +
    liquidityComponent * 0.2 +
    tapeComponent * 0.16 +
    spreadQuality * 0.1,
  );

  const directionalSignal = clamp(
    (imbalance.weighted_imbalance * 0.5) +
    (tape.normalized_delta * 0.35) +
    (absorption.state === "bid_absorption" ? 0.2 : absorption.state === "ask_absorption" ? -0.2 : 0),
    -1,
    1,
  );

  const direction: MicrostructureCompositeScore["direction"] =
    directionalSignal > 0.08 ? "long" : directionalSignal < -0.08 ? "short" : "flat";

  let verdict: MicrostructureCompositeScore["verdict"] = "neutral";
  let quality: MicrostructureCompositeScore["quality"] = "low";

  if (weighted >= 0.76 && direction === "long") verdict = "high_conviction_long";
  else if (weighted >= 0.76 && direction === "short") verdict = "high_conviction_short";
  else if (weighted >= 0.58 && direction === "long") verdict = "tradable_long";
  else if (weighted >= 0.58 && direction === "short") verdict = "tradable_short";
  else if (weighted < 0.42) verdict = "avoid";

  if (weighted >= 0.76) quality = "high";
  else if (weighted >= 0.5) quality = "medium";

  const confidence = clamp(weighted * 0.7 + Math.abs(directionalSignal) * 0.3);

  const reasons: string[] = [];
  if (imbalance.bias === "buy") reasons.push("Bid stack imbalance favors buyers");
  if (imbalance.bias === "sell") reasons.push("Ask stack imbalance favors sellers");
  if (absorption.state === "bid_absorption") reasons.push("Bid absorption indicates hidden demand");
  if (absorption.state === "ask_absorption") reasons.push("Ask absorption indicates hidden supply");
  if (tape.bias === "buy") reasons.push("Tape flow is net buyer aggressive");
  if (tape.bias === "sell") reasons.push("Tape flow is net seller aggressive");
  if (spreadQuality < 0.4) reasons.push("Wide spread degrades execution quality");
  if (reasons.length === 0) reasons.push("Mixed microstructure signals");

  return {
    score: round(weighted, 6),
    confidence: round(confidence, 6),
    quality,
    direction,
    verdict,
    reasons,
    components: {
      imbalance: round(imbalanceComponent, 6),
      absorption: round(absorptionComponent, 6),
      liquidity: round(liquidityComponent, 6),
      tape: round(tapeComponent, 6),
      spread_quality: round(spreadQuality, 6),
    },
  };
}
