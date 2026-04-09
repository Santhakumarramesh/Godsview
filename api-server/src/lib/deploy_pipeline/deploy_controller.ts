import { randomUUID } from "crypto";

export interface DeployGate {
  name: string;
  required: boolean;
  passed: boolean;
  checked_at?: number;
  details?: string;
}

export interface Release {
  id: string; // prefix "rel_"
  version: string;
  tag: string;
  created_at: number;
  created_by: string;
  changelog: string[];
  status: "draft" | "staged" | "deploying" | "deployed" | "rolled_back" | "failed";
  environment: "development" | "staging" | "production";
  deploy_gates: DeployGate[];
  deployed_at?: number;
  rolled_back_at?: number;
  rollback_reason?: string;
}

export interface RollbackRecord {
  id: string; // prefix "rb_"
  release_id: string;
  from_version: string;
  to_version: string;
  reason: string;
  initiated_by: string;
  initiated_at: number;
  completed_at?: number;
  status: "pending" | "in_progress" | "completed" | "failed";
}

export interface EnvironmentConfig {
  name: "development" | "staging" | "production";
  current_version: string;
  last_deploy_at?: number;
  locked: boolean;
  locked_by?: string;
  lock_reason?: string;
}

const STANDARD_GATES = ["tests_passing", "type_check_clean", "build_successful", "security_scan", "operator_approval"];

class DeployController {
  private releaseStore = new Map<string, Release>();
  private rollbackStore = new Map<string, RollbackRecord>();
  private environmentStore = new Map<string, EnvironmentConfig>();

  constructor() {
    this.initializeEnvironments();
  }

  private initializeEnvironments() {
    const envs: EnvironmentConfig[] = [
      { name: "development", current_version: "0.0.0", locked: false },
      { name: "staging", current_version: "0.0.0", locked: false },
      { name: "production", current_version: "0.0.0", locked: false },
    ];
    envs.forEach((env) => this.environmentStore.set(env.name, env));
  }

  createRelease(
    version: string,
    tag: string,
    created_by: string,
    changelog: string[],
    environment: "development" | "staging" | "production"
  ): { success: boolean; data?: Release; error?: string } {
    const id = `rel_${randomUUID()}`;
    const gates: DeployGate[] = STANDARD_GATES.map((name) => ({
      name,
      required: true,
      passed: false,
    }));

    const release: Release = {
      id,
      version,
      tag,
      created_at: Date.now(),
      created_by,
      changelog,
      status: "draft",
      environment,
      deploy_gates: gates,
    };

    this.releaseStore.set(id, release);
    return { success: true, data: release };
  }

  stageRelease(releaseId: string): { success: boolean; data?: Release; error?: string } {
    const release = this.releaseStore.get(releaseId);
    if (!release) return { success: false, error: "Release not found" };

    const requiredGates = release.deploy_gates.filter((g) => g.required);
    const allPassed = requiredGates.every((g) => g.passed);
    if (!allPassed) return { success: false, error: "Not all required gates passed" };

    release.status = "staged";
    this.releaseStore.set(releaseId, release);
    return { success: true, data: release };
  }

  deployRelease(releaseId: string): { success: boolean; data?: Release; error?: string } {
    const release = this.releaseStore.get(releaseId);
    if (!release) return { success: false, error: "Release not found" };

    if (release.status !== "staged") {
      return { success: false, error: "Release must be staged before deployment" };
    }

    const env = this.environmentStore.get(release.environment);
    if (!env || env.locked) {
      return { success: false, error: `Environment ${release.environment} is locked` };
    }

    release.status = "deploying";
    release.deployed_at = Date.now();
    this.releaseStore.set(releaseId, release);

    release.status = "deployed";
    env.current_version = release.version;
    env.last_deploy_at = Date.now();
    this.releaseStore.set(releaseId, release);
    this.environmentStore.set(release.environment, env);

    return { success: true, data: release };
  }

