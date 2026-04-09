import { describe, it, expect, beforeEach } from "vitest";
import {
  stagingEnvironmentManager,
  launchChecklistEngine,
  goNoGoEngine,
  launchRehearsalEngine,
} from "../lib/launch_readiness/index.js";

describe("StagingEnvironmentManager", () => {
  beforeEach(() => {
    stagingEnvironmentManager._clearStagingEnvironmentManager();
  });

  it("should create a staging environment", () => {
    const envId = stagingEnvironmentManager.createStagingEnv({
      name: "staging-1",
      sourceEnv: "production",
      dataSnapshot: true,
      mockBroker: false,
      isolatedNetwork: true,
    });

    expect(envId).toMatch(/^stage_/);
    expect(envId.length).toBeGreaterThan(6);
  });

  it("should get a staging environment", () => {
    const envId = stagingEnvironmentManager.createStagingEnv({
      name: "staging-2",
      sourceEnv: "paper",
      dataSnapshot: false,
      mockBroker: true,
      isolatedNetwork: false,
    });

    const env = stagingEnvironmentManager.getStagingEnv(envId);
    expect(env).not.toBeNull();
    expect(env?.name).toBe("staging-2");
    expect(env?.sourceEnv).toBe("paper");
    expect(env?.status).toBe("provisioning");
  });

  it("should return null for non-existent environment", () => {
    const env = stagingEnvironmentManager.getStagingEnv("stage_nonexistent");
    expect(env).toBeNull();
  });

  it("should list all staging environments", () => {
    stagingEnvironmentManager.createStagingEnv({
      name: "env1",
      sourceEnv: "production",
      dataSnapshot: true,
      mockBroker: false,
      isolatedNetwork: true,
    });

    stagingEnvironmentManager.createStagingEnv({
      name: "env2",
      sourceEnv: "demo",
      dataSnapshot: false,
      mockBroker: true,
      isolatedNetwork: false,
    });

    const envs = stagingEnvironmentManager.listStagingEnvs();
    expect(envs.length).toBe(2);
    expect(envs.some((e) => e.name === "env1")).toBe(true);
    expect(envs.some((e) => e.name === "env2")).toBe(true);
  });

  it("should promote environment to production", () => {
    const envId = stagingEnvironmentManager.createStagingEnv({
      name: "promote-test",
      sourceEnv: "paper",
      dataSnapshot: true,
      mockBroker: false,
      isolatedNetwork: true,
    });

    const promoted = stagingEnvironmentManager.promoteToProd(envId);
    expect(promoted).not.toBeNull();
    expect(promoted?.status).toBe("promoted");
    expect(promoted?.promotionTime).toBeDefined();
  });

  it("should return null when promoting non-existent environment", () => {
    const result = stagingEnvironmentManager.promoteToProd("stage_nonexistent");
    expect(result).toBeNull();
  });

  it("should teardown environment", () => {
    const envId = stagingEnvironmentManager.createStagingEnv({
      name: "teardown-test",
      sourceEnv: "production",
      dataSnapshot: true,
      mockBroker: false,
      isolatedNetwork: true,
    });

    const terminated = stagingEnvironmentManager.teardownEnv(envId);
    expect(terminated).not.toBeNull();
    expect(terminated?.status).toBe("terminated");
  });

  it("should get staging health metrics", () => {
    const envId = stagingEnvironmentManager.createStagingEnv({
      name: "health-test",
      sourceEnv: "demo",
      dataSnapshot: false,
      mockBroker: true,
      isolatedNetwork: false,
    });

    const health = stagingEnvironmentManager.getStagingHealth(envId);
    expect(health).not.toBeNull();
    expect(health?.uptime).toBeGreaterThanOrEqual(0);
    expect(health?.errorRate).toBeGreaterThanOrEqual(0);
    expect(health?.errorRate).toBeLessThan(1);
    expect(health?.latency).toBeGreaterThanOrEqual(0);
    expect(health?.lastDeployTime).toBeDefined();
  });

  it("should return null for health of non-existent environment", () => {
    const health = stagingEnvironmentManager.getStagingHealth("stage_nonexistent");
    expect(health).toBeNull();
  });
});

