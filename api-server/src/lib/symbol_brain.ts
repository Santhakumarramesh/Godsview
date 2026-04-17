/**
 * symbol_brain.ts — Unified Symbol Brain State
 *
 * Merges outputs from all intelligence engines into one coherent
 * per-symbol brain state with composite scoring:
 *   - SMC Engine (structure, OBs, FVGs, liquidity pools)
 *   - Regime Engine (basic + spectral)
 *   - Order Flow Engine (delta, CVD, absorption, sweeps)
 *   - Volatility / Stress Engine (per-symbol vol + market stress)
 *   - Market DNA (personality traits)
 *
 * This is what each stock node in the Brain visualization consumes.
 */

import type { SMCState } from "./smc_engine";
import type { MergedRegimeState } from "./regime_engine";
import type { OrderflowState, LiquidityMapState, MicrostructureEvent } from "./orderflow_engine";
import type { VolatilityState, MarketStressState } from "./stress_engine";
import type { MarketDNA } from "./market_dna";
import type { OrderBookSnapshot } from "./market/types";

import { computeSMCState, type SMCBar } from "./smc_engine";
import { computeFullRegime } from "./regime_engine";
import { computeOrderflowState, computeLiquidityMapState, detectAbsorption, detectSweepEvent } from "./orderflow_engine";
import { computeVolatilityState } from "./stress_engine";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SymbolBrainState {
  symbol: string;

  // ── Engine Outputs ─────────────────────────────────────────
  smc: SMCState;
  regime: MergedRegimeState;
  orderflow: OrderflowState;
  liquidity: LiquidityMapState;
  volatility: VolatilityState;
  microstructureEvents: MicrostructureEvent[];

  // ── Optional (may not always be available) ─────────────────
  marketStress: MarketStressState | null;
  dna: MarketDNA | null;

  // ── Composite Scores ───────────────────────────────────────
  /** 0-1 overall structure strength from SMC analysis */
  structureScore: number;
  /** 0-1 regime favorability for trading */
  regimeScore: number;
  /** 0-1 order flow strength and quality */
  orderflowScore: number;
  /** 0-1 liquidity/execution quality */
  liquidityScore: number;
  /** 0-1 volatility suitability (not too low, not too extreme) */
  volScore: number;
  /** 0-1 stress penalty (inverted: 1 = no stress, 0 = extreme stress) */
  stressPenalty: number;

  /** 0-1 master readiness score — determines node size + glow in Brain UI */
  readinessScore: number;
  /** 0-1 attention allocation — how much should the system watch this symbol */
  attentionScore: number;

  /** Human-readable summary */
  summary: string;

  computedAt: string;
}

// ── Brain State Computation ────────────────────────────────────────────────────

/**
 * Compute the full brain state for a symbol.
 *
 * @param symbol Stock symbol
 * @param bars1m 1-minute OHLCV bars (at least 30, ideally 200+)
 * @param bars5m 5-minute OHLCV bars (at least 30)
 * @param orderbook Current orderbook snapshot (optional)
 * @param marketStress Pre-computed market stress (optional, from cross-symbol analysis)
 * @param dna Pre-computed Market DNA (optional)
 */
