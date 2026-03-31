import { describe, it, expect } from "vitest";
import {
  markHealthy,
  markFailed,
  isAvailable,
  getDegradationSnapshot,
  withDegradation,
  shouldBypassClaude,
  heuristicClaudeScore,
} from "../lib/degradation";

describe("Graceful Degradation Manager", () => {
  it("should start with all subsystems healthy", () => {
    const snap = getDegradationSnapshot();
    expect(snap.overall).toBe("healthy");
    expect(snap.subsystems.alpaca.state).toBe("healthy");
    expect(snap.subsystems.claude.state).toBe("healthy");
    expect(snap.subsystems.database.state).toBe("healthy");
    expect(snap.subsystems.stream.state).toBe("healthy");
    expect(snap.degraded_capabilities).toHaveLength(0);
  });

  it("should mark subsystem as degraded after failure", () => {
    markFailed("alpaca", "Connection timeout");
    const snap = getDegradationSnapshot();
    expect(snap.subsystems.alpaca.state).toBe("degraded");
    expect(snap.subsystems.alpaca.last_error).toBe("Connection timeout");
    expect(snap.subsystems.alpaca.error_count).toBeGreaterThan(0);
    expect(snap.overall).toBe("degraded");
    // Reset
    markHealthy("alpaca");
  });

  it("should open circuit breaker after 5 consecutive failures", () => {
    for (let i = 0; i < 5; i++) {
      markFailed("stream", `Failure ${i}`);
    }
    const snap = getDegradationSnapshot();
    expect(snap.subsystems.stream.state).toBe("down");
    expect(snap.subsystems.stream.circuit_open).toBe(true);
    expect(isAvailable("stream")).toBe(false);
    // Reset
    markHealthy("stream");
  });

  it("should recover when marked healthy", () => {
    markFailed("claude", "API error");
    expect(getDegradationSnapshot().subsystems.claude.state).toBe("degraded");
    markHealthy("claude");
    expect(getDegradationSnapshot().subsystems.claude.state).toBe("healthy");
    expect(isAvailable("claude")).toBe(true);
  });

  it("withDegradation should return result on success", async () => {
    markHealthy("database");
    const { result, degraded } = await withDegradation(
      "database",
      async () => 42,
      -1,
    );
    expect(result).toBe(42);
    expect(degraded).toBe(false);
  });

  it("withDegradation should return fallback on failure", async () => {
    markHealthy("database");
    const { result, degraded } = await withDegradation(
      "database",
      async () => { throw new Error("DB down"); },
      -1,
    );
    expect(result).toBe(-1);
    expect(degraded).toBe(true);
    markHealthy("database");
  });

  it("should not bypass claude when healthy", () => {
    markHealthy("claude");
    expect(shouldBypassClaude()).toBe(false);
  });

  it("heuristicClaudeScore should produce valid scores", () => {
    const result = heuristicClaudeScore(0.8, 0.7, 0.6);
    expect(result.claude_score).toBeGreaterThan(0);
    expect(result.claude_score).toBeLessThanOrEqual(1);
    expect(result.claude_verdict).toBe("APPROVED");
    expect(result.claude_reasoning).toContain("Heuristic fallback");
  });

  it("heuristicClaudeScore should block low scores", () => {
    const result = heuristicClaudeScore(0.2, 0.1, 0.1);
    expect(result.claude_verdict).toBe("BLOCKED");
  });

  it("should report degraded capabilities when subsystem is down", () => {
    markFailed("claude", "API error");
    const snap = getDegradationSnapshot();
    expect(snap.degraded_capabilities.length).toBeGreaterThan(0);
    expect(snap.degraded_capabilities.some(c => c.includes("Claude"))).toBe(true);
    markHealthy("claude");
  });
});
