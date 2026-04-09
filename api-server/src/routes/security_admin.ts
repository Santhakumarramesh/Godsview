/**
 * security_admin.ts — Phase 31: Security Administration Router
 *
 * Endpoints for security posture monitoring and privileged action management:
 *   - GET  /api/security/secrets/status      → Secret presence status (never values)
 *   - GET  /api/security/env/report          → Environment validation report
 *   - GET  /api/security/env/safe            → Is production safe boolean
 *   - POST /api/security/actions/sign        → Sign a privileged action
 *   - GET  /api/security/actions/history     → Get signed action history
 *   - GET  /api/security/actions/privileged  → List recent privileged actions
 *   - GET  /api/security/permissions         → Permission coverage map
 *   - GET  /api/security/summary             → Overall security posture summary
 */

import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import {
  getSecretsManager,
  getOperatorAuthManager,
  getEnvironmentValidator,
} from "../lib/security/index";

const router = Router();

// ============================================================================
// SECRETS STATUS ENDPOINTS
// ============================================================================

/**
 * GET /api/security/secrets/status
 * Returns current secret presence and status (never actual values)
 */
router.get("/api/security/secrets/status", (req: Request, res: Response) => {
  try {
    const secretsManager = getSecretsManager();
    const status = secretsManager.getSecretStatus();

    res.json({
      success: true,
      data: {
        timestamp: status.timestamp,
        paper_present: status.paper_present,
        live_present: status.live_present,
        shared_present: status.shared_present,
        all_required_present: status.all_required_present,
        unsafe_configs: status.unsafe_configs,
        secret_count: status.secret_entries.length,
        // Never expose actual secret values or encrypted hints
        secret_entries: status.secret_entries.map((e) => ({
          key: e.key,
          vault: e.vault,
          required: e.required,
          present: e.present,
        })),
      },
    });
  } catch (err: any) {
    logger.error({ err }, "Error getting secrets status");
    res.status(500).json({
      success: false,
      error: "Failed to get secret status",
    });
  }
});

// ============================================================================
// ENVIRONMENT VALIDATION ENDPOINTS
// ============================================================================

/**
 * GET /api/security/env/report
 * Returns comprehensive environment validation report
 */
router.get("/api/security/env/report", (req: Request, res: Response) => {
  try {
    const validator = getEnvironmentValidator();
    const report = validator.getEnvironmentReport();

    res.json({
      success: true,
      data: {
        timestamp: report.timestamp,
        node_env: report.node_env,
        system_mode: report.system_mode,
        port: report.port,
        live_trading_enabled: report.live_trading_enabled,
        is_production_safe: report.is_production_safe,
        issues: report.issues,
        checks: report.checks,
        issue_count: report.issues.length,
        fatal_count: report.issues.filter((i) => i.severity === "fatal").length,
        critical_count: report.issues.filter((i) => i.severity === "critical").length,
        warning_count: report.issues.filter((i) => i.severity === "warning").length,
      },
    });
  } catch (err: any) {
    logger.error({ err }, "Error getting environment report");
    res.status(500).json({
      success: false,
      error: "Failed to get environment report",
    });
  }
});

/**
 * GET /api/security/env/safe
 * Returns boolean indicating if production is safe
 */
router.get("/api/security/env/safe", (req: Request, res: Response) => {
  try {
    const validator = getEnvironmentValidator();
    const isSafe = validator.isProductionSafe();

    res.json({
      success: true,
      data: {
        is_production_safe: isSafe,
        timestamp: Date.now(),
      },
    });
  } catch (err: any) {
    logger.error({ err }, "Error checking production safety");
    res.status(500).json({
      success: false,
      error: "Failed to check production safety",
    });
  }
});

// ============================================================================
// PRIVILEGED ACTION ENDPOINTS
// ============================================================================

/**
 * POST /api/security/actions/sign
 * Request body: { operator_id, action_type, resource_id }
 * Returns action_id for later approval
 */
router.post("/api/security/actions/sign", (req: Request, res: Response) => {
  try {
    const { operator_id, action_type, resource_id } = req.body;
    const ip_address = req.ip || "unknown";

    if (!operator_id) {
      res.status(400).json({
        success: false,
        error: "operator_id required",
      });
      return;
    }

    if (!action_type) {
      res.status(400).json({
        success: false,
        error: "action_type required",
      });
      return;
    }

    if (!resource_id) {
      res.status(400).json({
        success: false,
        error: "resource_id required",
      });
      return;
    }

    const authManager = getOperatorAuthManager();
    const result = authManager.signAction(operator_id, action_type, resource_id, ip_address);

    if (!result.success) {
      res.status(400).json({
        success: false,
        error: result.error,
      });
      return;
    }

    res.json({
      success: true,
      data: {
        action_id: result.action_id,
        action_type,
        resource_id,
        operator_id,
        timestamp: Date.now(),
      },
    });
  } catch (err: any) {
    logger.error({ err }, "Error signing action");
    res.status(500).json({
      success: false,
      error: "Failed to sign action",
    });
  }
});

/**
 * GET /api/security/actions/history
 * Query params: operator_id (optional), limit (default 100)
 * Returns action audit log
 */
router.get("/api/security/actions/history", (req: Request, res: Response) => {
  try {
    const operator_id = typeof req.query.operator_id === "string" ? req.query.operator_id : undefined;
    const limit = Math.min(
      Number.parseInt(req.query.limit as string, 10) || 100,
      500, // Max 500 to prevent excessive data
    );

    const authManager = getOperatorAuthManager();
    const history = authManager.getActionHistory(operator_id, limit);

    res.json({
      success: true,
      data: {
        actions: history,
        count: history.length,
        operator_id: operator_id || "all",
        timestamp: Date.now(),
      },
    });
  } catch (err: any) {
    logger.error({ err }, "Error getting action history");
    res.status(500).json({
      success: false,
      error: "Failed to get action history",
    });
  }
});

