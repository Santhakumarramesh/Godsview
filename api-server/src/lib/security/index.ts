/**
 * security/index.ts — Phase 31: Security Hardening Barrel Export
 *
 * Central export point for all security components:
 *   - SecretsManager: Secret presence validation and tracking
 *   - OperatorAuthManager: Signed action authorization and audit
 *   - EnvironmentValidator: Startup environment validation
 *
 * This module provides comprehensive control-plane hardening for GodsView.
 */

export {
  SecretsManager,
  getSecretsManager,
  type SecretEntry,
  type SecretStatus,
  type UnsafeConfig,
} from "./secrets_manager";

export {
  OperatorAuthManager,
  getOperatorAuthManager,
  requireSignedAction,
  type SignedAction,
  type ActionAuditLog,
  type PrivilegedActionType,
} from "./operator_auth";

export {
  EnvironmentValidator,
  getEnvironmentValidator,
  type EnvironmentReport,
  type UnsafeConfig as EnvUnsafeConfig,
} from "./env_validator";
