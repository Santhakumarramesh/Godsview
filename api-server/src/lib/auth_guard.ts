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

  // 4. Query param (for GET requests, less secure but useful for testing)
  if (typeof req.query?.token === "string" && req.query.token.trim()) {
    return req.query.token.trim();
  }

  return null;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