/**
 * GET /api/security/actions/privileged
 * Query params: limit (default 50)
 * Returns recent privileged actions
 */
router.get("/api/security/actions/privileged", (req: Request, res: Response) => {
  try {
    const limit = Math.min(
      Number.parseInt(req.query.limit as string, 10) || 50,
      200, // Max 200 for privileged actions
    );

    const authManager = getOperatorAuthManager();
    const privilegedActions = authManager.getPrivilegedActions(limit);
    const pendingCount = authManager.getPendingApprovalCount();

    res.json({
      success: true,
      data: {
        privileged_actions: privilegedActions,
        count: privilegedActions.length,
        pending_approval_count: pendingCount,
        timestamp: Date.now(),
      },
    });
  } catch (err: any) {
    logger.error({ err }, "Error getting privileged actions");
    res.status(500).json({
      success: false,
      error: "Failed to get privileged actions",
    });
  }
});

// ============================================================================
// PERMISSION & SECURITY POSTURE ENDPOINTS
// ============================================================================

/**
 * GET /api/security/permissions
 * Returns permission coverage map showing which routes are protected
 */
router.get("/api/security/permissions", (req: Request, res: Response) => {
  try {
    // Permission coverage map
    const permissions = {
      admin_routes: {
        "/api/security/*": "operator_token_required",
        "/api/autonomy/*": "operator_token_required",
        "/api/execution/*": "operator_token_required",
        "/api/governance/*": "session_auth_required",
      },
      public_routes: {
        "/health": "no_auth",
        "/api/features": "no_auth",
        "/api/explain": "no_auth",
      },
      protected_routes: {
        "/api/signals/*": "session_auth_required",
        "/api/backtest/*": "session_auth_required",
        "/api/lab/*": "session_auth_required",
        "/api/portfolio/*": "session_auth_required",
      },
    };

    res.json({
      success: true,
      data: {
        permissions,
        timestamp: Date.now(),
      },
    });
  } catch (err: any) {
    logger.error({ err }, "Error getting permissions");
    res.status(500).json({
      success: false,
      error: "Failed to get permissions",
    });
  }
});

/**
 * GET /api/security/summary
 * Overall security posture summary combining all checks
 */
router.get("/api/security/summary", (req: Request, res: Response) => {
  try {
    const secretsManager = getSecretsManager();
    const authManager = getOperatorAuthManager();
    const validator = getEnvironmentValidator();

    const secretStatus = secretsManager.getSecretStatus();
    const envReport = validator.getEnvironmentReport();
    const pendingApprovals = authManager.getPendingApprovalCount();

    // Calculate overall security score (0-100)
    let score = 100;

    // Deduct for missing secrets
    if (!secretStatus.all_required_present) score -= 15;
    if (!secretStatus.paper_present) score -= 10;
    if (!secretStatus.shared_present) score -= 20;

    // Deduct for unsafe configs
    const criticalIssues = envReport.issues.filter((i) => i.severity === "critical").length;
    const warningIssues = envReport.issues.filter((i) => i.severity === "warning").length;

    score -= criticalIssues * 5;
    score -= warningIssues * 2;

    // Deduct for pending approvals
    if (pendingApprovals > 0) score -= Math.min(pendingApprovals, 5);

    // Ensure score is bounded 0-100
    score = Math.max(0, Math.min(100, score));

    // Determine overall status
    const status =
      score >= 90 ? "excellent" : score >= 70 ? "good" : score >= 50 ? "fair" : "critical";

    res.json({
      success: true,
      data: {
        security_score: score,
        status,
        timestamp: Date.now(),
        secrets: {
          all_required_present: secretStatus.all_required_present,
          paper_present: secretStatus.paper_present,
          live_present: secretStatus.live_present,
          shared_present: secretStatus.shared_present,
          unsafe_configs_count: secretStatus.unsafe_configs.length,
        },
        environment: {
          node_env: envReport.node_env,
          system_mode: envReport.system_mode,
          is_production_safe: envReport.is_production_safe,
          issues_count: envReport.issues.length,
          critical_count: criticalIssues,
          warning_count: warningIssues,
        },
        operations: {
          pending_approvals: pendingApprovals,
        },
        recommendations: this.getSecurityRecommendations(secretStatus, envReport, pendingApprovals),
      },
    });
  } catch (err: any) {
    logger.error({ err }, "Error getting security summary");
    res.status(500).json({
      success: false,
      error: "Failed to get security summary",
    });
  }
});

/**
 * Helper function to generate security recommendations
 */
function getSecurityRecommendations(
  secretStatus: any,
  envReport: any,
  pendingApprovals: number,
): string[] {
  const recommendations: string[] = [];

  if (!secretStatus.all_required_present) {
    recommendations.push("Add missing required secrets to environment");
  }

  if (!secretStatus.paper_present) {
    recommendations.push("Configure paper trading credentials (ALPACA_PAPER_API_KEY, ALPACA_PAPER_SECRET_KEY)");
  }

  if (envReport.issues.length > 0) {
    recommendations.push(`Fix ${envReport.issues.length} environment configuration issues`);
  }

  if (!envReport.is_production_safe && process.env.NODE_ENV === "production") {
    recommendations.push("CRITICAL: Production environment is not safe — address all issues before deployment");
  }

  if (pendingApprovals > 0) {
    recommendations.push(`Review and approve ${pendingApprovals} pending privileged actions`);
  }

  if (recommendations.length === 0) {
    recommendations.push("All security checks passing — continue monitoring");
  }

  return recommendations;
}

export default router;
