/**
 * auth_guard.ts — Authentication and authorization middleware
 *
 * Validates bearer tokens and API keys, returning proper 401/403 responses.
 * Complements the existing security.ts middleware with additional permission checks.
 */

import type { Request, Response, NextFunction } from "express";
import { createHash, timingSafeEqual as cryptoTimingSafeEqual } from "node:crypto";
import { logger } from "../lib/logger";

// ── Constants ──────────────────────────────────────────────────────────

const API_KEY = process.env["GODSVIEW_API_KEY"];
const BEARER_TOKEN = process.env["GODSVIEW_BEARER_TOKEN"];

// Optional permission matrix (can be extended)
const PROTECTED_ROUTES: Record<string, string[]> = {
  "/api/audit": ["admin", "auditor"],
  "/api/execution": ["trader", "admin"],
  "/api/risk": ["risk_manager", "admin"],
  "/api/ops": ["operator", "admin"],
  "/api/settings": ["admin"],
};

// ── Types ──────────────────────────────────────────────────────────────

export interface AuthContext {
  userId?: string;
  apiKey?: string;
  token?: string;
  permissions?: string[];
  role?: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

// ── Helper: Timing-safe comparison ────────────────────────────────────

/**
 * Length-safe constant-time string comparison.
 * SHA-256 both sides so the compared buffers are always 32 bytes, then use
 * Node's native timingSafeEqual. This avoids timing side-channels.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const bufA = createHash("sha256").update(a, "utf8").digest();
  const bufB = createHash("sha256").update(b, "utf8").digest();
  try {
    return cryptoTimingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

// ── Middleware: Extract and validate token ────────────────────────────

/**
 * Extract authentication token from Authorization header or X-API-Key.
 * Populates req.auth with extracted credentials.
 */
export function extractAuth(req: Request, res: Response, next: NextFunction): void {
  req.auth = {};

  // Try Bearer token first
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    if (token.trim()) {
      req.auth.token = token;
      // Optionally validate token format (JWT, etc.)
      if (token.startsWith("sk_") || token.startsWith("pk_")) {
        // Looks like our token format
        req.auth.apiKey = token;
      }
    }
  }

  // Fallback to X-API-Key header
  if (!req.auth.token) {
    const xApiKey = req.headers["x-api-key"];
    if (typeof xApiKey === "string" && xApiKey.trim()) {
      req.auth.apiKey = xApiKey;
      req.auth.token = xApiKey;
    }
  }

  next();
}

// ── Middleware: Require authentication ────────────────────────────────

/**
 * Middleware to require valid authentication.
 * Returns 401 if no valid token/API key is present.
 * Can be applied globally or per-route.
 *
 * Usage:
 *   app.use('/api/protected', requireAuth);
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // If no auth is configured, allow all (development mode)
  if (!API_KEY && !BEARER_TOKEN) {
    req.auth = req.auth || {};
    next();
    return;
  }

  if (!req.auth?.token) {
    logger.warn(
      { ip: req.ip, path: req.path, method: req.method },
      "Missing authentication token",
    );
    res.status(401).json({
      error: "unauthorized",
      message: "Authentication required. Include Authorization: Bearer <token> or X-API-Key: <key>",
    });
    return;
  }

  // Validate token against configured keys
  const token = req.auth.token;
  let isValid = false;

  if (API_KEY && timingSafeEqual(token, API_KEY)) {
    isValid = true;
    req.auth.apiKey = token;
  }

  if (BEARER_TOKEN && timingSafeEqual(token, BEARER_TOKEN)) {
    isValid = true;
    // Extract user ID from token if it's a JWT
    try {
      const parts = token.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
        req.auth.userId = payload.sub || payload.user_id;
        req.auth.role = payload.role;
        req.auth.permissions = payload.permissions || [];
      }
    } catch {
      // Not a JWT or parsing failed, skip extraction
    }
  }

  if (!isValid) {
    logger.warn(
      { ip: req.ip, path: req.path, method: req.method },
      "Invalid authentication token",
    );
    res.status(403).json({
      error: "forbidden",
      message: "Invalid or expired token",
    });
    return;
  }

  next();
}

// ── Middleware: Check permissions ──────────────────────────────────────

/**
 * Check if the authenticated user has required permissions.
 * Returns 403 if insufficient permissions.
 *
 * Usage:
 *   app.use('/api/admin', requirePermission("admin"));
 *   app.use('/api/traders', requirePermission("trader", "admin"));
 */
export function requirePermission(...requiredRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth?.role && !req.auth?.permissions) {
      // If no role/permissions are set, allow (e.g., API key auth)
      next();
      return;
    }

    const userRole = req.auth.role;
    const userPermissions = req.auth.permissions || [];

    const hasRole = requiredRoles.some(
      (role) => userRole === role || userPermissions.includes(role),
    );

    if (!hasRole) {
      logger.warn(
        { ip: req.ip, path: req.path, method: req.method, userRole, requiredRoles },
        "Insufficient permissions",
      );
      res.status(403).json({
        error: "forbidden",
        message: `This operation requires one of: ${requiredRoles.join(", ")}`,
      });
      return;
    }

    next();
  };
}

// ── Middleware: Route-based permission check ──────────────────────────

/**
 * Automatically check permissions based on the request route.
 * Uses the PROTECTED_ROUTES mapping.
 *
 * Usage:
 *   app.use(checkRoutePermissions);
 */
export function checkRoutePermissions(req: Request, res: Response, next: NextFunction): void {
  // Check if this route requires special permissions
  const routePrefix = Object.keys(PROTECTED_ROUTES).find((prefix) =>
    req.path.startsWith(prefix),
  );

  if (!routePrefix) {
    next();
    return;
  }

  const requiredRoles = PROTECTED_ROUTES[routePrefix];

  if (!req.auth?.role && !req.auth?.permissions) {
    // No role/permissions set, allow
    next();
    return;
  }

  const userRole = req.auth.role;
  const userPermissions = req.auth.permissions || [];

  const hasRole = requiredRoles.some(
    (role) => userRole === role || userPermissions.includes(role),
  );

  if (!hasRole) {
    logger.warn(
      { ip: req.ip, path: req.path, method: req.method, userRole, requiredRoles },
      "Insufficient permissions for route",
    );
    res.status(403).json({
      error: "forbidden",
      message: `This endpoint requires one of: ${requiredRoles.join(", ")}`,
    });
    return;
  }

  next();
}

// ── Middleware: Optional auth (adds context but doesn't require) ──────

/**
 * Extract authentication context but don't fail if missing.
 * Useful for endpoints that work both with and without auth.
 *
 * Usage:
 *   app.use(optionalAuth);
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  extractAuth(req, res, () => {
    // Validation is optional, so just continue
    next();
  });
}