describe("LaunchChecklistEngine", () => {
  beforeEach(() => {
    launchChecklistEngine._clearLaunchChecklistEngine();
  });

  it("should create a checklist", () => {
    const checklistId = launchChecklistEngine.createChecklist({
      name: "launch-checklist",
      launchType: "live_assisted",
      requiredGates: ["infrastructure", "security", "compliance"],
    });

    expect(checklistId).toMatch(/^chk_/);
  });

  it("should get a checklist", () => {
    const checklistId = launchChecklistEngine.createChecklist({
      name: "test-checklist",
      launchType: "paper_mode",
      requiredGates: [],
    });

    const checklist = launchChecklistEngine.getChecklist(checklistId);
    expect(checklist).not.toBeNull();
    expect(checklist?.name).toBe("test-checklist");
    expect(checklist?.launchType).toBe("paper_mode");
    expect(checklist?.gates.length).toBe(0);
  });

  it("should add a gate to checklist", () => {
    const checklistId = launchChecklistEngine.createChecklist({
      name: "gate-test",
      launchType: "live_autonomous",
      requiredGates: [],
    });

    const gateId = launchChecklistEngine.addGate(checklistId, {
      name: "infrastructure-check",
      category: "infrastructure",
      verifier: "automated",
      criticalPath: true,
    });

    expect(gateId).toMatch(/^gate_/);

    const checklist = launchChecklistEngine.getChecklist(checklistId);
    expect(checklist?.gates.length).toBe(1);
    expect(checklist?.gates[0].name).toBe("infrastructure-check");
    expect(checklist?.gates[0].category).toBe("infrastructure");
    expect(checklist?.gates[0].criticalPath).toBe(true);
    expect(checklist?.gates[0].status).toBe("pending");
  });

  it("should pass a gate", () => {
    const checklistId = launchChecklistEngine.createChecklist({
      name: "pass-gate-test",
      launchType: "full_production",
      requiredGates: [],
    });

    const gateId = launchChecklistEngine.addGate(checklistId, {
      name: "security-check",
      category: "security",
      verifier: "manual",
      criticalPath: false,
    });

    const gate = launchChecklistEngine.passGate(checklistId, gateId!, {
      verifiedBy: "admin@company.com",
      notes: "All security checks passed",
      artifacts: ["scan-report.pdf"],
    });

    expect(gate?.status).toBe("passed");
    expect(gate?.passedAt).toBeDefined();
    expect(gate?.evidence?.verifiedBy).toBe("admin@company.com");
    expect(gate?.evidence?.notes).toBe("All security checks passed");
  });

  it("should fail a gate", () => {
    const checklistId = launchChecklistEngine.createChecklist({
      name: "fail-gate-test",
      launchType: "live_assisted",
      requiredGates: [],
    });

    const gateId = launchChecklistEngine.addGate(checklistId, {
      name: "compliance-check",
      category: "compliance",
      verifier: "manual",
      criticalPath: true,
    });

    const gate = launchChecklistEngine.failGate(checklistId, gateId!, "Missing audit documentation");

    expect(gate?.status).toBe("failed");
    expect(gate?.failReason).toBe("Missing audit documentation");
  });

  it("should track checklist progress", () => {
    const checklistId = launchChecklistEngine.createChecklist({
      name: "progress-test",
      launchType: "paper_mode",
      requiredGates: [],
    });

    const gateId1 = launchChecklistEngine.addGate(checklistId, {
      name: "gate1",
      category: "infrastructure",
      verifier: "automated",
      criticalPath: true,
    });

    const gateId2 = launchChecklistEngine.addGate(checklistId, {
      name: "gate2",
      category: "security",
      verifier: "manual",
      criticalPath: true,
    });

    const gateId3 = launchChecklistEngine.addGate(checklistId, {
      name: "gate3",
      category: "data",
      verifier: "automated",
      criticalPath: false,
    });

    launchChecklistEngine.passGate(checklistId, gateId1!, {
      verifiedBy: "user1",
    });

    launchChecklistEngine.failGate(checklistId, gateId2!, "Test failure");

    const progress = launchChecklistEngine.getChecklistProgress(checklistId);
    expect(progress?.totalGates).toBe(3);
    expect(progress?.passed).toBe(1);
    expect(progress?.failed).toBe(1);
    expect(progress?.pending).toBe(1);
    expect(progress?.criticalPathBlocked).toBe(true);
    expect(progress?.readinessPercent).toBe(33);
  });

  it("should list all checklists", () => {
    launchChecklistEngine.createChecklist({
      name: "checklist1",
      launchType: "paper_mode",
      requiredGates: [],
    });

    launchChecklistEngine.createChecklist({
      name: "checklist2",
      launchType: "live_assisted",
      requiredGates: [],
    });

    const checklists = launchChecklistEngine.listChecklists();
    expect(checklists.length).toBe(2);
  });

  it("should return null for non-existent checklist gate operations", () => {
    const result = launchChecklistEngine.addGate("chk_nonexistent", {
      name: "test",
      category: "infrastructure",
      verifier: "automated",
      criticalPath: false,
    });

    expect(result).toBeNull();
  });

  it("should compute readiness percentage correctly", () => {
    const checklistId = launchChecklistEngine.createChecklist({
      name: "readiness-test",
      launchType: "full_production",
      requiredGates: [],
    });

    for (let i = 0; i < 10; i++) {
      launchChecklistEngine.addGate(checklistId, {
        name: `gate${i}`,
        category: "infrastructure",
        verifier: "automated",
        criticalPath: false,
      });
    }

    const gates = launchChecklistEngine.getChecklist(checklistId)?.gates || [];
    for (let i = 0; i < 7; i++) {
      launchChecklistEngine.passGate(checklistId, gates[i].gateId, {
        verifiedBy: "user",
      });
    }

    const progress = launchChecklistEngine.getChecklistProgress(checklistId);
    expect(progress?.readinessPercent).toBe(70);
  });
});

