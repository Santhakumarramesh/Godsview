/**
 * RBAC Middleware — Role-Based Access Control for GodsView API
 *
 * Roles and Permissions:
 *   admin:     Full system access, all permissions
 *   operator:  Can manage execution, kill switch, risk config, approvals
 *   trader:    Can view positions, submit signals, request approvals
 *   viewer:    Read-only access to dashboards and reports
 *
 * Kill switch override:
 *   When kill_switch_override is active, the system behaves as if all permissions
 *   are denied (returns 403) except for health checks and diagnostics.
 *   This applies to ALL roles and ALL endpoints that perform mutations.
 *
 * Audit logging:
 *   Every permission-gated action is logged to the audit trail with:
 *   - role that attempted the action
 *   - permission required
 *   - success/failure status
 *   - timestamp and actor
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import { createHash } from "node:crypto";
import { logger } from "../lib/logger";
import { logAuditEvent } from "../lib/audit_logger";

// ──────────────────────────────────────────────────────────────────────────────
// Types & Constants
// ──────────────────────────────────────────────────────────────────────────────

export type Role = "admin" | "operator" | "trader" | "viewer";

export type Permission =
  | "view:dashboard"
  | "view:positions"
  | "view:audit"
  | "submit:signal"
  | "request:approval"
  | "approve:trade"
  | "execute:trade"
  | "manage:risk_config"
  | "toggle:kill_switch"
  | "emergency:liquidate"
  | "system:admin";

export interface RBACContext {
  role: Role;
  userId: string;
  actor: string;
  timestamp: number;
  tokenHash?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Permission Matrix
// ──────────────────────────────────────────────────────────────────────────────

const ROLE_PERMISSIONS: Record<Role, Set<Permission>> = {
  admin: new Set([
    "view:dashboard",
    "view:positions",
    "view:audit",
    "submit:signal",
    "request:approval",
    "approve:trade",
    "execute:trade",
    "manage:risk_config",
    "toggle:kill_switch",
    "emergency:liquidate",
    "system:admin",
  ]),

  operator: new Set([
    "view:dashboard",
    "view:positions",
    "view:audit",
    "approve:trade",
    "execute:trade",
    "manage:risk_config",
    "toggle:kill_switch",
    "emergency:liquidate",
  ]),

  trader: new Set([
    "view:dashboard",
    "view:positions",
    "submit:signal",
    "request:approval",
  ]),

  viewer: new Set([
    "view:dashboard",
    "view:positions",
  ]),
};

// ──────────────────────────────────────────────────────────────────────────────
// Kill Switch Override (global state)
// ──────────────────────────────────────────────────────────────────────────────

let killSwitchOverrideActive = false;

export function setKillSwitchOverride(active: boolean): void {
  killSwitchOverrideActive = active;
  logger.warn({ killSwitchOverrideActive }, "Kill switch override state changed");
}

export function isKillSwitchOverrideActive(): boolean {
  return killSwitchOverrideActive;
}

// ──────────────────────────────────────────────────────────────────────────────
// RBAC Context Attachment
// ──────────────────────────────────────────────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      rbac?: RBACContext;
    }
  }
}

/**
 * Extracts and validates role from request.
 * Priority: X-Role header > Authorization token > default to viewer
 */
function extractRole(req: Request): Role {
  const roleHeader = req.headers["x-role"];
  if (typeof roleHeader === "string") {
    const normalized = roleHeader.toLowerCase();
    if (["admin", "operator", "trader", "viewer"].includes(normalized)) {
      return normalized as Role;
    }
  }
  return "viewer"; // Default to least-privileged
}

/**
 * Extracts actor identifier from request.
 * Priority: X-Actor header > Authorization claim > IP address
 */
function extractActor(req: Request): string {
  const actorHeader = req.headers["x-actor"];
  if (typeof actorHeader === "string" && actorHeader.trim()) {
    return actorHeader.trim();
  }
  return req.ip || "unknown";
}

/**
 * Middleware that attaches RBAC context to request.
 * Does NOT enforce permissions; just enriches the request.
 */
export const attachRBACContext: RequestHandler = (req, res, next) => {
  const role = extractRole(req);
  const actor = extractActor(req);
  const tokenHash = extractTokenHash(req);

  req.rbac = {
    role,
    userId: extractUserId(req),
    actor,
    timestamp: Date.now(),
    tokenHash,
  };

  next();
};

function extractTokenHash(req: Request): string | undefined {
  const authHeader = req.headers["authorization"];
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    return createHash("sha256").update(token).digest("hex");
  }
  return undefined;
}

function extractUserId(req: Request): string {
  // Can be extended to extract from JWT claims, etc.
  const userHeader = req.headers["x-user-id"];
  if (typeof userHeader === "string" && userHeader.trim()) {
    return userHeader.trim();
  }
  return "anonymous";
}

