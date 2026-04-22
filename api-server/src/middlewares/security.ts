/**
 * Security middleware — helmet-style headers + API key auth.
 * Zero external dependencies.
 */
import type { Request, Response, NextFunction } from "express";
import { createHash, timingSafeEqual as cryptoTimingSafeEqual } from "node:crypto";
import { logger } from "../lib/logger";

/* ── Security Headers ─────────────────────────────────────────────── */

/**
 * Sets security headers (subset of helmet defaults, no dependency).
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  // Prevent MIME sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");
  // XSS protection (legacy browsers)
  res.setHeader("X-XSS-Protection", "0");
  // Prevent clickjacking
  res.setHeader("X-Frame-Options", "DENY");
  // Referrer policy
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // Content Security Policy (API only)
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  // Strict Transport Security (1 year, include subdomains)
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  // Permissions Policy — disable dangerous features
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );

  next();
}

/* ── API Key Authentication ───────────────────────────────────────── */

const API_KEY = process.env["GODSVIEW_API_KEY"];

/**
 * Optional API key gate.
 * If GODSVIEW_API_KEY is set, every request must include:
 *   Authorization: Bearer <key>
 * or
 *   X-API-Key: <key>
 *
 * If GODSVIEW_API_KEY is NOT set, all requests pass (dev mode).
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  // If no key is configured, skip auth (development mode)
  if (!API_KEY) {
    next();
    return;
  }

  // Extract from Authorization header or X-API-Key header
  let token: string | undefined;

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  }

  if (!token) {
    const xApiKey = req.headers["x-api-key"];
    if (typeof xApiKey === "string") {
      token = xApiKey;
    }
  }

  if (!token) {
    logger.warn({ ip: req.ip, path: req.path }, "Missing API key");
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  // Constant-time comparison to prevent timing attacks
  if (!timingSafeEqual(token, API_KEY)) {
    logger.warn({ ip: req.ip, path: req.path }, "Invalid API key");
    res.status(403).json({ error: "Invalid API key" });
    return;
  }

  next();
}

/**
 * Length-safe constant-time string comparison.
 *
 * SHA-256 both sides so the compared buffers are always 32 bytes, then use
 * Node's native timingSafeEqual. This avoids the classic timing side-channel
 * where an early `a.length !== b.length` branch leaks the expected key length.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const bufA = createHash("sha256").update(a, "utf8").digest();
  const bufB = createHash("sha256").update(b, "utf8").digest();
  return cryptoTimingSafeEqual(bufA, bufB);
}

/* ── Request Size Limiter ─────────────────────────────────────────── */

/**
 * Reject bodies larger than maxBytes (default 1MB).
 * Express.json() has a default 100kb limit; this is a secondary guard.
 */
export function bodySizeGuard(maxBytes = 1_048_576) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const contentLength = req.headers["content-length"];
    if (contentLength && Number(contentLength) > maxBytes) {
      res.status(413).json({ error: "Request body too large" });
      return;
    }
    next();
  };
}
