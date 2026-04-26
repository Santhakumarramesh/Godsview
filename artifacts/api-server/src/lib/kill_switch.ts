/**
 * Global webhook kill-switch.
 *
 * When active, every incoming webhook on the VC pipeline returns 423 Locked
 * with the operator-supplied reason. Persists across requests in-process; a
 * boot-time `WEBHOOK_KILL_SWITCH=on` env var can also trip it.
 *
 * Tripping the switch is the cheapest, fastest "stop everything" operator
 * action — strictly higher priority than mode changes or risk policy edits.
 */

let active = (process.env.WEBHOOK_KILL_SWITCH ?? "").toLowerCase() === "on";
let activatedAt: number | null = active ? Date.now() : null;
let activatedBy: string | null = active ? "boot:env" : null;
let reason: string | null = active ? "boot environment" : null;

export type KillSwitchSnapshot = {
  active: boolean;
  activatedAt: string | null;
  activatedBy: string | null;
  reason: string | null;
};

export function isKillSwitchActive(): boolean {
  return active;
}

export function getKillSwitchSnapshot(): KillSwitchSnapshot {
  return {
    active,
    activatedAt: activatedAt ? new Date(activatedAt).toISOString() : null,
    activatedBy,
    reason,
  };
}

export function activateKillSwitch(by: string, why: string): KillSwitchSnapshot {
  active = true;
  activatedAt = Date.now();
  activatedBy = by || "operator";
  reason = (why || "no reason given").slice(0, 240);
  return getKillSwitchSnapshot();
}

export function deactivateKillSwitch(by: string): KillSwitchSnapshot {
  active = false;
  activatedAt = null;
  activatedBy = null;
  reason = null;
  void by;
  return getKillSwitchSnapshot();
}
