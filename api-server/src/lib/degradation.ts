/**
 * Graceful Degradation Manager — Tracks subsystem health and provides
 * fallback behavior when external dependencies are unreachable.
 *
 * Subsystems:
 * - alpaca: Market data + order execution
 * - claude: AI veto layer (Layer 6)
 * - database: PostgreSQL / PGlite
 * - stream: WebSocket price feed
 *
 * When a subsystem is degraded, the system continues operating with
 * reduced capabilities rather than failing entirely.
 */

import { logger } from "./logger";

// ── Types ─────────────────────────────────────────────

type SubsystemName = "alpaca" | "claude" | "database" | "stream";
type SubsystemState = "healthy" | "degraded" | "down";

interface SubsystemStatus {
  state: SubsystemState;
  last_healthy_at: string | null;
  last_error: string | null;
  error_count: number;
  consecutive_failures: number;
  circuit_open: boolean;
  /** Timestamp when circuit will close (allow retry) */
  circuit_retry_at: number | null;
}

export interface DegradationSnapshot {
  overall: SubsystemState;
  subsystems: Record<SubsystemName, SubsystemStatus>;
  degraded_capabilities: string[];
  timestamp: string;
}

// ── Config ────────────────────────────────────────────

const CIRCUIT_OPEN_AFTER_FAILURES = 5;
const CIRCUIT_RETRY_MS = 30_000; // 30s before retrying
const SUBSYSTEM_NAMES: SubsystemName[] = ["alpaca", "claude", "database", "stream"];

// ── State ─────────────────────────────────────────────

const subsystems = new Map<SubsystemName, SubsystemStatus>();

function initSubsystem(name: SubsystemName): SubsystemStatus {
  return {
    state: "healthy",
    last_healthy_at: new Date().toISOString(),
    last_error: null,
    error_count: 0,
    consecutive_failures: 0,
    circuit_open: false,
    circuit_retry_at: null,
  };
}

// Initialize all subsystems
for (const name of SUBSYSTEM_NAMES) {
  subsystems.set(name, initSubsystem(name));
}

// ── Public API ────────────────────────────────────────

/** Report a successful interaction with a subsystem */
export function markHealthy(name: SubsystemName): void {
  const sub = subsystems.get(name);
  if (!sub) return;
  sub.state = "healthy";
  sub.last_healthy_at = new Date().toISOString();
  sub.consecutive_failures = 0;
  sub.circuit_open = false;
  sub.circuit_retry_at = null;
}

/** Report a failed interaction with a subsystem */
export function markFailed(name: SubsystemName, error: string): void {
  const sub = subsystems.get(name);
  if (!sub) return;
  sub.error_count++;
  sub.consecutive_failures++;
  sub.last_error = error;

  if (sub.consecutive_failures >= CIRCUIT_OPEN_AFTER_FAILURES) {
    sub.state = "down";
    sub.circuit_open = true;
    sub.circuit_retry_at = Date.now() + CIRCUIT_RETRY_MS;
    logger.error({ subsystem: name, failures: sub.consecutive_failures },
      `Circuit breaker OPEN for ${name} — ${sub.consecutive_failures} consecutive failures`);
  } else {
    sub.state = "degraded";
  }
}

/** Check if a subsystem is available (circuit breaker check) */
export function isAvailable(name: SubsystemName): boolean {
  const sub = subsystems.get(name);
  if (!sub) return true;

  if (!sub.circuit_open) return true;

  // Check if retry window has elapsed
  if (sub.circuit_retry_at && Date.now() >= sub.circuit_retry_at) {
    // Half-open: allow one retry
    sub.circuit_open = false;
    sub.circuit_retry_at = null;
    sub.state = "degraded";
    logger.info({ subsystem: name }, `Circuit half-open for ${name} — allowing retry`);
    return true;
  }

  return false;
}

/** Get degradation snapshot for dashboard/health endpoint */
export function getDegradationSnapshot(): DegradationSnapshot {
  const result: Record<string, SubsystemStatus> = {};
  const degradedCapabilities: string[] = [];

  for (const [name, status] of subsystems) {
    result[name] = { ...status };

    if (status.state !== "healthy") {
      switch (name) {
        case "alpaca":
          degradedCapabilities.push("Live market data unavailable — using cached data");
          degradedCapabilities.push("Order execution disabled");
          break;
        case "claude":
          degradedCapabilities.push("Claude veto layer bypassed — using heuristic fallback");
          break;
        case "database":
          degradedCapabilities.push("Signal persistence disabled — running in-memory only");
          break;
        case "stream":
          degradedCapabilities.push("Real-time price stream down — using REST polling");
          break;
      }
    }
  }

  const states = Array.from(subsystems.values()).map((s) => s.state);
  let overall: SubsystemState = "healthy";
  if (states.includes("down")) overall = "down";
  else if (states.includes("degraded")) overall = "degraded";

  return {
    overall,
    subsystems: result as Record<SubsystemName, SubsystemStatus>,
    degraded_capabilities: degradedCapabilities,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Wrap an async operation with degradation tracking.
 * If the operation fails, marks the subsystem as failed and returns the fallback.
 * If the circuit is open, immediately returns the fallback without calling the operation.
 */
export async function withDegradation<T>(
  subsystem: SubsystemName,
  operation: () => Promise<T>,
  fallback: T,
): Promise<{ result: T; degraded: boolean }> {
  if (!isAvailable(subsystem)) {
    return { result: fallback, degraded: true };
  }

  try {
    const result = await operation();
    markHealthy(subsystem);
    return { result, degraded: false };
  } catch (err: any) {
    markFailed(subsystem, err.message ?? String(err));
    return { result: fallback, degraded: true };
  }
}

/**
 * Get a safe Claude score — returns heuristic fallback when Claude is unavailable.
 * Used by the signal pipeline as a drop-in replacement for claudeVeto().
 */
export function shouldBypassClaude(): boolean {
  return !isAvailable("claude");
}

/**
 * Get heuristic claude score based on other layer scores.
 * Used when Claude is degraded/down.
 */
export function heuristicClaudeScore(
  structureScore: number,
  orderFlowScore: number,
  recallScore: number,
): { claude_score: number; claude_verdict: string; claude_reasoning: string } {
  // Weighted average of other layers as a proxy
  const proxy = structureScore * 0.4 + orderFlowScore * 0.35 + recallScore * 0.25;
  const score = Math.max(0, Math.min(1, proxy));
  const verdict = score >= 0.65 ? "APPROVED" : score >= 0.45 ? "CAUTION" : "BLOCKED";

  return {
    claude_score: score,
    claude_verdict: verdict,
    claude_reasoning: `[Heuristic fallback — Claude unavailable] Proxy score ${(score * 100).toFixed(1)}% from structure/orderflow/recall`,
  };
}