  updateGate(releaseId: string, gateName: string, passed: boolean, details?: string): { success: boolean; data?: Release; error?: string } {
    const release = this.releaseStore.get(releaseId);
    if (!release) return { success: false, error: "Release not found" };

    const gate = release.deploy_gates.find((g) => g.name === gateName);
    if (!gate) return { success: false, error: `Gate ${gateName} not found` };

    gate.passed = passed;
    gate.checked_at = Date.now();
    gate.details = details;
    this.releaseStore.set(releaseId, release);

    return { success: true, data: release };
  }

  rollbackRelease(
    releaseId: string,
    toVersion: string,
    reason: string,
    initiatedBy: string
  ): { success: boolean; data?: RollbackRecord; error?: string } {
    const release = this.releaseStore.get(releaseId);
    if (!release) return { success: false, error: "Release not found" };

    if (release.status !== "deployed") {
      return { success: false, error: "Only deployed releases can be rolled back" };
    }

    const env = this.environmentStore.get(release.environment);
    if (!env) return { success: false, error: "Environment not found" };

    const rbId = `rb_${randomUUID()}`;
    const record: RollbackRecord = {
      id: rbId,
      release_id: releaseId,
      from_version: release.version,
      to_version: toVersion,
      reason,
      initiated_by: initiatedBy,
      initiated_at: Date.now(),
      status: "in_progress",
    };

    this.rollbackStore.set(rbId, record);

    release.status = "rolled_back";
    release.rolled_back_at = Date.now();
    release.rollback_reason = reason;
    this.releaseStore.set(releaseId, release);

    env.current_version = toVersion;
    record.completed_at = Date.now();
    record.status = "completed";
    this.rollbackStore.set(rbId, record);
    this.environmentStore.set(release.environment, env);

    return { success: true, data: record };
  }

  getRelease(releaseId: string): { success: boolean; data?: Release; error?: string } {
    const release = this.releaseStore.get(releaseId);
    return release ? { success: true, data: release } : { success: false, error: "Release not found" };
  }

  getReleaseByVersion(version: string): { success: boolean; data?: Release; error?: string } {
    const release = Array.from(this.releaseStore.values()).find((r) => r.version === version);
    return release ? { success: true, data: release } : { success: false, error: "Release not found" };
  }

  getAllReleases(): { success: boolean; data: Release[] } {
    return { success: true, data: Array.from(this.releaseStore.values()) };
  }

  getRollbackHistory(releaseId: string): { success: boolean; data: RollbackRecord[] } {
    const records = Array.from(this.rollbackStore.values()).filter((r) => r.release_id === releaseId);
    return { success: true, data: records };
  }

  lockEnvironment(env: "development" | "staging" | "production", lockedBy: string, reason: string): { success: boolean; data?: EnvironmentConfig; error?: string } {
    const config = this.environmentStore.get(env);
    if (!config) return { success: false, error: "Environment not found" };

    config.locked = true;
    config.locked_by = lockedBy;
    config.lock_reason = reason;
    this.environmentStore.set(env, config);

    return { success: true, data: config };
  }

  unlockEnvironment(env: "development" | "staging" | "production"): { success: boolean; data?: EnvironmentConfig; error?: string } {
    const config = this.environmentStore.get(env);
    if (!config) return { success: false, error: "Environment not found" };

    config.locked = false;
    config.locked_by = undefined;
    config.lock_reason = undefined;
    this.environmentStore.set(env, config);

    return { success: true, data: config };
  }

  getEnvironment(env: "development" | "staging" | "production"): { success: boolean; data?: EnvironmentConfig; error?: string } {
    const config = this.environmentStore.get(env);
    return config ? { success: true, data: config } : { success: false, error: "Environment not found" };
  }

  getAllEnvironments(): { success: boolean; data: EnvironmentConfig[] } {
    return { success: true, data: Array.from(this.environmentStore.values()) };
  }

  _clearDeploy() {
    this.releaseStore.clear();
    this.rollbackStore.clear();
    this.environmentStore.clear();
    this.initializeEnvironments();
  }
}

export const deployController = new DeployController();
