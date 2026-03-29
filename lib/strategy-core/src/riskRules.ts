import type { SystemMode } from "./types";

export function canWriteOrders(mode: SystemMode): boolean {
  return mode === "paper" || mode === "live_enabled";
}

export function isLiveMode(mode: SystemMode): boolean {
  return mode === "live_enabled";
}
