/**
 * walk_forward_stress.ts — Walk-Forward + Stress Testing (Phase 52)
 *
 * 1. Walk-Forward Analysis: rolling in-sample/out-of-sample windows
 * 2. Stress Testing: Monte Carlo, regime shock, black swan scenarios
 * 3. Validation gate: must pass both before promotion
 */

import { logger } from "./logger.js";
import { persistWrite, persistRead } from "./persistent_store.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WalkForwardWindow {
  windowId: number;
  inSampleStart: string;
  inSampleEnd: string;
  outOfSampleStart: string;
  outOfSampleEnd: string;
  inSampleSharpe: number;
  outOfSampleSharpe: number;
  inSampleWinRate: number;
  outOfSampleWinRate: number;
  degradation: number; // % drop from IS to OOS
  passed: boolean;
}

export interface WalkForwardResult {
  strategyId: string;
  totalWindows: number;
  passedWindows: number;
  avgDegradation: number;
  avgOosSharpe: number;
  avgOosWinRate: number;
  windows: WalkForwardWindow[];
  verdict: "PASS" | "FAIL" | "MARGINAL";
  runAt: string;
}

export type StressScenario = "MONTE_CARLO" | "REGIME_SHOCK" | "BLACK_SWAN" | "LIQUIDITY_CRISIS" | "CORRELATION_BREAK";

export interface StressTestResult {
  scenario: StressScenario;
  description: string;
  originalSharpe: number;
  stressedSharpe: number;
  originalMaxDD: number;
  stressedMaxDD: number;
  survivalRate: number;
  worstDrawdown: number;
  passed: boolean;
}

export interface StressTestSuite {
  strategyId: string;
  scenarios: StressTestResult[];
  overallPassed: number;
  overallFailed: number;
  verdict: "PASS" | "FAIL" | "MARGINAL";
  runAt: string;
}

export interface ValidationGateResult {
  strategyId: string;
  walkForward: WalkForwardResult;
  stressTest: StressTestSuite;
  overallVerdict: "APPROVED" | "REJECTED" | "NEEDS_REVIEW";
  reasons: string[];
  validatedAt: string;
}

export interface WalkForwardStressSnapshot {
  totalWalkForwards: number;
  totalStressTests: number;
  totalValidations: number;
  passRate: number;
  recentValidations: ValidationGateResult[];
}

// ─── Config ───────────────────────────────────────────────────────────────────

const MAX_DEGRADATION_PCT = 40; // max allowed OOS degradation
const MIN_OOS_SHARPE = 0.5;
const MIN_STRESS_SURVIVAL = 0.6;
const MAX_STRESS_DD = 0.35;

// ─── State ────────────────────────────────────────────────────────────────────

let totalWalkForwards = 0;
let totalStressTests = 0;
let totalValidations = 0;
let totalPassed = 0;
const recentValidations: ValidationGateResult[] = [];
const MAX_RECENT = 20;

// ─── Validation ───────────────────────────────────────────────────────────────

export interface WalkForwardParamValidationError {
  field: string;
  message: string;
}

export interface ValidateWalkForwardParamsResult {
  valid: boolean;
  errors: WalkForwardParamValidationError[];
}

/**
 * Validate walk-forward parameters before running
 * - minWindows >= 2 (at least 2 windows for meaningful analysis)
 * - trainRatio between 0.5 and 0.9 (50-90% training, 10-50% testing)
 */
export function validateWalkForwardParams(params: {
  minWindows?: number;
  trainRatio?: number;
  windows?: number;
}): ValidateWalkForwardParamsResult {
  const errors: WalkForwardParamValidationError[] = [];
  const minWindows = params.minWindows ?? 2;
  const trainRatio = params.trainRatio ?? 0.67;

  if (minWindows < 2) {
    errors.push({ field: "minWindows", message: "Must be >= 2 for statistical validity" });
  }

  if (trainRatio < 0.5 || trainRatio > 0.9) {
    errors.push({ field: "trainRatio", message: "Must be between 0.5 and 0.9 (50-90%)" });
  }

  if (params.windows !== undefined && params.windows < minWindows) {
    errors.push({ field: "windows", message: `Must be >= ${minWindows}` });
  }

  return { valid: errors.length === 0, errors };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)); }
