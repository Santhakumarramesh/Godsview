import { randomUUID } from "crypto";
import pino from "pino";

const logger = pino();

export type CertCategory =
  | "execution_truth"
  | "data_truth"
  | "shadow_validation"
  | "recovery_readiness"
  | "risk_controls"
  | "latency"
  | "reconciliation"
  | "compliance"
  | "operator_readiness"
  | "security";

export interface CertificationDimension {
  name: string;
  category: CertCategory;
  weight: number;
  score: number;
  threshold: number;
  passed: boolean;
  evidence: string;
  checked_at: string;
}

export interface CertificationRun {
  id: string;
  strategy_id?: string;
  initiated_by: string;
  started_at: string;
  completed_at?: string;
  status: "running" | "passed" | "passed_with_restrictions" | "failed" | "aborted";
  dimensions: CertificationDimension[];
  overall_score: number;
  pass_threshold: number;
  hard_failures: string[];
  restrictions: string[];
  recommendations: string[];
  certification_level: "full" | "restricted" | "paper_only" | "denied";
}

export interface CertificationPolicy {
  id: string;
  name: string;
  description: string;
  dimensions_required: string[];
  min_overall_score: number;
  hard_fail_dimensions: string[];
  restriction_dimensions: string[];
  created_at: string;
  active: boolean;
}

export interface CertificationHistory {
  strategy_id: string;
  runs: Array<{
    run_id: string;
    date: string;
    result: string;
    score: number;
  }>;
  current_certification: "full" | "restricted" | "paper_only" | "denied" | "uncertified";
  last_certified_at?: string;
}

const DEFAULT_PASS_THRESHOLD = 75;
const PAPER_ONLY_THRESHOLD = 50;
const DENIED_THRESHOLD = 50;

const DEFAULT_DIMENSIONS: Record<string, Omit<CertificationDimension, "score" | "passed" | "evidence" | "checked_at">> = {
  execution_truth: {
    name: "Broker Reconciliation",
    category: "execution_truth",
    weight: 15,
    threshold: 80,
  },
  data_truth: {
    name: "Feed Health",
    category: "data_truth",
    weight: 12,
    threshold: 75,
  },
  shadow_validation: {
    name: "Shadow PnL Validation",
    category: "shadow_validation",
    weight: 15,
    threshold: 70,
  },
  recovery_readiness: {
    name: "Recovery Drills",
    category: "recovery_readiness",
    weight: 10,
    threshold: 80,
  },
  risk_controls: {
    name: "Risk Controls",
    category: "risk_controls",
    weight: 12,
    threshold: 85,
  },
  latency: {
    name: "Decision Pipeline Latency",
    category: "latency",
    weight: 8,
    threshold: 70,
  },
  reconciliation: {
    name: "Reconciliation Accuracy",
    category: "reconciliation",
    weight: 10,
    threshold: 80,
  },
  compliance: {
    name: "Compliance & Audit",
    category: "compliance",
    weight: 8,
    threshold: 75,
  },
  operator_readiness: {
    name: "Operator Readiness",
    category: "operator_readiness",
    weight: 5,
    threshold: 70,
  },
  security: {
    name: "Security Hardening",
    category: "security",
    weight: 5,
    threshold: 80,
  },
};

const DEFAULT_HARD_FAIL_DIMENSIONS = ["execution_truth", "risk_controls", "reconciliation"];
const DEFAULT_RESTRICTION_DIMENSIONS = ["shadow_validation", "recovery_readiness"];

// In-memory storage with Maps
const certificationRuns = new Map<string, CertificationRun>();
const certificationPolicies = new Map<string, CertificationPolicy>();
const certificationHistories = new Map<string, CertificationHistory>();

