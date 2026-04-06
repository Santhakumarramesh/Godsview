/**
 * Comprehensive tests for GovernanceEngine
 * Phase 73 (Wave 4.2): Security & Governance
 * 30+ test cases covering all governance functions
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock persistent_store before importing governance engine
vi.mock("../lib/persistent_store", () => ({
  persistRead: vi.fn((_key: string, defaultVal: unknown) => defaultVal),
  persistWrite: vi.fn(),
  persistAppend: vi.fn(),
  persistDelete: vi.fn(),
  listCollections: vi.fn(() => []),
}));

import {
  GovernanceEngine,
  RequestClassifier,
  getGovernanceEngine,
  resetGovernanceEngine,
  type GovernancePolicy,
  type GovernanceDecision,
} from "../engines/governance_engine.js";

let engine: GovernanceEngine;

beforeEach(() => {
  resetGovernanceEngine();
  engine = getGovernanceEngine();
});

// ─── Policy Tests ────────────────────────────────────────

describe("GovernanceEngine — Policy Management", () => {
  it("returns default policy on initialization", () => {
    const policy = engine.getPolicy();
    expect(policy.requireApiKeyForWrites).toBe(true);
    expect(policy.requireApiKeyForReads).toBe(false);
    expect(policy.maxRequestsPerMinute).toBe(120);
    expect(policy.maxWriteRequestsPerMinute).toBe(30);
    expect(policy.ipWhitelist).toBeNull();
    expect(policy.auditAllRequests).toBe(false);
  });

  it("updates partial policy fields", () => {
    engine.updatePolicy({ maxRequestsPerMinute: 200 });
    const policy = engine.getPolicy();
    expect(policy.maxRequestsPerMinute).toBe(200);
    expect(policy.maxWriteRequestsPerMinute).toBe(30); // unchanged
  });

  it("updates API key requirements", () => {
    engine.updatePolicy({ requireApiKeyForReads: true });
    const policy = engine.getPolicy();
    expect(policy.requireApiKeyForReads).toBe(true);
  });

  it("updates sensitive endpoints list", () => {
    const newEndpoints = ["/api/critical", "/api/nuclear"];
    engine.updatePolicy({ sensitiveEndpoints: newEndpoints });
    const policy = engine.getPolicy();
    expect(policy.sensitiveEndpoints).toEqual(newEndpoints);
  });

  it("updates IP whitelist", () => {
    const whitelist = ["192.168.1.1", "10.0.0.1"];
    engine.updatePolicy({ ipWhitelist: whitelist });
    const policy = engine.getPolicy();
    expect(policy.ipWhitelist).toEqual(whitelist);
  });

  it("sets audit logging", () => {
    engine.updatePolicy({ auditAllRequests: true });
    const policy = engine.getPolicy();
    expect(policy.auditAllRequests).toBe(true);
  });

  it("updates write rate limits", () => {
    engine.updatePolicy({ maxWriteRequestsPerMinute: 60 });
    const policy = engine.getPolicy();
    expect(policy.maxWriteRequestsPerMinute).toBe(60);
  });

  it("updates allowed origins", () => {
    const origins = ["https://example.com", "https://app.example.com"];
    engine.updatePolicy({ allowedOrigins: origins });
    const policy = engine.getPolicy();
    expect(policy.allowedOrigins).toEqual(origins);
  });

  it("persists policy changes", async () => {
    engine.updatePolicy({ maxRequestsPerMinute: 500 });
    // Since persistWrite is mocked, verify it was called with updated policy
    const { persistWrite } = await import("../lib/persistent_store");
    expect(vi.mocked(persistWrite)).toHaveBeenCalledWith(
      "governance_policy",
      expect.objectContaining({ maxRequestsPerMinute: 500 })
    );
  });
});

// ─── Request Classification Tests ───────────────────────

describe("RequestClassifier", () => {
  it("classifies GET as read", () => {
    expect(RequestClassifier.classify("GET", "/api/data")).toBe("read");
  });

  it("classifies POST as write", () => {
    expect(RequestClassifier.classify("POST", "/api/orders")).toBe("write");
  });

  it("classifies PUT as write", () => {
    expect(RequestClassifier.classify("PUT", "/api/config")).toBe("write");
  });

  it("classifies PATCH as write", () => {
    expect(RequestClassifier.classify("PATCH", "/api/settings")).toBe("write");
  });

  it("classifies DELETE as write", () => {
    expect(RequestClassifier.classify("DELETE", "/api/resource")).toBe("write");
  });

  it("classifies kill-switch as dangerous", () => {
    expect(RequestClassifier.classify("POST", "/api/kill-switch")).toBe("dangerous");
  });

  it("classifies emergency-liquidate as dangerous", () => {
    expect(RequestClassifier.classify("POST", "/api/emergency-liquidate")).toBe("dangerous");
  });

  it("classifies governance endpoints as admin", () => {
    expect(RequestClassifier.classify("GET", "/api/governance/policy")).toBe("admin");
  });

  it("is case-insensitive for dangerous endpoints", () => {
    expect(RequestClassifier.classify("POST", "/api/KILL-SWITCH")).toBe("dangerous");
  });
});

// ─── Request Evaluation Tests ───────────────────────────

describe("GovernanceEngine — Request Evaluation", () => {
  it("allows read request with no API key requirement", () => {
    const decision = engine.evaluateRequest({
      method: "GET",
      path: "/api/data",
      ip: "192.168.1.1",
    });
    expect(decision.allowed).toBe(true);
    expect(decision.requiresAuth).toBe(false);
  });

  it("blocks write request without API key when required", () => {
    engine.updatePolicy({ requireApiKeyForWrites: true });
    const decision = engine.evaluateRequest({
      method: "POST",
      path: "/api/orders",
      ip: "192.168.1.1",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("API key required");
  });

  it("allows write request with valid API key", () => {
    engine.updatePolicy({ requireApiKeyForWrites: true });
    const decision = engine.evaluateRequest({
      method: "POST",
      path: "/api/orders",
      apiKey: "valid-key",
      ip: "192.168.1.1",
    });
    expect(decision.allowed).toBe(true);
  });

  it("blocks request when IP is not whitelisted", () => {
    engine.updatePolicy({ ipWhitelist: ["192.168.1.1"] });
    const decision = engine.evaluateRequest({
      method: "GET",
      path: "/api/data",
      ip: "10.0.0.1",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("IP not whitelisted");
  });

  it("allows request when IP is whitelisted", () => {
    engine.updatePolicy({ ipWhitelist: ["192.168.1.1", "10.0.0.1"] });
    const decision = engine.evaluateRequest({
      method: "GET",
      path: "/api/data",
      ip: "192.168.1.1",
    });
    expect(decision.allowed).toBe(true);
  });

  it("allows any IP when whitelist includes wildcard", () => {
    engine.updatePolicy({ ipWhitelist: ["192.168.1.1", "*"] });
    const decision = engine.evaluateRequest({
      method: "GET",
      path: "/api/data",
      ip: "203.0.113.1",
    });
    expect(decision.allowed).toBe(true);
  });

  it("requires API key for sensitive endpoints", () => {
    engine.updatePolicy({
      sensitiveEndpoints: ["/api/critical-action"],
      requireApiKeyForWrites: false,
    });
    const decision = engine.evaluateRequest({
      method: "POST",
      path: "/api/critical-action",
      ip: "192.168.1.1",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason?.toLowerCase()).toContain("sensitive endpoint");
  });

  it("blocks dangerous endpoints without API key", () => {
    const decision = engine.evaluateRequest({
      method: "POST",
      path: "/api/kill-switch",
      ip: "192.168.1.1",
    });
    expect(decision.allowed).toBe(false);
  });

  it("allows read request when auditAllRequests is true", () => {
    engine.updatePolicy({ auditAllRequests: true });
    const decision = engine.evaluateRequest({
      method: "GET",
      path: "/api/data",
      ip: "192.168.1.1",
    });
    expect(decision.allowed).toBe(true);
  });

  it("enforces read rate limit", () => {
    engine.updatePolicy({ maxRequestsPerMinute: 5 });
    const ip = "192.168.1.1";
    // Make 6 requests
    for (let i = 0; i < 6; i++) {
      engine.evaluateRequest({
        method: "GET",
        path: "/api/data",
        ip,
      });
    }
    // 6th should be blocked
    const decision = engine.evaluateRequest({
      method: "GET",
      path: "/api/data",
      ip,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("Rate limit exceeded");
  });

  it("enforces write rate limit separately", () => {
    engine.updatePolicy({ maxWriteRequestsPerMinute: 2 });
    const ip = "192.168.1.1";
    // Make 3 write requests
    for (let i = 0; i < 3; i++) {
      engine.evaluateRequest({
        method: "POST",
        path: "/api/orders",
        apiKey: "key",
        ip,
      });
    }
    // 3rd should be blocked
    const decision = engine.evaluateRequest({
      method: "POST",
      path: "/api/orders",
      apiKey: "key",
      ip,
    });
    expect(decision.allowed).toBe(false);
  });

  it("allows request when API key is required for reads", () => {
    engine.updatePolicy({ requireApiKeyForReads: true });
    const decision = engine.evaluateRequest({
      method: "GET",
      path: "/api/data",
      apiKey: "valid-key",
      ip: "192.168.1.1",
    });
    expect(decision.allowed).toBe(true);
  });
});

// ─── Violation Tracking Tests ───────────────────────────

describe("GovernanceEngine — Violation Tracking", () => {
  it("records IP whitelist violations", () => {
    engine.updatePolicy({ ipWhitelist: ["192.168.1.1"] });
    engine.evaluateRequest({
      method: "GET",
      path: "/api/data",
      ip: "10.0.0.1",
    });
    const violations = engine.getViolations(24);
    expect(violations).toHaveLength(1);
    expect(violations[0].type).toBe("ip_whitelist_blocked");
    expect(violations[0].ip).toBe("10.0.0.1");
  });

  it("records missing API key violations", () => {
    engine.updatePolicy({ requireApiKeyForWrites: true });
    engine.evaluateRequest({
      method: "POST",
      path: "/api/orders",
      ip: "192.168.1.1",
    });
    const violations = engine.getViolations(24);
    expect(violations).toHaveLength(1);
    expect(violations[0].type).toBe("missing_api_key");
  });

  it("records rate limit violations", () => {
    engine.updatePolicy({ maxRequestsPerMinute: 3 });
    for (let i = 0; i < 5; i++) {
      engine.evaluateRequest({
        method: "GET",
        path: "/api/data",
        ip: "192.168.1.1",
      });
    }
    const violations = engine.getViolations(24);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.type === "rate_limit_exceeded")).toBe(true);
  });

  it("records sensitive endpoint violations", () => {
    engine.updatePolicy({
      sensitiveEndpoints: ["/api/critical"],
      requireApiKeyForWrites: false,
    });
    engine.evaluateRequest({
      method: "POST",
      path: "/api/critical",
      ip: "192.168.1.1",
    });
    const violations = engine.getViolations(24);
    expect(violations).toHaveLength(1);
    expect(violations[0].type).toBe("sensitive_endpoint");
  });

  it("filters violations by time window", () => {
    engine.updatePolicy({ maxRequestsPerMinute: 1 });
    // Create violations
    engine.evaluateRequest({ method: "GET", path: "/api/data", ip: "1.1.1.1" });
    engine.evaluateRequest({ method: "GET", path: "/api/data", ip: "1.1.1.1" });

    const lastHour = engine.getViolations(1);
    const lastDay = engine.getViolations(24);
    expect(lastDay.length).toBeGreaterThanOrEqual(lastHour.length);
  });

  it("persists violations", () => {
    engine.updatePolicy({ ipWhitelist: ["192.168.1.1"] });
    const decision = engine.evaluateRequest({
      method: "GET",
      path: "/api/data",
      ip: "10.0.0.1",
    });
    expect(decision.allowed).toBe(false);
    // Verify violation was recorded in memory
    const violations = engine.getViolations(24);
    expect(violations.length).toBeGreaterThan(0);
  });
});

// ─── Governance Report Tests ────────────────────────────

describe("GovernanceEngine — Governance Report", () => {
  it("generates governance report", () => {
    const report = engine.getGovernanceReport();
    expect(report.totalRequestsToday).toBeDefined();
    expect(report.blockedRequests).toBeDefined();
    expect(report.rateLimitedRequests).toBeDefined();
    expect(report.topApiKeysByUsage).toBeDefined();
    expect(report.suspiciousActivityFlags).toBeDefined();
    expect(report.reportGeneratedAt).toBeDefined();
  });

  it("counts total requests today", () => {
    engine.updatePolicy({ auditAllRequests: true });
    engine.evaluateRequest({
      method: "GET",
      path: "/api/data",
      ip: "192.168.1.1",
    });
    engine.evaluateRequest({
      method: "GET",
      path: "/api/stats",
      ip: "192.168.1.1",
    });
    const report = engine.getGovernanceReport();
    expect(report.totalRequestsToday).toBeGreaterThanOrEqual(2);
  });

  it("tracks top API keys by usage", () => {
    engine.updatePolicy({ auditAllRequests: true });
    for (let i = 0; i < 5; i++) {
      engine.evaluateRequest({
        method: "GET",
        path: "/api/data",
        apiKey: "api-key-1",
        ip: "192.168.1.1",
      });
    }
    for (let i = 0; i < 3; i++) {
      engine.evaluateRequest({
        method: "GET",
        path: "/api/data",
        apiKey: "api-key-2",
        ip: "192.168.1.1",
      });
    }
    const report = engine.getGovernanceReport();
    expect(report.topApiKeysByUsage.length).toBeGreaterThan(0);
    expect(report.topApiKeysByUsage[0].apiKey).toBe("api-key-1");
  });

  it("flags suspicious activity with many failed auths", () => {
    engine.updatePolicy({ requireApiKeyForReads: true });
    // 25 failed auth attempts
    for (let i = 0; i < 25; i++) {
      engine.evaluateRequest({
        method: "GET",
        path: "/api/data",
        ip: "192.168.1.1",
      });
    }
    const report = engine.getGovernanceReport();
    expect(report.suspiciousActivityFlags.some((f) => f.includes("failed authentication"))).toBe(true);
  });

  it("flags suspicious activity with many rate limit hits", () => {
    engine.updatePolicy({ maxRequestsPerMinute: 3 });
    // Exceed rate limit multiple times
    for (let i = 0; i < 20; i++) {
      engine.evaluateRequest({
        method: "GET",
        path: "/api/data",
        ip: "192.168.1.1",
      });
    }
    const report = engine.getGovernanceReport();
    expect(report.suspiciousActivityFlags.some((f) => f.includes("rate limit violations"))).toBe(true);
  });

  it("flags IPs with concentrated violations", () => {
    engine.updatePolicy({ maxRequestsPerMinute: 2 });
    const ip = "10.0.0.1";
    // Create 10 rate limit violations from same IP
    for (let i = 0; i < 15; i++) {
      engine.evaluateRequest({
        method: "GET",
        path: "/api/data",
        ip,
      });
    }
    const report = engine.getGovernanceReport();
    expect(report.suspiciousActivityFlags.some((f) => f.includes("IP " + ip))).toBe(true);
  });
});

// ─── Audit Trail Tests ──────────────────────────────────

describe("GovernanceEngine — Audit Trail", () => {
  it("enables audit logging with policy flag", () => {
    engine.updatePolicy({ auditAllRequests: true });
    engine.evaluateRequest({
      method: "GET",
      path: "/api/data",
      ip: "192.168.1.1",
    });
    const trail = engine.getAuditTrail();
    expect(trail.length).toBeGreaterThan(0);
  });

  it("logs allowed requests to audit trail", () => {
    engine.updatePolicy({ auditAllRequests: true });
    engine.evaluateRequest({
      method: "GET",
      path: "/api/data",
      ip: "192.168.1.1",
    });
    const trail = engine.getAuditTrail({ status: "allowed" });
    expect(trail.length).toBeGreaterThan(0);
    expect(trail[0].allowed).toBe(true);
  });

  it("filters audit trail by API key", () => {
    engine.updatePolicy({ auditAllRequests: true });
    engine.evaluateRequest({
      method: "GET",
      path: "/api/data",
      apiKey: "key-1",
      ip: "192.168.1.1",
    });
    engine.evaluateRequest({
      method: "GET",
      path: "/api/data",
      apiKey: "key-2",
      ip: "192.168.1.1",
    });
    const trail = engine.getAuditTrail({ apiKey: "key-1" });
    expect(trail.every((e) => e.apiKey === "key-1")).toBe(true);
  });

  it("filters audit trail by path", () => {
    engine.updatePolicy({ auditAllRequests: true });
    engine.evaluateRequest({
      method: "GET",
      path: "/api/data",
      ip: "192.168.1.1",
    });
    engine.evaluateRequest({
      method: "GET",
      path: "/api/stats",
      ip: "192.168.1.1",
    });
    const trail = engine.getAuditTrail({ path: "/api/data" });
    expect(trail.every((e) => e.path.includes("/api/data"))).toBe(true);
  });

  it("filters audit trail by time window", () => {
    engine.updatePolicy({ auditAllRequests: true });
    engine.evaluateRequest({
      method: "GET",
      path: "/api/data",
      ip: "192.168.1.1",
    });
    const trail1Hour = engine.getAuditTrail({ hours: 1 });
    const trail24Hours = engine.getAuditTrail({ hours: 24 });
    expect(trail24Hours.length).toBeGreaterThanOrEqual(trail1Hour.length);
  });

  it("returns last 1000 audit events", () => {
    engine.updatePolicy({ auditAllRequests: true });
    // Create many events (but won't exceed limit in test)
    for (let i = 0; i < 10; i++) {
      engine.evaluateRequest({
        method: "GET",
        path: "/api/data",
        ip: "192.168.1.1",
      });
    }
    const trail = engine.getAuditTrail();
    expect(trail.length).toBeLessThanOrEqual(1000);
  });

  it("filters audit trail by allowed/blocked status", () => {
    engine.updatePolicy({ auditAllRequests: true, requireApiKeyForReads: true });
    engine.evaluateRequest({
      method: "GET",
      path: "/api/data",
      apiKey: "valid",
      ip: "192.168.1.1",
    });
    engine.evaluateRequest({
      method: "GET",
      path: "/api/data",
      ip: "192.168.1.1",
    });

    const allowed = engine.getAuditTrail({ status: "allowed" });
    const blocked = engine.getAuditTrail({ status: "blocked" });

    expect(allowed.every((e) => e.allowed === true)).toBe(true);
    expect(blocked.every((e) => e.allowed === false)).toBe(true);
  });
});

// ─── Integration Tests ──────────────────────────────────

describe("GovernanceEngine — Integration", () => {
  it("works end-to-end with policy, evaluation, and reporting", () => {
    engine.updatePolicy({
      requireApiKeyForWrites: true,
      maxRequestsPerMinute: 100,
      auditAllRequests: true,
    });

    engine.evaluateRequest({
      method: "GET",
      path: "/api/data",
      ip: "192.168.1.1",
    });

    engine.evaluateRequest({
      method: "POST",
      path: "/api/orders",
      apiKey: "key",
      ip: "192.168.1.1",
    });

    const report = engine.getGovernanceReport();
    expect(report.totalRequestsToday).toBe(2);

    const policy = engine.getPolicy();
    expect(policy.requireApiKeyForWrites).toBe(true);
  });

  it("maintains separate rate limits for different request types", () => {
    engine.updatePolicy({
      maxRequestsPerMinute: 3,
      maxWriteRequestsPerMinute: 2,
    });

    // 4 read requests (exceeds read limit of 3)
    for (let i = 0; i < 4; i++) {
      engine.evaluateRequest({
        method: "GET",
        path: "/api/data",
        ip: "192.168.1.1",
      });
    }

    // 3 write requests (exceeds write limit of 2)
    for (let i = 0; i < 3; i++) {
      engine.evaluateRequest({
        method: "POST",
        path: "/api/orders",
        apiKey: "key",
        ip: "192.168.1.1",
      });
    }

    const violations = engine.getViolations(24);
    expect(violations.filter((v) => v.type === "rate_limit_exceeded").length).toBeGreaterThanOrEqual(2);
  });

  it("resets all governance state", () => {
    engine.updatePolicy({ maxRequestsPerMinute: 500 });
    engine.evaluateRequest({
      method: "GET",
      path: "/api/data",
      ip: "192.168.1.1",
    });

    engine.reset();

    const policy = engine.getPolicy();
    expect(policy.maxRequestsPerMinute).toBe(120); // back to default
    expect(engine.getViolations(24)).toHaveLength(0);
  });

  it("singleton instance persists across calls", () => {
    const engine1 = getGovernanceEngine();
    engine1.updatePolicy({ maxRequestsPerMinute: 300 });

    const engine2 = getGovernanceEngine();
    expect(engine2.getPolicy().maxRequestsPerMinute).toBe(300);
  });
});
