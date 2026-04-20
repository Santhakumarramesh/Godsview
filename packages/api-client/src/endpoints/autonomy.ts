/**
 * @gv/api-client — Phase 6 autonomy + kill-switch endpoints.
 *
 * Surfaces served by services/control_plane/app/routes/autonomy.py:
 *
 *   api.autonomy      — per-strategy autonomy record + transitions
 *   api.killSwitch    — global / account / strategy kill-switch controls
 *
 * Autonomy transitions hit a strict FSM (see `packages/types/src/autonomy.ts`)
 * enforced server-side. Any mutation that raises autonomy (promote →
 * autonomous_candidate → autonomous) must be paired with a governance
 * approval via `api.governance.approvals.create({
 *   action: "strategy_autonomous_promote", ...
 * })` prior to calling `autonomy.transition`.
 *
 * Kill-switch trips are append-only. The current state of a scope is
 * derived from the most recent event row per (scope, subjectKey).
 */
import type {
  AutonomyFilter,
  AutonomyHistoryList,
  AutonomyRecord,
  AutonomyRecordsList,
  AutonomyTransitionRequest,
  KillSwitchEventsList,
  KillSwitchFilter,
  KillSwitchResetRequest,
  KillSwitchStatesList,
  KillSwitchTripRequest,
} from "@gv/types";
import type { ApiClient } from "../client.js";

// ───────────────────────────── query-string helper ──────────────────────

function qs(query: object): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

// ───────────────────────────── autonomy ────────────────────────────────

export interface AutonomyEndpoints {
  /** GET /autonomy/records — list all strategy autonomy rows. */
  list: (filter?: AutonomyFilter) => Promise<AutonomyRecordsList>;
  /** GET /autonomy/records/:strategyId */
  get: (strategyId: string) => Promise<AutonomyRecord>;
  /**
   * POST /autonomy/records/:strategyId/transition — apply a transition
   * action (promote/demote/override/suspend/resume). The FSM rejects
   * invalid transitions with a 409.
   */
  transition: (
    strategyId: string,
    req: AutonomyTransitionRequest,
  ) => Promise<AutonomyRecord>;
  /**
   * POST /autonomy/records/:strategyId/recompute — admin-gated. Forces
   * the gate snapshot to refresh from the DNA + calibration + sample-
   * size sources.
   */
  recompute: (strategyId: string) => Promise<AutonomyRecord>;
  /** GET /autonomy/records/:strategyId/history — append-only history. */
  history: (
    strategyId: string,
    opts?: { limit?: number; offset?: number },
  ) => Promise<AutonomyHistoryList>;
  /** GET /autonomy/history — global history feed. */
  globalHistory: (filter?: AutonomyFilter) => Promise<AutonomyHistoryList>;
}

export function autonomyEndpoints(client: ApiClient): AutonomyEndpoints {
  return {
    list: (filter = { limit: 100 } as AutonomyFilter) =>
      client.get<AutonomyRecordsList>(`/autonomy/records${qs(filter)}`),
    get: (strategyId) =>
      client.get<AutonomyRecord>(
        `/autonomy/records/${encodeURIComponent(strategyId)}`,
      ),
    transition: (strategyId, req) =>
      client.post<AutonomyRecord>(
        `/autonomy/records/${encodeURIComponent(strategyId)}/transition`,
        req,
      ),
    recompute: (strategyId) =>
      client.post<AutonomyRecord>(
        `/autonomy/records/${encodeURIComponent(strategyId)}/recompute`,
        {},
      ),
    history: (strategyId, opts = {}) =>
      client.get<AutonomyHistoryList>(
        `/autonomy/records/${encodeURIComponent(strategyId)}/history${qs(opts)}`,
      ),
    globalHistory: (filter = { limit: 100 } as AutonomyFilter) =>
      client.get<AutonomyHistoryList>(`/autonomy/history${qs(filter)}`),
  };
}

// ───────────────────────────── kill switch ─────────────────────────────

export interface KillSwitchEndpoints {
  /** GET /kill-switch/states — all active scopes. */
  states: () => Promise<KillSwitchStatesList>;
  /** GET /kill-switch/events — audit log of every trip + reset. */
  events: (filter?: KillSwitchFilter) => Promise<KillSwitchEventsList>;
  /** POST /kill-switch/trip — operator/admin trips a scope. */
  trip: (req: KillSwitchTripRequest) => Promise<KillSwitchStatesList>;
  /**
   * POST /kill-switch/reset — clears a tripped scope. A reset on a
   * `global` scope requires a paired governance approval
   * (`kill_switch_toggle`).
   */
  reset: (req: KillSwitchResetRequest) => Promise<KillSwitchStatesList>;
}

export function killSwitchEndpoints(client: ApiClient): KillSwitchEndpoints {
  return {
    states: () => client.get<KillSwitchStatesList>(`/kill-switch/states`),
    events: (filter = { limit: 100 } as KillSwitchFilter) =>
      client.get<KillSwitchEventsList>(`/kill-switch/events${qs(filter)}`),
    trip: (req) =>
      client.post<KillSwitchStatesList>(`/kill-switch/trip`, req),
    reset: (req) =>
      client.post<KillSwitchStatesList>(`/kill-switch/reset`, req),
  };
}