describe("GoNoGoEngine", () => {
  beforeEach(() => {
    goNoGoEngine._clearGoNoGoEngine();
  });

  it("should create a decision", () => {
    const decisionId = goNoGoEngine.createDecision({
      checklistId: "chk_123",
      scheduledLaunchTime: Date.now() + 3600000,
      decisionMakers: ["alice@company.com", "bob@company.com"],
      requiredApprovals: 2,
    });

    expect(decisionId).toMatch(/^gng_/);
  });

  it("should cast a vote", () => {
    const decisionId = goNoGoEngine.createDecision({
      checklistId: "chk_123",
      scheduledLaunchTime: Date.now(),
      decisionMakers: ["alice@company.com"],
      requiredApprovals: 1,
    });

    const voteId = goNoGoEngine.castVote(decisionId, "alice@company.com", "go");
    expect(voteId).toMatch(/^vote_/);

    const decision = goNoGoEngine.getDecision(decisionId);
    expect(decision?.votes.length).toBe(1);
    expect(decision?.votes[0].voter).toBe("alice@company.com");
    expect(decision?.votes[0].vote).toBe("go");
  });

  it("should handle conditional votes", () => {
    const decisionId = goNoGoEngine.createDecision({
      checklistId: "chk_123",
      scheduledLaunchTime: Date.now(),
      decisionMakers: ["alice@company.com", "bob@company.com"],
      requiredApprovals: 2,
    });

    goNoGoEngine.castVote(decisionId, "alice@company.com", "conditional", [
      "Only if monitoring is enabled",
      "Only if rollback is available",
    ]);

    const decision = goNoGoEngine.getDecision(decisionId);
    expect(decision?.votes[0].conditions).toContain("Only if monitoring is enabled");
  });

  it("should approve decision when required votes are met", () => {
    const decisionId = goNoGoEngine.createDecision({
      checklistId: "chk_123",
      scheduledLaunchTime: Date.now(),
      decisionMakers: ["alice@company.com", "bob@company.com"],
      requiredApprovals: 2,
    });

    goNoGoEngine.castVote(decisionId, "alice@company.com", "go");
    goNoGoEngine.castVote(decisionId, "bob@company.com", "go");

    const decision = goNoGoEngine.getDecision(decisionId);
    expect(decision?.status).toBe("approved");
  });

  it("should block decision on no_go vote", () => {
    const decisionId = goNoGoEngine.createDecision({
      checklistId: "chk_123",
      scheduledLaunchTime: Date.now(),
      decisionMakers: ["alice@company.com", "bob@company.com"],
      requiredApprovals: 2,
    });

    goNoGoEngine.castVote(decisionId, "alice@company.com", "go");
    goNoGoEngine.castVote(decisionId, "bob@company.com", "no_go");

    const decision = goNoGoEngine.getDecision(decisionId);
    expect(decision?.status).toBe("blocked");
  });

  it("should keep decision pending if not enough votes", () => {
    const decisionId = goNoGoEngine.createDecision({
      checklistId: "chk_123",
      scheduledLaunchTime: Date.now(),
      decisionMakers: ["alice@company.com", "bob@company.com"],
      requiredApprovals: 2,
    });

    goNoGoEngine.castVote(decisionId, "alice@company.com", "go");

    const decision = goNoGoEngine.getDecision(decisionId);
    expect(decision?.status).toBe("pending");
  });

  it("should finalize decision", () => {
    const decisionId = goNoGoEngine.createDecision({
      checklistId: "chk_123",
      scheduledLaunchTime: Date.now(),
      decisionMakers: ["alice@company.com"],
      requiredApprovals: 1,
    });

    goNoGoEngine.castVote(decisionId, "alice@company.com", "go");
    const finalized = goNoGoEngine.finalizeDecision(decisionId);

    expect(finalized?.status).toBe("locked");
    expect(finalized?.finalizedAt).toBeDefined();
  });

  it("should generate decision report", () => {
    const decisionId = goNoGoEngine.createDecision({
      checklistId: "chk_123",
      scheduledLaunchTime: Date.now(),
      decisionMakers: ["alice@company.com", "bob@company.com", "charlie@company.com"],
      requiredApprovals: 2,
    });

    goNoGoEngine.castVote(decisionId, "alice@company.com", "go");
    goNoGoEngine.castVote(decisionId, "bob@company.com", "no_go");
    goNoGoEngine.castVote(decisionId, "charlie@company.com", "conditional", [
      "If monitoring ready",
    ]);

    const report = goNoGoEngine.getDecisionReport(decisionId);
    expect(report?.votes.length).toBe(3);
    expect(report?.blockers).toContain("bob@company.com");
    expect(report?.conditions).toContain("If monitoring ready");
    expect(report?.recommendation).toBe("DO NOT LAUNCH");
  });

  it("should recommend launch when no blockers", () => {
    const decisionId = goNoGoEngine.createDecision({
      checklistId: "chk_123",
      scheduledLaunchTime: Date.now(),
      decisionMakers: ["alice@company.com"],
      requiredApprovals: 1,
    });

    goNoGoEngine.castVote(decisionId, "alice@company.com", "go");

    const report = goNoGoEngine.getDecisionReport(decisionId);
    expect(report?.recommendation).toBe("PROCEED WITH LAUNCH");
  });

  it("should list all decisions", () => {
    goNoGoEngine.createDecision({
      checklistId: "chk_123",
      scheduledLaunchTime: Date.now(),
      decisionMakers: ["alice@company.com"],
      requiredApprovals: 1,
    });

    goNoGoEngine.createDecision({
      checklistId: "chk_456",
      scheduledLaunchTime: Date.now(),
      decisionMakers: ["bob@company.com"],
      requiredApprovals: 1,
    });

    const decisions = goNoGoEngine.listDecisions();
    expect(decisions.length).toBe(2);
  });
});

