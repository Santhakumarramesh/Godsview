/**
 * runtime_config_unit.test.ts — Phase 65
 *
 * Tests the runtimeConfig object shape and parsing helpers.
 * We can't easily re-import with different env vars (module is frozen at load time),
 * so we test the exported runtimeConfig and getRuntimeConfigForLog() against the
 * env that vitest sets: NODE_ENV=test, PORT=3001, etc.
 */

import { describe, it, expect } from "vitest";
import { runtimeConfig, getRuntimeConfigForLog } from "../lib/runtime_config";

describe("runtimeConfig", () => {
  it("is a readonly frozen object", () => {
    expect(Object.isFrozen(runtimeConfig)).toBe(true);
  });

  it("exposes expected keys", () => {
    const keys = [
      "nodeEnv", "port", "corsOrigins", "systemMode", "trustProxy",
      "requestBodyLimit", "requestTimeoutMs", "keepAliveTimeoutMs",
      "headersTimeoutMs", "shutdownTimeoutMs", "maxRequestsPerSocket",
      "rateLimitWindowMs", "rateLimitMax",
      "hasAlpacaKeys", "hasAnthropicKey", "hasOperatorToken",
    ] as const;
    for (const key of keys) {
      expect(runtimeConfig).toHaveProperty(key);
    }
  });

  it("nodeEnv is development|test|production", () => {
    expect(["development", "test", "production"]).toContain(runtimeConfig.nodeEnv);
  });

  it("port is a positive integer", () => {
    expect(Number.isInteger(runtimeConfig.port)).toBe(true);
    expect(runtimeConfig.port).toBeGreaterThan(0);
    expect(runtimeConfig.port).toBeLessThanOrEqual(65535);
  });

  it("systemMode is a valid string", () => {
    expect(typeof runtimeConfig.systemMode).toBe("string");
    expect(runtimeConfig.systemMode.length).toBeGreaterThan(0);
  });

  it("requestBodyLimit is a non-empty string", () => {
    expect(typeof runtimeConfig.requestBodyLimit).toBe("string");
    expect(runtimeConfig.requestBodyLimit.length).toBeGreaterThan(0);
  });

  it("requestTimeoutMs > 0", () => {
    expect(runtimeConfig.requestTimeoutMs).toBeGreaterThan(0);
  });

  it("rateLimitWindowMs > 0", () => {
    expect(runtimeConfig.rateLimitWindowMs).toBeGreaterThan(0);
  });

  it("rateLimitMax > 0", () => {
    expect(runtimeConfig.rateLimitMax).toBeGreaterThan(0);
  });

  it("corsOrigins is an array", () => {
    expect(Array.isArray(runtimeConfig.corsOrigins)).toBe(true);
  });

  it("boolean flags are booleans", () => {
    expect(typeof runtimeConfig.hasAlpacaKeys).toBe("boolean");
    expect(typeof runtimeConfig.hasAnthropicKey).toBe("boolean");
    expect(typeof runtimeConfig.hasOperatorToken).toBe("boolean");
  });
});

describe("getRuntimeConfigForLog", () => {
  it("returns a plain object", () => {
    const log = getRuntimeConfigForLog();
    expect(typeof log).toBe("object");
    expect(log).not.toBeNull();
  });

  it("includes nodeEnv and port", () => {
    const log = getRuntimeConfigForLog();
    expect(log).toHaveProperty("nodeEnv");
    expect(log).toHaveProperty("port");
  });

  it("values are primitives (no nested objects)", () => {
    const log = getRuntimeConfigForLog();
    for (const val of Object.values(log)) {
      expect(["string", "number", "boolean"]).toContain(typeof val);
    }
  });

  it("systemMode matches runtimeConfig", () => {
    const log = getRuntimeConfigForLog();
    expect(log.systemMode).toBe(runtimeConfig.systemMode);
  });

  it("corsOriginCount matches corsOrigins length", () => {
    const log = getRuntimeConfigForLog();
    expect(log.corsOriginCount).toBe(runtimeConfig.corsOrigins.length);
  });
});
