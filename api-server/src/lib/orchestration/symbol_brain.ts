/**
 * Symbol Brain — per-symbol intelligence aggregation.
 *
 * Takes structure, regime, orderflow, and memory inputs and produces
 * a unified readiness score for each symbol.
 */
import type { SymbolBrainState, StructureState, RegimeState, CandleOrderflowPacket } from "@workspace/common-types";

export function buildSymbolBrainState(input: {
  structure: StructureState;
  regime: RegimeState;
  orderflow: CandleOrderflowPacket;
  memoryScore: number;
  stressPenalty: number;
}): SymbolBrainState {
  const regimeScore = input.regime.confidence;
  const orderflowScore = Math.max(0, Math.min(1, (input.orderflow.imbalance + 1) / 2));

  const readinessScore = Math.max(0, Math.min(1,
    input.structure.structureScore * 0.32 +
    regimeScore * 0.18 +
    orderflowScore * 0.20 +
    input.memoryScore * 0.20 -
    input.stressPenalty * 0.10,
  ));

  return {
    symbol: input.structure.symbol,
    ts: input.structure.ts,
    structureScore: input.structure.structureScore,
    regimeScore,
    orderflowScore,
    stressPenalty: input.stressPenalty,
    memoryScore: input.memoryScore,
    readinessScore,
  };
}

/** Minimum readiness threshold for trade consideration */
export const MIN_READINESS_THRESHOLD = 0.55;

/** Check if symbol is trade-ready based on brain state */
export function isTradeReady(state: SymbolBrainState): boolean {
  return state.readinessScore >= MIN_READINESS_THRESHOLD && state.stressPenalty < 0.5;
}
