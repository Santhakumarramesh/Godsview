/**
 * Autonomy Governor — Phase 22
 *
 * Central authority for autonomous trading candidates.
 * Manages:
 *   - Candidate registration and eligibility
 *   - Trust tier enforcement (observation → recommendation → bounded_auto → full_auto)
 *   - Automatic revocation on drift/slippage/data-truth failures
 *   - Budget enforcement
 *   - Policy override management
 */

import { logger } from "../logger";
import crypto from "crypto";

export type TrustTier = "observation" | "recommendation" | "bounded_auto" | "full_auto";
export type CandidateStatus = "candidate" | "approved" | "active" | "suspended" | "revoked" | "retired";
export type RevocationTrigger = "drift_breach" | "slippage_breach" | "data_truth_failure" | "consecutive_losses" | "budget_breach" | "manual" | "policy_violation" | "certification_expired";

export interface AutonomousCandidate {
  candidate_id: string;
  strategy_id: string;
  strategy_name: string;
  operator_id: string;
  trust_tier: TrustTier;
  trust_score: number;
  status: CandidateStatus;
  approved_by?: string;
  approved_at?: Date;

  // Constraints
  max_daily_trades: number;
  max_position_usd: number;
  max_daily_loss_usd: number;
  allowed_symbols: string[];
  allowed_hours_start: number; // 0-23
  allowed_hours_end: number;
  max_open_positions: number;
  cooldown_minutes: number;

  // Performance
  trades_executed: number;
  trades_won: number;
  realized_pnl: number;
  peak_drawdown_pct: number;
  consecutive_losses: number;
  last_trade_at?: Date;

  // Health
  drift_score: number;
  slippage_score: number;
  data_health_score: number;
  last_health_check_at?: Date;

  // Refs
  certification_run_id?: string;
  assisted_session_id?: string;

  created_at: Date;
  updated_at: Date;
}

export interface AutonomyPolicy {
  policy_id: string;
  candidate_id: string;
  policy_type: string;
  policy_value_json: Record<string, unknown>;
  reason: string;
  created_by: string;
  active: boolean;
  expires_at?: Date;
  created_at: Date;
}

export interface AutonomyRevocation {
  revocation_id: string;
  candidate_id: string;
  strategy_id: string;
  revoked_by: string;
  trigger_type: RevocationTrigger;
  severity: "warning" | "critical" | "emergency";
  previous_tier: TrustTier;
  new_tier: TrustTier;
  previous_status: CandidateStatus;
  new_status: CandidateStatus;
  trigger_details_json: Record<string, unknown>;
  metrics_at_revocation_json: Record<string, unknown>;
  reinstated: boolean;
  reinstated_by?: string;
  reinstated_at?: Date;
  reinstatement_notes?: string;
  created_at: Date;
}

// ── In-memory stores ─────────────────────────────────────────────

const candidates: Map<string, AutonomousCandidate> = new Map();
const policies: Map<string, AutonomyPolicy> = new Map();
const revocations: AutonomyRevocation[] = [];

// ── Thresholds ───────────────────────────────────────────────────

const DRIFT_THRESHOLD = 0.3;
const SLIPPAGE_THRESHOLD = 0.3;
const DATA_HEALTH_THRESHOLD = 0.5;
const MAX_CONSECUTIVE_LOSSES = 5;
const MAX_DRAWDOWN_PCT = 10;

// ── Candidate Management ─────────────────────────────────────────

