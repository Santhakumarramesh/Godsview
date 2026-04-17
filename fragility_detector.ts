/**
 * fragility_detector.ts — Identify Hidden Fragilities in Strategies
 *
 * Nasty Taleb-style fragility detection:
 *   - Parameter fragility: how much do results change with small parameter tweaks?
 *   - Regime fragility: does strategy break in different market conditions?
 *   - Concentration fragility: over-reliance on few symbols or setups?
 *   - Timing fragility: dependent on specific market times?
 *   - Data fragility: curve-fit on data? Out-of-sample decay?
 *
 * Also computes anti-fragility score: how well does strategy improve under stress?
 */

import { logger } from "../logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParameterFragility {
  testName: string;
  parameterTested: string;
  baselinePerformance: number;
  perturbedPerformances: Array<{ value: number; performance: number }>;
  fragility: number; // 0-1, higher = more fragile
  breakingPoints: number[]; // Parameter values where strategy breaks
  recommendation: string;
}

export interface RegimeFragility {
  regimeName: string;
  performance: number;
  sampleSize: number;
  fragility: number;
  breakdown?: { reason: string; severity: number };
}

export interface ConcentrationFragility {
  bySymbol: { metric: "concentration", top5Contribution: number, herfindahl: number };
  bySetupType: { metric: "concentration", top3Contribution: number, diversity: number };
  overall: number; // 0-1
  recommendation: string;
}

export interface TimingFragility {
  intraday: { bestHour: number, worstHour: number, spread: number };
  dayOfWeek: { bestDay: string, worstDay: string, spread: number };
  seasonal: { bestMonth: string, worstMonth: string, spread: number };
  fragility: number;
}

export interface DataFragility {
  outOfSampleDecay: number; // % of performance lost OOS
  overOptimization: number; // 0-1 likelihood of curve-fit
  dataPoints: number;
  recommendedMinimumData: number;
  warning: string;
}

export interface HiddenRisk {
  name: string;
  description: string;
  probability: number; // 0-1
  impact: number; // 0-1
  expectedLoss: number;
  mitigation: string;
  detected: boolean;
}

export interface StressTestResult {
  scenario: string;
  baseline: number;
  stressed: number;
  lossUnderStress: number;
  percentageDrawdown: number;
  survivable: boolean;
}

export interface FragilityReport {
  overallScore: number; // 0-100, higher = more fragile
  antifragilityScore: number; // 0-100, higher = more antifragile

  fragilities: {
    parameter: ParameterFragility;
    regime: RegimeFragility[];
    concentration: ConcentrationFragility;
    timing: TimingFragility;
    data: DataFragility;
  };

  hiddenRisks: HiddenRisk[];
  stressTestResults: StressTestResult[];
  recommendations: string[];

  plainEnglish: string; // summary in plain language
}

// ─── Fragility Detector ────────────────────────────────────────────────────────

export class FragilityDetector {
  /**
   * Full fragility analysis