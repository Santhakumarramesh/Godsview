/**
 * macro_bias_engine.ts — Institutional Macro Bias Scorer
 *
 * Implements Elliot Hewitt's Layer 1 (YoungTraderWealth method):
 * "Trade WITH the macro. If central banks are tightening and DXY is
 * rising, USD pairs have an institutional tailwind — only take LONG
 * USD setups. Fade all retail counters."
 *
 * Inputs (all numeric, sourced from market data or configured):
 *   1. USD DXY trend   — 20-bar EMA slope of DXY index
 *   2. Rate differential — Fed Funds vs target CB rate (e.g. ECB/BOE)
 *   3. CPI momentum    — Latest YoY CPI reading vs prior (hawkish or dovish)
 *   4. Risk sentiment  — VIX level proxy (high VIX = risk-off = USD bid)
 *   5. Macro event risk — from macro_engine lockout score
 *
 * Output:
 *   MacroBiasResult {
 *     bias: "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell"
 *     direction: "long" | "short" | "flat"
 *     score: number  (0–1, where 1 = maximum conviction)
 *     conviction: "high" | "medium" | "low"
 *     reasons: string[]
 *     blockedDirections: ("long" | "short")[]
 *     updatedAt: string
 *   }
 */

import { logger } from "./logger";

// ── Types ───────────────────────────────────────────────────────────────────

export type MacroBiasDirection = "long" | "short" | "flat";
export type MacroBiasLabel = "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell";
export type ConvictionLevel = "high" | "medium" | "low";

export interface MacroBiasInput {
  /** DXY EMA slope over last 20 daily bars (-1 to +1 normalised) */
  dxySlope: number;
  /** Fed Funds Rate minus target currency central bank rate (bps) */
  rateDifferentialBps: number;
  /** CPI YoY delta: latest - prior month (positive = accelerating inflation) */
  cpiMomentum: number;
  /** VIX level (14 = low fear, 30+ = high fear / risk-off) */
  vixLevel: number;
  /** Macro event lockout score from macro_engine (0 = clear, 1 = full lockout) */
  macroRiskScore: number;
  /** Symbol context — asset class adjusts weighting */
  assetClass: "crypto" | "forex" | "equity" | "commodity";
  /** Direction the setup wants to trade (to check alignment) */
  intendedDirection: "long" | "short";
}

export interface MacroBiasResult {
  bias: MacroBiasLabel;
  direction: MacroBiasDirection;
  score: number;
  conviction: ConvictionLevel;
  aligned: boolean;
  reasons: string[];
  blockedDirections: MacroBiasDirection[];
  tailwind: boolean;
  headwind: boolean;
  updatedAt: string;
}

// ── Scoring weights by asset class ──────────────────────────────────────────

const WEIGHTS: Record<MacroBiasInput["assetClass"], {
  dxy: number; rate: number; cpi: number; vix: number;
}> = {
  forex:     { dxy: 0.40, rate: 0.30, cpi: 0.20, vix: 0.10 },
  crypto:    { dxy: 0.15, rate: 0.10, cpi: 0.10, vix: 0.65 },
  equity:    { dxy: 0.15, rate: 0.25, cpi: 0.25, vix: 0.35 },
  commodity: { dxy: 0.35, rate: 0.15, cpi: 0.25, vix: 0.25 },
};

// ── Pure scoring functions ───────────────────────────────────────────────────

/** Normalise DXY slope to a -1..+1 directional score */
function scoreDxy(slope: number): number {
  // Clamp to ±0.01 range (typical daily EMA slope values)
  return Math.max(-1, Math.min(1, slope / 0.005));
}

/** Rate differential: positive bps → USD bullish → long bias */
function scoreRateDiff(bps: number): number {
  // 100bps differential = full conviction; 0 = neutral
  return Math.max(-1, Math.min(1, bps / 100));
}

/**
 * CPI momentum:
 * - Accelerating inflation (positive delta) → CB tightens → currency bullish
 * - Decelerating inflation (negative delta) → CB pauses/cuts → bearish
 */
function scoreCpi(delta: number): number {
  return Math.max(-1, Math.min(1, delta / 0.5));
}

/**
 * VIX:
 * - <15   → risk-on  → USD bearish (positive score for risk assets)
 * - 15–25 → neutral
 * - >25   → risk-off → USD bullish, crypto bearish
 */
function scoreVix(vix: number, assetClass: MacroBiasInput["assetClass"]): number {
  const raw = vix < 15 ? -0.5 : vix > 30 ? 1.0 : (vix - 15) / 15;
  // For crypto/equities, high VIX = bearish (risk-off sells them)
  return assetClass === "forex" ? raw : -raw;
}

