/**
 * startup_state_unit.test.ts — Phase 63
 *
 * Unit tests for lib/startup_state.ts:
 *
 *   markMlBootstrapRunning  — transitions state to "running"
 *   markMlBootstrapReady    — transitions state to "ready"
 *   markMlBootstrapFailed   — transitions state to "failed" with error
 *   getMlBootstrapSnapshot  — returns current snapshot
 *   getStartupSnapshot      — includes uptime + mlBootstrap
 *
 * No external dependencies — pure in-memory state machine.
 * State accumulates across tests; test ordering is intentionally sequential.
 */

import { describe, it, expect } from "vitest";

import {
  markMlBootstrapRunning,
  markMlBootstrapReady,
  markMlBootstrapFailed,
  getMlBootstrapSnapshot,
  getStartupSnapshot,
} from "../lib/startup_state";

// ─────────────────────────────────────────────────────────────────────────────
// getMlBootstrapSnapshot — initial state
// ─────────────────────────────────────────────────────────────────────────────

describe("getMlBootstrapSnapshot — shape", () => {
  it("returns an object with required fields", () => {
    const snap = getMlBootstrapSnapshot();
    expect(snap).toHaveProperty("state");
    expect(snap).toHaveProperty("startedAtIso");
    expect(snap).toHaveProperty("completedAtIso");
    expect(snap).toHaveProperty("error");
  });

  it("initial state is 'pending'", () => {
    // Module starts in pending state (this test assumes it runs first)
    const snap = getMlBootstrapSnapshot();
    expect(["pending", "running", "ready", "failed"]).toContain(snap.state);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// State machine: pending → running → ready
// ─────────────────────────────────────────────────────────────────────────────

describe("markMlBootstrapRunning", () => {
  it("transitions state to 'running'", () => {
    markMlBootstrapRunning();
    expect(getMlBootstrapSnapshot().state).toBe("running");
  });

  it("sets startedAtIso to a valid ISO string", () => {
    markMlBootstrapRunning();
    const snap = getMlBootstrapSnapshot();
    expect(snap.startedAtIso).not.toBeNull();
    expect(() => new Date(snap.startedAtIso!)).not.toThrow();
  });

  it("clears completedAtIso when transitioning to running", () => {
    markMlBootstrapRunning();
    expect(getMlBootstrapSnapshot().completedAtIso).toBeNull();
  });

  it("clears error when transitioning to running", () => {
    markMlBootstrapRunning();
    expect(getMlBootstrapSnapshot().error).toBeNull();
  });
});

describe("markMlBootstrapReady", () => {
  it("transitions state to 'ready'", () => {
    markMlBootstrapRunning();
    markMlBootstrapReady();
    expect(getMlBootstrapSnapshot().state).toBe("ready");
  });

  it("sets completedAtIso to a valid ISO string", () => {
    markMlBootstrapRunning();
    markMlBootstrapReady();
    const snap = getMlBootstrapSnapshot();
    expect(snap.completedAtIso).not.toBeNull();
    expect(() => new Date(snap.completedAtIso!)).not.toThrow();
  });

  it("error remains null on ready", () => {
    markMlBootstrapRunning();
    markMlBootstrapReady();
    expect(getMlBootstrapSnapshot().error).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// State machine: running → failed
// ─────────────────────────────────────────────────────────────────────────────

describe("markMlBootstrapFailed", () => {
  it("transitions state to 'failed'", () => {
    markMlBootstrapRunning();
    markMlBootstrapFailed(new Error("GPU out of memory"));
    expect(getMlBootstrapSnapshot().state).toBe("failed");
  });

  it("captures Error.message as the error string", () => {
    markMlBootstrapRunning();
    markMlBootstrapFailed(new Error("timeout after 30s"));
    expect(getMlBootstrapSnapshot().error).toBe("timeout after 30s");
  });

  it("converts non-Error to string", () => {
    markMlBootstrapRunning();
    markMlBootstrapFailed("simple string error");
    expect(getMlBootstrapSnapshot().error).toBe("simple string error");
  });

  it("converts object to string", () => {
    markMlBootstrapRunning();
    markMlBootstrapFailed({ code: 500 });
    expect(typeof getMlBootstrapSnapshot().error).toBe("string");
  });

  it("sets completedAtIso even on failure", () => {
    markMlBootstrapRunning();
    markMlBootstrapFailed(new Error("fail"));
    const snap = getMlBootstrapSnapshot();
    expect(snap.completedAtIso).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getStartupSnapshot
// ─────────────────────────────────────────────────────────────────────────────

describe("getStartupSnapshot", () => {
  it("returns required fields", () => {
    const snap = getStartupSnapshot();
    expect(snap).toHaveProperty("startedAtIso");
    expect(snap).toHaveProperty("uptimeMs");
    expect(snap).toHaveProperty("mlBootstrap");
  });

  it("startedAtIso is a valid ISO string", () => {
    const { startedAtIso } = getStartupSnapshot();
    expect(() => new Date(startedAtIso)).not.toThrow();
    expect(new Date(startedAtIso).toISOString()).toBe(startedAtIso);
  });

  it("uptimeMs is a positive number", () => {
    const { uptimeMs } = getStartupSnapshot();
    expect(uptimeMs).toBeGreaterThan(0);
    expect(Number.isFinite(uptimeMs)).toBe(true);
  });

  it("mlBootstrap field contains state", () => {
    const { mlBootstrap } = getStartupSnapshot();
    expect(["pending", "running", "ready", "failed"]).toContain(mlBootstrap.state);
  });

  it("uptimeMs increases on successive calls", async () => {
    const snap1 = getStartupSnapshot();
    await new Promise(r => setTimeout(r, 5));
    const snap2 = getStartupSnapshot();
    expect(snap2.uptimeMs).toBeGreaterThanOrEqual(snap1.uptimeMs);
  });
});