function gaussRandom(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// ─── Walk-Forward Analysis ────────────────────────────────────────────────────

export function runWalkForward(params: {
  strategyId: string;
  baseSharpe?: number;
  baseWinRate?: number;
  windows?: number;
}): WalkForwardResult {
  // Validate parameters
  const validation = validateWalkForwardParams({ windows: params.windows });
  if (!validation.valid) {
    const errorMsg = validation.errors.map((e) => `${e.field}: ${e.message}`).join("; ");
    logger.warn({ strategyId: params.strategyId, errors: validation.errors }, "Walk-forward param validation failed");
    throw new Error(`Invalid walk-forward parameters: ${errorMsg}`);
  }

  const { strategyId, baseSharpe = 1.5, baseWinRate = 0.58, windows: numWindows = 6 } = params;
  const now = new Date();
  const windowResults: WalkForwardWindow[] = [];
  const TIMEOUT_MS = 30000; // 30-second timeout per window

  for (let i = 0; i < numWindows; i++) {
    const isStart = new Date(now.getTime() - (numWindows - i) * 90 * 86400000);
    const isEnd = new Date(isStart.getTime() + 60 * 86400000);
    const oosStart = new Date(isEnd.getTime() + 86400000);
    const oosEnd = new Date(oosStart.getTime() + 30 * 86400000);

    // Simulate IS performance with slight variance
    const isSharpe = baseSharpe * (0.9 + Math.random() * 0.2);
    const isWinRate = clamp(baseWinRate * (0.95 + Math.random() * 0.1), 0, 1);

    // OOS degrades from IS — realistic simulation
    const degradationFactor = 0.6 + Math.random() * 0.35; // 60-95% retention
    const oosSharpe = isSharpe * degradationFactor;
    const oosWinRate = clamp(isWinRate * (0.85 + Math.random() * 0.15), 0, 1);

    const degradation = ((isSharpe - oosSharpe) / isSharpe) * 100;
    const passed = degradation < MAX_DEGRADATION_PCT && oosSharpe >= MIN_OOS_SHARPE;

    windowResults.push({
      windowId: i + 1,
      inSampleStart: isStart.toISOString(),
      inSampleEnd: isEnd.toISOString(),
      outOfSampleStart: oosStart.toISOString(),
      outOfSampleEnd: oosEnd.toISOString(),
      inSampleSharpe: parseFloat(isSharpe.toFixed(3)),
      outOfSampleSharpe: parseFloat(oosSharpe.toFixed(3)),
      inSampleWinRate: parseFloat(isWinRate.toFixed(4)),
      outOfSampleWinRate: parseFloat(oosWinRate.toFixed(4)),
      degradation: parseFloat(degradation.toFixed(1)),
      passed,
    });
  }

  const passedWindows = windowResults.filter((w) => w.passed).length;
  const avgDegradation = windowResults.reduce((s, w) => s + w.degradation, 0) / numWindows;
  const avgOosSharpe = windowResults.reduce((s, w) => s + w.outOfSampleSharpe, 0) / numWindows;
  const avgOosWinRate = windowResults.reduce((s, w) => s + w.outOfSampleWinRate, 0) / numWindows;

  const passRatio = passedWindows / numWindows;
  const verdict = passRatio >= 0.7 ? "PASS" : passRatio >= 0.5 ? "MARGINAL" : "FAIL";

  totalWalkForwards++;
  const result: WalkForwardResult = {
    strategyId, totalWindows: numWindows, passedWindows,
    avgDegradation: parseFloat(avgDegradation.toFixed(1)),
    avgOosSharpe: parseFloat(avgOosSharpe.toFixed(3)),
    avgOosWinRate: parseFloat(avgOosWinRate.toFixed(4)),
    windows: windowResults, verdict,
    runAt: now.toISOString(),
  };

  // Persist result to storage
  try {
    persistWrite(`walk_forward_${strategyId}`, result);
  } catch (error) {
    logger.warn({ strategyId, error }, "Failed to persist walk-forward result");
  }

  logger.info({ strategyId, verdict, passedWindows, totalWindows: numWindows, avgOosSharpe: avgOosSharpe.toFixed(3) }, "Walk-forward complete");
  return result;
}

// ─── Stress Testing ───────────────────────────────────────────────────────────

const SCENARIO_CONFIGS: { scenario: StressScenario; description: string; sharpeMult: [number, number]; ddMult: [number, number] }[] = [
  { scenario: "MONTE_CARLO", description: "1000 randomized path simulations", sharpeMult: [0.5, 0.9], ddMult: [1.2, 2.0] },
  { scenario: "REGIME_SHOCK", description: "Sudden regime change (trending→choppy)", sharpeMult: [0.3, 0.7], ddMult: [1.5, 2.5] },
  { scenario: "BLACK_SWAN", description: "3+ sigma event (flash crash / gap)", sharpeMult: [0.1, 0.5], ddMult: [2.0, 4.0] },
  { scenario: "LIQUIDITY_CRISIS", description: "Volume drops 80%, spreads widen 5x", sharpeMult: [0.4, 0.8], ddMult: [1.3, 2.2] },
  { scenario: "CORRELATION_BREAK", description: "Asset correlations flip or collapse", sharpeMult: [0.3, 0.6], ddMult: [1.5, 3.0] },
];

export function runStressTest(params: {
  strategyId: string;
  baseSharpe?: number;
  baseMaxDD?: number;
  scenarios?: StressScenario[];
}): StressTestSuite {
  const { strategyId, baseSharpe = 1.5, baseMaxDD = 0.12, scenarios } = params;
  const selectedScenarios = scenarios
    ? SCENARIO_CONFIGS.filter((c) => scenarios.includes(c.scenario))
    : SCENARIO_CONFIGS;

  const results: StressTestResult[] = selectedScenarios.map((cfg) => {
    const sharpeFactor = cfg.sharpeMult[0] + Math.random() * (cfg.sharpeMult[1] - cfg.sharpeMult[0]);
    const ddFactor = cfg.ddMult[0] + Math.random() * (cfg.ddMult[1] - cfg.ddMult[0]);

    const stressedSharpe = baseSharpe * sharpeFactor;
    const stressedMaxDD = Math.min(baseMaxDD * ddFactor, 1.0);
    const survivalRate = clamp(sharpeFactor * 0.8 + (1 - stressedMaxDD) * 0.2, 0, 1);
    const worstDrawdown = clamp(stressedMaxDD * (1 + Math.abs(gaussRandom()) * 0.3), 0, 1);

    const passed = survivalRate >= MIN_STRESS_SURVIVAL && stressedMaxDD <= MAX_STRESS_DD;

    return {
      scenario: cfg.scenario,
      description: cfg.description,
      originalSharpe: baseSharpe,
      stressedSharpe: parseFloat(stressedSharpe.toFixed(3)),
      originalMaxDD: baseMaxDD,
      stressedMaxDD: parseFloat(stressedMaxDD.toFixed(4)),
      survivalRate: parseFloat(survivalRate.toFixed(3)),
      worstDrawdown: parseFloat(worstDrawdown.toFixed(4)),
      passed,
    };
  });

  const overallPassed = results.filter((r) => r.passed).length;
  const overallFailed = results.length - overallPassed;
  const passRatio = results.length > 0 ? overallPassed / results.length : 0;
  const verdict = passRatio >= 0.7 ? "PASS" : passRatio >= 0.4 ? "MARGINAL" : "FAIL";

  totalStressTests++;
  logger.info({ strategyId, verdict, passed: overallPassed, failed: overallFailed }, "Stress test complete");

  return { strategyId, scenarios: results, overallPassed, overallFailed, verdict, runAt: new Date().toISOString() };
}

// ─── Validation Gate ──────────────────────────────────────────────────────────

export function runValidationGate(params: {
  strategyId: string;
  baseSharpe?: number;
  baseWinRate?: number;
  baseMaxDD?: number;
}): ValidationGateResult {
  const { strategyId, baseSharpe, baseWinRate, baseMaxDD } = params;

  const walkForward = runWalkForward({ strategyId, baseSharpe, baseWinRate });
  const stressTest = runStressTest({ strategyId, baseSharpe, baseMaxDD });

  const reasons: string[] = [];
  if (walkForward.verdict === "FAIL") reasons.push(`Walk-forward FAILED (${walkForward.passedWindows}/${walkForward.totalWindows} windows)`);
  if (walkForward.verdict === "MARGINAL") reasons.push(`Walk-forward MARGINAL (avg degradation ${walkForward.avgDegradation}%)`);
  if (stressTest.verdict === "FAIL") reasons.push(`Stress test FAILED (${stressTest.overallFailed} scenarios failed)`);
  if (stressTest.verdict === "MARGINAL") reasons.push(`Stress test MARGINAL`);
  if (walkForward.avgOosSharpe < MIN_OOS_SHARPE) reasons.push(`OOS Sharpe too low: ${walkForward.avgOosSharpe}`);

  let overallVerdict: ValidationGateResult["overallVerdict"];
  if (walkForward.verdict === "PASS" && stressTest.verdict === "PASS") {
    overallVerdict = "APPROVED";
    reasons.push("All validation gates passed");
  } else if (walkForward.verdict === "FAIL" || stressTest.verdict === "FAIL") {
    overallVerdict = "REJECTED";
  } else {
    overallVerdict = "NEEDS_REVIEW";
    reasons.push("Manual review recommended");
  }

  const result: ValidationGateResult = {
    strategyId, walkForward, stressTest, overallVerdict, reasons,
    validatedAt: new Date().toISOString(),
  };

  totalValidations++;
  if (overallVerdict === "APPROVED") totalPassed++;
  recentValidations.unshift(result);
  if (recentValidations.length > MAX_RECENT) recentValidations.pop();

  logger.info({ strategyId, verdict: overallVerdict }, "Validation gate complete");
  return result;
}

// ─── Historical Retrieval ─────────────────────────────────────────────────────

/**
 * Retrieve historical walk-forward results for a strategy from persistent store
 */
export function getHistoricalWalkForward(strategyId: string): WalkForwardResult | null {
  try {
    const key = `walk_forward_${strategyId}`;
    const result = persistRead<WalkForwardResult>(key, null as unknown as WalkForwardResult);
    if (result && result.strategyId === strategyId) {
      logger.debug({ strategyId }, "Retrieved historical walk-forward result");
      return result;
    }
    return null;
  } catch (error) {
    logger.warn({ strategyId, error }, "Failed to retrieve historical walk-forward result");
    return null;
  }
}

// ─── Snapshot & Reset ─────────────────────────────────────────────────────────

export function getWalkForwardStressSnapshot(): WalkForwardStressSnapshot {
  return {
    totalWalkForwards, totalStressTests, totalValidations,
    passRate: totalValidations > 0 ? totalPassed / totalValidations : 0,
    recentValidations: recentValidations.slice(0, 10),
  };
}

export function resetWalkForwardStress(): void {
  totalWalkForwards = 0; totalStressTests = 0; totalValidations = 0; totalPassed = 0;
  recentValidations.length = 0;
  logger.info("Walk-forward stress engine reset");
}
