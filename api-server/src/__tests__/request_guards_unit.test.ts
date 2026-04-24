/**
 * request_guards_unit.test.ts — Phase 65
 *
 * Tests createRateLimiter and securityHeadersMiddleware without
 * starting a real HTTP server — exercises the middleware directly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRateLimiter, securityHeadersMiddleware } from "../lib/request_guards";
import type { Request, Response, NextFunction } from "express";

// ── Minimal mock helpers ──────────────────────────────────────────────────────

function makeMockReq(overrides: Partial<Request> = {}): Request {
  return {
    path: "/api/signals",
    method: "GET",
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" } as any,
    ...overrides,
  } as unknown as Request;
}

function makeMockRes(): { res: Response; headers: Record<string, string>; statusCode: number; body: unknown } {
  const store: { headers: Record<string, string>; statusCode: number; body: unknown } = {
    headers: {}, statusCode: 200, body: null,
  };
  const res = {
    setHeader: vi.fn((k: string, v: string) => { store.headers[k] = v; }),
    status: vi.fn((code: number) => { store.statusCode = code; return res; }),
    json: vi.fn((b: unknown) => { store.body = b; }),
  } as unknown as Response;
  return { res, ...store };
}

function makeNext(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

// ── securityHeadersMiddleware ─────────────────────────────────────────────────

describe("securityHeadersMiddleware", () => {
  it("sets X-Content-Type-Options: nosniff", () => {
    const { res, headers } = makeMockRes();
    const next = makeNext();
    securityHeadersMiddleware(makeMockReq(), res, next);
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("sets X-Frame-Options: DENY", () => {
    const { res, headers } = makeMockRes();
    const next = makeNext();
    securityHeadersMiddleware(makeMockReq(), res, next);
    expect(headers["X-Frame-Options"]).toBe("DENY");
  });

  it("sets Referrer-Policy: no-referrer", () => {
    const { res, headers } = makeMockRes();
    const next = makeNext();
    securityHeadersMiddleware(makeMockReq(), res, next);
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
  });

  it("calls next()", () => {
    const { res } = makeMockRes();
    const next = makeNext();
    securityHeadersMiddleware(makeMockReq(), res, next);
    expect(next).toHaveBeenCalledOnce();
  });
});

// ── createRateLimiter ─────────────────────────────────────────────────────────

describe("createRateLimiter", () => {
  let middleware: ReturnType<typeof createRateLimiter>;

  beforeEach(() => {
    middleware = createRateLimiter({ windowMs: 60_000, max: 5 });
  });

  it("allows first request and sets rate limit headers", () => {
    const { res, headers } = makeMockRes();
    const next = makeNext();
    middleware(makeMockReq(), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(headers["X-RateLimit-Limit"]).toBe("5");
    expect(Number(headers["X-RateLimit-Remaining"])).toBeGreaterThanOrEqual(0);
  });

  it("allows requests up to max limit", () => {
    for (let i = 0; i < 5; i++) {
      const { res } = makeMockRes();
      const next = makeNext();
      middleware(makeMockReq({ ip: "10.0.0.1" }), res, next);
      expect(next).toHaveBeenCalledOnce();
    }
  });

  it("blocks request exceeding max limit with 429", () => {
    const ip = "10.0.0.2";
    // Exhaust the limit
    for (let i = 0; i < 5; i++) {
      middleware(makeMockReq({ ip }), makeMockRes().res, makeNext());
    }
    // 6th request should be blocked
    const { res } = makeMockRes();
    const next = makeNext();
    middleware(makeMockReq({ ip }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "rate_limit_exceeded" }),
    );
  });

  it("skips rate limiting for /healthz", () => {
    const ip = "10.0.0.3";
    // Exhaust on regular path first
    for (let i = 0; i < 10; i++) {
      middleware(makeMockReq({ ip }), makeMockRes().res, makeNext());
    }
    // /healthz should still pass
    const { res } = makeMockRes();
    const next = makeNext();
    middleware(makeMockReq({ path: "/healthz", ip }), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("skips rate limiting for /readyz", () => {
    const ip = "10.0.0.4";
    for (let i = 0; i < 10; i++) {
      middleware(makeMockReq({ ip }), makeMockRes().res, makeNext());
    }
    const { res } = makeMockRes();
    const next = makeNext();
    middleware(makeMockReq({ path: "/readyz", ip }), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("sets Retry-After header on 429", () => {
    const ip = "10.0.0.5";
    for (let i = 0; i <= 5; i++) {
      middleware(makeMockReq({ ip }), makeMockRes().res, makeNext());
    }
    const { res, headers } = makeMockRes();
    middleware(makeMockReq({ ip }), res, makeNext());
    expect(Number(headers["Retry-After"])).toBeGreaterThanOrEqual(1);
  });

  it("uses socket.remoteAddress when ip is absent", () => {
    const req = {
      path: "/test", method: "GET",
      ip: undefined,
      socket: { remoteAddress: "192.168.1.1" },
    } as unknown as Request;
    const { res } = makeMockRes();
    const next = makeNext();
    expect(() => middleware(req, res, next)).not.toThrow();
    expect(next).toHaveBeenCalledOnce();
  });

  it("different IPs get separate buckets", () => {
    const lim = createRateLimiter({ windowMs: 60_000, max: 2 });
    // Exhaust IP A
    for (let i = 0; i < 3; i++) lim(makeMockReq({ ip: "1.2.3.4" }), makeMockRes().res, makeNext());
    // IP B should still pass
    const { res } = makeMockRes();
    const next = makeNext();
    lim(makeMockReq({ ip: "5.6.7.8" }), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});