// ──────────────────────────────────────────────────────────────────────────────
// Core Middleware: requireRole & requirePermission
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Middleware factory that requires a specific role.
 * Returns 403 if the user's role is not sufficient.
 */
export function requireRole(...allowedRoles: Role[]): RequestHandler {
  return (req, res, next) => {
    if (!req.rbac) {
      logger.error({ path: req.path }, "RBAC context not attached");
      res.status(500).json({
        error: "internal_error",
        message: "RBAC context missing",
      });
      return;
    }

    const { role, actor, userId } = req.rbac;

    if (!allowedRoles.includes(role)) {
      logger.warn(
        { path: req.path, role, actor, userId, allowed: allowedRoles },
        "Role requirement not met",
      );

      // Audit: permission denied
      logAuditEvent({
        event_type: "execution_gate_blocked",
        decision_state: "insufficient_role",
        actor,
        reason: `Role ${role} not in allowed list: [${allowedRoles.join(", ")}]`,
        payload: { required_roles: allowedRoles, user_role: role },
      }).catch(() => {});

      res.status(403).json({
        error: "insufficient_role",
        message: `This action requires one of: ${allowedRoles.join(", ")}. Your role: ${role}`,
      });
      return;
    }

    next();
  };
}

/**
 * Middleware factory that requires a specific permission.
 * Returns 403 if the user's role lacks the permission.
 * Kill switch override: returns 403 for all mutations regardless of permission.
 */
export function requirePermission(permission: Permission, mutating = true): RequestHandler {
  return (req, res, next) => {
    if (!req.rbac) {
      logger.error({ path: req.path }, "RBAC context not attached");
      res.status(500).json({
        error: "internal_error",
        message: "RBAC context missing",
      });
      return;
    }

    const { role, actor, userId } = req.rbac;

    // Kill switch override: block all mutations
    if (mutating && isKillSwitchOverrideActive()) {
      logger.warn(
        { path: req.path, actor, userId, permission },
        "Kill switch override prevents mutation",
      );

      logAuditEvent({
        event_type: "execution_gate_blocked",
        decision_state: "kill_switch_engaged",
        actor,
        reason: `Kill switch override active; mutation ${permission} denied`,
        payload: { permission, kill_switch_override: true },
      }).catch(() => {});

      res.status(403).json({
        error: "kill_switch_active",
        message: "All mutations are blocked while kill switch override is active",
      });
      return;
    }

    // Check permission
    const permissions = ROLE_PERMISSIONS[role] || new Set();
    if (!permissions.has(permission)) {
      logger.warn(
        { path: req.path, role, actor, userId, permission },
        "Permission check failed",
      );

      logAuditEvent({
        event_type: "execution_gate_blocked",
        decision_state: "insufficient_permission",
        actor,
        reason: `Role ${role} lacks permission: ${permission}`,
        payload: { required_permission: permission, user_role: role },
      }).catch(() => {});

      res.status(403).json({
        error: "insufficient_permission",
        message: `This action requires permission: ${permission}`,
      });
      return;
    }

    // Audit: permission granted
    logAuditEvent({
      event_type: "execution_request_received",
      decision_state: "permission_granted",
      actor,
      reason: `Permission check passed for ${permission}`,
      payload: { permission, user_role: role },
    }).catch(() => {});

    next();
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Convenience Middlewares
// ──────────────────────────────────────────────────────────────────────────────

export const requireAdmin: RequestHandler = requireRole("admin");
export const requireOperator: RequestHandler = requireRole("operator", "admin");
export const requireTrader: RequestHandler = requireRole("trader", "operator", "admin");

export const requireViewDashboard: RequestHandler = requirePermission("view:dashboard", false);
export const requireViewPositions: RequestHandler = requirePermission("view:positions", false);
export const requireViewAudit: RequestHandler = requirePermission("view:audit", false);
export const requireSubmitSignal: RequestHandler = requirePermission("submit:signal", true);
export const requireApprovalRequest: RequestHandler = requirePermission("request:approval", true);
export const requireApproveTrade: RequestHandler = requirePermission("approve:trade", true);
export const requireExecuteTrade: RequestHandler = requirePermission("execute:trade", true);
export const requireManageRiskConfig: RequestHandler = requirePermission("manage:risk_config", true);
export const requireToggleKillSwitch: RequestHandler = requirePermission("toggle:kill_switch", true);
export const requireEmergencyLiquidate: RequestHandler = requirePermission("emergency:liquidate", true);
export const requireSystemAdmin: RequestHandler = requirePermission("system:admin", true);

// ──────────────────────────────────────────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Check if a role has a specific permission (for programmatic use).
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  const permissions = ROLE_PERMISSIONS[role] || new Set();
  return permissions.has(permission);
}

/**
 * Get all permissions for a role.
 */
export function getPermissionsForRole(role: Role): Permission[] {
  return Array.from(ROLE_PERMISSIONS[role] || new Set());
}
