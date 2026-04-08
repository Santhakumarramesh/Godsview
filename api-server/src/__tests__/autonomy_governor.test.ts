/**
 * Phase 22 — Autonomous Candidate Mode Tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../lib/risk_engine", () => ({
  isKillSwitchActive: () => false,
  setKillSwitchActive: () => ({}),
  getRiskEngineSnapshot: () => ({}),
}));
vi.mock("../lib/drawdown_breaker", () => ({
  getBreakerSnapshot: () => ({ sizeMultiplier: 1.0 }),
  isCooldownActive: () => false,
}));

import {
  registerCandidate,
  approveCandidate,
  activateCandidate,
  suspendCandidate,
  revokeCandidate,
  reinstateCandidate,
  runHealthCheck,
  checkEligibility,
  getCandidate,
  getAllCandidates,
  getRevocations,
  addPolicy,
  getPolicies,
  deactivatePolicy,
  updateHealthScores,
  _clearAll,
} from "../lib/autonomy/autonomy_governor";

beforeEach(() => {
  _clearAll();
});

describe("Candidate Registration", () => {
  it("registers a new candidate", () => {
    const result = registerCandidate({
      strategy_id: "strat_001",
      strategy_name: "Test Strategy",
      operator_id: "op_test",
    });
    expect(result.success).toBe(true);
    expect(result.candidate!.candidate_id).toMatch(/^auc_/);
    expect(result.candidate!.status).toBe("candidate");
    expect(result.candidate!.trust_tier).toBe("observation");
  });

  it("registers with custom constraints", () => {
    const result = registerCandidate({
      strategy_id: "strat_002",
      strategy_name: "Custom",
      operator_id: "op",
      max_daily_trades: 20,
      max_position_usd: 5000,
      trust_tier: "recommendation",
    });
    expect(result.candidate!.max_daily_trades).toBe(20);
    expect(result.candidate!.max_position_usd).toBe(5000);
    expect(result.candidate!.trust_tier).toBe("recommendation");
  });
});

describe("Candidate Lifecycle", () => {
  it("follows approval flow: candidate → approved → active", () => {
    const { candidate } = registerCandidate({ strategy_id: "s1", strategy_name: "T", operator_id: "op" });
    const cid = candidate!.candidate_id;

    const approved = approveCandidate(cid, "op");
    expect(approved.success).toBe(true);
    expect(approved.candidate!.status).toBe("approved");

    const activated = activateCandidate(cid);
    expect(activated.success).toBe(true);
    expect(activated.candidate!.status).toBe("active");
  });

  it("cannot activate without approval", () => {
    const { candidate } = registerCandidate({ strategy_id: "s2", strategy_name: "T", operator_id: "op" });
    const result = activateCandidate(candidate!.candidate_id);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Cannot activate");
  });

  it("suspends an active candidate", () => {
    const { candidate } = registerCandidate({ strategy_id: "s3", strategy_name: "T", operator_id: "op" });
    const cid = candidate!.candidate_id;
    approveCandidate(cid, "op");
    activateCandidate(cid);

    const result = suspendCandidate(cid, "manual test");
    expect(result.success).toBe(true);
    expect(result.candidate!.status).toBe("suspended");
  });

  it("cannot suspend a revoked candidate", () => {
    const { candidate } = registerCandidate({ strategy_id: "s4", strategy_name: "T", operator_id: "op" });
    const cid = candidate!.candidate_id;
    approveCandidate(cid, "op");
    activateCandidate(cid);
    revokeCandidate(cid, "system", "manual", "critical");

    const result = suspendCandidate(cid, "too late");
    expect(result.success).toBe(false);
  });
});

describe("Revocation", () => {
  it("revokes a candidate with audit trail", () => {
    const { candidate } = registerCandidate({ strategy_id: "s5", strategy_name: "T", operator_id: "op", trust_tier: "bounded_auto" });
    const cid = candidate!.candidate_id;
    approveCandidate(cid, "op");
    activateCandidate(cid);

    const result = revokeCandidate(cid, "system", "drift_breach", "critical", { drift: 0.1 });
    expect(result.success).toBe(true);
    expect(result.revocation!.trigger_type).toBe("drift_breach");
    expect(result.revocation!.previous_tier).toBe("bounded_auto");
    expect(result.revocation!.new_tier).toBe("observation");

    const c = getCandidate(cid)!;
    expect(c.status).toBe("revoked");
    expect(c.trust_tier).toBe("observation");
  });

  it("creates immutable revocation records", () => {
    const { candidate } = registerCandidate({ strategy_id: "s6", strategy_name: "T", operator_id: "op" });
    const cid = candidate!.candidate_id;
    approveCandidate(cid, "op");
    activateCandidate(cid);

    revokeCandidate(cid, "system", "slippage_breach", "warning");

    const revs = getRevocations(cid);
    expect(revs.length).toBe(1);
    expect(revs[0].severity).toBe("warning");
    expect(revs[0].metrics_at_revocation_json).toHaveProperty("drift_score");
  });

  it("reinstates a revoked candidate back to candidate status", () => {
    const { candidate } = registerCandidate({ strategy_id: "s7", strategy_name: "T", operator_id: "op" });
    const cid = candidate!.candidate_id;
    approveCandidate(cid, "op");
    activateCandidate(cid);
    revokeCandidate(cid, "system", "manual", "critical");

    const result = reinstateCandidate(cid, "op", "Issue resolved");
    expect(result.success).toBe(true);
    expect(result.candidate!.status).toBe("candidate"); // Must re-approve

    const revs = getRevocations(cid);
    expect(revs[0].reinstated).toBe(true);
    expect(revs[0].reinstated_by).toBe("op");
  });
});

describe("Auto-Demotion (Health Check)", () => {
  it("passes health check when all scores are good", () => {
    const { candidate } = registerCandidate({ strategy_id: "s8", strategy_name: "T", operator_id: "op" });
    const cid = candidate!.candidate_id;
    approveCandidate(cid, "op");
    activateCandidate(cid);

    const result = runHealthCheck(cid);
    expect(result.passed).toBe(true);
    expect(result.auto_revoked).toBe(false);
  });

  it("auto-revokes on drift deterioration", () => {
    const { candidate } = registerCandidate({ strategy_id: "s9", strategy_name: "T", operator_id: "op" });
    const cid = candidate!.candidate_id;
    approveCandidate(cid, "op");
    activateCandidate(cid);

    updateHealthScores(cid, { drift_score: 0.1 }); // Below 0.3 threshold

    const result = runHealthCheck(cid);
    expect(result.passed).toBe(false);
    expect(result.auto_revoked).toBe(true);
    expect(result.revocation_trigger).toBe("drift_breach");

    expect(getCandidate(cid)!.status).toBe("revoked");
  });

  it("auto-revokes on slippage deterioration", () => {
    const { candidate } = registerCandidate({ strategy_id: "s10", strategy_name: "T", operator_id: "op" });
    const cid = candidate!.candidate_id;
    approveCandidate(cid, "op");
    activateCandidate(cid);

    updateHealthScores(cid, { slippage_score: 0.1 });

    const result = runHealthCheck(cid);
    expect(result.auto_revoked).toBe(true);
    expect(result.revocation_trigger).toBe("slippage_breach");
  });

  it("auto-revokes on data truth failure", () => {
    const { candidate } = registerCandidate({ strategy_id: "s11", strategy_name: "T", operator_id: "op" });
    const cid = candidate!.candidate_id;
    approveCandidate(cid, "op");
    activateCandidate(cid);

    updateHealthScores(cid, { data_health_score: 0.2 });

    const result = runHealthCheck(cid);
    expect(result.auto_revoked).toBe(true);
    expect(result.revocation_trigger).toBe("data_truth_failure");
  });

  it("does not auto-revoke non-active candidates", () => {
    const { candidate } = registerCandidate({ strategy_id: "s12", strategy_name: "T", operator_id: "op" });
    const cid = candidate!.candidate_id;
    updateHealthScores(cid, { drift_score: 0.1 });

    const result = runHealthCheck(cid);
    expect(result.passed).toBe(false);
    expect(result.auto_revoked).toBe(false); // Not active, so no auto-revoke
  });
});

describe("Eligibility Check", () => {
  it("eligible when active with good scores", () => {
    const { candidate } = registerCandidate({ strategy_id: "s13", strategy_name: "T", operator_id: "op", trust_tier: "bounded_auto" });
    const cid = candidate!.candidate_id;
    approveCandidate(cid, "op");
    activateCandidate(cid);

    const result = checkEligibility(cid);
    expect(result.eligible).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it("not eligible when observation tier", () => {
    const { candidate } = registerCandidate({ strategy_id: "s14", strategy_name: "T", operator_id: "op", trust_tier: "observation" });
    const cid = candidate!.candidate_id;
    approveCandidate(cid, "op");
    activateCandidate(cid);

    const result = checkEligibility(cid);
    expect(result.eligible).toBe(false);
    expect(result.reasons.some((r) => r.includes("Observation tier"))).toBe(true);
  });

  it("not eligible when not active", () => {
    const { candidate } = registerCandidate({ strategy_id: "s15", strategy_name: "T", operator_id: "op" });
    const result = checkEligibility(candidate!.candidate_id);
    expect(result.eligible).toBe(false);
    expect(result.reasons.some((r) => r.includes("not 'active'"))).toBe(true);
  });
});

describe("Policy Management", () => {
  it("adds and queries policies", () => {
    const { candidate } = registerCandidate({ strategy_id: "s16", strategy_name: "T", operator_id: "op" });
    const cid = candidate!.candidate_id;

    const policy = addPolicy({
      candidate_id: cid,
      policy_type: "max_position_override",
      policy_value_json: { max_position_usd: 500 },
      reason: "Conservative start",
      created_by: "op",
    });

    expect(policy.policy_id).toMatch(/^pol_/);
    expect(policy.active).toBe(true);

    const pols = getPolicies(cid);
    expect(pols.length).toBe(1);
  });

  it("deactivates a policy", () => {
    const { candidate } = registerCandidate({ strategy_id: "s17", strategy_name: "T", operator_id: "op" });
    const cid = candidate!.candidate_id;

    const policy = addPolicy({
      candidate_id: cid,
      policy_type: "symbol_restrict",
      policy_value_json: { allowed: ["AAPL"] },
      reason: "Test",
      created_by: "op",
    });

    deactivatePolicy(policy.policy_id);
    const pols = getPolicies(cid);
    expect(pols.length).toBe(0);
  });
});

describe("Autonomy Scope Enforcement", () => {
  it("blocks autonomy outside approved scope (observation tier)", () => {
    const { candidate } = registerCandidate({ strategy_id: "s18", strategy_name: "T", operator_id: "op", trust_tier: "observation" });
    const cid = candidate!.candidate_id;
    approveCandidate(cid, "op");
    activateCandidate(cid);

    const elig = checkEligibility(cid);
    expect(elig.eligible).toBe(false);
  });

  it("allows bounded_auto tier to be eligible", () => {
    const { candidate } = registerCandidate({ strategy_id: "s19", strategy_name: "T", operator_id: "op", trust_tier: "bounded_auto" });
    const cid = candidate!.candidate_id;
    approveCandidate(cid, "op");
    activateCandidate(cid);

    const elig = checkEligibility(cid);
    expect(elig.eligible).toBe(true);
  });

  it("getAllCandidates filters by status", () => {
    registerCandidate({ strategy_id: "a", strategy_name: "A", operator_id: "op" });
    const { candidate: b } = registerCandidate({ strategy_id: "b", strategy_name: "B", operator_id: "op" });
    approveCandidate(b!.candidate_id, "op");

    expect(getAllCandidates("candidate").length).toBe(1);
    expect(getAllCandidates("approved").length).toBe(1);
    expect(getAllCandidates().length).toBe(2);
  });
});
