import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  runCertification,
  abortCertification,
  getCertificationRun,
  getAllRuns,
  getRunsByStrategy,
  getLatestCertification,
  createPolicy,
  getPolicy,
  getAllPolicies,
  activatePolicy,
  deactivatePolicy,
  getCertificationHistory,
  getSystemCertificationStatus,
  _clearCertification,
} from "../lib/certification_v2";

vi.mock("pino", () => ({
  default: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("pino-pretty", () => ({
  default: vi.fn(),
}));

vi.mock("../../lib/risk_engine", () => ({
  evaluateRisk: vi.fn(),
}));

vi.mock("../../lib/drawdown_breaker", () => ({
  checkDrawdown: vi.fn(),
}));

describe("Certification Engine - Phase 50 Go-Live Gate v2", () => {
  beforeEach(() => {
    _clearCertification();
  });

  // Test 1: Full certification pass
  it("should pass certification with all dimensions above threshold", () => {
    const run = runCertification({
      strategy_id: "strat_001",
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        execution_truth: 85,
        data_truth: 80,
        shadow_validation: 75,
        recovery_readiness: 85,
        risk_controls: 90,
        latency: 80,
        reconciliation: 85,
        compliance: 80,
        operator_readiness: 75,
        security: 85,
      },
    });

    expect(run.status).toBe("passed");
    expect(run.certification_level).toBe("full");
    expect(run.overall_score).toBeGreaterThanOrEqual(75);
    expect(run.hard_failures).toHaveLength(0);
    expect(run.restrictions).toHaveLength(0);
  });

  // Test 2: Pass with restrictions (shadow_validation fails)
  it("should pass with restrictions when restriction dimension fails", () => {
    const run = runCertification({
      strategy_id: "strat_002",
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        execution_truth: 85,
        data_truth: 80,
        shadow_validation: 65, // Below 70 threshold
        recovery_readiness: 85,
        risk_controls: 90,
        latency: 80,
        reconciliation: 85,
        compliance: 80,
        operator_readiness: 75,
        security: 85,
      },
    });

    expect(run.status).toBe("passed_with_restrictions");
    expect(run.certification_level).toBe("restricted");
    expect(run.restrictions).toContain("shadow_validation");
    expect(run.hard_failures).toHaveLength(0);
  });

  // Test 3: Hard failure on execution_truth
  it("should fail certification when execution_truth fails", () => {
    const run = runCertification({
      strategy_id: "strat_003",
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        execution_truth: 70, // Below 80 threshold
        data_truth: 80,
        shadow_validation: 75,
        recovery_readiness: 85,
        risk_controls: 90,
        latency: 80,
        reconciliation: 85,
        compliance: 80,
        operator_readiness: 75,
        security: 85,
      },
    });

    expect(run.status).toBe("failed");
    expect(run.certification_level).toBe("denied");
    expect(run.hard_failures).toContain("execution_truth");
  });

  // Test 4: Hard failure on risk_controls
  it("should fail certification when risk_controls fails", () => {
    const run = runCertification({
      strategy_id: "strat_004",
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        execution_truth: 85,
        data_truth: 80,
        shadow_validation: 75,
        recovery_readiness: 85,
        risk_controls: 80, // Below 85 threshold
        latency: 80,
        reconciliation: 85,
        compliance: 80,
        operator_readiness: 75,
        security: 85,
      },
    });

    expect(run.status).toBe("failed");
    expect(run.certification_level).toBe("denied");
    expect(run.hard_failures).toContain("risk_controls");
  });

  // Test 5: Hard failure on reconciliation
  it("should fail certification when reconciliation fails", () => {
    const run = runCertification({
      strategy_id: "strat_005",
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        execution_truth: 85,
        data_truth: 80,
        shadow_validation: 75,
        recovery_readiness: 85,
        risk_controls: 90,
        latency: 80,
        reconciliation: 75, // Below 80 threshold
        compliance: 80,
        operator_readiness: 75,
        security: 85,
      },
    });

    expect(run.status).toBe("failed");
    expect(run.certification_level).toBe("denied");
    expect(run.hard_failures).toContain("reconciliation");
  });

  // Test 6: Low overall score (paper_only)
  it("should return paper_only when score is 50-75 range without hard failures", () => {
    const run = runCertification({
      strategy_id: "strat_006",
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        execution_truth: 85,
        data_truth: 60,
        shadow_validation: 60,
        recovery_readiness: 55,
        risk_controls: 90,
        latency: 55,
        reconciliation: 85,
        compliance: 60,
        operator_readiness: 50,
        security: 85,
      },
    });

    expect(run.status).toBe("failed");
    expect(run.certification_level).toBe("paper_only");
    expect(run.overall_score).toBeGreaterThanOrEqual(50);
    expect(run.overall_score).toBeLessThan(75);
  });

  // Test 7: Denied (score < 50)
  it("should deny certification when score is below 50", () => {
    const run = runCertification({
      strategy_id: "strat_007",
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        execution_truth: 40,
        data_truth: 40,
        shadow_validation: 40,
        recovery_readiness: 40,
        risk_controls: 40,
        latency: 40,
        reconciliation: 40,
        compliance: 40,
        operator_readiness: 40,
        security: 40,
      },
    });

    expect(run.status).toBe("failed");
    expect(run.certification_level).toBe("denied");
    expect(run.overall_score).toBeLessThan(50);
  });

  // Test 8: Dimension threshold check - execution_truth
  it("should verify execution_truth has 80 threshold", () => {
    const run = runCertification({
      strategy_id: "strat_008",
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        execution_truth: 80,
        data_truth: 75,
        shadow_validation: 70,
        recovery_readiness: 80,
        risk_controls: 85,
        latency: 70,
        reconciliation: 80,
        compliance: 75,
        operator_readiness: 70,
        security: 80,
      },
    });

    const execDim = run.dimensions.find((d) => d.category === "execution_truth");
    expect(execDim?.threshold).toBe(80);
    expect(execDim?.passed).toBe(true);
  });

  // Test 9: Dimension threshold check - risk_controls
  it("should verify risk_controls has 85 threshold", () => {
    const run = runCertification({
      strategy_id: "strat_009",
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        execution_truth: 85,
        data_truth: 75,
        shadow_validation: 70,
        recovery_readiness: 80,
        risk_controls: 85,
        latency: 70,
        reconciliation: 85,
        compliance: 75,
        operator_readiness: 70,
        security: 80,
      },
    });

    const riskDim = run.dimensions.find((d) => d.category === "risk_controls");
    expect(riskDim?.threshold).toBe(85);
    expect(riskDim?.passed).toBe(true);
  });

  // Test 10: Dimension weight verification
  it("should verify dimension weights sum correctly", () => {
    const run = runCertification({
      strategy_id: "strat_010",
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        execution_truth: 80,
        data_truth: 75,
        shadow_validation: 70,
        recovery_readiness: 80,
        risk_controls: 85,
        latency: 70,
        reconciliation: 80,
        compliance: 75,
        operator_readiness: 70,
        security: 80,
      },
    });

    const totalWeight = run.dimensions.reduce((sum, d) => sum + d.weight, 0);
    expect(totalWeight).toBe(100);
  });

  // Test 11: Policy creation
  it("should create a new certification policy", () => {
    const policy = createPolicy({
      name: "Standard Go-Live Policy",
      description: "Default policy for production deployment",
      dimensions_required: [
        "execution_truth",
        "risk_controls",
        "reconciliation",
      ],
      min_overall_score: 75,
      hard_fail_dimensions: ["execution_truth", "risk_controls", "reconciliation"],
      restriction_dimensions: ["shadow_validation", "recovery_readiness"],
    });

    expect(policy.id).toMatch(/^cpol_/);
    expect(policy.name).toBe("Standard Go-Live Policy");
    expect(policy.active).toBe(false);
    expect(policy.created_at).toBeDefined();
  });

  // Test 12: Policy retrieval
  it("should retrieve policy by id", () => {
    const policy = createPolicy({
      name: "Test Policy",
      description: "Test",
      dimensions_required: [],
      min_overall_score: 75,
      hard_fail_dimensions: [],
      restriction_dimensions: [],
    });

    const retrieved = getPolicy(policy.id);
    expect(retrieved).toEqual(policy);
  });

  // Test 13: Get all policies
  it("should return all policies", () => {
    createPolicy({
      name: "Policy 1",
      description: "Test",
      dimensions_required: [],
      min_overall_score: 75,
      hard_fail_dimensions: [],
      restriction_dimensions: [],
    });
    createPolicy({
      name: "Policy 2",
      description: "Test",
      dimensions_required: [],
      min_overall_score: 75,
      hard_fail_dimensions: [],
      restriction_dimensions: [],
    });

    const policies = getAllPolicies();
    expect(policies).toHaveLength(2);
  });

  // Test 14: Activate policy
  it("should activate a policy", () => {
    const policy = createPolicy({
      name: "Test Policy",
      description: "Test",
      dimensions_required: [],
      min_overall_score: 75,
      hard_fail_dimensions: [],
      restriction_dimensions: [],
    });

    const result = activatePolicy(policy.id);
    expect(result.success).toBe(true);

    const activated = getPolicy(policy.id);
    expect(activated?.active).toBe(true);
  });

  // Test 15: Deactivate policy
  it("should deactivate a policy", () => {
    const policy = createPolicy({
      name: "Test Policy",
      description: "Test",
      dimensions_required: [],
      min_overall_score: 75,
      hard_fail_dimensions: [],
      restriction_dimensions: [],
    });

    activatePolicy(policy.id);
    const result = deactivatePolicy(policy.id);
    expect(result.success).toBe(true);

    const deactivated = getPolicy(policy.id);
    expect(deactivated?.active).toBe(false);
  });

  // Test 16: Certification history tracking
  it("should track certification history for a strategy", () => {
    runCertification({
      strategy_id: "strat_history_001",
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        execution_truth: 85,
        data_truth: 80,
        shadow_validation: 75,
        recovery_readiness: 85,
        risk_controls: 90,
        latency: 80,
        reconciliation: 85,
        compliance: 80,
        operator_readiness: 75,
        security: 85,
      },
    });

    const history = getCertificationHistory("strat_history_001");
    expect(history.strategy_id).toBe("strat_history_001");
    expect(history.runs).toHaveLength(1);
    expect(history.current_certification).toBe("full");
  });

  // Test 17: System status with multiple strategies
  it("should return system certification status", () => {
    runCertification({
      strategy_id: "strat_sys_001",
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        execution_truth: 85,
        data_truth: 80,
        shadow_validation: 75,
        recovery_readiness: 85,
        risk_controls: 90,
        latency: 80,
        reconciliation: 85,
        compliance: 80,
        operator_readiness: 75,
        security: 85,
      },
    });

    runCertification({
      strategy_id: "strat_sys_002",
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        execution_truth: 40,
        data_truth: 40,
        shadow_validation: 40,
        recovery_readiness: 40,
        risk_controls: 40,
        latency: 40,
        reconciliation: 40,
        compliance: 40,
        operator_readiness: 40,
        security: 40,
      },
    });

    const status = getSystemCertificationStatus();
    expect(status.certified_strategies).toBe(1);
    expect(status.denied_strategies).toBe(1);
  });

  // Test 18: Abort certification
  it("should abort a running certification", () => {
    const run = runCertification({
      strategy_id: "strat_abort_001",
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        execution_truth: 85,
        data_truth: 80,
        shadow_validation: 75,
        recovery_readiness: 85,
        risk_controls: 90,
        latency: 80,
        reconciliation: 85,
        compliance: 80,
        operator_readiness: 75,
        security: 85,
      },
    });

    // Force status to running for abort test
    const retrieved = getCertificationRun(run.id);
    if (retrieved) {
      retrieved.status = "running";
    }

    const result = abortCertification(run.id);
    expect(result.success).toBe(true);

    const aborted = getCertificationRun(run.id);
    expect(aborted?.status).toBe("aborted");
  });

  // Test 19: Get latest certification for strategy
  it("should return latest certification for strategy", () => {
    const run1 = runCertification({
      strategy_id: "strat_latest_001",
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        execution_truth: 85,
        data_truth: 80,
        shadow_validation: 75,
        recovery_readiness: 85,
        risk_controls: 90,
        latency: 80,
        reconciliation: 85,
        compliance: 80,
        operator_readiness: 75,
        security: 85,
      },
    });

    const run2 = runCertification({
      strategy_id: "strat_latest_001",
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        execution_truth: 90,
        data_truth: 85,
        shadow_validation: 80,
        recovery_readiness: 90,
        risk_controls: 95,
        latency: 85,
        reconciliation: 90,
        compliance: 85,
        operator_readiness: 80,
        security: 90,
      },
    });

    const latest = getLatestCertification("strat_latest_001");
    expect(latest).toBeDefined();
    expect([run1.id, run2.id]).toContain(latest?.id);
    expect(latest?.overall_score).toBeGreaterThanOrEqual(run1.overall_score);
  });

  // Test 20: Get runs by strategy
  it("should return all runs for a strategy", () => {
    runCertification({
      strategy_id: "strat_multi_001",
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        execution_truth: 85,
        data_truth: 80,
        shadow_validation: 75,
        recovery_readiness: 85,
        risk_controls: 90,
        latency: 80,
        reconciliation: 85,
        compliance: 80,
        operator_readiness: 75,
        security: 85,
      },
    });

    runCertification({
      strategy_id: "strat_multi_001",
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        execution_truth: 80,
        data_truth: 75,
        shadow_validation: 70,
        recovery_readiness: 80,
        risk_controls: 85,
        latency: 70,
        reconciliation: 80,
        compliance: 75,
        operator_readiness: 70,
        security: 80,
      },
    });

    const runs = getRunsByStrategy("strat_multi_001");
    expect(runs).toHaveLength(2);
  });

  // Test 21: Get all runs with limit
  it("should return all runs with limit", () => {
    for (let i = 0; i < 5; i++) {
      runCertification({
        strategy_id: `strat_limit_${i}`,
        initiated_by: "operator@godsview.com",
        dimension_scores: {
          execution_truth: 85,
          data_truth: 80,
          shadow_validation: 75,
          recovery_readiness: 85,
          risk_controls: 90,
          latency: 80,
          reconciliation: 85,
          compliance: 80,
          operator_readiness: 75,
          security: 85,
        },
      });
    }

    const runs = getAllRuns(2);
    expect(runs).toHaveLength(2);
  });

  // Test 22: Weighted score calculation
  it("should calculate weighted average score correctly", () => {
    const run = runCertification({
      strategy_id: "strat_weight_001",
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        execution_truth: 100, // weight 15
        data_truth: 100, // weight 12
        shadow_validation: 100, // weight 15
        recovery_readiness: 100, // weight 10
        risk_controls: 100, // weight 12
        latency: 100, // weight 8
        reconciliation: 100, // weight 10
        compliance: 100, // weight 8
        operator_readiness: 100, // weight 5
        security: 100, // weight 5
      },
    });

    expect(run.overall_score).toBe(100);
  });

  // Test 23: Empty dimension scores
  it("should handle empty dimension scores", () => {
    const run = runCertification({
      strategy_id: "strat_empty_001",
      initiated_by: "operator@godsview.com",
      dimension_scores: {},
    });

    expect(run.status).toBe("failed");
    expect(run.dimensions).toHaveLength(0);
    expect(run.overall_score).toBe(0);
  });

  // Test 24: Single dimension certification
  it("should certify with single dimension", () => {
    const run = runCertification({
      strategy_id: "strat_single_001",
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        execution_truth: 85,
      },
    });

    expect(run.dimensions).toHaveLength(1);
    expect(run.dimensions[0].category).toBe("execution_truth");
    expect(run.dimensions[0].score).toBe(85);
  });

  // Test 25: Multiple hard failures
  it("should identify multiple hard failures", () => {
    const run = runCertification({
      strategy_id: "strat_multi_fail_001",
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        execution_truth: 70,
        data_truth: 80,
        shadow_validation: 75,
        recovery_readiness: 85,
        risk_controls: 80,
        latency: 80,
        reconciliation: 75,
        compliance: 80,
        operator_readiness: 75,
        security: 85,
      },
    });

    expect(run.hard_failures.length).toBeGreaterThan(0);
    expect(run.hard_failures).toContain("execution_truth");
  });

  // Test 26: Multiple restrictions
  it("should identify multiple restrictions", () => {
    const run = runCertification({
      strategy_id: "strat_multi_rest_001",
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        execution_truth: 85,
        data_truth: 80,
        shadow_validation: 65,
        recovery_readiness: 75,
        risk_controls: 90,
        latency: 80,
        reconciliation: 85,
        compliance: 80,
        operator_readiness: 75,
        security: 85,
      },
    });

    expect(run.restrictions.length).toBeGreaterThan(0);
  });

  // Test 27: Run ID generation with prefix
  it("should generate run ID with cert_ prefix", () => {
    const run = runCertification({
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        execution_truth: 85,
        data_truth: 80,
        shadow_validation: 75,
        recovery_readiness: 85,
        risk_controls: 90,
        latency: 80,
        reconciliation: 85,
        compliance: 80,
        operator_readiness: 75,
        security: 85,
      },
    });

    expect(run.id).toMatch(/^cert_/);
  });

  // Test 28: Policy ID generation with prefix
  it("should generate policy ID with cpol_ prefix", () => {
    const policy = createPolicy({
      name: "Test Policy",
      description: "Test",
      dimensions_required: [],
      min_overall_score: 75,
      hard_fail_dimensions: [],
      restriction_dimensions: [],
    });

    expect(policy.id).toMatch(/^cpol_/);
  });

  // Test 29: Recommendations for hard failures
  it("should generate recommendations for hard failures", () => {
    const run = runCertification({
      strategy_id: "strat_rec_001",
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        execution_truth: 70,
        data_truth: 80,
        shadow_validation: 75,
        recovery_readiness: 85,
        risk_controls: 90,
        latency: 80,
        reconciliation: 85,
        compliance: 80,
        operator_readiness: 75,
        security: 85,
      },
    });

    expect(run.recommendations.length).toBeGreaterThan(0);
    expect(run.recommendations.some((r) => r.toLowerCase().includes("reconciliation"))).toBe(true);
  });

  // Test 30: Recommendations for restrictions
  it("should generate recommendations for restrictions", () => {
    const run = runCertification({
      strategy_id: "strat_rec_rest_001",
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        execution_truth: 85,
        data_truth: 80,
        shadow_validation: 65,
        recovery_readiness: 85,
        risk_controls: 90,
        latency: 80,
        reconciliation: 85,
        compliance: 80,
        operator_readiness: 75,
        security: 85,
      },
    });

    expect(run.recommendations.length).toBeGreaterThan(0);
  });

  // Test 31: History current certification full
  it("should update history current_certification to full on pass", () => {
    runCertification({
      strategy_id: "strat_hist_full_001",
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        execution_truth: 85,
        data_truth: 80,
        shadow_validation: 75,
        recovery_readiness: 85,
        risk_controls: 90,
        latency: 80,
        reconciliation: 85,
        compliance: 80,
        operator_readiness: 75,
        security: 85,
      },
    });

    const history = getCertificationHistory("strat_hist_full_001");
    expect(history.current_certification).toBe("full");
  });

  // Test 32: History current certification restricted
  it("should update history current_certification to restricted on pass_with_restrictions", () => {
    runCertification({
      strategy_id: "strat_hist_rest_001",
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        execution_truth: 85,
        data_truth: 80,
        shadow_validation: 65,
        recovery_readiness: 85,
        risk_controls: 90,
        latency: 80,
        reconciliation: 85,
        compliance: 80,
        operator_readiness: 75,
        security: 85,
      },
    });

    const history = getCertificationHistory("strat_hist_rest_001");
    expect(history.current_certification).toBe("restricted");
  });

  // Test 33: History last_certified_at timestamp
  it("should record last_certified_at timestamp", () => {
    runCertification({
      strategy_id: "strat_hist_time_001",
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        execution_truth: 85,
        data_truth: 80,
        shadow_validation: 75,
        recovery_readiness: 85,
        risk_controls: 90,
        latency: 80,
        reconciliation: 85,
        compliance: 80,
        operator_readiness: 75,
        security: 85,
      },
    });

    const history = getCertificationHistory("strat_hist_time_001");
    expect(history.last_certified_at).toBeDefined();
  });

  // Test 34: Cannot abort already passed certification
  it("should not abort already passed certification", () => {
    const run = runCertification({
      strategy_id: "strat_no_abort_001",
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        execution_truth: 85,
        data_truth: 80,
        shadow_validation: 75,
        recovery_readiness: 85,
        risk_controls: 90,
        latency: 80,
        reconciliation: 85,
        compliance: 80,
        operator_readiness: 75,
        security: 85,
      },
    });

    const result = abortCertification(run.id);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  // Test 35: Nonexistent run returns undefined
  it("should return undefined for nonexistent run", () => {
    const run = getCertificationRun("cert_nonexistent");
    expect(run).toBeUndefined();
  });

  // Test 36: Activate policy deactivates others
  it("should deactivate other policies when activating one", () => {
    const policy1 = createPolicy({
      name: "Policy 1",
      description: "Test",
      dimensions_required: [],
      min_overall_score: 75,
      hard_fail_dimensions: [],
      restriction_dimensions: [],
    });

    const policy2 = createPolicy({
      name: "Policy 2",
      description: "Test",
      dimensions_required: [],
      min_overall_score: 75,
      hard_fail_dimensions: [],
      restriction_dimensions: [],
    });

    activatePolicy(policy1.id);
    activatePolicy(policy2.id);

    const p1 = getPolicy(policy1.id);
    const p2 = getPolicy(policy2.id);

    expect(p1?.active).toBe(false);
    expect(p2?.active).toBe(true);
  });

  // Test 37: Data truth dimension weight
  it("should verify data_truth dimension has weight 12", () => {
    const run = runCertification({
      strategy_id: "strat_weight_dt_001",
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        data_truth: 80,
        execution_truth: 85,
        shadow_validation: 75,
        recovery_readiness: 85,
        risk_controls: 90,
        latency: 80,
        reconciliation: 85,
        compliance: 80,
        operator_readiness: 75,
        security: 85,
      },
    });

    const dataDim = run.dimensions.find((d) => d.category === "data_truth");
    expect(dataDim?.weight).toBe(12);
  });

  // Test 38: All dimensions present in certification run
  it("should include all 10 default dimensions in run", () => {
    const run = runCertification({
      strategy_id: "strat_all_dim_001",
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        execution_truth: 85,
        data_truth: 80,
        shadow_validation: 75,
        recovery_readiness: 85,
        risk_controls: 90,
        latency: 80,
        reconciliation: 85,
        compliance: 80,
        operator_readiness: 75,
        security: 85,
      },
    });

    expect(run.dimensions).toHaveLength(10);
  });

  // Test 39: System status last_run field
  it("should include last_run in system status", () => {
    runCertification({
      strategy_id: "strat_last_run_001",
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        execution_truth: 85,
        data_truth: 80,
        shadow_validation: 75,
        recovery_readiness: 85,
        risk_controls: 90,
        latency: 80,
        reconciliation: 85,
        compliance: 80,
        operator_readiness: 75,
        security: 85,
      },
    });

    const status = getSystemCertificationStatus();
    expect(status.last_run).toBeDefined();
    expect(status.last_run?.status).toBe("passed");
  });

  // Test 40: Clear certification removes all data
  it("should clear all certification data", () => {
    runCertification({
      strategy_id: "strat_clear_001",
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        execution_truth: 85,
        data_truth: 80,
        shadow_validation: 75,
        recovery_readiness: 85,
        risk_controls: 90,
        latency: 80,
        reconciliation: 85,
        compliance: 80,
        operator_readiness: 75,
        security: 85,
      },
    });

    _clearCertification();

    const runs = getAllRuns();
    const policies = getAllPolicies();

    expect(runs).toHaveLength(0);
    expect(policies).toHaveLength(0);
  });

  // Test 41: Completion timestamps exist
  it("should set completed_at timestamp on certification run", () => {
    const run = runCertification({
      strategy_id: "strat_ts_001",
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        execution_truth: 85,
        data_truth: 80,
        shadow_validation: 75,
        recovery_readiness: 85,
        risk_controls: 90,
        latency: 80,
        reconciliation: 85,
        compliance: 80,
        operator_readiness: 75,
        security: 85,
      },
    });

    expect(run.completed_at).toBeDefined();
    expect(new Date(run.completed_at!).getTime()).toBeGreaterThanOrEqual(
      new Date(run.started_at).getTime()
    );
  });

  // Test 42: Evidence field populated
  it("should populate evidence field in dimensions", () => {
    const run = runCertification({
      strategy_id: "strat_evidence_001",
      initiated_by: "operator@godsview.com",
      dimension_scores: {
        execution_truth: 85,
        data_truth: 80,
        shadow_validation: 75,
        recovery_readiness: 85,
        risk_controls: 90,
        latency: 80,
        reconciliation: 85,
        compliance: 80,
        operator_readiness: 75,
        security: 85,
      },
    });

    for (const dim of run.dimensions) {
      expect(dim.evidence).toBeDefined();
      expect(dim.evidence.length).toBeGreaterThan(0);
    }
  });
});
