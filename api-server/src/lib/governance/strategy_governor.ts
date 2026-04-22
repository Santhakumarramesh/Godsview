/**
 * Strategy Governor — Policy-driven strategy lifecycle governance.
 *
 * Enforces promotion rules, retirement policies, evidence requirements,
 * and operator approval workflows for the strategy lifecycle.
 */
import { logger } from "../logger";
import type { StrategyStatus, EvidencePacket } from "../storage/strategy_store";

// ── Governance Policy ─────────────────────────────────────────────────

export interface PromotionPolicy {
  from: StrategyStatus;
  to: StrategyStatus;
  requiredEvidence: EvidenceRequirement[];
  requiresOperatorApproval: boolean;
  autoPromotable: boolean;
  description: string;
}

export interface EvidenceRequirement {
  field: keyof EvidencePacket;
  check: "exists" | "gte" | "lte" | "eq" | "truthy";
  value?: number | string | boolean;
  description: string;
}

export interface GovernanceResult {
  allowed: boolean;
  missingEvidence: string[];
  warnings: string[];
  requiresApproval: boolean;
  policyName: string;
}

export interface RetirementCheck {
  shouldRetire: boolean;
  reasons: string[];
  severity: "suggestion" | "warning" | "forced";
}

// ── Default Promotion Policies ────────────────────────────────────────

const PROMOTION_POLICIES: PromotionPolicy[] = [
  {
    from: "draft",
    to: "parsed",
    requiredEvidence: [],
    requiresOperatorApproval: false,
    autoPromotable: true,
    description: "Strategy successfully parsed from NL input",
  },
  {
    from: "parsed",
    to: "backtested",
    requiredEvidence: [
      { field: "backtestSharpe", check: "gte", value: 0.5, description: "Backtest Sharpe >= 0.5" },
      { field: "backtestWinRate", check: "gte", value: 0.40, description: "Backtest win rate >= 40%" },
      { field: "backtestSampleSize", check: "gte", value: 100, description: "At least 100 backtest trades" },
      { field: "backtestMaxDrawdown", check: "gte", value: -0.30, description: "Max drawdown <= 30%" },
    ],
    requiresOperatorApproval: false,
    autoPromotable: true,
    description: "Strategy passes backtest quality gates",
  },
  {
    from: "backtested",
    to: "stress_tested",
    requiredEvidence: [
      { field: "walkForwardOosSharpe", check: "gte", value: 0.3, description: "OOS Sharpe >= 0.3" },
      { field: "walkForwardOosWinRate", check: "gte", value: 0.35, description: "OOS win rate >= 35%" },
      { field: "walkForwardDegradation", check: "lte", value: 0.25, description: "IS-to-OOS degradation <= 25%" },
    ],
    requiresOperatorApproval: false,
    autoPromotable: true,
    description: "Walk-forward and stress tests validate edge persistence",
  },
  {
    from: "stress_tested",
    to: "shadow_ready",
    requiredEvidence: [
      { field: "replayGrade", check: "exists", description: "Replay engine grade assigned" },
      { field: "riskLimitsPass", check: "truthy", description: "Risk limits validation passes" },
    ],
    requiresOperatorApproval: false,
    autoPromotable: true,
    description: "Replay validation and risk checks complete",
  },
  {
    from: "shadow_ready",
    to: "paper_approved",
    requiredEvidence: [
      { field: "shadowWinRate", check: "gte", value: 0.40, description: "Shadow mode win rate >= 40%" },
      { field: "shadowSampleSize", check: "gte", value: 30, description: "At least 30 shadow trades" },
      { field: "calibrationDrift", check: "lte", value: 0.15, description: "Calibration drift <= 15%" },
    ],
    requiresOperatorApproval: true,
    autoPromotable: false,
    description: "Shadow trading validates live-like performance",
  },
  {
    from: "paper_approved",
    to: "live_assisted_approved",
    requiredEvidence: [
      { field: "paperWinRate", check: "gte", value: 0.42, description: "Paper win rate >= 42%" },
      { field: "paperSampleSize", check: "gte", value: 50, description: "At least 50 paper trades" },
      { field: "paperDurationDays", check: "gte", value: 14, description: "At least 14 days paper trading" },
      { field: "calibrationDrift", check: "lte", value: 0.10, description: "Calibration drift <= 10%" },
      { field: "operatorApproved", check: "truthy", description: "Operator explicit approval" },
    ],
    requiresOperatorApproval: true,
    autoPromotable: false,
    description: "Paper trading proves real-world viability",
  },
  {
    from: "live_assisted_approved",
    to: "autonomous_candidate",
    requiredEvidence: [
      { field: "paperWinRate", check: "gte", value: 0.45, description: "Paper win rate >= 45%" },
      { field: "paperSampleSize", check: "gte", value: 200, description: "At least 200 paper trades" },
      { field: "paperDurationDays", check: "gte", value: 30, description: "At least 30 days paper trading" },
      { field: "calibrationDrift", check: "lte", value: 0.05, description: "Calibration drift <= 5%" },
      { field: "operatorApproved", check: "truthy", description: "Operator explicit approval for autonomy" },
    ],
    requiresOperatorApproval: true,
    autoPromotable: false,
    description: "Extensive paper evidence supports autonomous candidacy",
  },
];

// ── Strategy Governor Class ───────────────────────────────────────────

export class StrategyGovernor {
  private policies: PromotionPolicy[];

