/**
 * env_shutdown_unit.test.ts — Phase 68
 *
 * Tests:
 * - env.ts: validateEnv(), runtimeConfig re-export
 * - shutdown.ts: onShutdown() registration
 */

import { describe, it, expect, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(),
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() })),
  },
}));

import { logger } from "../lib/logger";
import { validateEnv, runtimeConfig } from "../lib/env";
import { onShutdown } from "../lib/shutdown";

// ── env.ts ────────────────────────────────────────────────────────────────────

describe("validateEnv", () => {
  it("does not throw when required env vars are set", () => {
    expect(() => validateEnv()).not.toThrow();
  });

  it("logs environment on validation", () => {
    validateEnv();
    expect(vi.mocked(logger.info)).toHaveBeenCalled();
  });
});

describe("env runtimeConfig re-export", () => {
  it("re-exports runtimeConfig from runtime_config", () => {
    expect(runtimeConfig).toBeDefined();
    expect(typeof runtimeConfig).toBe("object");
  });

  it("runtimeConfig is a frozen object", () => {
    expect(Object.isFrozen(runtimeConfig)).toBe(true);
  });

  it("runtimeConfig has port field", () => {
    expect(runtimeConfig).toHaveProperty("port");
    expect(typeof runtimeConfig.port).toBe("number");
  });

  it("runtimeConfig has nodeEnv field", () => {
    expect(runtimeConfig).toHaveProperty("nodeEnv");
    expect(typeof runtimeConfig.nodeEnv).toBe("string");
  });

  it("runtimeConfig has systemMode field", () => {
    expect(runtimeConfig).toHaveProperty("systemMode");
    const validModes = ["live", "dry_run", "paper", "backtest", "live_disabled"];
    expect(validModes).toContain(runtimeConfig.systemMode);
  });
});

// ── shutdown.ts ───────────────────────────────────────────────────────────────

describe("onShutdown", () => {
  it("does not throw when registering a callback", () => {
    expect(() => onShutdown(async () => {})).not.toThrow();
  });

  it("accepts async functions as callbacks", () => {
    const asyncCb = async () => {
      await new Promise(r => setTimeout(r, 0));
    };
    expect(() => onShutdown(asyncCb)).not.toThrow();
  });

  it("multiple callbacks can be registered", () => {
    expect(() => {
      onShutdown(async () => {});
      onShutdown(async () => {});
      onShutdown(async () => {});
    }).not.toThrow();
  });

  it("registered callback is a function", () => {
    let captured: (() => Promise<void>) | null = null;
    // We can only verify by registering and confirming no error
    const cb = async () => {
      captured = null; // placeholder
    };
    expect(() => onShutdown(cb)).not.toThrow();
  });
});