export function runCertification(config: {
  strategy_id?: string;
  initiated_by: string;
  dimension_scores: Record<string, number>;
}): CertificationRun {
  const run_id = `cert_${randomUUID()}`;
  const started_at = new Date().toISOString();
  const pass_threshold = DEFAULT_PASS_THRESHOLD;

  const dimensions: CertificationDimension[] = [];
  let weighted_sum = 0;
  let total_weight = 0;
  const hard_failures: string[] = [];
  const restrictions: string[] = [];

  // Build dimensions from scores
  for (const [key, score] of Object.entries(config.dimension_scores)) {
    const template = DEFAULT_DIMENSIONS[key];
    if (!template) continue;

    const threshold = template.threshold;
    const passed = score >= threshold;
    const weight = template.weight;

    dimensions.push({
      name: template.name,
      category: template.category,
      weight,
      score,
      threshold,
      passed,
      evidence: `Score ${score} against threshold ${threshold}`,
      checked_at: started_at,
    });

    weighted_sum += score * weight;
    total_weight += weight;

    // Track hard failures and restrictions
    if (!passed) {
      if (DEFAULT_HARD_FAIL_DIMENSIONS.includes(key)) {
        hard_failures.push(key);
      }
      if (DEFAULT_RESTRICTION_DIMENSIONS.includes(key)) {
        restrictions.push(key);
      }
    }
  }

  const overall_score = total_weight > 0 ? Math.round((weighted_sum / total_weight) * 100) / 100 : 0;

  // Determine status and certification_level
  let status: "running" | "passed" | "passed_with_restrictions" | "failed";
  let certification_level: "full" | "restricted" | "paper_only" | "denied";

  if (hard_failures.length > 0) {
    status = "failed";
    certification_level = "denied";
  } else if (restrictions.length > 0 && overall_score >= pass_threshold) {
    status = "passed_with_restrictions";
    certification_level = "restricted";
  } else if (overall_score >= pass_threshold) {
    status = "passed";
    certification_level = "full";
  } else if (overall_score >= PAPER_ONLY_THRESHOLD && overall_score < pass_threshold) {
    status = "failed";
    certification_level = "paper_only";
  } else {
    status = "failed";
    certification_level = "denied";
  }

  const run: CertificationRun = {
    id: run_id,
    strategy_id: config.strategy_id,
    initiated_by: config.initiated_by,
    started_at,
    completed_at: new Date().toISOString(),
    status,
    dimensions,
    overall_score,
    pass_threshold,
    hard_failures,
    restrictions,
    recommendations: generateRecommendations(dimensions, hard_failures, restrictions),
    certification_level,
  };

  certificationRuns.set(run_id, run);

  // Update history if strategy_id provided
  if (config.strategy_id) {
    updateHistory(config.strategy_id, run);
  }

  logger.info({ run_id, status, overall_score }, "Certification run completed");
  return run;
}

export function abortCertification(run_id: string): { success: boolean; error?: string } {
  const run = certificationRuns.get(run_id);
  if (!run) {
    return { success: false, error: `Certification run ${run_id} not found` };
  }

  if (run.status === "running") {
    run.status = "aborted";
    run.completed_at = new Date().toISOString();
    logger.info({ run_id }, "Certification aborted");
    return { success: true };
  }

  return { success: false, error: `Cannot abort certification with status ${run.status}` };
}

export function getCertificationRun(id: string): CertificationRun | undefined {
  return certificationRuns.get(id);
}

export function getAllRuns(limit: number = 100): CertificationRun[] {
  return Array.from(certificationRuns.values())
    .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
    .slice(0, limit);
}

export function getRunsByStrategy(strategy_id: string): CertificationRun[] {
  return Array.from(certificationRuns.values())
    .filter((run) => run.strategy_id === strategy_id)
    .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
}

export function getLatestCertification(strategy_id: string): CertificationRun | undefined {
  const runs = getRunsByStrategy(strategy_id);
  return runs.length > 0 ? runs[0] : undefined;
}

export function createPolicy(
  policy: Omit<CertificationPolicy, "id" | "created_at" | "active">
): CertificationPolicy {
  const id = `cpol_${randomUUID()}`;
  const newPolicy: CertificationPolicy = {
    ...policy,
    id,
    created_at: new Date().toISOString(),
    active: false,
  };

  certificationPolicies.set(id, newPolicy);
  logger.info({ policy_id: id }, "Policy created");
  return newPolicy;
}

export function getPolicy(id: string): CertificationPolicy | undefined {
  return certificationPolicies.get(id);
}

