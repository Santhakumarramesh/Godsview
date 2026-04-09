/**
 * security/env_validator.ts — Phase 31: Environment Validation & Startup Checks
 *
 * Core responsibilities:
 *   1. Validate environment at startup with hard failure for unsafe configs
 *   2. Check GODSVIEW_SYSTEM_MODE is set
 *   3. Verify live mode has required credentials (ALPACA_KEY + ALPACA_SECRET)
 *   4. Ensure paper mode doesn't have live credentials exposed
 *   5. Validate operator token in non-dev environments
 *   6. Check port is valid and within allowed range
 *   7. Generate comprehensive environment report
 *
 * All validations happen synchronously at startup. Fatal issues prevent server start.
 */

import { logger } from "../logger";

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface UnsafeConfig {
  config_name: string;
  reason: string;
  severity: "warning" | "critical" | "fatal";
}

export interface EnvironmentReport {
  timestamp: number;
  node_env: string;
  system_mode: string;
  port: number;
  live_trading_enabled: boolean;
  issues: UnsafeConfig[];
  is_production_safe: boolean;
  checks: {
    system_mode_set: boolean;
    live_credentials_valid: boolean;
    paper_credentials_valid: boolean;
    no_credential_mixing: boolean;
    operator_token_valid: boolean;
    port_valid: boolean;
    request_body_limit_valid: boolean;
  };
}

// ============================================================================
// ENVIRONMENT VALIDATOR
// ============================================================================

export class EnvironmentValidator {
  /**
   * Validate entire environment at startup
   */
  validateEnvironment(): { success: boolean; errors: string[] } {
    const errors: string[] = [];
    const issues = this.getEnvironmentReport().issues;

    // Collect fatal issues
    for (const issue of issues) {
      if (issue.severity === "fatal") {
        errors.push(`[FATAL] ${issue.reason}`);
      }
    }

    if (errors.length > 0) {
      logger.error(
        { errors, count: errors.length },
        "Environment validation failed — cannot start server",
      );
      return { success: false, errors };
    }

    // Log warnings and critical issues
    const warnings = issues.filter((i) => i.severity === "warning");
    const critical = issues.filter((i) => i.severity === "critical");

    if (warnings.length > 0) {
      logger.warn({ warnings }, "Environment warnings");
    }

    if (critical.length > 0) {
      logger.error({ critical }, "Environment critical issues");
    }

    logger.info("Environment validation passed");
    return { success: true, errors: [] };
  }

