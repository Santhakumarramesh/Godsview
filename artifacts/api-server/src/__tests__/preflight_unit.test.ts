/**
 * preflight_unit.test.ts — Phase 65
 *
 * Tests runPreflight() result shape, check fields, and critical/non-critical logic.
 * DB and Alpaca are mocked so preflight can run without real connections.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: {
    execute: vi.fn().mockResolvedValue([]),
  },
  tradingSessionsTable: new Proxy({} as any, { get: (_t, p) => String(p) }),
}));

vi.mock("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray) => strings.join(""),
  eq: vi.fn(), and: vi.fn(), desc: vi.fn(), gte: vi.fn(),
}));

vi.mock("../lib/alpaca", () => ({
  getAccount: vi.fn().mockResolvedValue({ account_blocked: false }),
}));

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    })),
  },
}));

import { runPreflight, type PreflightResult } from "../lib/preflight";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("runPreflight — result shape", () => {
  let result: PreflightResult;

  beforeEach(async () => {
    result = await runPreflight();
  });

  it("returns an object with passed, checks, duration_ms", () => {
    expect(typeof result.passed).toBe("boolean");
    expect(Array.isArray(result.checks)).toBe(true);
    expect(typeof result.duration_ms).toBe("number");
  });

  it("duration_ms is non-negative", () => {
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("checks array is non-empty", () => {
    expect(result.checks.length).toBeGreaterThan(0);
  });

  it("each check has name, passed, detail, critical", () => {
    for (const check of result.checks) {
      expect(typeof check.name).toBe("string");
      expect(check.name.length).toBeGreaterThan(0);
      expect(typeof check.passed).toBe("boolean");
      expect(typeof check.detail).toBe("string");
      expect(typeof check.critical).toBe("boolean");
    }
  });

  it("includes a database check", () => {
    const dbCheck = result.checks.find(c => c.name === "database");
    expect(dbCheck).toBeDefined();
    expect(dbCheck?.critical).toBe(true);
  });

  it("includes a system_mode check", () => {
    const modeCheck = result.checks.find(c => c.name === "system_mode");
    expect(modeCheck).toBeDefined();
  });

  it("includes a node_version check", () => {
    const nodeCheck = result.checks.find(c => c.name === "node_version");
    expect(nodeCheck).toBeDefined();
    expect(nodeCheck?.detail).toMatch(/^v\d+/);
  });

  it("includes a memory check", () => {
    const memCheck = result.checks.find(c => c.name === "memory");
    expect(memCheck).toBeDefined();
    expect(memCheck?.detail).toMatch(/MB/);
  });

  it("node_version passes for Node 22", () => {
    const nodeCheck = result.checks.find(c => c.name === "node_version");
    expect(nodeCheck?.passed).toBe(true); // Node 22 >= 20
  });

  it("passed reflects all-critical-checks state", () => {
    const criticalFailed = result.checks.filter(c => c.critical && !c.passed);
    if (criticalFailed.length > 0) {
      expect(result.passed).toBe(false);
    } else {
      expect(result.passed).toBe(true);
    }
  });
});

describe("runPreflight — alpaca_keys check", () => {
  it("check is non-critical when keys are missing", async () => {
    const result = await runPreflight();
    const alpacaCheck = result.checks.find(c => c.name === "alpaca_keys");
    expect(alpacaCheck?.critical).toBe(false);
  });
});
