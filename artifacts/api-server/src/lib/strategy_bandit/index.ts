/**
 * strategy_bandit/index.ts — Phase 83: Strategy A/B Testing + Multi-Armed Bandit
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. ABTestRegistry      — strategy A/B experiments with lifecycle.
 *   2. EpsilonGreedy       — explore/exploit policy.
 *   3. ThompsonSampler     — Bayesian arm selection.
 *   4. UCBSelector         — Upper Confidence Bound.
 *   5. SignificanceTester  — frequentist + Bayesian readouts.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "../logger.js";

// ── A/B Test Registry ─────────────────────────────────────────────────────

export type ABStatus = "draft" | "running" | "paused" | "concluded" | "abandoned";

export interface ABArm {
  id: string;
  name: string;
  strategyId: string;
  trials: number;
  successes: number;
  rewardSum: number;
  rewardSqSum: number;
}

export interface ABTest {
  id: string;
  name: string;
  description: string;
  arms: ABArm[];
  status: ABStatus;
  policy: "epsilon_greedy" | "thompson" | "ucb" | "uniform";
  policyParams: Record<string, number>;
  createdAt: number;
  startedAt?: number;
  concludedAt?: number;
  winnerArmId?: string;
}

export class ABTestRegistry {
  private readonly tests = new Map<string, ABTest>();

  create(params: {
    name: string;
    description?: string;
    arms: Array<{ name: string; strategyId: string }>;
    policy?: ABTest["policy"];
    policyParams?: Record<string, number>;
  }): ABTest {
    const id = `abt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const test: ABTest = {
      id,
      name: params.name,
      description: params.description ?? "",
      arms: params.arms.map((a) => ({
        id: `arm_${Math.random().toString(36).slice(2, 8)}`,
        name: a.name,
        strategyId: a.strategyId,
        trials: 0,
        successes: 0,
        rewardSum: 0,
        rewardSqSum: 0,
      })),
      status: "draft",
      policy: params.policy ?? "thompson",
      policyParams: params.policyParams ?? {},
      createdAt: Date.now(),
    };
    this.tests.set(id, test);
    return test;
  }

  start(id: string): ABTest | null {
    const t = this.tests.get(id);
    if (!t) return null;
    t.status = "running";
    t.startedAt = Date.now();
    return t;
  }

  pause(id: string): ABTest | null {
    const t = this.tests.get(id);
    if (!t) return null;
    t.status = "paused";
    return t;
  }

  conclude(id: string, winnerArmId?: string): ABTest | null {
    const t = this.tests.get(id);
    if (!t) return null;
    t.status = "concluded";
    t.concludedAt = Date.now();
    t.winnerArmId = winnerArmId;
    logger.info({ testId: id, winner: winnerArmId }, "[Bandit] Test concluded");
    return t;
  }

  recordTrial(id: string, armId: string, reward: number, success: boolean): ABArm | null {
    const t = this.tests.get(id);
    if (!t) return null;
    const arm = t.arms.find((a) => a.id === armId);
    if (!arm) return null;
    arm.trials++;
    if (success) arm.successes++;
    arm.rewardSum += reward;
    arm.rewardSqSum += reward * reward;
    return arm;
  }

  list(): ABTest[] {
    return Array.from(this.tests.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): ABTest | null {
    return this.tests.get(id) ?? null;
  }
}

// ── Selection Policies ────────────────────────────────────────────────────

export class EpsilonGreedy {
  select(arms: ABArm[], epsilon = 0.1): ABArm | null {
    if (arms.length === 0) return null;
    if (Math.random() < epsilon) {
      return arms[Math.floor(Math.random() * arms.length)]!;
    }
    return arms.reduce((best, a) => {
      const aMean = a.trials > 0 ? a.rewardSum / a.trials : 0;
      const bestMean = best.trials > 0 ? best.rewardSum / best.trials : 0;
      return aMean > bestMean ? a : best;
    }, arms[0]!);
  }
}

export class ThompsonSampler {
  select(arms: ABArm[]): ABArm | null {
    if (arms.length === 0) return null;
    let best: ABArm | null = null;
    let bestSample = -Infinity;
    for (const arm of arms) {
      const alpha = arm.successes + 1;
      const beta = (arm.trials - arm.successes) + 1;
      const sample = this._beta(alpha, beta);
      if (sample > bestSample) { bestSample = sample; best = arm; }
    }
    return best;
  }

  private _beta(alpha: number, beta: number): number {
    // approximate via two gamma samples
    const x = this._gamma(alpha);
    const y = this._gamma(beta);
    return x / (x + y);
  }

  private _gamma(shape: number): number {
    // Marsaglia-Tsang for shape >= 1
    if (shape < 1) return this._gamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    while (true) {
      let x: number, v: number;
      do {
        x = this._normal();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = Math.random();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }

  private _normal(): number {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

export class UCBSelector {
  select(arms: ABArm[]): ABArm | null {
    if (arms.length === 0) return null;
    const totalTrials = arms.reduce((s, a) => s + a.trials, 0);
    if (totalTrials === 0) return arms[0]!;
    let best: ABArm | null = null;
    let bestUcb = -Infinity;
    for (const arm of arms) {
      if (arm.trials === 0) return arm;
      const mean = arm.rewardSum / arm.trials;
      const exploration = Math.sqrt((2 * Math.log(totalTrials)) / arm.trials);
      const ucb = mean + exploration;
      if (ucb > bestUcb) { bestUcb = ucb; best = arm; }
    }
    return best;
  }
}

// ── Significance Testing ──────────────────────────────────────────────────

export interface SignificanceReport {
  testId: string;
  control: ABArm;
  treatment: ABArm;
  controlMean: number;
  treatmentMean: number;
  uplift: number;            // (treat - ctrl) / ctrl
  zScore: number;
  pValue: number;
  significant: boolean;
  bayesianProbabilityBetter: number;
}

export class SignificanceTester {
  test(testId: string, control: ABArm, treatment: ABArm, alpha = 0.05): SignificanceReport {
    const cMean = control.trials > 0 ? control.rewardSum / control.trials : 0;
    const tMean = treatment.trials > 0 ? treatment.rewardSum / treatment.trials : 0;
    const cVar = control.trials > 1
      ? (control.rewardSqSum / control.trials) - cMean * cMean
      : 0;
    const tVar = treatment.trials > 1
      ? (treatment.rewardSqSum / treatment.trials) - tMean * tMean
      : 0;
    const se = Math.sqrt((cVar / Math.max(1, control.trials)) + (tVar / Math.max(1, treatment.trials)));
    const z = se > 0 ? (tMean - cMean) / se : 0;
    const pValue = this._pValueTwoTailed(z);
    // Bayesian P(treatment > control) approximated via beta distribution sampling
    const bayesP = this._monteCarloBetter(control, treatment, 2000);
    return {
      testId,
      control, treatment,
      controlMean: cMean,
      treatmentMean: tMean,
      uplift: cMean !== 0 ? (tMean - cMean) / Math.abs(cMean) : 0,
      zScore: z,
      pValue,
      significant: pValue < alpha,
      bayesianProbabilityBetter: bayesP,
    };
  }

  private _pValueTwoTailed(z: number): number {
    // Approximate the standard normal CDF via Abramowitz & Stegun
    const cdf = (x: number): number => {
      const t = 1 / (1 + 0.2316419 * Math.abs(x));
      const d = 0.3989422804014337 * Math.exp(-x * x / 2);
      const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
      return x >= 0 ? 1 - p : p;
    };
    return 2 * (1 - cdf(Math.abs(z)));
  }

  private _monteCarloBetter(c: ABArm, t: ABArm, samples: number): number {
    const sampler = new ThompsonSampler();
    let wins = 0;
    for (let i = 0; i < samples; i++) {
      const cs = (sampler as unknown as { _beta: (a: number, b: number) => number })._beta(
        c.successes + 1, c.trials - c.successes + 1,
      );
      const ts = (sampler as unknown as { _beta: (a: number, b: number) => number })._beta(
        t.successes + 1, t.trials - t.successes + 1,
      );
      if (ts > cs) wins++;
    }
    return wins / samples;
  }
}

// ── Singletons ─────────────────────────────────────────────────────────────

export const abTestRegistry = new ABTestRegistry();
export const epsilonGreedy = new EpsilonGreedy();
export const thompsonSampler = new ThompsonSampler();
export const ucbSelector = new UCBSelector();
export const significanceTester = new SignificanceTester();

export function selectArm(test: ABTest): ABArm | null {
  switch (test.policy) {
    case "epsilon_greedy":
      return epsilonGreedy.select(test.arms, test.policyParams.epsilon ?? 0.1);
    case "thompson":
      return thompsonSampler.select(test.arms);
    case "ucb":
      return ucbSelector.select(test.arms);
    case "uniform":
      return test.arms.length > 0 ? test.arms[Math.floor(Math.random() * test.arms.length)]! : null;
  }
}