describe("LaunchRehearsalEngine", () => {
  beforeEach(() => {
    launchRehearsalEngine._clearLaunchRehearsalEngine();
  });

  it("should create a rehearsal", () => {
    const rehearsalId = launchRehearsalEngine.createRehearsal({
      name: "normal launch",
      scenario: "normal_launch",
      checklistId: "chk_123",
    });

    expect(rehearsalId).toMatch(/^reh_/);
  });

  it("should get a rehearsal", () => {
    const rehearsalId = launchRehearsalEngine.createRehearsal({
      name: "test rehearsal",
      scenario: "rollback_drill",
    });

    const rehearsal = launchRehearsalEngine.getRehearsal(rehearsalId);
    expect(rehearsal).not.toBeNull();
    expect(rehearsal?.name).toBe("test rehearsal");
    expect(rehearsal?.scenario).toBe("rollback_drill");
    expect(rehearsal?.status).toBe("planned");
  });

  it("should execute a rehearsal with normal_launch scenario", () => {
    const rehearsalId = launchRehearsalEngine.createRehearsal({
      name: "normal launch",
      scenario: "normal_launch",
    });

    const rehearsal = launchRehearsalEngine.executeRehearsal(rehearsalId);
    expect(rehearsal?.status).toBe("executing");
    expect(rehearsal?.executedAt).toBeDefined();
    expect(rehearsal?.findings.length).toBeGreaterThan(0);
    expect(rehearsal?.findings[0].outcome).toBeDefined();
  });

  it("should execute rollback_drill scenario", () => {
    const rehearsalId = launchRehearsalEngine.createRehearsal({
      name: "rollback test",
      scenario: "rollback_drill",
    });

    const rehearsal = launchRehearsalEngine.executeRehearsal(rehearsalId);
    expect(rehearsal?.findings.length).toBeGreaterThan(0);
    expect(rehearsal?.findings.some((f) => f.step.includes("rollback"))).toBe(true);
  });

  it("should execute partial_failure scenario", () => {
    const rehearsalId = launchRehearsalEngine.createRehearsal({
      name: "partial failure test",
      scenario: "partial_failure",
    });

    const rehearsal = launchRehearsalEngine.executeRehearsal(rehearsalId);
    expect(rehearsal?.findings.some((f) => f.outcome === "degraded")).toBe(true);
  });

  it("should execute data_feed_loss scenario", () => {
    const rehearsalId = launchRehearsalEngine.createRehearsal({
      name: "data feed loss test",
      scenario: "data_feed_loss",
    });

    const rehearsal = launchRehearsalEngine.executeRehearsal(rehearsalId);
    expect(rehearsal?.findings.length).toBeGreaterThan(0);
  });

  it("should execute broker_disconnect scenario", () => {
    const rehearsalId = launchRehearsalEngine.createRehearsal({
      name: "broker disconnect test",
      scenario: "broker_disconnect",
    });

    const rehearsal = launchRehearsalEngine.executeRehearsal(rehearsalId);
    expect(rehearsal?.findings.length).toBeGreaterThan(0);
  });

  it("should execute peak_load scenario", () => {
    const rehearsalId = launchRehearsalEngine.createRehearsal({
      name: "peak load test",
      scenario: "peak_load",
    });

    const rehearsal = launchRehearsalEngine.executeRehearsal(rehearsalId);
    expect(rehearsal?.findings.some((f) => f.outcome === "degraded")).toBe(true);
  });

  it("should complete a rehearsal", () => {
    const rehearsalId = launchRehearsalEngine.createRehearsal({
      name: "completion test",
      scenario: "normal_launch",
    });

    launchRehearsalEngine.executeRehearsal(rehearsalId);

    const rehearsal = launchRehearsalEngine.completeRehearsal(rehearsalId, "pass", [
      "All systems responded well",
      "Deploy process smooth",
    ]);

    expect(rehearsal?.status).toBe("completed");
    expect(rehearsal?.completedAt).toBeDefined();
    expect(rehearsal?.overallResult).toBe("pass");
    expect(rehearsal?.lessons?.length).toBe(2);
  });

  it("should list all rehearsals", () => {
    launchRehearsalEngine.createRehearsal({
      name: "rehearsal1",
      scenario: "normal_launch",
    });

    launchRehearsalEngine.createRehearsal({
      name: "rehearsal2",
      scenario: "rollback_drill",
    });

    const rehearsals = launchRehearsalEngine.listRehearsals();
    expect(rehearsals.length).toBe(2);
  });

  it("should generate rehearsal report with pass rate", () => {
    const rehearsalId = launchRehearsalEngine.createRehearsal({
      name: "report test",
      scenario: "normal_launch",
    });

    launchRehearsalEngine.executeRehearsal(rehearsalId);
    launchRehearsalEngine.completeRehearsal(rehearsalId, "pass", [
      "Lesson 1",
      "Lesson 2",
    ]);

    const report = launchRehearsalEngine.getRehearsalReport(rehearsalId);
    expect(report?.passRate).toBeGreaterThan(0);
    expect(report?.passRate).toBeLessThanOrEqual(100);
    expect(report?.lessonsLearned.length).toBe(2);
    expect(report?.readinessImpact).toBeDefined();
  });

  it("should compute readiness impact based on pass rate", () => {
    const rehearsalId = launchRehearsalEngine.createRehearsal({
      name: "readiness test",
      scenario: "normal_launch",
    });

    launchRehearsalEngine.executeRehearsal(rehearsalId);
    launchRehearsalEngine.completeRehearsal(rehearsalId, "pass", []);

    const report = launchRehearsalEngine.getRehearsalReport(rehearsalId);
    if (report!.passRate >= 80) {
      expect(report?.readinessImpact).toBe("Ready for production");
    } else {
      expect(report?.readinessImpact).toBe("Additional testing required");
    }
  });

  it("should track findings with outcomes and durations", () => {
    const rehearsalId = launchRehearsalEngine.createRehearsal({
      name: "findings test",
      scenario: "normal_launch",
    });

    const rehearsal = launchRehearsalEngine.executeRehearsal(rehearsalId);
    const findings = rehearsal?.findings || [];

    findings.forEach((finding) => {
      expect(finding.step).toBeDefined();
      expect(["pass", "fail", "degraded"]).toContain(finding.outcome);
      expect(finding.notes).toBeDefined();
      expect(finding.duration).toBeGreaterThan(0);
    });
  });

  it("should return null for non-existent rehearsal", () => {
    const report = launchRehearsalEngine.getRehearsalReport("reh_nonexistent");
    expect(report).toBeNull();
  });
});

