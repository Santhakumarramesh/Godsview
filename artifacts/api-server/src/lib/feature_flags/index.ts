/**
 * feature_flags/index.ts — Phase 63: Feature Flags + Progressive Rollout
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. FlagRegistry         — boolean / percentage / variant flags.
 *   2. TargetingEngine      — user / org / segment targeting.
 *   3. RolloutController    — canary → ramped → 100% rollouts.
 *   4. ExperimentTracker    — A/B experiments with assignment stickiness.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createHash } from "crypto";
import { logger } from "../logger.js";

// ── Flags ───────────────────────────────────────────────────────────────────

export type FlagKind = "boolean" | "percentage" | "variant";
export type FlagStatus = "disabled" | "canary" | "ramped" | "enabled" | "archived";

export interface FlagRule {
  attribute: string;    // e.g. "org.plan", "user.role", "user.id"
  op: "eq" | "neq" | "in" | "nin" | "regex";
  value: string | string[];
}

export interface Flag {
  key: string;
  kind: FlagKind;
  description: string;
  status: FlagStatus;
  defaultValue: boolean | string;
  percentage: number;       // 0-100 for kind=percentage
  variants: string[];       // for kind=variant
  rules: FlagRule[];        // targeting overrides (short-circuit to true)
  createdAt: number;
  updatedAt: number;
}

export class FlagRegistry {
  private readonly flags = new Map<string, Flag>();

  upsert(params: {
    key: string;
    kind: FlagKind;
    description?: string;
    defaultValue?: boolean | string;
    percentage?: number;
    variants?: string[];
  }): Flag {
    const existing = this.flags.get(params.key);
    const now = Date.now();
    const flag: Flag = existing ?? {
      key: params.key,
      kind: params.kind,
      description: params.description ?? "",
      status: "disabled",
      defaultValue: params.defaultValue ?? (params.kind === "boolean" ? false : ""),
      percentage: params.percentage ?? 0,
      variants: params.variants ?? [],
      rules: [],
      createdAt: now,
      updatedAt: now,
    };
    if (existing) {
      flag.description = params.description ?? existing.description;
      if (params.defaultValue !== undefined) flag.defaultValue = params.defaultValue;
      if (params.percentage !== undefined) flag.percentage = params.percentage;
      if (params.variants !== undefined) flag.variants = params.variants;
      flag.updatedAt = now;
    }
    this.flags.set(params.key, flag);
    return flag;
  }

  setStatus(key: string, status: FlagStatus): Flag | null {
    const f = this.flags.get(key);
    if (!f) return null;
    f.status = status;
    f.updatedAt = Date.now();
    logger.info({ flag: key, status }, "[Flags] Status changed");
    return f;
  }

  setPercentage(key: string, pct: number): Flag | null {
    const f = this.flags.get(key);
    if (!f) return null;
    f.percentage = Math.max(0, Math.min(100, pct));
    f.updatedAt = Date.now();
    return f;
  }

  addRule(key: string, rule: FlagRule): Flag | null {
    const f = this.flags.get(key);
    if (!f) return null;
    f.rules.push(rule);
    f.updatedAt = Date.now();
    return f;
  }

  clearRules(key: string): Flag | null {
    const f = this.flags.get(key);
    if (!f) return null;
    f.rules = [];
    f.updatedAt = Date.now();
    return f;
  }

  list(): Flag[] {
    return Array.from(this.flags.values());
  }

  get(key: string): Flag | null {
    return this.flags.get(key) ?? null;
  }

  delete(key: string): boolean {
    return this.flags.delete(key);
  }
}

// ── Targeting ──────────────────────────────────────────────────────────────

export interface Context {
  userId?: string;
  orgId?: string;
  attrs?: Record<string, string>;
}

export class TargetingEngine {
  matches(rule: FlagRule, ctx: Context): boolean {
    const flatAttrs: Record<string, string> = {
      ...(ctx.userId ? { "user.id": ctx.userId } : {}),
      ...(ctx.orgId ? { "org.id": ctx.orgId } : {}),
      ...(ctx.attrs ?? {}),
    };
    const actual = flatAttrs[rule.attribute];
    if (actual === undefined) return false;
    switch (rule.op) {
      case "eq": return actual === rule.value;
      case "neq": return actual !== rule.value;
      case "in": return Array.isArray(rule.value) ? rule.value.includes(actual) : false;
      case "nin": return Array.isArray(rule.value) ? !rule.value.includes(actual) : true;
      case "regex": {
        try { return new RegExp(String(rule.value)).test(actual); }
        catch { return false; }
      }
    }
  }
}

// ── Rollout & Evaluation ───────────────────────────────────────────────────

export class RolloutController {
  constructor(private readonly registry: FlagRegistry, private readonly targeting: TargetingEngine) {}

  evaluate(key: string, ctx: Context): { enabled: boolean; variant?: string; reason: string } {
    const flag = this.registry.get(key);
    if (!flag) return { enabled: false, reason: "flag_not_found" };
    if (flag.status === "archived" || flag.status === "disabled") {
      return { enabled: Boolean(flag.defaultValue) && flag.status === "disabled" ? false : false, reason: "status_disabled" };
    }
    // Targeting rules short-circuit
    for (const rule of flag.rules) {
      if (this.targeting.matches(rule, ctx)) {
        return { enabled: true, reason: "targeting_match", variant: flag.kind === "variant" ? flag.variants[0] : undefined };
      }
    }

    if (flag.status === "enabled") {
      return { enabled: true, reason: "status_enabled", variant: flag.kind === "variant" ? flag.variants[0] : undefined };
    }

    const bucket = this._bucket(key, ctx);
    const threshold = flag.status === "canary" ? Math.min(5, flag.percentage) : flag.percentage;
    const enabled = bucket < threshold;
    if (!enabled) return { enabled: false, reason: "outside_rollout_bucket" };
    if (flag.kind === "variant" && flag.variants.length > 0) {
      const v = flag.variants[bucket % flag.variants.length];
      return { enabled: true, reason: "rollout_variant", variant: v };
    }
    return { enabled: true, reason: "rollout_in_bucket" };
  }

  private _bucket(key: string, ctx: Context): number {
    const seed = `${key}:${ctx.userId ?? ctx.orgId ?? "anon"}`;
    const h = createHash("md5").update(seed).digest();
    const n = h.readUInt32BE(0);
    return n % 100;
  }
}

// ── Experiments ────────────────────────────────────────────────────────────

export interface Experiment {
  id: string;
  flagKey: string;
  name: string;
  variants: string[];
  startedAt: number;
  endedAt?: number;
  stopped: boolean;
  assignments: number;
  metrics: Record<string, { exposures: number; conversions: number }>;
}

export class ExperimentTracker {
  private readonly experiments = new Map<string, Experiment>();

  start(params: { flagKey: string; name: string; variants: string[] }): Experiment {
    const id = `exp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const exp: Experiment = {
      id,
      flagKey: params.flagKey,
      name: params.name,
      variants: params.variants,
      startedAt: Date.now(),
      stopped: false,
      assignments: 0,
      metrics: Object.fromEntries(params.variants.map((v) => [v, { exposures: 0, conversions: 0 }])),
    };
    this.experiments.set(id, exp);
    return exp;
  }

  expose(id: string, variant: string): void {
    const e = this.experiments.get(id);
    if (!e || e.stopped) return;
    const m = e.metrics[variant];
    if (!m) return;
    m.exposures++;
    e.assignments++;
  }

  convert(id: string, variant: string): void {
    const e = this.experiments.get(id);
    if (!e) return;
    const m = e.metrics[variant];
    if (!m) return;
    m.conversions++;
  }

  stop(id: string): Experiment | null {
    const e = this.experiments.get(id);
    if (!e) return null;
    e.stopped = true;
    e.endedAt = Date.now();
    return e;
  }

  list(): Experiment[] {
    return Array.from(this.experiments.values());
  }

  get(id: string): Experiment | null {
    return this.experiments.get(id) ?? null;
  }
}

// ── Singletons ─────────────────────────────────────────────────────────────

export const flagRegistry = new FlagRegistry();
export const targetingEngine = new TargetingEngine();
export const rolloutController = new RolloutController(flagRegistry, targetingEngine);
export const experimentTracker = new ExperimentTracker();