  constructor(customPolicies?: PromotionPolicy[]) {
    this.policies = customPolicies || PROMOTION_POLICIES;
  }

  /**
   * Evaluate whether a promotion is allowed given evidence.
   */
  evaluatePromotion(
    fromStatus: StrategyStatus,
    toStatus: StrategyStatus,
    evidence: Partial<EvidencePacket>
  ): GovernanceResult {
    const policy = this.policies.find(p => p.from === fromStatus && p.to === toStatus);

    if (!policy) {
      // Check for valid demotion (always allowed)
      const statusOrder: StrategyStatus[] = [
        "draft", "parsed", "backtested", "stress_tested", "shadow_ready",
        "paper_approved", "live_assisted_approved", "autonomous_candidate",
        "autonomous_approved",
      ];
      const fromIdx = statusOrder.indexOf(fromStatus);
      const toIdx = statusOrder.indexOf(toStatus);

      if (toStatus === "degraded" || toStatus === "paused" || toStatus === "retired" || toStatus === "rolled_back") {
        return {
          allowed: true,
          missingEvidence: [],
          warnings: [`Strategy moving to ${toStatus} — safety action`],
          requiresApproval: false,
          policyName: `safety_${toStatus}`,
        };
      }

      if (fromIdx >= 0 && toIdx >= 0 && toIdx < fromIdx) {
        return {
          allowed: true,
          missingEvidence: [],
          warnings: [`Demotion from ${fromStatus} to ${toStatus}`],
          requiresApproval: false,
          policyName: "demotion",
        };
      }

      return {
        allowed: false,
        missingEvidence: [`No promotion policy defined for ${fromStatus} → ${toStatus}`],
        warnings: [],
        requiresApproval: false,
        policyName: "none",
      };
    }

    const missing: string[] = [];
    const warnings: string[] = [];

    for (const req of policy.requiredEvidence) {
      const value = evidence[req.field];
      let passed = false;

      switch (req.check) {
        case "exists":
          passed = value !== undefined && value !== null;
          break;
        case "truthy":
          passed = !!value;
          break;
        case "gte":
          passed = typeof value === "number" && value >= (req.value as number);
          break;
        case "lte":
          passed = typeof value === "number" && value <= (req.value as number);
          break;
        case "eq":
          passed = value === req.value;
          break;
      }

      if (!passed) {
        missing.push(req.description);
      }
    }

    if (missing.length > 0) {
      warnings.push(`${missing.length} evidence requirements not met`);
    }

    return {
      allowed: missing.length === 0,
      missingEvidence: missing,
      warnings,
      requiresApproval: policy.requiresOperatorApproval,
      policyName: `${policy.from}_to_${policy.to}`,
    };
  }

  /**
   * Check if a strategy should be retired based on performance degradation.
   */
  evaluateRetirement(metrics: {
    calibrationDrift: number;
    recentWinRate: number;
    daysSinceLastTrade: number;
    consecutiveLosses: number;
    maxDrawdown: number;
  }): RetirementCheck {
    const reasons: string[] = [];
    let severity: "suggestion" | "warning" | "forced" = "suggestion";

    if (Math.abs(metrics.calibrationDrift) > 0.25) {
      reasons.push(`Critical calibration drift: ${(metrics.calibrationDrift * 100).toFixed(1)}%`);
      severity = "forced";
    }

    if (metrics.recentWinRate < 0.25) {
      reasons.push(`Win rate critically low: ${(metrics.recentWinRate * 100).toFixed(1)}%`);
      severity = severity === "forced" ? "forced" : "warning";
    }

    if (metrics.daysSinceLastTrade > 90) {
      reasons.push(`No trades in ${metrics.daysSinceLastTrade} days — strategy may be stale`);
      severity = severity === "forced" ? "forced" : "suggestion";
    }

    if (metrics.consecutiveLosses >= 10) {
      reasons.push(`${metrics.consecutiveLosses} consecutive losses`);
      severity = "forced";
    }

    if (metrics.maxDrawdown < -0.35) {
      reasons.push(`Max drawdown ${(metrics.maxDrawdown * 100).toFixed(1)}% exceeds safety threshold`);
      severity = "forced";
    }

    return {
      shouldRetire: reasons.length > 0,
      reasons,
      severity,
    };
  }

  /**
   * Get the evidence template for a specific promotion.
   */
  getEvidenceTemplate(fromStatus: StrategyStatus, toStatus: StrategyStatus): EvidenceRequirement[] {
    const policy = this.policies.find(p => p.from === fromStatus && p.to === toStatus);
    return policy?.requiredEvidence || [];
  }

  /**
   * Get all valid next statuses from a given status.
   */
  getValidTransitions(currentStatus: StrategyStatus): Array<{ to: StrategyStatus; description: string; requiresApproval: boolean }> {
    const forward = this.policies
      .filter(p => p.from === currentStatus)
      .map(p => ({ to: p.to, description: p.description, requiresApproval: p.requiresOperatorApproval }));

    // Always allow safety transitions
    const safety: Array<{ to: StrategyStatus; description: string; requiresApproval: boolean }> = [
      { to: "paused", description: "Pause strategy execution", requiresApproval: false },
      { to: "degraded", description: "Mark strategy as degraded", requiresApproval: false },
      { to: "retired", description: "Retire strategy permanently", requiresApproval: true },
    ];

    return [...forward, ...safety];
  }
}

// ── Singleton ─────────────────────────────────────────────────────────

export const strategyGovernor = new StrategyGovernor();
