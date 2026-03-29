import type { DecisionState, SystemMode } from "./types";

const VALID_SYSTEM_MODES = new Set<SystemMode>(["demo", "paper", "live_disabled", "live_enabled"]);

export function resolveSystemMode(rawMode: string | undefined, options?: { liveTradingEnabled?: boolean }): SystemMode {
  const normalized = String(rawMode ?? "").trim().toLowerCase();
  if (VALID_SYSTEM_MODES.has(normalized as SystemMode)) {
    return normalized as SystemMode;
  }
  return options?.liveTradingEnabled ? "live_enabled" : "live_disabled";
}

export function canWriteOrders(mode: SystemMode): boolean {
  return mode === "paper" || mode === "live_enabled";
}

export function isLiveMode(mode: SystemMode): boolean {
  return mode === "live_enabled";
}

export function deriveDecisionState(params: {
  blocked: boolean;
  degraded?: boolean;
  meetsThreshold: boolean;
}): DecisionState {
  if (params.degraded) return "DEGRADED_DATA";
  if (params.blocked) return "BLOCKED_BY_RISK";
  return params.meetsThreshold ? "TRADE" : "REJECTED";
}
