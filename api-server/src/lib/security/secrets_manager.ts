/**
 * security/secrets_manager.ts — Phase 31: Secrets Management & Validation
 *
 * Core responsibilities:
 *   1. Track secret presence and status (paper/live/shared credentials)
 *   2. Validate all required secrets exist at startup
 *   3. Enforce separation between paper and live credentials
 *   4. Detect unsafe configurations (e.g., live trading enabled but missing broker keys)
 *   5. Never log or expose actual secret values
 *
 * SecretEntry tracks vault type, encryption hints, presence, and requirement status.
 * All validation happens at startup with hard failures for critical issues.
 */

import { logger } from "../logger";

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface SecretEntry {
  key: string;
  vault: "paper" | "live" | "shared";
  encrypted_hint: string; // Last 4 chars masked as ****
  required: boolean;
  present: boolean;
}

export interface SecretStatus {
  timestamp: number;
  paper_present: boolean;
  live_present: boolean;
  shared_present: boolean;
  all_required_present: boolean;
  unsafe_configs: string[];
  secret_entries: SecretEntry[];
}

export interface UnsafeConfig {
  config_name: string;
  reason: string;
  severity: "warning" | "critical" | "fatal";
}

// ============================================================================
// SECRETS MANAGER
// ============================================================================

export class SecretsManager {
  private secrets = new Map<string, SecretEntry>();
  private initialized = false;

  constructor() {
    this.initializeSecrets();
    this.initialized = true;
  }

  /**
   * Initialize secret tracking map with all known secrets
   */
  private initializeSecrets(): void {
    // Paper trading credentials
    this.registerSecret("ALPACA_PAPER_API_KEY", "paper", true);
    this.registerSecret("ALPACA_PAPER_SECRET_KEY", "paper", true);

    // Live trading credentials
    this.registerSecret("ALPACA_KEY", "live", false);
    this.registerSecret("ALPACA_SECRET", "live", false);

    // Shared credentials
    this.registerSecret("GODSVIEW_OPERATOR_TOKEN", "shared", true);
    this.registerSecret("ANTHROPIC_API_KEY", "shared", true);
    this.registerSecret("DATABASE_URL", "shared", true);

    // Optional but security-relevant
    this.registerSecret("GODSVIEW_JWT_SECRET", "shared", false);
    this.registerSecret("BROKER_API_KEY", "shared", false);
  }

  /**
   * Register a secret with validation rules
   */
  private registerSecret(key: string, vault: "paper" | "live" | "shared", required: boolean): void {
    const value = process.env[key] ?? "";
    const present = value.trim().length > 0;
    const encrypted_hint = this.maskSecretValue(value);

    this.secrets.set(key, {
      key,
      vault,
      encrypted_hint,
      required,
      present,
    });
  }

  /**
   * Mask secret value: show last 4 chars or **** if empty/short
   */
  private maskSecretValue(value: string): string {
    if (!value || value.length === 0) return "****";
    if (value.length <= 4) return "****";
    return "..." + value.slice(-4);
  }

  /**
   * Validate all secrets at startup — fail hard if critical issues
   */
  validateSecrets(): { success: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check all required secrets are present
    for (const entry of this.secrets.values()) {
      if (entry.required && !entry.present) {
        errors.push(`Required secret missing: ${entry.key}`);
      }
    }

    // Check unsafe configurations
    const unsafeConfigs = this.getUnsafeConfigs();
    for (const config of unsafeConfigs) {
      if (config.severity === "fatal") {
        errors.push(`Fatal configuration: ${config.reason}`);
      }
    }

    if (errors.length > 0) {
      logger.error(
        { errors, count: errors.length },
        "Secret validation failed — cannot proceed",
      );
      return { success: false, errors };
    }

    logger.info("Secret validation passed");
    return { success: true, errors: [] };
  }

