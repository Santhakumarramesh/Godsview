import { describe, it, expect, beforeEach, vi } from "vitest";
import { deployController } from "../lib/deploy_pipeline";

vi.mock("pino", () => ({ default: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) }));
vi.mock("pino-pretty", () => ({ default: vi.fn() }));
vi.mock("../../lib/risk_engine", () => ({ evaluateRisk: vi.fn() }));
vi.mock("../../lib/drawdown_breaker", () => ({ checkDrawdown: vi.fn() }));

describe("Deploy Pipeline Controller", () => {
  beforeEach(() => {
    deployController._clearDeploy();
  });

  describe("createRelease", () => {
    it("should create a new release", () => {
      const result = deployController.createRelease("1.0.0", "v1.0.0", "user1", ["feat: new feature"], "staging");
      expect(result.success).toBe(true);
      expect(result.data?.version).toBe("1.0.0");
      expect(result.data?.status).toBe("draft");
      expect(result.data?.environment).toBe("staging");
    });

    it("should initialize with all standard gates", () => {
      const result = deployController.createRelease("1.0.0", "v1.0.0", "user1", ["feat: new feature"], "staging");
      expect(result.data?.deploy_gates.length).toBe(5);
      const gateNames = result.data?.deploy_gates.map((g) => g.name) ?? [];
      expect(gateNames).toContain("tests_passing");
      expect(gateNames).toContain("type_check_clean");
      expect(gateNames).toContain("build_successful");
      expect(gateNames).toContain("security_scan");
      expect(gateNames).toContain("operator_approval");
    });

    it("should set all gates as required and not passed", () => {
      const result = deployController.createRelease("1.0.0", "v1.0.0", "user1", ["feat: new feature"], "staging");
      const allRequired = result.data?.deploy_gates.every((g) => g.required) ?? false;
      const nonePassedInitially = result.data?.deploy_gates.every((g) => !g.passed) ?? false;
      expect(allRequired).toBe(true);
      expect(nonePassedInitially).toBe(true);
    });
  });

  describe("stageRelease", () => {
    it("should transition release to staged status", () => {
      const created = deployController.createRelease("1.0.0", "v1.0.0", "user1", ["feat: new feature"], "staging");
      const releaseId = created.data?.id ?? "";

      // Pass all required gates
      deployController.updateGate(releaseId, "tests_passing", true);
      deployController.updateGate(releaseId, "type_check_clean", true);
      deployController.updateGate(releaseId, "build_successful", true);
      deployController.updateGate(releaseId, "security_scan", true);
      deployController.updateGate(releaseId, "operator_approval", true);

      const result = deployController.stageRelease(releaseId);
      expect(result.success).toBe(true);
      expect(result.data?.status).toBe("staged");
    });

    it("should fail if required gates not passed", () => {
      const created = deployController.createRelease("1.0.0", "v1.0.0", "user1", ["feat: new feature"], "staging");
      const releaseId = created.data?.id ?? "";

      const result = deployController.stageRelease(releaseId);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Not all required gates passed");
    });

    it("should fail for non-existent release", () => {
      const result = deployController.stageRelease("rel_nonexistent");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Release not found");
    });
  });

  describe("deployRelease", () => {
    it("should deploy a staged release", () => {
      const created = deployController.createRelease("1.0.0", "v1.0.0", "user1", ["feat: new feature"], "staging");
      const releaseId = created.data?.id ?? "";

      // Stage it first
      deployController.updateGate(releaseId, "tests_passing", true);
      deployController.updateGate(releaseId, "type_check_clean", true);
      deployController.updateGate(releaseId, "build_successful", true);
      deployController.updateGate(releaseId, "security_scan", true);
      deployController.updateGate(releaseId, "operator_approval", true);
      deployController.stageRelease(releaseId);

      const result = deployController.deployRelease(releaseId);
      expect(result.success).toBe(true);
      expect(result.data?.status).toBe("deployed");
      expect(result.data?.deployed_at).toBeDefined();
    });

    it("should fail if release not staged", () => {
      const created = deployController.createRelease("1.0.0", "v1.0.0", "user1", ["feat: new feature"], "staging");
      const releaseId = created.data?.id ?? "";

      const result = deployController.deployRelease(releaseId);
      expect(result.success).toBe(false);
      expect(result.error).toContain("must be staged");
    });

    it("should fail if environment is locked", () => {
      const created = deployController.createRelease("1.0.0", "v1.0.0", "user1", ["feat: new feature"], "staging");
      const releaseId = created.data?.id ?? "";

      deployController.lockEnvironment("staging", "admin", "maintenance");

      // Stage it
      deployController.updateGate(releaseId, "tests_passing", true);
      deployController.updateGate(releaseId, "type_check_clean", true);
      deployController.updateGate(releaseId, "build_successful", true);
      deployController.updateGate(releaseId, "security_scan", true);
      deployController.updateGate(releaseId, "operator_approval", true);
      deployController.stageRelease(releaseId);

      const result = deployController.deployRelease(releaseId);
      expect(result.success).toBe(false);
      expect(result.error).toContain("locked");
    });

    it("should update environment version on deploy", () => {
      const created = deployController.createRelease("2.0.0", "v2.0.0", "user1", ["feat: new feature"], "production");
      const releaseId = created.data?.id ?? "";

      // Stage it
      deployController.updateGate(releaseId, "tests_passing", true);
      deployController.updateGate(releaseId, "type_check_clean", true);
      deployController.updateGate(releaseId, "build_successful", true);
      deployController.updateGate(releaseId, "security_scan", true);
      deployController.updateGate(releaseId, "operator_approval", true);
      deployController.stageRelease(releaseId);

      deployController.deployRelease(releaseId);

      const env = deployController.getEnvironment("production");
      expect(env.data?.current_version).toBe("2.0.0");
      expect(env.data?.last_deploy_at).toBeDefined();
    });
  });

  describe("updateGate", () => {
    it("should update gate status", () => {
      const created = deployController.createRelease("1.0.0", "v1.0.0", "user1", ["feat: new feature"], "staging");
      const releaseId = created.data?.id ?? "";

      const result = deployController.updateGate(releaseId, "tests_passing", true, "All tests passed");
      expect(result.success).toBe(true);
      expect(result.data?.deploy_gates[0].passed).toBe(true);
      expect(result.data?.deploy_gates[0].details).toBe("All tests passed");
      expect(result.data?.deploy_gates[0].checked_at).toBeDefined();
    });

    it("should fail for non-existent release", () => {
      const result = deployController.updateGate("rel_nonexistent", "tests_passing", true);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Release not found");
    });

    it("should fail for non-existent gate", () => {
      const created = deployController.createRelease("1.0.0", "v1.0.0", "user1", ["feat: new feature"], "staging");
      const releaseId = created.data?.id ?? "";

      const result = deployController.updateGate(releaseId, "non_existent_gate", true);
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("rollbackRelease", () => {
    it("should rollback a deployed release", () => {
      const created = deployController.createRelease("1.0.0", "v1.0.0", "user1", ["feat: new feature"], "production");
      const releaseId = created.data?.id ?? "";

      // Deploy it
      deployController.updateGate(releaseId, "tests_passing", true);
      deployController.updateGate(releaseId, "type_check_clean", true);
      deployController.updateGate(releaseId, "build_successful", true);
      deployController.updateGate(releaseId, "security_scan", true);
      deployController.updateGate(releaseId, "operator_approval", true);
      deployController.stageRelease(releaseId);
      deployController.deployRelease(releaseId);

      const result = deployController.rollbackRelease(releaseId, "0.9.0", "Bug found", "admin");
      expect(result.success).toBe(true);
      expect(result.data?.status).toBe("completed");
      expect(result.data?.from_version).toBe("1.0.0");
      expect(result.data?.to_version).toBe("0.9.0");
      expect(result.data?.completed_at).toBeDefined();
    });

    it("should fail for non-deployed release", () => {
      const created = deployController.createRelease("1.0.0", "v1.0.0", "user1", ["feat: new feature"], "staging");
      const releaseId = created.data?.id ?? "";

      const result = deployController.rollbackRelease(releaseId, "0.9.0", "Bug found", "admin");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Only deployed releases");
    });

    it("should update environment version on rollback", () => {
      const created = deployController.createRelease("1.0.0", "v1.0.0", "user1", ["feat: new feature"], "production");
      const releaseId = created.data?.id ?? "";

      // Deploy
      deployController.updateGate(releaseId, "tests_passing", true);
      deployController.updateGate(releaseId, "type_check_clean", true);
      deployController.updateGate(releaseId, "build_successful", true);
      deployController.updateGate(releaseId, "security_scan", true);
      deployController.updateGate(releaseId, "operator_approval", true);
      deployController.stageRelease(releaseId);
      deployController.deployRelease(releaseId);

      deployController.rollbackRelease(releaseId, "0.9.0", "Bug found", "admin");

      const env = deployController.getEnvironment("production");
      expect(env.data?.current_version).toBe("0.9.0");
    });

    it("should mark release as rolled back", () => {
      const created = deployController.createRelease("1.0.0", "v1.0.0", "user1", ["feat: new feature"], "production");
      const releaseId = created.data?.id ?? "";

      // Deploy
      deployController.updateGate(releaseId, "tests_passing", true);
      deployController.updateGate(releaseId, "type_check_clean", true);
      deployController.updateGate(releaseId, "build_successful", true);
      deployController.updateGate(releaseId, "security_scan", true);
      deployController.updateGate(releaseId, "operator_approval", true);
      deployController.stageRelease(releaseId);
      deployController.deployRelease(releaseId);

      deployController.rollbackRelease(releaseId, "0.9.0", "Bug found", "admin");

      const release = deployController.getRelease(releaseId);
      expect(release.data?.status).toBe("rolled_back");
      expect(release.data?.rollback_reason).toBe("Bug found");
      expect(release.data?.rolled_back_at).toBeDefined();
    });
  });

  describe("getRelease", () => {
    it("should retrieve a release by ID", () => {
      const created = deployController.createRelease("1.0.0", "v1.0.0", "user1", ["feat: new feature"], "staging");
      const releaseId = created.data?.id ?? "";

      const result = deployController.getRelease(releaseId);
      expect(result.success).toBe(true);
      expect(result.data?.id).toBe(releaseId);
    });

    it("should fail for non-existent release", () => {
      const result = deployController.getRelease("rel_nonexistent");
      expect(result.success).toBe(false);
    });
  });

  describe("getReleaseByVersion", () => {
    it("should retrieve a release by version", () => {
      deployController.createRelease("1.2.3", "v1.2.3", "user1", ["feat: new feature"], "staging");

      const result = deployController.getReleaseByVersion("1.2.3");
      expect(result.success).toBe(true);
      expect(result.data?.version).toBe("1.2.3");
    });

    it("should fail for non-existent version", () => {
      const result = deployController.getReleaseByVersion("9.9.9");
      expect(result.success).toBe(false);
    });
  });

  describe("getAllReleases", () => {
    it("should return all releases", () => {
      deployController.createRelease("1.0.0", "v1.0.0", "user1", ["feat: new feature"], "staging");
      deployController.createRelease("1.1.0", "v1.1.0", "user2", ["feat: another"], "production");

      const result = deployController.getAllReleases();
      expect(result.success).toBe(true);
      expect(result.data.length).toBe(2);
    });

    it("should return empty array when no releases", () => {
      const result = deployController.getAllReleases();
      expect(result.success).toBe(true);
      expect(result.data.length).toBe(0);
    });
  });

  describe("getRollbackHistory", () => {
    it("should retrieve rollback history for a release", () => {
      const created = deployController.createRelease("1.0.0", "v1.0.0", "user1", ["feat: new feature"], "production");
      const releaseId = created.data?.id ?? "";

      // Deploy
      deployController.updateGate(releaseId, "tests_passing", true);
      deployController.updateGate(releaseId, "type_check_clean", true);
      deployController.updateGate(releaseId, "build_successful", true);
      deployController.updateGate(releaseId, "security_scan", true);
      deployController.updateGate(releaseId, "operator_approval", true);
      deployController.stageRelease(releaseId);
      deployController.deployRelease(releaseId);

      deployController.rollbackRelease(releaseId, "0.9.0", "Bug found", "admin");

      const result = deployController.getRollbackHistory(releaseId);
      expect(result.success).toBe(true);
      expect(result.data.length).toBe(1);
      expect(result.data[0].from_version).toBe("1.0.0");
    });

    it("should return empty array when no rollbacks", () => {
      const created = deployController.createRelease("1.0.0", "v1.0.0", "user1", ["feat: new feature"], "staging");
      const releaseId = created.data?.id ?? "";

      const result = deployController.getRollbackHistory(releaseId);
      expect(result.success).toBe(true);
      expect(result.data.length).toBe(0);
    });
  });

  describe("lockEnvironment", () => {
    it("should lock an environment", () => {
      const result = deployController.lockEnvironment("staging", "admin", "scheduled maintenance");
      expect(result.success).toBe(true);
      expect(result.data?.locked).toBe(true);
      expect(result.data?.locked_by).toBe("admin");
      expect(result.data?.lock_reason).toBe("scheduled maintenance");
    });

    it("should fail for non-existent environment", () => {
      const result = deployController.lockEnvironment("invalid" as any, "admin", "reason");
      expect(result.success).toBe(false);
    });
  });

  describe("unlockEnvironment", () => {
    it("should unlock an environment", () => {
      deployController.lockEnvironment("staging", "admin", "scheduled maintenance");
      const result = deployController.unlockEnvironment("staging");
      expect(result.success).toBe(true);
      expect(result.data?.locked).toBe(false);
      expect(result.data?.locked_by).toBeUndefined();
      expect(result.data?.lock_reason).toBeUndefined();
    });

    it("should fail for non-existent environment", () => {
      const result = deployController.unlockEnvironment("invalid" as any);
      expect(result.success).toBe(false);
    });
  });

  describe("getEnvironment", () => {
    it("should retrieve environment config", () => {
      const result = deployController.getEnvironment("staging");
      expect(result.success).toBe(true);
      expect(result.data?.name).toBe("staging");
      expect(result.data?.locked).toBe(false);
    });

    it("should fail for non-existent environment", () => {
      const result = deployController.getEnvironment("invalid" as any);
      expect(result.success).toBe(false);
    });
  });

  describe("getAllEnvironments", () => {
    it("should return all environments", () => {
      const result = deployController.getAllEnvironments();
      expect(result.success).toBe(true);
      expect(result.data.length).toBe(3);
      const names = result.data.map((e) => e.name);
      expect(names).toContain("development");
      expect(names).toContain("staging");
      expect(names).toContain("production");
    });
  });

  describe("_clearDeploy", () => {
    it("should clear all data and reinitialize", () => {
      deployController.createRelease("1.0.0", "v1.0.0", "user1", ["feat: new feature"], "staging");
      deployController._clearDeploy();

      const releases = deployController.getAllReleases();
      expect(releases.data.length).toBe(0);

      const envs = deployController.getAllEnvironments();
      expect(envs.data.length).toBe(3);
      expect(envs.data[0].current_version).toBe("0.0.0");
    });
  });
});
