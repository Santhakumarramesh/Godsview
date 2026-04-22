/**
 * Auth Guard — Protects dangerous execution endpoints.
 *
 * Three auth levels:
 * 1. PUBLIC    — health, metrics, read-only status (no auth)
 * 2. API_KEY   — signal pipeline, dashboard data (optional API key)
 * 3. OPERATOR  — kill switch, emergency close, live execution (operator token required)
 *
 * The operator token is a shared secret set via GODSVIEW_OPERATOR_TOKEN.
 * In production, this should be a long random string rotated periodically.
 */

import type { RequestHandler } from "express";
import { createHash, timingSafeEqual as cryptoTimingSafeEqual } from "node:crypto";
import { logger } from "./logger";

const OPERATOR_TOKEN = (process.env.GODSVIEW_OPERATOR_TOKEN ?? "").trim();
const API_KEY = (process.env.GODSVIEW_API_KEY ?? "").trim();

/**
 * Middleware that requires operator-level authentication.
 * Checks: Authorization: Bearer <token> or X-Operator-Token header or body.operator_token
 */
export const requireOperator: RequestHandler = (req, res, next) => {
  const token = extractToken(req);

  if (!OPERATOR_TOKEN) {
    // No operator token configured — block all operator actions
    logger.warn({ path: req.path, method: req.method }, "Operator action attempted but no token configured");
    res.status(403).json({
      error: "operator_token_required",
      message: "GODSVIEW_OPERATOR_TOKEN must be configured for this action",
    });
    return;
  }

  if (!token) {
    res.status(401).json({
      error: "unauthorized",
      message: "Operator token required. Send via Authorization: Bearer <token> or X-Operator-Token header.",
    });
    return;
  }

  // Constant-time comparison to prevent timing attacks
  if (!timingSafeEqual(token, OPERATOR_TOKEN)) {
    logger.warn({ path: req.path, method: req.method, ip: req.ip }, "Invalid operator token");
    res.status(403).json({
      error: "forbidden",
      message: "Invalid operator token",
    });
    return;
  }

  next();
};

/**
 * Middleware that requires API key authentication (lighter than operator).
 * Falls through if no API key is configured (open access mode).
 */
export const requireApiKey: RequestHandler = (req, res, next) => {
  if (!API_KEY) {
    // No API key configured — allow all (development mode)
    next();
    return;
  }

  const token = extractToken(req);
  if (!token || !timingSafeEqual(token, API_KEY)) {
    res.status(401).json({
      error: "unauthorized",
      message: "Valid API key required",
    });
    return;
  }

  next();
};

// ── Helpers ───────────────────────────────────────────

function extractToken(req: any): string | null {
  // 1. Authorization: Bearer <token>
  const authHeader = req.headers["authorization"];
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  // 2. X-Operator-Token header
  const opHeader = req.headers["x-operator-token"];
  if (typeof opHeader === "string" && opHeader.trim()) {
    return opHeader.trim();
  }

  // 3. Body field (for POST requests)
  if (req.body?.operator_token && typeof req.body.operator_token === "string") {
    return req.body.operator_token.trim();
  }

  // NOTE: Query-parameter tokens are intentionally NOT supported.
  // They get written to ALB/CloudFront access logs, browser history,
  // and upstream proxy logs, which leaks the operator secret.
  // Use the Authorization: Bearer header or X-Operator-Token instead.

  return null;
}

/**
 * Length-safe constant-time token comparison.
 *
 * We hash both sides with SHA-256 first so the compared buffers always have
 * the same length (32 bytes). This eliminates the classic timing side-channel
 * where an early `a.length !== b.length` return leaks the expected token
 * length to an attacker. The hashes are then compared with Node's native
 * crypto.timingSafeEqual which runs in constant time.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const bufA = createHash("sha256").update(a, "utf8").digest();
  const bufB = createHash("sha256").update(b, "utf8").digest();
  return cryptoTimingSafeEqual(bufA, bufB);
}

export const authGuard = requireOperator;