// ── Main scorer ──────────────────────────────────────────────────────────────

export function computeMacroBias(input: MacroBiasInput): MacroBiasResult {
  const w = WEIGHTS[input.assetClass];
  const reasons: string[] = [];
  const blockedDirections: MacroBiasDirection[] = [];

  // Hard gate: if macro risk is critical, flat everything
  if (input.macroRiskScore >= 0.85) {
    reasons.push(`Macro lockout active (risk=${input.macroRiskScore.toFixed(2)})`);
    return {
      bias: "neutral", direction: "flat", score: 0, conviction: "low",
      aligned: false, reasons, blockedDirections: ["long", "short"],
      tailwind: false, headwind: false, updatedAt: new Date().toISOString(),
    };
  }

  // Score each pillar
  const dxyScore  = scoreDxy(input.dxySlope);
  const rateScore = scoreRateDiff(input.rateDifferentialBps);
  const cpiScore  = scoreCpi(input.cpiMomentum);
  const vixScore  = scoreVix(input.vixLevel, input.assetClass);

  // Weighted composite: -1 (max bearish) to +1 (max bullish)
  const composite =
    dxyScore  * w.dxy  +
    rateScore * w.rate +
    cpiScore  * w.cpi  +
    vixScore  * w.vix;

  // Build human-readable reasons
  if (Math.abs(dxyScore) > 0.3) {
    reasons.push(`DXY ${dxyScore > 0 ? "strengthening ↑" : "weakening ↓"} (slope=${input.dxySlope.toFixed(4)})`);
  }
  if (Math.abs(rateScore) > 0.2) {
    reasons.push(`Rate diff ${input.rateDifferentialBps > 0 ? "+" : ""}${input.rateDifferentialBps}bps — ${input.rateDifferentialBps > 0 ? "hawkish" : "dovish"}`);
  }
  if (Math.abs(cpiScore) > 0.2) {
    reasons.push(`CPI momentum ${input.cpiMomentum > 0 ? "accelerating" : "decelerating"} (Δ${input.cpiMomentum.toFixed(2)}%)`);
  }
  if (input.vixLevel > 25) {
    reasons.push(`VIX elevated at ${input.vixLevel} — risk-off environment`);
  } else if (input.vixLevel < 15) {
    reasons.push(`VIX low at ${input.vixLevel} — risk-on environment`);
  }

  // Map composite to label
  let bias: MacroBiasLabel;
  let direction: MacroBiasDirection;
  let conviction: ConvictionLevel;
  const abs = Math.abs(composite);

  if (composite >= 0.55)       { bias = "strong_buy";  direction = "long";  conviction = "high"; }
  else if (composite >= 0.20)  { bias = "buy";          direction = "long";  conviction = abs > 0.35 ? "medium" : "low"; }
  else if (composite <= -0.55) { bias = "strong_sell";  direction = "short"; conviction = "high"; }
  else if (composite <= -0.20) { bias = "sell";          direction = "short"; conviction = abs > 0.35 ? "medium" : "low"; }
  else                          { bias = "neutral";       direction = "flat";  conviction = "low"; }

  // Determine if intended direction aligns with macro
  const aligned =
    direction === "flat" ? true :
    direction === input.intendedDirection;

  // Block counter-trend with high conviction
  if (conviction === "high") {
    const counter: MacroBiasDirection = direction === "long" ? "short" : direction === "short" ? "long" : "flat";
    if (counter !== "flat") {
      blockedDirections.push(counter);
      if (!aligned) reasons.push(`Counter-macro trade blocked (macro=${bias}, intent=${input.intendedDirection})`);
    }
  }

  const tailwind  = aligned && direction !== "flat";
  const headwind  = !aligned && direction !== "flat";

  // Score: 0–1 normalised conviction
  const score = Math.min(1, abs / 0.55);

  logger.debug({ bias, direction, score: score.toFixed(3), conviction, assetClass: input.assetClass }, "[MacroBias] Computed");

  return {
    bias, direction, score, conviction, aligned, reasons,
    blockedDirections, tailwind, headwind,
    updatedAt: new Date().toISOString(),
  };
}

// ── Default neutral (used when data unavailable) ─────────────────────────────

export function neutralMacroBias(): MacroBiasResult {
  return {
    bias: "neutral", direction: "flat", score: 0, conviction: "low",
    aligned: true, reasons: ["No macro data available — defaulting to neutral"],
    blockedDirections: [], tailwind: false, headwind: false,
    updatedAt: new Date().toISOString(),
  };
}