export function registerCandidate(params: {
  strategy_id: string;
  strategy_name: string;
  operator_id: string;
  trust_tier?: TrustTier;
  max_daily_trades?: number;
  max_position_usd?: number;
  max_daily_loss_usd?: number;
  allowed_symbols?: string[];
  allowed_hours_start?: number;
  allowed_hours_end?: number;
  max_open_positions?: number;
  cooldown_minutes?: number;
  certification_run_id?: string;
  assisted_session_id?: string;
}): { success: boolean; candidate?: AutonomousCandidate; error?: string } {
  const candidate_id = `auc_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const now = new Date();

  const candidate: AutonomousCandidate = {
    candidate_id,
    strategy_id: params.strategy_id,
    strategy_name: params.strategy_name,
    operator_id: params.operator_id,
    trust_tier: params.trust_tier ?? "observation",
    trust_score: 0,
    status: "candidate",
    max_daily_trades: params.max_daily_trades ?? 10,
    max_position_usd: params.max_position_usd ?? 1000,
    max_daily_loss_usd: params.max_daily_loss_usd ?? 200,
    allowed_symbols: params.allowed_symbols ?? [],
    allowed_hours_start: params.allowed_hours_start ?? 9,
    allowed_hours_end: params.allowed_hours_end ?? 16,
    max_open_positions: params.max_open_positions ?? 3,
    cooldown_minutes: params.cooldown_minutes ?? 5,
    trades_executed: 0,
    trades_won: 0,
    realized_pnl: 0,
    peak_drawdown_pct: 0,
    consecutive_losses: 0,
    drift_score: 1.0,
    slippage_score: 1.0,
    data_health_score: 1.0,
    certification_run_id: params.certification_run_id,
    assisted_session_id: params.assisted_session_id,
    created_at: now,
    updated_at: now,
  };

  candidates.set(candidate_id, candidate);
  logger.info({ candidate_id, strategy_id: params.strategy_id }, "Autonomous candidate registered");

  return { success: true, candidate };
}

export function approveCandidate(candidate_id: string, approved_by: string): { success: boolean; candidate?: AutonomousCandidate; error?: string } {
  const c = candidates.get(candidate_id);
  if (!c) return { success: false, error: "Candidate not found" };
  if (c.status !== "candidate") return { success: false, error: `Cannot approve: status is '${c.status}'` };

  c.status = "approved";
  c.approved_by = approved_by;
  c.approved_at = new Date();
  c.updated_at = new Date();

  logger.info({ candidate_id, approved_by }, "Candidate APPROVED");
  return { success: true, candidate: c };
}

export function activateCandidate(candidate_id: string): { success: boolean; candidate?: AutonomousCandidate; error?: string } {
  const c = candidates.get(candidate_id);
  if (!c) return { success: false, error: "Candidate not found" };
  if (c.status !== "approved") return { success: false, error: `Cannot activate: status is '${c.status}'` };

  c.status = "active";
  c.updated_at = new Date();

  logger.info({ candidate_id }, "Candidate ACTIVATED for autonomous trading");
  return { success: true, candidate: c };
}

export function suspendCandidate(candidate_id: string, reason: string): { success: boolean; candidate?: AutonomousCandidate; error?: string } {
  const c = candidates.get(candidate_id);
  if (!c) return { success: false, error: "Candidate not found" };
  if (c.status !== "active" && c.status !== "approved") return { success: false, error: `Cannot suspend: status is '${c.status}'` };

  const prevStatus = c.status;
  c.status = "suspended";
  c.updated_at = new Date();

  logger.warn({ candidate_id, reason, previous_status: prevStatus }, "Candidate SUSPENDED");
  return { success: true, candidate: c };
}

// ── Revocation ───────────────────────────────────────────────────

export function revokeCandidate(
  candidate_id: string,
  revoked_by: string,
  trigger_type: RevocationTrigger,
  severity: "warning" | "critical" | "emergency",
  details: Record<string, unknown> = {}
): { success: boolean; revocation?: AutonomyRevocation; error?: string } {
  const c = candidates.get(candidate_id);
  if (!c) return { success: false, error: "Candidate not found" };

  const prevTier = c.trust_tier;
  const prevStatus = c.status;

  // Determine new tier (always demote to observation on revoke)
  const newTier: TrustTier = "observation";
  c.trust_tier = newTier;
  c.status = "revoked";
  c.updated_at = new Date();

  const revocation: AutonomyRevocation = {
    revocation_id: `rev_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    candidate_id,
    strategy_id: c.strategy_id,
    revoked_by,
    trigger_type,
    severity,
    previous_tier: prevTier,
    new_tier: newTier,
    previous_status: prevStatus,
    new_status: "revoked",
    trigger_details_json: details,
    metrics_at_revocation_json: {
      drift_score: c.drift_score,
      slippage_score: c.slippage_score,
      data_health_score: c.data_health_score,
      consecutive_losses: c.consecutive_losses,
      peak_drawdown_pct: c.peak_drawdown_pct,
      realized_pnl: c.realized_pnl,
    },
    reinstated: false,
    created_at: new Date(),
  };

  revocations.push(revocation);
  logger.fatal({ candidate_id, trigger_type, severity }, "Candidate REVOKED");

  return { success: true, revocation };
}