export function getAllPolicies(): CertificationPolicy[] {
  return Array.from(certificationPolicies.values());
}

export function activatePolicy(policy_id: string): { success: boolean; error?: string } {
  const policy = certificationPolicies.get(policy_id);
  if (!policy) {
    return { success: false, error: `Policy ${policy_id} not found` };
  }

  // Deactivate all others
  for (const [, p] of certificationPolicies) {
    p.active = false;
  }

  policy.active = true;
  logger.info({ policy_id }, "Policy activated");
  return { success: true };
}

export function deactivatePolicy(policy_id: string): { success: boolean; error?: string } {
  const policy = certificationPolicies.get(policy_id);
  if (!policy) {
    return { success: false, error: `Policy ${policy_id} not found` };
  }

  policy.active = false;
  logger.info({ policy_id }, "Policy deactivated");
  return { success: true };
}

export function getCertificationHistory(strategy_id: string): CertificationHistory {
  let history = certificationHistories.get(strategy_id);

  if (!history) {
    history = {
      strategy_id,
      runs: [],
      current_certification: "uncertified",
    };
    certificationHistories.set(strategy_id, history);
  }

  return history;
}

export function getSystemCertificationStatus(): {
  certified_strategies: number;
  denied_strategies: number;
  uncertified_strategies: number;
  last_run?: CertificationRun;
} {
  let certified = 0;
  let denied = 0;
  let uncertified = 0;

  for (const history of certificationHistories.values()) {
    if (history.current_certification === "full" || history.current_certification === "restricted") {
      certified++;
    } else if (history.current_certification === "denied") {
      denied++;
    } else {
      uncertified++;
    }
  }

  const lastRun = getAllRuns(1)[0];

  return {
    certified_strategies: certified,
    denied_strategies: denied,
    uncertified_strategies: uncertified,
    last_run: lastRun,
  };
}

export function _clearCertification(): void {
  certificationRuns.clear();
  certificationPolicies.clear();
  certificationHistories.clear();
}

// Helper functions
function generateRecommendations(
  dimensions: CertificationDimension[],
  hard_failures: string[],
  restrictions: string[]
): string[] {
  const recommendations: string[] = [];

  if (hard_failures.includes("execution_truth")) {
    recommendations.push("Improve broker reconciliation process - critical for deployment");
  }
  if (hard_failures.includes("risk_controls")) {
    recommendations.push("Verify all risk control systems are operational before proceeding");
  }
  if (hard_failures.includes("reconciliation")) {
    recommendations.push("Resolve all open reconciliation mismatches");
  }

  if (restrictions.includes("shadow_validation")) {
    recommendations.push("Deploy with restricted trading capacity until shadow validation passes");
  }
  if (restrictions.includes("recovery_readiness")) {
    recommendations.push("Schedule additional failure recovery drills");
  }

  for (const dim of dimensions) {
    if (!dim.passed && dim.score < dim.threshold - 10) {
      recommendations.push(`${dim.name}: Score ${dim.score} is significantly below threshold ${dim.threshold}`);
    }
  }

  if (recommendations.length === 0) {
    recommendations.push("System ready for production deployment");
  }

  return recommendations;
}

function updateHistory(strategy_id: string, run: CertificationRun): void {
  let history = certificationHistories.get(strategy_id);

  if (!history) {
    history = {
      strategy_id,
      runs: [],
      current_certification: "uncertified",
    };
    certificationHistories.set(strategy_id, history);
  }

  history.runs.push({
    run_id: run.id,
    date: run.completed_at || run.started_at,
    result: run.status,
    score: run.overall_score,
  });

  // Keep only last 100 runs
  if (history.runs.length > 100) {
    history.runs = history.runs.slice(-100);
  }

  // Update current certification status
  if (run.status === "passed") {
    history.current_certification = "full";
    history.last_certified_at = run.completed_at;
  } else if (run.status === "passed_with_restrictions") {
    history.current_certification = "restricted";
    history.last_certified_at = run.completed_at;
  } else if (run.status === "failed") {
    if (run.certification_level === "paper_only") {
      history.current_certification = "paper_only";
    } else {
      history.current_certification = "denied";
    }
  }
}