describe("Integration Tests", () => {
  beforeEach(() => {
    stagingEnvironmentManager._clearStagingEnvironmentManager();
    launchChecklistEngine._clearLaunchChecklistEngine();
    goNoGoEngine._clearGoNoGoEngine();
    launchRehearsalEngine._clearLaunchRehearsalEngine();
  });

  it("should execute full launch workflow", () => {
    // Create staging environment
    const envId = stagingEnvironmentManager.createStagingEnv({
      name: "prod-staging",
      sourceEnv: "production",
      dataSnapshot: true,
      mockBroker: false,
      isolatedNetwork: true,
    });

    // Create checklist
    const checklistId = launchChecklistEngine.createChecklist({
      name: "prod-launch",
      launchType: "live_assisted",
      requiredGates: ["infrastructure", "security", "compliance"],
    });

    // Add gates
    const infra = launchChecklistEngine.addGate(checklistId, {
      name: "Infrastructure Ready",
      category: "infrastructure",
      verifier: "automated",
      criticalPath: true,
    });

    const security = launchChecklistEngine.addGate(checklistId, {
      name: "Security Scan",
      category: "security",
      verifier: "manual",
      criticalPath: true,
    });

    const compliance = launchChecklistEngine.addGate(checklistId, {
      name: "Compliance Check",
      category: "compliance",
      verifier: "manual",
      criticalPath: false,
    });

    // Pass gates
    launchChecklistEngine.passGate(checklistId, infra!, {
      verifiedBy: "automation",
    });

    launchChecklistEngine.passGate(checklistId, security!, {
      verifiedBy: "security-lead@company.com",
      notes: "All security checks passed",
    });

    launchChecklistEngine.passGate(checklistId, compliance!, {
      verifiedBy: "compliance-officer@company.com",
    });

    // Check progress
    const progress = launchChecklistEngine.getChecklistProgress(checklistId);
    expect(progress?.readinessPercent).toBe(100);
    expect(progress?.criticalPathBlocked).toBe(false);

    // Create go/no-go decision
    const decisionId = goNoGoEngine.createDecision({
      checklistId,
      scheduledLaunchTime: Date.now() + 3600000,
      decisionMakers: ["cto@company.com", "vp-eng@company.com"],
      requiredApprovals: 2,
    });

    // Cast votes
    goNoGoEngine.castVote(decisionId, "cto@company.com", "go");
    goNoGoEngine.castVote(decisionId, "vp-eng@company.com", "go");

    // Finalize decision
    const decision = goNoGoEngine.finalizeDecision(decisionId);
    expect(decision?.status).toBe("locked");

    // Promote environment
    const promoted = stagingEnvironmentManager.promoteToProd(envId);
    expect(promoted?.status).toBe("promoted");

    // Verify complete flow
    const finalChecklist = launchChecklistEngine.getChecklist(checklistId);
    expect(finalChecklist?.gates.every((g) => g.status === "passed")).toBe(true);
  });

  it("should handle failed gate and block launch", () => {
    const checklistId = launchChecklistEngine.createChecklist({
      name: "blocked-launch",
      launchType: "full_production",
      requiredGates: [],
    });

    const criticalGate = launchChecklistEngine.addGate(checklistId, {
      name: "Critical Security",
      category: "security",
      verifier: "manual",
      criticalPath: true,
    });

    launchChecklistEngine.failGate(checklistId, criticalGate!, "Vulnerabilities found");

    const progress = launchChecklistEngine.getChecklistProgress(checklistId);
    expect(progress?.criticalPathBlocked).toBe(true);

    // Try go/no-go despite blockers
    const decisionId = goNoGoEngine.createDecision({
      checklistId,
      scheduledLaunchTime: Date.now(),
      decisionMakers: ["lead@company.com"],
      requiredApprovals: 1,
    });

    goNoGoEngine.castVote(decisionId, "lead@company.com", "go");
    const decision = goNoGoEngine.finalizeDecision(decisionId);
    expect(decision?.status).toBe("locked");
  });
});