export function reinstateCandidate(
  candidate_id: string,
  reinstated_by: string,
  notes: string
): { success: boolean; candidate?: AutonomousCandidate; error?: string } {
  const c = candidates.get(candidate_id);
  if (!c) return { success: false, error: "Candidate not found" };
  if (c.status !== "revoked" && c.status !== "suspended") return { success: false, error: `Cannot reinstate: status is '${c.status}'` };

  c.status = "candidate"; // Go back to candidate for re-approval
  c.updated_at = new Date();

  // Mark latest revocation as reinstated
  const latest = revocations.filter((r) => r.candidate_id === candidate_id && !r.reinstated).pop();
  if (latest) {
    latest.reinstated = true;
    latest.reinstated_by = reinstated_by;
    latest.reinstated_at = new Date();
    latest.reinstatement_notes = notes;
  }

  logger.info({ candidate_id, reinstated_by }, "Candidate REINSTATED");
  return { success: true, candidate: c };
}

// ── Health Check & Auto-Demotion ─────────────────────────────────

export interface HealthCheckResult {
  candidate_id: string;
  passed: boolean;
  checks: { name: string; passed: boolean; value: number; threshold: number }[];
  auto_revoked: boolean;
  revocation_trigger?: RevocationTrigger;
}

export function runHealthCheck(candidate_id: string): HealthCheckResult {
  const c = candidates.get(candidate_id);
  if (!c) return { candidate_id, passed: false, checks: [], auto_revoked: false };

  const checks = [
    { name: "drift_score", passed: c.drift_score >= DRIFT_THRESHOLD, value: c.drift_score, threshold: DRIFT_THRESHOLD },
    { name: "slippage_score", passed: c.slippage_score >= SLIPPAGE_THRESHOLD, value: c.slippage_score, threshold: SLIPPAGE_THRESHOLD },
    { name: "data_health_score", passed: c.data_health_score >= DATA_HEALTH_THRESHOLD, value: c.data_health_score, threshold: DATA_HEALTH_THRESHOLD },
    { name: "consecutive_losses", passed: c.consecutive_losses < MAX_CONSECUTIVE_LOSSES, value: c.consecutive_losses, threshold: MAX_CONSECUTIVE_LOSSES },
    { name: "peak_drawdown_pct", passed: c.peak_drawdown_pct < MAX_DRAWDOWN_PCT, value: c.peak_drawdown_pct, threshold: MAX_DRAWDOWN_PCT },
  ];

  c.last_health_check_at = new Date();
  c.updated_at = new Date();

  const passed = checks.every((ch) => ch.passed);

  // Auto-revoke if active and health check fails
  if (!passed && c.status === "active") {
    const failedCheck = checks.find((ch) => !ch.passed)!;
    let trigger: RevocationTrigger = "drift_breach";
    if (failedCheck.name === "slippage_score") trigger = "slippage_breach";
    else if (failedCheck.name === "data_health_score") trigger = "data_truth_failure";
    else if (failedCheck.name === "consecutive_losses") trigger = "consecutive_losses";
    else if (failedCheck.name === "peak_drawdown_pct") trigger = "budget_breach";

    revokeCandidate(candidate_id, "system", trigger, "critical", {
      failed_check: failedCheck.name,
      value: failedCheck.value,
      threshold: failedCheck.threshold,
    });

    return { candidate_id, passed: false, checks, auto_revoked: true, revocation_trigger: trigger };
  }

  return { candidate_id, passed, checks, auto_revoked: false };
}

