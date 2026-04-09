/**
 * security_hardening.test.ts — Phase 31: Security Hardening Tests
 *
 * Comprehensive test suite for security components:
 *   - Secret validation (required secrets, presence checking)
 *   - Environment validation (startup checks, unsafe configs)
 *   - Operator auth (signed actions, approval flow)
 *   - Privilege escalation prevention
 *   - Credential mixing detection
 *   - Production safety checks
 *
 * 25+ tests covering happy paths and negative cases.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  SecretsManager,
  OperatorAuthManager,
  EnvironmentValidator,
} from "../lib/security/index";

// ============================================================================
// MOCK SETUP
// ============================================================================

// Mock logger
vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ============================================================================
// SECRETS MANAGER TESTS
// ============================================================================

describe("SecretsManager", () => {
  let manager: SecretsManager;

  beforeEach(() => {
    manager = new SecretsManager();
    manager._clear();
  });

  it("should track secret entries for all known secrets", () => {
    const status = manager.getSecretStatus();
    expect(status.secret_entries.length).toBeGreaterThan(0);
  });

  it("should identify paper credentials as required", () => {
    const status = manager.getSecretStatus();
    const paperKeys = status.secret_entries.filter((e) => e.vault === "paper");
    expect(paperKeys.length).toBeGreaterThan(0);
    expect(paperKeys.every((e) => e.required)).toBe(true);
  });

  it("should identify shared credentials as required", () => {
    const status = manager.getSecretStatus();
    const sharedKeys = status.secret_entries.filter((e) => e.vault === "shared");
    expect(sharedKeys.length).toBeGreaterThan(0);
    expect(
      sharedKeys.some((e) => e.key === "GODSVIEW_OPERATOR_TOKEN" && e.required),
    ).toBe(true);
  });

  it("should mark live credentials as not required by default", () => {
    const status = manager.getSecretStatus();
    const liveKeys = status.secret_entries.filter((e) => e.vault === "live");
    expect(liveKeys.length).toBeGreaterThan(0);
    expect(liveKeys.every((e) => !e.required)).toBe(true);
  });

  it("should detect unsafe config: live trading without credentials", () => {
    process.env.GODSVIEW_ENABLE_LIVE_TRADING = "true";
    process.env.ALPACA_KEY = "";
    process.env.ALPACA_SECRET = "";

    const unsafe = manager.getUnsafeConfigs();
    const liveWithoutCreds = unsafe.find((u) => u.config_name === "live_trading_without_credentials");
    expect(liveWithoutCreds).toBeDefined();
    expect(liveWithoutCreds?.severity).toBe("fatal");

    delete process.env.GODSVIEW_ENABLE_LIVE_TRADING;
  });

  it("should detect unsafe config: live credentials in paper mode", () => {
    process.env.GODSVIEW_SYSTEM_MODE = "paper";
    process.env.ALPACA_KEY = "test-key";
    process.env.ALPACA_SECRET = "";
    process.env.GODSVIEW_ENABLE_LIVE_TRADING = "false";

    const manager2 = new SecretsManager();
    const unsafe = manager2.getUnsafeConfigs();
    const mixing = unsafe.find((u) => u.config_name === "live_credentials_in_paper_mode");
    expect(mixing).toBeDefined();
    expect(mixing?.severity).toBe("critical");

    delete process.env.GODSVIEW_SYSTEM_MODE;
    delete process.env.ALPACA_KEY;
    delete process.env.GODSVIEW_ENABLE_LIVE_TRADING;
  });

  it("should mask secret values in encrypted_hint", () => {
    const status = manager.getSecretStatus();
    for (const entry of status.secret_entries) {
      // Should never show full secret, only masked version
      expect(entry.encrypted_hint).not.toContain("test");
      expect(entry.encrypted_hint).toMatch(/^(\.\.\.|.*\*{4}).*$/);
    }
  });

  it("should report paper credentials as present when both set", () => {
    process.env.ALPACA_PAPER_API_KEY = "test-paper-key";
    process.env.ALPACA_PAPER_SECRET_KEY = "test-paper-secret";

    const manager2 = new SecretsManager();
    const status = manager2.getSecretStatus();
    expect(status.paper_present).toBe(true);

    delete process.env.ALPACA_PAPER_API_KEY;
    delete process.env.ALPACA_PAPER_SECRET_KEY;
  });

  it("should report live credentials as present when both set", () => {
    process.env.ALPACA_KEY = "test-live-key";
    process.env.ALPACA_SECRET = "test-live-secret";

    const manager2 = new SecretsManager();
    const status = manager2.getSecretStatus();
    expect(status.live_present).toBe(true);

    delete process.env.ALPACA_KEY;
    delete process.env.ALPACA_SECRET;
  });

  it("should validate required secrets at startup", () => {
    // Simulate missing required secret
    process.env.GODSVIEW_OPERATOR_TOKEN = "";

    const manager2 = new SecretsManager();
    const result = manager2.validateSecrets();

    // Should fail because GODSVIEW_OPERATOR_TOKEN is required
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);

    // Restore
    process.env.GODSVIEW_OPERATOR_TOKEN = "test-token";
  });

  it("should check if live credential is present", () => {
    process.env.ALPACA_KEY = "test-key";
    process.env.ALPACA_SECRET = "test-secret";

    const manager2 = new SecretsManager();
    expect(manager2.isLiveCredentialPresent()).toBe(true);

    delete process.env.ALPACA_KEY;
    const manager3 = new SecretsManager();
    expect(manager3.isLiveCredentialPresent()).toBe(false);

    delete process.env.ALPACA_SECRET;
  });

  it("should check if paper credential is present", () => {
    process.env.ALPACA_PAPER_API_KEY = "test-paper-key";
    process.env.ALPACA_PAPER_SECRET_KEY = "test-paper-secret";

    const manager2 = new SecretsManager();
    expect(manager2.isPaperCredentialPresent()).toBe(true);

    delete process.env.ALPACA_PAPER_API_KEY;
    const manager3 = new SecretsManager();
    expect(manager3.isPaperCredentialPresent()).toBe(false);

    delete process.env.ALPACA_PAPER_SECRET_KEY;
  });
});

// ============================================================================
// OPERATOR AUTH TESTS
// ============================================================================

describe("OperatorAuthManager", () => {
  let manager: OperatorAuthManager;

  beforeEach(() => {
    manager = new OperatorAuthManager();
    manager._clear();
  });

  it("should sign a privileged action", () => {
    const result = manager.signAction("op_123", "kill_switch", "resource_456", "127.0.0.1");

    expect(result.success).toBe(true);
    expect(result.action_id).toBeDefined();
    expect(result.action_id).toMatch(/^act_/);
  });

  it("should reject non-privileged action types", () => {
    const result = manager.signAction("op_123", "read_only" as any, "resource_456", "127.0.0.1");

    expect(result.success).toBe(false);
    expect(result.error).toContain("does not require signature");
  });

  it("should reject action without operator_id", () => {
    const result = manager.signAction("", "kill_switch", "resource_456", "127.0.0.1");

    expect(result.success).toBe(false);
    expect(result.error).toContain("operator_id required");
  });

  it("should verify signature for signed action", () => {
    const signResult = manager.signAction("op_123", "kill_switch", "resource_456", "127.0.0.1");
    expect(signResult.success).toBe(true);

    const action_id = signResult.action_id!;
    const verifyResult = manager.verifySignature(action_id, "approver_op_789");

    expect(verifyResult.success).toBe(true);
  });

  it("should reject verification for non-existent action", () => {
    const result = manager.verifySignature("act_nonexistent", "approver");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Action not found");
  });

  it("should prevent double approval of same action", () => {
    const signResult = manager.signAction("op_123", "kill_switch", "resource_456", "127.0.0.1");
    const action_id = signResult.action_id!;

    manager.verifySignature(action_id, "approver_op_789");
    const secondApproval = manager.verifySignature(action_id, "approver_op_789");

    expect(secondApproval.success).toBe(false);
    expect(secondApproval.error).toContain("already approved");
  });

  it("should execute approved action", () => {
    const signResult = manager.signAction("op_123", "flatten_all", "portfolio_all", "127.0.0.1");
    const action_id = signResult.action_id!;

    manager.verifySignature(action_id, "approver");
    const execResult = manager.executeAction(action_id);

    expect(execResult.success).toBe(true);
  });

  it("should prevent execution of unapproved action", () => {
    const signResult = manager.signAction("op_123", "flatten_all", "portfolio_all", "127.0.0.1");
    const action_id = signResult.action_id!;

    const execResult = manager.executeAction(action_id);

    expect(execResult.success).toBe(false);
    expect(execResult.error).toContain("not approved");
  });

  it("should prevent double execution of same action", () => {
    const signResult = manager.signAction("op_123", "flatten_all", "portfolio_all", "127.0.0.1");
    const action_id = signResult.action_id!;

    manager.verifySignature(action_id, "approver");
    manager.executeAction(action_id);
    const secondExec = manager.executeAction(action_id);

    expect(secondExec.success).toBe(false);
    expect(secondExec.error).toContain("already executed");
  });

  it("should record action error", () => {
    const signResult = manager.signAction("op_123", "live_enable", "account_123", "127.0.0.1");
    const action_id = signResult.action_id!;

    manager.recordActionError(action_id, "Authentication failed");

    const history = manager.getActionHistory();
    const action = history.find((a) => a.action_id === action_id);
    expect(action?.error).toBe("Authentication failed");
  });

  it("should return action history for specific operator", () => {
    const a1 = manager.signAction("op_alice", "kill_switch", "r1", "127.0.0.1");
    const a2 = manager.signAction("op_bob", "flatten_all", "r2", "127.0.0.1");
    const a3 = manager.signAction("op_alice", "live_disable", "r3", "127.0.0.1");

    // Verify actions to add them to audit log
    if (a1.action_id) manager.verifySignature(a1.action_id, "approver");
    if (a2.action_id) manager.verifySignature(a2.action_id, "approver");
    if (a3.action_id) manager.verifySignature(a3.action_id, "approver");

    const aliceActions = manager.getActionHistory("op_alice");
    expect(aliceActions.length).toBe(2);
    expect(aliceActions.every((a) => a.operator_id === "op_alice")).toBe(true);
  });

  it("should return all actions when operator_id not specified", () => {
    const a1 = manager.signAction("op_alice", "kill_switch", "r1", "127.0.0.1");
    const a2 = manager.signAction("op_bob", "flatten_all", "r2", "127.0.0.1");

    // Verify actions to add them to audit log
    if (a1.action_id) manager.verifySignature(a1.action_id, "approver");
    if (a2.action_id) manager.verifySignature(a2.action_id, "approver");

    const allActions = manager.getActionHistory();
    expect(allActions.length).toBe(2);
  });

  it("should limit action history by count", () => {
    const actions = [];
    for (let i = 0; i < 10; i++) {
      const result = manager.signAction(`op_${i}`, "kill_switch", `r_${i}`, "127.0.0.1");
      actions.push(result);
    }

    // Verify actions to add them to audit log
    for (const result of actions) {
      if (result.action_id) {
        manager.verifySignature(result.action_id, "approver");
      }
    }

    const limited = manager.getActionHistory(undefined, 5);
    expect(limited.length).toBe(5);
  });

  it("should get privileged actions", () => {
    const a1 = manager.signAction("op_123", "kill_switch", "r1", "127.0.0.1");
    const a2 = manager.signAction("op_123", "flatten_all", "r2", "127.0.0.1");

    // Verify actions to add them to audit log
    if (a1.action_id) manager.verifySignature(a1.action_id, "approver");
    if (a2.action_id) manager.verifySignature(a2.action_id, "approver");

    const privileged = manager.getPrivilegedActions();
    expect(privileged.length).toBe(2);
  });

  it("should track pending approval count", () => {
    manager.signAction("op_123", "kill_switch", "r1", "127.0.0.1");
    manager.signAction("op_123", "flatten_all", "r2", "127.0.0.1");

    expect(manager.getPendingApprovalCount()).toBe(2);

    const actions = manager.getPrivilegedActions();
    if (actions.length > 0) {
      // Get actual action_id (from signed action)
      const result = manager.signAction("op_approve", "policy_override", "r3", "127.0.0.1");
      if (result.action_id) {
        manager.verifySignature(result.action_id, "approver");
      }
    }
  });
});

// ============================================================================
// ENVIRONMENT VALIDATOR TESTS
// ============================================================================

describe("EnvironmentValidator", () => {
  let validator: EnvironmentValidator;

  beforeEach(() => {
    validator = new EnvironmentValidator();
  });

  it("should detect missing system mode", () => {
    process.env.GODSVIEW_SYSTEM_MODE = "";

    const validator2 = new EnvironmentValidator();
    const report = validator2.getEnvironmentReport();

    const missing = report.issues.find((i) => i.config_name === "missing_system_mode");
    expect(missing).toBeDefined();
    expect(missing?.severity).toBe("fatal");
  });

  it("should validate port configuration", () => {
    process.env.PORT = "3000";

    const validator2 = new EnvironmentValidator();
    const report = validator2.getEnvironmentReport();

    expect(report.port).toBe(3000);
  });

  it("should reject invalid port", () => {
    process.env.PORT = "invalid";

    const validator2 = new EnvironmentValidator();
    const report = validator2.getEnvironmentReport();

    expect(report.port).toBe(-1);
  });

  it("should reject port out of range", () => {
    process.env.PORT = "99999";

    const validator2 = new EnvironmentValidator();
    const report = validator2.getEnvironmentReport();

    expect(report.port).toBe(-1);
  });

  it("should detect live mode without credentials", () => {
    process.env.GODSVIEW_ENABLE_LIVE_TRADING = "true";
    process.env.ALPACA_KEY = "";
    process.env.ALPACA_SECRET = "";

    const validator2 = new EnvironmentValidator();
    const report = validator2.getEnvironmentReport();

    const issue = report.issues.find((i) => i.config_name === "live_mode_missing_credentials");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("fatal");

    delete process.env.GODSVIEW_ENABLE_LIVE_TRADING;
  });

  it("should detect live credentials in paper mode", () => {
    process.env.GODSVIEW_SYSTEM_MODE = "paper";
    process.env.ALPACA_KEY = "live-key";

    const validator2 = new EnvironmentValidator();
    const report = validator2.getEnvironmentReport();

    const issue = report.issues.find((i) => i.config_name === "live_credentials_in_paper_mode");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("critical");

    delete process.env.GODSVIEW_SYSTEM_MODE;
    delete process.env.ALPACA_KEY;
  });

  it("should require operator token in production", () => {
    process.env.NODE_ENV = "production";
    process.env.GODSVIEW_OPERATOR_TOKEN = "";

    const validator2 = new EnvironmentValidator();
    const report = validator2.getEnvironmentReport();

    const issue = report.issues.find((i) => i.config_name === "missing_operator_token");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("critical");

    delete process.env.NODE_ENV;
    delete process.env.GODSVIEW_OPERATOR_TOKEN;
  });

  it("should not require operator token in development", () => {
    process.env.NODE_ENV = "development";
    process.env.GODSVIEW_OPERATOR_TOKEN = "";

    const validator2 = new EnvironmentValidator();
    const report = validator2.getEnvironmentReport();

    const issue = report.issues.find((i) => i.config_name === "missing_operator_token");
    expect(issue).toBeUndefined();

    delete process.env.NODE_ENV;
  });

  it("should detect invalid request body limit", () => {
    process.env.GODSVIEW_REQUEST_BODY_LIMIT = "invalid";

    const validator2 = new EnvironmentValidator();
    const report = validator2.getEnvironmentReport();

    const issue = report.issues.find((i) => i.config_name === "invalid_request_body_limit");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("critical");

    delete process.env.GODSVIEW_REQUEST_BODY_LIMIT;
  });

  it("should validate production safety", () => {
    const isSafe = validator.isProductionSafe();
    expect(typeof isSafe).toBe("boolean");
  });

  it("should generate environment report", () => {
    const report = validator.getEnvironmentReport();

    expect(report.timestamp).toBeGreaterThan(0);
    expect(report.node_env).toBeDefined();
    expect(report.system_mode).toBeDefined();
    expect(report.port).toBeDefined();
    expect(Array.isArray(report.issues)).toBe(true);
    expect(report.checks).toBeDefined();
  });

  it("should validate environment at startup", () => {
    const result = validator.validateEnvironment();

    expect(typeof result.success).toBe("boolean");
    expect(Array.isArray(result.errors)).toBe(true);
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe("Security Integration", () => {
  it("should coordinate between secrets and environment validation", () => {
    const secretsManager = new SecretsManager();
    const envValidator = new EnvironmentValidator();

    const secretStatus = secretsManager.getSecretStatus();
    const envReport = envValidator.getEnvironmentReport();

    // Both should report on required secrets
    expect(secretStatus.all_required_present).toBeDefined();
    expect(envReport.checks.operator_token_valid).toBeDefined();
  });

  it("should track operator actions through full lifecycle", () => {
    const authManager = new OperatorAuthManager();

    // 1. Sign action
    const signResult = authManager.signAction("op_123", "kill_switch", "resource_abc", "192.168.1.1");
    expect(signResult.success).toBe(true);
    const actionId = signResult.action_id!;

    // 2. Verify/approve
    const verifyResult = authManager.verifySignature(actionId, "approver_op");
    expect(verifyResult.success).toBe(true);

    // 3. Execute
    const execResult = authManager.executeAction(actionId);
    expect(execResult.success).toBe(true);

    // 4. Check history
    const history = authManager.getActionHistory();
    const foundAction = history.find((a) => a.action_id === actionId);
    expect(foundAction).toBeDefined();
    expect(foundAction?.executed).toBe(true);
  });
});
