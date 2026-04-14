/**
 * self_heal/index.ts — Phase 90: System Diagnostics + Self-Heal Recommender
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. DiagnosticsRunner    — runs registered system probes.
 *   2. RemediationCatalog   — known remediations + apply tracking.
 *   3. SelfHealRecommender  — match diagnostic findings to remediations.
 *   4. AutoApplyGuard       — gate auto-apply by confidence + safety class.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "../logger.js";

// ── Diagnostics ───────────────────────────────────────────────────────────

export type DiagnosticSeverity = "info" | "warning" | "critical";

export interface DiagnosticFinding {
  id: string;
  probe: string;
  ranAt: number;
  severity: DiagnosticSeverity;
  symptom: string;
  details: Record<string, unknown>;
  resolved: boolean;
  resolvedAt?: number;
}

export type ProbeFn = () => Promise<{ severity: DiagnosticSeverity; symptom: string; details?: Record<string, unknown> } | null>;

export class DiagnosticsRunner {
  private readonly probes = new Map<string, ProbeFn>();
  private readonly findings: DiagnosticFinding[] = [];

  registerProbe(name: string, probe: ProbeFn): void {
    this.probes.set(name, probe);
  }

  listProbes(): string[] {
    return Array.from(this.probes.keys());
  }

  async runOne(name: string): Promise<DiagnosticFinding | null> {
    const probe = this.probes.get(name);
    if (!probe) return null;
    const result = await probe();
    if (!result) return null;
    const finding: DiagnosticFinding = {
      id: `dia_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      probe: name,
      ranAt: Date.now(),
      severity: result.severity,
      symptom: result.symptom,
      details: result.details ?? {},
      resolved: false,
    };
    this.findings.push(finding);
    if (this.findings.length > 5000) this.findings.shift();
    return finding;
  }

  async runAll(): Promise<DiagnosticFinding[]> {
    const out: DiagnosticFinding[] = [];
    for (const name of this.probes.keys()) {
      const f = await this.runOne(name);
      if (f) out.push(f);
    }
    return out;
  }

  resolve(id: string): DiagnosticFinding | null {
    const f = this.findings.find((x) => x.id === id);
    if (!f) return null;
    f.resolved = true;
    f.resolvedAt = Date.now();
    return f;
  }

  recent(limit = 100): DiagnosticFinding[] {
    return this.findings.slice(-limit).reverse();
  }

  open(): DiagnosticFinding[] {
    return this.findings.filter((f) => !f.resolved).reverse();
  }
}

// ── Remediation ───────────────────────────────────────────────────────────

export type SafetyClass = "safe" | "caution" | "manual_only";

export interface Remediation {
  id: string;
  name: string;
  description: string;
  matchSymptomPattern: string; // regex source
  safetyClass: SafetyClass;
  estimatedImpactSeconds: number;
  createdAt: number;
}

export interface RemediationApply {
  id: string;
  remediationId: string;
  findingId: string;
  appliedAt: number;
  outcome: "succeeded" | "failed" | "no_op";
  durationMs: number;
  notes: string;
}

export class RemediationCatalog {
  private readonly remediations = new Map<string, Remediation>();
  private readonly applies: RemediationApply[] = [];

  register(params: Omit<Remediation, "id" | "createdAt">): Remediation {
    const id = `rem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const r: Remediation = { id, createdAt: Date.now(), ...params };
    this.remediations.set(id, r);
    return r;
  }

  list(): Remediation[] {
    return Array.from(this.remediations.values());
  }

  get(id: string): Remediation | null {
    return this.remediations.get(id) ?? null;
  }

  recordApply(params: Omit<RemediationApply, "id" | "appliedAt">): RemediationApply {
    const apply: RemediationApply = {
      id: `app_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      appliedAt: Date.now(),
      ...params,
    };
    this.applies.push(apply);
    if (this.applies.length > 10_000) this.applies.shift();
    return apply;
  }

  applyHistory(remediationId?: string): RemediationApply[] {
    return (remediationId ? this.applies.filter((a) => a.remediationId === remediationId) : this.applies).reverse();
  }

  effectiveness(remediationId: string): { total: number; succeeded: number; failed: number; rate: number } {
    const all = this.applies.filter((a) => a.remediationId === remediationId);
    const succeeded = all.filter((a) => a.outcome === "succeeded").length;
    const failed = all.filter((a) => a.outcome === "failed").length;
    const total = all.length;
    return { total, succeeded, failed, rate: total > 0 ? succeeded / total : 0 };
  }
}

// ── Self-Heal Recommender ─────────────────────────────────────────────────

export interface Recommendation {
  finding: DiagnosticFinding;
  remediation: Remediation;
  confidence: number;          // 0..1
  effectivenessRate: number;   // historical success rate
  autoApplyAllowed: boolean;
}

export class SelfHealRecommender {
  constructor(
    private readonly diagnostics: DiagnosticsRunner,
    private readonly catalog: RemediationCatalog,
  ) {}

  recommend(): Recommendation[] {
    const findings = this.diagnostics.open();
    const remediations = this.catalog.list();
    const out: Recommendation[] = [];
    for (const finding of findings) {
      for (const rem of remediations) {
        try {
          const re = new RegExp(rem.matchSymptomPattern, "i");
          if (re.test(finding.symptom)) {
            const eff = this.catalog.effectiveness(rem.id);
            const confidence = eff.total === 0 ? 0.5 : eff.rate;
            out.push({
              finding,
              remediation: rem,
              confidence,
              effectivenessRate: eff.rate,
              autoApplyAllowed: rem.safetyClass === "safe" && confidence >= 0.8,
            });
          }
        } catch (err) {
          logger.warn({ pattern: rem.matchSymptomPattern, err }, "[SelfHeal] Bad regex");
        }
      }
    }
    out.sort((a, b) => b.confidence - a.confidence);
    return out;
  }
}

// ── Auto-Apply Guard ──────────────────────────────────────────────────────

export interface AutoApplyConfig {
  enabled: boolean;
  minConfidence: number;
  maxPerHour: number;
  allowedSafetyClasses: SafetyClass[];
}

export class AutoApplyGuard {
  private config: AutoApplyConfig = {
    enabled: false,
    minConfidence: 0.85,
    maxPerHour: 5,
    allowedSafetyClasses: ["safe"],
  };
  private readonly recentApplies: number[] = [];

  set(config: Partial<AutoApplyConfig>): AutoApplyConfig {
    this.config = { ...this.config, ...config };
    return this.config;
  }

  get(): AutoApplyConfig {
    return this.config;
  }

  decide(rec: Recommendation): { allowed: boolean; reason: string } {
    if (!this.config.enabled) return { allowed: false, reason: "auto_apply_disabled" };
    if (!this.config.allowedSafetyClasses.includes(rec.remediation.safetyClass)) {
      return { allowed: false, reason: `safety_class_${rec.remediation.safetyClass}_disallowed` };
    }
    if (rec.confidence < this.config.minConfidence) {
      return { allowed: false, reason: `confidence_${rec.confidence.toFixed(2)}_below_min` };
    }
    const since = Date.now() - 60 * 60 * 1000;
    const recentCount = this.recentApplies.filter((t) => t >= since).length;
    if (recentCount >= this.config.maxPerHour) {
      return { allowed: false, reason: `rate_limited_${recentCount}_in_last_hour` };
    }
    return { allowed: true, reason: "within_policy" };
  }

  recordApply(): void {
    this.recentApplies.push(Date.now());
    if (this.recentApplies.length > 100) this.recentApplies.shift();
  }
}

// ── Singletons ─────────────────────────────────────────────────────────────

export const diagnosticsRunner = new DiagnosticsRunner();
export const remediationCatalog = new RemediationCatalog();
export const selfHealRecommender = new SelfHealRecommender(diagnosticsRunner, remediationCatalog);
export const autoApplyGuard = new AutoApplyGuard();

// Seed a couple of canonical probes + remediations
diagnosticsRunner.registerProbe("memory_pressure", async () => {
  const used = process.memoryUsage().heapUsed / 1024 / 1024;
  if (used > 1500) return { severity: "critical", symptom: "memory pressure high", details: { heapUsedMB: used } };
  if (used > 800) return { severity: "warning", symptom: "memory pressure rising", details: { heapUsedMB: used } };
  return null;
});

remediationCatalog.register({
  name: "trigger_gc",
  description: "Trigger Node.js garbage collection",
  matchSymptomPattern: "memory pressure",
  safetyClass: "safe",
  estimatedImpactSeconds: 1,
});

remediationCatalog.register({
  name: "rotate_pods",
  description: "Restart application pods to clear leaks",
  matchSymptomPattern: "memory pressure high",
  safetyClass: "caution",
  estimatedImpactSeconds: 30,
});

logger.info("[SelfHeal] Module initialized");
