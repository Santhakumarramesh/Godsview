import type {
  AbsorptionMetrics,
  ImbalanceMetrics,
  MicrostructureCurrentSnapshot,
  NormalizedOrderBook,
} from "./microstructure_types";

export interface AbsorptionParams {
  history?: MicrostructureCurrentSnapshot[];
  persistence_window?: number;
  max_drift_bps?: number;
}

function clamp(value: number, min = 0, max = 1): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function computeMidDriftBps(currentMid: number | null, previousMid: number | null): number {
  if (!currentMid || !previousMid || currentMid <= 0 || previousMid <= 0) return 0;
  return ((currentMid - previousMid) / previousMid) * 10_000;
}

export function detectAbsorption(
  orderbook: NormalizedOrderBook,
  imbalance: ImbalanceMetrics,
  params: AbsorptionParams = {},
): AbsorptionMetrics {
  const historyWindow = Math.max(3, Math.min(40, Math.round(params.persistence_window ?? 10)));
  const maxDriftBps = Math.max(0.25, Math.min(20, params.max_drift_bps ?? 2.5));
  const history = (params.history ?? []).slice(-historyWindow);

  const previousMid = history.length > 0
    ? history[0]?.orderbook.mid_price ?? null
    : null;

  const currentMid = orderbook.mid_price;
  const midDriftBps = computeMidDriftBps(currentMid, previousMid);
  const driftTight = Math.abs(midDriftBps) <= maxDriftBps;

  const spreadBps = orderbook.spread_bps ?? 999;
  const spreadTightScore = spreadBps <= 2.5 ? 1 : spreadBps <= 5 ? 0.65 : 0.2;

  const pressureSign = Math.sign(imbalance.weighted_imbalance);
  const directionalHistory = history.filter((s) => Math.sign(s.imbalance.weighted_imbalance) === pressureSign);
  const persistence = history.length > 0 ? directionalHistory.length / history.length : 0;

  const pressureStrength = Math.min(1, Math.abs(imbalance.weighted_imbalance) / 0.6);
  const driftScore = driftTight ? 1 : Math.max(0, 1 - Math.abs(midDriftBps) / (maxDriftBps * 4));

  const confidence = clamp(
    pressureStrength * 0.45 +
    driftScore * 0.25 +
    persistence * 0.2 +
    spreadTightScore * 0.1,
  );

  let state: AbsorptionMetrics["state"] = "none";
  let reason = "No reliable absorption signature";

  if (confidence >= 0.45 && pressureStrength >= 0.35) {
    if (pressureSign > 0) {
      state = "bid_absorption";
      reason = "Buy pressure persists while mid-price remains anchored";
    } else if (pressureSign < 0) {
      state = "ask_absorption";
      reason = "Sell pressure persists while mid-price remains anchored";
    }
  }

  if (!driftTight && confidence < 0.65) {
    state = "none";
    reason = "Directional pressure exists but price drift is too large";
  }

  const score = clamp(confidence * 0.7 + pressureStrength * 0.3);

  return {
    state,
    score: Number(score.toFixed(6)),
    confidence: Number(confidence.toFixed(6)),
    persistence: Number(clamp(persistence).toFixed(6)),
    mid_drift_bps: Number(midDriftBps.toFixed(4)),
    spread_bps: Number(spreadBps.toFixed(4)),
    reason,
  };
}