export function computeSymbolBrainState(
  symbol: string,
  bars1m: SMCBar[],
  bars5m: SMCBar[],
  orderbook?: OrderBookSnapshot | null,
  marketStress?: MarketStressState | null,
  dna?: MarketDNA | null,
): SymbolBrainState {
  // Run all engines
  const smc = computeSMCState(symbol, bars1m, bars5m);

  const regimeBars = bars5m.length >= 40 ? bars5m : bars1m;
  const regime = computeFullRegime(regimeBars);

  const orderflow = computeOrderflowState(bars1m, orderbook);
  const liquidity = computeLiquidityMapState(orderbook ?? null);
  const volatility = computeVolatilityState(symbol, bars1m);

  // Microstructure events
  const absorptionEvents = detectAbsorption(bars1m, orderbook);
  const sweepEvents = detectSweepEvent(bars1m);
  const microstructureEvents = [...absorptionEvents, ...sweepEvents];

  // ── Compute Component Scores ───────────────────────────────────────────────

  // Structure score: from SMC confluence + structure.structureScore
  const structureScore = clamp(
    smc.confluenceScore * 0.6 + smc.structure.structureScore * 0.4,
  );

  // Regime score: how favorable is the current regime for trading
  const regimeScore = computeRegimeScore(regime);

  // Orderflow score: from the engine
  const orderflowScore = orderflow.orderflowScore;

  // Liquidity score: from the engine
  const liquidityScore = liquidity.liquidityScore;

  // Volatility score: inverted U — best trading in moderate vol
  const volScore = computeVolScore(volatility);

  // Stress penalty: inverted — 1 = safe, 0 = dangerous
  const stressPenalty = marketStress
    ? clamp(1 - marketStress.systemicStressScore)
    : 0.8; // assume low stress if no data

  // ── Master Readiness Score ─────────────────────────────────────────────────

  const readinessScore = computeBrainScore({
    structureScore,
    regimeScore,
    orderflowScore,
    liquidityScore,
    volScore,
    stressPenalty,
  });

  // ── Attention Score ────────────────────────────────────────────────────────
  // How much should the system focus on this symbol? High = active/interesting
  const attentionScore = clamp(
    readinessScore * 0.4 +
    (microstructureEvents.length > 0 ? 0.2 : 0) +
    (smc.activeOBs.length > 0 ? 0.15 : 0) +
    (smc.unfilledFVGs.length > 0 ? 0.1 : 0) +
    (orderflow.divergence ? 0.15 : 0),
  );

  // ── Summary ────────────────────────────────────────────────────────────────
  const summary = buildSummary(
    symbol,
    smc,
    regime,
    orderflow,
    volatility,
    readinessScore,
    microstructureEvents,
  );

  return {
    symbol,
    smc,
    regime,
    orderflow,
    liquidity,
    volatility,
    microstructureEvents,
    marketStress: marketStress ?? null,
    dna: dna ?? null,
    structureScore: round4(structureScore),
    regimeScore: round4(regimeScore),
    orderflowScore: round4(orderflowScore),
    liquidityScore: round4(liquidityScore),
    volScore: round4(volScore),
    stressPenalty: round4(stressPenalty),
    readinessScore: round4(readinessScore),
    attentionScore: round4(attentionScore),
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ── Scoring Functions ──────────────────────────────────────────────────────────

export interface BrainScoreInputs {
  structureScore: number;
  regimeScore: number;
  orderflowScore: number;
  liquidityScore: number;
  volScore: number;
  stressPenalty: number;
}

/**
 * Compute the master brain score from component scores.
 * Weighted composite that determines node importance in the Brain visualization.
 */
export function computeBrainScore(inputs: BrainScoreInputs): number {
  const {
    structureScore,
    regimeScore,
    orderflowScore,
    liquidityScore,
    volScore,
    stressPenalty,
  } = inputs;

  const raw =
    structureScore * 0.28 +
    regimeScore * 0.14 +
    orderflowScore * 0.22 +
    liquidityScore * 0.12 +
    volScore * 0.10 +
    stressPenalty * 0.14;

  return clamp(raw);
}

function computeRegimeScore(regime: MergedRegimeState): number {
  const basic = regime.basic;

  // Trending and expansion are most favorable for trading
  const regimeMap: Record<string, number> = {
    trend_up: 0.85,
    trend_down: 0.80,
    expansion: 0.75,
    range: 0.55,
    compression: 0.40, // pre-breakout, needs patience
    chaotic: 0.15,
  };

  const base = regimeMap[basic.regime] ?? 0.5;

  // Bonus for spectral clarity
  const spectralBonus =
    regime.spectral.regimeLabel === "cyclical" ? 0.10 :
    regime.spectral.regimeLabel === "trend" ? 0.05 :
    regime.spectral.regimeLabel === "transition" ? -0.05 : 0;

  return clamp(base + spectralBonus + basic.trendStrength * 0.05);
}

function computeVolScore(vol: VolatilityState): number {
  // Inverted U: moderate vol is best
  const regimeMap: Record<string, number> = {
    calm: 0.35, // too quiet — limited opportunity
    normal: 0.85, // ideal
    elevated: 0.65, // tradable with care
    extreme: 0.25, // too dangerous
  };

  const base = regimeMap[vol.volRegime] ?? 0.5;

  // Penalize high jump scores (erratic)
  const jumpPenalty = vol.jumpScore > 4 ? 0.15 : vol.jumpScore > 3 ? 0.08 : 0;

  return clamp(base - jumpPenalty);
}

// ── Summary Builder ────────────────────────────────────────────────────────────

function buildSummary(
  symbol: string,
  smc: SMCState,
  regime: MergedRegimeState,
  orderflow: OrderflowState,
  vol: VolatilityState,
  readiness: number,
  events: MicrostructureEvent[],
): string {
  const parts: string[] = [];

  // Structure
  parts.push(
    `${symbol}: ${smc.structure.trend} structure (${smc.structure.pattern})`,
  );
  if (smc.structure.bos) {
    parts.push(`BOS ${smc.structure.bosDirection}`);
  }
  if (smc.structure.choch) {
    parts.push("CHoCH detected — potential reversal");
  }

  // Key SMC zones
  if (smc.activeOBs.length > 0) {
    parts.push(`${smc.activeOBs.length} active order blocks`);
  }
  if (smc.unfilledFVGs.length > 0) {
    parts.push(`${smc.unfilledFVGs.length} unfilled FVGs`);
  }

  // Regime
  parts.push(`Regime: ${regime.label}`);

  // Orderflow
  parts.push(`Flow: ${orderflow.orderflowBias}`);
  if (orderflow.divergence) {
    parts.push("⚠ Price-CVD divergence");
  }

  // Events
  if (events.length > 0) {
    const eventTypes = [...new Set(events.map((e) => e.eventType))];
    parts.push(`Events: ${eventTypes.join(", ")}`);
  }

  // Readiness
  const readinessLabel =
    readiness > 0.7 ? "HIGH" : readiness > 0.4 ? "MODERATE" : "LOW";
  parts.push(`Readiness: ${readinessLabel} (${(readiness * 100).toFixed(0)}%)`);

  return parts.join(" | ");
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function clamp(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