  /**
   * Get comprehensive environment report
   */
  getEnvironmentReport(): EnvironmentReport {
    const issues: UnsafeConfig[] = [];
    const systemMode = this.getSystemMode();
    const nodeEnv = process.env.NODE_ENV ?? "development";
    const port = this.validatePort();
    const liveTradingEnabled = this.isLiveTradingEnabled();

    // Check 1: GODSVIEW_SYSTEM_MODE must be set
    if (!systemMode) {
      issues.push({
        config_name: "missing_system_mode",
        reason: "GODSVIEW_SYSTEM_MODE environment variable is not set",
        severity: "fatal",
      });
    }

    // Check 2: Live mode requires ALPACA_KEY + ALPACA_SECRET
    if (systemMode === "live" || liveTradingEnabled) {
      const alpacaKey = process.env.ALPACA_KEY?.trim() ?? "";
      const alpacaSecret = process.env.ALPACA_SECRET?.trim() ?? "";

      if (!alpacaKey || !alpacaSecret) {
        issues.push({
          config_name: "live_mode_missing_credentials",
          reason: "Live trading enabled but ALPACA_KEY or ALPACA_SECRET missing",
          severity: "fatal",
        });
      }
    }

    // Check 3: Paper mode must NOT have live credentials exposed
    if (systemMode === "paper" && !liveTradingEnabled) {
      const alpacaKey = process.env.ALPACA_KEY?.trim() ?? "";

      if (alpacaKey) {
        issues.push({
          config_name: "live_credentials_in_paper_mode",
          reason: "Live credentials (ALPACA_KEY) present in paper mode",
          severity: "critical",
        });
      }
    }

    // Check 4: Operator token in non-dev mode
    if (nodeEnv !== "development") {
      const operatorToken = process.env.GODSVIEW_OPERATOR_TOKEN?.trim() ?? "";

      if (!operatorToken) {
        issues.push({
          config_name: "missing_operator_token",
          reason: `GODSVIEW_OPERATOR_TOKEN required in ${nodeEnv} mode`,
          severity: "critical",
        });
      }
    }

    // Check 5: Port validation
    if (port === -1) {
      issues.push({
        config_name: "invalid_port",
        reason: "PORT must be an integer between 1 and 65535",
        severity: "fatal",
      });
    }

    // Check 6: JWT secret in production
    if (nodeEnv === "production") {
      const jwtSecret = process.env.GODSVIEW_JWT_SECRET?.trim() ?? "";

      if (!jwtSecret) {
        issues.push({
          config_name: "missing_jwt_secret",
          reason: "GODSVIEW_JWT_SECRET required in production",
          severity: "warning",
        });
      }
    }

    // Check 7: Request body limit validation
    const bodyLimit = process.env.GODSVIEW_REQUEST_BODY_LIMIT ?? "1mb";
    if (!/^\d+(b|kb|mb)$/i.test(bodyLimit)) {
      issues.push({
        config_name: "invalid_request_body_limit",
        reason: `Invalid GODSVIEW_REQUEST_BODY_LIMIT: "${bodyLimit}". Use format like "256kb" or "1mb".`,
        severity: "critical",
      });
    }

    // Check 8: CORS configuration in production
    if (nodeEnv === "production") {
      const corsOrigin = process.env.CORS_ORIGIN?.trim() ?? "";

      if (!corsOrigin) {
        issues.push({
          config_name: "missing_cors_config",
          reason: "CORS_ORIGIN required in production",
          severity: "critical",
        });
      }

      if (corsOrigin.includes("*")) {
        issues.push({
          config_name: "unsafe_cors_wildcard",
          reason: "CORS_ORIGIN contains wildcard (*) in production",
          severity: "critical",
        });
      }
    }

    // Build checks report
    const checks = {
      system_mode_set: !!systemMode,
      live_credentials_valid: this.areLiveCredentialsValid(),
      paper_credentials_valid: this.arePaperCredentialsValid(),
      no_credential_mixing: !this.hasCredentialMixing(),
      operator_token_valid: this.isOperatorTokenValid(nodeEnv),
      port_valid: port > 0,
      request_body_limit_valid: /^\d+(b|kb|mb)$/i.test(bodyLimit),
    };

    const isProductionSafe =
      nodeEnv !== "production" ||
      (checks.system_mode_set &&
        checks.operator_token_valid &&
        checks.no_credential_mixing &&
        issues.filter((i) => i.severity === "critical").length === 0);

    return {
      timestamp: Date.now(),
      node_env: nodeEnv,
      system_mode: systemMode || "unset",
      port,
      live_trading_enabled: liveTradingEnabled,
      issues,
      is_production_safe: isProductionSafe,
      checks,
    };
  }

  /**
   * Check if production environment is safe to deploy
   */
  isProductionSafe(): boolean {
    const report = this.getEnvironmentReport();
    return report.is_production_safe;
  }

  /**
   * Get system mode from environment
   */
  private getSystemMode(): string {
    return process.env.GODSVIEW_SYSTEM_MODE?.trim() ?? "";
  }

  /**
   * Check if live trading is enabled
   */
  private isLiveTradingEnabled(): boolean {
    return process.env.GODSVIEW_ENABLE_LIVE_TRADING === "true";
  }

  /**
   * Validate port configuration
   */
  private validatePort(): number {
    const portStr = process.env.PORT ?? "3000";
    const port = parseInt(portStr, 10);

    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      return -1;
    }

    return port;
  }

  /**
   * Check if live credentials are both present
   */
  private areLiveCredentialsValid(): boolean {
    const key = process.env.ALPACA_KEY?.trim() ?? "";
    const secret = process.env.ALPACA_SECRET?.trim() ?? "";
    return key.length > 0 && secret.length > 0;
  }

  /**
   * Check if paper credentials are both present
   */
  private arePaperCredentialsValid(): boolean {
    const key = process.env.ALPACA_PAPER_API_KEY?.trim() ?? "";
    const secret = process.env.ALPACA_PAPER_SECRET_KEY?.trim() ?? "";
    return key.length > 0 && secret.length > 0;
  }

  /**
   * Check for credential mixing (live creds in paper mode or vice versa)
   */
  private hasCredentialMixing(): boolean {
    const systemMode = this.getSystemMode();
    const liveTradingEnabled = this.isLiveTradingEnabled();

    // If paper mode, should not have live credentials exposed
    if (!liveTradingEnabled && systemMode === "paper") {
      const alpacaKey = process.env.ALPACA_KEY?.trim() ?? "";
      if (alpacaKey) return true;
    }

    return false;
  }

  /**
   * Check operator token validity for environment
   */
  private isOperatorTokenValid(nodeEnv: string): boolean {
    if (nodeEnv === "development") return true; // Not required in dev

    const token = process.env.GODSVIEW_OPERATOR_TOKEN?.trim() ?? "";
    return token.length > 0;
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let instance: EnvironmentValidator | null = null;

export function getEnvironmentValidator(): EnvironmentValidator {
  if (!instance) {
    instance = new EnvironmentValidator();
  }
  return instance;
}