  /**
   * Detect unsafe credential combinations
   */
  getUnsafeConfigs(): UnsafeConfig[] {
    const unsafe: UnsafeConfig[] = [];
    const systemMode = process.env.GODSVIEW_SYSTEM_MODE ?? "paper";
    const liveTradingEnabled = process.env.GODSVIEW_ENABLE_LIVE_TRADING === "true";

    // Live trading enabled but missing broker credentials
    if (liveTradingEnabled || systemMode === "live") {
      const alpacaKeyPresent = this.secrets.get("ALPACA_KEY")?.present ?? false;
      const alpacaSecretPresent = this.secrets.get("ALPACA_SECRET")?.present ?? false;

      if (!alpacaKeyPresent || !alpacaSecretPresent) {
        unsafe.push({
          config_name: "live_trading_without_credentials",
          reason: "Live trading enabled but ALPACA_KEY or ALPACA_SECRET missing",
          severity: "fatal",
        });
      }
    }

    // Paper mode should NOT have live credentials exposed
    if (systemMode === "paper" && !liveTradingEnabled) {
      const alpacaKeyPresent = this.secrets.get("ALPACA_KEY")?.present ?? false;

      if (alpacaKeyPresent) {
        unsafe.push({
          config_name: "live_credentials_in_paper_mode",
          reason: "Live ALPACA_KEY present in paper trading mode — risk of accidental live trading",
          severity: "critical",
        });
      }
    }

    // Operator token required in non-dev mode
    if (process.env.NODE_ENV !== "development") {
      const operatorTokenPresent = this.secrets.get("GODSVIEW_OPERATOR_TOKEN")?.present ?? false;

      if (!operatorTokenPresent) {
        unsafe.push({
          config_name: "missing_operator_token",
          reason: "GODSVIEW_OPERATOR_TOKEN required in non-development environment",
          severity: "critical",
        });
      }
    }

    // JWT secret should be set in production
    if (process.env.NODE_ENV === "production") {
      const jwtSecretPresent = this.secrets.get("GODSVIEW_JWT_SECRET")?.present ?? false;

      if (!jwtSecretPresent) {
        unsafe.push({
          config_name: "missing_jwt_secret",
          reason: "GODSVIEW_JWT_SECRET required for production security",
          severity: "warning",
        });
      }
    }

    return unsafe;
  }

  /**
   * Get current status of all secrets (never returns values)
   */
  getSecretStatus(): SecretStatus {
    const entries = Array.from(this.secrets.values());
    const unsafe = this.getUnsafeConfigs();

    const paperPresent = entries
      .filter((e) => e.vault === "paper")
      .every((e) => e.present);

    const livePresent = entries
      .filter((e) => e.vault === "live")
      .some((e) => e.present);

    const sharedPresent = entries
      .filter((e) => e.vault === "shared")
      .every((e) => e.present);

    const allRequiredPresent = entries
      .filter((e) => e.required)
      .every((e) => e.present);

    return {
      timestamp: Date.now(),
      paper_present: paperPresent,
      live_present: livePresent,
      shared_present: sharedPresent,
      all_required_present: allRequiredPresent,
      unsafe_configs: unsafe.map((u) => u.reason),
      secret_entries: entries,
    };
  }

  /**
   * Check if live credentials are present
   */
  isLiveCredentialPresent(): boolean {
    const alpacaKeyPresent = this.secrets.get("ALPACA_KEY")?.present ?? false;
    const alpacaSecretPresent = this.secrets.get("ALPACA_SECRET")?.present ?? false;
    return alpacaKeyPresent && alpacaSecretPresent;
  }

  /**
   * Check if paper credentials are present
   */
  isPaperCredentialPresent(): boolean {
    const paperKeyPresent = this.secrets.get("ALPACA_PAPER_API_KEY")?.present ?? false;
    const paperSecretPresent = this.secrets.get("ALPACA_PAPER_SECRET_KEY")?.present ?? false;
    return paperKeyPresent && paperSecretPresent;
  }

  /**
   * Clear all secret entries (for testing)
   */
  _clear(): void {
    this.secrets.clear();
    // Re-initialize after clearing to maintain test setup
    if (this.initialized) {
      this.initializeSecrets();
    }
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let instance: SecretsManager | null = null;

export function getSecretsManager(): SecretsManager {
  if (!instance) {
    instance = new SecretsManager();
  }
  return instance;
}