// ── Eligibility Check ────────────────────────────────────────────

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
  candidate?: AutonomousCandidate;
}

export function checkEligibility(candidate_id: string): EligibilityResult {
  const c = candidates.get(candidate_id);
  if (!c) return { eligible: false, reasons: ["Candidate not found"] };

  const reasons: string[] = [];

  if (c.status !== "active") reasons.push(`Status '${c.status}' is not 'active'`);
  if (c.trust_tier === "observation") reasons.push("Observation tier cannot execute");
  if (c.drift_score < DRIFT_THRESHOLD) reasons.push(`Drift score ${c.drift_score} below threshold ${DRIFT_THRESHOLD}`);
  if (c.slippage_score < SLIPPAGE_THRESHOLD) reasons.push(`Slippage score ${c.slippage_score} below threshold ${SLIPPAGE_THRESHOLD}`);
  if (c.data_health_score < DATA_HEALTH_THRESHOLD) reasons.push(`Data health ${c.data_health_score} below threshold ${DATA_HEALTH_THRESHOLD}`);
  if (c.consecutive_losses >= MAX_CONSECUTIVE_LOSSES) reasons.push(`Consecutive losses ${c.consecutive_losses} at limit`);

  return { eligible: reasons.length === 0, reasons, candidate: c };
}

// ── Queries ──────────────────────────────────────────────────────

export function getCandidate(candidate_id: string): AutonomousCandidate | undefined {
  return candidates.get(candidate_id);
}

export function getAllCandidates(status?: CandidateStatus): AutonomousCandidate[] {
  const all = Array.from(candidates.values());
  return status ? all.filter((c) => c.status === status) : all;
}

export function getRevocations(candidate_id?: string): AutonomyRevocation[] {
  return candidate_id ? revocations.filter((r) => r.candidate_id === candidate_id) : [...revocations];
}

export function getPolicies(candidate_id?: string): AutonomyPolicy[] {
  const all = Array.from(policies.values());
  return candidate_id ? all.filter((p) => p.candidate_id === candidate_id && p.active) : all.filter((p) => p.active);
}

export function addPolicy(params: {
  candidate_id: string;
  policy_type: string;
  policy_value_json: Record<string, unknown>;
  reason: string;
  created_by: string;
  expires_at?: Date;
}): AutonomyPolicy {
  const policy_id = `pol_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const policy: AutonomyPolicy = {
    policy_id,
    ...params,
    active: true,
    created_at: new Date(),
  };
  policies.set(policy_id, policy);
  return policy;
}

export function deactivatePolicy(policy_id: string): boolean {
  const p = policies.get(policy_id);
  if (!p) return false;
  p.active = false;
  return true;
}

export function updateHealthScores(candidate_id: string, scores: { drift_score?: number; slippage_score?: number; data_health_score?: number }): void {
  const c = candidates.get(candidate_id);
  if (!c) return;
  if (scores.drift_score !== undefined) c.drift_score = scores.drift_score;
  if (scores.slippage_score !== undefined) c.slippage_score = scores.slippage_score;
  if (scores.data_health_score !== undefined) c.data_health_score = scores.data_health_score;
  c.updated_at = new Date();
}

// ── Testing ──────────────────────────────────────────────────────

export function _clearAll(): void {
  candidates.clear();
  policies.clear();
  revocations.length = 0;
}
