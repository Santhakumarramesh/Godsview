import type { RequestHandler } from "express";

interface RateLimiterOptions {
  windowMs: number;
  max: number;
}

interface BucketState {
  count: number;
  resetAt: number;
}

function shouldSkipRateLimit(pathname: string): boolean {
  // Inside a middleware mounted at "/api", req.path strips the prefix,
  // so /api/healthz appears here as "/healthz". We accept both shapes
  // for safety in case the limiter is moved to a global mount later.
  return (
    pathname === "/healthz" ||
    pathname === "/readyz" ||
    pathname === "/api/healthz" ||
    pathname === "/api/readyz"
  );
}

export function createRateLimiter(options: RateLimiterOptions): RequestHandler {
  const buckets = new Map<string, BucketState>();
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets.entries()) {
      if (now >= bucket.resetAt) {
        buckets.delete(key);
      }
    }
  }, Math.min(options.windowMs, 30_000));
  cleanupInterval.unref();

  return (req, res, next) => {
    if (shouldSkipRateLimit(req.path)) {
      next();
      return;
    }

    const now = Date.now();
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const key = `${ip}:${req.method}`;
    const current = buckets.get(key);

    if (!current || now >= current.resetAt) {
      const fresh: BucketState = { count: 1, resetAt: now + options.windowMs };
      buckets.set(key, fresh);
      res.setHeader("X-RateLimit-Limit", String(options.max));
      res.setHeader("X-RateLimit-Remaining", String(Math.max(options.max - fresh.count, 0)));
      res.setHeader("X-RateLimit-Reset", String(Math.ceil(fresh.resetAt / 1000)));
      next();
      return;
    }

    current.count += 1;
    const remaining = Math.max(options.max - current.count, 0);
    res.setHeader("X-RateLimit-Limit", String(options.max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(current.resetAt / 1000)));

    if (current.count > options.max) {
      const retryAfterSeconds = Math.max(Math.ceil((current.resetAt - now) / 1000), 1);
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({
        error: "rate_limit_exceeded",
        message: "Too many requests. Retry after cooldown window.",
        retry_after_seconds: retryAfterSeconds,
      });
      return;
    }

    next();
  };
}

export const securityHeadersMiddleware: RequestHandler = (_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  // CSP: Allow self-hosted scripts + inline styles (for dashboard), CDN for fonts/charts,
  // and API connections to self. Block all other sources.
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "connect-src 'self' wss: https://paper-api.alpaca.markets https://data.alpaca.markets",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  );
  next();
};
